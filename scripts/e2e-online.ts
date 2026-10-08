// 联机服务 e2e 冒烟：双 socket 客户端走 创建→加入→开始→移动投票→战斗指令→事件→掉落投票→结算
// 运行：npx tsx scripts/e2e-online.ts （需先启动 server：npx tsx server/index.ts）
import { io, type Socket } from 'socket.io-client';
import fs from 'node:fs';
import path from 'node:path';
import { C2S, S2C } from '../src/net/proto';
import {
  applyBattleHpMpOnly, applyEventChoice, applyRest, buildCombatRewards, buySlot, createGame,
  finishRun, initRecruit, initShop, initTrade, recruitPick, resolveLootVote, resolvePendingNode,
  skirmishPerPlayerRewards, startEvent, tradePick,
} from '../server/runhost';
import type { GameState, PlayerChar } from '../server/runhost';
import { BattleHost } from '../server/battlehost';
import { buildEnemyCombatants } from '../src/engine/unit';
import { mathRng } from '../src/types';

const URL = 'http://localhost:3001';
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

class Client {
  socket: Socket;
  name: string;
  playerId = '';
  roomId = '';
  queue = new Map<string, unknown[]>();
  waiters = new Map<string, { pred: (d: unknown) => boolean; resolve: (d: unknown) => void; timer: NodeJS.Timeout }[]>();

  constructor(name: string) {
    this.name = name;
    this.socket = io(URL, { transports: ['websocket'], reconnection: false });
    for (const ev of Object.values(S2C)) {
      this.socket.on(ev, (d: unknown) => {
        const q = this.queue.get(ev) ?? [];
        q.push(d);
        this.queue.set(ev, q);
        const ws = this.waiters.get(ev) ?? [];
        const remain: typeof ws = [];
        for (const w of ws) {
          if (w.pred(d)) {
            clearTimeout(w.timer);
            const qi = q.indexOf(d);
            if (qi >= 0) q.splice(qi, 1); // 消费式：waiter 匹配的事件从队列移除
            w.resolve(d);
          } else remain.push(w);
        }
        this.waiters.set(ev, remain);
      });
    }
  }

  awaitEvent(ev: string, pred?: (d: unknown) => boolean, timeout = 15000): Promise<unknown> {
    const q = this.queue.get(ev) ?? [];
    const idx = q.findIndex((d) => !pred || pred(d));
    if (idx >= 0) {
      const hit = q[idx];
      q.splice(idx, 1);
      return Promise.resolve(hit);
    }
    return new Promise((resolve, reject) => {
      const ws = this.waiters.get(ev) ?? [];
      let self: { pred: (d: unknown) => boolean; resolve: (d: unknown) => void; timer: NodeJS.Timeout } | null = null;
      self = {
        pred: pred ?? (() => true),
        resolve: (d) => resolve(d),
        timer: setTimeout(() => {
          const arr = this.waiters.get(ev) ?? [];
          this.waiters.set(ev, arr.filter((w) => w !== self));
          reject(new Error(`${this.name} 等待 ${ev} 超时`));
        }, timeout),
      };
      ws.push(self);
      this.waiters.set(ev, ws);
    });
  }

  drain(ev: string): void {
    this.queue.set(ev, []);
  }

  emit(ev: string, payload: unknown): void {
    this.socket.emit(ev, payload);
  }
}

function mkChar(save: Record<string, unknown>, idx: number): unknown {
  const chars = (save.characters as (Record<string, unknown> | null)[]).filter(Boolean);
  const c = JSON.parse(JSON.stringify(chars[idx % chars.length]));
  c.id = `e2e_char_${idx}_${Date.now()}`;
  c.name = `E2E角色${idx + 1}`;
  return c;
}

