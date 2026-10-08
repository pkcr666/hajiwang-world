import type {
  FixedDrop, Item, RarityWeights, SaveData,
  ActMap, MapNode, Party, Rng, RunActId, RunState, StageDef,
} from '../types';
import { mathRng } from '../types';
import { buildSublayer, generateAct, generateCalamityAct, MAP_DUNGEON } from './mapgen';
import { RELICS, RELIC_MAP, inPoolRelics, isUnimplemented } from '../data/relics';
import { DUNGEONS } from '../data/dungeons';
import { openChestRelic, resolveDrop, rollFixedDrops, rollLuckyDrops, rollStageDrop } from './drops';
import { CRYSTAL_CAP, LIFE_CRYSTAL_ID, MANA_CRYSTAL_ID } from './stats';
import { buildAllyCombatant } from './unit';
import { partyMembers } from './party';
import { updateCharacterBag, updateCharacterInventory } from '../save/storage';
import { CRISIS_NODE_LAYOUT, CRISIS_STAGE_BASE_SCORE, CRISIS_TERMS, calcCrisisTotalScore, type CrisisTerm } from '../data/crisisContract';

export interface RunDrops {
  materials: { itemId: string; count: number }[];
  coins: number;
}

// ===== 战后拾取（杀戮尖塔式掉落）=====
// 一场作战胜利后产出的奖励卡片；玩家逐个点击拾取，未点击的放弃。
export type PickReward =
  | { key: string; kind: 'coin'; count: number }
  | { key: string; kind: 'torch'; count: number }
  | { key: string; kind: 'material'; itemId: string; count: number }
  | { key: string; kind: 'item'; itemId: string; note?: string; owner?: string; count?: number } // owner：拾取时选定的队员，立即入其背包
  | { key: string; kind: 'relic'; relicId: string; note?: string }
  | { key: string; kind: 'luckyFail'; text: string };

/**
 * 按关卡掉落规则构建一场作战的奖励卡片：
 * - 固定掉落（必得）：哈哈币/材料/藏品/遗物
 * - 随机掉落：归一表 roll 一件
 * - 幸运掉落：每条独立判定（队长幸运+1D50 ≥ 判定值），成败都展示
 * - 火把：普通25% / 紧急50% / BOSS 100%
 */
export function buildBattleRewards(opts: {
  items: Item[];
  run: RunState;
  node: MapNode;
  stage: StageDef;
  leaderLuck: number;
  rng: Rng;
  bonusDrops?: FixedDrop[];
}): PickReward[] {
  const { items, run, node, stage, leaderLuck, rng, bonusDrops } = opts;
  // 随机遗物掉落去重：本次副本已获得的遗物不再重复掉落
  const ctx = { items, relics: RELICS, owned: new Set(run.relics ?? []) };
  const out: PickReward[] = [];
  let k = 0;
  const key = () => `pr_${k++}`;
  const pushItem = (itemId: string, note?: string) => out.push({ key: key(), kind: 'item', itemId, note });
  const pushReward = (r: ReturnType<typeof rollStageDrop>) => {
    if (!r) return;
    if (r.kind === 'coin') out.push({ key: key(), kind: 'coin', count: r.count });
    else if (r.kind === 'item') pushItem(r.item.id);
    else if (r.kind === 'relic') out.push({ key: key(), kind: 'relic', relicId: r.relic.id });
    else if (r.kind === 'material') out.push({ key: key(), kind: 'material', itemId: r.item.id, count: r.count });
    else pushItem(r.item.id); // consumable
  };

  // 合并关卡固定掉落与战斗中产生的额外掉落（如老板击杀奖励）
  const combinedStage = bonusDrops && bonusDrops.length > 0
    ? { ...stage, fixedDrops: [...(stage.fixedDrops ?? []), ...bonusDrops] }
    : stage;
  const fixed = rollFixedDrops(combinedStage, ctx, rng);
  if (fixed.coins > 0) out.push({ key: key(), kind: 'coin', count: fixed.coins });
  for (const m of fixed.materials) out.push({ key: key(), kind: 'material', itemId: m.item.id, count: m.count });
  for (const it of fixed.items) pushItem(it.id);
  for (const rl of fixed.relics) { out.push({ key: key(), kind: 'relic', relicId: rl.id }); ctx.owned?.add(rl.id); }

  const stageDrop = rollStageDrop(stage, ctx, rng);
  if (stageDrop?.kind === 'relic') ctx.owned?.add(stageDrop.relic.id);
  pushReward(stageDrop);

  const isCalamity = run.dungeonId === 'preWallCalamity';
  if (isCalamity) {
    // 灾厄泰拉遗物掉落：
    //   常规概率掉落 = 20% + 幸运/2（所有作战均判定）
    //   紧急/BOSS 必定额外掉落一件（与常规概率掉落相互独立，可叠加为两件）
    const calamityRelicWeights: RarityWeights = { uncommon: 40, fine: 30, rare: 20, epic: 10 };
    const dropRelic = () => {
      let r = resolveDrop('relic', 'pool', ctx, rng, { rarityWeights: calamityRelicWeights });
      // 保底：若掷出的稀有度池已被集齐（该稀有度未拥有在池遗物为空），
      // 回退到「所有未拥有在池遗物」中随机，确保紧急/BOSS 的必掉件不会空手而归
      if (!r) {
        const pool = RELICS.filter((x) => x.inPool !== false && !(ctx.owned?.has(x.id)));
        if (pool.length > 0) r = { kind: 'relic', relic: pool[rng.int(0, pool.length - 1)] };
      }
      if (r?.kind === 'relic') { out.push({ key: key(), kind: 'relic', relicId: r.relic.id }); ctx.owned?.add(r.relic.id); }
    };
    if (node.urgent || node.kind === 'boss') {
      // 紧急/BOSS：必定额外掉落一件（与下方常规概率掉落相互独立，可叠加为两件）
      dropRelic();
    }
    // 常规概率掉落：所有作战均按 20%+幸运/2 判定（与紧急/BOSS 的必掉件相互独立）
    const chance = 20 + leaderLuck / 2;
    if (rng.int(1, 100) <= chance) dropRelic();
    // 强化石：每场作战必掉 1 个，稀有 60% / 史诗 30% / 传说 10%
    const stoneRoll = rng.int(1, 100);
    const stoneId = stoneRoll <= 60 ? 'it_stone_rare' : stoneRoll <= 90 ? 'it_stone_epic' : 'it_stone_legendary';
    out.push({ key: key(), kind: 'material', itemId: stoneId, count: 1 });
  } else {
    const lucky = rollLuckyDrops(stage, leaderLuck, ctx, rng);
    for (const l of lucky) {
      if (l.success) {
        if (!l.reward && l.kind === 'relic' && l.source === 'pool') {
          out.push({ key: key(), kind: 'luckyFail', text: `幸运判定 ${l.total}/${l.threshold} 通过，但随机遗物池已集齐` });
          continue;
        }
        if (l.reward?.kind === 'relic') ctx.owned?.add(l.reward.relic.id);
        pushReward(l.reward);
      } else out.push({ key: key(), kind: 'luckyFail', text: `幸运判定 ${l.total}/${l.threshold}，未通过` });
    }
  }

  if (rollTorchDrop(node, rng, run.dungeonId)) out.push({ key: key(), kind: 'torch', count: 1 });
  return out;
}

