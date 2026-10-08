// ===== 副本节点系统引擎 =====
// 诡异行商（买卖/刷新）、失与得（交换+幸运升品）、安全的角落（意志恢复）
// 纯逻辑层，与 React 解耦；商品价格与刷新机制仅作用于当前副本（run 状态内）。
import type {
  Character, ExtraStats, HaggleResult, Item, MerchantShop, MerchantSlot, Rarity, RarityWeights, Relic, Rng, RunState, SaveData, StageDef, StageMechanic,
} from '../types';
import { mathRng } from '../types';
import { RELIC_MAP, RELICS, inPoolRelics, isUnimplemented, sumRelicSixStats } from '../data/relics';
import { ITEMS } from '../data/items';
import { allItems } from '../data/content';
import { DUNGEONS } from '../data/dungeons';
import { openChestRelic, rollRarity } from './drops';
import { applyRelicPickupEffects, grantChestItems, maxHpMpOf, syncHpMpOnMaxUp } from './run';
import { persistRun } from '../save/storage';
import { statCheck } from './events';
import { collectExtraBonus, equippedIds } from './stats';
import { JOB_IMAGES } from '../assets/config';

// ===== 诡异行商 =====
// 商品价格：藏品/遗物按品质 优秀1500/精良2500/稀有3500/史诗5000；药水固定1000；出售=50%
export const MERCHANT_RARITIES: Rarity[] = ['uncommon', 'fine', 'rare', 'epic'];
export const MERCHANT_RARITY_WEIGHTS: RarityWeights = {
  uncommon: 40, fine: 30, rare: 20, epic: 10,
};
export const MERCHANT_PRICE: Record<Rarity, number> = {
  common: 0, uncommon: 1500, fine: 2500, rare: 3500, epic: 5000, legendary: 0,
};
// 灾厄泰拉行商价格
export const CALAMITY_MERCHANT_PRICE: Record<Rarity, number> = {
  common: 0, uncommon: 2000, fine: 3000, rare: 5000, epic: 7000, legendary: 10000,
};
export const POTION_PRICE = 1000;
export const SELL_RATIO = 0.5;

export const merchantBuyPrice = (rarity: Rarity): number => MERCHANT_PRICE[rarity] ?? 0;
// 出售价格 = 对应档位购买价格的 50%
// 30级（灾厄泰拉）藏品按 CALAMITY_MERCHANT_PRICE；其余按 MERCHANT_PRICE
export const merchantSellPrice = (item: Item): number => {
  const table = (item.level ?? 0) >= 30 ? CALAMITY_MERCHANT_PRICE : MERCHANT_PRICE;
  return Math.round((table[item.rarity] ?? 0) * SELL_RATIO);
};
export const potionSellPrice = (): number => Math.round(POTION_PRICE * SELL_RATIO);

// 仅装备类藏品进商店/失与得：排除消耗品、材料、图纸
const EQUIP_ONLY = (i: Item): boolean =>
  i.slot !== 'consumable' && i.slot !== 'material' && i.slot !== 'blueprint';

/**
 * 生成一摊行商商品：4 件藏品 + 4 件遗物（各按 优秀40/精良30/稀有20/史诗10 掷品质，
 * 池空自动重掷并兜底任意品质）+ 2 种药水（各1个）。
 * 遗物排除：不入随机池的（inPool=false）、未实装的、本局已拥有的（不卖重复遗物）。
 * 藏品排除：已被本摊抽中的（4件互不重复）、等级超过副本等级的。
 */
