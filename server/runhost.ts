// 联机副本托管：服务器权威持有整局 Run，处理地图/事件/掉落/结算（纯逻辑，无 socket 依赖）
import type { Character, Equip, EventDef, ExtraKey, Item, MapNode, MonsterUnit, Party, Rng, RunState, SaveData, StageDef } from '../src/types';
import { mathRng } from '../src/types';
import {
  applyBattleHpMp, availableNodes, currentMap, findNode, INITIAL_RUN_RELICS,
  plagueLetterHpDown, resolveNode, rollTorchDrop, startCalamityRun, startRun, TORCH_CAP,
} from '../src/engine/run';
import { applyEventOption, rollEvent, markEventSeen } from '../src/engine/events';
import {
  resolveDrop, rollFixedDrops, rollLuckyDrops, rollStageDrop,
  type DropContext, type DropReward,
} from '../src/engine/drops';
import { buildAllyCombatant, buildEnemyCombatants } from '../src/engine/unit';
import {
  BASE_TEMPLATE, characterLuck, collectExtraBonus, collectPassives, computeStats, crystalStacksOf,
  equippedIds, outerStats, relicPanelBonus,
} from '../src/engine/stats';
import {
  haggleLabel, haggleRoll, merchantSellPrice, potionSellPrice, rollAceCandidatesByRarity, rollMerchantShop,
  shopFreeCount, shopFreeSlotIndices, shopPriceMul, executeTrade, skirmishRewards, tradeItemPool, upgradeRarity,
} from '../src/engine/nodes';
import { ACE_UNITS, ACE_UNIT_MAP, ACE_UNITS_BY_RARITY } from '../src/data/aceUnits';
import { itemMapOf } from '../src/data/content';
import { DEFAULT_MONSTERS } from '../src/data/monsters';
import { DEFAULT_STAGES } from '../src/data/stages';
import { RELICS, RELIC_MAP, sumRelicSixStats } from '../src/data/relics';
import { DUNGEONS } from '../src/data/dungeons';
import { allEvents } from '../src/data/events';
import { JOB_DEFS } from '../src/data/jobs';
import { bonusLines } from '../src/ui/labels';
import type { BagItemBrief, BagView, DataPack, PlayerView, RunView } from '../src/net/proto';

export type { DataPack } from '../src/net/proto';

export interface PlayerChar {
  playerId: string;
  name: string;
  char: Character;
}

// 待投票分配的掉落物（藏品/遗物）
export interface LootItem {
  key: string;
  kind: 'item' | 'relic';
  itemId?: string;
  relicId?: string;
  label: string;
  rarity?: string;
}

export interface GameState {
  save: SaveData;
  run: RunState;
  itemMap: Map<string, Item>;
  monsterMap: Map<string, MonsterUnit>;
  perRelics: Record<string, string[]>; // charId -> 独享遗物（含初始生命/魔力水晶）
  perRelicStacks: Record<string, Record<string, number>>; // charId -> relicId -> 层数
  perItems: Record<string, string[]>; // charId -> 联机获得藏品
  perMaterials: Record<string, { itemId: string; count: number }[]>; // charId -> 材料
  perAce: Record<string, string>; // charId -> 该玩家招募的王牌单位 id（0/1 个）
  perCoins: Record<string, number>; // playerId -> 个人独立哈哈币（掉落/商店/结算按此结算）
  lootPool: LootItem[];
  logs: string[];
  pendingEvent?: EventDef;
  eventFloor?: number;
  battleNodeId?: string;
  pendingNodeId?: string; // 进入的节点：战斗/事件结算完成后统一推进
  currentStage?: StageDef;
  shopState: Record<string, ShopState>; // playerId -> 独立商店
  tradeState: Record<string, TradeState>; // playerId -> 独立失与得
  recruitState: Record<string, RecruitState>; // playerId -> 独立王牌招募
}

// 独立商店：每人按自己角色数据生成
export interface ShopSlot {
  id: string;
  kind: 'item' | 'relic' | 'material';
  itemId?: string;
  relicId?: string;
  label: string;
  price: number;
  rarity?: string;
  count?: number;
}
export interface ShopState {
  charId: string; // 该商店属于哪个传奇角色
  slots: ShopSlot[];
  bought: string[]; // 已购买 slot.id
  haggle?: { total: number; roll: number; discountPct: number }; // 砍价结果（每摊一次）
  robbed?: boolean; // 本摊已被洗劫（价格全 0）
  refreshCount: number; // 已刷新次数
  refreshed: boolean;
}

// 独立失与得：每人从自己已拥有藏品中交换
export interface TradeState {
  offers: { itemId: string; name: string; rarity: string }[]; // 可交换的藏品
  exchangeCount: number; // 已交换次数（灾厄上限 2）
  picked?: string; // 本次选择
}

// 独立王牌招募：每人 3 个王牌候选
export interface RecruitState {
  candidates: { id: string; name: string; rarity?: string; icon?: string; hp: number; atk: number; def: number }[];
  picked?: string;
}

export function emptySave(characters: Character[], dataPack: DataPack): SaveData {
  const arr: (Character | null)[] = [...characters];
  while (arr.length < 12) arr.push(null);
  return {
    version: 1,
    characters: arr,
    customItems: dataPack.items,
    customMonsters: dataPack.monsters.length > 0 ? dataPack.monsters : DEFAULT_MONSTERS.map((m) => structuredClone(m)),
    customStages: dataPack.stages.length > 0 ? dataPack.stages : DEFAULT_STAGES.map((s) => structuredClone(s)),
    materials: [],
    coinsInStorage: 0,
    party: null,
    activeRun: null,
    monsterSeed: 0,
    stageSeed: 0,
  };
}

// 联机 char 轻量补全：前端发送的完整角色走 loadSave（字段齐全）；对缺失字段的半截 char 补默认，
// 防止 buildAllyCombatant 读 undefined.map / undefined.weapon 等导致开局崩溃。
// 注意：必须原地补全（mutate 同一引用）——game.save.characters 与 room.players[].char 共享同一对象，
// 若返回新对象会造成"装备/库存改动在原对象、背包面板读副本"的对象分裂
function normalizeChar(c: Character): Character {
  c.job = (c.job && c.job in JOB_DEFS) ? c.job : 'cat';
  if (c.level === undefined || c.level === null) c.level = 1;
  if (!c.stats) c.stats = { hp: 500, mp: 50, atk: 50, def: 30, mres: 15, spdMin: 1, spdMax: 2 };
  if (!c.extra) c.extra = {};
  if (!c.baseExtra) c.baseExtra = { ...c.extra };
  if (!Array.isArray(c.skills)) c.skills = [];
  if (!Array.isArray(c.items)) c.items = [];
  if (!Array.isArray(c.relics)) c.relics = [];
  if (!Array.isArray(c.inventory)) c.inventory = [];
  if (!Array.isArray(c.bag)) c.bag = [];
  if (!Array.isArray(c.storage)) c.storage = [];
  if (!c.equip) c.equip = { weapon: '', helmet: '', armor: '', boots: '', accessory: [] };
  if (!c.skillLevels) c.skillLevels = {};
  if (!Array.isArray(c.titles)) c.titles = [];
  if (!Number.isFinite(c.coins)) c.coins = 0;
  if (!Number.isFinite(c.exp)) c.exp = 0;
  return c;
}