/**
 * 应用玩家拾取的奖励（未拾取的视为放弃）。
 * 藏品/消耗品按 owner 立即写入该队员背包（消耗品入 bag，藏品入 inventory 格），
 * owner 缺省/失效时兜底给队长；maxHp 用于「立刻回复生命」类遗物。
 * items：全目录（判定消耗品用）。
 */
export function applyPickRewards(
  save: SaveData,
  run: RunState,
  picked: PickReward[],
  maxHp: Record<string, number> = {},
  items?: Map<string, Item>,
): { save: SaveData; run: RunState; texts: string[] } {
  let nextSave = save;
  let next = structuredClone(run);
  const texts: string[] = [];
  // 遗物提升生命/魔力上限前，先记录各成员当前上限（用于同步补足提升的当前值）
  const beforeMax = items ? maxHpMpOf(save, run, items) : null;
  const drops: RunDrops = { materials: [], coins: 0 };
  const relics: string[] = [];
  // 按角色聚合：藏品入背包格、消耗品入携带道具
  const invGain = new Map<string, string[]>();
  const bagGain = new Map<string, { itemId: string; count: number }[]>();
  const memberIds = new Set(next.party.memberIds);
  for (const p of picked) {
    switch (p.kind) {
      case 'coin': drops.coins += p.count; break;
      case 'torch': next.torches = Math.min(TORCH_CAP, next.torches + p.count); break;
      case 'material': drops.materials.push({ itemId: p.itemId, count: p.count }); break;
      case 'item': {
        const owner = p.owner && memberIds.has(p.owner) ? p.owner : next.party.leaderId;
        if (!memberIds.has(owner)) break; // 编队异常时丢弃，避免写进编队外角色
        const it = items?.get(p.itemId);
        // 材料（强化石/锻造材料等）进共享材料仓库，不进藏品格/消耗品栏
        if (it?.slot === 'material') {
          drops.materials.push({ itemId: p.itemId, count: p.count ?? 1 });
          break;
        }
        const isConsumable = it?.slot === 'consumable';
        if (isConsumable) {
          const list = bagGain.get(owner) ?? [];
          const found = list.find((b) => b.itemId === p.itemId);
          if (found) found.count += 1;
          else list.push({ itemId: p.itemId, count: 1 });
          bagGain.set(owner, list);
        } else {
          const list = invGain.get(owner) ?? [];
          list.push(p.itemId);
          invGain.set(owner, list);
        }
        break;
      }
      case 'relic': relics.push(p.relicId); break;
      case 'luckyFail': break;
    }
  }
  for (const [cid, ids] of invGain) {
    const cur = nextSave.characters.find((c) => c?.id === cid);
    nextSave = updateCharacterInventory(nextSave, cid, [...(cur?.inventory ?? []), ...ids]);
  }
  for (const [cid, groups] of bagGain) {
    const cur = nextSave.characters.find((c) => c?.id === cid);
    const bag = [...(cur?.bag ?? [])];
    for (const g of groups) {
      const found = bag.find((b) => b.itemId === g.itemId);
      if (found) found.count += g.count;
      else bag.push({ ...g });
    }
    nextSave = updateCharacterBag(nextSave, cid, bag);
  }
  if (drops.coins > 0 || drops.materials.length > 0) mergeDrops(next, drops);
  next.relics = gainRunRelics(next, relics).relics;
  // 拾取即效遗物：立刻回复生命 / 获得火把 / 谷地树实等额外遗物（递归结算）
  // 战斗掉落路径用 'torchHeal'：谷地树实/宝箱已由拾取面板（RunPick deriveCards）展开为衍生卡，
  // 此处只结算火把/回复，避免双重发放
  if (relics.length > 0) {
    const maxHpMpForRelics = beforeMax ?? Object.fromEntries(
      Object.entries(maxHp).map(([k, v]) => [k, { hp: v, mp: 0 }]),
    );
    const pk = walkRelicEffects(
      next, relics, mathRng, maxHpMpForRelics, 'torchHeal',
      items ? [...items.values()] : undefined, dungeonLevelOf(next.dungeonId),
    );
    next = pk.run;
    texts.push(...pk.texts);
    if (pk.chests.length > 0) nextSave = grantChestItems(nextSave, next, pk.chests);
  }
  // 生命/魔力上限提升的遗物：同步补足提升的当前值（在回复类遗物之后结算）
  if (items && beforeMax) {
    next.hpMp = syncHpMpOnMaxUp(next.hpMp, beforeMax, maxHpMpOf(nextSave, next, items));
  }
  return { save: nextSave, run: next, texts };
}

