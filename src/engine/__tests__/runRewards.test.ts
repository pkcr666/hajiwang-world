import { describe, expect, it } from 'vitest';
import type {
  ActMap, Character, Item, MapEdge, MapNode, MapNodeKind, RunActId, RunState,
  SaveData, StageDef,
} from '../../types';
import {
  applyPickRewards, applyRelicPickupEffects, buildBattleRewards, rollTorchDrop,
} from '../run';
import { applySurvivorBags, addToCharacterBag } from '../../save/storage';

// ===== 夹具 =====
const gel: Item = { id: 'it_mat_gel', name: '凝胶', slot: 'material', rarity: 'common', price: 2, desc: '' };
const sword: Item = { id: 'it_sword_test', name: '测试剑', slot: 'weapon', rarity: 'uncommon', level: 10, weaponType: 'melee', price: 1, desc: '' };
const stoneRare: Item = { id: 'it_stone_rare', name: '稀有强化石', slot: 'material', rarity: 'rare', price: 5000, desc: '' };
const stoneEpic: Item = { id: 'it_stone_epic', name: '史诗强化石', slot: 'material', rarity: 'epic', price: 7000, desc: '' };
const ITEMS = [gel, sword, stoneRare, stoneEpic];

const mkStage = (over: Partial<StageDef> = {}): StageDef => ({
  id: 's1', name: '测试关', dungeon: 'starterVillage', floor: 1,
  difficulty: 'normal', appear: 'regular', level: 10, desc: '',
  monsters: [], mechanics: [], drops: [], luckyDrops: [],
  ...over,
});

const scriptRng = (vals: number[]) => ({ int: () => vals.shift() ?? 1 });

const node = (id: string, act: RunActId, col: number, kind: MapNodeKind, extra: Partial<MapNode> = {}): MapNode =>
  ({ id, act, col, row: 0, kind, ...extra });
const edge = (from: string, to: string): MapEdge => ({ from, to });
const chain = (act: RunActId, nodes: MapNode[]): ActMap => ({
  act, cols: nodes.length, rows: 1, nodes,
  edges: nodes.slice(0, -1).map((n, i) => edge(n.id, nodes[i + 1]!.id)),
});

const mkRun = (): RunState => ({
  dungeonId: 'starterVillage',
  party: { leaderId: 'c1', memberIds: ['c1'] },
  acts: { 1: chain(1, [node('A0', 1, 0, 'combat', { stageId: 's1' })]) } as RunState['acts'],
  sublayer: null,
  act: 1,
  cleared: [],
  visitorNodeId: null,
  subDone: false,
  hpMp: { c1: { hp: 50, mp: 20 } },
  initialPool: 100,
  coins: 100,
  pendingMaterials: [],
  pendingItems: [],
  relics: ['rl_life_crystal'],
  torches: 2,
  openedEdges: [],
  createdAt: 1,
});

const mkChar = (id: string): Character => ({
  id, name: id, job: 'cat', level: 10,
  extra: { str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 50 },
  equip: { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] },
  relics: [], inventory: [], bag: [], storage: [], coins: 0, createdAt: 0,
});

const mkSave = (): SaveData => ({
  version: 1,
  characters: [mkChar('c1'), mkChar('c2'), null],
  customItems: [], customMonsters: [], customStages: [],
  materials: [], coinsInStorage: 0, party: null, activeRun: null,
});

const ITEM_MAP = new Map(ITEMS.map((i) => [i.id, i]));

