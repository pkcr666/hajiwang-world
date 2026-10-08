import { describe, expect, it } from 'vitest';
import type { Item, Relic, Rng, StageDef } from '../../types';
import {
  describeDrop, pickPoolItem, resolveDrop, rollLuckyDrops, rollRarity, rollStageDrop,
  rollFixedDrops, describeFixedDrop,
} from '../drops';

const mkItem = (id: string, rarity: Item['rarity'], level = 10, slot: Item['slot'] = 'weapon'): Item =>
  ({ id, name: id, slot, rarity, level, desc: '', price: 0 });
const mkRelic = (id: string, rarity: Relic['rarity']): Relic =>
  ({ id, name: id, rarity, positive: true, desc: '', effect: { kind: 'lifeCrystal' } });

const ITEMS = [
  mkItem('u1', 'uncommon'), mkItem('u2', 'uncommon'),
  mkItem('f1', 'fine'), mkItem('r1', 'rare'),
  mkItem('potion', 'common', 10, 'consumable'), // 消耗品不进随机藏品池
];
const RELICS = [mkRelic('rel_rare', 'rare'), mkRelic('rel_epic', 'epic')];
const CTX = { items: ITEMS, relics: RELICS };

const scriptRng = (vals: number[]): Rng => ({ int: () => vals.shift()! });

const mkStage = (drops: StageDef['drops'], luckyDrops: StageDef['luckyDrops'] = []): StageDef => ({
  id: 's1', name: '测试关', dungeon: 'starterVillage', floor: 1,
  difficulty: 'normal', appear: 'regular', level: 10, desc: '',
  monsters: [], mechanics: [], drops, luckyDrops,
});

describe('pickPoolItem', () => {
  it('只抽装备部位，按稀有度+等级精确匹配', () => {
    const pool = pickPoolItem(ITEMS, 'uncommon', 10);
    expect(pool.map((i) => i.id)).toEqual(['u1', 'u2']);
    expect(pickPoolItem(ITEMS, 'common', 10).map((i) => i.id)).toEqual([]);
  });

  it('稀有度缺省=不筛稀有度（随机），只按等级过滤', () => {
    expect(pickPoolItem(ITEMS, undefined, 10).map((i) => i.id)).toEqual(['u1', 'u2', 'f1', 'r1']);
    expect(pickPoolItem(ITEMS, undefined).map((i) => i.id)).toEqual(['u1', 'u2', 'f1', 'r1']);
  });
});

