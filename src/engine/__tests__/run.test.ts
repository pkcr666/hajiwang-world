import { beforeAll, describe, expect, it } from 'vitest';
import type {
  ActMap, Character, MapEdge, MapNode, MapNodeKind, Party, Rng, RunActId, RunState, SaveData, StageDef,
} from '../../types';
import {
  applyBattleHpMp, availableNodes, buildBattleRewards, canEnter, currentMap, enterSublayer,
  openTorchLink, findNode, resolveNode, rollTorchDrop, startRun, torchEdgeKey,
} from '../run';
import { RELICS } from '../../data/relics';
import { abortRun, beginRun, completeRun, persistRun } from '../../save/storage';
import { MAP_DUNGEON } from '../mapgen';

// ===== 关卡夹具（三层各普通+紧急）=====
const mkStage = (id: string, floor: number, difficulty: 'normal' | 'urgent'): StageDef => ({
  id, name: id, dungeon: MAP_DUNGEON, floor, difficulty, appear: 'regular',
  level: 10, desc: '', monsters: [{ monsterId: 'slime', count: 1 }],
  mechanics: [], drops: [], luckyDrops: [],
});
const stages: StageDef[] = [1, 2, 3].flatMap((f) => [
  mkStage(`n${f}a`, f, 'normal'), mkStage(`n${f}b`, f, 'normal'),
  mkStage(`u${f}a`, f, 'urgent'),
]);

const party: Party = { leaderId: 'c1', memberIds: ['c1'] };

// ===== 确定性手工地图：act1 两连、act2 两连（末为BOSS）、act3 作战→异界来客→BOSS =====
const node = (
  id: string, act: RunActId, col: number, kind: MapNodeKind,
  extra: Partial<MapNode> = {},
): MapNode => ({ id, act, col, row: 0, kind, ...extra });
const edge = (from: string, to: string): MapEdge => ({ from, to });
const chain = (act: RunActId, nodes: MapNode[]): ActMap => ({
  act, cols: nodes.length, rows: 1, nodes,
  edges: nodes.slice(0, -1).map((n, i) => edge(n.id, nodes[i + 1]!.id)),
});
const emptyAct = (act: RunActId): ActMap => ({ act, cols: 0, rows: 0, nodes: [], edges: [] });