// 创建一局灾厄泰拉：每个玩家一个角色，房主为队长
export function createGame(players: PlayerChar[], dataPack: DataPack, rng: Rng = mathRng, dungeonId: string = 'preWallCalamity'): GameState {
  const chars = players.map((p) => normalizeChar(p.char));
  const save = emptySave(chars, dataPack);
  const itemMap = itemMapOf(save);
  const stages = save.customStages;
  const monsterMap = new Map(save.customMonsters.map((m) => [m.id, m]));
  const memberIds = chars.map((c) => c.id);
  const party: Party = {
    leaderId: chars[0]!.id,
    memberIds,
    deployedIds: memberIds,
  };
  // 各角色满状态进入（按初始遗物：生命水晶1层/魔力水晶0层）
  const initialHpMp: Record<string, { hp: number; mp: number }> = {};
  chars.forEach((c, i) => {
    const b = buildAllyCombatant(c, itemMap, i, {
      relics: [...INITIAL_RUN_RELICS],
      relicStacks: { rl_life_crystal: 1, rl_mana_crystal: 0 },
    });
    initialHpMp[c.id] = { hp: b.maxHp, mp: b.maxMp };
  });
  const pooledCoins = chars.reduce((s, c) => s + Math.max(0, Math.floor(c.coins ?? 0)), 0);
  // 副本选择：新手村（终局联系）用普通 7 层地图；灾厄泰拉用灾厄地图（无需自适应难度）
  const run = dungeonId === 'starterVillage'
    ? startRun({ party, stages, rng, initialHpMp, pooledCoins, now: Date.now() })
    : startCalamityRun({ party, stages, rng, initialHpMp, pooledCoins, now: Date.now() });
  // 联机遗物完全 per-player：队伍 run.relics 清空，初始生命/魔力水晶入各角色
  run.relics = [];
  run.relicStacks = {};
  const perRelics: Record<string, string[]> = {};
  const perRelicStacks: Record<string, Record<string, number>> = {};
  const perItems: Record<string, string[]> = {};
  const perMaterials: Record<string, { itemId: string; count: number }[]> = {};
  const perAce: Record<string, string> = {};
  const perCoins: Record<string, number> = {};
  for (const p of players) {
    const c = p.char;
    perRelics[c.id] = [...INITIAL_RUN_RELICS];
    perRelicStacks[c.id] = { rl_life_crystal: 1, rl_mana_crystal: 0 };
    perItems[c.id] = [];
    perMaterials[c.id] = [];
    perCoins[p.playerId] = Math.max(0, Math.floor(c.coins ?? 0)); // 每人独立哈哈币：各自角色带入
  }
  // run.coins 仅作队伍总币展示（= Σ 个人币）
  run.coins = Object.values(perCoins).reduce((s, n) => s + n, 0);
  return {
    save, run, itemMap, monsterMap, perRelics, perRelicStacks, perItems, perMaterials, perAce, perCoins,
    lootPool: [], logs: [],
    shopState: {}, tradeState: {}, recruitState: {},
  };
}

// 玩家拥有的遗物集合（个人独享；联机不再有队伍遗物）
export function relicsOf(game: GameState, charId: string): string[] {
  return game.perRelics[charId] ?? [];
}
export function relicStacksOf(game: GameState, charId: string): Record<string, number> {
  return game.perRelicStacks[charId] ?? {};
}

// 角色六维值（事件六维判定：队长六维 + 装备 extraBonus + 遗物六维，与单人版同源）
function charStat(game: GameState, c: Character, key: string): number {
  const k = key as ExtraKey;
  const equipped = equippedIds(c.equip)
    .map((id) => game.itemMap.get(id))
    .filter((x): x is Item => !!x);
  const relicSix = sumRelicSixStats(game.perRelics[c.id] ?? []);
  return (c.extra?.[k] ?? 10) + (collectExtraBonus(equipped)[k] ?? 0) + (relicSix[k] ?? 0);
}

export function runView(game: GameState, players: PlayerChar[], phase: RunView['phase']): RunView {
  const run = game.run;
  const map = currentMap(run);
  const atId = run.at && map.nodes.some((n) => n.id === run.at) ? run.at : null;
  return {
    dungeonId: run.dungeonId,
    dungeonName: DUNGEONS.find((d) => d.id === run.dungeonId)?.name ?? run.dungeonId,
    act: run.act,
    actLabel: run.act === 'sub' ? (run.sublayerName ?? '子层') : `第 ${run.act} 层`,
    nodes: map.nodes,
    edges: map.edges,
    openedEdges: run.openedEdges ?? [],
    cols: map.cols,
    rows: map.rows,
    currentNodeId: atId,
    available: availableNodes(run).map((n) => n.id),
    cleared: run.cleared,
    nodeStates: run.nodeStates ?? {},
    hpMp: run.hpMp,
    coins: run.coins,
    torches: run.torches,
    relics: run.relics,
    perRelics: game.perRelics,
    perItems: game.perItems,
    perMaterials: game.perMaterials,
    bindings: Object.fromEntries(players.map((p) => [p.playerId, p.char.id])),
    phase,
    logs: game.logs.slice(-20),
  };
}

// 进入节点后的决策
export type NodeDecision =
  | { kind: 'battle'; nodeId: string; node: MapNode; stage: StageDef }
  | { kind: 'event'; nodeId: string }
  | { kind: 'rest'; nodeId: string }
  | { kind: 'shop'; nodeId: string }
  | { kind: 'trade'; nodeId: string }
  | { kind: 'recruit'; nodeId: string }
  | { kind: 'skirmish'; nodeId: string }
  | { kind: 'skip'; nodeId: string };

export function decideNode(game: GameState, nodeId: string): NodeDecision {
  const found = findNode(game.run, nodeId);
  const node = found?.node;
  if (!node) return { kind: 'skip', nodeId };
  switch (node.kind) {
    case 'combat':
    case 'boss': {
      const stage = node.stageId
        ? game.save.customStages.find((s) => s.id === node.stageId)
        : undefined;
      if (!stage) return { kind: 'skip', nodeId };
      return { kind: 'battle', nodeId, node, stage };
    }
    case 'encounter':
      return { kind: 'event', nodeId };
    case 'rest':
      return { kind: 'rest', nodeId };
    case 'merchant':
      return { kind: 'shop', nodeId };
    case 'trade':
      return { kind: 'trade', nodeId };
    case 'recruit':
      return { kind: 'recruit', nodeId };
    case 'skirmish':
      return { kind: 'skirmish', nodeId };
    default:
      return { kind: 'skip', nodeId };
  }
}