describe('rollStageDrop（方案1归一表，一次一件）', () => {
  const stage = mkStage([
    { id: 'd1', kind: 'item', source: 'pool', rarity: 'uncommon', level: 10, weight: 50 },
    { id: 'd2', kind: 'item', source: 'pool', rarity: 'fine', level: 10, weight: 30 },
    { id: 'd3', kind: 'relic', source: 'pool', rarity: 'rare', weight: 10 },
    { id: 'd4', kind: 'relic', source: 'specific', targetId: 'rel_epic', weight: 10 },
  ]);

  it('roll 1~50 落在第一条，再随机池索引0 → u1', () => {
    const r = rollStageDrop(stage, CTX, scriptRng([1, 0]));
    expect(r).toEqual({ kind: 'item', item: ITEMS[0] });
  });

  it('roll 51~80 落在第二条（精良藏品）', () => {
    const r = rollStageDrop(stage, CTX, scriptRng([51, 0]));
    expect(r).toEqual({ kind: 'item', item: ITEMS[2] });
  });

  it('roll 81~90 落在第三条（随机稀有遗物）', () => {
    const r = rollStageDrop(stage, CTX, scriptRng([81, 0]));
    expect(r).toEqual({ kind: 'relic', relic: RELICS[0] });
  });

  it('roll 91~100 落在第四条（指定史诗遗物），不再二次随机', () => {
    const r = rollStageDrop(stage, CTX, scriptRng([91]));
    expect(r).toEqual({ kind: 'relic', relic: RELICS[1] });
  });

  it('空掉落表返回 null；权重为0的条目不参与', () => {
    expect(rollStageDrop(mkStage([]), CTX, scriptRng([1]))).toBeNull();
    const s = mkStage([
      { id: 'a', kind: 'item', source: 'specific', targetId: 'u1', weight: 0 },
      { id: 'b', kind: 'item', source: 'specific', targetId: 'u2', weight: 100 },
    ]);
    expect(rollStageDrop(s, CTX, scriptRng([1, 1]))).toEqual({ kind: 'item', item: ITEMS[1] });
  });

  it('随机池为空（无对应稀有度遗物）时该条结算为 null', () => {
    const s = mkStage([{ id: 'a', kind: 'relic', source: 'pool', rarity: 'legendary', weight: 100 }]);
    expect(rollStageDrop(s, CTX, scriptRng([1, 0]))).toBeNull();
  });

  it('稀有度选「随机」且未配概率时等概率掷稀有度', () => {
    const s = mkStage([{ id: 'a', kind: 'item', source: 'pool', level: 10, weight: 100 }]);
    // roll 1 → 条目a；rollRarity int(0,4)=2 → rare；池=[r1] → r1
    expect(rollStageDrop(s, CTX, scriptRng([1, 2, 0]))).toEqual({ kind: 'item', item: ITEMS[3] });
  });

  it('稀有度「随机」+概率分布：按 rarityWeights 掷稀有度', () => {
    const s = mkStage([{
      id: 'a', kind: 'item', source: 'pool', level: 10, weight: 100,
      rarityWeights: { uncommon: 50, fine: 20, rare: 20, epic: 5, legendary: 5 },
    }]);
    // roll 1 → 条目a；稀有度 roll=51 → 落入 fine（50<51<=70）；池=[f1]
    expect(rollStageDrop(s, CTX, scriptRng([1, 51, 0]))).toEqual({ kind: 'item', item: ITEMS[2] });
    // 稀有度 roll=50 → uncommon；池=[u1,u2]，索引1 → u2
    expect(rollStageDrop(s, CTX, scriptRng([1, 50, 1]))).toEqual({ kind: 'item', item: ITEMS[1] });
  });

  it('权重合计非100时按总权重容忍滚动', () => {
    const s = mkStage([
      { id: 'a', kind: 'item', source: 'specific', targetId: 'u1', weight: 25 },
      { id: 'b', kind: 'item', source: 'specific', targetId: 'u2', weight: 25 },
    ]);
    // total=50，roll 26~50 → 第二条
    expect(rollStageDrop(s, CTX, scriptRng([26]))).toEqual({ kind: 'item', item: ITEMS[1] });
  });
});

describe('rollLuckyDrops（幸运+1D50 ≥ 判定值）', () => {
  const stage = mkStage([], [
    { id: 'l1', kind: 'item', source: 'pool', rarity: 'rare', level: 10, threshold: 60 },
    { id: 'l2', kind: 'relic', source: 'specific', targetId: 'rel_epic', threshold: 80 },
  ]);

  it('幸运30：roll30 刚好通过60获得稀有藏品；roll49 不足80不给史诗遗物（失败条目也返回）', () => {
    const out = rollLuckyDrops(stage, 30, CTX, scriptRng([30, 0, 49]));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ threshold: 60, roll: 30, total: 60, success: true });
    expect(out[0].reward).toEqual({ kind: 'item', item: ITEMS[3] });
    expect(out[1]).toMatchObject({ threshold: 80, roll: 49, total: 79, success: false, reward: null });
  });

  it('幸运50：两条都满足，按条目各独立判定', () => {
    const out = rollLuckyDrops(stage, 50, CTX, scriptRng([10, 0, 30]));
    expect(out).toHaveLength(2);
    expect(out[1].reward).toEqual({ kind: 'relic', relic: RELICS[1] });
  });

  it('判定失败也返回该条（success=false、reward=null、显示判定值）', () => {
    const out = rollLuckyDrops(stage, 20, CTX, scriptRng([10, 49]));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ threshold: 60, roll: 10, total: 30, success: false, reward: null, kind: 'item', source: 'pool' });
    expect(out[1]).toMatchObject({ threshold: 80, roll: 49, total: 69, success: false, reward: null, kind: 'relic', source: 'specific' });
  });
});

