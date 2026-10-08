import type {
  DropEntry, DropKind, FixedDrop, Item, LuckyDrop, Rarity, RarityWeights, Relic, Rng, StageDef,
} from '../types';
import { DROP_POOL_RARITIES } from '../types';

export const COIN_NAME = '哈哈币';

const RARITY_SHORT: Record<Rarity, string> = {
  common: '普通', uncommon: '优秀', fine: '精良', rare: '稀有', epic: '史诗', legendary: '传说',
};

// 随机藏品池只从装备部位抽取（武器/头盔/防具/靴子/饰品）
const EQUIP_SLOTS = new Set(['weapon', 'helmet', 'armor', 'boots', 'accessory']);

export interface DropContext {
  items: Item[];
  relics: Relic[];
  // 本次副本已获得的遗物 id 集合：随机遗物掉落按此去重（指定遗物不去重）
  owned?: Set<string>;
}

// 掉落结算结果（一条配置 → 一件奖励）
export type DropReward =
  | { kind: 'item'; item: Item }
  | { kind: 'relic'; relic: Relic }
  | { kind: 'material'; item: Item; count: number }
  | { kind: 'consumable'; item: Item; count: number }
  | { kind: 'coin'; count: number };

function pickOne<T>(pool: T[], rng: Rng): T | null {
  if (pool.length === 0) return null;
  return pool[rng.int(0, pool.length - 1)];
}

// 随机藏品：匹配稀有度+等级（rarity 缺省表示不筛稀有度；level 缺省表示不限等级），只抽装备部位
// inPool=false 的藏品不进随机池
export function pickPoolItem(items: Item[], rarity: Rarity | undefined, level?: number): Item[] {
  return items.filter(
    (i) => i.inPool !== false &&
      EQUIP_SLOTS.has(i.slot) &&
      (rarity === undefined || i.rarity === rarity) &&
      (level === undefined || (i.level ?? 0) === level),
  );
}

// 宝箱开箱（grantItem 遗物：木/银/黄金/钻石宝箱）：抽一件当前副本等级+指定稀有度的藏品；
// 若该副本等级暂无匹配藏品，则回退到不限等级（保证宝箱必能开出藏品）
export function openChestRelic(
  items: Item[],
  rarity: Rarity | undefined,
  level: number | undefined,
  rng: Rng,
): Item | null {
  let pool = pickPoolItem(items, rarity, level);
  if (pool.length === 0 && level !== undefined) pool = pickPoolItem(items, rarity);
  if (pool.length === 0) return null;
  return pool[rng.int(0, pool.length - 1)];
}


function pickPoolRelic(relics: Relic[], rarity: Rarity | undefined, owned?: Set<string>): Relic[] {
  // inPool=false 的遗物（水晶/祭坛等指定获取）不进随机池；已拥有的遗物不再重复掉落
  return relics.filter(
    (r) => r.inPool !== false &&
      (rarity === undefined || r.rarity === rarity) &&
      (owned === undefined || !owned.has(r.id)),
  );
}

// 随机稀有度分布：按 rarityWeights（合计100）掷一个稀有度；未配置/全为0时等概率
export function rollRarity(weights: RarityWeights | undefined, rng: Rng): Rarity {
  const entries = DROP_POOL_RARITIES.map((r) => [r, weights?.[r] ?? 0] as const);
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (total <= 0) return entries[rng.int(0, entries.length - 1)][0];
  let roll = rng.int(1, total);
  for (const [r, w] of entries) {
    roll -= Math.max(0, w);
    if (roll <= 0) return r;
  }
  return entries[entries.length - 1][0];
}

export const rarityWeightsTotal = (w: RarityWeights | undefined): number =>
  DROP_POOL_RARITIES.reduce((s, r) => s + Math.max(0, w?.[r] ?? 0), 0);

// 把一条掉落配置解析为具体奖励（池配置在调用时才随机抽取）
export function resolveDrop(
  kind: DropKind,
  source: 'pool' | 'specific',
  ctx: DropContext,
  rng: Rng,
  opts: { rarity?: Rarity; rarityWeights?: RarityWeights; level?: number; targetId?: string; count?: number },
): DropReward | null {
  if (kind === 'coin') {
    return { kind: 'coin', count: Math.max(1, Math.floor(opts.count ?? 1)) };
  }
  if (kind === 'material' || kind === 'consumable') {
    const slot = kind === 'material' ? 'material' : 'consumable';
    if (source === 'specific') {
      const item = ctx.items.find((i) => i.id === opts.targetId && i.slot === slot);
      return item ? { kind, item, count: 1 } : null;
    }
    const item = pickOne(ctx.items.filter((i) => i.slot === slot && i.inPool !== false), rng);
    return item ? { kind, item, count: 1 } : null;
  }
  // 随机池且稀有度选「随机」：先按分布掷稀有度
  const rarity = source === 'pool' && opts.rarity === undefined
    ? rollRarity(opts.rarityWeights, rng)
    : opts.rarity;
  if (kind === 'item') {
    if (source === 'specific') {
      const item = ctx.items.find((i) => i.id === opts.targetId);
      return item ? { kind: 'item', item } : null;
    }
    const item = pickOne(pickPoolItem(ctx.items, rarity, opts.level), rng);
    return item ? { kind: 'item', item } : null;
  }
  if (source === 'specific') {
    const relic = ctx.relics.find((r) => r.id === opts.targetId);
    return relic ? { kind: 'relic', relic } : null;
  }
  const relic = pickOne(pickPoolRelic(ctx.relics, rarity, ctx.owned), rng);
  return relic ? { kind: 'relic', relic } : null;
}