describe('buildBattleRewards', () => {
  it('固定掉落产出币/材料卡，BOSS 关火把必掉', () => {
    const stage = mkStage({
      fixedDrops: [
        { id: 'f1', kind: 'coin', count: 50 },
        { id: 'f2', kind: 'material', targetId: 'it_mat_gel', count: 2 },
      ],
    });
    const rewards = buildBattleRewards({
      items: ITEMS, run: mkRun(), node: node('B1', 2, 1, 'boss', { stageId: 's1' }),
      stage, leaderLuck: 0, rng: scriptRng([]),
    });
    expect(rewards).toContainEqual({ key: expect.any(String), kind: 'coin', count: 50 });
    expect(rewards).toContainEqual({ key: expect.any(String), kind: 'material', itemId: 'it_mat_gel', count: 2 });
    expect(rewards).toContainEqual({ key: expect.any(String), kind: 'torch', count: 1 });
  });

  it('随机掉落 roll 一件；幸运判定成功产出奖励卡', () => {
    const stage = mkStage({
      drops: [{ id: 'd1', kind: 'item', source: 'specific', targetId: 'it_sword_test', weight: 100 }],
      luckyDrops: [{ id: 'l1', kind: 'coin', source: 'specific', count: 10, threshold: 60 }],
    });
    // roll 1 → d1；幸运 roll 35 + 幸运40 = 75 ≥ 60 通过
    const rewards = buildBattleRewards({
      items: ITEMS, run: mkRun(), node: node('A0', 1, 0, 'combat', { stageId: 's1' }),
      stage, leaderLuck: 40, rng: scriptRng([1, 35]),
    });
    expect(rewards).toContainEqual({ key: expect.any(String), kind: 'item', itemId: 'it_sword_test' });
    expect(rewards).toContainEqual({ key: expect.any(String), kind: 'coin', count: 10 });
    expect(rewards.some((r) => r.kind === 'luckyFail')).toBe(false);
  });

  it('幸运判定失败产出 luckyFail 卡（展示判定值，不可拾取）', () => {
    const stage = mkStage({
      luckyDrops: [{ id: 'l1', kind: 'coin', source: 'specific', count: 10, threshold: 60 }],
    });
    const rewards = buildBattleRewards({
      items: ITEMS, run: mkRun(), node: node('A0', 1, 0, 'combat', { stageId: 's1' }),
      stage, leaderLuck: 10, rng: scriptRng([20]),
    });
    const fail = rewards.find((r) => r.kind === 'luckyFail');
    expect(fail).toBeDefined();
    expect(fail).toMatchObject({ kind: 'luckyFail', text: '幸运判定 30/60，未通过' });
  });

  it('rollTorchDrop：普通25%/紧急50%/BOSS100%', () => {
    const normal = node('A0', 1, 0, 'combat');
    const urgent = node('A1', 1, 1, 'combat', { urgent: true });
    const boss = node('B1', 2, 1, 'boss');
    expect(rollTorchDrop(boss, scriptRng([2]))).toBe(true);
    // 普通关 rng 1..4，=1 掉落
    expect(rollTorchDrop(normal, scriptRng([1]))).toBe(true);
    expect(rollTorchDrop(normal, scriptRng([2]))).toBe(false);
    // 紧急关 rng 1..2
    expect(rollTorchDrop(urgent, scriptRng([2]))).toBe(false);
    // 非战斗节点不掉
    expect(rollTorchDrop(node('M0', 1, 0, 'merchant'), scriptRng([1]))).toBe(false);
  });
});

describe('applyPickRewards', () => {
  it('拾取币/火把/材料/遗物：入共享池、加火把、暂存材料、遗物去重', () => {
    const base = mkRun();
    const { run: next } = applyPickRewards(mkSave(), base, [
      { key: 'a', kind: 'coin', count: 30 },
      { key: 'b', kind: 'torch', count: 1 },
      { key: 'c', kind: 'material', itemId: 'it_mat_gel', count: 2 },
      { key: 'e', kind: 'relic', relicId: 'rl_life_crystal' }, // 已拥有 → 去重
      { key: 'f', kind: 'relic', relicId: 'rl_scout_scope' },
    ], {}, ITEM_MAP);
    expect(next.coins).toBe(130);
    expect(next.torches).toBe(3);
    expect(next.pendingMaterials).toEqual([{ itemId: 'it_mat_gel', count: 2 }]);
    expect(next.relics).toEqual(['rl_life_crystal', 'rl_scout_scope']);
  });

  it('拾取藏品按 owner 立即写入该队员背包格；消耗品入携带道具；无 owner 兜底队长', () => {
    const base = { ...mkRun(), party: { leaderId: 'c1', memberIds: ['c1', 'c2'] } };
    const { save: s1, run: r1 } = applyPickRewards(mkSave(), base, [
      { key: 'd', kind: 'item', itemId: 'it_sword_test', owner: 'c2' },
      { key: 'e', kind: 'item', itemId: 'it_sword_test' }, // 无 owner → 队长 c1
    ], {}, ITEM_MAP);
    expect(r1.pendingItems).toEqual([]);
    expect(s1.characters[1]!.inventory).toEqual(['it_sword_test']);
    expect(s1.characters[0]!.inventory).toEqual(['it_sword_test']);
  });

  it('事件/拾取的强化石（材料）进共享材料仓库，不进藏品格', () => {
    const base = { ...mkRun(), party: { leaderId: 'c1', memberIds: ['c1', 'c2'] } };
    const { save: s1, run: r1 } = applyPickRewards(mkSave(), base, [
      { key: 'a', kind: 'item', itemId: 'it_stone_epic', owner: 'c2' },
      { key: 'b', kind: 'item', itemId: 'it_stone_rare', owner: 'c1' },
    ], {}, ITEM_MAP);
    expect(s1.characters[0]!.inventory ?? []).toEqual([]);
    expect(s1.characters[1]!.inventory ?? []).toEqual([]);
    // 材料进入暂存池（通关结算时写入共享材料仓库），不进藏品格
    expect(r1.pendingMaterials).toEqual([
      { itemId: 'it_stone_epic', count: 1 },
      { itemId: 'it_stone_rare', count: 1 },
    ]);
  });

  it('拾取即效：仙豆回满生命；火把神吊坠获得火把', () => {
    const base = mkRun();
    const { run: next } = applyPickRewards(mkSave(), base, [
      { key: 'a', kind: 'relic', relicId: 'rl_bean' },
      { key: 'b', kind: 'relic', relicId: 'rl_torch_pendant' },
    ], { c1: 320 }, ITEM_MAP);
    expect(next.hpMp.c1).toEqual({ hp: 320, mp: 20 });
    expect(next.torches).toBe(4); // 2 + 2（火把神吊坠）
    expect(next.relics).toContain('rl_bean');
  });

  it('获得提升生命/魔力上限的遗物时同步补足当前值', () => {
    const base = mkRun(); // hp 50 / mp 20
    const { run: next } = applyPickRewards(mkSave(), base, [
      { key: 'a', kind: 'relic', relicId: 'rl_big_fruit' }, // HP+5%：上限 320→335
      { key: 'b', kind: 'relic', relicId: 'rl_mp_fruit' }, // 魔力+10：上限 60→70
    ], {}, ITEM_MAP);
    expect(next.hpMp.c1).toEqual({ hp: 65, mp: 30 });
  });

  it('放弃全部：原样返回内容（新对象）', () => {
    const base = mkRun();
    const { run: next } = applyPickRewards(mkSave(), base, [], {}, ITEM_MAP);
    expect(next.coins).toBe(100);
    expect(next.torches).toBe(2);
    expect(next).not.toBe(base);
  });
});

