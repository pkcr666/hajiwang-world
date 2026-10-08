import { describe, expect, it } from 'vitest';
import type { ActMap, MapNode, MapNodeKind, Rng, StageAppear, StageDef, StageDifficulty } from '../../types';
import {
  MAP_DUNGEON, SUBLAYER_DEFAULT_NAME,
  buildSublayer, configuredSublayers, generateAct, runBlockers,
} from '../mapgen';

// ===== 夹具 =====
const mkStage = (
  id: string, floor: number, difficulty: StageDifficulty,
  opts: { appear?: StageAppear; sublayerName?: string } = {},
): StageDef => ({
  id, name: id, dungeon: MAP_DUNGEON, floor, difficulty,
  appear: opts.appear ?? 'regular',
  sublayerName: opts.sublayerName,
  level: 10, desc: '', monsters: [{ monsterId: 'slime', count: 1 }],
  mechanics: [], drops: [], luckyDrops: [],
});

// 每层 4 普通 + 3 紧急 + 2/3层各 2 常规BOSS + 配置齐全的子层「瑟银的菜鸟」
const fullStages: StageDef[] = [
  ...[1, 2, 3].flatMap((f) => [
    ...[0, 1, 2, 3].map((i) => mkStage(`s_f${f}_n${i}`, f, 'normal')),
    ...[0, 1, 2].map((i) => mkStage(`s_f${f}_u${i}`, f, 'urgent')),
  ]),
  mkStage('s_f2_b0', 2, 'boss'),
  mkStage('s_f2_b1', 2, 'boss'),
  mkStage('s_f3_b0', 3, 'boss'),
  mkStage('s_f3_b1', 3, 'boss'),
  ...[0, 1, 2].map((i) => mkStage(`s_sub_n${i}`, 3, 'normal', { appear: 'sublayer', sublayerName: SUBLAYER_DEFAULT_NAME })),
  ...[0, 1].map((i) => mkStage(`s_sub_u${i}`, 3, 'urgent', { appear: 'sublayer', sublayerName: SUBLAYER_DEFAULT_NAME })),
  mkStage('s_sub_b0', 3, 'boss', { appear: 'sublayer', sublayerName: SUBLAYER_DEFAULT_NAME }),
];

const normalOnlyStages: StageDef[] = [1, 2, 3].flatMap((f) =>
  [0, 1, 2].map((i) => mkStage(`s_f${f}_n${i}`, f, 'normal')),
);

// 固定返回 v（钳进 [min,max]）：v=1 时 25% 判定全部命中紧急
const clampRng = (v: number): Rng => ({ int: (min, max) => Math.min(max, Math.max(min, v)) });

// 可复现的 LCG，用于结构压力测试
const lcgRng = (seed: number): Rng => {
  let x = seed >>> 0;
  return {
    int: (min, max) => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return min + (x % (max - min + 1));
    },
  };
};

const countKind = (m: ActMap, kind: MapNodeKind) =>
  m.nodes.filter((n) => n.kind === kind).length;
const byCol = (m: ActMap, col: number) => m.nodes.filter((n) => n.col === col);

// 从所有首列节点出发 BFS：可达节点 id 集合
function reachable(m: ActMap): Set<string> {
  const seen = new Set<string>();
  const queue = byCol(m, 0).map((n) => n.id);
  queue.forEach((id) => seen.add(id));
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of m.edges) {
      if (e.from === id && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
  }
  return seen;
}

// 每个非终列节点必须有出边（无死路）；每个非首列节点必须有入边
const assertWiring = (m: ActMap) => {
  for (const n of m.nodes) {
    if (n.col < m.cols - 1) {
      expect(m.edges.some((e) => e.from === n.id)).toBe(true);
    }
    if (n.col > 0) {
      expect(m.edges.some((e) => e.to === n.id)).toBe(true);
    }
  }
  // 边只在相邻列之间（火把线为同列上下联通，跳过）
  const nodeById = new Map(m.nodes.map((n) => [n.id, n]));
  for (const e of m.edges) {
    if (e.torch) continue;
    expect(nodeById.get(e.to)!.col - nodeById.get(e.from)!.col).toBe(1);
  }
};