// 战斗结算后按各玩家角色构建掉落（联机 v2 规则）：
// - 固定掉落 + 归一表：币每人一份（×人数入队伍池）、材料每人一份、藏品/遗物进投票池
// - 普通作战：每人按自身幸运判定遗物（概率 20%+幸运/2%，仅刷自己未拥有的遗物）→ 直接入个人
// - 紧急/BOSS 额外掉落：按人数出 N 件「全员都未拥有」的遗物 → 投票池由玩家选择
// - 强化石每人 1 个；火把按关卡规则（队伍资源）
export function buildCombatRewards(
  game: GameState,
  players: PlayerChar[],
  node: MapNode,
  stage: StageDef,
  rng: Rng,
): { pool: LootItem[]; texts: string[] } {
  const run = game.run;
  const n = players.length;
  const ctx: DropContext = {
    items: [...game.itemMap.values()],
    relics: RELICS,
    owned: new Set(run.relics),
  };
  const pool: LootItem[] = [];
  const texts: string[] = [];
  let k = 0;
  const key = () => `lp_${k++}`;
  const addMat = (charId: string, itemId: string, count: number) => {
    const list = game.perMaterials[charId] ?? (game.perMaterials[charId] = []);
    const f = list.find((m) => m.itemId === itemId);
    if (f) f.count += count;
    else list.push({ itemId, count });
  };
  const poolItem = (it: Item) => pool.push({ key: key(), kind: 'item', itemId: it.id, label: it.name, rarity: it.rarity });
  const poolRelic = (rl: { id: string; name: string; rarity: string }) => pool.push({ key: key(), kind: 'relic', relicId: rl.id, label: rl.name, rarity: rl.rarity });
  const addCoin = (c: number) => { for (const p of players) gainCoins(game, p.playerId, c); }; // 币一人一份（各入自己口袋）
  // 藏品候选：去重收集，供按人数凑 n 件不同物品进池
  const itemCands: Item[] = [];
  const candSeen = new Set<string>();
  const pushCand = (it: Item) => { if (!candSeen.has(it.id)) { candSeen.add(it.id); itemCands.push(it); } };

  const fixed = rollFixedDrops(stage, ctx, rng);
  addCoin(fixed.coins);
  for (const m of fixed.materials) for (const p of players) addMat(p.char.id, m.item.id, m.count);
  const stageDrop = rollStageDrop(stage, ctx, rng);
  for (const it of fixed.items) pushCand(it);
  if (stageDrop && (stageDrop.kind === 'item' || stageDrop.kind === 'consumable')) pushCand(stageDrop.item);
  if (stageDrop?.kind === 'coin') addCoin(stageDrop.count);
  else if (stageDrop?.kind === 'material') { for (const p of players) addMat(p.char.id, stageDrop.item.id, stageDrop.item.count ?? 1); }
  else if (stageDrop?.kind === 'relic') { poolRelic(stageDrop.relic); ctx.owned?.add(stageDrop.relic.id); }
  else if (stageDrop?.kind === 'torch') { run.torches = Math.min(TORCH_CAP, run.torches + stageDrop.count); texts.push(`掉落 ${stageDrop.count} 根火把（共享）`); }
  for (const rl of fixed.relics) { poolRelic(rl); ctx.owned?.add(rl.id); }

  if (run.dungeonId === 'preWallCalamity') {
    // 藏品按人数出：凑 n 件不同物品（不足时从掉落池补，避免同件重复入池）
    if (itemCands.length < n) {
      for (let t = 0; t < 30 && itemCands.length < n; t++) {
        const r = resolveDrop('item', 'pool', { ...ctx, owned: candSeen }, rng, {});
        if (r && (r.kind === 'item' || r.kind === 'consumable')) pushCand(r.item);
      }
    }
    for (let i = 0; i < n && i < itemCands.length; i++) poolItem(itemCands[i]);
    const weights = { uncommon: 40, fine: 30, rare: 20, epic: 10 };
    const luckOf = (p: PlayerChar) =>
      characterLuck(p.char, game.itemMap) + sumRelicSixStats(game.perRelics[p.char.id] ?? []).luk;
    // 普通作战：每人独立幸运判定，仅刷自己未拥有
    if (!node.urgent && node.kind !== 'boss') {
      for (const p of players) {
        const luck = luckOf(p);
        if (rng.int(1, 100) > 20 + luck / 2) continue;
        const owned = new Set(game.perRelics[p.char.id] ?? []);
        let r = resolveDrop('relic', 'pool', { ...ctx, owned }, rng, { rarityWeights: weights });
        if (!r) {
          const rest = RELICS.filter((x) => x.inPool !== false && !owned.has(x.id));
          if (rest.length > 0) r = { kind: 'relic', relic: rest[rng.int(0, rest.length - 1)] };
        }
        if (r?.kind === 'relic') {
          game.perRelics[p.char.id].push(r.relic.id);
          texts.push(`【${p.name}】因幸运（${luck}）获得遗物《${r.relic.name}》`);
          texts.push(...applyRelicPickupEffects(game, [r.relic.id]));
        }
      }
    } else {
      // 紧急/BOSS 额外掉落：按人数出 N 件全员未拥有的遗物，进投票池供选择
      const allOwned = new Set(Object.values(game.perRelics).flat());
      const avail = RELICS.filter((x) => x.inPool !== false && !allOwned.has(x.id));
      const shuffled = [...avail].sort(() => rng.int(0, 1) - 0.5);
      const picked = shuffled.slice(0, n);
      for (const rl of picked) {
        poolRelic(rl);
        allOwned.add(rl.id);
      }
      texts.push(`紧急掉落：${picked.length} 件遗物进入选择池`);
    }
    // 强化石：每场每人 1 个
    const stoneRoll = rng.int(1, 100);
    const stoneId = stoneRoll <= 60 ? 'it_stone_rare' : stoneRoll <= 90 ? 'it_stone_epic' : 'it_stone_legendary';
    for (const p of players) addMat(p.char.id, stoneId, 1);
  } else {
    // 新手村等非灾厄：普通作战每人按自己幸运 + 1D50 判定（遗物直接进自己独享）；
    // 紧急/BOSS：按人数出 N 件全员未拥有的遗物进投票池自由选择
    const isBoss = node.kind === 'boss' || !!node.urgent;
    if (isBoss) {
      const allOwned = new Set(Object.values(game.perRelics).flat());
      const avail = RELICS.filter((x) => x.inPool !== false && !allOwned.has(x.id));
      const shuffled = [...avail].sort(() => rng.int(0, 1) - 0.5);
      const picked = shuffled.slice(0, n);
      for (const rl of picked) {
        poolRelic(rl);
        allOwned.add(rl.id);
      }
      if (picked.length > 0) texts.push(`紧急掉落：${picked.length} 件遗物进入选择池`);
    } else {
      for (const p of players) {
        const luck = characterLuck(p.char, game.itemMap) + sumRelicSixStats(game.perRelics[p.char.id] ?? []).luk;
        for (const l of rollLuckyDrops(stage, luck, { ...ctx, owned: new Set(game.perRelics[p.char.id] ?? []) }, rng)) {
          if (!l.success || !l.reward) continue;
          const r = l.reward;
          if (r.kind === 'relic') {
            game.perRelics[p.char.id].push(r.relic.id);
            texts.push(`【${p.name}】幸运判定 ${l.total}（幸运 ${luck} + 1D50[${l.roll}]）通过，获得遗物《${r.relic.name}》`);
            texts.push(...applyRelicPickupEffects(game, [r.relic.id]));
          } else if (r.kind === 'item' || r.kind === 'consumable') {
            pushCand(r.item);
          } else if (r.kind === 'coin') {
            addCoin(r.count);
          } else if (r.kind === 'material') {
            for (const q of players) addMat(q.char.id, r.item.id, r.item.count ?? 1);
          } else if (r.kind === 'torch') {
            run.torches = Math.min(TORCH_CAP, run.torches + r.count);
            texts.push(`掉落 ${r.count} 根火把（共享）`);
          }
        }
      }
    }
    // 藏品按人数凑 n 件不同物品进池（不足时从掉落池补，避免同件重复）
    if (itemCands.length < n) {
      for (let t = 0; t < 30 && itemCands.length < n; t++) {
        const r = resolveDrop('item', 'pool', { ...ctx, owned: candSeen }, rng, {});
        if (r && (r.kind === 'item' || r.kind === 'consumable')) pushCand(r.item);
      }
    }
    for (let i = 0; i < n && i < itemCands.length; i++) poolItem(itemCands[i]);
  }

  if (rollTorchDrop(node, rng, run.dungeonId)) {
    run.torches = Math.min(TORCH_CAP, run.torches + 1);
    texts.push('掉落 1 根火把');
  }
  game.lootPool = pool;
  return { pool, texts };
}

// 掉落投票裁决（每人一件；撞车随机一人获得，剩余未选/落选者从剩余池随机补一件，池空补金币）
export function resolveLootVote(
  game: GameState,
  players: PlayerChar[],
  submissions: Record<string, string>,
  rng: Rng,
): { texts: string[] } {
  const pool = [...game.lootPool];
  const candidates = pool.slice(0, players.length);
  const rest = pool.slice(players.length);
  const winnerOf = new Map<string, LootItem>();
  const unassigned = new Set(candidates.map((c) => c.key));
  const pickerOf = new Map<string, string[]>(); // lootKey -> playerIds（第一志愿）
  for (const p of players) {
    const key = submissions[p.playerId];
    const cand = candidates.find((c) => c.key === key) ?? candidates[0];
    if (!cand) continue;
    const list = pickerOf.get(cand.key) ?? [];
    list.push(p.playerId);
    pickerOf.set(cand.key, list);
  }
  // 逐候选：唯一志愿直接获得；多人撞车随机一人获得
  for (const [lkey, pids] of pickerOf) {
    if (unassigned.has(lkey) && pids.length > 0) {
      const w = pids.length === 1 ? pids[0] : pids[rng.int(0, pids.length - 1)];
      const loot = candidates.find((c) => c.key === lkey)!;
      winnerOf.set(w, loot);
      unassigned.delete(lkey);
    }
  }
  // 落选者从剩余候选随机补一件
  for (const p of players) {
    if (winnerOf.has(p.playerId)) continue;
    const remain = candidates.filter((c) => unassigned.has(c.key));
    if (remain.length > 0) {
      const loot = remain[rng.int(0, remain.length - 1)];
      winnerOf.set(p.playerId, loot);
      unassigned.delete(loot.key);
    }
  }
  const texts: string[] = [];
  for (const p of players) {
    const loot = winnerOf.get(p.playerId);
    if (!loot) {
      gainCoins(game, p.playerId, 200);
      texts.push(`【${p.name}】未分配到掉落，补偿 200 哈哈币`);
      continue;
    }
    if (loot.kind === 'relic' && loot.relicId) {
      game.perRelics[p.char.id].push(loot.relicId);
      texts.push(`【${p.name}】获得遗物《${loot.label}》`);
      texts.push(...applyRelicPickupEffects(game, [loot.relicId]));
    } else if (loot.itemId) {
      game.perItems[p.char.id].push(loot.itemId);
      texts.push(`【${p.name}】获得藏品【${loot.label}】`);
    }
  }
  game.lootPool = rest;
  return { texts };
}