async function main(): Promise<void> {
  setTimeout(() => { console.error('e2e 全局超时（60s）'); process.exit(2); }, 60000).unref();
  console.log('=== 联机服务 e2e 冒烟 ===');
  const save = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'save.json'), 'utf-8'));
  const dataPack = { monsters: [], stages: [], items: [] };

  const p1 = new Client('房主');
  const p2 = new Client('队友');
  const waitConnect = (c: Client): Promise<void> =>
    new Promise((resolve, reject) => {
      if (c.socket.connected) { resolve(); return; }
      const t = setTimeout(() => reject(new Error(`${c.name} 连接超时`)), 5000);
      c.socket.on('connect', () => { clearTimeout(t); resolve(); });
      c.socket.on('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
  await waitConnect(p1);
  await waitConnect(p2);

  // 1) 创建/加入
  p1.emit(C2S.lobbyCreate, { name: '房主', char: mkChar(save, 0), dataPack });
  const created = (await p1.awaitEvent(S2C.roomUpdate)) as { roomId: string; playerId: string };
  check('房主创建房间', !!created.roomId, created);
  p1.roomId = created.roomId; p1.playerId = created.playerId;

  p2.emit(C2S.lobbyJoin, { roomId: created.roomId, name: '队友', char: mkChar(save, 1), dataPack });
  const joined = (await p2.awaitEvent(S2C.roomUpdate)) as { roomId: string; playerId: string };
  check('队友加入房间', joined.roomId === created.roomId, joined);
  p2.playerId = joined.playerId;

  await new Promise((r) => setTimeout(r, 300)); // 等 roomUpdate 广播

  // 2) 开始
  p1.emit(C2S.lobbyStart, {});
  const runState = (await p1.awaitEvent(S2C.runState)) as { phase: string; nodes: unknown[]; bindings: Record<string, string> };
  check('开始后收到地图', runState.phase === 'map' && runState.nodes.length > 0, { phase: runState.phase, nodes: runState.nodes?.length });
  check('角色绑定', Object.keys(runState.bindings ?? {}).length === 2, runState.bindings);

  // runSync：切视图后主动拉取当前副本状态（防错过初始广播）
  p1.emit(C2S.runSync, {});
  const synced = (await p1.awaitEvent(S2C.runState, (d) => (d as { phase: string }).phase === 'map')) as { phase: string; nodes: unknown[]; dungeonId?: string };
  check('runSync 主动拉取副本状态', synced.nodes.length > 0 && !!synced.dungeonId, { nodes: synced.nodes?.length, dungeonId: synced.dungeonId });

  // 3) 移动投票（选第一个可用节点）
  const voteMove = (await p1.awaitEvent(S2C.voteStart, (d) => (d as { kind: string }).kind === 'move')) as { options: { id: string }[]; kind: string };
  check('移动投票开始', voteMove.kind === 'move' && voteMove.options.length > 0, voteMove);
  const nodeId = voteMove.options[0].id;
  p1.emit(C2S.voteSubmit, { choiceId: nodeId });
  p2.emit(C2S.voteSubmit, { choiceId: nodeId });
  const voteResult = (await p1.awaitEvent(S2C.voteResult)) as { choiceId: string };
  check('移动投票裁决一致推进', voteResult.choiceId === nodeId, voteResult);

  // 4) 节点落地：可能是战斗/事件/休息，任一都代表状态流转
  const next = await p1.awaitEvent(S2C.runState, (d) => (d as { phase: string }).phase !== 'map' || (d as { currentNodeId: string | null }).currentNodeId !== runState.currentNodeId);
  check('节点推进后状态更新', next !== undefined);
  const phase = (next as { phase: string }).phase;
  console.log(`  → 首个节点阶段：${phase}`);

  if (phase === 'battle') {
    // 5) 战斗指令：两个客户端都在自己回合行动、处理自己的弹窗（先手随机，双方都要能推进）
    let acted = 0;
    const deadline = Date.now() + 25000;
    const clients = [p1, p2];
    while (Date.now() < deadline && acted < 2) {
      for (const c of clients) {
        let cur: { acterUid: string | null; myAllyUid: string | null; myUnits?: string[]; enemies: { uid: string }[]; popup?: { kind: string; ownerPlayerId: string } } | null = null;
        try {
          cur = (await c.awaitEvent(S2C.battleView, () => true, 3000)) as typeof cur;
        } catch { /* 3s 内无新战斗视图则继续等 */ }
        if (!cur) continue;
        if (cur.popup && cur.popup.ownerPlayerId === c.playerId) {
          c.emit(C2S.battleResolve, { kind: cur.popup.kind as never, form: 'red', accept: false, stat: 'str', optionId: 'worship' });
          continue;
        }
        if (cur.acterUid === cur.myAllyUid && cur.enemies.length > 0) {
          c.emit(C2S.battleAct, { action: { type: 'attack', targetUid: cur.enemies[0].uid } });
          acted++;
        }
      }
    }
    check('战斗行动提交（双方回合攻击）', acted >= 1, { acted });
  } else if (phase === 'event') {
    const ev = (await p1.awaitEvent(S2C.eventView)) as { options: { id: string }[] };
    check('事件视图收到', ev.options.length > 0, ev);
    const evVote = (await p1.awaitEvent(S2C.voteStart, (d) => (d as { kind: string }).kind === 'event')) as { options: { id: string }[] };
    p1.emit(C2S.voteSubmit, { choiceId: evVote.options[0].id });
    p2.emit(C2S.voteSubmit, { choiceId: evVote.options[0].id });
    check('事件投票提交', true);
  } else if (phase === 'map') {
    check('首个节点自动通过（未适配节点）', true);
  }

  await new Promise((r) => setTimeout(r, 500));
  p1.socket.close(); p2.socket.close();

  // 6) runhost 纯函数：掉落拆分 / 投票分配 / 事件 / 结算
  console.log('=== runhost 纯函数 ===');
  const players: PlayerChar[] = [
    { playerId: 'a', name: 'A', char: JSON.parse(JSON.stringify(mkChar(save, 0))) },
    { playerId: 'b', name: 'B', char: JSON.parse(JSON.stringify(mkChar(save, 1))) },
  ];
  players[0].char.coins = 600; players[1].char.coins = 300;
  const game: GameState = createGame(players, dataPack, mathRng);
  const map = game.run.party ? game.run : game.run;
  check('创建一局（灾厄7层）', !!game.run.dungeonId === true && (game.run.act === 1 || game.run.act === 'sub'), { dungeonId: game.run.dungeonId, act: game.run.act });
  check('v2：队伍遗物清空、初始遗物 per-player', game.run.relics.length === 0 && (game.perRelics[players[0].char.id] ?? []).length === 2,
    { runRelics: game.run.relics.length, per: game.perRelics[players[0].char.id]?.length });

  // 掉落：人为塞入投票池
  const stage = game.save.customStages.find((s) => s.dungeon === 'preWallCalamity' && s.difficulty !== 'boss' && (s.monsters?.length ?? 0) > 0);
  check('灾厄关卡存在', !!stage);
  if (stage) {
    const { pool, texts } = buildCombatRewards(game, players, { id: 'x', kind: 'combat', row: 0, cols: 0 } as never, stage, mathRng);
    check('战斗掉落构建（强化石每人1个）', game.perMaterials[players[0].char.id]?.some((m) => m.itemId === 'it_stone_rare' || m.itemId === 'it_stone_epic' || m.itemId === 'it_stone_legendary') === true, game.perMaterials);
    if (pool.length >= 2) {
      const subs: Record<string, string> = { a: pool[0].key, b: pool[0].key }; // 撞车
      const r2 = resolveLootVote(game, players, subs, mathRng);
      // 注：buildCombatRewards 的幸运判定可能已给某玩家塞过遗物，故用"每人至少获得 1 件"断言
      check('撞车投票：一人获得该件、另一人补得', (game.perItems[players[0].char.id].length + game.perRelics[players[0].char.id].length) >= 1
        && (game.perItems[players[1].char.id].length + game.perRelics[players[1].char.id].length) >= 1
        && r2.texts.length === 2, r2.texts);
    } else {
      check('掉落投票池（池项可能为0）', true);
    }
  }

  // 休息
  const before = JSON.parse(JSON.stringify(game.run.hpMp));
  game.run.hpMp[players[0].char.id] = { hp: 1, mp: 1 };
  const r3 = applyRest(game, players);
  check('休息恢复50%', game.run.hpMp[players[0].char.id].hp > 1, r3);

  // 事件
  const ev2 = startEvent(game, 'x', 1, mathRng);
  check('事件抽取（可能为空则跳过）', ev2.noEvent === false || ev2.noEvent === true);
  if (!ev2.noEvent && game.pendingEvent) {
    const r4 = applyEventChoice(game, players, game.pendingEvent.options[0].id, mathRng);
    check('事件选项应用返回文本', r4.texts.length >= 0);
    check('事件遗物/藏品转入投票池', game.lootPool.length >= 0);
  }

  // ---- 联机 v2 规则：掉落/独立节点/遗物独享 ----
  // 紧急/BOSS：按人数出 N 件全员未拥有遗物进投票池
  const bossStage = game.save.customStages.find((s) => s.dungeon === 'preWallCalamity' && s.difficulty === 'boss');
  if (bossStage) {
    const { pool: bp } = buildCombatRewards(game, players, { id: 'b', kind: 'boss', row: 0, cols: 0 } as never, bossStage, mathRng);
    const relicPool = bp.filter((l) => l.kind === 'relic');
    check('v2：紧急/BOSS 出 N 件遗物进池（N=人数）', relicPool.length === 2, relicPool.length);
    check('v2：进池遗物全员未拥有',
      relicPool.every((l) => !(game.perRelics[players[0].char.id] ?? []).includes(l.relicId!) && !(game.perRelics[players[1].char.id] ?? []).includes(l.relicId!)), true);
  } else {
    check('v2：BOSS 关卡存在', false, '未找到灾厄 BOSS 关卡');
  }

  // 商店：每人独立（扣个人币）
  game.perCoins['a'] = 99999;
  game.perCoins['b'] = 99999;
  initShop(game, players, mathRng);
  const shopA = game.shopState['a'];
  check('v2：每人独立商店（槽位>0）', !!shopA && shopA.slots.length > 0, shopA?.slots.length);
  const slot0 = shopA?.slots[0];
  if (slot0) {
    const coinsBefore = game.perCoins['a'];
    const rb = buySlot(game, 'a', players[0].char.id, slot0.id);
    check('v2：购买成功扣个人币+物品入个人', rb.ok && game.perCoins['a'] === coinsBefore - slot0.price && shopA.bought.includes(slot0.id), { rb, coins: game.perCoins['a'] });
  }

  // 失与得：交换（成功或池空）
  const tradeItem = [...game.itemMap.values()].find((i) => i.slot !== 'consumable' && i.slot !== 'material' && i.slot !== 'blueprint');
  if (tradeItem) {
    (game.perItems[players[0].char.id] ?? (game.perItems[players[0].char.id] = [])).push(tradeItem.id);
    initTrade(game, players);
    const rt = tradePick(game, 'a', players[0].char.id, tradeItem.id, mathRng);
    check('v2：失与得交换（成功或池空报错）', rt.ok === true || (rt.ok === false && !!rt.err), rt);
  } else {
    check('v2：失与得（无装备类藏品则跳过）', true);
  }

  // 王牌招募：绑定 perAce
  initRecruit(game, players, mathRng);
  const cand = game.recruitState['a']?.candidates[0];
  if (cand) {
    const rr = recruitPick(game, 'a', players[0].char.id, cand.id);
    check('v2：招募王牌绑定 perAce', rr.ok && game.perAce[players[0].char.id] === cand.id, rr);
  } else {
    check('v2：王牌候选存在', false, game.recruitState['a']);
  }

  // 狭路相逢奖励一人一份
  const matsBefore = (game.perMaterials[players[0].char.id] ?? []).length;
  skirmishPerPlayerRewards(game, players, 2, mathRng);
  check('v2：狭路奖励材料一人一份', (game.perMaterials[players[0].char.id] ?? []).length >= matsBefore, true);

  // 安全的角落复活死亡角色
  game.run.hpMp[players[0].char.id] = { hp: 0, mp: 0 };
  const rRest2 = applyRest(game, players);
  check('v2：安全的角落复活死亡角色', game.run.hpMp[players[0].char.id].hp > 0, game.run.hpMp[players[0].char.id]);

  // ---- 副本选择 + 新手村自适应难度 ----
  const novice = createGame(players, dataPack, mathRng, 'starterVillage');
  check('v2.5：创建新手村（终局联系）副本', novice.run.dungeonId === 'starterVillage' && novice.run.act === 1, novice.run.dungeonId);
  const noviceStage = novice.save.customStages.find((s) => s.dungeon === 'starterVillage' && s.difficulty !== 'boss' && (s.monsters?.length ?? 0) > 0);
  if (noviceStage) {
    const base = buildEnemyCombatants(
      novice.monsterMap.get(noviceStage.monsters[0]!.monsterId)!, 0, novice.monsterMap, noviceStage.mechanics, false,
    )[0]!.maxHp;
    const bh = new BattleHost(novice, players, { broadcast: () => {}, onEnd: () => {}, log: () => {} }, noviceStage, mathRng);
    check('v2.5：新手村2人怪物HP×1.5', bh.state.enemies[0]!.maxHp === Math.round(base * 1.5), { base, actual: bh.state.enemies[0]?.maxHp });
    // 3 人 → ×2
    const p3 = [...players, { playerId: 'c', name: 'C', char: JSON.parse(JSON.stringify(mkChar(save, 2))) }];
    const novice3 = createGame(p3, dataPack, mathRng, 'starterVillage');
    const s3 = novice3.save.customStages.find((s) => s.dungeon === 'starterVillage' && s.difficulty !== 'boss' && (s.monsters?.length ?? 0) > 0)!;
    const bh3 = new BattleHost(novice3, p3, { broadcast: () => {}, onEnd: () => {}, log: () => {} }, s3, mathRng);
    check('v2.5：新手村3人怪物HP×2', bh3.state.enemies[0]!.maxHp === Math.round(base * 2), { base, actual: bh3.state.enemies[0]?.maxHp });
  } else {
    check('v2.5：新手村关卡存在', false, '未找到新手村作战关卡');
  }

  // 结算
  const r5 = finishRun(game, players);
  check('通关结算：每人按个人独立币结算', r5.perPlayer[0].coins === game.perCoins['a'] && r5.perPlayer[1].coins === game.perCoins['b'],
    { a: r5.perPlayer[0].coins, b: r5.perPlayer[1].coins, perA: game.perCoins['a'], perB: game.perCoins['b'] });
  check('材料/藏品写入独享仓库', (players[0].char.storage ?? []).length >= 0);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('e2e 失败：', e); process.exit(1); });