// 火把线：同列、行差1、不重复
const assertTorchEdges = (m: ActMap, min: number, max: number) => {
  const torches = m.edges.filter((e) => e.torch);
  expect(torches.length).toBeGreaterThanOrEqual(min);
  expect(torches.length).toBeLessThanOrEqual(max);
  const seen = new Set<string>();
  const nodeById = new Map(m.nodes.map((n) => [n.id, n]));
  for (const e of torches) {
    const key = [e.from, e.to].sort().join('|');
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    const a = nodeById.get(e.from)!;
    const b = nodeById.get(e.to)!;
    expect(a.col).toBe(b.col);
    expect(Math.abs(a.row - b.row)).toBe(1);
  }
};

const combats = (m: ActMap) => m.nodes.filter((n) => n.kind === 'combat');

describe('runBlockers（开始冒险前的关卡校验）', () => {
  it('三层常规普通+BOSS+配置齐全的子层齐备时为空', () => {
    expect(runBlockers(fullStages)).toEqual([]);
  });
  it('缺普通/缺2/3层BOSS/缺子层时逐项列出', () => {
    const partial = [
      mkStage('a', 1, 'normal'),
      mkStage('b', 2, 'urgent'),
      { ...mkStage('c', 3, 'normal'), appear: 'event' as const },
    ];
    expect(runBlockers(partial)).toEqual([
      '第2层常规普通关卡', '第2层常规BOSS关卡',
      '第3层常规普通关卡', '第3层常规BOSS关卡',
      '子层（需创建含 BOSS 关与普通/紧急关的子层关卡）',
    ]);
  });
  it('子层仅 BOSS 关（无普通/紧急）不算配置齐全', () => {
    const st = [
      mkStage('a', 1, 'normal'),
      mkStage('b', 2, 'normal'), mkStage('b2', 2, 'boss'),
      mkStage('c', 3, 'normal'), mkStage('c2', 3, 'boss'),
      mkStage('s1', 3, 'boss', { appear: 'sublayer', sublayerName: '孤岛' }),
    ];
    expect(runBlockers(st)).toContain('子层（需创建含 BOSS 关与普通/紧急关的子层关卡）');
  });
});

describe('configuredSublayers', () => {
  it('只有同时具备 BOSS 关与普通/紧急关的子层名才返回', () => {
    expect(configuredSublayers(fullStages)).toEqual([SUBLAYER_DEFAULT_NAME]);
    expect(configuredSublayers(normalOnlyStages)).toEqual([]);
    expect(configuredSublayers([mkStage('s1', 3, 'boss', { appear: 'sublayer', sublayerName: '孤岛' })])).toEqual([]);
  });
});

describe('一层地图', () => {
  it('配额：C1 单普通作战 + C2/C3 三作战两遭遇 + C4 行商，共7节点', () => {
    for (const rng of [clampRng(1), clampRng(2), lcgRng(7), lcgRng(99)]) {
      const m = generateAct(1, fullStages, rng);
      expect(m.cols).toBe(4);
      expect(m.rows).toBe(3);
      expect(m.nodes).toHaveLength(7);
      expect(countKind(m, 'combat')).toBe(4);
      expect(countKind(m, 'encounter')).toBe(2);
      expect(countKind(m, 'merchant')).toBe(1);

      const c1 = byCol(m, 0);
      expect(c1).toHaveLength(1);
      expect(c1[0]).toMatchObject({ kind: 'combat', row: 1, urgent: false });
      expect(c1[0]!.stageId).toBeTruthy();

      const mid = [1, 2].flatMap((c) => byCol(m, c));
      expect(mid).toHaveLength(5);
      expect(byCol(m, 1).length + byCol(m, 2).length).toBe(5);
      expect([byCol(m, 1).length, byCol(m, 2).length].sort((a, b) => a - b)).toEqual([2, 3]);

      const c4 = byCol(m, 3);
      expect(c4).toHaveLength(1);
      expect(c4[0]).toMatchObject({ kind: 'merchant', row: 1 });

      assertTorchEdges(m, 1, 2); // 一层 1~2 条火把线
    }
  });

  it('全部节点从首列可达且无死路；单节点列与邻列全连', () => {
    const m = generateAct(1, fullStages, lcgRng(3));
    const reach = reachable(m);
    m.nodes.forEach((n) => expect(reach.has(n.id)).toBe(true));
    assertWiring(m);
    // C1 单节点 → C2 每个节点都有来自 C1 的入边
    const c1 = byCol(m, 0)[0]!;
    byCol(m, 1).forEach((n) => {
      expect(m.edges.some((e) => e.from === c1.id && e.to === n.id)).toBe(true);
    });
    // C3 → C4 单节点：每个 C3 节点都连到行商
    const merchant = byCol(m, 3)[0]!;
    byCol(m, 2).forEach((n) => {
      expect(m.edges.some((e) => e.from === n.id && e.to === merchant.id)).toBe(true);
    });
  });
});