describe('applyRelicPickupEffects（额外获得类遗物）', () => {
  it('谷地树实：随机获得 2 个未拥有的遗物并返回文案（递归结算其拾取效果）', () => {
    const base = mkRun(); // 初始 1 遗物（rl_life_crystal）
    const pk = applyRelicPickupEffects(base, ['rl_grove_acorn'], scriptRng([0, 0, 0]));
    expect(pk.run.relics).toContain('rl_grove_acorn');
    const newIds = pk.run.relics.filter(
      (id) => !base.relics.includes(id) && id !== 'rl_grove_acorn',
    );
    expect(newIds).toHaveLength(2);
    expect(pk.texts.filter((t) => t.startsWith('额外获得遗物'))).toHaveLength(2);
  });

  it('火把神的吊坠 +2 根火把；探险家 +1 根火把', () => {
    const a = applyRelicPickupEffects(mkRun(), ['rl_torch_pendant']);
    expect(a.run.torches).toBe(4);
    expect(a.texts).toContain('获得 2 根火把');
    const b = applyRelicPickupEffects(mkRun(), ['rl_explorer']);
    expect(b.run.torches).toBe(3);
  });

  it('战斗掉落路径（拾取面板已展开衍生卡）：applyPickRewards 不重复展开谷地树实', () => {
    const base = mkRun();
    // 模拟拾取面板已展开：树实 + 2 张衍生遗物卡一并拾取
    const { run: next } = applyPickRewards(mkSave(), base, [
      { key: 'a', kind: 'relic', relicId: 'rl_grove_acorn' },
      { key: 'b', kind: 'relic', relicId: 'rl_explorer' },
      { key: 'c', kind: 'relic', relicId: 'rl_bean' },
    ], {}, ITEM_MAP);
    expect(next.relics).toContain('rl_grove_acorn');
    expect(next.relics).toContain('rl_explorer');
    expect(next.relics).toContain('rl_bean');
    // 树实 + 2 衍生 = 3，不被重复展开成 5 件
    const newIds = next.relics.filter((id) => !base.relics.includes(id));
    expect(newIds).toHaveLength(3);
  });
});

describe('背包写回', () => {
  it('addToCharacterBag 同 id 叠加数量', () => {
    let s = addToCharacterBag(mkSave(), 'c1', 'it_potion_hp_s', 2);
    s = addToCharacterBag(s, 'c1', 'it_potion_hp_s', 1);
    expect(s.characters[0]!.bag).toEqual([{ itemId: 'it_potion_hp_s', count: 3 }]);
  });

  it('applySurvivorBags 把战斗内剩余背包写回角色', () => {
    const s0 = addToCharacterBag(mkSave(), 'c1', 'it_potion_hp_s', 2);
    const s = applySurvivorBags(s0, [
      { id: 'c1', bag: [{ itemId: 'it_potion_hp_s', count: 1 }] },
      { id: 'ghost', bag: [] }, // 不存在的角色忽略
    ]);
    expect(s.characters[0]!.bag).toEqual([{ itemId: 'it_potion_hp_s', count: 1 }]);
  });
});