export function rollMerchantShop(opts: {
  items: Item[];
  relics: Relic[];
  owned: Set<string>; // 本局已拥有的遗物 id（去重）
  rng: Rng;
  level: number; // 副本等级：藏品等级不超过该值
  runRelics?: string[]; // 本次副本已持有的遗物（用于商店折扣/免费商品）
  endgame?: boolean; // 终局联系：商品基础价格+1000
  dungeonId?: string; // 灾厄泰拉分支用
}): MerchantShop {
  const { items, relics, owned, rng, level, endgame, dungeonId } = opts;
  const isCalamity = dungeonId === 'preWallCalamity';
  const priceTable = isCalamity ? CALAMITY_MERCHANT_PRICE : MERCHANT_PRICE;
  const buyPrice = (rarity: Rarity) => (priceTable[rarity] ?? 0) + (endgame ? 1000 : 0);
  const slots: MerchantSlot[] = [];
  const usedItems = new Set<string>();
  const usedRelics = new Set<string>();

  const poolOf = (rarity: Rarity, kind: 'item' | 'relic') => kind === 'item'
    ? items.filter((i) => EQUIP_ONLY(i) && i.rarity === rarity && i.inPool !== false &&
        (isCalamity ? (i.level ?? 0) === level : (i.level ?? 0) <= level) && !usedItems.has(i.id))
    : relics.filter((x) => x.inPool !== false && x.rarity === rarity &&
        !isUnimplemented(x) && !owned.has(x.id) && !usedRelics.has(x.id));

  const pickFrom = (pool: (Item | Relic)[], kind: 'item' | 'relic', rarity: Rarity): MerchantSlot | null => {
    if (pool.length === 0) return null;
    const one = pool[rng.int(0, pool.length - 1)];
    if (kind === 'item') usedItems.add(one.id);
    else usedRelics.add(one.id);
    return { kind, id: one.id, price: buyPrice(rarity), sold: false };
  };

  const rollSlot = (kind: 'item' | 'relic'): MerchantSlot | null => {
    // 按品质概率掷；该品质池空则重掷（最多10次），仍空则兜底任意品质
    for (let i = 0; i < 10; i++) {
      const rarity = rollRarity(MERCHANT_RARITY_WEIGHTS, rng);
      const slot = pickFrom(poolOf(rarity, kind), kind, rarity);
      if (slot) return slot;
    }
    const fallback = kind === 'item'
      ? items.filter((i) => EQUIP_ONLY(i) && i.inPool !== false && (isCalamity ? (i.level ?? 0) === level : (i.level ?? 0) <= level) && !usedItems.has(i.id))
      : relics.filter((x) => x.inPool !== false && !isUnimplemented(x) &&
          !owned.has(x.id) && !usedRelics.has(x.id));
    const rarity = fallback.length ? fallback[0].rarity : 'uncommon';
    return pickFrom(fallback, kind, rarity);
  };

  for (let i = 0; i < 4; i++) {
    const s = rollSlot('item');
    if (s) slots.push(s);
  }
  for (let i = 0; i < 4; i++) {
    const s = rollSlot('relic');
    if (s) slots.push(s);
  }

  // 2 种药水瓶（各1个）：灾厄泰拉只售中级药水（2000），其余优先小型HP药 / 小型MP药，缺则从目录里补
  const potions = items.filter((i) => i.slot === 'consumable' && (i.usable?.hp || i.usable?.mp));
  const potionPick: Item[] = [];
  const preferredIds = isCalamity
    ? ['it_potion_hp_m', 'it_potion_mp_m']
    : ['it_potion_hp_s', 'it_potion_mp_s'];
  for (const id of preferredIds) {
    const p = potions.find((x) => x.id === id);
    if (p) potionPick.push(p);
  }
  for (const p of potions) {
    if (potionPick.length >= 2) break;
    if (!potionPick.includes(p)) potionPick.push(p);
  }
  const potionPrice = isCalamity ? 2000 : POTION_PRICE + (endgame ? 1000 : 0);
  for (const p of potionPick.slice(0, 2)) {
    slots.push({ kind: 'potion', id: p.id, price: potionPrice, sold: false });
  }

  // 灾厄泰拉：额外 2 个强化石（稀有/史诗/传说随机）
  if (isCalamity) {
    const stoneIds = ['it_stone_rare', 'it_stone_epic', 'it_stone_legendary'];
    for (let i = 0; i < 2; i++) {
      const sid = stoneIds[rng.int(0, stoneIds.length - 1)];
      const stone = items.find((x) => x.id === sid);
      if (stone) {
        slots.push({ kind: 'material', id: sid, price: buyPrice(stone.rarity), sold: false });
      }
    }
  }

  // 商店类遗物效果（折扣 & 免费）统一在展示期由 shopPriceMul / shopFreeCount 实时计算，
  // 保证「购买锈蚀的铁链 / 坎诺特触须后价格即时生效」。此处不再烙入 slot.price。

  return { slots };
}

// 遗物商店折扣倍率：持有「商店售价-X%」遗物（如锈蚀的铁链）时实时生效
export function shopDiscountMul(relicIds: string[]): number {
  let pct = 0;
  for (const id of relicIds) {
    const r = RELIC_MAP[id];
    if (r?.effect.kind === 'shopDiscountPct') pct = Math.max(pct, r.effect.pct);
  }
  return Math.max(0, 1 - pct);
}

// 商店免费商品数：持有「商店随机N件免费」遗物（如坎诺特的触须）时实时生效
export function shopFreeCount(relicIds: string[]): number {
  let n = 0;
  for (const id of relicIds) {
    const r = RELIC_MAP[id];
    if (r?.effect.kind === 'shopFreeRandom') n += r.effect.count;
  }
  return n;
}

// 商店免费槽位：从全部槽位中确定性随机选取 freeCount 个（基于槽位 id 哈希，
// 保证同一商店跨渲染稳定；免费数增加时只会追加新的免费槽位，不会打乱已选）
export function shopFreeSlotIndices(slots: MerchantSlot[], freeCount: number): Set<number> {
  const out = new Set<number>();
  if (freeCount <= 0 || slots.length === 0) return out;
  // 以所有槽位 id 拼接串作为种子，保证同一商店结果稳定
  const seed = slots.map((s) => s.id).join('|');
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const order = slots.map((_, i) => i);
  // Fisher–Yates 洗牌（伪随机，由种子驱动）
  for (let i = order.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < freeCount && i < order.length; i++) out.add(order[i]);
  return out;
}

// 商店最终价格倍率：持有遗物折扣时与砍价取最优（谁便宜用谁）不叠加；
// 无遗物折扣时砍价原样生效（含涨价 120% 等情形）
export function shopPriceMul(relicIds: string[], haggle?: HaggleResult): number {
  const chainMul = shopDiscountMul(relicIds);
  if (chainMul >= 1) return haggle?.discountPct ?? 1;
  return Math.min(chainMul, haggle?.discountPct ?? 1);
}