const mkRun = (): RunState => ({
  dungeonId: 'starterVillage',
  party: { leaderId: 'c1', memberIds: ['c1'] },
  acts: {
    1: chain(1, [
      node('A0', 1, 0, 'combat', { stageId: 'n1a' }),
      node('A1', 1, 1, 'merchant'),
    ]),
    2: chain(2, [
      node('B0', 2, 0, 'combat', { stageId: 'n2a' }),
      node('B1', 2, 1, 'boss', { stageId: 'boss2a' }),
    ]),
    3: chain(3, [
      node('C0', 3, 0, 'combat', { stageId: 'n3a' }),
      node('Cv', 3, 1, 'visitor', { note: '瑟银的菜鸟' }),
      node('Cb', 3, 2, 'boss', { stageId: 'boss3a' }),
    ]),
    4: chain(4, [
      node('D0', 4, 0, 'combat', { stageId: 'n4a' }),
      node('Db', 4, 1, 'boss', { stageId: 'boss4a' }),
    ]),
    5: emptyAct(5),
    6: emptyAct(6),
    7: emptyAct(7),
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
});

describe('startRun', () => {
  it('一次生成三层，初始在一层、无清理、币池=携币总和、HP/MP 克隆', () => {
    const r = startRun({
      party, stages,
      rng: { int: (v: number) => v },
      initialHpMp: { c1: { hp: 88, mp: 33 } },
      pooledCoins: 120,
      now: 7,
    });
    expect(r.act).toBe(1);
    expect(r.cleared).toEqual([]);
    expect(r.coins).toBe(120);
    expect(r.initialPool).toBe(120);
    expect(r.hpMp).toEqual({ c1: { hp: 88, mp: 33 } });
    expect(r.sublayer).toBeNull();
    expect(r.subDone).toBe(false);
    expect(r.torches).toBe(2);
    expect(r.openedEdges).toEqual([]);
    expect(r.createdAt).toBe(7);
    expect([r.acts[1].nodes.length, r.acts[2].nodes.length, r.acts[3].nodes.length])
      .toEqual([7, 12, 20]);
  });
});

describe('availableNodes / canEnter', () => {
  it('每层开局只有首列节点可选；清理后沿入边开放', () => {
    const r0 = mkRun();
    expect(availableNodes(r0).map((n) => n.id)).toEqual(['A0']);
    expect(canEnter(r0, 'A1')).toBe(false);

    const r1 = resolveNode(r0, 'A0');
    expect(availableNodes(r1).map((n) => n.id)).toEqual(['A1']);
    expect(r1.cleared).toContain('A0');
  });

  it('不可达节点 resolve 原样返回（同一引用）', () => {
    const r = mkRun();
    expect(resolveNode(r, 'B0')).toBe(r);
    expect(resolveNode(r, 'Cb')).toBe(r);
  });

  it('选定节点后只能往前/上下走，不能回头或改走同列其他分支', () => {
    const r0 = mkRun();
    // 先走完一层进入二层
    const r = resolveNode(resolveNode(r0, 'A0'), 'A1');
    // 二层加同列另一起点 B0b 与 B0 的分支 B2（跨支不可达）
    r.acts[2].nodes.push(node('B0b', 2, 0, 'combat', { stageId: 'n2b', row: 1 }));
    r.acts[2].nodes.push(node('B2', 2, 1, 'encounter', { row: 1 }));
    r.acts[2].edges.push({ from: 'B0', to: 'B2' }, { from: 'B0b', to: 'B1' });
    // 二层开局未选定：首列 B0/B0b 都可选
    expect(availableNodes(r).map((n) => n.id)).toEqual(['B0', 'B0b']);
    // 选定 B0：只开放其出边指向的 B1/B2，同列另一支 B0b 不再可选
    const r2 = resolveNode(r, 'B0');
    expect(availableNodes(r2).map((n) => n.id)).toEqual(['B1', 'B2']);
  });

  it('火把线从当前节点出发双向通行，未点亮不可通行', () => {
    const r = mkRun();
    r.acts[1].nodes.push(node('A0t', 1, 0, 'rest', { row: 1 }));
    r.acts[1].edges.push({ from: 'A0', to: 'A0t', torch: true });
    const r1 = resolveNode(r, 'A0');
    // 未点亮：即使一端已清理也不可通行
    expect(availableNodes(r1).map((n) => n.id)).toEqual(['A1']);
    // 点亮后：从当前节点 A0 可以上下走到 A0t
    const r2 = openTorchLink(r1, 'A0', 'A0t');
    expect(availableNodes(r2).map((n) => n.id)).toEqual(['A1', 'A0t']);
  });
});

describe('层推进', () => {
  it('一层行商→二层；二层BOSS→三层；三层BOSS→通关', () => {
    let r = mkRun();
    r = resolveNode(r, 'A0');
    expect(r.act).toBe(1);
    r = resolveNode(r, 'A1'); // 诡异行商（一层终点）
    expect(r.act).toBe(2);
    expect(availableNodes(r).map((n) => n.id)).toEqual(['B0']);

    r = resolveNode(r, 'B0');
    expect(r.act).toBe(2);
    r = resolveNode(r, 'B1'); // 史莱姆之王
    expect(r.act).toBe(3);
    expect(availableNodes(r).map((n) => n.id)).toEqual(['C0']);

    r = resolveNode(r, 'C0');
    r = resolveNode(r, 'Cv'); // 异界来客选「离开」=直接清理，不进子层
    expect(r.act).toBe(3);
    expect(r.result).toBeUndefined();
    r = resolveNode(r, 'Cb'); // 克苏鲁之眼
    expect(r.result).toBe('win');
  });

  it('进入新层生命水晶+1，全体当前生命同步+20', () => {
    const r0 = { ...mkRun(), relics: ['rl_life_crystal'], relicStacks: { rl_life_crystal: 1 } };
    const r1 = resolveNode(r0, 'A0');
    const r2 = resolveNode(r1, 'A1'); // 行商 → 二层，生命水晶+1
    expect(r2.act).toBe(2);
    expect(r2.relicStacks!.rl_life_crystal).toBe(2);
    expect(r2.hpMp.c1!.hp).toBe(120); // 100 + 20
  });

  it('通关BOSS魔力水晶+1，全体当前魔力同步+10', () => {
    const r0 = { ...mkRun(), relics: ['rl_mana_crystal'], relicStacks: { rl_mana_crystal: 0 } };
    let r = resolveNode(r0, 'A0');
    r = resolveNode(r, 'A1');
    r = resolveNode(r, 'B0');
    r = resolveNode(r, 'B1'); // 二层BOSS → 魔力水晶+1
    expect(r.relicStacks!.rl_mana_crystal).toBe(1);
    expect(r.hpMp.c1!.mp).toBe(60); // 50 + 10
  });
});

describe('掉落与 HP/MP 继承', () => {
  it('材料暂存（同 id 合并）、哈哈币立即加入共享池', () => {
    const r0 = mkRun();
    const r1 = resolveNode(r0, 'A0', {
      materials: [{ itemId: 'gel', count: 3 }], coins: 25,
    });
    expect(r1.coins).toBe(125);
    expect(r1.pendingMaterials).toEqual([{ itemId: 'gel', count: 3 }]);
    // 原 run 不被突变
    expect(r0.coins).toBe(100);
    expect(r0.pendingMaterials).toEqual([]);

    const r2 = resolveNode(r1, 'A1', {
      materials: [{ itemId: 'gel', count: 2 }, { itemId: 'iron', count: 1 }], coins: 4,
    });
    // 一层终点行商本不该有掉落，但 merge 逻辑与节点类型无关
    expect(r2.coins).toBe(129);
    expect(r2.pendingMaterials).toContainEqual({ itemId: 'gel', count: 5 });
    expect(r2.pendingMaterials).toContainEqual({ itemId: 'iron', count: 1 });
  });

  it('applyBattleHpMp 覆盖终态；未知 id 忽略；负值钳 0；不突变原对象', () => {
    const r = mkRun();
    const next = applyBattleHpMp(r, [
      { id: 'c1', hp: 63.6, mp: 12 },
      { id: 'ghost', hp: 1, mp: 1 },
      { id: 'c1', hp: -9, mp: -2 }, // 同 id 后者覆盖
    ]);
    expect(next.hpMp.c1).toEqual({ hp: 0, mp: 0 });
    expect(next.hpMp.ghost).toBeUndefined();
    expect(r.hpMp.c1).toEqual({ hp: 100, mp: 50 });
  });
});

describe('异界来客人子层', () => {
  it('非三层 / 该子层已完成时不能进入', () => {
    const r = mkRun();
    expect(enterSublayer(r, 'Cv', '瑟银的菜鸟', stages, { int: (v: number) => v })).toBe(r);
    const done = { ...mkRun(), act: 3 as RunActId, doneSublayers: ['瑟银的菜鸟'], cleared: ['C0'] };
    expect(enterSublayer(done, 'Cv', '瑟银的菜鸟', stages, { int: (v: number) => v })).toBe(done);
    // 已完成的子层名不影响进入其他子层
    const other = { ...mkRun(), act: 3 as RunActId, subDone: true, doneSublayers: ['蜂巢'], cleared: ['C0'] };
    const entered = enterSublayer(other, 'Cv', '瑟银的菜鸟', stages, { int: (v: number) => v });
    expect(entered.act).toBe('sub');
  });

  it('进入后逐节点清理子层，末节点清完回三层、visitor 视为已清理、记录完成子层', () => {
    let r = mkRun();
    r = resolveNode(r, 'A0');
    r = resolveNode(r, 'A1');
    r = resolveNode(r, 'B0');
    r = resolveNode(r, 'B1');
    r = resolveNode(r, 'C0');

    r = enterSublayer(r, 'Cv', '瑟银的菜鸟', stages, { int: (v: number) => v });
    expect(r.act).toBe('sub');
    expect(r.visitorNodeId).toBe('Cv');
    expect(r.sublayer).not.toBeNull();
    expect(currentMap(r).act).toBe('sub');

    const sub = [...r.sublayer!.nodes].sort((a, b) => a.col - b.col);
    expect(sub).toHaveLength(5);
    expect(findNode(r, sub[0]!.id)?.map.act).toBe('sub');

    // 逐个推进：前 4 个清完仍在子层
    for (let i = 0; i < 4; i++) {
      r = resolveNode(r, sub[i]!.id);
      expect(r.act).toBe('sub');
      expect(r.cleared).toContain(sub[i]!.id);
    }
    // 第 5 个（安全角落）清完 → 回三层
    r = resolveNode(r, sub[4]!.id);
    expect(r.act).toBe(3);
    expect(r.subDone).toBe(true);
    expect(r.doneSublayers).toContain('瑟银的菜鸟');
    expect(r.visitorNodeId).toBeNull();
    expect(r.cleared).toContain('Cv');
    // visitor 已清理 → BOSS 开放
    expect(canEnter(r, 'Cb')).toBe(true);
  });

  it('进入子层：子层也算一层，生命水晶 +1 层（每层+20生命上限）', () => {
    const base = mkRun();
    base.act = 3;
    base.cleared = ['C0', 'Cv'];
    base.relics = ['rl_life_crystal'];
    base.relicStacks = { rl_life_crystal: 1 };
    const out = enterSublayer(base, 'Cv', '瑟银的菜鸟', stages, { int: (v: number) => v });
    expect(out.act).toBe('sub');
    expect(out.relicStacks?.rl_life_crystal).toBe(2);

    // 未持有生命水晶：不产生叠层记录
    const noCrystal = mkRun();
    noCrystal.act = 3;
    noCrystal.cleared = ['C0', 'Cv'];
    const out2 = enterSublayer(noCrystal, 'Cv', '瑟银的菜鸟', stages, { int: (v: number) => v });
    expect(out2.act).toBe('sub');
    expect(out2.relicStacks).toBeUndefined();
  });
});

// ===== 火把机制 =====
// 带火把线的三层地图：C0 → Cv → Cb 推进线 + C1↔Cv 火把线（C1 在 col1 row1）
const mkTorchRun = (torches: number, cleared: string[] = ['C0', 'Cv']): RunState => {
  const r = mkRun();
  r.act = 3;
  r.cleared = cleared;
  r.acts[3].nodes.push(node('C1', 3, 1, 'combat', { stageId: 'n3b' }));
  r.acts[3].edges.push({ from: 'C1', to: 'Cv', torch: true });
  r.torches = torches;
  return r;
};

describe('火把掉落判定', () => {
  it('BOSS 100%、紧急 50%（int(1,2)=1）、普通 25%（int(1,4)=1）', () => {
    const hit = { int: () => 1 };
    const miss = { int: () => 2 };
    expect(rollTorchDrop({ id: 'x', act: 3, col: 0, row: 0, kind: 'boss' } as MapNode, miss)).toBe(true);
    expect(rollTorchDrop({ id: 'x', act: 1, col: 0, row: 0, kind: 'combat', urgent: true } as MapNode, hit)).toBe(true);
    expect(rollTorchDrop({ id: 'x', act: 1, col: 0, row: 0, kind: 'combat', urgent: true } as MapNode, miss)).toBe(false);
    expect(rollTorchDrop({ id: 'x', act: 1, col: 0, row: 0, kind: 'combat' } as MapNode, miss)).toBe(false);
    expect(rollTorchDrop({ id: 'x', act: 1, col: 0, row: 0, kind: 'combat' } as MapNode, hit)).toBe(true);
    // 非作战/BOSS 节点不掉
    expect(rollTorchDrop({ id: 'x', act: 1, col: 0, row: 0, kind: 'merchant' } as MapNode, hit)).toBe(false);
  });

  it('resolveNode 传 rng 时作战胜利掉火把、不传则不掉', () => {
    const r0 = mkRun();
    const r1 = resolveNode(r0, 'A0', undefined, { int: () => 1 }); // 普通作战 25% 命中
    expect(r1.torches).toBe(3);
    const r2 = resolveNode(r0, 'A0', undefined, { int: () => 2 }); // 未命中
    expect(r2.torches).toBe(2);
    const r3 = resolveNode(r0, 'A0'); // 不传 rng（占位/测试路径）
    expect(r3.torches).toBe(2);
  });
});

describe('火把线点亮与通行', () => {
  it('未点亮的火把线不提供通行；点亮后可通行（火把边 from 端在未清理侧）', () => {
    const r0 = mkTorchRun(2);
    expect(canEnter(r0, 'C1')).toBe(false);
    const r1 = openTorchLink(r0, 'Cv', 'C1');
    expect(r1.torches).toBe(1);
    expect(r1.openedEdges).toEqual([torchEdgeKey('Cv', 'C1')]);
    expect(canEnter(r1, 'C1')).toBe(true);
  });

  it('无火把 / 两端同态 / 重复点亮均无效', () => {
    const noTorch = mkTorchRun(0);
    expect(openTorchLink(noTorch, 'Cv', 'C1')).toBe(noTorch); // 火把不足
    const bothUncleared = mkTorchRun(2, []);
    expect(openTorchLink(bothUncleared, 'Cv', 'C1')).toBe(bothUncleared); // 两端都未清理
    const lit = openTorchLink(mkTorchRun(2), 'Cv', 'C1');
    expect(openTorchLink(lit, 'C1', 'Cv')).toBe(lit); // 已点亮（反向 key 相同）
  });
});

describe('异界来客进入子层消耗火把', () => {
  it('火把不足不能进入；进入成功扣 1 根', () => {
    const r = { ...mkRun(), act: 3 as RunActId, cleared: ['C0'], torches: 0 };
    expect(enterSublayer(r, 'Cv', '瑟银的菜鸟', stages, { int: (v: number) => v })).toBe(r);
    const ok = enterSublayer({ ...r, torches: 1 }, 'Cv', '瑟银的菜鸟', stages, { int: (v: number) => v });
    expect(ok.torches).toBe(0);
    expect(ok.act).toBe('sub');
  });
});

// ===== storage 结算（node 环境用内存 localStorage 桩）=====
beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

const mkChar = (id: string, coins: number): Character => ({
  id, name: id, job: 'cat', level: 10,
  extra: { str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 50 },
  equip: { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] },
  relics: [], inventory: [], bag: [], storage: [], coins, createdAt: 0,
});