export const INITIAL_TORCHES = 2;

// 每次副本探索的初始遗物：生命水晶 + 魔力水晶（仅本次副本生效）
export const INITIAL_RUN_RELICS = ['rl_life_crystal', 'rl_mana_crystal'];

// 火把线 id（双向共用一个 key）
export const torchEdgeKey = (a: string, b: string) => [a, b].sort().join('|');

// 作战胜利掉火把：
// 新手村：普通25% / 紧急50% / BOSS 100%
// 灾厄泰拉：普通15% / 紧急30% / BOSS 100%
export const TORCH_CAP = 6;
export function rollTorchDrop(node: MapNode, rng: Rng, dungeonId: string = MAP_DUNGEON): boolean {
  if (node.kind === 'boss') return true;
  if (node.kind !== 'combat') return false;
  if (dungeonId === 'preWallCalamity') {
    const pct = node.urgent ? 30 : 15;
    return rng.int(1, 100) <= pct;
  }
  const denom = node.urgent ? 2 : 4;
  return rng.int(1, denom) === 1;
}

const cloneDrops = (d: RunDrops): RunDrops => ({
  coins: d.coins,
  materials: d.materials.map((m) => ({ ...m })),
});

/**
 * 开启一次副本探索：一次性生成三层地图（子层进入时再生成）。
 * 调用方需保证编队合法、关卡齐全（runBlockers 为空）。
 */
export function startRun(opts: {
  party: Party;
  stages: StageDef[];
  rng: Rng;
  initialHpMp: Record<string, { hp: number; mp: number }>;
  pooledCoins: number;
  now?: number;
}): RunState {
  const { party, stages, rng, initialHpMp, pooledCoins } = opts;
  const emptyAct = (act: RunActId): ActMap => ({ act, cols: 0, rows: 0, nodes: [], edges: [] });
  return {
    dungeonId: 'starterVillage',
    party: structuredClone(party),
    acts: {
      1: generateAct(1, stages, rng),
      2: generateAct(2, stages, rng),
      3: generateAct(3, stages, rng),
      4: generateAct(4, stages, rng),
      5: emptyAct(5),
      6: emptyAct(6),
      7: emptyAct(7),
    },
    sublayer: null,
    act: 1,
    cleared: [],
    at: null,
    visitorNodeId: null,
    subDone: false,
    hpMp: structuredClone(initialHpMp),
    initialPool: pooledCoins,
    coins: pooledCoins,
    pendingMaterials: [],
    pendingItems: [],
    relics: [...INITIAL_RUN_RELICS],
    relicStacks: { [LIFE_CRYSTAL_ID]: 1, [MANA_CRYSTAL_ID]: 0 }, // 进入第1层=生命水晶1层
    torches: INITIAL_TORCHES,
    openedEdges: [],
    createdAt: opts.now ?? Date.now(),
  };
}

/**
 * 开启灾厄泰拉探索：固定 5 层地图。初始仅 1 名角色，最多 3 人小队。
 */
export function startCalamityRun(opts: {
  party: Party;
  stages: StageDef[];
  rng: Rng;
  initialHpMp: Record<string, { hp: number; mp: number }>;
  pooledCoins: number;
  now?: number;
}): RunState {
  const { party, stages, rng, initialHpMp, pooledCoins } = opts;
  return {
    dungeonId: 'preWallCalamity',
    party: structuredClone(party),
    acts: {
      1: generateCalamityAct(1, stages, rng),
      2: generateCalamityAct(2, stages, rng),
      3: generateCalamityAct(3, stages, rng),
      4: generateCalamityAct(4, stages, rng),
      5: generateCalamityAct(5, stages, rng),
      6: generateCalamityAct(6, stages, rng),
      7: generateCalamityAct(7, stages, rng),
    },
    sublayer: null,
    act: 1,
    cleared: [],
    at: null,
    visitorNodeId: null,
    subDone: false,
    hpMp: structuredClone(initialHpMp),
    initialPool: pooledCoins,
    coins: pooledCoins,
    pendingMaterials: [],
    pendingItems: [],
    relics: [...INITIAL_RUN_RELICS],
    relicStacks: { rl_life_crystal: 1, rl_mana_crystal: 0 },
    torches: INITIAL_TORCHES,
    openedEdges: [],
    createdAt: opts.now ?? Date.now(),
  };
}

export const currentMap = (run: RunState): ActMap =>
  run.act === 'sub' ? run.sublayer! : run.acts[run.act];

// 构建危机合约线性地图（8 节点单行：战1-战2-休1-战3-休2-战4-休3-战5）
function buildCrisisAct(): ActMap {
  const nodes: MapNode[] = CRISIS_NODE_LAYOUT.map((n, i) => {
    if (n.type === 'combat') {
      return {
        id: `cc_n${i}`,
        act: 1,
        col: i,
        row: 0,
        kind: i === CRISIS_NODE_LAYOUT.length - 1 ? 'boss' : 'combat',
        stageId: n.stageId,
      };
    }
    return {
      id: `cc_n${i}`,
      act: 1,
      col: i,
      row: 0,
      kind: 'rest',
      note: `cc_rest_${n.restIndex}`,
    };
  });
  const edges = nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1]!.id }));
  return { act: 1, cols: nodes.length, rows: 1, nodes, edges };
}

/**
 * 开启危机合约探索：固定线性布局、记录词条与模式。
 */