/**
 * 进入行商节点时确保货摊已生成并持久化（首次生成后不再变；刷新次数也记录在内）。
 * 已生成则原样返回，不重复生成。
 */
export function ensureMerchantShop(save: SaveData, nodeId: string, rng: Rng): SaveData {
  const run = save.activeRun;
  if (!run) return save;
  const st = run.nodeStates?.[nodeId];
  if (st && st.kind === 'merchant') return save;
  const dungeon = DUNGEONS.find((d) => d.id === run.dungeonId);
  const shop = rollMerchantShop({
    items: allItems(save),
    relics: RELICS,
    owned: new Set(run.relics ?? []),
    rng,
    level: dungeon?.level ?? 10,
    runRelics: run.relics ?? [],
    endgame: run.relics.includes('rl_endgame_link'),
    dungeonId: run.dungeonId,
  });
  const nextRun: RunState = {
    ...run,
    nodeStates: { ...(run.nodeStates ?? {}), [nodeId]: { kind: 'merchant', shop, refreshed: false, refreshCount: 0 } },
  };
  return persistRun(save, nextRun);
}

// 抢店成功：本摊全部商品价格置 0 + 标记已抢 + 本局已抢标记（其余行商节点变空摊）
export function robMerchantShop(run: RunState, nodeId: string): RunState {
  const st = run.nodeStates?.[nodeId];
  const next: RunState = { ...run, robbedShop: true };
  if (st && st.kind === 'merchant') {
    next.nodeStates = {
      ...(run.nodeStates ?? {}),
      [nodeId]: {
        ...st,
        robbed: true,
        shop: { slots: st.shop.slots.map((s) => ({ ...s, price: 0 })) },
      },
    };
  }
  return next;
}

// ===== 失与得 =====
// 幸运判定：幸运 + 1D50，结果「超过60」时交换物品品质提升一档（本次副本阈值60）
export const TRADE_LUCK_THRESHOLD = 60;

export function tradeLuckRoll(luck: number, rng: Rng): { roll: number; total: number; pass: boolean } {
  const roll = rng.int(1, 50);
  const total = luck + roll;
  return { roll, total, pass: total > TRADE_LUCK_THRESHOLD };
}

// 品质提升一档：普通→优秀→精良→稀有→史诗；当前版本没有传说，史诗交换后仍为史诗
export const RARITY_UPGRADE: Record<Rarity, Rarity> = {
  common: 'uncommon',
  uncommon: 'fine',
  fine: 'rare',
  rare: 'epic',
  epic: 'epic',
  legendary: 'legendary',
};
export const upgradeRarity = (r: Rarity): Rarity => RARITY_UPGRADE[r] ?? r;

// 交换藏品的目标池：装备部位、指定稀有度、等级≤副本等级、排除被交换的那件；
// 灾厄泰拉（isCalamity）：只出副本等级藏品（===level），且排除非随机池藏品（inPool=false，如巨大龟壳/大房子等固定掉落物）
export function tradeItemPool(items: Item[], rarity: Rarity, excludeId: string, level: number, isCalamity: boolean = false): Item[] {
  return items.filter(
    (i) => EQUIP_ONLY(i) && i.rarity === rarity && i.id !== excludeId && i.inPool !== false &&
      (isCalamity ? (i.level ?? 0) === level : (i.level ?? 0) <= level),
  );
}

// 交换遗物的目标池：随机池内、已实装、排除本局已拥有的遗物（避免换到重复）
export function tradeRelicPool(run: RunState, rarity: Rarity): Relic[] {
  return inPoolRelics().filter(
    (x) => x.rarity === rarity && !isUnimplemented(x) && !run.relics.includes(x.id),
  );
}

// ===== 失与得：交换执行（防重复刷取）=====
export interface TradeOutcome {
  save: SaveData;
  run: RunState;
  text: string;
  chest?: { itemId: string; text: string }; // 换得宝箱已开出，待玩家指定接收队员
  grant?: { itemId: string; text: string }; // 换得藏品已确定，待玩家指定接收队员
  error?: string; // 池空等失败原因：不消耗任何东西、不标记节点已使用
}

const markTradeUsed = (r: RunState, nodeId: string): RunState => {
  const isCalamity = r.dungeonId === 'preWallCalamity';
  const maxExchanges = isCalamity ? 2 : 1;
  const prev = r.nodeStates?.[nodeId];
  const prevCount = prev && prev.kind === 'trade' ? (prev.exchangeCount ?? 0) : 0;
  const newCount = prevCount + 1;
  r.nodeStates = {
    ...(r.nodeStates ?? {}),
    [nodeId]: { kind: 'trade', used: newCount >= maxExchanges, exchangeCount: newCount },
  };
  return r;
};

/**
 * 失与得：仅在玩家点击「交换」时调用——此刻才掷点确定交换结果并立即落定（标记节点已使用）。
 * 弹窗阶段不产生任何随机结果；关闭「交换/不交换」弹窗后节点状态原封不动，但玩家看不到结果，
 * 交换物只有提交时才确定，因此无法通过反复开关弹窗刷取目标物。
 * 池空/找不到目标时返回 error：不消耗、不标记已使用，可再次尝试（但结果依然只在提交时确定）。
 */
