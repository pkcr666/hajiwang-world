import type {
  ActMap, MapEdge, MapNode, MapNodeKind, Rng, RunActId, StageDef,
} from '../types';

// 地图生成按 dungeonId 分流
export const MAP_DUNGEON = 'starterVillage';
export const SUBLAYER_DEFAULT_NAME = '瑟银的菜鸟';

// 作战独立判定：rng.int(1,4)===1 升级紧急
const URGENT_ROLL = 4;

export interface StagePools {
  normal: StageDef[];
  urgent: StageDef[];
  boss: StageDef[];
}

const poolOf = (stages: StageDef[], floor: number, dungeon: string = MAP_DUNGEON): StagePools => {
  const onFloor = stages.filter(
    (s) => s.dungeon === dungeon && s.floor === floor && s.appear === 'regular',
  );
  return {
    normal: onFloor.filter((s) => s.difficulty === 'normal'),
    urgent: onFloor.filter((s) => s.difficulty === 'urgent'),
    boss: onFloor.filter((s) => s.difficulty === 'boss'),
  };
};

// 已配置齐全的子层名称：既有子层 BOSS 关，也有子层普通/紧急关（可从中抽首战）
export function configuredSublayers(stages: StageDef[]): string[] {
  const names = new Set(
    stages.filter((s) => s.appear === 'sublayer' && s.difficulty === 'boss' && s.sublayerName)
      .map((s) => s.sublayerName as string),
  );
  return [...names].filter((name) =>
    stages.some((s) => s.appear === 'sublayer' && s.sublayerName === name &&
      (s.difficulty === 'normal' || s.difficulty === 'urgent')));
}

/**
 * 开始冒险前的关卡校验，返回缺失项文案（为空才允许开图）：
 * - 1/2/3 层各至少 1 个常规普通关卡
 * - 2/3 层各至少 1 个常规 BOSS 关卡（BOSS 关由玩家亲自创建）
 * - 至少 1 个配置齐全的子层（子层名 + 子层BOSS关 + 子层普通/紧急关）
 */