export function startCrisisRun(opts: {
  party: Party;
  rng?: Rng;
  initialHpMp: Record<string, { hp: number; mp: number }>;
  pooledCoins: number;
  mode: 'single' | 'dual';
  termIds: string[];
  now?: number;
}): RunState {
  const { party, initialHpMp, pooledCoins, mode, termIds } = opts;
  const emptyAct = (act: RunActId): ActMap => ({ act, cols: 0, rows: 0, nodes: [], edges: [] });
  return {
    dungeonId: 'crisisContract',
    party: structuredClone(party),
    acts: {
      1: buildCrisisAct(),
      2: emptyAct(2),
      3: emptyAct(3),
      4: emptyAct(4),
      5: emptyAct(5),
      6: emptyAct(6),
      7: emptyAct(7),
    },
    sublayer: null,
    act: 1,
    cleared: [],
    at: null,
    visitorNodeId: null,
    subDone: false,
    hpMp: structuredClone(initialHpMp),
    initialPool: pooledCoins,
    coins: pooledCoins,
    pendingMaterials: [],
    pendingItems: [],
    relics: [], // 危机合约默认不带生命/魔力水晶
    relicStacks: {},
    torches: INITIAL_TORCHES,
    openedEdges: [],
    createdAt: opts.now ?? Date.now(),
    crisis: {
      mode,
      termIds: [...termIds],
      buffs: {},
      score: calcCrisisTotalScore(termIds),
    },
  };
}

export function findNode(run: RunState, nodeId: string): { map: ActMap; node: MapNode } | null {
  for (const map of [run.acts[1], run.acts[2], run.acts[3], run.acts[4], run.acts[5], run.acts[6], run.acts[7], run.sublayer]) {
    if (!map) continue;
    const node = map.nodes.find((n) => n.id === nodeId);
    if (node) return { map, node };
  }
  return null;
}

const isCleared = (run: RunState, id: string) => run.cleared.includes(id);

// 当前层已清理节点（用于判断是否刚离开首列）
const clearedInMap = (run: RunState, map: ActMap) =>
  map.nodes.filter((n) => isCleared(run, n.id));

/**
 * 当前选定的节点：显式记录的 at；旧存档缺省时兜底为该层最后一个已清理节点。
 * 一层都没清理过（如刚进新层）返回 null —— 此时本层首列节点全部可选。
 */
export function currentNodeId(run: RunState): string | null {
  const map = currentMap(run);
  if (run.at && map.nodes.some((n) => n.id === run.at)) return run.at;
  const clearedNodes = clearedInMap(run, map);
  return clearedNodes.length > 0 ? clearedNodes[clearedNodes.length - 1]!.id : null;
}

/**
 * 可进入节点（只能从当前选定节点出发）：
 * - 尚未选定节点：本层首列节点全部可选（二/三层多起点）
 * - 已选定：普通推进线只许向右前进；火把线点亮后可双向上下
 */
export function availableNodes(run: RunState): MapNode[] {
  const map = currentMap(run);
  const lit = (e: { from: string; to: string; torch?: boolean }) =>
    !e.torch || run.openedEdges.includes(torchEdgeKey(e.from, e.to));
  const atId = currentNodeId(run);
  if (!atId) return map.nodes.filter((n) => n.col === 0);
  const neighbors = map.nodes.filter((n) =>
    map.edges.some((e) =>
      (e.from === atId && e.to === n.id && lit(e)) ||
      (e.torch && e.to === atId && e.from === n.id && lit(e)),
    ),
  );
  const open = neighbors.filter((n) => !isCleared(run, n.id));
  if (open.length > 0) return open;
  // 兜底：相邻节点的前进目标已全部清理（如火把线绕路后）时，放行已清理节点作为通道，避免地图卡死
  return neighbors;
}

// 火把线是否两端都已连通到已清理区域（用于 UI 判断能否点亮）
export function torchLinkOf(run: RunState, fromId: string, toId: string) {
  const map = currentMap(run);
  const e = map.edges.find((x) =>
    x.torch && ((x.from === fromId && x.to === toId) || (x.from === toId && x.to === fromId)),
  );
  return e ?? null;
}

/**
 * 消耗一根火把点亮一条上下联通线（两端互通）。
 * 条件：有火把、线存在且未点亮、恰好一端已清理。
 */
export function openTorchLink(run: RunState, aId: string, bId: string): RunState {
  if (run.torches < 1) return run;
  const key = torchEdgeKey(aId, bId);
  if (run.openedEdges.includes(key)) return run;
  const e = torchLinkOf(run, aId, bId);
  if (!e) return run;
  if (isCleared(run, e.from) === isCleared(run, e.to)) return run;
  const next = structuredClone(run);
  next.torches -= 1;
  next.openedEdges.push(key);
  return stackTorchBless(next, 1);
}

// 消耗火把时叠加「火把神的祝福」层数（每消耗1根+1层，上限由遗物定义）
export function stackTorchBless(run: RunState, count: number): RunState {
  if (count <= 0 || !run.relics.includes('rl_torch_bless')) return run;
  const relic = RELIC_MAP['rl_torch_bless'];
  if (!relic || relic.effect.kind !== 'torchHpPerTorch') return run;
  const max = relic.effect.maxStacks;
  const cur = run.relicStacks?.['rl_torch_bless'] ?? 0;
  if (cur >= max) return run;
  const next = structuredClone(run);
  next.relicStacks = { ...(next.relicStacks ?? {}), rl_torch_bless: Math.min(max, cur + count) };
  return next;
}

export const canEnter = (run: RunState, nodeId: string) =>
  availableNodes(run).some((n) => n.id === nodeId);

function mergeDrops(run: RunState, drops: RunDrops): void {
  run.coins += Math.max(0, Math.floor(drops.coins));
  for (const d of drops.materials) {
    if (d.count <= 0) continue;
    const found = run.pendingMaterials.find((m) => m.itemId === d.itemId);
    if (found) found.count += d.count;
    else run.pendingMaterials.push({ itemId: d.itemId, count: d.count });
  }
}