export function executeTrade(opts: {
  save: SaveData;
  run: RunState;
  kind: 'item' | 'relic';
  memberId?: string;
  itemId?: string;
  relicId?: string;
  items: Item[];
  luck: number;
  rng: Rng;
  nodeId: string;
  level: number;
  dungeonId?: string; // 灾厄泰拉：交换池只出副本等级且排除非随机池藏品
}): TradeOutcome {
  const { save, run, kind, items, luck, rng, nodeId, level } = opts;
  const isCalamity = opts.dungeonId === 'preWallCalamity';
  let s = structuredClone(save);
  let r = structuredClone(run);
  const roll = tradeLuckRoll(luck, rng);
  const fail = (error: string): TradeOutcome => ({ save: s, run: r, text: '', error });

  if (kind === 'item') {
    const item = items.find((i) => i.id === opts.itemId);
    if (!item) return fail('未找到该藏品');
    const targetRarity = roll.pass ? upgradeRarity(item.rarity) : item.rarity;
    const pool = tradeItemPool(items, targetRarity, item.id, level, isCalamity);
    if (pool.length === 0) return fail('同稀有度暂无其它藏品可换');
    const newItem = pool[rng.int(0, pool.length - 1)];
    const c = s.characters.find((x) => x?.id === opts.memberId);
    if (!c) return fail('未找到接收队员');
    const inv = [...(c.inventory ?? [])];
    const idx = inv.indexOf(item.id);
    if (idx >= 0) inv.splice(idx, 1);
    c.inventory = inv; // 交出的藏品从原主人背包移除
    const upgraded = roll.pass && newItem.rarity !== item.rarity;
    const text = `「${item.name}」换得「${newItem.name}」${upgraded ? '（品质提升！）' : ''}`;
    // 换得的藏品暂不入库，由玩家选择接收队员（前端弹窗后写入所选角色背包）
    return { save: s, run: markTradeUsed(r, nodeId), text, grant: { itemId: newItem.id, text } };
  }

  const relic = RELIC_MAP[opts.relicId ?? ''];
  if (!relic) return fail('未找到该遗物');
  const targetRarity = roll.pass ? upgradeRarity(relic.rarity) : relic.rarity;
  const pool = tradeRelicPool(r, targetRarity);
  if (pool.length === 0) return fail('该稀有度遗物池暂无其它可选');
  const newRelic = pool[rng.int(0, pool.length - 1)];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const before = maxHpMpOf(s, r, itemMap);
  r.relics = r.relics.filter((id) => id !== relic.id);
  r.relics.push(newRelic.id);
  // 换得遗物拾取即效：火把 / 回复 / 谷地树实等额外遗物（宝箱走下方 chest 单独结算）
  const pk = applyRelicPickupEffects(r, [newRelic.id], rng, before);
  r = pk.run;
  if (pk.chests.length > 0) s = grantChestItems(s, r, pk.chests);
  r.hpMp = syncHpMpOnMaxUp(r.hpMp, before, maxHpMpOf(s, r, itemMap));
  const upgraded = roll.pass && newRelic.rarity !== relic.rarity;
  const extra = pk.texts.length > 0 ? `，${pk.texts.join('；')}` : '';
  let text = `「${relic.name}」换得「${newRelic.name}」${upgraded ? '（品质提升！）' : ''}${extra}`;
  if (newRelic.effect.kind === 'grantItem') {
    const it = openChestRelic(items, newRelic.effect.rarity, level, rng);
    if (it) {
      r = markTradeUsed(r, nodeId);
      return { save: s, run: r, text, chest: { itemId: it.id, text: `${text}，并开启宝箱获得「${it.name}」` } };
    }
  }
  r = markTradeUsed(r, nodeId);
  return { save: s, run: r, text };
}

// ===== 魅力砍价 =====
// 判定点数 = 魅力 + 1D50：≥80 五折 / ≥70 七折 / ≥60 八折；<40 惹恼行商涨价至 120%；40–59 原价
export const HAGGLE_TIERS: { min: number; pct: number; label: string }[] = [
  { min: 80, pct: 0.5, label: '五折' },
  { min: 70, pct: 0.7, label: '七折' },
  { min: 60, pct: 0.8, label: '八折' },
];

export function haggleRoll(cha: number, rng: Rng): HaggleResult {
  const roll = rng.int(1, 50);
  const total = cha + roll;
  const tier = HAGGLE_TIERS.find((t) => total >= t.min);
  const discountPct = tier ? tier.pct : total < 40 ? 1.2 : 1;
  return { roll, total, discountPct };
}

// 砍价后的实际价格（未砍价 = 原价）
export const hagglePrice = (price: number, h: HaggleResult | undefined): number =>
  h ? Math.max(0, Math.round(price * h.discountPct)) : price;

// 折扣率文案（用于界面提示）
export const haggleLabel = (pct: number): string =>
  pct < 1 ? HAGGLE_TIERS.find((t) => t.pct === pct)?.label ?? `${Math.round(pct * 100)}%`
    : pct > 1 ? `涨价至 ${Math.round(pct * 100)}%` : '原价';