// 个人哈哈币增减（权威 perCoins；run.coins 同步为队伍总币展示）
export function gainCoins(game: GameState, playerId: string, n: number): void {
  game.perCoins[playerId] = Math.max(0, (game.perCoins[playerId] ?? 0) + Math.floor(n));
  game.run.coins = Object.values(game.perCoins).reduce((s, v) => s + Math.max(0, v), 0);
}

// 拾取遗物时应用"拾取效果"（单人同款）：火把统一进入共享资源，HP/MP 回复作用于全员
function applyRelicPickupEffects(game: GameState, relicIds: string[]): string[] {
  const texts: string[] = [];
  const run = game.run;
  const chars = (run.party.deployedIds ?? run.party.memberIds)
    .map((cid) => game.save.characters.find((c) => c?.id === cid))
    .filter((c): c is Character => !!c);
  for (const id of relicIds) {
    const def = RELIC_MAP[id];
    if (!def) continue;
    const eff = def.effect;
    if (eff.kind === 'torchOnPickup') {
      run.torches = Math.min(TORCH_CAP, (run.torches ?? 0) + eff.amount);
      texts.push(`遗物《${def.name}》：获得 ${eff.amount} 根火把（共享）`);
    } else if (eff.kind === 'torchHealOnPickup') {
      run.torches = Math.min(TORCH_CAP, (run.torches ?? 0) + eff.torch);
      texts.push(`遗物《${def.name}》：获得 ${eff.torch} 根火把（共享）`);
      healAllByPickup(game, chars, eff.hpPct, eff.mpPct, def.name, texts);
    } else if (eff.kind === 'healOnPickup') {
      healAllByPickup(game, chars, eff.hpPct, eff.mpPct, def.name, texts, eff.full);
    }
  }
  return texts;
}

function healAllByPickup(game: GameState, chars: Character[], hpPct?: number, mpPct?: number, relicName = '', texts: string[] = [], full = false): void {
  const run = game.run;
  for (const c of chars) {
    const b = buildAllyCombatant(c, game.itemMap, 0, {
      relics: [...(game.perRelics[c.id] ?? [])],
      relicStacks: game.perRelicStacks[c.id] ?? {},
      killBook: game.run.killBook,
      maxHpPctDown: plagueLetterHpDown(game.run),
    });
    const cur = run.hpMp[c.id] ?? { hp: b.maxHp, mp: b.maxMp };
    const hp = full ? b.maxHp : Math.min(b.maxHp, cur.hp + Math.ceil(b.maxHp * (hpPct ?? 0)));
    const mp = full ? b.maxMp : Math.min(b.maxMp, cur.mp + Math.ceil(b.maxMp * (mpPct ?? 0)));
    run.hpMp[c.id] = { hp, mp };
    texts.push(`遗物《${relicName}》：${c.name}回复至 HP ${hp}/${b.maxHp}、MP ${mp}/${b.maxMp}`);
  }
}

// 事件流程：抽取（服务器随机）
export function startEvent(game: GameState, nodeId: string, floor: number, rng: Rng): { texts: string[]; noEvent: boolean } {
  const ev = rollEvent(allEvents(game.save), game.run.dungeonId, floor, game.run, rng);
  if (!ev) return { texts: ['无可触发事件，直接通过节点'], noEvent: true };
  game.run = markEventSeen(game.run, floor, ev.id);
  game.run.eventStep = undefined;
  game.pendingEvent = ev;
  game.eventFloor = floor;
  return { texts: [], noEvent: false };
}

// 事件选项投票后应用结果：调用引擎 applyEventOption；新遗物/藏品转为投票池由全员分配
// 返回 stay（多步事件：保留事件界面继续下一步）、recruitRarity（重返家园：进入个人王牌招募）
export function applyEventChoice(
  game: GameState,
  players: PlayerChar[],
  optionId: string,
  rng: Rng,
): { texts: string[]; battleStageId?: string; battleUrgent?: boolean; stay?: boolean; recruitRarity?: 'rare' | 'epic' } {
  const ev = game.pendingEvent;
  if (!ev) return { texts: [] };
  const option = ev.options.find((o) => o.id === optionId);
  if (!option) return { texts: [] };
  const leader = players[0]!.char;
  const beforeRelics = [...game.run.relics];
  // 记录全部角色的库存快照：事件新增藏品（可能落在队长或其它角色背包）统一取出进投票池，由玩家选择归属
  const beforeInvByChar = new Map<string, string[]>();
  for (const c of game.save.characters) beforeInvByChar.set(c.id, [...(c.inventory ?? [])]);
  const coinsBefore = game.run.coins;
  const res = applyEventOption({
    save: game.save,
    run: game.run,
    option,
    rng,
    items: game.itemMap,
    leaderStatOf: (k) => charStat(game, leader, k),
    owner: leader.id,
  });
  game.run = res.run;
  game.save = res.save;
  // 事件金币变化：按"一人一份"均摊到各玩家个人币（扣币事件也全员共担）
  const coinDiff = game.run.coins - coinsBefore;
  if (coinDiff !== 0) {
    for (const p of players) gainCoins(game, p.playerId, coinDiff);
  }
  // 事件奖励遗物：固定遗物（选项写死的 relicId，如巨大龟壳/大房子/小房子）——事件判定（按队长属性）成功后，
  // 发放给全体玩家各一份（遗物独享）；随机池遗物（randomRelic）进投票池供全员选择
  const directRelicIds = new Set<string>();
  for (const r of option.outcome.rewards) {
    if (r.kind === 'relic') directRelicIds.add(r.relicId);
    if (r.kind === 'randomOne') for (const rr of r.rewards) if (rr.kind === 'relic') directRelicIds.add(rr.relicId);
  }
  for (const rid of res.run.relics.filter((r) => !beforeRelics.includes(r))) {
    game.run.relics = game.run.relics.filter((r) => r !== rid);
    const rel = RELICS.find((x) => x.id === rid);
    if (directRelicIds.has(rid)) {
      for (const p of players) game.perRelics[p.char.id].push(rid);
      res.texts.push(`【${leader.name}】事件判定成功：全体玩家各获得遗物《${rel?.name ?? rid}》（事件固定奖励）`);
      res.texts.push(...applyRelicPickupEffects(game, [rid]));
    } else {
      game.lootPool.push({ key: `ev_r_${rid}`, kind: 'relic', relicId: rid, label: rel?.name ?? rid, rarity: rel?.rarity });
    }
  }
  // 事件新增藏品（任意角色背包新增）→ 全部取出进投票池，供全员选择归属
  for (const c of game.save.characters) {
    const before = beforeInvByChar.get(c.id) ?? [];
    const gained = (c.inventory ?? []).filter((id) => !before.includes(id));
    if (gained.length === 0) continue;
    c.inventory = (c.inventory ?? []).filter((x) => !gained.includes(x));
    for (const it of gained) {
      const item = game.itemMap.get(it);
      game.lootPool.push({ key: `ev_i_${it}_${c.id}`, kind: 'item', itemId: it, label: item?.name ?? it, rarity: item?.rarity });
    }
  }
  // 多步事件（事不过四）：停留事件界面，继续下一步；不推进节点
  if (res.stay) return { texts: res.texts, stay: true };
  // 重返家园：指定稀有度王牌候选 → 每人独立招募流程
  if (res.recruitRarity) return { texts: res.texts, recruitRarity: res.recruitRarity };
  game.pendingEvent = undefined;
  return { texts: res.texts, battleStageId: res.battleStageId, battleUrgent: res.battleUrgent };
}