describe('resolveDrop / describeDrop', () => {
  it('rollRarity：按权重区间掷稀有度；未配置等概率', () => {
    expect(rollRarity({ uncommon: 50, fine: 20, rare: 20, epic: 5, legendary: 5 }, scriptRng([51]))).toBe('fine');
    expect(rollRarity({ uncommon: 50, fine: 20, rare: 20, epic: 5, legendary: 5 }, scriptRng([100]))).toBe('legendary');
    expect(rollRarity(undefined, scriptRng([4]))).toBe('legendary');
  });

  it('指定藏品按 id 解析', () => {
    const r = resolveDrop('item', 'specific', CTX, scriptRng([9]), { targetId: 'f1' });
    expect(r).toEqual({ kind: 'item', item: ITEMS[2] });
  });

  it('描述文本覆盖池/指定、藏品/遗物、权重与幸运两种形态', () => {
    const itemMap = new Map(ITEMS.map((i) => [i.id, i]));
    const relicMap = new Map(RELICS.map((r) => [r.id, r]));
    expect(describeDrop({ id: 'a', kind: 'item', source: 'pool', rarity: 'uncommon', level: 10, weight: 50 }, itemMap, relicMap))
      .toBe('50% 10级随机优秀藏品');
    expect(describeDrop({ id: 'b', kind: 'relic', source: 'pool', rarity: 'epic', threshold: 70 }, itemMap, relicMap))
      .toBe('随机史诗遗物');
    expect(describeDrop({ id: 'c', kind: 'relic', source: 'specific', targetId: 'rel_epic', threshold: 70 }, itemMap, relicMap))
      .toBe('rel_epic');
  });
});

describe('rollFixedDrops（固定掉落：材料+哈哈币）', () => {
  const matGel: Item = { id: 'mat_gel', name: '凝胶', slot: 'material', rarity: 'common', price: 1, desc: '' };
  const matIron: Item = { id: 'mat_iron', name: '铁矿', slot: 'material', rarity: 'uncommon', price: 5, desc: '' };
  const ctx2 = { items: [...ITEMS, matGel, matIron], relics: RELICS };

  it('材料与哈哈币必得，同类材料合并数量', () => {
    const st = mkStage([], []);
    st.fixedDrops = [
      { id: 'f1', kind: 'material', targetId: 'mat_gel', count: 2 },
      { id: 'f2', kind: 'material', targetId: 'mat_gel', count: 3 },
      { id: 'f3', kind: 'coin', count: 50 },
      { id: 'f4', kind: 'coin', count: 20 },
    ];
    const r = rollFixedDrops(st, ctx2, scriptRng([0]));
    expect(r.coins).toBe(70);
    expect(r.materials).toEqual([{ item: matGel, count: 5 }]);
  });

  it('数量≤0忽略；材料不存在/非材料槽位静默跳过', () => {
    const st = mkStage([], []);
    st.fixedDrops = [
      { id: 'f1', kind: 'coin', count: 0 },
      { id: 'f2', kind: 'material', targetId: 'ghost', count: 9 },
      { id: 'f3', kind: 'material', targetId: 'u1', count: 9 }, // u1 是武器不是材料
      { id: 'f4', kind: 'material', targetId: 'mat_iron', count: 1 },
    ];
    const r = rollFixedDrops(st, ctx2, scriptRng([0]));
    expect(r.coins).toBe(0);
    expect(r.materials.map((m) => m.item.id)).toEqual(['mat_iron']);
  });

  it('旧关卡无 fixedDrops 字段时安全返回空', () => {
    expect(rollFixedDrops(mkStage([], []), ctx2, scriptRng([0]))).toEqual({ materials: [], coins: 0, items: [], relics: [] });
  });

  it('固定藏品/遗物入对应列表；随机候选等概率抽一件（失效候选静默跳过）', () => {
    const st = mkStage([], []);
    st.fixedDrops = [
      { id: 'f1', kind: 'item', targetId: 'u1', count: 1 },
      { id: 'f2', kind: 'relic', targetId: 'rel_rare', count: 1 },
      {
        id: 'f3', kind: 'random', count: 1,
        candidates: [
          { id: 'c1', kind: 'coin', count: 9 },
          { id: 'c2', kind: 'item', targetId: 'f1', count: 1 },
          { id: 'c3', kind: 'material', targetId: 'ghost', count: 3 },
          { id: 'c4', kind: 'relic', targetId: 'rel_epic', count: 1 },
        ],
      },
    ];
    // 索引0 → 哈哈币×9
    expect(rollFixedDrops(st, ctx2, scriptRng([0]))).toMatchObject({ coins: 9, items: [ITEMS[0]], relics: [RELICS[0]] });
    // 索引1 → 随机候选抽到精良藏品 f1（与固定藏品 u1 并存）；索引3 → 随机候选抽到史诗遗物
    expect(rollFixedDrops(st, ctx2, scriptRng([1])).items.map((i) => i.id)).toEqual(['u1', 'f1']);
    expect(rollFixedDrops(st, ctx2, scriptRng([3])).relics.map((r) => r.id)).toEqual(['rel_rare', 'rel_epic']);
  });

  it('describeFixedDrop 文本', () => {
    const m = new Map(ctx2.items.map((i) => [i.id, i]));
    const rm = new Map(ctx2.relics.map((r) => [r.id, r]));
    expect(describeFixedDrop({ id: 'a', kind: 'coin', count: 30 }, m)).toBe('哈哈币×30');
    expect(describeFixedDrop({ id: 'b', kind: 'material', targetId: 'mat_gel', count: 2 }, m)).toBe('凝胶×2');
    expect(describeFixedDrop({ id: 'c', kind: 'material', targetId: 'x', count: 1 }, m)).toBe('（已失效材料）×1');
    expect(describeFixedDrop({ id: 'd', kind: 'item', targetId: 'u1', count: 1 }, m, rm)).toBe('u1');
    expect(describeFixedDrop({
      id: 'e', kind: 'random', count: 1,
      candidates: [{ id: 'c1', kind: 'coin', count: 5 }, { id: 'c2', kind: 'item', targetId: 'u1', count: 1 }],
    }, m, rm)).toBe('随机：哈哈币×5/u1');
  });
});