// 层数遗物叠层（上限10）；水晶每升一层同步补足全体成员对应的当前生命/魔力
// （生命水晶 +20 上限/层，魔力水晶 +10 上限/层，与 outerStats 的固定加成一致）
function bumpCrystal(run: RunState, id: string): void {
  run.relicStacks ??= {};
  const before = run.relicStacks[id] ?? 0;
  const after = Math.min(CRYSTAL_CAP, before + 1);
  run.relicStacks[id] = after;
  const gained = after - before;
  if (gained <= 0 || !run.relics.includes(id)) return;
  const per = id === LIFE_CRYSTAL_ID ? 20 : id === MANA_CRYSTAL_ID ? 10 : 0;
  if (per <= 0) return;
  for (const [cid, cur] of Object.entries(run.hpMp)) {
    run.hpMp[cid] = id === LIFE_CRYSTAL_ID
      ? { ...cur, hp: cur.hp + per * gained }
      : { ...cur, mp: cur.mp + per * gained };
  }
}

// 节点清理后的层推进：一层行商→二层；二层BOSS→三层；三层BOSS→（终局联系）四层/通关
// 每进入新的一层，生命水晶层数+1，选定节点重置（新层首列重新选择）
function advanceAfter(run: RunState, node: MapNode): void {
  let advanced = false;
  if (run.dungeonId === 'crisisContract') {
    // 危机合约：线性布局，最终 BOSS 节点通关即胜利
    if (node.kind === 'boss') run.result = 'win';
    return;
  }
  if (run.act === 1 && node.kind === 'merchant') { run.act = 2; advanced = true; }
  else if (run.act === 2 && node.kind === 'boss') { run.act = 3; advanced = true; }
  else if (run.act === 3 && node.kind === 'boss') {
    if (run.relics.includes('rl_endgame_link')) { run.act = 4; advanced = true; }
    else if (run.dungeonId === 'preWallCalamity') { run.act = 4; advanced = true; }
    else run.result = 'win';
  }
  else if (run.act === 4 && node.kind === 'boss') {
    if (run.dungeonId === 'preWallCalamity') { run.act = 5; advanced = true; }
    else run.result = 'win';
  }
  else if (run.act === 5 && node.kind === 'boss') {
    if (run.relics.includes('rl_pain_village_letter')) { run.act = 6; advanced = true; }
    else run.result = 'win';
  }
  else if (run.act === 6 && node.kind === 'boss') {
    if (run.relics.includes('rl_abyss_invite')) { run.act = 7; advanced = true; }
    else run.result = 'win';
  }
  else if (run.act === 7 && node.kind === 'boss') run.result = 'win';
  if (advanced) {
    run.at = null;
    bumpCrystal(run, LIFE_CRYSTAL_ID);
    // 迷藏：进入新一层时随机标记一个节点（非BOSS），经过时获得随机遗物
    if (run.relics.includes('rl_hide_seek')) {
      const map = run.acts[run.act as 1 | 2 | 3 | 4 | 5 | 6 | 7];
      if (map && map.nodes.length > 0) {
        const candidates = map.nodes.filter((n) => n.kind !== 'boss');
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          pick.hidden = true;
        }
      }
    }
  }
}

/**
 * 清理一个节点（占位节点直接通过 / 战斗胜利后调用）。
 * drops：该节点作战的固定掉落（材料暂存通关入仓，哈哈币立即加入共享池）。
 * rng：传入时按 普通25%/紧急50%/BOSS100% 判定作战胜利掉一根火把。
 */
export function resolveNode(run: RunState, nodeId: string, drops?: RunDrops, rng?: Rng, skipRewards?: boolean): RunState {
  if (!canEnter(run, nodeId) && !isCleared(run, nodeId)) return run;
  const found = findNode(run, nodeId);
  if (!found) return run;
  if (isCleared(run, nodeId)) {
    // 已清理节点：仅移动选定框（作为通道通行），不重复结算，避免火把线绕路后卡死
    const next = structuredClone(run);
    next.at = nodeId;
    return next;
  }
  const next = structuredClone(run);
  next.cleared.push(nodeId);
  next.at = nodeId; // 选定框随清理移动到新节点
  // 痛苦之村求救信：每走一个节点，层数+1，全体最大生命-2%×层数（上限削减90%）
  if (next.relics.includes('rl_pain_village_letter')) {
    next.plagueLetterStacks = (next.plagueLetterStacks ?? 0) + 1;
  }
  // 迷藏：经过有迷藏标志的节点，随机获得一件遗物
  if (found.node.hidden && next.relics.includes('rl_hide_seek')) {
    found.node.hidden = false;
    const pool = inPoolRelics().filter((x) => !next.relics.includes(x.id) && !isUnimplemented(x));
    if (pool.length > 0) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      next.relics.push(pick.id);
      next.hiddenRelicGain = pick.id;
    }
  }
  if (!skipRewards) {
    // 挑战紧急事件/BOSS关胜利：魔力水晶层数+1
    if (found.node.kind === 'boss' || (found.node.kind === 'combat' && found.node.urgent)) {
      bumpCrystal(next, MANA_CRYSTAL_ID);
    }
    // 杀人书：每通关一次作战，层数+1（上限由遗物定义，局外攻击+X%/层）
    if ((found.node.kind === 'combat' || found.node.kind === 'boss') && next.relics.includes('rl_kill_book')) {
      const def = RELIC_MAP.rl_kill_book;
      const max = def?.effect.kind === 'killBook' ? def.effect.maxStacks : 10;
      next.killBook = Math.min(max, (next.killBook ?? 0) + 1);
    }
  }
  if (drops) mergeDrops(next, cloneDrops(drops));
  if (rng && !skipRewards && rollTorchDrop(found.node, rng, next.dungeonId)) next.torches = Math.min(TORCH_CAP, next.torches + 1);

  // 竞技场贵宾券：每场战斗额外获得X币
  if (!skipRewards && (found.node.kind === 'combat' || found.node.kind === 'boss')) {
    const arena = RELIC_MAP.rl_arena_ticket;
    if (next.relics.includes('rl_arena_ticket') && arena?.effect.kind === 'enemyHpUpCoins') {
      next.coins += arena.effect.coins;
    }
    // 失落之钥：3场诅咒作战，第3场结束后获得X币
    const lostKey = RELIC_MAP.rl_lost_key;
    if (next.relics.includes('rl_lost_key') && lostKey?.effect.kind === 'threeBattleCurse') {
      const cnt = (next.threeBattleCurseCount ?? 0) + 1;
      if (cnt <= 3) {
        next.threeBattleCurseCount = cnt;
        if (cnt === 3) {
          next.coins += lostKey.effect.coins;
        }
      }
    }
  }

  if (next.act === 'sub') {
    const sub = next.sublayer!;
    const node = sub.nodes.find((n) => n.id === nodeId)!;
    const isLast = !sub.edges.some((e) => e.from === node.id);
    if (isLast) {
      // 子层全清：回到进入时所在层，异界来客节点视为已清理，选定框落回该节点
      next.subDone = true;
      next.doneSublayers = [...(next.doneSublayers ?? []), next.sublayerName ?? '未知子层'];
      if (next.visitorNodeId) {
        next.cleared.push(next.visitorNodeId);
        next.at = next.visitorNodeId;
      }
      next.visitorNodeId = null;
      next.act = next.subReturnAct ?? 3;
      next.subReturnAct = undefined;
    }
  } else {
    advanceAfter(next, found.node);
  }
  return next;
}