// 休息节点：全员恢复 50% 最大生命/魔力；死亡角色复活（恢复至 50%，暂议默认值）
export function applyRest(game: GameState, players: PlayerChar[]): string[] {
  const texts: string[] = [];
  for (const p of players) {
    const c = p.char;
    const i = players.findIndex((x) => x.char.id === c.id);
    const b = buildAllyCombatant(c, game.itemMap, i, {
      relics: [...(game.perRelics[c.id] ?? [])],
      relicStacks: game.perRelicStacks[c.id] ?? {},
      killBook: game.run.killBook,
      maxHpPctDown: plagueLetterHpDown(game.run),
    });
    const cur = game.run.hpMp[c.id] ?? { hp: b.maxHp, mp: b.maxMp };
    const alive = cur.hp > 0;
    const hp = alive ? Math.min(b.maxHp, cur.hp + Math.floor(b.maxHp * 0.5)) : Math.ceil(b.maxHp * 0.5);
    const mp = alive ? Math.min(b.maxMp, cur.mp + Math.floor(b.maxMp * 0.5)) : Math.ceil(b.maxMp * 0.5);
    game.run.hpMp[c.id] = { hp, mp };
    texts.push(alive
      ? `【${p.name}】的${c.name}恢复至 HP ${hp}/${b.maxHp}、MP ${mp}/${b.maxMp}`
      : `【${p.name}】的${c.name}已复活！恢复至 HP ${hp}/${b.maxHp}、MP ${mp}/${b.maxMp}`);
  }
  return texts;
}

// ===== 个人背包视图与装备切换（对齐单人版 RunBag：属性面板 + 穿戴 + 切换，服务端权威）=====

const BAG_SLOTS: { key: 'weapon' | 'helmet' | 'armor' | 'boots' | 'acc1' | 'acc2'; label: string }[] = [
  { key: 'weapon', label: '武器' },
  { key: 'helmet', label: '头盔' },
  { key: 'armor', label: '护甲' },
  { key: 'boots', label: '靴子' },
  { key: 'acc1', label: '饰品一' },
  { key: 'acc2', label: '饰品二' },
];

// 装备槽位（Equip 结构）：饰品展开为 acc1/acc2
function bagEquipOf(c: Character): Record<string, string | null> {
  const e = c.equip;
  return {
    weapon: e.weapon,
    helmet: e.helmet,
    armor: e.armor,
    boots: e.boots,
    acc1: e.accessory[0],
    acc2: e.accessory[1],
  };
}
// 写入装备槽位（accessory 映射回数组）
function setBagSlot(c: Character, key: string, itemId: string | null): boolean {
  if (key === 'weapon') { c.equip.weapon = itemId; return true; }
  if (key === 'helmet') { c.equip.helmet = itemId; return true; }
  if (key === 'armor') { c.equip.armor = itemId; return true; }
  if (key === 'boots') { c.equip.boots = itemId; return true; }
  if (key === 'acc1') { c.equip.accessory[0] = itemId; return true; }
  if (key === 'acc2') { c.equip.accessory[1] = itemId; return true; }
  return false;
}
// 重算角色 maxHp/maxMp 并 clamp（装备变更后）
function reclampHpMp(game: GameState, c: Character): void {
  const i = game.run.party.memberIds.indexOf(c.id);
  const b = buildAllyCombatant(c, game.itemMap, Math.max(0, i), {
    relics: [...(game.perRelics[c.id] ?? [])],
    relicStacks: game.perRelicStacks[c.id] ?? {},
    killBook: game.run.killBook,
    maxHpPctDown: plagueLetterHpDown(game.run),
  });
  const cur = game.run.hpMp[c.id] ?? { hp: b.maxHp, mp: b.maxMp };
  game.run.hpMp[c.id] = { hp: Math.min(b.maxHp, cur.hp), mp: Math.min(b.maxMp, cur.mp) };
}

// 装备一件藏品（对齐单人 doEquip：武器职业限制/等级/饰品不重复；旧装备回库存）
// 联机藏品来源有两处：角色自带 c.inventory 与本次副本获得 game.perItems[c.id]（掉落/商店/事件发放），装备校验与移除都按来源处理
export function applyBagEquip(game: GameState, c: Character, itemId: string): { ok: boolean; err?: string } {
  const item = game.itemMap.get(itemId);
  if (!item) return { ok: false, err: '藏品不存在' };
  const fromInv = (c.inventory ?? []).includes(itemId);
  const fromRun = (game.perItems[c.id] ?? []).includes(itemId);
  if (!fromInv && !fromRun) return { ok: false, err: '背包中没有这件藏品' };
  if (item.level !== undefined && (c.level ?? 1) < item.level) {
    return { ok: false, err: `等级不足（需要 ${item.level} 级）` };
  }
  let slotKey: string;
  if (item.slot === 'accessory') {
    const eq = c.equip.accessory;
    if (eq[0] === itemId || eq[1] === itemId) return { ok: false, err: '已装备该饰品' };
    if (eq[0] && eq[1] && eq[0] !== itemId && eq[1] !== itemId) return { ok: false, err: '饰品槽已满' };
    slotKey = eq[0] ? 'acc2' : 'acc1';
  } else if (item.slot === 'weapon' || item.slot === 'helmet' || item.slot === 'armor' || item.slot === 'boots') {
    slotKey = item.slot;
    if (item.slot === 'weapon') {
      const allowed = JOB_DEFS[c.job]?.allowedWeaponTypes ?? [];
      if (!allowed.includes(item.weaponType ?? '')) {
        return { ok: false, err: `职业不匹配（${c.job} 无法使用 ${item.weaponType ?? '该'}武器）` };
      }
    }
  } else {
    return { ok: false, err: '该藏品不可装备' };
  }
  // 旧装备回库存（回角色自带库存）
  const old = bagEquipOf(c)[slotKey];
  if (old && !(c.inventory ?? []).includes(old)) c.inventory = [...(c.inventory ?? []), old];
  // 从来源移除并穿上
  if (fromInv) c.inventory = (c.inventory ?? []).filter((x) => x !== itemId);
  if (fromRun) game.perItems[c.id] = (game.perItems[c.id] ?? []).filter((x) => x !== itemId);
  setBagSlot(c, slotKey, itemId);
  reclampHpMp(game, c);
  return { ok: true };
}

// 卸下装备（回库存）
export function applyBagUnequip(game: GameState, c: Character, slot: string): { ok: boolean; err?: string } {
  const cur = bagEquipOf(c)[slot];
  if (!cur) return { ok: false, err: '该槽位没有装备' };
  setBagSlot(c, slot, null);
  if (!(c.inventory ?? []).includes(cur)) c.inventory = [...(c.inventory ?? []), cur];
  reclampHpMp(game, c);
  return { ok: true };
}