describe('二层地图', () => {
  it('配额：两普通起点 + 4作战/3不期而遇/1安全角落/1失与得 + 常规BOSS', () => {
    const m = generateAct(2, fullStages, lcgRng(11));
    expect(m.cols).toBe(5);
    expect(m.rows).toBe(3);
    expect(m.nodes).toHaveLength(12);
    expect(countKind(m, 'combat')).toBe(6);
    expect(countKind(m, 'encounter')).toBe(3);
    expect(countKind(m, 'rest')).toBe(1);
    expect(countKind(m, 'trade')).toBe(1);
    expect(countKind(m, 'boss')).toBe(1);

    const starts = byCol(m, 0);
    expect(starts.map((n) => n.row).sort()).toEqual([0, 2]);
    starts.forEach((n) => expect(n).toMatchObject({ kind: 'combat', urgent: false }));

    const boss = byCol(m, 4);
    expect(boss).toHaveLength(1);
    expect(boss[0]).toMatchObject({ row: 1, kind: 'boss' });
    expect(boss[0].stageId).toMatch(/s_f2_b\d$/); // 从玩家创建的2层常规BOSS关抽取

    assertTorchEdges(m, 1, 4); // 二层目标 3~4（候选不足时按实际）
  });

  it('中间矩阵每条横排至少 1 个作战', () => {
    for (const rng of [clampRng(1), clampRng(2), lcgRng(1), lcgRng(42), lcgRng(123456)]) {
      const m = generateAct(2, fullStages, rng);
      for (let r = 0; r < m.rows; r++) {
        const inRow = m.nodes.filter((n) => n.col >= 1 && n.col <= 3 && n.row === r);
        expect(inRow.some((n) => n.kind === 'combat')).toBe(true);
      }
      const reach = reachable(m);
      m.nodes.forEach((n) => expect(reach.has(n.id)).toBe(true));
      assertWiring(m);
    }
  });
});

describe('三层地图', () => {
  it('配额：三普通起点 + 6作战/4不期而遇/2安全角落/2行商/1失与得/1异界来客 + 常规BOSS', () => {
    const m = generateAct(3, fullStages, lcgRng(21));
    expect(m.cols).toBe(6);
    expect(m.rows).toBe(4);
    expect(m.nodes).toHaveLength(20);
    expect(countKind(m, 'combat')).toBe(9);
    expect(countKind(m, 'encounter')).toBe(4);
    expect(countKind(m, 'rest')).toBe(2);
    expect(countKind(m, 'merchant')).toBe(2);
    expect(countKind(m, 'trade')).toBe(1);
    expect(countKind(m, 'visitor')).toBe(1);
    expect(countKind(m, 'boss')).toBe(1);

    const starts = byCol(m, 0);
    expect(starts.map((n) => n.row).sort()).toEqual([0, 1, 2]);
    starts.forEach((n) => expect(n).toMatchObject({ kind: 'combat', urgent: false }));

    const visitor = m.nodes.find((n) => n.kind === 'visitor')!;
    expect(visitor.note).toBe(SUBLAYER_DEFAULT_NAME); // 取配置齐全的第一个子层名

    const boss = byCol(m, 5);
    expect(boss).toHaveLength(1);
    expect(boss[0]).toMatchObject({ row: 1, kind: 'boss' });
    expect(boss[0].stageId).toMatch(/s_f3_b\d$/); // 从玩家创建的3层常规BOSS关抽取

    assertTorchEdges(m, 4, 6); // 三层 4~6 条
  });

  it('每排至少1作战；安全角落与行商每排至多1个；全图可达无死路', () => {
    for (let seed = 0; seed < 60; seed++) {
      const m = generateAct(3, fullStages, lcgRng(seed + 1));
      for (let r = 0; r < m.rows; r++) {
        const inRow = m.nodes.filter((n) => n.col >= 1 && n.col <= 4 && n.row === r);
        expect(inRow.some((n) => n.kind === 'combat')).toBe(true);
        expect(inRow.filter((n) => n.kind === 'rest').length).toBeLessThanOrEqual(1);
        expect(inRow.filter((n) => n.kind === 'merchant').length).toBeLessThanOrEqual(1);
      }
      const reach = reachable(m);
      m.nodes.forEach((n) => expect(reach.has(n.id)).toBe(true));
      assertWiring(m);
    }
  });
});