// 异界来客：进入指定名称的子层（连续 5 节点，全清后回到三层）。需消耗 1 根火把。
export function enterSublayer(
  run: RunState,
  visitorNodeId: string,
  sublayerName: string,
  stages: StageDef[],
  rng: Rng,
): RunState {
  // 子层入口：新手村仅限3层；灾厄泰拉 3/4/5 层均可进入对应子层
  const subAllowedActs = run.dungeonId === 'preWallCalamity' ? [3, 4, 5] : [3];
  // 每个子层完成一次后不可再进；不同子层互不影响（旧档 subDone 不再作为全局锁）
  if (typeof run.act !== 'number' || !subAllowedActs.includes(run.act)) return run;
  if ((run.doneSublayers ?? []).includes(sublayerName)) return run;
  if (run.torches < 1) return run;
  const next = structuredClone(run);
  next.torches -= 1;
  next.sublayer = buildSublayer(stages, sublayerName, rng, run.relics.includes('rl_endgame_link'));
  next.sublayerName = sublayerName;
  next.visitorNodeId = visitorNodeId;
  next.subReturnAct = run.act as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  next.act = 'sub';
  // 子层也算一层：进入时生命水晶 +1 层（每层 +20 生命上限，上限 10 层）
  if (next.relics.includes(LIFE_CRYSTAL_ID)) bumpCrystal(next, LIFE_CRYSTAL_ID);
  // at 保持不变（指向三层节点，不在子层地图内）——currentNodeId 兜底为空时子层首节点可选
  return stackTorchBless(next, 1);
}

// 战斗结束回写成员生命/魔力（跨战斗继承；buff 不写入，下场战斗自然清空）
export function applyBattleHpMp(
  run: RunState,
  survivors: { id: string; hp: number; mp: number }[],
): RunState {
  const next = structuredClone(run);
  for (const s of survivors) {
    if (next.hpMp[s.id]) {
      next.hpMp[s.id] = {
        hp: Math.max(0, Math.floor(s.hp)),
        mp: Math.max(0, Math.floor(s.mp)),
      };
    }
  }
  return next;
}

// 途中获得的遗物挂到本次 run（仅本次副本生效）
export function gainRunRelics(run: RunState, relicIds: string[]): RunState {
  if (relicIds.length === 0) return run;
  const next = structuredClone(run);
  for (const id of relicIds) {
    if (!next.relics.includes(id)) next.relics.push(id);
  }
  return next;
}

/**
 * 拾取即效遗物统一结算（walkRelicEffects）：
 * - torchOnPickup：获得火把
 * - healOnPickup：立刻回复生命（需 maxHp）
 * - grantRelics：随机获得 N 个未拥有的随机池遗物，并递归结算新遗物自身的拾取效果
 * - grantItem（宝箱）：直接获得时由调用方各自开箱；递归获得（如谷地树实开出宝箱）时在此开箱，
 *   返回 chests 由调用方写入队员背包（默认队长）
 * directMode 控制「直接获得」的那批遗物如何结算，避免与调用方已做的工作重复：
 * - 'full'（商店/失与得/遗物测试）：直接获得 = 完整结算
 * - 'torchHeal'（战斗掉落 applyPickRewards）：直接获得 = 仅火把/回复（谷地树实/宝箱已由拾取面板展开）
 * - 'grantOnly'（事件）：直接获得 = 仅展开谷地树实（火把/回复已由 applyPickRewards 结算）
 */