// 背包视图（服务端权威计算面板，对齐单人 RunBag 展示口径）
export function buildBagView(game: GameState, charId: string): BagView | null {
  const c = game.save.characters.find((x) => x?.id === charId);
  if (!c) return null;
  const equipped = equippedIds(c.equip).map((id) => game.itemMap.get(id)).filter((x): x is Item => !!x);
  const relics = game.perRelics[charId] ?? [];
  const stacks = game.perRelicStacks[charId] ?? {};
  const base = computeStats(BASE_TEMPLATE, equipped, c.level, c.baseExtra ?? c.extra);
  const weaponItem = equipped.find((i) => i.slot === 'weapon');
  const bonus = relicPanelBonus(relics, stacks, {
    weaponType: weaponItem?.weaponType ?? 'none',
    torches: game.run.torches ?? 0,
    coins: game.run.coins ?? 0,
  });
  const outer = outerStats(base, bonus);
  const relicsCfg = relics.map((r) => RELIC_MAP[r]).filter((x) => !!x);
  const mods = relicsCfg.reduce(
    (acc, x) => {
      const e = x.effect;
      if (e.kind === 'physDmgAmp') acc.physAmp += e.amount;
      if (e.kind === 'magicDmgAmp') acc.magicAmp += e.amount;
      if (e.kind === 'allDmgRed') acc.allRed += e.amount;
      return acc;
    },
    { physAmp: 0, magicAmp: 0, allRed: 0 },
  );
  const pass = collectPassives(equipped);
  const equipBonus = collectExtraBonus(equipped);
  const sixRelicSum = sumRelicSixStats(relics);
  const extraTotal: Record<string, number> = {};
  for (const k of ['str', 'int', 'agi', 'luk', 'cha', 'wil'] as ExtraKey[]) {
    extraTotal[k] = (c.extra?.[k] ?? 10) + (equipBonus[k] ?? 0) + (sixRelicSum[k] ?? 0);
  }
  const memberIdx = Math.max(0, game.run.party.memberIds.indexOf(charId));
  const combat = buildAllyCombatant(c, game.itemMap, memberIdx, {
    relics: [...relics],
    relicStacks: stacks,
    killBook: game.run.killBook,
    maxHpPctDown: plagueLetterHpDown(game.run),
  });
  const cur = game.run.hpMp[charId] ?? { hp: combat.maxHp, mp: combat.maxMp };
  const brief = (id: string): BagItemBrief | undefined => {
    const it = game.itemMap.get(id);
    if (!it) return undefined;
    return {
      id: it.id, name: it.name, slot: it.slot, rarity: it.rarity, desc: it.desc ?? '',
      level: it.level, weaponType: it.weaponType, icon: it.icon,
      extraBonus: it.extraBonus, usable: it.usable, bonus: bonusLines(it),
    };
  };
  const items: Record<string, BagItemBrief> = {};
  const want = (id: string) => { if (id && !items[id]) { const b = brief(id); if (b) items[id] = b; } };
  for (const id of equippedIds(c.equip)) want(id);
  for (const id of c.inventory ?? []) want(id);
  for (const id of game.perItems[charId] ?? []) want(id);
  for (const it of game.perMaterials[charId] ?? []) { const b = brief(it.itemId); if (b) items[it.itemId] = b; }
  return {
    charId,
    name: c.name,
    job: c.job,
    jobTier: c.jobTier,
    level: c.level ?? 1,
    hp: cur.hp,
    maxHp: combat.maxHp,
    mp: cur.mp,
    maxMp: combat.maxMp,
    equip: bagEquipOf(c),
    inventory: c.inventory ?? [],
    perItems: game.perItems[charId] ?? [],
    bag: c.bag ?? [],
    extra: { ...(c.extra ?? {}) },
    extraEquip: { ...equipBonus },
    sixRelic: { ...sixRelicSum },
    extraTotal,
    stats: { hp: outer.hp, mp: outer.mp, atk: outer.atk, def: outer.def, mres: outer.mres, spdMin: outer.spdMin, spdMax: outer.spdMax },
    baseStats: { hp: base.hp, mp: base.mp, atk: base.atk, def: base.def, mres: base.mres, spdMin: base.spdMin, spdMax: base.spdMax },
    relicIds: relics,
    relicStacks: stacks,
    plagueLetterStacks: game.run.plagueLetterStacks ?? 0,
    relicMods: mods,
    itemDmgAmp: { phys: pass.physDmgAmp ?? 0, magic: pass.magicDmgAmp ?? 0 },
    materials: game.perMaterials[charId] ?? [],
    items,
  };
}

// ===== 独立节点：商店 / 失与得 / 王牌招募（每玩家独立操作界面）=====

// 每人按自己角色/遗物折扣生成独立商店
export function initShop(game: GameState, players: PlayerChar[], rng: Rng): void {
  const dungeon = DUNGEONS.find((d) => d.id === game.run.dungeonId);
  const level = dungeon?.level ?? 30;
  for (const p of players) {
    const shop = rollMerchantShop({
      items: [...game.itemMap.values()],
      relics: RELICS,
      owned: new Set(game.perRelics[p.char.id] ?? []),
      rng,
      level,
      runRelics: game.perRelics[p.char.id] ?? [],
      endgame: false,
      dungeonId: game.run.dungeonId,
    });
    game.shopState[p.playerId] = {
      charId: p.char.id,
      slots: shop.slots.map((s, i) => ({
        id: `s_${i}`,
        kind: s.kind,
        itemId: s.kind === 'item' ? s.id : undefined,
        relicId: s.kind === 'relic' ? s.id : undefined,
        label: (s.kind === 'item' ? game.itemMap.get(s.id)?.name
          : s.kind === 'relic' ? RELICS.find((r) => r.id === s.id)?.name
          : s.id) ?? s.id,
        price: s.price,
        rarity: s.kind === 'item' ? game.itemMap.get(s.id)?.rarity
          : s.kind === 'relic' ? RELICS.find((r) => r.id === s.id)?.rarity
          : undefined,
      })),
      bought: [],
      refreshCount: 0,
      refreshed: false,
    };
  }
}

// 单件实际售价（按玩家自己的遗物/砍价）：robbed→0；免费槽→0；否则 原价×shopPriceMul
export function shopSlotFinalPrice(game: GameState, playerId: string, st: ShopState, slot: ShopSlot, index: number): number {
  if (st.robbed) return 0;
  const relicIds = game.perRelics[st.charId] ?? [];
  const freeCount = shopFreeCount(relicIds);
  const freeSlotIndices = shopFreeSlotIndices(st.slots, freeCount);
  if (freeSlotIndices.has(index)) return 0;
  return Math.max(0, Math.ceil(slot.price * shopPriceMul(relicIds, st.haggle)));
}

// 构造个人商店视图（对齐单人版价格/免费/砍价/刷新/洗劫展示）
export function buildShopView(game: GameState, players: PlayerChar[], playerId: string, doneCount: number, total: number): PersonalView['shop'] {
  const st = game.shopState[playerId];
  if (!st) return undefined;
  const p = players.find((x) => x.playerId === playerId);
  const charId = p?.char.id;
  const relicIds = charId ? game.perRelics[charId] ?? [] : [];
  const isCalamity = game.run.dungeonId === 'preWallCalamity';
  const freeRefreshes = 1 + (relicIds.includes('rl_companion') ? 1 : 0);
  const nextRefreshCost = isCalamity ? Math.max(0, st.refreshCount - (freeRefreshes - 1)) : 0;
  const priceMul = shopPriceMul(relicIds, st.haggle);
  const chainMul = shopPriceMul(relicIds, undefined);
  const freeCount = shopFreeCount(relicIds);
  const freeSlotIndices = shopFreeSlotIndices(st.slots, freeCount);
  return {
    coins: game.perCoins[playerId] ?? 0,
    slots: st.slots.map((s, i) => {
      const free = freeSlotIndices.has(i);
      const final = st.robbed ? 0 : free ? 0 : Math.max(0, Math.ceil(s.price * priceMul));
      const it = s.kind === 'item' || s.kind === 'material' || s.kind === 'potion' ? game.itemMap.get(s.itemId ?? '') : undefined;
      const rl = s.kind === 'relic' && s.relicId ? RELIC_MAP[s.relicId] : undefined;
      return {
        id: s.id,
        label: s.label,
        kind: s.kind as 'item' | 'relic' | 'material' | 'potion',
        price: final,
        price0: s.price,
        rarity: s.rarity,
        free,
        sold: st.bought.includes(s.id),
        icon: rl?.icon ?? (it ? (it.icon ?? undefined) : undefined),
        desc: rl?.desc ?? it?.desc,
        sub: s.kind === 'relic' ? (rl ? `${rl.rarity} · 遗物` : '遗物')
          : it ? `${it.rarity} · ${it.slot}` : '',
      };
    }),
    bought: st.bought,
    doneCount,
    total,
    haggle: st.haggle,
    robbed: !!st.robbed,
    refreshCount: st.refreshCount,
    torches: game.run.torches,
    dungeonId: game.run.dungeonId,
    freeCount,
    priceMul,
    chainMul,
    nextRefreshCost,
    refreshFreeLeft: isCalamity ? undefined : Math.max(0, freeRefreshes - st.refreshCount),
    robShopOpen: game.run.dungeonId === 'starterVillage' && !game.run.robbedShop && !st.robbed,
    robShopDone: !!game.run.robbedShop,
  };
}

