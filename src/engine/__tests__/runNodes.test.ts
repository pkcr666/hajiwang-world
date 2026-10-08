import { describe, expect, it } from 'vitest';
import type { Character, Item, Rarity, Relic, Rng, RunState, SaveData } from '../../types';
import {
  HAGGLE_TIERS, MERCHANT_PRICE, MERCHANT_RARITIES, POTION_PRICE, RARITY_UPGRADE, SELL_RATIO,
  TRADE_LUCK_THRESHOLD, ensureMerchantShop, executeTrade, haggleLabel, hagglePrice, haggleRoll,
  merchantBuyPrice, merchantSellPrice, potionSellPrice, restHealPercent, robMerchantShop,
  rollMerchantShop, shopDiscountMul, shopPriceMul, tradeItemPool, tradeLuckRoll, tradeRelicPool,
  upgradeRarity,
} from '../nodes';
import { inPoolRelics } from '../../data/relics';
import { persistRun } from '../../save/storage';

const fixedRng = (v: number): Rng => ({ int: () => v });
const scriptRng = (vals: number[]): Rng => ({ int: () => vals.shift()! });

const mkItem = (id: string, rarity: Rarity, level = 10, slot: Item['slot'] = 'weapon'): Item =>
  ({ id, name: id, slot, rarity, level, desc: '', price: 0 });
const mkRelic = (id: string, rarity: Rarity, extra: Partial<Relic> = {}): Relic =>
  ({ id, name: id, rarity, positive: true, desc: '', effect: { kind: 'lifeCrystal' }, ...extra });
const mkPotion = (id: string, usable: { hp?: number; mp?: number }): Item =>
  ({ id, name: id, slot: 'consumable', rarity: 'common', level: 1, desc: '', price: 30, usable });

const mkRun = (overrides: Partial<RunState> = {}): RunState => ({
  dungeonId: 'starterVillage',
  party: { leaderId: 'c1', memberIds: ['c1'] },
  acts: {
    1: { act: 1, cols: 2, rows: 1, nodes: [], edges: [] },
    2: { act: 2, cols: 2, rows: 1, nodes: [], edges: [] },
    3: { act: 3, cols: 2, rows: 1, nodes: [], edges: [] },
    4: { act: 4, cols: 2, rows: 1, nodes: [], edges: [] },
    5: { act: 5, cols: 0, rows: 0, nodes: [], edges: [] },
    6: { act: 6, cols: 0, rows: 0, nodes: [], edges: [] },
    7: { act: 7, cols: 0, rows: 0, nodes: [], edges: [] },
  },
  sublayer: null,
  act: 1,
  cleared: [],
  visitorNodeId: null,
  subDone: false,
  hpMp: { c1: { hp: 100, mp: 50 } },
  initialPool: 100,
  coins: 100,
  pendingMaterials: [],
  pendingItems: [],
  relics: [],
  torches: 2,
  openedEdges: [],
  createdAt: 1,
  ...overrides,
});

describe('诡异行商价格表', () => {
  it('购买价格：优秀1500/精良2500/稀有3500/史诗5000；普通/传说0', () => {
    expect(MERCHANT_PRICE.uncommon).toBe(1500);
    expect(MERCHANT_PRICE.fine).toBe(2500);
    expect(MERCHANT_PRICE.rare).toBe(3500);
    expect(MERCHANT_PRICE.epic).toBe(5000);
    expect(merchantBuyPrice('common')).toBe(0);
    expect(merchantBuyPrice('legendary')).toBe(0);
    expect(MERCHANT_RARITIES).toEqual(['uncommon', 'fine', 'rare', 'epic']);
  });

  it('出售价格 = 购买价格 × 50%（四舍五入）', () => {
    expect(SELL_RATIO).toBe(0.5);
    // 10级藏品按 MERCHANT_PRICE
    expect(merchantSellPrice(mkItem('u', 'uncommon'))).toBe(750);
    expect(merchantSellPrice(mkItem('f', 'fine'))).toBe(1250);
    expect(merchantSellPrice(mkItem('r', 'rare'))).toBe(1750);
    expect(merchantSellPrice(mkItem('e', 'epic'))).toBe(2500);
    // 30级（灾厄）藏品按 CALAMITY_MERCHANT_PRICE
    expect(merchantSellPrice(mkItem('u30', 'uncommon', 30))).toBe(1000);
    expect(merchantSellPrice(mkItem('f30', 'fine', 30))).toBe(1500);
    expect(merchantSellPrice(mkItem('r30', 'rare', 30))).toBe(2500);
    expect(merchantSellPrice(mkItem('e30', 'epic', 30))).toBe(3500);
    expect(merchantSellPrice(mkItem('l30', 'legendary', 30))).toBe(5000);
  });

  it('药水固定 1000，出售 500', () => {
    expect(POTION_PRICE).toBe(1000);
    expect(potionSellPrice()).toBe(500);
  });
});