// ===== 安全的角落 =====
// 恢复比例 = (意志 + 1D50)%，封顶 100%（超出即满血/满蓝）
export function restHealPercent(will: number, rng: Rng, dungeonId: string = 'starterVillage'): { roll: number; pct: number } {
  const roll = rng.int(1, 50);
  if (dungeonId === 'preWallCalamity') {
    // 灾厄泰拉：(20 + (1D50 + 意志) * 0.5)%
    return { roll, pct: Math.min(100, 20 + (roll + will) * 0.5) };
  }
  return { roll, pct: Math.min(100, will + roll) };
}

// ===== 命运所指（第四层）=====
// 6 个选项依次处理，对马神残躯进行削弱
export type FateOptionAction = 'check' | 'payRelics' | 'payCoins' | 'payPotions' | 'skip';

// 玩家自选上交的药水：{ 角色id, 物品id } 数组
export type PotionSelection = { charId: string; itemId: string };

export interface FateOptionResult {
  run: RunState;
  message: string;
  success: boolean; // 该选项是否已完成（判定成功或上交成功）
}

// 计算队长六维（角色基础 + 装备 extraBonus + 遗物 sixStats）
export function leaderSixStats(run: RunState, characters: Character[]): ExtraStats {
  const leader = characters.find((c) => c.id === run.party.leaderId);
  if (!leader) return { str: 0, int: 0, agi: 0, luk: 0, cha: 0, wil: 0 };
  const itemMap = new Map(allItems({ customItems: [] }).map((i) => [i.id, i]));
  const equipped = equippedIds(leader.equip).map((id) => itemMap.get(id)!).filter(Boolean);
  const base = leader.extra ?? { str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 10 };
  const eq = collectExtraBonus(equipped);
  // 遗物 sixStats 加成
  const relic = sumRelicSixStats(run.relics);
  const keys: (keyof ExtraStats)[] = ['str', 'int', 'agi', 'luk', 'cha', 'wil'];
  const out: ExtraStats = { str: 0, int: 0, agi: 0, luk: 0, cha: 0, wil: 0 };
  for (const k of keys) {
    out[k] = (base[k] ?? 0) + (eq[k] ?? 0) + (relic[k] ?? 0);
  }
  return out;
}

// 随机移除 N 个随机池遗物（非随机池的不移除）
function removeRandomPoolRelics(run: RunState, n: number, rng: Rng): { run: RunState; removed: string[] } {
  const poolIds = run.relics.filter((id) => {
    const r = RELIC_MAP[id];
    return r && r.inPool !== false;
  });
  if (poolIds.length < n) return { run, removed: [] };
  const shuffled = [...poolIds].sort(() => rng.int(0, 1000) - 500);
  const toRemove = new Set(shuffled.slice(0, n));
  const next = structuredClone(run);
  next.relics = run.relics.filter((id) => !toRemove.has(id));
  return { run: next, removed: [...toRemove] };
}

// 按玩家自选的药水清单扣除（仅 consumable 槽位物品视为药水）
function removeSpecificPotions(
  run: RunState,
  characters: Character[],
  selections: PotionSelection[],
): { run: RunState; removed: string[]; ok: boolean } {
  const itemMap = new Map(allItems({ customItems: [] }).map((i) => [i.id, i]));
  const removed: string[] = [];
  const next = structuredClone(run);
  const charMap = new Map(characters.map((c) => [c.id, c]));
  // 仅允许上交当前副本编队成员的药水
  const partyIds = new Set(run.party.memberIds);
  // 按角色分组
  const byChar = new Map<string, string[]>();
  for (const sel of selections) {
    if (!partyIds.has(sel.charId)) continue; // 非编队成员的药水直接忽略
    const arr = byChar.get(sel.charId) ?? [];
    arr.push(sel.itemId);
    byChar.set(sel.charId, arr);
  }
  for (const [charId, itemIds] of byChar) {
    const ch = charMap.get(charId);
    if (!ch) continue;
    const bag = structuredClone(ch.bag);
    for (const itemId of itemIds) {
      const g = bag.find((x) => x.itemId === itemId);
      const item = itemMap.get(itemId);
      if (!g || g.count <= 0 || !item || item.slot !== 'consumable') continue;
      g.count -= 1;
      removed.push(item.name);
    }
    ch.bag = bag.filter((g) => g.count > 0);
  }
  const ok = removed.length === selections.length;
  if (!ok) return { run, removed: [], ok: false };
  return { run: next, removed, ok: true };
}

// 标记当前命运选项已尝试过判定（判定只能一次）
function markFateChecked(run: RunState, nodeId: string): RunState {
  const next = structuredClone(run);
  const ns = next.nodeStates?.[nodeId];
  if (ns?.kind === 'fate') ns.checked = true;
  return next;
}