const mkSave = (): SaveData => ({
  version: 1,
  characters: [mkChar('c1', 60), mkChar('c2', 50), mkChar('c3', 40)],
  customItems: [], customMonsters: [], customStages: stages,
  materials: [], coinsInStorage: 0, party: null, activeRun: null,
});

describe('beginRun / persistRun', () => {
  it('beginRun 记住编队、成员携币清零入池、run 落盘', () => {
    const run = startRun({
      party: { leaderId: 'c1', memberIds: ['c1', 'c2', 'c3'] },
      stages, rng: { int: (v: number) => v },
      initialHpMp: {}, pooledCoins: 150,
    });
    const next = beginRun(mkSave(), run);
    expect(next.characters.map((c) => c?.coins)).toEqual([0, 0, 0]);
    expect(next.activeRun?.coins).toBe(150);
    expect(next.party?.memberIds).toEqual(['c1', 'c2', 'c3']);

    const tweaked = persistRun(next, { ...next.activeRun!, coins: 99 });
    expect(tweaked.activeRun?.coins).toBe(99);
  });
});

describe('completeRun 通关结算', () => {
  it('金币按人数平分给各成员、材料一人一份进各成员仓库、清除 run', () => {
    const s = mkSave();
    let run = startRun({
      party: { leaderId: 'c1', memberIds: ['c1', 'c2', 'c3'] },
      stages, rng: { int: (v: number) => v },
      initialHpMp: {}, pooledCoins: 150,
    });
    run = resolveNode(run, run.acts[1].nodes.find((n) => n.col === 0)!.id, {
      materials: [{ itemId: 'gel', count: 7 }], coins: 30,
    });
    const next = completeRun(beginRun(s, run));
    expect(next.activeRun).toBeNull();
    // 进本前个人币 [60,50,40] 恢复；通关币（本金150+掉落30=180）按3人平分各得60，合计 [120,110,100]
    expect(next.characters.map((c) => c?.coins)).toEqual([120, 110, 100]);
    expect(next.coinsInStorage).toBe(0);
    // 材料一人一份进入各成员独有仓库
    for (const c of next.characters) {
      expect(c?.storage).toContainEqual({ itemId: 'gel', count: 7 });
    }
  });
});