describe('魅力砍价', () => {
  it('判定 = 魅力 + 1D50：≥80 五折 / ≥70 七折 / ≥60 八折', () => {
    expect(HAGGLE_TIERS.map((t) => [t.min, t.pct])).toEqual([[80, 0.5], [70, 0.7], [60, 0.8]]);
    expect(haggleRoll(30, fixedRng(50))).toEqual({ roll: 50, total: 80, discountPct: 0.5 });
    expect(haggleRoll(30, fixedRng(49)).discountPct).toBe(0.7); // 79
    expect(haggleRoll(20, fixedRng(50)).discountPct).toBe(0.7); // 70
    expect(haggleRoll(20, fixedRng(49)).discountPct).toBe(0.8); // 69
    expect(haggleRoll(10, fixedRng(50)).discountPct).toBe(0.8); // 60
  });

  it('40–59 维持原价；低于 40 涨价至 120%', () => {
    expect(haggleRoll(10, fixedRng(49)).discountPct).toBe(1); // 59
    expect(haggleRoll(0, fixedRng(40)).discountPct).toBe(1); // 40
    expect(haggleRoll(0, fixedRng(39)).discountPct).toBe(1.2); // 39
    expect(haggleRoll(5, fixedRng(1)).discountPct).toBe(1.2); // 6
  });

  it('hagglePrice 按倍率折算（四舍五入）；未砍价=原价', () => {
    expect(hagglePrice(3500, undefined)).toBe(3500);
    expect(hagglePrice(3500, { roll: 1, total: 80, discountPct: 0.5 })).toBe(1750);
    expect(hagglePrice(2500, { roll: 1, total: 70, discountPct: 0.7 })).toBe(1750);
    expect(hagglePrice(1500, { roll: 1, total: 60, discountPct: 0.8 })).toBe(1200);
    expect(hagglePrice(1500, { roll: 1, total: 39, discountPct: 1.2 })).toBe(1800);
  });

  it('折扣文案', () => {
    expect(haggleLabel(0.5)).toBe('五折');
    expect(haggleLabel(0.7)).toBe('七折');
    expect(haggleLabel(0.8)).toBe('八折');
    expect(haggleLabel(1)).toBe('原价');
    expect(haggleLabel(1.2)).toBe('涨价至 120%');
  });
});

describe('失与得：品质提升链', () => {
  it('普通→优秀→精良→稀有→史诗；史诗仍史诗；传说不动', () => {
    expect(RARITY_UPGRADE).toEqual({
      common: 'uncommon', uncommon: 'fine', fine: 'rare', rare: 'epic',
      epic: 'epic', legendary: 'legendary',
    });
    expect(upgradeRarity('common')).toBe('uncommon');
    expect(upgradeRarity('rare')).toBe('epic');
    expect(upgradeRarity('epic')).toBe('epic');
    expect(upgradeRarity('legendary')).toBe('legendary');
  });

  it('幸运判定：结果「超过 60」才通过（60 不通过）', () => {
    expect(TRADE_LUCK_THRESHOLD).toBe(60);
    // roll 固定 50：幸运 10 → 60 不通过；幸运 11 → 61 通过
    expect(tradeLuckRoll(10, fixedRng(50)).pass).toBe(false);
    expect(tradeLuckRoll(11, fixedRng(50)).pass).toBe(true);
    const r = tradeLuckRoll(20, fixedRng(33));
    expect(r).toEqual({ roll: 33, total: 53, pass: false });
  });
});