function walkRelicEffects(
  run: RunState,
  gained: string[],
  rng: Rng,
  maxHpMp: Record<string, { hp: number; mp: number }> | undefined,
  directMode: 'full' | 'torchHeal' | 'grantOnly',
  items?: Item[],
  level?: number,
): { run: RunState; texts: string[]; chests: { relicId: string; item: Item }[] } {
  let next = structuredClone(run);
  const texts: string[] = [];
  const chests: { relicId: string; item: Item }[] = [];
  const processed = new Set<string>();
  const direct = new Set(gained);
  const queue = [...gained];
  let guard = 0;
  while (queue.length > 0 && guard < 64) {
    guard++;
    const id = queue.shift()!;
    if (processed.has(id)) continue;
    processed.add(id);
    const def = RELIC_MAP[id];
    if (!def) continue;
    if (!next.relics.includes(id)) next.relics.push(id);
    const eff = def.effect;
    const isDirect = direct.has(id);
    if (eff.kind === 'grantRelics') {
      if (isDirect && directMode === 'torchHeal') continue; // 战斗掉落：拾取面板已展开衍生卡
      const owned = new Set(next.relics);
      const pool = inPoolRelics().filter((x) => !owned.has(x.id) && !isUnimplemented(x));
      for (let i = 0; i < eff.count && pool.length > 0; i++) {
        const idx = rng.int(0, pool.length - 1);
        const pick = pool.splice(idx, 1)[0]!;
        if (!next.relics.includes(pick.id)) {
          next.relics.push(pick.id);
          texts.push(`额外获得遗物【${pick.name}】`);
          queue.push(pick.id);
        }
      }
      continue;
    }
    if (isDirect && directMode === 'grantOnly') continue; // 事件：火把/回复已由 applyPickRewards 结算
    if (eff.kind === 'torchOnPickup') {
      next.torches = (next.torches ?? 0) + eff.amount;
      texts.push(`获得 ${eff.amount} 根火把`);
      continue;
    }
    if (eff.kind === 'healOnPickup' && maxHpMp) {
      for (const [cid, cur] of Object.entries(next.hpMp)) {
        const max = maxHpMp[cid];
        if (!max) continue;
        if (eff.full) next.hpMp[cid] = { ...cur, hp: max.hp };
        else if (eff.hpPct) {
          next.hpMp[cid] = { ...cur, hp: Math.min(max.hp, cur.hp + Math.ceil(max.hp * eff.hpPct)) };
        }
      }
      continue;
    }
    if (eff.kind === 'torchHealOnPickup') {
      next.torches = (next.torches ?? 0) + eff.torch;
      texts.push(`获得 ${eff.torch} 根火把`);
      if (maxHpMp) {
        for (const [cid, cur] of Object.entries(next.hpMp)) {
          const max = maxHpMp[cid];
          if (!max) continue;
          next.hpMp[cid] = {
            hp: Math.min(max.hp, cur.hp + Math.ceil(max.hp * eff.hpPct)),
            mp: Math.min(max.mp, cur.mp + Math.ceil(max.mp * eff.mpPct)),
          };
        }
        texts.push(`全队恢复 ${Math.round(eff.hpPct * 100)}% HP、${Math.round(eff.mpPct * 100)}% MP`);
      }
      continue;
    }
    if (eff.kind === 'grantItem' && !isDirect && items && level !== undefined) {
      // 递归获得宝箱：开箱（直接获得的宝箱由调用方各自处理）
      const it = openChestRelic(items, eff.rarity, level, rng);
      if (it) {
        chests.push({ relicId: id, item: it });
        texts.push(`开启【${def.name}】获得藏品【${it.name}】`);
      }
      continue;
    }
    if (eff.kind === 'grantCoins') {
      next.coins = (next.coins ?? 0) + eff.amount;
      texts.push(`获得 ${eff.amount} 哈哈币`);
      continue;
    }
    if (eff.kind === 'grantMaterials') {
      const existing = next.pendingMaterials.find((m) => m.itemId === eff.itemId);
      if (existing) existing.count += eff.count;
      else next.pendingMaterials = [...(next.pendingMaterials ?? []), { itemId: eff.itemId, count: eff.count }];
      texts.push(`获得 ${eff.count} 个【${eff.itemId}】`);
      continue;
    }
    // 招募类遗物：设置下一个招募单位的加成
    if (eff.kind === 'nextRecruitSpd' || eff.kind === 'nextRecruitDmgNoSkill' || eff.kind === 'nextRecruitAtk') {
      const cur = next.nextRecruitBonus ?? {};
      if (eff.kind === 'nextRecruitSpd') cur.spd = (cur.spd ?? 0) + eff.amount;
      if (eff.kind === 'nextRecruitAtk') cur.atkPct = (cur.atkPct ?? 0) + eff.pct;
      if (eff.kind === 'nextRecruitDmgNoSkill') { cur.dmgPct = (cur.dmgPct ?? 0) + eff.dmgPct; cur.noSkill = true; }
      next.nextRecruitBonus = cur;
      texts.push(`下一个招募单位获得加成`);
      continue;
    }
    // 迷藏：拾取时在当前层随机标记一个节点
    if (eff.kind === 'hiddenNode') {
      const map = next.act === 'sub' ? next.sublayer : next.acts[next.act as 1 | 2 | 3 | 4 | 5 | 6 | 7];
      if (map) {
        const candidates = map.nodes.filter((n) => n.kind !== 'boss' && !n.hidden && !next.cleared.includes(n.id));
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          pick.hidden = true;
        }
      }
      continue;
    }
  }
  return { run: next, texts, chests };
}

// 完整结算：商店 / 失与得 / 遗物测试获得遗物时使用
export function applyRelicPickupEffects(
  run: RunState,
  gained: string[],
  rng: Rng = mathRng,
  maxHpMp?: Record<string, { hp: number; mp: number }>,
  items?: Item[],
  level?: number,
): { run: RunState; texts: string[]; chests: { relicId: string; item: Item }[] } {
  return walkRelicEffects(run, gained, rng, maxHpMp, 'full', items, level);
}

// 事件路径：applyPickRewards 之后展开谷地树实等额外遗物（直接遗物的火把/回复不重复结算）
export function expandGrantRelics(
  run: RunState,
  gained: string[],
  rng: Rng = mathRng,
  maxHpMp?: Record<string, { hp: number; mp: number }>,
  items?: Item[],
  level?: number,
): { run: RunState; texts: string[]; chests: { relicId: string; item: Item }[] } {
  return walkRelicEffects(run, gained, rng, maxHpMp, 'grantOnly', items, level);
}

// 递归开箱（谷地树实开出宝箱等）的藏品写入队长背包；材料进共享材料仓库
export function grantChestItems(
  save: SaveData,
  run: RunState,
  chests: { item: Item }[],
): SaveData {
  if (chests.length === 0) return save;
  const s = structuredClone(save);
  const leader = s.characters.find((c) => c?.id === run.party.leaderId);
  if (!leader) return s;
  const invIds: string[] = [];
  for (const c of chests) {
    if (c.item.slot === 'material') {
      const found = s.materials.find((m) => m.itemId === c.item.id);
      if (found) found.count += 1;
      else s.materials.push({ itemId: c.item.id, count: 1 });
    } else {
      invIds.push(c.item.id);
    }
  }
  if (invIds.length > 0) leader.inventory = [...(leader.inventory ?? []), ...invIds];
  return s;
}

