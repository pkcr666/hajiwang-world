// 房间管理：创建/加入/离开 + 全员投票（一致推进、分歧随机取一人、剩一人 30s 倒计时）
// + 副本流程编排（移动→节点→战斗/事件→掉落分配→推进）
import { Server, type Socket } from 'socket.io';
import type { Character, MapNode, StageDef } from '../src/types';
import { mathRng } from '../src/types';
import type { PersonalView, ResultView, RunView, VoteKind, VoteOption, VoteView } from '../src/net/proto';
import { S2C } from '../src/net/proto';
import { BattleHost } from './battlehost';
import {
  abortRun, applyBagEquip, applyBagUnequip, applyBattleHpMpOnly, applyEventChoice, applyRest,
  buildBagView, buildCombatRewards, buildShopView,
  buySlot, createGame, decideNode, finishRun, initRecruit, initShop, initTrade,
  recruitPick, resolveLootVote, resolvePendingNode, runView, shopHaggle, shopRefresh, shopSell,
  skirmishPerPlayerRewards,
  startEvent, tradePick,
  type DataPack, type GameState, type PlayerChar,
} from './runhost';
import { findStage } from '../src/engine/events';
import { rollSkirmishTiers } from '../src/engine/nodes';
import { availableNodes, currentMap, openTorchLink, torchEdgeKey } from '../src/engine/run';

interface RoomPlayer {
  socketId: string;
  playerId: string;
  name: string;
  char?: Character;
  online: boolean;
}

// 个人操作节点（商店/失与得/招募）：全员声明完成后推进
interface PersonalPending {
  kind: 'shop' | 'trade' | 'recruit';
  done: Set<string>;
}

interface Vote {
  voteId: string;
  kind: VoteKind;
  title: string;
  desc?: string;
  options: VoteOption[];
  submissions: Record<string, string>;
  onResolve: (choiceId: string, submissions: Record<string, string>) => void;
  deadlineAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

interface Room {
  id: string;
  hostId: string;
  players: Map<string, RoomPlayer>;
  dataPack: DataPack;
  dungeonId: string; // 房主建房时选定：'starterVillage'（新手村）| 'preWallCalamity'（灾厄泰拉）
  game?: GameState;
  battle?: BattleHost;
  vote?: Vote;
  pendingPersonal?: PersonalPending;
  skirmishTier?: number; // 狭路相逢投票选中的档位
  phase: 'lobby' | 'run' | 'done';
  voteSeq: number;
  logs: string[];
}

const VOTE_TIMEOUT_MS = 30_000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private playerRoom = new Map<string, string>(); // playerId -> roomId

  constructor(private io: Server) {}

  // ---------- 房间生命周期 ----------
  create(socket: Socket, name: string, char: Character, dataPack: DataPack, dungeonId = 'preWallCalamity'): { roomId: string; playerId: string } {
    const roomId = Math.random().toString(36).slice(2, 6).toUpperCase();
    const playerId = `p_${socket.id.slice(-6)}_${Date.now().toString(36)}`;
    const room: Room = {
      id: roomId,
      hostId: playerId,
      players: new Map([[playerId, { socketId: socket.id, playerId, name, char, online: true }]]),
      dataPack,
      dungeonId: dungeonId === 'starterVillage' ? 'starterVillage' : 'preWallCalamity',
      phase: 'lobby',
      voteSeq: 0,
      logs: [],
    };
    this.rooms.set(roomId, room);
    this.playerRoom.set(playerId, roomId);
    // 定向给创建者（带 myPlayerId/action）+ 全员广播房间视图
    socket.emit(S2C.roomUpdate, { ...this.roomView(room), myPlayerId: playerId, action: 'created' });
    this.broadcastRoom(room, S2C.roomUpdate, this.roomView(room));
    return { roomId, playerId };
  }