describe('安全的角落：恢复比例', () => {
  it('比例 = 意志 + 1D50，封顶 100', () => {
    expect(restHealPercent(30, fixedRng(10))).toEqual({ roll: 10, pct: 40 });
    expect(restHealPercent(120, fixedRng(50))).toEqual({ roll: 50, pct: 100 });
    expect(restHealPercent(0, fixedRng(50))).toEqual({ roll: 50, pct: 50 });
  });
});

describe('rollMerchantShop 货摊生成', () => {
  const ITEMS = [
    mkItem('u1', 'uncommon'), mkItem('u2', 'uncommon'),
    mkItem('u3', 'uncommon'), mkItem('u4', 'uncommon'),
    mkItem('u5', 'uncommon'), mkItem('u6', 'uncommon'),
    mkItem('f1', 'fine'), mkItem('r1', 'rare'), mkItem('e1', 'epic'),
    mkPotion('it_potion_hp_s', { hp: 60 }),
    mkPotion('it_potion_mp_s', { mp: 30 }),
  ];
  const RELICS = [
    mkRelic('rel_u1', 'uncommon'), mkRelic('rel_u2', 'uncommon'),
    mkRelic('rel_u3', 'uncommon'), mkRelic('rel_u4', 'uncommon'),
    mkRelic('rel_u5', 'uncommon'), mkRelic('rel_u6', 'uncommon'),
    mkRelic('rel_owned', 'uncommon'),
    mkRelic('rel_no_pool', 'uncommon', { inPool: false }),
  ];

  it('固定掷点下生成 4藏品 + 4遗物 + 2药水，价格与品质匹配', () => {
    const shop = rollMerchantShop({
      items: ITEMS, relics: RELICS, owned: new Set(), rng: fixedRng(0), level: 10,
    });
    expect(shop.slots.length).toBe(10);
    const items = shop.slots.filter((s) => s.kind === 'item');
    const relics = shop.slots.filter((s) => s.kind === 'relic');
    const potions = shop.slots.filter((s) => s.kind === 'potion');
    expect(items.length).toBe(4);
    expect(relics.length).toBe(4);
    expect(potions.length).toBe(2);

    // fixedRng(0) → rollRarity 每次掷到优秀（uncommon），价格 1500
    for (const s of items) {
      expect(s.price).toBe(MERCHANT_PRICE.uncommon);
      expect(ITEMS.find((i) => i.id === s.id)?.rarity).toBe('uncommon');
    }
    for (const s of relics) expect(s.price).toBe(1500);
    for (const s of potions) {
      expect(s.price).toBe(POTION_PRICE);
      expect(['it_potion_hp_s', 'it_potion_mp_s']).toContain(s.id);
    }
    // 4 件藏品互不重复
    expect(new Set(items.map((s) => s.id)).size).toBe(4);
    // 遗物排除 inPool=false 与已拥有
    expect(relics.some((s) => s.id === 'rel_no_pool')).toBe(false);
    expect(relics.some((s) => s.id === 'rel_owned')).toBe(false);
  });

  it('已拥有遗物不出现在货摊；池空时兜底任意品质', () => {
    const owned = new Set(['rel_u1', 'rel_u2', 'rel_u3', 'rel_u4', 'rel_u5', 'rel_u6']);
    const shop = rollMerchantShop({
      items: ITEMS, relics: RELICS, owned, rng: fixedRng(0), level: 10,
    });
    for (const s of shop.slots.filter((x) => x.kind === 'relic')) {
      expect(owned.has(s.id)).toBe(false);
    }
  });

  it('质量等级超过副本等级的藏品不会上架', () => {
    const items = [mkItem('lv15', 'uncommon', 15)];
    const shop = rollMerchantShop({
      items: [...ITEMS.slice(0, 4), ...items], relics: RELICS, owned: new Set(),
      rng: fixedRng(0), level: 10,
    });
    for (const s of shop.slots.filter((x) => x.kind === 'item')) {
      expect(s.id).not.toBe('lv15');
    }
  });
});

