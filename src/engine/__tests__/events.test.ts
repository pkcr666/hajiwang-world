import { describe, expect, it } from 'vitest';
import type { Character, EventOption, Item, Rarity, Rng, RunState, SaveData, StageDef } from '../../types';
import { EVENTS } from '../../data/events';
import { RELICS } from '../../data/relics';
import {
  applyEventOption, canAfford, eligibleEvents, eventConditionMet, findStage, rollEvent, statCheck,
} from '../events';

const scriptRng = (vals: number[]): Rng => ({ int: () => vals.shift()! });

const mkItem = (id: string, rarity: Rarity, slot: Item['slot'] = 'weapon'): Item =>
  ({ id, name: id, slot, rarity, level: 10, desc: '', price: 0, weaponType: 'melee' });

const mkStage = (id: string, name: string, difficulty: StageDef['difficulty']): StageDef =>
  ({
    id, name, dungeon: 'starterVillage', floor: 2, difficulty, appear: 'event',
    level: 10, desc: '', monsters: [], mechanics: [], drops: [], luckyDrops: [],
  });

const mkChar = (id: string, extra: Partial<Character['extra']> = {}, job: Character['job'] = 'cat'): Character =>
  ({
    id, name: id, job, level: 10,
    extra: { str: 10, int: 10, agi: 10, luk: 10, wil: 10, cha: 10, ...extra },
    equip: { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] },
    relics: [], inventory: [], bag: [], storage: [], coins: 0, createdAt: 1,
  });

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

const mkSave = (run: RunState, customStages: SaveData['customStages'] = [], chars?: Character[]): SaveData => ({
  version: 1,
  characters: chars ?? [mkChar('c1', { str: 70 })],
  customItems: [mkItem('it_sword_gold', 'rare'), mkItem('it_sword_silver', 'fine')],
  customMonsters: [],
  customStages,
  materials: [],
  coinsInStorage: 0,
  activeRun: run,
});

const items = (s: SaveData) => new Map([...s.customItems].map((i) => [i.id, i]));
const statOf = () => 70; // 队长力量70

describe('事件抽取与出现条件', () => {
  it('常规刷新 always 恒成立；火把/金币/遗物条件按 run 状态判定', () => {
    const run = mkRun({ torches: 1, coins: 500, relics: ['rl_house_l'] });
    expect(eventConditionMet({ type: 'always' }, run)).toBe(true);
    expect(eventConditionMet({ type: 'torchGte', count: 2 }, run)).toBe(false);
    expect(eventConditionMet({ type: 'coinGte', count: 500 }, run)).toBe(true);
    expect(eventConditionMet({ type: 'relic', relicId: 'rl_house_l' }, run)).toBe(true);
    expect(eventConditionMet({ type: 'relic', relicId: 'rl_house_s' }, run)).toBe(false);
  });

  it('eligibleEvents 按 副本+层数+条件 过滤；rollEvent 返回池内事件', () => {
    const run = mkRun({ torches: 5, coins: 1000 });
    const pool = eligibleEvents(EVENTS, 'starterVillage', 1, run);
    expect(pool.map((e) => e.id).sort()).toEqual(['ev_house', 'ev_river', 'ev_woodbox']);
    expect(rollEvent(EVENTS, 'starterVillage', 1, run, { int: () => 0 })?.id).toBe('ev_house');
    // 二层需要火把的事件池不含需火把者外的全部事件
    expect(eligibleEvents(EVENTS, 'starterVillage', 2, run).length).toBe(5);
    // 火把不足时仅能抽到不要求火把的条件
    const poor = mkRun({ torches: 0 });
    expect(eligibleEvents(EVENTS, 'starterVillage', 3, poor).length).toBe(4);
  });
});

describe('六维判定', () => {
  it('六维 + 1D50 ≥ 阈值 成功，否则失败', () => {
    expect(statCheck(70, 60, { int: () => 1 })).toMatchObject({ total: 71, pass: true });
    expect(statCheck(10, 60, { int: () => 50 })).toMatchObject({ total: 60, pass: true });
    expect(statCheck(10, 60, { int: () => 49 })).toMatchObject({ total: 59, pass: false });
  });
});