describe('遗物掉落去重（owned）', () => {
  const OWNED = new Set(['rel_rare']);
  const CTX_OWNED = { items: ITEMS, relics: RELICS, owned: OWNED };

  it('随机池遗物：已拥有的被过滤，池空则结算为 null', () => {
    const stage = mkStage([{ id: 'a', kind: 'relic', source: 'pool', rarity: 'rare', weight: 100 }]);
    // rel_rare 已拥有 → rare 池空 → null
    expect(rollStageDrop(stage, CTX_OWNED, scriptRng([1, 0]))).toBeNull();
    // 未拥有 rel_rare 时（不传 owned）仍能正常掉落
    expect(rollStageDrop(stage, CTX, scriptRng([1, 0]))).toEqual({ kind: 'relic', relic: RELICS[0] });
  });

  it('指定遗物不去重：已拥有也能再次指定获得', () => {
    const stage = mkStage([{ id: 'a', kind: 'relic', source: 'specific', targetId: 'rel_rare', weight: 100 }]);
    expect(rollStageDrop(stage, CTX_OWNED, scriptRng([1]))).toEqual({ kind: 'relic', relic: RELICS[0] });
  });

  it('幸运判定通过但随机池已集齐 → success=true、reward=null', () => {
    const stage = mkStage([], [{ id: 'l', kind: 'relic', source: 'pool', rarity: 'rare', threshold: 60 }]);
    const out = rollLuckyDrops(stage, 50, CTX_OWNED, scriptRng([10]));
    expect(out[0]).toMatchObject({ success: true });
    expect(out[0].reward).toBeNull();
  });

  it('随机池有其他稀有度时，去重不影响其他稀有度抽取', () => {
    const stage = mkStage([{ id: 'a', kind: 'relic', source: 'pool', rarity: 'epic', weight: 100 }]);
    expect(rollStageDrop(stage, CTX_OWNED, scriptRng([1, 0]))).toEqual({ kind: 'relic', relic: RELICS[1] });
  });
});