describe('25% 紧急升级', () => {
  const stageIds = (nodes: MapNode[], urgent: boolean) =>
    nodes.filter((n) => n.kind === 'combat' && n.urgent === urgent).map((n) => n.stageId);

  it('rng 判定命中（int(1,4)=1）时所有非强制普通作战紧急，且抽紧急池', () => {
    for (const act of [1, 2, 3] as const) {
      const m = generateAct(act, fullStages, clampRng(1));
      const free = combats(m).filter((n) => n.col !== 0); // 起点列强制普通
      expect(free.length).toBeGreaterThan(0);
      free.forEach((n) => expect(n.urgent).toBe(true));
      stageIds(m.nodes, true).forEach((id) => expect(id).toMatch(/_u\d$/));
      byCol(m, 0).forEach((n) => expect(n.urgent).toBe(false));
    }
  });

  it('判定未命中时全普通，抽普通池', () => {
    for (const act of [1, 2, 3] as const) {
      const m = generateAct(act, fullStages, clampRng(2));
      combats(m).forEach((n) => expect(n.urgent).toBe(false));
      stageIds(m.nodes, false).forEach((id) => expect(id).toMatch(/_n\d$/));
    }
  });

  it('紧急池为空时即便判定命中也回落普通', () => {
    for (const act of [1, 2, 3] as const) {
      const m = generateAct(act, normalOnlyStages, clampRng(1));
      combats(m).forEach((n) => {
        expect(n.urgent).toBe(false);
        expect(n.stageId).toMatch(/_n\d$/);
      });
    }
  });
});

describe('子层·瑟银的菜鸟', () => {
  it('5 节点横向单线：紧急作战→失与得→行商→子层BOSS→安全角落', () => {
    const m = buildSublayer(fullStages, SUBLAYER_DEFAULT_NAME, clampRng(4));
    expect(m.act).toBe('sub');
    expect(m.cols).toBe(5);
    expect(m.rows).toBe(1);
    expect(m.nodes).toHaveLength(5);
    const chain = [...m.nodes].sort((a, b) => a.col - b.col);
    expect(chain.map((n) => n.kind)).toEqual(
      ['combat', 'trade', 'merchant', 'boss', 'rest'],
    );
    const first = chain[0]!;
    expect(first).toMatchObject({ col: 0, row: 0, urgent: true });
    expect(first.stageId).toMatch(/s_sub_u\d$/); // 随机子层紧急关卡
    expect(chain[3]).toMatchObject({ kind: 'boss', stageId: 's_sub_b0' });
    // 链式 4 边
    expect(m.edges).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(m.edges[i]).toEqual({ from: chain[i]!.id, to: chain[i + 1]!.id });
    }
    const reach = reachable(m);
    m.nodes.forEach((n) => expect(reach.has(n.id)).toBe(true));
  });

  it('子层无配置时首战回落三层紧急/普通池但仍然可玩', () => {
    const m = buildSublayer(normalOnlyStages, SUBLAYER_DEFAULT_NAME, clampRng(1));
    expect(m.nodes[0]!.urgent).toBe(false);
    expect(m.nodes[0]!.stageId).toMatch(/s_f3_n\d$/);
    expect(m.nodes[3]).toMatchObject({ kind: 'boss' }); // BOSS 节点仍存在
  });
});