// 处理命运所指单个选项
export function resolveFateOption(
  run: RunState,
  nodeId: string,
  optionIndex: number,
  action: FateOptionAction,
  rng: Rng,
  characters: Character[],
  potionSelections?: PotionSelection[],
): FateOptionResult {
  const stats = leaderSixStats(run, characters);
  const debuffs = run.fateBossDebuffs ?? {};
  const applyDebuff = (patch: Partial<NonNullable<RunState['fateBossDebuffs']>>, msg: string, baseRun: RunState = run): FateOptionResult => {
    const next = structuredClone(baseRun);
    next.fateBossDebuffs = { ...(baseRun.fateBossDebuffs ?? {}), ...patch };
    return { run: next, message: msg, success: true };
  };

  // 跳过：不削弱，直接进入下一项（必须在各选项分支之前，否则会被提前 return）
  if (action === 'skip') {
    return { run, message: '选择不削弱，马神残躯保持原状。', success: true };
  }

  // 选项 0-3：属性判定
  if (optionIndex <= 3) {
    const statKey = (['str', 'wil', 'cha', 'agi'] as const)[optionIndex];
    const statName = (['力量', '意志', '魅力', '敏捷'] as const)[optionIndex];
    const cutValue = [80, 100, 1000, 0][optionIndex];
    const cutName = (['攻击力-80', '防御力-100', '生命上限-1000', '速度固定5-5'] as const)[optionIndex];

    if (action === 'check') {
      const checkedRun = markFateChecked(run, nodeId);
      const check = statCheck(stats[statKey] ?? 0, 60, rng);
      if (check.pass) {
        const patch = optionIndex === 0 ? { atkCut: (debuffs.atkCut ?? 0) + cutValue }
          : optionIndex === 1 ? { defCut: (debuffs.defCut ?? 0) + cutValue }
          : optionIndex === 2 ? { hpCut: (debuffs.hpCut ?? 0) + cutValue }
          : { spdFixed: true };
        const next = structuredClone(checkedRun);
        next.fateBossDebuffs = { ...(checkedRun.fateBossDebuffs ?? {}), ...patch };
        return { run: next, message: `${statName}判定成功（${check.total}≥60），马神残躯${cutName}！`, success: true };
      }
      return { run: checkedRun, message: `${statName}判定失败（${check.total}<60），可上交3个随机池遗物或10000哈哈币换取削弱。`, success: false };
    }
    if (action === 'payRelics') {
      const { run: r2, removed } = removeRandomPoolRelics(run, 3, rng);
      if (removed.length < 3) return { run, message: '随机池遗物不足3个，无法上交。', success: false };
      const names = removed.map((id) => RELIC_MAP[id]?.name ?? id).join('、');
      const patch = optionIndex === 0 ? { atkCut: (debuffs.atkCut ?? 0) + cutValue }
        : optionIndex === 1 ? { defCut: (debuffs.defCut ?? 0) + cutValue }
        : optionIndex === 2 ? { hpCut: (debuffs.hpCut ?? 0) + cutValue }
        : { spdFixed: true };
      return applyDebuff(patch, `上交遗物「${names}」，马神残躯${cutName}！`, r2);
    }
    if (action === 'payCoins') {
      if (run.coins < 10000) return { run, message: '哈哈币不足10000。', success: false };
      const next = structuredClone(run);
      next.coins -= 10000;
      const patch = optionIndex === 0 ? { atkCut: (debuffs.atkCut ?? 0) + cutValue }
        : optionIndex === 1 ? { defCut: (debuffs.defCut ?? 0) + cutValue }
        : optionIndex === 2 ? { hpCut: (debuffs.hpCut ?? 0) + cutValue }
        : { spdFixed: true };
      next.fateBossDebuffs = { ...debuffs, ...patch };
      return { run: next, message: `花费10000哈哈币，马神残躯${cutName}！`, success: true };
    }
  }

  // 选项 4：上交3药水 → 失去回血能力
  if (optionIndex === 4) {
    if (action !== 'payPotions') return { run, message: '请上交3瓶任意药水。', success: false };
    if (!potionSelections || potionSelections.length !== 3) {
      return { run, message: '请选择3瓶药水。', success: false };
    }
    const { run: r2, removed, ok } = removeSpecificPotions(run, characters, potionSelections);
    if (!ok) return { run, message: '药水选择无效，请重新选择3瓶药水。', success: false };
    return applyDebuff({ noRegen: true }, `上交药水「${removed.join('、')}」，马神残躯失去回血能力！`, r2);
  }

  // 选项 5：上交3遗物或10000币 → 失去伤害上限
  if (optionIndex === 5) {
    if (action === 'payRelics') {
      const { run: r2, removed } = removeRandomPoolRelics(run, 3, rng);
      if (removed.length < 3) return { run, message: '随机池遗物不足3个，无法上交。', success: false };
      const names = removed.map((id) => RELIC_MAP[id]?.name ?? id).join('、');
      return applyDebuff({ noDmgCap: true }, `上交遗物「${names}」，马神残躯失去伤害上限！`, r2);
    }
    if (action === 'payCoins') {
      if (run.coins < 10000) return { run, message: '哈哈币不足10000。', success: false };
      const next = structuredClone(run);
      next.coins -= 10000;
      next.fateBossDebuffs = { ...debuffs, noDmgCap: true };
      return { run: next, message: '花费10000哈哈币，马神残躯失去伤害上限！', success: true };
    }
    return { run, message: '请上交3个遗物或10000哈哈币。', success: false };
  }

  return { run, message: '未知选项。', success: false };
}

// 命运所指节点状态：step=已处理选项数
export function getFateStep(run: RunState, nodeId: string): number {
  const ns = run.nodeStates?.[nodeId];
  if (ns?.kind === 'fate') return ns.step;
  return 0;
}

// 当前选项是否已尝试过判定
export function getFateChecked(run: RunState, nodeId: string): boolean {
  const ns = run.nodeStates?.[nodeId];
  if (ns?.kind === 'fate') return ns.checked ?? false;
  return false;
}