describe('applyEventOption 结算', () => {
  it('造房子·大房子：力量判定通过 → 获得遗物【大房子】', () => {
    const run = mkRun();
    const save = mkSave(run);
    const ev = EVENTS.find((e) => e.id === 'ev_house')!;
    const res = applyEventOption({
      save, run, option: ev.options[0], rng: scriptRng([20]),
      items: items(save), leaderStatOf: statOf,
    });
    expect(res.texts.some((t) => t.includes('判定成功'))).toBe(true);
    expect(res.run.relics).toContain('rl_house_l');
  });

  it('造房子·大房子：判定失败 → 无奖励（fail 缺省）', () => {
    const run = mkRun();
    const save = mkSave(run);
    const ev = EVENTS.find((e) => e.id === 'ev_house')!;
    const res = applyEventOption({
      save, run, option: ev.options[0], rng: scriptRng([1]),
      items: items(save), leaderStatOf: () => 10,
    });
    expect(res.texts.some((t) => t.includes('判定失败'))).toBe(true);
    expect(res.run.relics).toEqual([]);
  });

  it('迷失少女：消耗火把并触发紧急作战（battleStageId 传出）', () => {
    const run = mkRun({ act: 2, torches: 2 });
    const save = mkSave(run, [
      mkStage('sv_27', '迷失少女', 'normal'),
      mkStage('sv_28', '迷失少女', 'urgent'),
    ]);
    const ev = EVENTS.find((e) => e.id === 'ev_nymph')!;
    const res = applyEventOption({
      save, run, option: ev.options[0], rng: { int: () => 1 },
      items: items(save), leaderStatOf: statOf,
    });
    expect(res.run.torches).toBe(1);
    expect(res.battleStageId).toBe('sv_28');
    expect(res.battleUrgent).toBe(true);
    expect(res.texts.some((t) => t.includes('触发紧急'))).toBe(true);
  });

  it('三只松鼠：金币不足时选项置灰（canAfford=false）；足够时扣费并随机遗物', () => {
    const run = mkRun({ coins: 500 });
    const save = mkSave(run);
    const ev = EVENTS.find((e) => e.id === 'ev_squirrel')!;
    expect(canAfford(ev.options[0], run)).toBe(false);
    const rich = mkRun({ coins: 1000 });
    const res = applyEventOption({
      save, run: rich, option: ev.options[0], rng: { int: () => 0 },
      items: items(save), leaderStatOf: statOf,
    });
    expect(res.run.coins).toBe(0);
    expect(res.run.relics).toHaveLength(1);
  });

  it('生命之树：按最大生命/魔力百分比恢复', () => {
    const run = mkRun({ hpMp: { c1: { hp: 50, mp: 25 } } });
    const save = mkSave(run);
    const ev = EVENTS.find((e) => e.id === 'ev_lifetree')!;
    const res = applyEventOption({
      save, run, option: ev.options[2], rng: { int: () => 1 },
      items: items(save), leaderStatOf: statOf,
    });
    // 队长 HP300/MP60 满值恢复
    expect(res.run.hpMp.c1.hp).toBe(300);
    expect(res.run.hpMp.c1.mp).toBe(60);
  });

  it('金银剑：获得藏品库既有金剑/银剑', () => {
    const run = mkRun();
    const save = mkSave(run);
    const ev = EVENTS.find((e) => e.id === 'ev_river')!;
    const res = applyEventOption({
      save, run, option: ev.options[0], rng: { int: () => 1 },
      items: items(save), leaderStatOf: statOf,
    });
    expect(res.run.party.leaderId).toBe('c1');
    expect(save.customItems.some((i) => i.id === 'it_sword_gold')).toBe(true);
    // 藏品已写入队长背包（inventory）
    const c = res.save.characters.find((x) => x?.id === 'c1')!;
    expect(c.inventory).toContain('it_sword_gold');
  });

  it('指定 owner 时物品入指定角色背包，缺省给队长；反馈含角色名', () => {
    const run = mkRun({ party: { leaderId: 'c1', memberIds: ['c1', 'c2'] } });
    const chars = [mkChar('c1', { str: 70 }), mkChar('c2', { str: 70 })];
    const save = mkSave(run, [], chars);
    const ev = EVENTS.find((e) => e.id === 'ev_river')!;
    // 指定 c2 接收
    const res = applyEventOption({
      save, run, option: ev.options[0], rng: { int: () => 1 },
      items: items(save), leaderStatOf: statOf, owner: 'c2',
    });
    const c2 = res.save.characters.find((x) => x?.id === 'c2')!;
    const c1 = res.save.characters.find((x) => x?.id === 'c1')!;
    expect(c2.inventory).toContain('it_sword_gold');
    expect(c1.inventory).not.toContain('it_sword_gold');
    expect(res.texts.some((t) => t.includes('已放入【c2】的背包'))).toBe(true);
    // owner 不在编队 → 回退队长
    const res2 = applyEventOption({
      save, run, option: ev.options[0], rng: { int: () => 1 },
      items: items(save), leaderStatOf: statOf, owner: 'nobody',
    });
    const c1b = res2.save.characters.find((x) => x?.id === 'c1')!;
    expect(c1b.inventory).toContain('it_sword_gold');
  });

  it('石中剑·蛮力：判定成功给附魔武器，按 owner 职业匹配可穿戴类型', () => {
    // c2 是凯隐（近战）：附魔武器池选剑
    const run = mkRun({ party: { leaderId: 'c1', memberIds: ['c1', 'c2'] } });
    const chars = [
      mkChar('c1', { str: 70 }),
      mkChar('c2', { int: 70 }, 'kayn'),
    ];
    const save = mkSave(run, [], chars);
    const itemsMap = new Map<string, Item>([
      ['it_sword_enchanted', mkItem('it_sword_enchanted', 'epic')],
      ['it_staff_enchanted', { ...mkItem('it_staff_enchanted', 'epic', 'weapon'), weaponType: 'magic' }],
    ]);
    const ev = EVENTS.find((e) => e.id === 'ev_stonesword')!;
    const res = applyEventOption({
      save, run, option: ev.options[1], rng: scriptRng([50, 0]), // 判定掷50 + 附魔武器池第0个
      items: itemsMap, leaderStatOf: statOf, owner: 'c2',
    });
    const c2 = res.save.characters.find((x) => x?.id === 'c2')!;
    expect(c2.inventory).toContain('it_sword_enchanted');
    expect(c2.inventory).not.toContain('it_staff_enchanted');
  });
});