describe('shopPriceMul 商店价格倍率（遗物折扣 × 砍价，取最优不叠加）', () => {
  it('持有锈蚀的铁链 → 实时 50% 折扣', () => {
    expect(shopDiscountMul([])).toBe(1);
    expect(shopDiscountMul(['rl_rusty_hammer'])).toBe(0.5);
  });

  it('遗物折扣与砍价取最优（谁便宜用谁），不叠加', () => {
    // 铁链 50%（0.5）比砍价 30% 优惠（0.7）更优 → 0.5
    expect(shopPriceMul(['rl_rusty_hammer'], { roll: 1, total: 70, discountPct: 0.7 })).toBe(0.5);
    // 砍价最优惠 50%（0.5）与铁链持平 → 0.5
    expect(shopPriceMul(['rl_rusty_hammer'], { roll: 1, total: 80, discountPct: 0.5 })).toBe(0.5);
    // 砍价涨价 120%（1.2）时，铁链仍按 50% 结算（取最优）
    expect(shopPriceMul(['rl_rusty_hammer'], { roll: 1, total: 39, discountPct: 1.2 })).toBe(0.5);
    // 无遗物折扣：仅砍价生效
    expect(shopPriceMul([], { roll: 1, total: 70, discountPct: 0.7 })).toBe(0.7);
    expect(shopPriceMul([], { roll: 1, total: 39, discountPct: 1.2 })).toBe(1.2);
    // 均无 → 原价
    expect(shopPriceMul([], undefined)).toBe(1);
  });
});

describe('tradeItemPool 藏品交换池', () => {
  const ITEMS = [
    mkItem('u_sword', 'uncommon'),
    mkItem('u_helmet', 'uncommon', 10, 'helmet'),
    mkItem('u_high', 'uncommon', 20),
    mkItem('u_other', 'uncommon'),
    mkItem('f1', 'fine'),
    mkPotion('p', { hp: 60 }), // 消耗品不可换
  ];

  it('同品质、装备部位、等级≤副本等级、排除被交换件', () => {
    expect(tradeItemPool(ITEMS, 'uncommon', 'u_sword', 10).map((i) => i.id))
      .toEqual(['u_helmet', 'u_other']);
    // 不排除被交换件时包含自身
    expect(tradeItemPool(ITEMS, 'uncommon', 'none', 10).map((i) => i.id))
      .toEqual(['u_sword', 'u_helmet', 'u_other']);
    // 等级 20 超过副本等级 10 → 不出现；精良品质与消耗品不出现
    expect(tradeItemPool(ITEMS, 'uncommon', 'none', 10).some((i) => i.id === 'u_high')).toBe(false);
    expect(tradeItemPool(ITEMS, 'fine', 'none', 10).map((i) => i.id)).toEqual(['f1']);
  });
});

describe('tradeRelicPool 遗物交换池', () => {
  it('只返回池内已实装、同品质、本局未拥有的遗物', () => {
    const run = mkRun({ relics: [] });
    const pool = tradeRelicPool(run, 'uncommon');
    const allPool = inPoolRelics();
    expect(pool.every((r) => r.rarity === 'uncommon')).toBe(true);
    expect(pool.every((r) => allPool.some((x) => x.id === r.id))).toBe(true);
    // 全部排除已拥有
    const run2 = mkRun({ relics: pool.slice(0, 2).map((r) => r.id) });
    const pool2 = tradeRelicPool(run2, 'uncommon');
    expect(pool2.length).toBe(pool.length - 2);
    expect(pool2.some((r) => run2.relics.includes(r.id))).toBe(false);
  });
});