export function advanceFateStep(run: RunState, nodeId: string): RunState {
  const next = structuredClone(run);
  const ns = next.nodeStates?.[nodeId];
  if (ns?.kind === 'fate') {
    ns.step += 1;
    ns.checked = false;
    if (ns.step >= 6) ns.used = true;
  }
  return next;
}

// ===== 灾厄泰拉：祭坛（二层首列）=====
export type AltarChoice = 'crimson' | 'corruption' | 'both' | 'leave';

export const ALTAR_RELICS: Record<'crimson' | 'corruption', string> = {
  crimson: 'rl_altar_crimson',
  corruption: 'rl_altar_corruption',
};

export function resolveAltar(run: RunState, nodeId: string, choice: AltarChoice): RunState {
  const next = structuredClone(run);
  next.nodeStates = { ...next.nodeStates, [nodeId]: { kind: 'altar', choice } };
  const addRelic = (id: string) => {
    if (!next.relics.includes(id)) next.relics.push(id);
  };
  if (choice === 'crimson' || choice === 'both') addRelic(ALTAR_RELICS.crimson);
  if (choice === 'corruption' || choice === 'both') addRelic(ALTAR_RELICS.corruption);
  return next;
}

// ===== 灾厄泰拉：王牌招募 =====
import { ACE_UNITS, ACE_UNITS_BY_RARITY, ACE_UNIT_MAP } from '../data/aceUnits';

export const CALAMITY_MAX_PARTY = 3;

export interface RecruitCandidate {
  type: 'own' | 'ace';
  id: string; // 角色 id 或王牌单位 id
  name: string;
  rarity?: 'rare' | 'epic';
  stats: { hp: number; atk: number; def: number };
  icon?: string; // 展示立绘：王牌单位取 ACE_UNITS.icon，自有角色取 JOB_IMAGES
}

// 从名册+王牌单位中抽取 3 名候选
export function rollRecruitCandidates(run: RunState, characters: Character[], rng: Rng): RecruitCandidate[] {
  const partyIds = new Set(run.party.memberIds);
  const recruitedOwn = new Set(run.recruitedOwnChars ?? []);
  const ownCount = run.party.memberIds.filter((id) => !run.aceUnits?.includes(id)).length;

  const cands: RecruitCandidate[] = [];
  // 名册角色（不含参与者、已招募）
  const ownPool = characters.filter(
    (c) => c && !partyIds.has(c.id) && !recruitedOwn.has(c.id),
  );
  // 名册不足或已有 2 名自有角色时，全部用王牌单位
  const useAceOnly = ownCount >= 2 || ownPool.length === 0;

  if (!useAceOnly) {
    const shuffled = [...ownPool].sort(() => rng.int(0, 1) - 0.5);
    for (const c of shuffled.slice(0, 3)) {
      cands.push({ type: 'own', id: c.id, name: c.name, icon: JOB_IMAGES[c.job], stats: { hp: 100 + c.level * 15, atk: 10 + c.level * 2, def: 5 + c.level } });
    }
  }
  // 不足 3 名时用王牌单位补齐（70%稀有 / 30%史诗）
  while (cands.length < 3) {
    const isEpic = rng.int(1, 100) <= 30;
    const pool = isEpic ? ACE_UNITS_BY_RARITY.epic : ACE_UNITS_BY_RARITY.rare;
    const available = pool.filter((a) => !cands.some((c) => c.id === a.id));
    if (available.length === 0) {
      // 该稀有度候选用尽，从全部王牌单位中取
      const allAvail = ACE_UNITS.filter((a) => !cands.some((c) => c.id === a.id));
      if (allAvail.length === 0) break;
      const ace = allAvail[rng.int(0, allAvail.length - 1)];
      cands.push({ type: 'ace', id: ace.id, name: ace.name, rarity: ace.rarity, icon: ace.icon, stats: { hp: ace.stats.hp, atk: ace.stats.atk, def: ace.stats.def } });
    } else {
      const ace = available[rng.int(0, available.length - 1)];
      cands.push({ type: 'ace', id: ace.id, name: ace.name, rarity: ace.rarity, icon: ace.icon, stats: { hp: ace.stats.hp, atk: ace.stats.atk, def: ace.stats.def } });
    }
  }
  return cands.slice(0, 3);
}

// 灾厄重返家园：仅抽取指定稀有度的王牌单位候选
export function rollAceCandidatesByRarity(
  run: RunState,
  rarity: 'rare' | 'epic',
  count: number,
  rng: Rng,
): RecruitCandidate[] {
  const partyIds = new Set(run.party.memberIds);
  const pool = ACE_UNITS_BY_RARITY[rarity].filter((a) => !partyIds.has(a.id));
  const shuffled = [...pool].sort(() => rng.int(0, 1) - 0.5);
  return shuffled.slice(0, count).map((ace) => ({
    type: 'ace' as const,
    id: ace.id,
    name: ace.name,
    rarity: ace.rarity,
    icon: ace.icon,
    stats: { hp: ace.stats.hp, atk: ace.stats.atk, def: ace.stats.def },
  }));
}