// ===== 方案1：归一掉落表，一次只掉一件 =====
// 权重合计应为100（创建器校验）；引擎按总权重容忍滚动，空表/空池返回 null。
export function rollStageDrop(stage: StageDef, ctx: DropContext, rng: Rng): DropReward | null {
  if (stage.drops.length === 0) return null;
  const total = stage.drops.reduce((sum, d) => sum + Math.max(0, d.weight), 0);
  if (total <= 0) return null;
  let roll = rng.int(1, total);
  let chosen: DropEntry | undefined;
  for (const d of stage.drops) {
    roll -= Math.max(0, d.weight);
    if (roll <= 0) { chosen = d; break; }
  }
  chosen ??= stage.drops[stage.drops.length - 1];
  return resolveDrop(chosen.kind, chosen.source, ctx, rng, {
    rarity: chosen.rarity, rarityWeights: chosen.rarityWeights,
    level: chosen.level, targetId: chosen.targetId, count: chosen.count,
  });
}

export interface LuckyDropResult {
  threshold: number;
  roll: number; // 1D50 的点数
  total: number; // 幸运 + roll
  success: boolean; // 判定是否通过
  kind: DropKind; // 该条配置的掉落种类（供调用方区分「池已集齐」等场景）
  source: 'pool' | 'specific';
  reward: DropReward | null; // 通过时解析出的奖励（空池可能为 null）
}

// ===== 幸运掉落：每条独立判定，幸运+1D50 ≥ 判定值则获得；无论成败都返回该条 =====
export function rollLuckyDrops(
  stage: StageDef,
  luck: number,
  ctx: DropContext,
  rng: Rng,
): LuckyDropResult[] {
  // 本次幸运掉落内已获得的遗物：避免多条幸运掉落同时抽到相同遗物
  const acquired = new Set(ctx.owned);
  return stage.luckyDrops.map((d) => {
    const roll = rng.int(1, 50);
    const total = luck + roll;
    if (total < d.threshold) {
      return { threshold: d.threshold, roll, total, success: false, reward: null, kind: d.kind, source: d.source };
    }
    const reward = resolveDrop(d.kind, d.source, { ...ctx, owned: acquired }, rng, {
      rarity: d.rarity, rarityWeights: d.rarityWeights,
      level: d.level, targetId: d.targetId, count: d.count,
    });
    if (reward?.kind === 'relic') acquired.add(reward.relic.id);
    return { threshold: d.threshold, roll, total, success: true, reward, kind: d.kind, source: d.source };
  });
}

export const dropsWeightTotal = (stage: StageDef): number =>
  stage.drops.reduce((sum, d) => sum + Math.max(0, d.weight), 0);

// ===== 固定掉落：通关必得（材料进共享仓库，哈哈币进副本共享币池，藏品/消耗品待分配，遗物挂副本）=====
export interface FixedDropReward {
  materials: { item: Item; count: number }[];
  coins: number;
  items: Item[]; // 藏品/消耗品实例（每件一条）
  relics: Relic[];
}