export function runBlockers(stages: StageDef[]): string[] {
  const out: string[] = [];
  for (const f of [1, 2, 3]) {
    const pool = poolOf(stages, f);
    if (pool.normal.length === 0) out.push(`第${f}层常规普通关卡`);
    if (f >= 2 && pool.boss.length === 0) out.push(`第${f}层常规BOSS关卡`);
  }
  if (configuredSublayers(stages).length === 0) {
    out.push('子层（需创建含 BOSS 关与普通/紧急关的子层关卡）');
  }
  return out;
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sample = <T,>(arr: T[], rng: Rng): T => arr[rng.int(0, arr.length - 1)];

interface Cell { col: number; row: number }

class ActBuilder {
  readonly nodes: MapNode[] = [];
  readonly edges: MapEdge[] = [];
  private seq = 0;

  constructor(
    private readonly act: RunActId,
    private readonly rng: Rng,
    private readonly idTag?: string, // 子层用：区分不同子层，避免节点 id 跨子层冲突
  ) {}

  add(cell: Cell, kind: MapNodeKind, extra: Partial<MapNode> = {}): MapNode {
    const tag = this.idTag ?? this.act;
    const node: MapNode = {
      id: `n_${tag}_${cell.col}_${cell.row}_${this.seq++}`,
      act: this.act,
      col: cell.col,
      row: cell.row,
      kind,
      ...extra,
    };
    this.nodes.push(node);
    return node;
  }

  // 相邻两列连线：单节点列全连；否则保证每个下游有入边、每个上游有出边，再随机补边
  connect(prev: MapNode[], next: MapNode[]): void {
    const edgeSet = new Set<string>();
    const link = (a: MapNode, b: MapNode) => {
      const key = `${a.id}>${b.id}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        this.edges.push({ from: a.id, to: b.id });
      }
    };
    const nearest = (from: MapNode, candidates: MapNode[]): MapNode => {
      let best: MapNode[] = [];
      let d = Infinity;
      for (const c of candidates) {
        const dd = Math.abs(c.row - from.row);
        if (dd < d) { d = dd; best = [c]; }
        else if (dd === d) best.push(c);
      }
      return best.length === 1 ? best[0] : sample(best, this.rng);
    };

    if (prev.length === 1) {
      next.forEach((b) => link(prev[0], b));
      return;
    }
    if (next.length === 1) {
      prev.forEach((a) => link(a, next[0]));
      return;
    }
    // 1) 每个下游至少一个入边
    next.forEach((b) => link(nearest(b, prev), b));
    // 2) 每个上游至少一个出边
    prev.forEach((a) => {
      if (!this.edges.some((e) => e.from === a.id)) link(a, nearest(a, next));
    });
    // 3) 随机补边：上游最多 2 出边，优先行差 ≤2
    prev.forEach((a) => {
      const outCount = this.edges.filter((e) => e.from === a.id).length;
      if (outCount >= 2 || this.rng.int(0, 1) === 1) return;
      const linked = new Set(this.edges.filter((e) => e.from === a.id).map((e) => e.to));
      let open = next.filter((b) => !linked.has(b.id) && Math.abs(b.row - a.row) <= 2);
      if (open.length === 0) open = next.filter((b) => !linked.has(b.id));
      if (open.length) link(a, nearest(a, open));
    });
  }

  build(cols: number, rows: number): ActMap {
    const byCol = (col: number) =>
      this.nodes.filter((n) => n.col === col).sort((a, b) => a.row - b.row);
    for (let c = 0; c < cols - 1; c++) {
      this.connect(byCol(c), byCol(c + 1));
    }
    return { act: this.act, cols, rows, nodes: this.nodes, edges: this.edges };
  }
}

// ===== 火把线（上下联通） =====
// 各层火把线数量：一层 1~2、二层 3~4、三层 4~6
export function torchLinkCount(act: 1 | 2 | 3 | 4 | 5 | 6 | 7, rng: Rng): number {
  if (act === 1) return rng.int(1, 2);
  if (act === 2) return rng.int(3, 4);
  return rng.int(4, 6); // act 3/4/5/6/7 复用
}

// 在同一列内挑选「行差为1」的相邻节点对作为火把线；候选不足则按实际数量生成
export function addTorchLinks(map: ActMap, target: number, rng: Rng): void {
  const cands: { a: MapNode; b: MapNode }[] = [];
  for (let c = 0; c < map.cols; c++) {
    const inCol = map.nodes.filter((n) => n.col === c).sort((x, y) => x.row - y.row);
    for (let i = 0; i + 1 < inCol.length; i++) {
      if (inCol[i + 1]!.row - inCol[i]!.row === 1) cands.push({ a: inCol[i]!, b: inCol[i + 1]! });
    }
  }
  shuffle(cands, rng)
    .slice(0, target)
    .forEach((p) => map.edges.push({ from: p.a.id, to: p.b.id, torch: true }));
}

// 瘟疫之源：在允许列（排除前两列与最后一列）中随机选 N 个非BOSS节点转为瘟疫之源
export function addPlagueNodes(map: ActMap, count: number, rng: Rng): void {
  const eligible = map.nodes.filter(
    (n) => n.kind !== 'boss' && n.col >= 2 && n.col < map.cols - 1,
  );
  shuffle(eligible, rng)
    .slice(0, count)
    .forEach((n) => { n.kind = 'plague'; n.stageId = undefined; n.urgent = undefined; });
}

// 作战落位：25% 升级紧急（紧急池为空则保持普通），随机抽一个关卡
function combatNode(
  b: ActBuilder, cell: Cell, pools: StagePools, rng: Rng,
  forceNormal = false, forceUrgent = false,
): void {
  let urgent = forceUrgent;
  if (!forceNormal && !forceUrgent) urgent = rng.int(1, URGENT_ROLL) === 1;
  if (urgent && pools.urgent.length === 0) urgent = false;
  const pool = urgent ? pools.urgent : pools.normal;
  const stage = pool.length > 0 ? sample(pool, rng) : undefined;
  b.add(cell, 'combat', { urgent, stageId: stage?.id });
}

// BOSS 落位：从该层常规 BOSS 池随机抽一个（BOSS 关由玩家创建，缺池则不设 stageId）
function bossNode(b: ActBuilder, cell: Cell, pools: StagePools, rng: Rng): void {
  const stage = pools.boss.length > 0 ? sample(pools.boss, rng) : undefined;
  b.add(cell, 'boss', { stageId: stage?.id });
}

// ===== 一层：4 列 =====
// C1 单普通作战；C2/C3 一列2个一列3个（3作战+2不期而遇）；C4 诡异行商
function buildAct1(stages: StageDef[], rng: Rng): ActMap {
  const pools = poolOf(stages, 1);
  const b = new ActBuilder(1, rng);
  combatNode(b, { col: 0, row: 1 }, pools, rng, true);

  const counts = shuffle([2, 3], rng); // counts[0]=C2 节点数
  const kinds = shuffle<MapNodeKind>(
    ['combat', 'combat', 'combat', 'encounter', 'encounter'], rng,
  );
  const cells: Cell[] = [];
  counts.forEach((n, idx) => {
    const col = idx + 1;
    const rowSlots = n === 3 ? [0, 1, 2] : shuffle([0, 1, 2], rng).slice(0, 2).sort();
    rowSlots.forEach((row) => cells.push({ col, row }));
  });
  cells.sort((a, c) => a.col - c.col || a.row - c.row);
  cells.forEach((cell, i) => {
    if (kinds[i] === 'combat') combatNode(b, cell, pools, rng);
    else b.add(cell, 'encounter');
  });

  b.add({ col: 3, row: 1 }, 'merchant');
  return b.build(4, 3);
}

interface MatrixQuota {
  combat: number; encounter: number; rest: number;
  merchant: number; trade: number; visitor: number;
}

// 行列矩阵分配：先每排注入作战（硬约束），再补作战，再放限额特殊节点，其余为不期而遇
function fillMatrix(
  b: ActBuilder,
  rng: Rng,
  spec: {
    act: 2 | 3;
    firstCol: number;
    rows: number;
    cols: number;
    pools: StagePools;
    quota: MatrixQuota;
    rowKindLimit?: Partial<Record<MapNodeKind, number>>; // 每种节点每横排至多 N 个
    visitorNote?: string; // 异界来客节点标注的子层名
  },
): void {
  const { rows, cols, quota, pools } = spec;
  const grid: (MapNodeKind | null)[][] =
    Array.from({ length: rows }, () => Array<MapNodeKind | null>(cols).fill(null));
  const rowCountOf = (row: number, kind: MapNodeKind) =>
    grid[row].filter((k) => k === kind).length;
  const emptyCells = (): Cell[] => {
    const out: Cell[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) if (!grid[r][c]) out.push({ row: r, col: c });
    }
    return out;
  };

  // 1) 每排至少 1 个作战
  for (let r = 0; r < rows; r++) {
    grid[r][rng.int(0, cols - 1)] = 'combat';
  }
  // 2) 剩余作战随机补
  for (let i = 0; i < quota.combat - rows; i++) {
    const cell = sample(emptyCells(), rng);
    grid[cell.row][cell.col] = 'combat';
  }
  // 3) 特殊节点：受每排上限约束的（安全角落/行商）先放，其余后放
  const limited: MapNodeKind[] = [
    ...Array(quota.rest).fill('rest' as MapNodeKind),
    ...Array(quota.merchant).fill('merchant' as MapNodeKind),
  ];
  const free: MapNodeKind[] = [
    ...Array(quota.trade).fill('trade' as const),
    ...Array(quota.visitor).fill('visitor' as const),
  ];

  const place = (kind: MapNodeKind, enforceRowLimit: boolean) => {
    const open = shuffle(emptyCells(), rng);
    const limit = spec.rowKindLimit?.[kind] ?? Infinity;
    const pick = enforceRowLimit
      ? open.find((cell) => rowCountOf(cell.row, kind) < limit)
      : open[0];
    if (pick) grid[pick.row][pick.col] = kind;
  };
  limited.forEach((k) => place(k, true));
  free.forEach((k) => place(k, false));
  // 4) 剩余空格全部不期而遇
  emptyCells().forEach((cell) => { grid[cell.row][cell.col] = 'encounter'; });

  // 5) 落节点
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const kind = grid[r][c]!;
      const cell = { col: spec.firstCol + c, row: r };
      if (kind === 'combat') combatNode(b, cell, pools, rng);
      else if (kind === 'visitor') b.add(cell, kind, { note: spec.visitorNote });
      else b.add(cell, kind);
    }
  }
}

// ===== 二层：5 列 =====
// C1 两个普通作战；C2-C4 各3个（4作战/1安全角落/3不期而遇/1失与得）；C5 BOSS（玩家创建的2层常规BOSS关）
function buildAct2(stages: StageDef[], rng: Rng): ActMap {
  const pools = poolOf(stages, 2);
  const b = new ActBuilder(2, rng);
  combatNode(b, { col: 0, row: 0 }, pools, rng, true);
  combatNode(b, { col: 0, row: 2 }, pools, rng, true);

  fillMatrix(b, rng, {
    act: 2, firstCol: 1, rows: 3, cols: 3, pools,
    quota: { combat: 4, encounter: 3, rest: 1, merchant: 0, trade: 1, visitor: 0 },
  });

  bossNode(b, { col: 4, row: 1 }, pools, rng);
  return b.build(5, 3);
}

// ===== 三层：6 列 =====
// C1 三个普通作战；C2-C5 各4个（6作战/4不期而遇/2安全角落/2行商/1失与得/1异界来客）
// 每排至少1作战；安全角落、行商每排至多1个；C6 BOSS（玩家创建的3层常规BOSS关）
function buildAct3(stages: StageDef[], rng: Rng): ActMap {
  const pools = poolOf(stages, 3);
  const subName = configuredSublayers(stages)[0] ?? SUBLAYER_DEFAULT_NAME;
  const b = new ActBuilder(3, rng);
  [0, 1, 2].forEach((row) => combatNode(b, { col: 0, row }, pools, rng, true));

  fillMatrix(b, rng, {
    act: 3, firstCol: 1, rows: 4, cols: 4, pools,
    quota: { combat: 6, encounter: 4, rest: 2, merchant: 2, trade: 1, visitor: 1 },
    rowKindLimit: { rest: 1, merchant: 1 },
    visitorNote: subName,
  });

  bossNode(b, { col: 5, row: 1 }, pools, rng);
  return b.build(6, 4);
}

// ===== 子层：单线 5 连（横向一排）=====
// 随机子层紧急作战（缺紧急/普通则回落本层或三层常规池）→ 失与得 → 诡异行商 → BOSS → 安全的角落
// 子层固定布局：按子层名称生成指定节点链；未匹配名称时回退到通用生成逻辑
export function buildSublayer(stages: StageDef[], sublayerName: string, rng: Rng, skipRest?: boolean): ActMap {
  const sub = stages.filter(
    (s) => s.appear === 'sublayer' && s.sublayerName === sublayerName,
  );
  const byName = (name: string): StageDef | undefined => sub.find((s) => s.name === name);

  // 蜂巢：安全角落 → 作战·蜜蜂大军 → 失与得 → 诡异行商 → BOSS·蜂巢之主
  if (sublayerName === '蜂巢') {
    const b = new ActBuilder('sub', rng, `sub_${sublayerName}`);
    b.add({ col: 0, row: 0 }, 'rest');
    b.add({ col: 1, row: 0 }, 'combat', { stageId: byName('蜜蜂大军')?.id });
    b.add({ col: 2, row: 0 }, 'trade');
    b.add({ col: 3, row: 0 }, 'merchant');
    b.add({ col: 4, row: 0 }, 'boss', { stageId: byName('蜂巢之主')?.id });
    const chain = [...b.nodes].sort((a, c) => a.col - c.col);
    for (let i = 0; i < chain.length - 1; i++) b.edges.push({ from: chain[i]!.id, to: chain[i + 1]!.id });
    return { act: 'sub', cols: 5, rows: 1, nodes: b.nodes, edges: b.edges };
  }

  // 沉沦之海：作战·沉沦未成 → 狭路相逢 → 诡异行商 → BOSS·回荡
  if (sublayerName === '沉沦之海') {
    const b = new ActBuilder('sub', rng, `sub_${sublayerName}`);
    b.add({ col: 0, row: 0 }, 'combat', { stageId: byName('沉沦未成')?.id, urgent: true });
    b.add({ col: 1, row: 0 }, 'skirmish');
    b.add({ col: 2, row: 0 }, 'merchant');
    b.add({ col: 3, row: 0 }, 'boss', { stageId: byName('回荡')?.id });
    const chain = [...b.nodes].sort((a, c) => a.col - c.col);
    for (let i = 0; i < chain.length - 1; i++) b.edges.push({ from: chain[i]!.id, to: chain[i + 1]!.id });
    return { act: 'sub', cols: 4, rows: 1, nodes: b.nodes, edges: b.edges };
  }

  // 墓园：作战·食尸鬼入侵 → 失与得 → 王牌招募 → 安全的角落 → 诡异行商 → BOSS·鬼族之王
  if (sublayerName === '墓园') {
    const b = new ActBuilder('sub', rng, `sub_${sublayerName}`);
    b.add({ col: 0, row: 0 }, 'combat', { stageId: byName('食尸鬼入侵')?.id });
    b.add({ col: 1, row: 0 }, 'trade');
    b.add({ col: 2, row: 0 }, 'recruit');
    b.add({ col: 3, row: 0 }, 'rest');
    b.add({ col: 4, row: 0 }, 'merchant');
    b.add({ col: 5, row: 0 }, 'boss', { stageId: byName('鬼族之王')?.id });
    const chain = [...b.nodes].sort((a, c) => a.col - c.col);
    for (let i = 0; i < chain.length - 1; i++) b.edges.push({ from: chain[i]!.id, to: chain[i + 1]!.id });
    return { act: 'sub', cols: 6, rows: 1, nodes: b.nodes, edges: b.edges };
  }

  // 回退：通用子层生成（首战紧急→普通→三层兜底）
  const fallback = poolOf(stages, 3);
  const pools: StagePools = {
    normal: sub.filter((s) => s.difficulty === 'normal'),
    urgent: sub.filter((s) => s.difficulty === 'urgent'),
    boss: sub.filter((s) => s.difficulty === 'boss'),
  };
  const b = new ActBuilder('sub', rng, `sub_${sublayerName}`);
  const firstPool = pools.urgent.length > 0 ? pools.urgent
    : pools.normal.length > 0 ? pools.normal
      : fallback.urgent.length > 0 ? fallback.urgent : fallback.normal;
  const firstStage = firstPool.length > 0 ? sample(firstPool, rng) : undefined;
  b.add({ col: 0, row: 0 }, 'combat', { urgent: firstPool === pools.urgent, stageId: firstStage?.id });
  b.add({ col: 1, row: 0 }, 'trade');
  b.add({ col: 2, row: 0 }, 'merchant');
  const bossPool = pools.boss.length > 0 ? pools.boss : fallback.boss;
  const bossStage = bossPool.length > 0 ? sample(bossPool, rng) : undefined;
  b.add({ col: 3, row: 0 }, 'boss', { stageId: bossStage?.id });
  if (!skipRest) b.add({ col: 4, row: 0 }, 'rest');
  const chain = [...b.nodes].sort((a, c) => a.col - c.col);
  for (let i = 0; i < chain.length - 1; i++) b.edges.push({ from: chain[i]!.id, to: chain[i + 1]!.id });
  return { act: 'sub', cols: skipRest ? 4 : 5, rows: 1, nodes: b.nodes, edges: b.edges };
}

export function generateAct(act: 1 | 2 | 3 | 4, stages: StageDef[], rng: Rng): ActMap {
  const map = act === 1
    ? buildAct1(stages, rng)
    : act === 2
      ? buildAct2(stages, rng)
      : act === 3
        ? buildAct3(stages, rng)
        : buildAct4(stages, rng);
  addTorchLinks(map, torchLinkCount(act, rng), rng);
  return map;
}

// ===== 第四层「夺金狂潮」：单线 6 连（终局联系解锁）=====
// 诡异行商 → 命运所指 → 作战 → 作战 → 安全的角落 → BOSS：马神残躯
function buildAct4(stages: StageDef[], rng: Rng): ActMap {
  const pools = poolOf(stages, 4);
  const b = new ActBuilder(4, rng);
  b.add({ col: 0, row: 0 }, 'merchant');
  b.add({ col: 1, row: 0 }, 'fate');
  combatNode(b, { col: 2, row: 0 }, pools, rng, true);
  combatNode(b, { col: 3, row: 0 }, pools, rng, true);
  b.add({ col: 4, row: 0 }, 'rest');
  bossNode(b, { col: 5, row: 0 }, pools, rng);
  const chain = [...b.nodes].sort((a, c) => a.col - c.col);
  for (let i = 0; i < chain.length - 1; i++) {
    b.edges.push({ from: chain[i].id, to: chain[i + 1].id });
  }
  return { act: 4, cols: 6, rows: 1, nodes: b.nodes, edges: b.edges };
}

// ===== 灾厄泰拉地图生成 =====
const CALAMITY_DUNGEON = 'preWallCalamity';

// 通用矩阵填充：支持任意节点种类配额，带每横排上限约束
function fillCalamityMatrix(
  b: ActBuilder,
  rng: Rng,
  spec: {
    act: RunActId;
    firstCol: number;
    rows: number;
    cols: number;
    pools: StagePools;
    quota: Partial<Record<MapNodeKind, number>>;
    rowKindLimit?: Partial<Record<MapNodeKind, number>>;
    visitorNote?: string;
    urgentChance?: number; // 作战升级紧急概率（1/N），缺省4
  },
): void {
  const { rows, cols, quota, pools } = spec;
  const grid: (MapNodeKind | null)[][] =
    Array.from({ length: rows }, () => Array<MapNodeKind | null>(cols).fill(null));
  const rowCountOf = (row: number, kind: MapNodeKind) =>
    grid[row].filter((k) => k === kind).length;
  const emptyCells = (): Cell[] => {
    const out: Cell[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if (!grid[r][c]) out.push({ row: r, col: c });
    return out;
  };

  // 1) 每排至少 1 个作战（如果配额允许）
  const combatQuota = quota.combat ?? 0;
  for (let r = 0; r < rows && r < combatQuota; r++) {
    grid[r][rng.int(0, cols - 1)] = 'combat';
  }
  // 2) 剩余作战随机补
  const placedCombat = Math.min(rows, combatQuota);
  for (let i = 0; i < combatQuota - placedCombat; i++) {
    const cell = sample(emptyCells(), rng);
    grid[cell.row][cell.col] = 'combat';
  }
  // 3) 受限节点（安全角落/行商：每排≤1）先放
  const limited: MapNodeKind[] = [];
  (['rest', 'merchant'] as MapNodeKind[]).forEach((k) => {
    for (let i = 0; i < (quota[k] ?? 0); i++) limited.push(k);
  });
  // 4) 自由节点（招募/异界/失与得/狭路）
  const free: MapNodeKind[] = [];
  (['recruit', 'visitor', 'trade', 'skirmish'] as MapNodeKind[]).forEach((k) => {
    for (let i = 0; i < (quota[k] ?? 0); i++) free.push(k);
  });

  const place = (kind: MapNodeKind, enforceRowLimit: boolean) => {
    const open = shuffle(emptyCells(), rng);
    const limit = spec.rowKindLimit?.[kind] ?? Infinity;
    const pick = enforceRowLimit
      ? open.find((cell) => rowCountOf(cell.row, kind) < limit)
      : open[0];
    if (pick) grid[pick.row][pick.col] = kind;
  };
  limited.forEach((k) => place(k, true));
  free.forEach((k) => place(k, false));
  // 5) 剩余空格全部不期而遇
  emptyCells().forEach((cell) => { grid[cell.row][cell.col] = 'encounter'; });

  // 6) 落节点
  const urgentRoll = spec.urgentChance ?? 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const kind = grid[r][c]!;
      const cell = { col: spec.firstCol + c, row: r };
      if (kind === 'combat') {
        const urgent = pools.urgent.length > 0 && rng.int(1, urgentRoll) === 1;
        const pool = urgent ? pools.urgent : pools.normal;
        const stage = pool.length > 0 ? sample(pool, rng) : undefined;
        b.add(cell, 'combat', { urgent, stageId: stage?.id });
      } else if (kind === 'visitor') b.add(cell, kind, { note: spec.visitorNote });
      else b.add(cell, kind);
    }
  }
}

// ===== 灾厄一层（5 列）=====
// C1 单普通作战；C2/C3 一列2个一列3个（3作战+2不期而遇，作战25%紧急）；C4 王牌招募；C5 诡异行商
function buildCalamityAct1(stages: StageDef[], rng: Rng): ActMap {
  const pools = poolOf(stages, 1, CALAMITY_DUNGEON);
  const b = new ActBuilder(1, rng);
  combatNode(b, { col: 0, row: 1 }, pools, rng, true);

  const counts = shuffle([2, 3], rng);
  const cells: Cell[] = [];
  counts.forEach((n, idx) => {
    const col = idx + 1;
    const rowSlots = n === 3 ? [0, 1, 2] : shuffle([0, 1, 2], rng).slice(0, 2).sort();
    rowSlots.forEach((row) => cells.push({ col, row }));
  });
  cells.sort((a, c) => a.col - c.col || a.row - c.row);
  const kinds = shuffle<MapNodeKind>(['combat', 'combat', 'combat', 'encounter', 'encounter'], rng);
  cells.forEach((cell, i) => {
    if (kinds[i] === 'combat') combatNode(b, cell, pools, rng);
    else b.add(cell, 'encounter');
  });

  b.add({ col: 3, row: 1 }, 'recruit');
  b.add({ col: 4, row: 1 }, 'merchant');
  return b.build(5, 3);
}

// ===== 灾厄二层（6 列）=====
// C1 祭坛；C2 两普通作战；C3-C5 各3个（4作战+1安全+3不期而遇+1招募，每排≥1作战）；C6 BOSS
function buildCalamityAct2(stages: StageDef[], rng: Rng): ActMap {
  const pools = poolOf(stages, 2, CALAMITY_DUNGEON);
  const b = new ActBuilder(2, rng);
  b.add({ col: 0, row: 1 }, 'altar');
  combatNode(b, { col: 1, row: 0 }, pools, rng, true);
  combatNode(b, { col: 1, row: 2 }, pools, rng, true);

  fillCalamityMatrix(b, rng, {
    act: 2, firstCol: 2, rows: 3, cols: 3, pools,
    quota: { combat: 4, rest: 1, encounter: 3, recruit: 1 },
    rowKindLimit: { rest: 1, merchant: 1 },
  });

  bossNode(b, { col: 5, row: 1 }, pools, rng);
  return b.build(6, 3);
}

// ===== 灾厄三/四层（7 列）=====
// C1 三个（作战或不期而遇）；C2-C5 各4个共16个（6作战+3不期而遇+2安全+1行商+1招募+1异界+1失与得+1狭路，每排≥1作战，安全/行商每排≤1）；C6 BOSS
function buildCalamityAct34(stages: StageDef[], rng: Rng, act: 3 | 4): ActMap {
  const pools = poolOf(stages, act, CALAMITY_DUNGEON);
  const subName = act === 3 ? '蜂巢' : '沉沦之海';
  const b = new ActBuilder(act, rng);
  // C1: 3 个，作战或不期而遇（第一列不刷紧急作战）
  for (let r = 0; r < 3; r++) {
    if (rng.int(0, 1) === 0) combatNode(b, { col: 0, row: r }, pools, rng, true);
    else b.add({ col: 0, row: r }, 'encounter');
  }

  fillCalamityMatrix(b, rng, {
    act, firstCol: 1, rows: 4, cols: 4, pools,
    quota: { combat: 6, encounter: 3, rest: 2, merchant: 1, recruit: 1, visitor: 1, trade: 1, skirmish: 1 },
    rowKindLimit: { rest: 1, merchant: 1 },
    visitorNote: subName,
  });

  bossNode(b, { col: 5, row: 1 }, pools, rng);
  return b.build(6, 4);
}

// ===== 灾厄四层 =====
// 与三层同构（6 列 4 行网格，异界来客子层为「沉沦之海」），由 buildCalamityAct34(act: 4) 生成

// ===== 灾厄五层（8 列）=====
// C1 四个（2作战+2不期而遇）；C2-C6 各4个共20个（7作战+4不期而遇+2安全+2行商+1招募+2异界+1失与得+1狭路，约束同上）；C7 BOSS
function buildCalamityAct5(stages: StageDef[], rng: Rng): ActMap {
  const pools = poolOf(stages, 5, CALAMITY_DUNGEON);
  const b = new ActBuilder(5, rng);
  // C1: 2 作战 + 2 不期而遇，随机排布（第一列不刷紧急作战）
  const c1Kinds = shuffle<MapNodeKind>(['combat', 'combat', 'encounter', 'encounter'], rng);
  c1Kinds.forEach((kind, r) => {
    if (kind === 'combat') combatNode(b, { col: 0, row: r }, pools, rng, true);
    else b.add({ col: 0, row: r }, 'encounter');
  });

  fillCalamityMatrix(b, rng, {
    act: 5, firstCol: 1, rows: 4, cols: 5, pools,
    quota: { combat: 7, encounter: 4, rest: 2, merchant: 2, recruit: 1, visitor: 2, trade: 1, skirmish: 1 },
    rowKindLimit: { rest: 1, merchant: 1 },
    visitorNote: '墓园',
  });

  bossNode(b, { col: 6, row: 1 }, pools, rng);
  return b.build(7, 4);
}

// 第六层「痛苦之村」（求救信解锁）：单线 5 连
// 诡异行商 → 随机第五层紧急作战 → 安全的角落 → BOSS·狄瑞吉 → 异次元裂缝（开发中）
function buildCalamityAct6(stages: StageDef[], rng: Rng): ActMap {
  const floor5Urgent = stages.filter(
    (s) => s.dungeon === CALAMITY_DUNGEON && s.floor === 5 && s.difficulty === 'urgent' && s.appear === 'regular',
  );
  const bossStage = stages.find(
    (s) => s.dungeon === CALAMITY_DUNGEON && s.floor === 6 && s.difficulty === 'boss',
  );
  const urgentStage = floor5Urgent.length > 0 ? sample(floor5Urgent, rng) : undefined;
  const b = new ActBuilder(6, rng);
  b.add({ col: 0, row: 0 }, 'merchant');
  b.add({ col: 1, row: 0 }, 'combat', { stageId: urgentStage?.id, urgent: true });
  b.add({ col: 2, row: 0 }, 'rest');
  b.add({ col: 3, row: 0 }, 'boss', { stageId: bossStage?.id });
  b.add({ col: 4, row: 0 }, 'placeholder', { note: '异次元裂缝（开发中）' });
  const chain = [...b.nodes].sort((a, c) => a.col - c.col);
  for (let i = 0; i < chain.length - 1; i++) b.edges.push({ from: chain[i]!.id, to: chain[i + 1]!.id });
  return { act: 6, cols: 5, rows: 1, nodes: b.nodes, edges: b.edges };
}

// 第七层「深渊」（邀请函解锁）：单线作战链 + BOSS
// 作战节点复用五层常规池；BOSS 取第六层专属池
function buildCalamityAct7(stages: StageDef[], rng: Rng): ActMap {
  const pools = poolOf(stages, 5, CALAMITY_DUNGEON);
  const bossPools = poolOf(stages, 6, CALAMITY_DUNGEON);
  const b = new ActBuilder(7, rng);
  combatNode(b, { col: 0, row: 0 }, pools, rng, true);
  combatNode(b, { col: 1, row: 0 }, pools, rng, true);
  combatNode(b, { col: 2, row: 0 }, pools, rng, true);
  bossNode(b, { col: 3, row: 0 }, bossPools, rng);
  const chain = [...b.nodes].sort((a, c) => a.col - c.col);
  for (let i = 0; i < chain.length - 1; i++) b.edges.push({ from: chain[i]!.id, to: chain[i + 1]!.id });
  return { act: 7, cols: 4, rows: 1, nodes: b.nodes, edges: b.edges };
}

export function generateCalamityAct(act: 1 | 2 | 3 | 4 | 5 | 6 | 7, stages: StageDef[], rng: Rng): ActMap {
  const map = act === 1
    ? buildCalamityAct1(stages, rng)
    : act === 2
      ? buildCalamityAct2(stages, rng)
      : act === 3
        ? buildCalamityAct34(stages, rng, 3)
        : act === 4
          ? buildCalamityAct34(stages, rng, 4)
          : act === 5
            ? buildCalamityAct5(stages, rng)
            : act === 6
              ? buildCalamityAct6(stages, rng)
              : buildCalamityAct7(stages, rng);
  addTorchLinks(map, torchLinkCount(act, rng), rng);
  // 瘟疫之源：2~3层各1处，5层2处（四层为常规网格，不刷瘟疫节点）
  const plagueCount = act === 2 || act === 3 ? 1 : act === 5 ? 2 : 0;
  if (plagueCount > 0) addPlagueNodes(map, plagueCount, rng);
  return map;
}