// 刷新货摊：灾厄泰拉消耗共享火把（前 freeRefreshes 次免费，之后 1/2/3...递增）；其他副本免费次数用尽即止
export function shopRefresh(game: GameState, playerId: string, rng: Rng): { ok: boolean; text?: string; err?: string } {
  const st = game.shopState[playerId];
  if (!st) return { ok: false, err: '当前不在商店' };
  if (st.robbed) return { ok: false, err: '货摊已被洗劫' };
  const relicIds = game.perRelics[st.charId] ?? [];
  const isCalamity = game.run.dungeonId === 'preWallCalamity';
  const freeRefreshes = 1 + (relicIds.includes('rl_companion') ? 1 : 0);
  const cost = isCalamity ? Math.max(0, st.refreshCount - (freeRefreshes - 1)) : 0;
  if (isCalamity) {
    if (game.run.torches < cost) return { ok: false, err: `火把不足（刷新需 ${cost} 根，现有 ${game.run.torches}）` };
  } else if (st.refreshCount >= freeRefreshes) {
    return { ok: false, err: '免费刷新次数已用完' };
  }
  const dungeon = DUNGEONS.find((d) => d.id === game.run.dungeonId);
  const level = dungeon?.level ?? 30;
  const shop = rollMerchantShop({
    items: [...game.itemMap.values()],
    relics: RELICS,
    owned: new Set(relicIds),
    rng,
    level,
    runRelics: relicIds,
    endgame: false,
    dungeonId: game.run.dungeonId,
  });
  game.run.torches -= cost;
  st.slots = shop.slots.map((s, i) => ({
    id: `s_${i}`,
    kind: s.kind,
    itemId: s.kind === 'item' ? s.id : undefined,
    relicId: s.kind === 'relic' ? s.id : undefined,
    label: (s.kind === 'item' ? game.itemMap.get(s.id)?.name
      : s.kind === 'relic' ? RELICS.find((r) => r.id === s.id)?.name
      : s.id) ?? s.id,
    price: s.price,
    rarity: s.kind === 'item' ? game.itemMap.get(s.id)?.rarity
      : s.kind === 'relic' ? RELICS.find((r) => r.id === s.id)?.rarity
      : undefined,
  }));
  st.bought = [];
  st.refreshCount += 1;
  st.refreshed = true;
  return { ok: true, text: isCalamity && cost > 0 ? `已刷新货摊（消耗 ${cost} 根火把）` : '已免费刷新货摊' };
}

// 魅力砍价：以玩家自己角色魅力（六维+装备+遗物）+1D50 判定一次，仅影响自己的货摊
export function shopHaggle(game: GameState, playerId: string, rng: Rng): { ok: boolean; text?: string; err?: string } {
  const st = game.shopState[playerId];
  if (!st) return { ok: false, err: '当前不在商店' };
  if (st.robbed) return { ok: false, err: '货摊已被洗劫' };
  if (st.haggle) return { ok: false, err: '本摊已砍过价' };
  const char = game.save.characters.find((c) => c?.id === st.charId);
  if (!char) return { ok: false, err: '未找到角色' };
  const cha = charStat(game, char, 'cha');
  const res = haggleRoll(cha, rng);
  st.haggle = res;
  const label = res.discountPct < 1 ? `砍价成功！本摊商品 ${haggleLabel(res.discountPct)} 优惠`
    : res.discountPct > 1 ? '行商被激怒，本摊商品涨价至 120%！'
    : '行商不为所动，价格维持原价。';
  return { ok: true, text: `判定 ${res.total}（魅力 ${cha} + 1D50[${res.roll}]）→ ${label}` };
}

// 出售：藏品（perItems）或药水/材料（perMaterials），回个人币
export function shopSell(game: GameState, playerId: string, charId: string, itemId: string, potion: boolean): { ok: boolean; text?: string; err?: string } {
  const st = game.shopState[playerId];
  if (!st) return { ok: false, err: '当前不在商店' };
  const it = game.itemMap.get(itemId);
  if (!it) return { ok: false, err: '未找到该藏品' };
  const price = potion ? potionSellPrice() : merchantSellPrice(it);
  if (potion) {
    const list = game.perMaterials[charId] ?? [];
    const idx = list.findIndex((m) => m.itemId === itemId);
    if (idx < 0) return { ok: false, err: '背包中没有该药水' };
    if (list[idx]!.count > 1) list[idx] = { ...list[idx]!, count: list[idx]!.count - 1 };
    else list.splice(idx, 1);
  } else {
    const owned = game.perItems[charId] ?? [];
    const idx = owned.indexOf(itemId);
    if (idx < 0) return { ok: false, err: '背包中没有该藏品' };
    owned.splice(idx, 1);
  }
  gainCoins(game, playerId, price);
  return { ok: true, text: `出售【${it.name}】+${price} 币` };
}

// 购买商店物品：扣该玩家个人币，物品入该玩家自己的传奇角色（不能给别的角色）
export function buySlot(game: GameState, playerId: string, charId: string, slotId: string): { ok: boolean; text?: string; err?: string } {
  const st = game.shopState[playerId];
  if (!st) return { ok: false, err: '当前不在商店' };
  if (st.bought.includes(slotId)) return { ok: false, err: '已购买' };
  const idx = st.slots.findIndex((s) => s.id === slotId);
  if (idx < 0) return { ok: false, err: '商品不存在' };
  const slot = st.slots[idx]!;
  const price = shopSlotFinalPrice(game, playerId, st, slot, idx);
  const mine = game.perCoins[playerId] ?? 0;
  if (mine < price) return { ok: false, err: `哈哈币不足（需要 ${price}，你有 ${mine}）` };
  gainCoins(game, playerId, -price);
  st.bought.push(slotId);
  if (slot.kind === 'item' && slot.itemId) {
    game.perItems[charId].push(slot.itemId);
    return { ok: true, text: `购买藏品【${slot.label}】（-${price} 币）` };
  }
  if (slot.kind === 'relic' && slot.relicId) {
    game.perRelics[charId].push(slot.relicId);
    const extras = applyRelicPickupEffects(game, [slot.relicId]);
    return { ok: true, text: `购买遗物《${slot.label}》（-${price} 币）${extras.length > 0 ? '；' + extras.join('；') : ''}` };
  }
  if (slot.kind === 'material' || slot.kind === 'potion') {
    const list = game.perMaterials[charId] ?? (game.perMaterials[charId] = []);
    const f = list.find((m) => m.itemId === (slot.itemId ?? slot.label));
    if (f) f.count += 1;
    else list.push({ itemId: slot.itemId ?? slot.label, count: 1 });
    return { ok: true, text: `购买${slot.kind === 'potion' ? '药水' : '材料'}（-${price} 币）` };
  }
  return { ok: false, err: '未知商品类型' };
}

// 独立失与得：每人从自己已拥有藏品中选一件交换（品质可能提升一档；灾厄上限 2 次）
export function initTrade(game: GameState, players: PlayerChar[]): void {
  for (const p of players) {
    const charId = p.char.id;
    const ownedIds = [...(game.perItems[charId] ?? [])];
    const offers = ownedIds
      .map((id) => {
        const it = game.itemMap.get(id);
        return it ? { itemId: id, name: it.name, rarity: it.rarity } : null;
      })
      .filter((x): x is { itemId: string; name: string; rarity: string } => !!x);
    // 无联机藏品时，用角色局外背包装备补充可交换项
    if (offers.length === 0) {
      for (const invId of p.char.inventory ?? []) {
        const it = game.itemMap.get(invId);
        if (it && offers.length < 4) offers.push({ itemId: invId, name: it.name, rarity: it.rarity });
      }
    }
    game.tradeState[p.playerId] = { offers: offers.slice(0, 4), exchangeCount: 0 };
  }
}