export function rollFixedDrops(stage: StageDef, ctx: DropContext, rng: Rng): FixedDropReward {
  const out: FixedDropReward = { materials: [], coins: 0, items: [], relics: [] };
  // 本次固定掉落内去重（固定遗物若配置重复或与已拥有重复则跳过）
  const seen = new Set(ctx.owned);
  const addMaterial = (item: Item, count: number) => {
    const found = out.materials.find((m) => m.item.id === item.id);
    if (found) found.count += count;
    else out.materials.push({ item, count });
  };
  for (const d of stage.fixedDrops ?? []) {
    if (d.kind === 'coin') {
      if (d.count > 0) out.coins += d.count;
    } else if (d.kind === 'material' && d.targetId) {
      const item = ctx.items.find((i) => i.id === d.targetId && (i.slot === 'material' || i.slot === 'blueprint'));
      if (item) addMaterial(item, Math.max(1, Math.floor(d.count)));
    } else if (d.kind === 'item' && d.targetId) {
      const item = ctx.items.find((i) => i.id === d.targetId && i.slot !== 'material' && i.slot !== 'blueprint');
      if (item) out.items.push(item);
    } else if (d.kind === 'relic' && d.targetId) {
      const relic = ctx.relics.find((r) => r.id === d.targetId);
      if (relic && !seen.has(relic.id)) {
        out.relics.push(relic);
        seen.add(relic.id);
      }
    } else if (d.kind === 'random' && d.candidates && d.candidates.length > 0) {
      const c = d.candidates[rng.int(0, d.candidates.length - 1)];
      if (c.kind === 'coin') {
        if (c.count > 0) out.coins += c.count;
      } else if (c.kind === 'material' && c.targetId) {
        const item = ctx.items.find((i) => i.id === c.targetId && (i.slot === 'material' || i.slot === 'blueprint'));
        if (item) addMaterial(item, Math.max(1, Math.floor(c.count)));
      } else if (c.kind === 'item' && c.targetId) {
        const item = ctx.items.find((i) => i.id === c.targetId && i.slot !== 'material' && i.slot !== 'blueprint');
        if (item) out.items.push(item);
      } else if (c.kind === 'relic' && c.targetId) {
        const relic = ctx.relics.find((r) => r.id === c.targetId);
        if (relic && !seen.has(relic.id)) {
          out.relics.push(relic);
          seen.add(relic.id);
        }
      }
      // 候选失效配置静默跳过
    }
  }
  return out;
}

export function describeFixedDrop(
  d: FixedDrop,
  itemMap: Map<string, Item>,
  relicMap?: Map<string, Relic>,
): string {
  if (d.kind === 'coin') return `${COIN_NAME}×${d.count}`;
  if (d.kind === 'random') {
    const parts = (d.candidates ?? []).map((c) => {
      if (c.kind === 'coin') return `${COIN_NAME}×${c.count}`;
      const name = c.kind === 'relic'
        ? (relicMap?.get(c.targetId ?? '')?.name ?? '（已失效遗物）')
        : (itemMap.get(c.targetId ?? '')?.name ?? '（已失效物品）');
      return `${name}${c.kind === 'material' ? `×${c.count}` : ''}`;
    });
    return `随机：${parts.join('/') || '空'}`;
  }
  if (d.kind === 'material') {
    const name = itemMap.get(d.targetId ?? '')?.name ?? '（已失效材料）';
    return `${name}×${d.count}`;
  }
  const name = d.kind === 'relic'
    ? (relicMap?.get(d.targetId ?? '')?.name ?? '（已失效遗物）')
    : (itemMap.get(d.targetId ?? '')?.name ?? '（已失效物品）');
  return name;
}

// ===== UI/日志用的人类可读描述 =====
export function describeDrop(
  d: DropEntry | LuckyDrop,
  itemMap: Map<string, Item>,
  relicMap: Map<string, Relic>,
): string {
  const kindText = (k: DropKind) =>
    k === 'item' ? '藏品' : k === 'relic' ? '遗物' : k === 'material' ? '材料' : k === 'consumable' ? '消耗品' : '哈哈币';
  const suffix = 'count' in d && d.count ? `×${d.count}` : '';
  let target: string;
  if (d.source === 'specific') {
    const name = d.kind === 'relic'
      ? relicMap.get(d.targetId ?? '')?.name
      : itemMap.get(d.targetId ?? '')?.name;
    target = `${name ?? '（已失效物品）'}${suffix}`;
  } else if (d.kind === 'coin') {
    target = `${COIN_NAME}×${d.count ?? 1}`;
  } else if (d.kind === 'material' || d.kind === 'consumable') {
    target = `随机${kindText(d.kind)}`;
  } else {
    const rarityText = d.rarity
      ? ({ common: '普通', uncommon: '优秀', fine: '精良', rare: '稀有', epic: '史诗', legendary: '传说' } as const)[d.rarity]
      : '';
    const levelText = d.kind === 'item' && d.level !== undefined ? `${d.level}级` : '';
    const distText = !d.rarity && d.rarityWeights && rarityWeightsTotal(d.rarityWeights) > 0
      ? `（${DROP_POOL_RARITIES.filter((r) => (d.rarityWeights![r] ?? 0) > 0)
          .map((r) => `${RARITY_SHORT[r]}${d.rarityWeights![r]}%`).join('/')}）`
      : '';
    target = `${levelText}随机${rarityText}${kindText(d.kind)}${distText}`;
  }
  return 'weight' in d ? `${d.weight}% ${target}` : target;
}