describe('宝箱遗物开箱', () => {
  const chestOpt = (relicId: string): EventOption => ({
    id: 'o_test_chest',
    text: '开箱',
    outcome: { rewards: [{ kind: 'relic', relicId }] },
  });

  it('事件给宝箱：立即开箱，藏品入接收角色背包，宝箱本身仍进遗物栏', () => {
    const run = mkRun();
    const save = mkSave(run);
    const res = applyEventOption({
      save, run, option: chestOpt('rl_box_gold'), rng: { int: () => 0 },
      items: items(save), leaderStatOf: statOf,
    });
    expect(res.run.relics).toContain('rl_box_gold');
    const c = res.save.characters.find((x) => x?.id === 'c1')!;
    expect(c.inventory).toContain('it_sword_gold'); // 稀有池仅金剑
    expect(res.texts.some((t) => t.includes('开启【黄金宝箱】') && t.includes('已放入【c1】的背包'))).toBe(true);
  });

  it('指定 owner 时宝箱藏品入该角色背包；副本等级无匹配藏品时回退不限等级', () => {
    const run = mkRun({
      dungeonId: 'preWallCalamity', // 副本等级20，藏品库仅有10级 → 触发回退
      party: { leaderId: 'c1', memberIds: ['c1', 'c2'] },
    });
    const chars = [mkChar('c1', { str: 70 }), mkChar('c2', { str: 70 })];
    const save = mkSave(run, [], chars);
    const res = applyEventOption({
      save, run, option: chestOpt('rl_box_diamond'), rng: { int: () => 0 },
      items: items(save), leaderStatOf: statOf, owner: 'c2',
    });
    // 藏品库无史诗藏品 → 无合适藏品时给出提示而非报错
    const c2 = res.save.characters.find((x) => x?.id === 'c2')!;
    expect(c2.inventory).toEqual([]);
    expect(res.texts.some((t) => t.includes('没有找到合适的藏品'))).toBe(true);

    // 用有史诗藏品的目录：钻石宝箱开出史诗藏品并入 c2 背包
    const richItems = new Map(items(save));
    richItems.set('it_sword_enchanted', mkItem('it_sword_enchanted', 'epic'));
    const res2 = applyEventOption({
      save, run, option: chestOpt('rl_box_diamond'), rng: { int: () => 0 },
      items: richItems, leaderStatOf: statOf, owner: 'c2',
    });
    const c2b = res2.save.characters.find((x) => x?.id === 'c2')!;
    expect(c2b.inventory).toContain('it_sword_enchanted');
    expect(res2.texts.some((t) => t.includes('已放入【c2】的背包'))).toBe(true);
  });
});

describe('findStage', () => {
  it('按名字找关卡；urgent=true 优先紧急难度', () => {
    const save = mkSave(mkRun(), [
      mkStage('sv_27', '迷失少女', 'normal'),
      mkStage('sv_28', '迷失少女', 'urgent'),
    ]);
    expect(findStage(save, '迷失少女', true)?.id).toBe('sv_28');
    expect(findStage(save, '迷失少女', false)?.id).toBe('sv_27');
    expect(findStage(save, '小粉', true)).toBeNull();
  });

  it('随机遗物不掉落 inPool=false 的事件遗物', () => {
    const run = mkRun({ coins: 3000 });
    const save = mkSave(run);
    const ev = EVENTS.find((e) => e.id === 'ev_squirrel')!;
    const res = applyEventOption({
      save, run, option: ev.options[1], rng: { int: (min) => min },
      items: items(save), leaderStatOf: statOf,
    });
    expect(res.run.relics.every((id) => RELICS.find((r) => r.id === id)?.inPool !== false)).toBe(true);
  });
});