// ===== 宝箱（grantItem 遗物）=====
// 当前副本等级（宝箱/随机藏品按此等级抽取）
export const dungeonLevelOf = (dungeonId: string): number =>
  DUNGEONS.find((d) => d.id === dungeonId)?.level ?? 10;

// 是否为宝箱遗物（获得时立即开箱出藏品，而非仅挂到遗物栏）
export const isChestRelic = (relicId: string): boolean =>
  RELIC_MAP[relicId]?.effect.kind === 'grantItem';

// 痛苦之村求救信：根据层数计算最大生命削减比例（2%×层数，上限90%）
export function plagueLetterHpDown(run: RunState): number {
  const stacks = run.plagueLetterStacks ?? 0;
  const relic = RELIC_MAP.rl_pain_village_letter;
  const pct = relic?.effect.kind === 'maxHpDownPerNode' ? relic.effect.pct : 2;
  return Math.min(0.9, (stacks * pct) / 100);
}

// 编队各成员在当前遗物/层数下的生命与魔力上限（用于上限提升时同步补足当前值）
export function maxHpMpOf(
  save: SaveData,
  run: RunState,
  items: Map<string, Item>,
): Record<string, { hp: number; mp: number }> {
  const out: Record<string, { hp: number; mp: number }> = {};
  partyMembers(run.party, save.characters).forEach((c, i) => {
    const u = buildAllyCombatant(c, items, i, {
      relics: run.relics, relicStacks: run.relicStacks, killBook: run.killBook,
      maxHpPctDown: plagueLetterHpDown(run),
    });
    out[c.id] = { hp: u.maxHp, mp: u.maxMp };
  });
  return out;
}

/**
 * 计算危机合约当前实际得分：仅累计已通关关卡的基础分 + 全部词条分。
 * 逐关计分：未通关的关卡不计入基础分。
 */
/**
 * 计算某关卡在选中词条下的得分（基础分 + 通用词条加成 + 该关专属词条分）。
 * 通用词条的加分对每一关都生效（非单次）。
 */
export function calcCrisisStageScore(stageId: string, termIds: string[]): number {
  const base = CRISIS_STAGE_BASE_SCORE[stageId] ?? 0;
  const universalBonus = termIds
    .map((id) => CRISIS_TERMS.find((t) => t.id === id))
    .filter((t): t is CrisisTerm => !!t && t.category === 'universal')
    .reduce((s, t) => s + t.score, 0);
  const exclusiveBonus = termIds
    .map((id) => CRISIS_TERMS.find((t) => t.id === id))
    .filter((t): t is CrisisTerm => !!t && t.category === 'exclusive' && t.stageId === stageId)
    .reduce((s, t) => s + t.score, 0);
  return base + universalBonus + exclusiveBonus;
}

/**
 * 危机合约逐关计分：仅已通关的关卡计入得分。
 * 通用词条加成对每一关都生效；专属词条仅对其对应关卡生效。
 */
export function calcCrisisRunScore(run: RunState): number {
  if (!run.crisis) return 0;
  const clearedStageIds = new Set<string>();
  const map = run.acts[1];
  if (map) {
    for (const n of map.nodes) {
      if (n.stageId && run.cleared.includes(n.id)) clearedStageIds.add(n.stageId);
    }
  }
  return [...clearedStageIds]
    .reduce((sum, sid) => sum + calcCrisisStageScore(sid, run.crisis!.termIds), 0);
}

/**
 * 危机合约分数结算：将本次合约得分（按已通关关卡计算）记录到编队全员的 crisisScore（取历史最高）。
 * 按单人/双人模式分别记录最高分。仅当 run 为危机合约时生效；无论通关或失败都调用。
 */
export function settleCrisisScore(save: SaveData, run: RunState): SaveData {
  if (!run.crisis) return save;
  const score = calcCrisisRunScore(run);
  const mode = run.crisis.mode; // 'single' | 'dual'
  const memberIds = new Set(run.party.memberIds);
  const next = structuredClone(save);
  for (const c of next.characters) {
    if (!c || !memberIds.has(c.id)) continue;
    const prev = c.crisisScore?.[run.dungeonId];
    // 旧档兼容：prev 可能是 number（迁移到 single）
    const prevObj: { single?: number; dual?: number } =
      typeof prev === 'number' ? { single: prev } : (prev ?? {});
    const cur = prevObj[mode] ?? 0;
    if (score > cur) {
      prevObj[mode] = score;
      c.crisisScore = { ...(c.crisisScore ?? {}), [run.dungeonId]: prevObj };
    }
  }
  return next;
}

// 上限提升后同步补足当前生命/魔力：仅补正差量，并钳制到新上限（上限下降时自然压回）
export function syncHpMpOnMaxUp(
  hpMp: RunState['hpMp'],
  before: Record<string, { hp: number; mp: number }>,
  after: Record<string, { hp: number; mp: number }>,
): RunState['hpMp'] {
  const out = { ...hpMp };
  for (const [id, a] of Object.entries(after)) {
    const cur = out[id];
    const b = before[id];
    if (!cur || !b) continue;
    const dHp = Math.max(0, a.hp - b.hp);
    const dMp = Math.max(0, a.mp - b.mp);
    if (dHp === 0 && dMp === 0 && cur.hp <= a.hp && cur.mp <= a.mp) continue;
    out[id] = {
      hp: Math.min(a.hp, Math.max(0, Math.floor(cur.hp)) + dHp),
      mp: Math.min(a.mp, Math.max(0, Math.floor(cur.mp)) + dMp),
    };
  }
  return out;
}