describe('ensureMerchantShop 幂等生成', () => {
  it('首次生成货摊并持久化；再次调用不重复生成', () => {
    const run = mkRun();
    const save: SaveData = {
      version: 1, characters: [], customItems: [], customMonsters: [], customStages: [],
      materials: [], coinsInStorage: 0, activeRun: run,
    };
    const s1 = ensureMerchantShop(save, 'm1', fixedRng(0));
    const st1 = s1.activeRun?.nodeStates?.['m1'];
    expect(st1?.kind).toBe('merchant');
    if (st1?.kind === 'merchant') {
      expect(st1.shop.slots.length).toBe(10);
      expect(st1.refreshed).toBe(false);
    }
    // 再次调用（基于已生成货摊的存档）不重新掷点：同一引用，状态不变
    const s2 = ensureMerchantShop(s1, 'm1', scriptRng([1, 2, 3, 4, 5]));
    expect(s2).toBe(s1);
    expect(s2.activeRun?.nodeStates?.['m1']).toBe(s1.activeRun?.nodeStates?.['m1']);
  });
});

describe('robMerchantShop 抢商店', () => {
  it('抢店成功：本摊商品全部0价并标记已抢；本局 robbedShop 置位；不修改原存档', () => {
    const run = mkRun();
    run.nodeStates = {
      m1: {
        kind: 'merchant',
        shop: { slots: [
          { kind: 'item', id: 'w1', price: 1500, sold: false },
          { kind: 'relic', id: 'r1', price: 3500, sold: false },
          { kind: 'potion', id: 'p1', price: 1000, sold: false },
        ] },
        refreshed: false,
      },
    };
    const next = robMerchantShop(run, 'm1');
    expect(next.robbedShop).toBe(true);
    const st = next.nodeStates?.['m1'];
    expect(st && st.kind === 'merchant' && st.robbed).toBe(true);
    if (st && st.kind === 'merchant') {
      expect(st.shop.slots.every((s) => s.price === 0)).toBe(true);
    }
    // 纯函数：原存档不被修改
    expect(run.robbedShop).toBeUndefined();
    expect(run.nodeStates?.['m1']).toBe(run.nodeStates?.m1);
  });

  it('缺失节点：仅置位 robbedShop，不抛错', () => {
    const run = mkRun();
    const next = robMerchantShop(run, 'missing');
    expect(next.robbedShop).toBe(true);
    expect(next.nodeStates).toBeUndefined();
  });
});