// 招募成员加入队伍（最多 3 人）
export function recruitMember(run: RunState, cand: RecruitCandidate): RunState {
  // 招募总额无上限；仅上场人数受3人限制（由 deployedIds 控制）
  const next = structuredClone(run);
  // 防御：同一成员/王牌单位不得重复入队（候选生成已过滤，此处兜底防止双写）
  if (next.party.memberIds.includes(cand.id)) return next;
  if (cand.type === 'own') {
    next.party.memberIds.push(cand.id);
    next.recruitedOwnChars = [...(next.recruitedOwnChars ?? []), cand.id];
    next.hpMp[cand.id] = { hp: 99999, mp: 99999 }; // 战斗时会被 clamp 到 maxHp/maxMp
  } else {
    next.party.memberIds.push(cand.id);
    next.aceUnits = [...(next.aceUnits ?? []), cand.id];
    const ace = ACE_UNIT_MAP[cand.id];
    next.hpMp[cand.id] = { hp: ace?.stats.hp ?? cand.stats.hp, mp: ace?.stats.mp ?? 99999 };
  }
  // 上场未满3人时自动将新成员排入上场名单
  const cur = next.party.deployedIds ?? next.party.memberIds.slice(0, 3);
  if (cur.length < 3) next.party.deployedIds = [...cur, cand.id];
  // 消耗下一个招募单位加成（疗养礼品卡/指中狼/老妈的鼓励）
  if (next.nextRecruitBonus) {
    next.recruitUnitBonuses = { ...(next.recruitUnitBonuses ?? {}), [cand.id]: { ...next.nextRecruitBonus } };
    next.nextRecruitBonus = undefined;
  }
  return next;
}

// 王牌单位转为战斗单位属性
export function aceUnitCombatant(aceId: string) {
  return ACE_UNIT_MAP[aceId];
}

// ===== 灾厄泰拉：狭路相逢 =====
// 狭路相逢关卡来自关卡库（appear='skirmish'），按 skirmishTier 分 1/2/3 档难度
export interface SkirmishTier {
  tier: 1 | 2 | 3;
  name: string;
  stageId: string;
  stageName: string;
  monsters: { monsterId: string; count: number }[];
  mechanics: StageMechanic[];
}

export function rollSkirmishTiers(rng: Rng, stages: StageDef[]): SkirmishTier[] {
  const skirmishStages = stages.filter((s) => s.appear === 'skirmish');
  const pickTier = (tier: 1 | 2 | 3): SkirmishTier => {
    const pool = skirmishStages.filter((s) => (s.skirmishTier ?? 1) === tier);
    const stage = pool.length > 0 ? pool[rng.int(0, pool.length - 1)] : null;
    return {
      tier,
      name: tier === 1 ? '第一档' : tier === 2 ? '第二档' : '第三档',
      stageId: stage?.id ?? '',
      stageName: stage?.name ?? `第${tier}档（暂无关卡）`,
      monsters: stage?.monsters ?? [],
      mechanics: stage?.mechanics ?? [],
    };
  };
  return [pickTier(1), pickTier(2), pickTier(3)];
}

export function skirmishRewards(tier: number, level: number = 30): { stones?: { itemId: string; count: number }[]; relic?: string; item?: string } {
  const rng = mathRng;
  // 随机遗物：按稀有度抽取（卡池为空时回落 epic，再回落任意在池遗物；inPool 未显式设置的遗物视为在池）
  const randomRelic = (rarity: Rarity): string => {
    let pool = RELICS.filter((r) => r.rarity === rarity && r.inPool !== false);
    if (pool.length === 0) pool = RELICS.filter((r) => r.rarity === 'epic' && r.inPool !== false);
    if (pool.length === 0) pool = RELICS.filter((r) => r.inPool !== false);
    if (pool.length === 0) return '';
    return pool[rng.int(0, pool.length - 1)]!.id;
  };
  // 随机藏品：按稀有度抽取非材料/图纸装备，且等级匹配副本等级（灾厄泰拉只出该副本等级藏品）
  const randomItem = (rarity: Rarity): string => {
    let pool = ITEMS.filter((i) => i.rarity === rarity && i.slot !== 'material' && i.slot !== 'blueprint' && (i.level ?? 0) === level);
    if (pool.length === 0) pool = ITEMS.filter((i) => i.slot !== 'material' && i.slot !== 'blueprint' && (i.level ?? 0) === level);
    if (pool.length === 0) return '';
    return pool[rng.int(0, pool.length - 1)]!.id;
  };
  // 稀有度权重（uncommon 40 / fine 30 / rare 20 / epic 10，无 legend 因卡池暂无）
  const rarityRoll = (): Rarity => {
    const roll = rng.int(1, 100);
    if (roll <= 40) return 'uncommon';
    if (roll <= 70) return 'fine';
    if (roll <= 90) return 'rare';
    return 'epic';
  };
  if (tier === 1) {
    return { stones: [{ itemId: 'it_stone_rare', count: 3 }], relic: randomRelic(rarityRoll()) };
  }
  if (tier === 2) {
    return { stones: [{ itemId: 'it_stone_epic', count: 3 }], relic: randomRelic(rarityRoll()), item: randomItem('rare') };
  }
  // tier 3
  return { stones: [{ itemId: 'it_stone_epic', count: 6 }], relic: randomRelic('epic'), item: randomItem('epic') };
}