describe('abortRun 团灭/撤离', () => {
  it('清空背包/药水/金币、保留穿戴与仓库、清除 run', () => {
    const s = mkSave();
    let run = startRun({
      party: { leaderId: 'c1', memberIds: ['c1', 'c2', 'c3'] },
      stages, rng: { int: (v: number) => v },
      initialHpMp: {}, pooledCoins: 150,
    });
    run = resolveNode(run, run.acts[1].nodes.find((n) => n.col === 0)!.id, {
      materials: [{ itemId: 'gel', count: 7 }], coins: 30,
    });
    const next = abortRun(beginRun(s, run));
    expect(next.activeRun).toBeNull();
    // 撤离：背包、药水清空；进本前个人币 [60,50,40] 如数归还，本局所得不带出
    expect(next.characters.map((c) => c?.coins)).toEqual([60, 50, 40]);
    for (const c of next.characters) {
      expect(c?.inventory).toEqual([]);
      expect(c?.bag).toEqual([]);
    }
    expect(next.coinsInStorage).toBe(0);
    // 材料不发放
    for (const c of next.characters) {
      expect(c?.storage ?? []).not.toContainEqual({ itemId: 'gel', count: 7 });
    }
  });

  it('撤离清空所有背包与药水（不恢复进本前物品）', () => {
    const s = mkSave();
    // 进本前队长背包：一件旧藏品 + 2瓶小HP药
    const c0 = s.characters.find((c) => c?.id === 'c1')!;
    c0.inventory = ['it_bow_iron'];
    c0.bag = [{ itemId: 'it_potion_hp_s', count: 2 }];
    const run = startRun({
      party: { leaderId: 'c1', memberIds: ['c1', 'c2', 'c3'] },
      stages, rng: { int: (v: number) => v },
      initialHpMp: {}, pooledCoins: 0,
    });
    // 进本后本局获得：拾取 1 件藏品、买 3 瓶小HP药
    const inRun = beginRun(s, run);
    const c1 = inRun.characters.find((x) => x?.id === 'c1')!;
    c1.inventory = [...(c1.inventory ?? []), 'it_helmet_iron'];
    c1.bag = [{ itemId: 'it_potion_hp_s', count: 5 }];
    const next = abortRun(inRun);
    const restored = next.characters.find((x) => x?.id === 'c1')!;
    // 撤离：背包与药水全部清空（含进本前携带的）
    expect(restored.inventory).toEqual([]);
    expect(restored.bag).toEqual([]);
  });

  it('无 activeRun 时原样返回', () => {
    const s = mkSave();
    expect(abortRun(s)).toBe(s);
    expect(completeRun(s)).toBe(s);
  });
});