// 交换一件藏品（每人每节点最多 2 次）
export function tradePick(game: GameState, playerId: string, charId: string, itemId: string, rng: Rng): { ok: boolean; text?: string; err?: string } {
  const st = game.tradeState[playerId];
  if (!st) return { ok: false, err: '当前不在失与得' };
  const maxExchanges = game.run.dungeonId === 'preWallCalamity' ? 2 : 1;
  if (st.exchangeCount >= maxExchanges) return { ok: false, err: `本节点最多交换 ${maxExchanges} 次` };
  const offer = st.offers.find((o) => o.itemId === itemId);
  if (!offer) return { ok: false, err: '该藏品不在可交换列表' };
  const cur = game.itemMap.get(itemId);
  if (!cur) return { ok: false, err: '未找到该藏品' };
  const owned = game.perItems[charId] ?? [];
  const idx = owned.indexOf(itemId);
  if (idx < 0) return { ok: false, err: '该藏品不属于你' };
  const char = game.save.characters.find((c) => c?.id === charId);
  if (!char) return { ok: false, err: '未找到角色' };
  const luck = characterLuck(char, game.itemMap) + sumRelicSixStats(game.perRelics[charId] ?? []).luk;
  const pass = luck + rng.int(1, 50) > 60;
  const targetRarity = pass ? upgradeRarity(cur.rarity) : cur.rarity;
  const dungeon = DUNGEONS.find((d) => d.id === game.run.dungeonId);
  const level = dungeon?.level ?? 30;
  const pool = tradeItemPool([...game.itemMap.values()], targetRarity, itemId, level, game.run.dungeonId === 'preWallCalamity');
  if (pool.length === 0) return { ok: false, err: '同稀有度暂无其它藏品可换' };
  const ni = pool[rng.int(0, pool.length - 1)];
  owned.splice(idx, 1);
  owned.push(ni.id);
  st.exchangeCount += 1;
  st.picked = itemId;
  const upgraded = pass && ni.rarity !== cur.rarity;
  return { ok: true, text: `「${cur.name}」换得「${ni.name}」${upgraded ? '（品质提升！）' : ''}` };
}

// 独立王牌招募：每人刷 3 个王牌单位候选（不含传奇角色）；rarity 限定稀有度（重返家园事件）
export function initRecruit(game: GameState, players: PlayerChar[], rng: Rng, rarity?: 'rare' | 'epic'): void {
  const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => rng.int(0, 1) - 0.5);
  for (const p of players) {
    let cands: { id: string; name: string; rarity?: string; icon?: string; hp: number; atk: number; def: number }[];
    if (rarity) {
      const rolled = rollAceCandidatesByRarity(game.run, rarity, 3, rng);
      cands = rolled.map((a) => ({
        id: a.id, name: a.name, rarity: a.rarity, icon: a.icon,
        hp: a.stats.hp, atk: a.stats.atk, def: a.stats.def,
      }));
    } else {
      const sh = shuffle([...ACE_UNITS]);
      cands = sh.slice(0, 3).map((a) => ({
        id: a.id, name: a.name, rarity: a.rarity, icon: a.icon,
        hp: a.stats.hp, atk: a.stats.atk, def: a.stats.def,
      }));
    }
    game.recruitState[p.playerId] = { candidates: cands };
  }
}

// 选择王牌单位：绑定给该玩家（战斗时随其角色出战，由该玩家操作）
export function recruitPick(game: GameState, playerId: string, charId: string, aceId: string): { ok: boolean; text?: string; err?: string } {
  const st = game.recruitState[playerId];
  if (!st) return { ok: false, err: '当前不在王牌招募' };
  const cand = st.candidates.find((c) => c.id === aceId);
  if (!cand) return { ok: false, err: '候选不存在' };
  const char = game.save.characters.find((c) => c?.id === charId);
  game.perAce[charId] = aceId;
  st.picked = aceId;
  return { ok: true, text: `【${char?.name ?? charId}】招募了王牌单位「${cand.name}」` };
}

// 狭路相逢奖励：一人一份（各玩家独立结算）
export function skirmishPerPlayerRewards(game: GameState, players: PlayerChar[], tier: number, rng: Rng): string[] {
  const texts: string[] = [];
  for (const p of players) {
    const r = skirmishRewards(tier);
    const charId = p.char.id;
    if (r.stones) {
      for (const st of r.stones) {
        const list = game.perMaterials[charId] ?? (game.perMaterials[charId] = []);
        const f = list.find((m) => m.itemId === st.itemId);
        if (f) f.count += st.count;
        else list.push({ itemId: st.itemId, count: st.count });
        texts.push(`【${p.name}】获得强化石 ×${st.count}`);
      }
    }
    if (r.relic) {
      const owned = new Set(game.perRelics[charId] ?? []);
      if (!owned.has(r.relic)) {
        game.perRelics[charId].push(r.relic);
        texts.push(`【${p.name}】获得遗物《${RELICS.find((x) => x.id === r.relic)?.name ?? r.relic}》`);
      } else {
        const rest = RELICS.filter((x) => x.inPool !== false && !owned.has(x.id));
        if (rest.length > 0) {
          const alt = rest[rng.int(0, rest.length - 1)];
          game.perRelics[charId].push(alt.id);
          texts.push(`【${p.name}】获得遗物《${alt.name}》（重复遗物已替换）`);
        }
      }
    }
    if (r.item) {
      game.perItems[charId].push(r.item);
      texts.push(`【${p.name}】获得藏品【${game.itemMap.get(r.item)?.name ?? r.item}】`);
    }
  }
  return texts;
}

// 战斗胜利回写 HP/MP（节点推进由 resolvePendingNode 在掉落分配后统一完成）
export function applyBattleHpMpOnly(game: GameState, survivors: { id: string; hp: number; mp: number }[]): void {
  game.run = applyBattleHpMp(game.run, survivors);
}

// 结算当前节点并推进（战斗/事件/休息/跳过共用）；返回是否通关
export function resolvePendingNode(game: GameState): boolean {
  const nodeId = game.pendingNodeId;
  if (!nodeId) return game.run.result === 'win';
  game.run = resolveNode(game.run, nodeId);
  game.pendingNodeId = undefined;
  return game.run.result === 'win';
}

// 通关结算：每人按各自独立哈哈币结算（perCoins）、材料/藏品入各角色独享仓库、遗物仅展示
export function finishRun(game: GameState, players: PlayerChar[]): { win: boolean; reason: string; perPlayer: { playerId: string; name: string; coins: number; items: string[]; relics: string[]; materials: { itemId: string; count: number }[] }[] } {
  const run = game.run;
  const out = players.map((p) => {
    const c = p.char;
    const itemIds = [...(game.perItems[c.id] ?? [])];
    const items = itemIds.map((id) => game.itemMap.get(id)?.name ?? id);
    const relics = (game.perRelics[c.id] ?? []).map((id) => RELICS.find((r) => r.id === id)?.name ?? id);
    const coins = Math.max(0, Math.floor(game.perCoins[p.playerId] ?? 0)); // 个人独立币
    // 材料 + 藏品写入角色独享仓库
    const storage = [...(c.storage ?? [])];
    for (const m of game.perMaterials[c.id] ?? []) {
      const f = storage.find((g) => g.itemId === m.itemId);
      if (f) f.count += m.count;
      else storage.push({ itemId: m.itemId, count: m.count });
    }
    for (const id of itemIds) {
      const f = storage.find((g) => g.itemId === id);
      if (f) f.count += 1;
      else storage.push({ itemId: id, count: 1 });
    }
    c.storage = storage;
    c.coins = Math.max(0, Math.floor((c.coins ?? 0) + coins));
    return { playerId: p.playerId, name: p.name, coins, items, itemIds, relics, materials: game.perMaterials[c.id] ?? [] };
  });
  return { win: true, reason: '灾厄泰拉通关！', perPlayer: out };
}

// 团灭结算
export function abortRun(game: GameState, players: PlayerChar[]): { win: boolean; reason: string; perPlayer: never[] } {
  const run = game.run;
  const texts: string[] = ['全员倒下，探索失败'];
  for (const p of players) {
    const origCoins = Math.max(0, Math.floor(p.char.coins ?? 0));
    p.char.coins = origCoins;
  }
  return { win: false, reason: texts.join('；'), perPlayer: [] as never[] };
}