describe('executeTrade 失与得交换执行（防重复刷取）', () => {
  const mkChar = (id: string): Character => ({
    id, name: id, job: 'cat', level: 10,
    extra: { str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 50 },
    equip: { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] },
    relics: [], inventory: [], bag: [], storage: [], coins: 0, createdAt: 0,
  });
  const mkSave = (run: RunState, chars: Character[] = [mkChar('c1')]): SaveData => ({
    version: 1, characters: chars, customItems: [], customMonsters: [], customStages: [],
    materials: [], coinsInStorage: 0, activeRun: run,
  });
  // 用尽后回退 0：避免「预览掷点」多耗随机数（交换只在提交时掷一次点）
  const softRng = (vals: number[]): Rng => ({ int: () => vals.shift() ?? 0 });

  it('遗物交换：点击「交换」才落定——移除旧遗物、换得新遗物并标记节点已使用', () => {
    // 持有全部 fine 遗物，只留「钨钢防护罩」，保证换得结果确定且无额外拾取效果
    const fines = inPoolRelics().filter((r) => r.rarity === 'fine' && r.id !== 'rl_tungsten_shield');
    const run = mkRun({ relics: ['rl_zombie_hand', ...fines.map((r) => r.id)] });
    const save = mkSave(run);
    // 幸运 11 + 1D50=50 → 61 通过 → 品质提升一档（uncommon→fine）
    const out = executeTrade({
      save, run, kind: 'relic', relicId: 'rl_zombie_hand',
      items: [], luck: 11, rng: softRng([50, 0]), nodeId: 't1', level: 10,
    });
    expect(out.error).toBeUndefined();
    expect(out.run.relics.includes('rl_zombie_hand')).toBe(false);
    expect(out.run.relics).toContain('rl_tungsten_shield');
    expect(out.run.relics.length).toBe(fines.length + 1); // 旧物被替换
    expect(out.text).toContain('换得');
    const st = out.run.nodeStates?.['t1'];
    expect(st && st.kind === 'trade' && st.used).toBe(true);
  });

  it('藏品交换：背包移除旧物、换得藏品待选择接收队员并标记节点已使用', () => {
    const items: Item[] = [
      { id: 'w_a', name: '铁剑', slot: 'weapon', rarity: 'uncommon', level: 10, desc: '', price: 0 },
      { id: 'w_b', name: '木盾', slot: 'armor', rarity: 'uncommon', level: 10, desc: '', price: 0 },
    ];
    const run = mkRun();
    const char = mkChar('c1');
    char.inventory = ['w_a'];
    const save = mkSave(run, [char]);
    // 幸运 0 + 1D50=10 → 10 不通过 → 同品质（uncommon），池仅剩「木盾」
    const out = executeTrade({
      save, run, kind: 'item', memberId: 'c1', itemId: 'w_a',
      items, luck: 0, rng: softRng([10, 0]), nodeId: 't1', level: 10,
    });
    expect(out.error).toBeUndefined();
    expect(out.save.characters[0]!.inventory).toEqual([]); // 旧物已移除，换得藏品待选择归属
    expect(out.grant?.itemId).toBe('w_b'); // 换得藏品由前端选择接收队员后入库
    expect(out.text).toContain('换得');
    const st = out.run.nodeStates?.['t1'];
    expect(st && st.kind === 'trade' && st.used).toBe(true);
  });

  it('池空（无交换目标）时返回 error：不消耗藏品、不标记节点已使用', () => {
    const items: Item[] = [
      { id: 'w_only', name: '孤剑', slot: 'weapon', rarity: 'uncommon', level: 10, desc: '', price: 0 },
    ];
    const run = mkRun();
    const char = mkChar('c1');
    char.inventory = ['w_only'];
    const save = mkSave(run, [char]);
    const out = executeTrade({
      save, run, kind: 'item', memberId: 'c1', itemId: 'w_only',
      items, luck: 0, rng: softRng([10]), nodeId: 't1', level: 10,
    });
    expect(out.error).toBeTruthy();
    expect(out.save.characters[0]!.inventory).toEqual(['w_only']); // 未消耗
    expect(out.run.nodeStates?.['t1']).toBeUndefined(); // 未标记已使用 → 仍可再次尝试（结果依旧提交时确定）
  });

  it('交换提交即落盘：persistRun 后 used 持久化，重进不提供交换（中断/刷新安全）', () => {
    const fines = inPoolRelics().filter((r) => r.rarity === 'fine' && r.id !== 'rl_tungsten_shield');
    const run = mkRun({ relics: ['rl_zombie_hand', ...fines.map((r) => r.id)] });
    const save = mkSave(run);
    const out = executeTrade({
      save, run, kind: 'relic', relicId: 'rl_zombie_hand',
      items: [], luck: 11, rng: softRng([50, 0]), nodeId: 't1', level: 10,
    });
    // 提交后立即同步持久化（本地存档；等价于「请求成功后落盘」，中途中断不会半提交）
    const saved = persistRun(out.save, out.run);
    const st = saved.activeRun?.nodeStates?.['t1'];
    expect(st && st.kind === 'trade' && st.used).toBe(true);
    expect(saved.activeRun?.relics.includes('rl_zombie_hand')).toBe(false);
  });
});