describe('杀人书（每通关一次作战+1层）', () => {
  it('作战/BOSS胜利叠层，商人/异界来客不叠，上限10层', () => {
    const r0 = { ...mkRun(), relics: ['rl_kill_book'] };
    const r1 = resolveNode(r0, 'A0'); // 一层作战
    expect(r1.killBook).toBe(1);
    const r2 = resolveNode(r1, 'A1'); // 行商 → 二层
    expect(r2.killBook).toBe(1);
    const r3 = resolveNode(r2, 'B0'); // 二层作战
    expect(r3.killBook).toBe(2);
    const r4 = resolveNode(r3, 'B1'); // 二层BOSS → 三层
    expect(r4.killBook).toBe(3);
    const r5 = resolveNode(r4, 'C0'); // 三层作战
    expect(r5.killBook).toBe(4);
    const r5b = resolveNode(r5, 'Cv'); // 异界来客（占位通过）
    expect(r5b.killBook).toBe(4);
    const r6 = resolveNode(r5b, 'Cb'); // 三层BOSS → 通关
    expect(r6.killBook).toBe(5);
    // 叠层上限 10
    const capped = resolveNode({ ...r6, act: 1, killBook: 9, cleared: [], result: undefined }, 'A0');
    expect(capped.killBook).toBe(10);
    const capped2 = resolveNode({ ...capped, cleared: [] }, 'A0');
    expect(capped2.killBook).toBe(10);
  });

  it('未持有杀人书不叠层', () => {
    const r = resolveNode(mkRun(), 'A0');
    expect(r.killBook).toBeUndefined();
  });
});