  join(socket: Socket, roomId: string, name: string, char: Character, dataPack: DataPack, _dungeonId?: string): { roomId: string; playerId: string } | { err: string } {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room) return { err: '房间不存在' };
    if (room.phase !== 'lobby') return { err: '游戏已开始，无法加入' };
    const playerId = `p_${socket.id.slice(-6)}_${Date.now().toString(36)}`;
    room.players.set(playerId, { socketId: socket.id, playerId, name, char, online: true });
    // 后加入者的数据包仅作补全（权威仍是房主）
    if (room.dataPack.monsters.length === 0 && dataPack.monsters.length > 0) room.dataPack.monsters = dataPack.monsters;
    this.playerRoom.set(playerId, roomId);
    socket.emit(S2C.roomUpdate, { ...this.roomView(room), myPlayerId: playerId, action: 'joined' });
    this.broadcastRoom(room, S2C.roomUpdate, this.roomView(room));
    return { roomId, playerId };
  }

  leave(socket: Socket): void {
    for (const room of this.rooms.values()) {
      for (const [pid, p] of room.players) {
        if (p.socketId === socket.id) {
          p.online = false;
          this.playerRoom.delete(pid);
          this.broadcastRoom(room, S2C.roomUpdate, this.roomView(room));
          if (room.phase !== 'lobby' && room.game) {
            this.pushLog(room, `【${p.name}】已离开房间`);
          }
        }
      }
    }
  }

  private roomView(room: Room) {
    return {
      roomId: room.id,
      hostId: room.hostId,
      phase: room.phase,
      players: [...room.players.values()].map((p) => ({
        playerId: p.playerId,
        name: p.name,
        charId: p.char?.id ?? null,
        charName: p.char?.name ?? null,
        charJob: p.char?.job ?? null,
        online: p.online,
        isHost: p.playerId === room.hostId,
      })),
    };
  }

  private broadcastRoom(room: Room, event: string, payload: unknown): void {
    for (const p of room.players.values()) {
      if (!p.online) continue;
      this.io.to(p.socketId).emit(event, payload);
    }
  }

  private pushLog(room: Room, text: string): void {
    room.logs.push(text);
    if (room.logs.length > 60) room.logs.shift();
  }

  // ---------- 投票 ----------
  startVote(room: Room, kind: VoteKind, title: string, options: VoteOption[], desc: string | undefined,
    onResolve: (choiceId: string, submissions: Record<string, string>) => void): void {
    room.vote = {
      voteId: `v${++room.voteSeq}`,
      kind, title, desc, options, submissions: {}, onResolve,
    };
    this.broadcastRoom(room, S2C.voteStart, this.voteView(room));
  }

  private voteView(room: Room): VoteView {
    const v = room.vote!;
    const online = [...room.players.values()].filter((p) => p.online).map((p) => p.playerId);
    const waiting = online.filter((pid) => v.submissions[pid] === undefined);
    const names = (ids: string[]) => ids.map((id) => room.players.get(id)?.name ?? id);
    return {
      voteId: v.voteId,
      kind: v.kind,
      title: v.title,
      desc: v.desc,
      options: v.options,
      submissions: v.submissions,
      waiting: names(waiting),
      deadlineAt: v.deadlineAt,
    };
  }

  submitVote(socket: Socket, choiceId: string): void {
    const room = this.roomOf(socket);
    if (!room) return;
    const v = room.vote;
    if (!v) return;
    const playerId = [...room.players.values()].find((p) => p.socketId === socket.id)?.playerId;
    if (!playerId || v.submissions[playerId] !== undefined) return;
    if (!v.options.some((o) => o.id === choiceId)) return;
    v.submissions[playerId] = choiceId;
    this.broadcastRoom(room, S2C.voteUpdate, this.voteView(room));
    const missing = this.voteView(room).waiting.length;
    if (missing === 0) {
      this.resolveVote(room);
      return;
    }
    if (missing === 1 && v.deadlineAt === undefined) {
      v.deadlineAt = Date.now() + VOTE_TIMEOUT_MS;
      v.timer = setTimeout(() => {
        const cur = room.vote;
        if (cur && cur.voteId === v.voteId) this.resolveVote(room);
      }, VOTE_TIMEOUT_MS);
      this.broadcastRoom(room, S2C.voteUpdate, this.voteView(room));
    }
  }

  private resolveVote(room: Room): void {
    const v = room.vote;
    if (!v) return;
    room.vote = undefined;
    if (v.timer) clearTimeout(v.timer);
    const choices = Object.values(v.submissions);
    const agreed = choices.length > 0 && new Set(choices).size === 1;
    if (agreed) {
      const choiceId = choices[0];
      this.broadcastRoom(room, S2C.voteResult, { choiceId, title: v.title, submissions: v.submissions });
      this.safeResolve(room, v, choiceId, v.submissions);
      return;
    }
    // 意见不一致：先广播"正在随机"，延迟 1.5s 后公布随机结果并告知采纳了谁的选择
    this.broadcastRoom(room, S2C.voteResult, { choiceId: '', title: v.title, submissions: v.submissions, rolling: true });
    const rngRoll = () => {
      if (choices.length === 0) return v.options[0]?.id ?? '';
      return choices[Math.floor(Math.random() * choices.length)];
    };
    setTimeout(() => {
      const choiceId = rngRoll();
      const pickedPlayer = choices.length > 0 ? Object.entries(v.submissions).find(([, c]) => c === choiceId)?.[0] : undefined;
      const pickedName = pickedPlayer ? this.playerName(room, pickedPlayer) : undefined;
      this.broadcastRoom(room, S2C.voteResult, { choiceId, title: v.title, submissions: v.submissions, rolledBy: pickedName });
      this.safeResolve(room, v, choiceId, v.submissions);
    }, 1500);
  }

  // 调用投票结果回调：任何异常都不能让房间永久卡在"正在随机…"；记录日志并向全员广播恢复
  private safeResolve(room: Room, v: Vote, choiceId: string, submissions: Record<string, string>): void {
    try {
      v.onResolve(choiceId, submissions);
    } catch (e) {
      console.log('[vote:error]', v.title, String(e));
      this.broadcastRoom(room, S2C.err, { text: `投票结算出错：${String(e)}` });
      this.broadcastRun(room, 'map');
      this.startMoveVote(room);
    }
  }

  private playerName(room: Room, playerId: string): string {
    for (const p of room.players.values()) if (p.playerId === playerId) return p.name;
    return playerId;
  }

  // ---------- 副本流程 ----------
  startRun(socket: Socket): { ok: boolean; err?: string } {
    const room = this.roomOf(socket);
    if (!room) return { ok: false, err: '不在房间中' };
    const host = [...room.players.values()].find((p) => p.socketId === socket.id);
    if (!host || host.playerId !== room.hostId) return { ok: false, err: '只有房主可以开始' };
    const players = this.playerList(room);
    if (players.length < 2) return { ok: false, err: '至少需要 2 名玩家' };
    if (players.some((p) => !p.char)) return { ok: false, err: '还有玩家未选择角色' };
    try {
      const game = createGame(players, room.dataPack, mathRng, room.dungeonId);
      room.game = game;
      room.phase = 'run';
      const dungeonName = room.dungeonId === 'starterVillage' ? '新手村（终局联系）' : '灾厄泰拉';
      this.pushLog(room, `队伍进入${dungeonName}，共 ${players.length} 名冒险者`);
      this.broadcastRun(room, 'map');
      this.startMoveVote(room);
      return { ok: true };
    } catch (e) {
      return { ok: false, err: `开局失败：${String(e)}` };
    }
  }

  private playerList(room: Room): PlayerChar[] {
    return [...room.players.values()]
      .filter((p) => p.char)
      .map((p) => ({ playerId: p.playerId, name: p.name, char: p.char! }));
  }

  private roomOf(socket: Socket): Room | null {
    for (const room of this.rooms.values()) {
      for (const p of room.players.values()) {
        if (p.socketId === socket.id) return room;
      }
    }
    return null;
  }

  private broadcastRun(room: Room, phase: RunView['phase']): void {
    if (!room.game) return;
    this.broadcastRoom(room, S2C.runState, runView(room.game, this.playerList(room), phase));
  }

  private startMoveVote(room: Room): void {
    const g = room.game!;
    const nodes = availableNodes(g.run);
    if (nodes.length === 0) {
      // 无可用节点：可能刚开层（run.at=null 首列全部可选）或异常
      if (g.run.result === 'win') { this.doFinish(room); return; }
      this.pushLog(room, '当前无可移动节点（可能需要先处理层首选择）');
      this.broadcastRun(room, 'map');
      return;
    }
    const players = this.playerList(room);
    // 节点名/关卡名：在整层节点中查找（availableNodes 不含未点亮的火把线节点，torchOptions 可能引用它们）
    const stageName = (nodeId: string): string => {
      const node = currentMap(g.run).nodes.find((n) => n.id === nodeId);
      if (!node) return '';
      if (node.stageId) {
        const st = g.save.customStages.find((s) => s.id === node.stageId);
        if (st) return `：${st.name}`;
      }
      return '';
    };
    const kindLabel = (n: (typeof nodes)[number]): string => {
      switch (n.kind) {
        case 'combat': return `作战${stageName(n.id)}`;
        case 'boss': return `BOSS${stageName(n.id)}`;
        case 'encounter': return '不期而遇';
        case 'rest': return '休息';
        case 'merchant': return '行商';
        case 'trade': return '交易';
        case 'skirmish': return '狭路相逢';
        case 'recruit': return '王牌招募';
        case 'altar': return '祭坛';
        case 'fate': return '命运';
        default: return n.kind;
      }
    };
    const atId = g.run.at && currentMap(g.run).nodes.some((n) => n.id === g.run.at) ? g.run.at : null;
    // 火把线：未点亮但一端已清理的上下连线节点（消耗 1 根火把点亮后进入）
    const lit = (e: { from: string; to: string; torch?: boolean }) =>
      !e.torch || g.run.openedEdges.includes(torchEdgeKey(e.from, e.to));
    const torchOptions = atId && g.run.torches >= 1
      ? currentMap(g.run).nodes.filter((n) =>
          currentMap(g.run).edges.some((e) =>
            e.torch && !lit(e) && !g.run.cleared.includes(n.id) &&
            ((e.from === atId && e.to === n.id) || (e.to === atId && e.from === n.id)),
          ),
        )
      : [];
    this.startVote(room, 'move', '选择下一个目的地',
      [
        ...nodes.map((n) => ({
          id: n.id,
          label: kindLabel(n),
          desc: n.urgent ? '紧急' : undefined,
        })),
        ...torchOptions.map((n) => ({
          id: `torch:${atId}:${n.id}`,
          label: `${kindLabel(n)}（🔥 上下移动）`,
          desc: '消耗 1 根火把点亮上下连线',
        })),
      ],
      `全员提交后推进；意见不一致时随机采纳一名玩家的选择`,
      (choiceId) => this.enterNode(room, choiceId));
  }

  private enterNode(room: Room, nodeId: string): void {
    const g = room.game!;
    // 火把线移动：先点亮（扣 1 根火把）再进入目标节点
    if (nodeId.startsWith('torch:')) {
      const parts = nodeId.split(':');
      const a = parts[1] ?? '';
      const b = parts[2] ?? '';
      const before = g.run.torches;
      g.run = openTorchLink(g.run, a, b);
      if (g.run.torches === before) { this.pushLog(room, '火把不足，无法点亮火把线'); return; }
      this.pushLog(room, `点亮火把线（消耗 1 根火把），剩余 ${g.run.torches} 根`);
      nodeId = b;
    }
    const players = this.playerList(room);
    const d = decideNode(g, nodeId);
    g.pendingNodeId = nodeId;
    if (d.kind === 'battle') {
      this.startBattle(room, d.nodeId, d.node, d.stage);
      return;
    }
    if (d.kind === 'event') {
      const floor = typeof g.run.act === 'number' ? g.run.act : 3;
      const { texts, noEvent } = startEvent(g, nodeId, floor, mathRng);
      for (const t of texts) this.pushLog(room, t);
      if (noEvent) {
        resolvePendingNode(g);
        this.checkWinOrNext(room);
        return;
      }
      this.broadcastRun(room, 'event');
      const ev = g.pendingEvent!;
      this.broadcastRoom(room, S2C.eventView, {
        name: ev.name,
        text: ev.text,
        options: ev.options.map((o) => ({ id: o.id, text: o.text, hint: o.hint })),
      });
      this.startVote(room, 'event', ev.name, ev.options.map((o) => ({ id: o.id, label: o.text, desc: o.hint })), ev.text,
        (choiceId) => this.applyEvent(room, nodeId, choiceId));
      return;
    }
    if (d.kind === 'rest') {
      const texts = applyRest(g, players);
      for (const t of texts) this.pushLog(room, t);
      resolvePendingNode(g);
      this.checkWinOrNext(room);
      return;
    }
    // 个人操作节点：商店 / 失与得 / 王牌招募（每人独立界面，全员完成才推进）
    if (d.kind === 'shop' || d.kind === 'trade' || d.kind === 'recruit') {
      if (d.kind === 'shop') initShop(g, players, mathRng);
      if (d.kind === 'trade') initTrade(g, players);
      if (d.kind === 'recruit') initRecruit(g, players, mathRng);
      room.pendingPersonal = { kind: d.kind, done: new Set() };
      this.broadcastRun(room, 'map');
      this.broadcastPersonal(room);
      return;
    }
    // 狭路相逢：投票选择难度档位 → 按档位进入战斗
    if (d.kind === 'skirmish') {
      const tiers = rollSkirmishTiers(mathRng, g.save.customStages);
      this.startVote(room, 'other', '狭路相逢：选择挑战难度', tiers.map((t) => ({
        id: `t${t.tier}`,
        label: `${t.name}（${t.stageName}）`,
        desc: t.stageId ? `怪物：${t.monsters.map((m) => `${m.monsterId}×${m.count}`).join('、')}` : undefined,
      })), '全员提交后推进；通关后奖励一人一份。',
        (choiceId) => {
          const tier = tiers[Number(choiceId.slice(1)) - 1];
          const stage = tier?.stageId ? g.save.customStages.find((s) => s.id === tier.stageId) : undefined;
          if (!stage) {
            this.pushLog(room, `狭路相逢档位关卡缺失（${tier?.stageId ?? choiceId}），自动通过`);
            resolvePendingNode(g);
            this.checkWinOrNext(room);
            return;
          }
          room.skirmishTier = tier.tier;
          this.pushLog(room, `全员选择【${tier.name}】挑战狭路相逢`);
          this.startBattle(room, nodeId, { id: nodeId, kind: 'combat', row: 0, cols: 0 } as MapNode, stage);
        });
      return;
    }
    // 未适配节点：自动通过
    this.pushLog(room, `节点「${d.nodeId}」联机版暂未适配，自动通过`);
    resolvePendingNode(g);
    this.checkWinOrNext(room);
  }

  // 个人节点视图（每人看到自己的商店/交易/招募）
  private broadcastPersonal(room: Room): void {
    const g = room.game;
    const pp = room.pendingPersonal;
    if (!g || !pp) return;
    const players = this.playerList(room);
    const online = [...room.players.values()].filter((p) => p.online).length;
    const doneCount = pp.done.size;
    for (const p of players) {
      const sock = room.players.get(p.playerId)?.socketId;
      if (!sock) continue;
      let v: PersonalView;
      if (pp.kind === 'shop') {
        v = {
          kind: 'shop',
          shop: buildShopView(g, players, p.playerId, doneCount, online),
        };
      } else if (pp.kind === 'trade') {
        const st = g.tradeState[p.playerId];
        v = {
          kind: 'trade',
          trade: {
            offers: (st?.offers ?? []).map((o) => ({ id: o.itemId, label: `${o.name}（${o.rarity}）`, desc: '消耗该藏品，随机交换同品质或品质提升一档的藏品' })),
            picked: st?.picked,
            doneCount, total: online,
          },
        };
      } else {
        const st = g.recruitState[p.playerId];
        v = {
          kind: 'recruit',
          recruit: { candidates: st?.candidates ?? [], picked: st?.picked, doneCount, total: online },
        };
      }
      v.myDone = pp.done.has(p.playerId);
      this.io.to(sock).emit(S2C.personalView, v);
    }
  }

  // 个人节点指令：购买 / 刷新 / 砍价 / 出售 / 交换 / 招募
  shopBuy(socket: Socket, msg: { slotId: string }): void {
    const room = this.roomOf(socket);
    if (!room?.game || room.pendingPersonal?.kind !== 'shop') return;
    const p = this.playerOf(socket, room);
    if (!p?.char) return;
    const r = buySlot(room.game, p.playerId, p.char.id, msg.slotId, mathRng);
    if (r.ok) {
      this.pushLog(room, `【${p.name}】${r.text}`);
      this.broadcastRun(room, 'map');
    } else {
      this.io.to(p.socketId).emit(S2C.err, { text: r.err });
    }
    this.broadcastPersonal(room);
  }

  shopRefresh(socket: Socket): void {
    const room = this.roomOf(socket);
    if (!room?.game || room.pendingPersonal?.kind !== 'shop') return;
    const p = this.playerOf(socket, room);
    if (!p) return;
    const r = shopRefresh(room.game, p.playerId, mathRng);
    if (r.ok) {
      this.pushLog(room, `【${p.name}】${r.text}`);
      this.broadcastRun(room, 'map');
    } else {
      this.io.to(p.socketId).emit(S2C.err, { text: r.err });
    }
    this.broadcastPersonal(room);
  }

  shopHaggle(socket: Socket): void {
    const room = this.roomOf(socket);
    if (!room?.game || room.pendingPersonal?.kind !== 'shop') return;
    const p = this.playerOf(socket, room);
    if (!p) return;
    const r = shopHaggle(room.game, p.playerId, mathRng);
    if (r.ok) {
      this.pushLog(room, `【${p.name}】${r.text}`);
    } else {
      this.io.to(p.socketId).emit(S2C.err, { text: r.err });
    }
    this.broadcastPersonal(room);
  }

  shopSell(socket: Socket, msg: { itemId: string; potion?: boolean }): void {
    const room = this.roomOf(socket);
    if (!room?.game || room.pendingPersonal?.kind !== 'shop') return;
    const p = this.playerOf(socket, room);
    if (!p?.char) return;
    const r = shopSell(room.game, p.playerId, p.char.id, msg.itemId, !!msg.potion);
    if (r.ok) {
      this.pushLog(room, `【${p.name}】${r.text}`);
      this.broadcastRun(room, 'map');
    } else {
      this.io.to(p.socketId).emit(S2C.err, { text: r.err });
    }
    this.broadcastPersonal(room);
  }

  // 抢商店：玩家在商店界面点按钮主动发起全员投票（新手村且本局未抢过）
  shopRobRequest(socket: Socket): void {
    const room = this.roomOf(socket);
    const g = room?.game;
    if (!room || !g || room.pendingPersonal?.kind !== 'shop') return;
    if (room.vote) return; // 已有投票进行中
    if (g.run.dungeonId !== 'starterVillage' || g.run.robbedShop) return;
    const p = this.playerOf(socket, room);
    if (!p) return;
    const nodeId = g.pendingNodeId ?? '';
    this.startVote(room, 'shopRob', '抢商店？', [
      { id: 'no', label: '不抢，正常交易', desc: '按原价 / 砍价 / 刷新正常逛摊' },
      { id: 'yes', label: '抢！进BOSS战（袁绍）', desc: '击败袁绍后本摊所有商品价格变为 0；但本局其余行商节点将不再进货' },
    ], '全员提交后推进；若选择不同则随机采纳一名玩家的选择。',
      (choiceId) => {
        if (choiceId === 'yes') {
          this.pushLog(room, `【${p.name}】发起抢商店，全员决定开抢！进入 BOSS 战（袁绍）`);
          this.startRobBattle(room, nodeId);
        } else {
          this.pushLog(room, `【${p.name}】发起抢商店，全员决定不抢，正常交易。`);
        }
      });
  }

  tradePick(socket: Socket, msg: { itemId: string }): void {
    const room = this.roomOf(socket);
    if (!room?.game || room.pendingPersonal?.kind !== 'trade') return;
    const p = this.playerOf(socket, room);
    if (!p?.char) return;
    const r = tradePick(room.game, p.playerId, p.char.id, msg.itemId, mathRng);
    if (r.ok) {
      this.pushLog(room, `【${p.name}】${r.text}`);
    } else {
      this.io.to(p.socketId).emit(S2C.err, { text: r.err });
    }
    this.broadcastPersonal(room);
  }

  recruitPick(socket: Socket, msg: { candidateId: string }): void {
    const room = this.roomOf(socket);
    if (!room?.game || room.pendingPersonal?.kind !== 'recruit') return;
    const p = this.playerOf(socket, room);
    if (!p?.char) return;
    const r = recruitPick(room.game, p.playerId, p.char.id, msg.candidateId);
    if (r.ok) {
      this.pushLog(room, r.text);
    } else {
      this.io.to(p.socketId).emit(S2C.err, { text: r.err });
    }
    this.broadcastPersonal(room);
  }

  // 个人节点完成声明：全员完成后推进
  nodeDone(socket: Socket): void {
    const room = this.roomOf(socket);
    if (!room?.game || !room.pendingPersonal) return;
    const p = this.playerOf(socket, room);
    if (!p) return;
    room.pendingPersonal.done.add(p.playerId);
    this.pushLog(room, `【${p.name}】完成操作`);
    const online = [...room.players.values()].filter((x) => x.online);
    if (room.pendingPersonal.done.size >= online.length) {
      room.pendingPersonal = undefined;
      resolvePendingNode(room.game);
      this.checkWinOrNext(room);
      return;
    }
    this.broadcastPersonal(room);
  }

  private playerOf(socket: Socket, room: Room): RoomPlayer | null {
    return [...room.players.values()].find((p) => p.socketId === socket.id) ?? null;
  }

  // 打开背包：下发本人角色的权威背包视图（对齐单人版面板）
  bagOpen(socket: Socket): void {
    const room = this.roomOf(socket);
    if (!room?.game) return;
    const p = this.playerOf(socket, room);
    if (!p?.char) return;
    const v = buildBagView(room.game, p.char.id);
    if (v) this.io.to(socket.id).emit(S2C.bagView, v);
  }

  // 穿戴藏品（服务端权威）：成功则回发背包视图 + 广播 HP/MP 变化
  bagEquip(socket: Socket, msg: { itemId: string }): void {
    const room = this.roomOf(socket);
    if (!room?.game) return;
    const p = this.playerOf(socket, room);
    if (!p?.char) return;
    const r = applyBagEquip(room.game, p.char, msg.itemId);
    if (!r.ok) {
      this.io.to(socket.id).emit(S2C.err, { text: r.err });
      return;
    }
    this.pushLog(room, `【${p.name}】为 ${p.char.name} 装备了藏品`);
    const v = buildBagView(room.game, p.char.id);
    if (v) this.io.to(socket.id).emit(S2C.bagView, v);
    this.broadcastRun(room, room.battle ? 'battle' : 'map');
  }

  // 卸下藏品
  bagUnequip(socket: Socket, msg: { slot: string }): void {
    const room = this.roomOf(socket);
    if (!room?.game) return;
    const p = this.playerOf(socket, room);
    if (!p?.char) return;
    const r = applyBagUnequip(room.game, p.char, msg.slot);
    if (!r.ok) {
      this.io.to(socket.id).emit(S2C.err, { text: r.err });
      return;
    }
    this.pushLog(room, `【${p.name}】为 ${p.char.name} 卸下了藏品`);
    const v = buildBagView(room.game, p.char.id);
    if (v) this.io.to(socket.id).emit(S2C.bagView, v);
    this.broadcastRun(room, room.battle ? 'battle' : 'map');
  }

  private applyEvent(room: Room, nodeId: string, choiceId: string): void {
    const g = room.game!;
    const players = this.playerList(room);
    const r = applyEventChoice(g, players, choiceId, mathRng);
    for (const t of r.texts) this.pushLog(room, t);
    // 多步事件（事不过四）：停留事件界面——先分配本次掉落，再重新进入下一步投票
    if (r.stay) {
      if (g.lootPool.length > 0) {
        this.broadcastRun(room, 'loot');
        this.startLootVote(room, () => this.rebroadcastEvent(room, nodeId));
        return;
      }
      this.rebroadcastEvent(room, nodeId);
      return;
    }
    // 重返家园：指定稀有度王牌候选 → 每人独立招募流程
    if (r.recruitRarity) {
      initRecruit(g, players, mathRng, r.recruitRarity);
      room.pendingPersonal = { kind: 'recruit', done: new Set() };
      this.broadcastRun(room, 'map');
      this.broadcastPersonal(room);
      return;
    }
    // 事件触发战斗：按关卡名找关卡
    if (r.battleStageId) {
      const stage = findStage(g.save.customStages, r.battleStageId);
      if (!stage) {
        this.pushLog(room, `事件触发战斗（${r.battleStageId}）未找到关卡，自动跳过`);
      } else {
        this.startBattle(room, nodeId, { id: nodeId, kind: 'encounter', row: 0, cols: 0 } as MapNode, stage);
        return;
      }
    }
    // 事件产生遗物/藏品 → 先全员分配
    if (g.lootPool.length > 0) {
      this.broadcastRun(room, 'loot');
      this.startLootVote(room, () => {
        resolvePendingNode(g);
        this.checkWinOrNext(room);
      });
      return;
    }
    resolvePendingNode(g);
    this.checkWinOrNext(room);
  }

  // 多步事件：重新广播当前事件界面并开启下一步投票（applyEventChoice 在 stay 时保留 pendingEvent）
  private rebroadcastEvent(room: Room, nodeId: string): void {
    const g = room.game!;
    const ev = g.pendingEvent;
    if (!ev) {
      resolvePendingNode(g);
      this.checkWinOrNext(room);
      return;
    }
    this.broadcastRun(room, 'event');
    this.broadcastRoom(room, S2C.eventView, {
      name: ev.name,
      text: ev.text,
      options: ev.options.map((o) => ({ id: o.id, text: o.text, hint: o.hint })),
    });
    this.startVote(room, 'event', ev.name, ev.options.map((o) => ({ id: o.id, label: o.text, desc: o.hint })), ev.text,
      (choiceId) => this.applyEvent(room, nodeId, choiceId));
  }

  private startBattle(room: Room, nodeId: string, node: MapNode, stage: StageDef): void {
    const g = room.game!;
    g.battleNodeId = nodeId;
    g.currentStage = stage;
    this.broadcastRun(room, 'battle');
    let bh: BattleHost;
    const players = this.playerList(room);
    bh = new BattleHost(g, players, {
      broadcast: () => {
        for (const p of players) {
          this.io.to(room.players.get(p.playerId)?.socketId ?? '').emit(S2C.battleView, bh.viewFor(p.playerId));
        }
      },
      onEnd: (result, survivors) => this.onBattleEnd(room, nodeId, node, stage, result, survivors),
      log: (t) => this.pushLog(room, t),
    }, stage, mathRng);
    room.battle = bh;
    bh.start();
  }

  private startRobBattle(room: Room, nodeId: string): void {
    const g = room.game!;
    const yuan = g.monsterMap.get('yuanShao');
    if (!yuan) {
      this.pushLog(room, '袁绍数据缺失（房主存档中未找到 yuanShao），无法抢商店，正常交易。');
      return;
    }
    const stage: StageDef = {
      id: `rob_${nodeId}`,
      name: '抢商店 · 袁绍',
      dungeon: g.run.dungeonId,
      difficulty: 'boss',
      monsters: [{ monsterId: 'yuanShao', count: 1 }],
      mechanics: [],
      rows: 1,
      cols: 1,
      bossIds: ['yuanShao'],
    };
    this.startBattle(room, nodeId, { id: nodeId, kind: 'merchant', row: 0, cols: 0 } as MapNode, stage);
  }

  private onBattleEnd(room: Room, nodeId: string, node: MapNode, stage: StageDef, result: 'win' | 'lose', survivors: { id: string; hp: number; mp: number }[]): void {
    const g = room.game!;
    room.battle = undefined;
    g.battleNodeId = undefined;
    if (result === 'lose') {
      const players = this.playerList(room);
      const res = abortRun(g, players);
      room.phase = 'done';
      this.pushLog(room, res.reason);
      this.broadcastRoom(room, S2C.result, res as ResultView);
      return;
    }
    // 胜利：先回写 HP/MP
    applyBattleHpMpOnly(g, survivors);
    // 抢商店 BOSS 战：胜利 → 本摊全 0 + 本局 robbedShop；不结算掉落、不推进节点（回货摊免费扫货）
    if (stage.id.startsWith('rob_')) {
      g.run.robbedShop = true;
      for (const st of Object.values(g.shopState)) st.robbed = true;
      this.pushLog(room, '击败袁绍！货摊已被洗劫，所有商品一律免费（本局其余行商节点不再进货）。');
      this.broadcastRun(room, 'map');
      this.broadcastPersonal(room);
      return;
    }
    const players = this.playerList(room);
    // 狭路相逢：奖励一人一份（各玩家独立结算），不走普通战斗掉落
    if (node.kind === 'skirmish') {
      const tier = room.skirmishTier ?? 1;
      for (const t of skirmishPerPlayerRewards(g, players, tier, mathRng)) this.pushLog(room, t);
      room.skirmishTier = undefined;
      resolvePendingNode(g);
      this.checkWinOrNext(room);
      return;
    }
    const { pool, texts } = buildCombatRewards(g, players, node, stage, mathRng);
    for (const t of texts) this.pushLog(room, t);
    if (pool.length > 0) {
      // buildCombatRewards 已将 pool 写入 game.lootPool；直接沿用（避免 push 自复制翻倍）
      g.lootPool = pool;
      this.broadcastRun(room, 'loot');
      this.startLootVote(room, () => {
        resolvePendingNode(g);
        this.checkWinOrNext(room);
      });
      return;
    }
    resolvePendingNode(g);
    this.checkWinOrNext(room);
  }

  private startLootVote(room: Room, then: () => void): void {
    const g = room.game!;
    const players = this.playerList(room);
    const options = g.lootPool.slice(0, players.length).map((l) => ({
      id: l.key,
      label: l.label,
      desc: l.kind === 'relic' ? '遗物（独享）' : `藏品（${l.rarity ?? ''}）`,
    }));
    if (options.length === 0) { then(); return; }
    this.startVote(room, 'loot', '分配掉落（每人选一件）', options,
      '每个玩家选择想要的一件；多人选同一件时随机一人获得，其余玩家从剩余掉落中随机补得。',
      (_choiceId, submissions) => {
        // 全员已选：先广播"正在随机分配"，延迟 1.5s 公布分配结果
        this.broadcastRoom(room, S2C.voteResult, { choiceId: '', title: '分配掉落', submissions, rolling: true });
        setTimeout(() => {
          try {
            const { texts } = resolveLootVote(g, players, submissions, mathRng);
            for (const t of texts) this.pushLog(room, t);
            then();
          } catch (e) {
            console.log('[loot:error]', String(e));
            this.broadcastRoom(room, S2C.err, { text: `掉落结算出错：${String(e)}` });
            this.broadcastRun(room, 'map');
            this.startMoveVote(room);
          }
        }, 1500);
      });
  }

  private checkWinOrNext(room: Room): void {
    const g = room.game!;
    if (g.run.result === 'win') { this.doFinish(room); return; }
    this.broadcastRun(room, 'map');
    this.startMoveVote(room);
  }

  private doFinish(room: Room): void {
    const g = room.game!;
    const players = this.playerList(room);
    const res = finishRun(g, players);
    room.phase = 'done';
    for (const t of g.logs) this.pushLog(room, t);
    this.broadcastRoom(room, S2C.result, res);
  }

  // ---------- 战斗指令 ----------
  battleAct(socket: Socket, action: never): void {
    const room = this.roomOf(socket);
    if (!room?.battle) return;
    const playerId = [...room.players.values()].find((p) => p.socketId === socket.id)?.playerId;
    if (!playerId) return;
    room.battle.onAct(playerId, action as never);
  }

  battleResolve(socket: Socket, msg: never): void {
    const room = this.roomOf(socket);
    if (!room?.battle) return;
    const playerId = [...room.players.values()].find((p) => p.socketId === socket.id)?.playerId;
    if (!playerId) return;
    room.battle.onResolve(playerId, msg as never);
  }

  // 状态同步：客户端切视图后主动请求当前副本/战斗状态（防错过初始广播）
  runSync(socket: Socket): void {
    const room = this.roomOf(socket);
    if (!room?.game) return;
    const p = [...room.players.values()].find((x) => x.socketId === socket.id);
    if (!p) return;
    this.io.to(socket.id).emit(S2C.runState, runView(room.game, this.playerList(room), room.battle ? 'battle' : 'map'));
    if (room.battle) {
      this.io.to(socket.id).emit(S2C.battleView, room.battle.viewFor(p.playerId));
    }
  }

  // 清理离开房间（房主离开则房间解散）
  onDisconnect(socket: Socket): void {
    this.leave(socket);
    for (const room of this.rooms.values()) {
      const online = [...room.players.values()].filter((p) => p.online);
      if (online.length === 0) {
        room.battle?.destroy();
        this.rooms.delete(room.id);
        for (const pid of room.players.keys()) this.playerRoom.delete(pid);
      }
    }
  }
}