describe('buildBattleRewards 遗物去重', () => {
  const rngOne: Rng = { int: () => 1 };

  const mkDedupStage = (lucky: StageDef['luckyDrops']): StageDef => ({
    id: 's_dedup', name: '去重关', dungeon: MAP_DUNGEON, floor: 1, difficulty: 'normal',
    appear: 'regular', level: 10, desc: '', monsters: [], mechanics: [], drops: [], luckyDrops: lucky,
  });

  it('幸运判定通过但随机遗物池已集齐 → 出提示卡，不再产出遗物', () => {
    const r = mkRun();
    // owned 覆盖全部在池传说遗物 → 传说随机池被掏空
    const pool = RELICS.filter((x) => x.inPool !== false && x.rarity === 'legendary');
    r.relics = pool.map((x) => x.id);
    const stage = mkDedupStage([{ id: 'l', kind: 'relic', source: 'pool', rarity: 'legendary', threshold: 1 }]);
    const rewards = buildBattleRewards({ items: [], run: r, node: r.acts[1].nodes[0], stage, leaderLuck: 100, rng: rngOne });
    const note = rewards.find((x) => x.kind === 'luckyFail');
    expect(note).toMatchObject({ kind: 'luckyFail' });
    expect(rewards.some((x) => x.kind === 'relic')).toBe(false);
  });

  it('已拥有的随机遗物不再掉落；未拥有正常掉落', () => {
    const inPool = RELICS.filter((x) => x.inPool !== false && x.rarity === 'rare');
    expect(inPool.length).toBeGreaterThan(1);
    const r = mkRun();
    r.relics = [inPool[0]!.id];
    const stage = mkDedupStage([{ id: 'l', kind: 'relic', source: 'pool', rarity: 'rare', threshold: 1 }]);
    const rewards = buildBattleRewards({ items: [], run: r, node: r.acts[1].nodes[0], stage, leaderLuck: 100, rng: rngOne });
    const relicCard = rewards.find((x) => x.kind === 'relic');
    expect(relicCard).toBeTruthy();
    expect((relicCard as { relicId: string }).relicId).not.toBe(inPool[0]!.id);
  });
});