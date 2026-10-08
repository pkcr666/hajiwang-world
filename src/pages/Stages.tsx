import { useMemo, useState } from 'react';
import type {
  DropEntry, DropKind, FixedDrop, FixedDropCandidate, Item, LuckyDrop, MonsterUnit, Rarity, RarityWeights, Relic,
  SaveData, StageAppear, StageDef, StageDifficulty, StageMechanic,
} from '../types';
import { DROP_POOL_RARITIES } from '../types';
import { DUNGEONS } from '../data/dungeons';
import { allItems } from '../data/content';
import { RELICS } from '../data/relics';
import {
  addCustomStage, removeCustomStage, updateCustomStage,
} from '../save/storage';
import { describeDrop, describeFixedDrop } from '../engine/drops';
import { Modal } from '../components/Modal';
import { RARITY_LABELS } from '../ui/labels';

const DIFF_LABEL: Record<StageDifficulty, string> = { normal: '普通', urgent: '紧急', boss: 'BOSS' };
const APPEAR_LABEL: Record<StageAppear, string> = { regular: '常规', event: '事件', sublayer: '子层', skirmish: '狭路相逢' };
const MAX_MONSTERS = 5;

let uidSeq = 0;
const tmpId = () => `tmp_${Date.now().toString(36)}_${uidSeq++}`;

const dungeonName = (id: string) => DUNGEONS.find((d) => d.id === id)?.name ?? id;

// 保存前清洗：指定了具体稀有度就不保留概率分布；分布中 0 概率的项不落盘
function cleanDropCommon<T extends { rarity?: Rarity; rarityWeights?: RarityWeights }>(d: T): T {
  if (d.rarity !== undefined) return { ...d, rarityWeights: undefined };
  if (!d.rarityWeights) return d;
  const w: RarityWeights = {};
  for (const r of DROP_POOL_RARITIES) {
    const v = d.rarityWeights[r] ?? 0;
    if (v > 0) w[r] = v;
  }
  return { ...d, rarityWeights: w };
}

export function Stages({ save, onChange }: {
  save: SaveData;
  onChange: (s: SaveData) => void;
}) {
  const stages = save.customStages;
  const monsters = save.customMonsters;
  const [dungeonFilter, setDungeonFilter] = useState<string>('all');
  const [editing, setEditing] = useState<StageDef | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StageDef | null>(null);

  const items = useMemo(() => allItems(save), [save]);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const relicMap = useMemo(() => new Map(RELICS.map((r) => [r.id, r])), []);
  const monsterMap = useMemo(() => new Map(monsters.map((m) => [m.id, m])), [monsters]);

  const visible = dungeonFilter === 'all'
    ? stages
    : stages.filter((s) => s.dungeon === dungeonFilter);
  // 列表排序：副本 → 层 → 难度
  const sorted = [...visible].sort((a, b) =>
    a.dungeon.localeCompare(b.dungeon) || a.floor - b.floor ||
    a.difficulty.localeCompare(b.difficulty));

  return (
    <div className="page">
      <div className="page-head">
        <h2>关卡库（{stages.length}）</h2>
        <button className="btn primary" onClick={() => setCreating(true)}>+ 新增关卡</button>
      </div>

      <div className="tabs">
        <button className={`chip ${dungeonFilter === 'all' ? 'chip-on' : ''}`}
          onClick={() => setDungeonFilter('all')}>全部</button>
        {DUNGEONS.map((d) => (
          <button key={d.id} className={`chip ${dungeonFilter === d.id ? 'chip-on' : ''}`}
            onClick={() => setDungeonFilter(d.id)}>{d.name}</button>
        ))}
      </div>

      {stages.length === 0 && (
        <div className="card bag-empty">
          还没有关卡。点右上角「新增关卡」创建：设置出现副本/层数/难度、最多5只怪物、额外属性和掉落表。
          BOSS 关（2/3/4层常规 BOSS、子层 BOSS）必须亲自创建，未创建前无法开始冒险。
        </div>
      )}

      <div className="stage-grid">
        {sorted.map((st) => (
          <StageCard
            key={st.id}
            stage={st}
            monsterMap={monsterMap}
            itemMap={itemMap}
            relicMap={relicMap}
            pairName={st.pairStageId
              ? stages.find((x) => x.id === st.pairStageId)?.name
              : undefined}
            onEdit={() => setEditing(st)}
            onDelete={() => setDeleting(st)}
          />
        ))}
      </div>

      {(creating || editing) && (
        <StageEditor
          save={save}
          items={items}
          relics={RELICS}
          monsters={monsters}
          initial={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={(data) => {
            if (editing) onChange(updateCustomStage(save, editing.id, data));
            else onChange(addCustomStage(save, data));
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <Modal title="删除关卡" onClose={() => setDeleting(null)}>
          <p>删除关卡「{deleting.name}」？</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleting(null)}>取消</button>
            <button className="btn-danger"
              onClick={() => { onChange(removeCustomStage(save, deleting.id)); setDeleting(null); }}>
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StageCard({ stage, monsterMap, itemMap, relicMap, pairName, onEdit, onDelete }: {
  stage: StageDef;
  monsterMap: Map<string, MonsterUnit>;
  itemMap: Map<string, Item>;
  relicMap: Map<string, Relic>;
  pairName?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const diffClass = stage.difficulty === 'boss'
    ? 'tag-boss'
    : stage.difficulty === 'urgent' ? 'tag-urgent' : 'tag-normal';
  const monText = stage.monsters
    .map((m) => `${monsterMap.get(m.monsterId)?.name ?? '（已删除怪物）'}${m.count > 1 ? `×${m.count}` : ''}`)
    .join('、');
  const dropText = stage.drops.map((d) => describeDrop(d, itemMap, relicMap)).join('；');
  const luckyText = stage.luckyDrops
    .map((d) => `${describeDrop({ ...d }, itemMap, relicMap)}（需${d.threshold}）`)
    .join('；');
  const fixedText = (stage.fixedDrops ?? [])
    .map((d) => describeFixedDrop(d, itemMap, relicMap)).join('、');
  return (
    <div className="card stage-card">
      <div className="card-actions">
        <button className="btn-mini" onClick={onEdit}>改</button>
        <button className="btn-danger btn-mini" onClick={onDelete}>删</button>
      </div>
      <div className="stage-name">{stage.name}</div>
      <div className="stage-tags">
        <span className={`stage-tag ${diffClass}`}>{DIFF_LABEL[stage.difficulty]}</span>
        <span className="stage-tag">{dungeonName(stage.dungeon)}·{stage.floor}层</span>
        <span className="stage-tag">{APPEAR_LABEL[stage.appear]}</span>
        <span className="stage-tag">Lv.{stage.level}</span>
      </div>
      {stage.appear === 'sublayer' && stage.sublayerName && (
        <div className="stage-line">子层：{stage.sublayerName}</div>
      )}
      {stage.appear === 'skirmish' && stage.skirmishTier && (
        <div className="stage-line">狭路相逢：第 {stage.skirmishTier} 档</div>
      )}
      {pairName && <div className="stage-line muted">紧急对应：{pairName}</div>}
      <div className="stage-line"><b>怪物：</b>{monText}</div>
      {stage.mechanics.length > 0 && (
        <div className="stage-line"><b>额外属性：</b>{stage.mechanics.map((m) => m.desc).join('；')}</div>
      )}
      <div className="stage-line"><b>掉落：</b>{dropText || '无'}</div>
      {fixedText && <div className="stage-line"><b>固定掉落：</b>{fixedText}</div>}
      {luckyText && <div className="stage-line"><b>幸运：</b>{luckyText}</div>}
      {stage.desc && <div className="stage-line muted">{stage.desc}</div>}
    </div>
  );
}

// ================= 编辑器 =================

interface FormState {
  name: string;
  desc: string;
  dungeon: string;
  floor: number;
  level: number;
  difficulty: StageDifficulty;
  appear: StageAppear;
  sublayerName: string;
  skirmishTier: 1 | 2 | 3;
  pairStageId: string;
  monsterSlots: { monsterId: string; count: number }[];
  mechanics: StageMechanic[];
  drops: DropEntry[];
  luckyDrops: LuckyDrop[];
  fixedDrops: FixedDrop[];
}

function emptyForm(): FormState {
  return {
    name: '', desc: '',
    dungeon: DUNGEONS[0].id, floor: 1, level: DUNGEONS[0].level,
    difficulty: 'normal', appear: 'regular', sublayerName: '', skirmishTier: 1, pairStageId: '',
    monsterSlots: [{ monsterId: '', count: 1 }],
    mechanics: [], drops: [], luckyDrops: [], fixedDrops: [],
  };
}

function stageToForm(st: StageDef): FormState {
  // 旧档/种子关卡的「随机池藏品」掉落可能缺 level（随机分布形态），补默认 10，否则校验拦截导致无法保存
  const normDrop = (d: DropEntry): DropEntry =>
    d.kind === 'item' && d.level === undefined ? { ...d, level: 10 } : d;
  return {
    name: st.name, desc: st.desc, dungeon: st.dungeon, floor: st.floor, level: st.level,
    difficulty: st.difficulty, appear: st.appear, sublayerName: st.sublayerName ?? '',
    skirmishTier: st.skirmishTier ?? 1,
    pairStageId: st.pairStageId ?? '',
    monsterSlots: st.monsters.length > 0
      ? st.monsters.map((m) => ({ ...m }))
      : [{ monsterId: '', count: 1 }],
    mechanics: structuredClone(st.mechanics),
    drops: structuredClone(st.drops).map(normDrop),
    luckyDrops: structuredClone(st.luckyDrops),
    fixedDrops: structuredClone(st.fixedDrops ?? []),
  };
}

function StageEditor({ save, items, relics, monsters, initial, onClose, onSave }: {
  save: SaveData;
  items: Item[];
  relics: Relic[];
  monsters: MonsterUnit[];
  initial?: StageDef;
  onClose: () => void;
  onSave: (s: Omit<StageDef, 'id' | 'custom'>) => void;
}) {
  const [f, setF] = useState<FormState>(() => initial ? stageToForm(initial) : emptyForm());
  const upd = (patch: Partial<FormState>) => setF((old) => ({ ...old, ...patch }));

  const normals = save.customStages.filter((s) => s.difficulty === 'normal');
  const monsterTotal = f.monsterSlots.reduce((n, s) => n + (s.monsterId ? s.count : 0), 0);
  const dropTotal = f.drops.reduce((n, d) => n + Math.max(0, d.weight), 0);

  // 目标有效性：coin 只要数量；材料/消耗品 specific 需 targetId、pool 直接有效；藏品/遗物按原规则
  // （随机池稀有度选「随机」=不筛稀有度，需填写各稀有度概率合计100%；藏品还需填等级）
  const rarityDistOk = (d: DropEntry | LuckyDrop): boolean => {
    if (d.source !== 'pool' || d.kind === 'coin' || d.kind === 'material' || d.kind === 'consumable') return true;
    if (d.rarity !== undefined) return true;
    return DROP_POOL_RARITIES.reduce((s, r) => s + Math.max(0, d.rarityWeights?.[r] ?? 0), 0) === 100;
  };
  const targetValid = (d: DropEntry | LuckyDrop): boolean => {
    if (!rarityDistOk(d)) return false;
    if (d.kind === 'coin') return (d.count ?? 1) >= 1;
    if (d.kind === 'material' || d.kind === 'consumable') {
      return d.source === 'specific' ? !!d.targetId : true;
    }
    return d.source === 'specific'
      ? !!d.targetId
      : d.kind === 'relic' || d.level !== undefined;
  };
  const dropsValid = f.drops.every((d) => d.weight > 0 && targetValid(d));
  const luckyValid = f.luckyDrops.every((d) => d.threshold > 0 && targetValid(d));
  const mechanicsValid = f.mechanics.every((m) =>
    m.desc.trim() && (!!m.hp || !!m.atk || !!m.def || !!m.mres || m.spdMin !== undefined || m.spdMax !== undefined) &&
    (m.scope === 'all' || !!m.monsterId));
  // 固定掉落：材料/藏品/遗物需指定目标；哈哈币需数量；随机需至少1个有效候选
  const fixedValid = f.fixedDrops.every((d) => {
    if (d.kind === 'coin') return d.count >= 1;
    if (d.kind === 'random') {
      return (d.candidates ?? []).length >= 1 && (d.candidates ?? []).every((c) =>
        c.kind === 'coin' ? c.count >= 1 : !!c.targetId);
    }
    return d.count >= 1 && !!d.targetId;
  });
  // BOSS 关约束：子层 BOSS 必须填子层名（常规 BOSS 可出现在任意层数）
  const sublayerNameOk = f.appear !== 'sublayer' || f.sublayerName.trim().length > 0;

  const valid = f.name.trim().length > 0 && f.floor >= 1 && f.level >= 1 &&
    monsterTotal >= 1 && monsterTotal <= MAX_MONSTERS &&
    (f.difficulty !== 'urgent' || !!f.pairStageId) &&
    sublayerNameOk &&
    (f.drops.length === 0 || dropTotal === 100) && dropsValid && luckyValid && mechanicsValid &&
    fixedValid;

  const submit = () => {
    if (!valid) return;
    onSave({
      name: f.name.trim(),
      desc: f.desc.trim(),
      dungeon: f.dungeon,
      floor: f.floor,
      level: f.level,
      difficulty: f.difficulty,
      appear: f.appear,
      sublayerName: f.appear === 'sublayer' ? f.sublayerName.trim() : undefined,
      skirmishTier: f.appear === 'skirmish' ? f.skirmishTier ?? 1 : undefined,
      pairStageId: f.difficulty === 'urgent' ? f.pairStageId : undefined,
      monsters: f.monsterSlots
        .filter((s) => s.monsterId)
        .map((s) => ({ monsterId: s.monsterId, count: s.count })),
      mechanics: f.mechanics.map((m) => ({
        ...m,
        scope: m.scope,
        monsterId: m.scope === 'monster' ? m.monsterId : undefined,
      })),
      drops: f.drops.map((d) =>
        cleanDropCommon(d.kind === 'item' && d.level === undefined ? { ...d, level: 10 } : d)),
      luckyDrops: f.luckyDrops.map(cleanDropCommon),
      fixedDrops: f.fixedDrops.map((d) => ({
        id: d.id,
        kind: d.kind,
        count: Math.max(1, Math.floor(d.count)),
        targetId: d.kind === 'coin' || d.kind === 'random' ? undefined : d.targetId,
        candidates: d.kind === 'random' ? structuredClone(d.candidates ?? []) : undefined,
      })),
    });
  };

  const setSlot = (i: number, patch: Partial<{ monsterId: string; count: number }>) =>
    setF((old) => ({
      ...old,
      monsterSlots: old.monsterSlots.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }));

  return (
    <Modal title={initial ? `编辑关卡 · ${initial.name}` : '新增关卡'} onClose={onClose} wide>
      <div className="form-grid">
        <label>关卡名称<input className="input" value={f.name} maxLength={12}
          onChange={(e) => upd({ name: e.target.value })} /></label>
        <label>出现副本
          <select className="input" value={f.dungeon}
            onChange={(e) => {
              const d = DUNGEONS.find((x) => x.id === e.target.value)!;
              upd({ dungeon: e.target.value, level: d.level });
            }}>
            {DUNGEONS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>层数<input className="input" type="number" min={1} value={f.floor}
          onChange={(e) => upd({ floor: Number(e.target.value) })} /></label>
        <label>关卡等级<input className="input" type="number" min={1} value={f.level}
          onChange={(e) => upd({ level: Number(e.target.value) })} /></label>
        <label>难度
          <select className="input" value={f.difficulty}
            onChange={(e) => upd({ difficulty: e.target.value as StageDifficulty })}>
            <option value="normal">普通</option>
            <option value="urgent">紧急</option>
            <option value="boss">BOSS</option>
          </select>
        </label>
        <label>出现条件
          <select className="input" value={f.appear}
            onChange={(e) => upd({ appear: e.target.value as StageAppear })}>
            <option value="regular">常规（地图直接出现）</option>
            <option value="event">事件（事件内出现）</option>
            <option value="sublayer">子层（异界来客子层）</option>
            <option value="skirmish">狭路相逢（灾厄泰拉）</option>
          </select>
        </label>
        {f.appear === 'sublayer' && (
          <label className="form-wide">子层名称（同名关卡归为同一子层）
            <input className="input" value={f.sublayerName} maxLength={12}
              placeholder="如：瑟银的菜鸟" onChange={(e) => upd({ sublayerName: e.target.value })} />
          </label>
        )}
        {f.appear === 'skirmish' && (
          <label>狭路相逢难度档位
            <select className="input" value={f.skirmishTier ?? 1}
              onChange={(e) => upd({ skirmishTier: Number(e.target.value) as 1 | 2 | 3 })}>
              <option value={1}>第 1 档（易）</option>
              <option value={2}>第 2 档（中）</option>
              <option value={3}>第 3 档（难）</option>
            </select>
          </label>
        )}
        {f.difficulty === 'urgent' && (
          <label className="form-wide">对应普通关卡
            <select className="input" value={f.pairStageId}
              onChange={(e) => upd({ pairStageId: e.target.value })}>
              <option value="">请选择普通版本…</option>
              {normals.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}（{dungeonName(n.dungeon)}·{n.floor}层）
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="form-wide">描述
          <input className="input" value={f.desc} maxLength={60}
            placeholder="关卡说明（可选）" onChange={(e) => upd({ desc: e.target.value })} />
        </label>
      </div>

      <h4>怪物（合计 {monsterTotal}/{MAX_MONSTERS} 只）</h4>
      <div className="stage-monster-rows">
        {f.monsterSlots.map((slot, i) => (
          <div className="stage-monster-row" key={i}>
            <select className="input" value={slot.monsterId}
              onChange={(e) => setSlot(i, { monsterId: e.target.value })}>
              <option value="">— 空槽位 —</option>
              {monsters.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <select className="input narrow" value={slot.count}
              onChange={(e) => setSlot(i, { count: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>×{n}</option>)}
            </select>
            {f.monsterSlots.length > 1 && (
              <button className="btn-mini btn-danger"
                onClick={() => upd({ monsterSlots: f.monsterSlots.filter((_, j) => j !== i) })}>删</button>
            )}
          </div>
        ))}
        {f.monsterSlots.length < MAX_MONSTERS && (
          <button className="btn-mini"
            onClick={() => upd({ monsterSlots: [...f.monsterSlots, { monsterId: '', count: 1 }] })}>
            ＋ 添加怪物种类
          </button>
        )}
        {(monsterTotal < 1 || monsterTotal > MAX_MONSTERS) && (
          <p className="warn">怪物总数需为 1~5 只</p>
        )}
      </div>

      <h4>额外属性（可选）</h4>
      <MechanicEditor mechanics={f.mechanics}
        monsterOptions={f.monsterSlots.filter((s) => s.monsterId)
          .map((s) => ({ id: s.monsterId, name: monsters.find((m) => m.id === s.monsterId)?.name ?? s.monsterId }))}
        onChange={(mechanics) => upd({ mechanics })} />

      <h4>掉落表（方案1：合计100%，胜利只掉一件）</h4>
      <DropTableEditor drops={f.drops} items={items} relics={relics}
        onChange={(drops) => upd({ drops })} />
      {f.drops.length > 0 && (
        <p className={dropTotal === 100 ? 'muted small' : 'warn'}>当前权重合计：{dropTotal}%（需=100%）</p>
      )}

      <h4>幸运掉落（幸运+1D50 ≥ 判定值即额外获得，每条独立判定）</h4>
      <LuckyTableEditor lucky={f.luckyDrops} items={items} relics={relics}
        onChange={(luckyDrops) => upd({ luckyDrops })} />

      <h4>固定掉落（通关必得：材料进共享仓库，哈哈币进副本共享币池，藏品/遗物通关分配）</h4>
      <FixedDropEditor fixed={f.fixedDrops}
        materials={items.filter((i) => i.slot === 'material')}
        equipItems={items.filter((i) => i.slot !== 'material')}
        relics={relics}
        onChange={(fixedDrops) => upd({ fixedDrops })} />

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!valid} onClick={submit}>保存</button>
      </div>
    </Modal>
  );
}

function MechanicEditor({ mechanics, monsterOptions, onChange }: {
  mechanics: StageMechanic[];
  monsterOptions: { id: string; name: string }[];
  onChange: (m: StageMechanic[]) => void;
}) {
  const setOne = (i: number, patch: Partial<StageMechanic>) =>
    onChange(mechanics.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const deltaField = (label: string, key: 'hp' | 'atk' | 'def' | 'mres' | 'spdMin' | 'spdMax') => (
    m: StageMechanic, i: number,
  ) => (
    <label key={key} className="delta-field">
      {label}
      <input className="input narrow" type="number" value={m[key] ?? 0}
        onChange={(e) => setOne(i, { [key]: Number(e.target.value) || undefined } as Partial<StageMechanic>)} />
    </label>
  );
  const fields: [string, 'hp' | 'atk' | 'def' | 'mres' | 'spdMin' | 'spdMax'][] = [
    ['HP', 'hp'], ['攻击', 'atk'], ['防御', 'def'], ['法抗', 'mres'],
    ['速下限', 'spdMin'], ['速上限', 'spdMax'],
  ];
  return (
    <div className="mechanic-list">
      {mechanics.map((m, i) => (
        <div className="card mechanic-row" key={m.id}>
          <div className="mechanic-line">
            <input className="input" placeholder="额外属性描述，如：攻击和防御+10，HP+20"
              value={m.desc} maxLength={60}
              onChange={(e) => setOne(i, { desc: e.target.value })} />
            <select className="input narrow" value={m.scope}
              onChange={(e) => setOne(i, { scope: e.target.value as 'all' | 'monster' })}>
              <option value="all">全体怪物</option>
              <option value="monster">指定怪物</option>
            </select>
            {m.scope === 'monster' && (
              <select className="input" value={m.monsterId ?? ''}
                onChange={(e) => setOne(i, { monsterId: e.target.value })}>
                <option value="">选择怪物…</option>
                {monsterOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <button className="btn-mini btn-danger"
              onClick={() => onChange(mechanics.filter((_, j) => j !== i))}>删</button>
          </div>
          <div className="mechanic-deltas">
            {fields.map(([label, key]) => deltaField(label, key)(m, i))}
          </div>
          {m.scope === 'monster' && !m.monsterId && <p className="warn">请选择作用怪物</p>}
        </div>
      ))}
      <button className="btn-mini"
        onClick={() => onChange([...mechanics, {
          id: tmpId(), desc: '', scope: 'all',
        }])}>
        ＋ 添加机制
      </button>
    </div>
  );
}

// 可搜索的下拉选择：输入名称过滤，点选设置 id（解决藏品多了不好找）
function SearchSelect({ options, value, onSelect, placeholder }: {
  options: { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  const kw = q.trim();
  const filtered = kw ? options.filter((o) => o.label.toLowerCase().includes(kw.toLowerCase())) : options;
  return (
    <span className="search-select">
      <input
        className="input"
        value={open ? q : (selected?.label ?? '')}
        placeholder={placeholder}
        onFocus={() => { setQ(''); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="search-select-menu">
          {filtered.length === 0 && <div className="search-select-empty">无匹配</div>}
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              className="search-select-item"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(o.id);
                setQ('');
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// 目标选择：随机池（稀有度+等级）或指定藏品/遗物/材料/消耗品；哈哈币只填数量
function DropTargetFields({ kind, source, rarity, rarityWeights, level, targetId, count, onPatch, items, relics }: {
  kind: DropKind;
  source: 'pool' | 'specific';
  rarity?: Rarity;
  rarityWeights?: RarityWeights;
  level?: number;
  targetId?: string;
  count?: number;
  onPatch: (p: {
    source?: 'pool' | 'specific'; rarity?: Rarity; rarityWeights?: RarityWeights;
    level?: number; targetId?: string; count?: number;
  }) => void;
  items: Item[];
  relics: Relic[];
}) {
  if (kind === 'coin') {
    return (
      <>
        <span className="muted">哈哈币 ×</span>
        <input className="input narrow" type="number" min={1} value={count ?? 1}
          onChange={(e) => onPatch({ count: Number(e.target.value) })} />
      </>
    );
  }
  const isSlotKind = kind === 'material' || kind === 'consumable';
  // 藏品/遗物不提供「普通」稀有度（材料/消耗品不受限）
  const poolList = isSlotKind
    ? items.filter((i) => i.slot === (kind === 'material' ? 'material' : 'consumable'))
    : kind === 'relic' ? relics : items.filter((i) => i.rarity !== 'common');
  const targetList = poolList;
  const options = targetList.map((x) => ({ id: x.id, label: `${x.name}（${RARITY_LABELS[x.rarity]}）` }));
  const weightsTotal = DROP_POOL_RARITIES.reduce((s, r) => s + Math.max(0, rarityWeights?.[r] ?? 0), 0);
  return (
    <>
      {!isSlotKind && (
        <select className="input narrow" value={source}
          onChange={(e) => onPatch({ source: e.target.value as 'pool' | 'specific' })}>
          <option value="pool">随机池</option>
          <option value="specific">指定</option>
        </select>
      )}
      {isSlotKind ? (
        <SearchSelect options={options} value={targetId ?? ''}
          onSelect={(id) => onPatch({ targetId: id })}
          placeholder={kind === 'material' ? '随机材料…或输入名称查找' : '随机消耗品…或输入名称查找'} />
      ) : source === 'pool' ? (
        <>
          <select className="input narrow" value={rarity ?? ''}
            onChange={(e) => onPatch({ rarity: e.target.value === '' ? undefined : e.target.value as Rarity })}>
            <option value="">随机</option>
            {DROP_POOL_RARITIES.map((r) => <option key={r} value={r}>{RARITY_LABELS[r]}</option>)}
          </select>
          {kind === 'item' && (
            <input className="input narrow" type="number" min={1} placeholder="等级"
              value={level ?? 10}
              onChange={(e) => onPatch({ level: Number(e.target.value) })} />
          )}
          {rarity === undefined && (
            <span className={`rarity-weights ${weightsTotal === 100 ? '' : 'rarity-weights-bad'}`}>
              {DROP_POOL_RARITIES.map((r) => (
                <label key={r} className="rarity-weight-item">
                  {RARITY_LABELS[r]}
                  <input className="input narrow" type="number" min={0} max={100}
                    value={rarityWeights?.[r] ?? 0}
                    onChange={(e) => onPatch({
                      rarityWeights: { ...rarityWeights, [r]: Math.max(0, Number(e.target.value)) },
                    })} />
                  %
                </label>
              ))}
              <span className="muted">合计{weightsTotal}%{weightsTotal !== 100 && '（须为100）'}</span>
            </span>
          )}
        </>
      ) : (
        <SearchSelect options={options} value={targetId ?? ''}
          onSelect={(id) => onPatch({ targetId: id })}
          placeholder={kind === 'item' ? '输入名称搜索藏品…' : '输入名称搜索遗物…'} />
      )}
    </>
  );
}

function DropTableEditor({ drops, items, relics, onChange }: {
  drops: DropEntry[];
  items: Item[];
  relics: Relic[];
  onChange: (d: DropEntry[]) => void;
}) {
  const setOne = (i: number, patch: Partial<DropEntry>) =>
    onChange(drops.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const newEntry = (): DropEntry => ({
    id: tmpId(), kind: 'item', source: 'pool',
    rarity: 'uncommon', level: 10, weight: 50,
  });
  return (
    <div className="drop-list">
      {drops.map((d, i) => (
        <div className="drop-row" key={d.id}>
          <select className="input narrow" value={d.kind}
            onChange={(e) => {
              const kind = e.target.value as DropKind;
              setOne(i, {
                kind,
                targetId: kind === 'coin' || kind === 'material' || kind === 'consumable' ? undefined : d.targetId,
                level: kind === 'relic' ? undefined : d.level,
                count: kind === 'coin' ? d.count ?? 1 : undefined,
              });
            }}>
            <option value="item">藏品</option>
            <option value="relic">遗物</option>
            <option value="material">材料</option>
            <option value="consumable">消耗品</option>
            <option value="coin">哈哈币</option>
          </select>
          <DropTargetFields
            kind={d.kind} source={d.source} rarity={d.rarity} rarityWeights={d.rarityWeights}
            level={d.level} targetId={d.targetId} count={d.count}
            items={items} relics={relics}
            onPatch={(p) => setOne(i, { ...d, ...p })}
          />
          <input className="input narrow" type="number" min={1} max={100} value={d.weight}
            onChange={(e) => setOne(i, { weight: Number(e.target.value) })} />
          <span className="muted">%</span>
          <button className="btn-mini btn-danger"
            onClick={() => onChange(drops.filter((_, j) => j !== i))}>删</button>
        </div>
      ))}
      <button className="btn-mini" onClick={() => onChange([...drops, newEntry()])}>
        ＋ 添加掉落条目
      </button>
    </div>
  );
}

function LuckyTableEditor({ lucky, items, relics, onChange }: {
  lucky: LuckyDrop[];
  items: Item[];
  relics: Relic[];
  onChange: (l: LuckyDrop[]) => void;
}) {
  const setOne = (i: number, patch: Partial<LuckyDrop>) =>
    onChange(lucky.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const newEntry = (): LuckyDrop => ({
    id: tmpId(), kind: 'item', source: 'pool',
    rarity: 'rare', level: 10, threshold: 60,
  });
  return (
    <div className="drop-list drop-list-h">
      {lucky.map((d, i) => (
        <div className="drop-row" key={d.id}>
          <select className="input narrow" value={d.kind}
            onChange={(e) => {
              const kind = e.target.value as DropKind;
              setOne(i, {
                kind,
                targetId: kind === 'coin' || kind === 'material' || kind === 'consumable' ? undefined : d.targetId,
                level: kind === 'relic' ? undefined : d.level,
                count: kind === 'coin' ? d.count ?? 1 : undefined,
              });
            }}>
            <option value="item">藏品</option>
            <option value="relic">遗物</option>
            <option value="material">材料</option>
            <option value="consumable">消耗品</option>
            <option value="coin">哈哈币</option>
          </select>
          <DropTargetFields
            kind={d.kind} source={d.source} rarity={d.rarity} rarityWeights={d.rarityWeights}
            level={d.level} targetId={d.targetId} count={d.count}
            items={items} relics={relics}
            onPatch={(p) => setOne(i, { ...d, ...p })}
          />
          <span className="muted">判定值</span>
          <input className="input narrow" type="number" min={1} value={d.threshold}
            onChange={(e) => setOne(i, { threshold: Number(e.target.value) })} />
          <button className="btn-mini btn-danger"
            onClick={() => onChange(lucky.filter((_, j) => j !== i))}>删</button>
        </div>
      ))}
      <button className="btn-mini" onClick={() => onChange([...lucky, newEntry()])}>
        ＋ 添加幸运掉落
      </button>
    </div>
  );
}

// 固定掉落：材料/哈哈币/固定藏品/固定遗物/随机一个（候选等概率）
function FixedDropEditor({ fixed, materials, equipItems, relics, onChange }: {
  fixed: FixedDrop[];
  materials: Item[];
  equipItems: Item[];
  relics: Relic[];
  onChange: (d: FixedDrop[]) => void;
}) {
  const setOne = (i: number, patch: Partial<FixedDrop>) =>
    onChange(fixed.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const newEntry = (): FixedDrop =>
    ({ id: tmpId(), kind: 'material', targetId: materials[0]?.id ?? '', count: 1 });
  const newCandidate = (): FixedDropCandidate => ({
    id: tmpId(), kind: 'material', targetId: materials[0]?.id ?? '', count: 1,
  });

  const targetSelect = (kind: 'material' | 'item' | 'relic', targetId?: string, onChangeTarget?: (id: string) => void) => {
    const list = kind === 'relic' ? relics : (kind === 'material' ? materials : equipItems);
    const options = list.map((x) => ({ id: x.id, label: `${x.name}（${RARITY_LABELS[x.rarity]}）` }));
    const placeholder = kind === 'relic' ? '输入名称搜索遗物…'
      : kind === 'material' ? '输入名称搜索材料…'
      : '输入名称搜索藏品…';
    return (
      <SearchSelect
        options={options}
        value={targetId ?? ''}
        onSelect={(id) => onChangeTarget?.(id)}
        placeholder={placeholder}
      />
    );
  };

  return (
    <div className="drop-list drop-list-h">
      {fixed.map((d, i) => (
        <div className="drop-row fixed-row" key={d.id}>
          <select className="input narrow" value={d.kind}
            onChange={(e) => setOne(i, {
              kind: e.target.value as FixedDrop['kind'],
              targetId: e.target.value === 'coin' || e.target.value === 'random'
                ? undefined
                : e.target.value === 'material' ? materials[0]?.id ?? '' : d.targetId,
              candidates: e.target.value === 'random' ? (d.candidates ?? []) : undefined,
            })}>
            <option value="material">材料</option>
            <option value="coin">哈哈币</option>
            <option value="item">固定藏品</option>
            <option value="relic">固定遗物</option>
            <option value="random">随机一个</option>
          </select>
          {d.kind === 'coin' ? (
            <span className="muted">哈哈币（通关结算进共享币池）×</span>
          ) : d.kind === 'material' ? (
            <>
              {targetSelect('material', d.targetId, (id) => setOne(i, { targetId: id }))}
              <span className="muted">×</span>
            </>
          ) : d.kind === 'item' ? (
            targetSelect('item', d.targetId, (id) => setOne(i, { targetId: id }))
          ) : d.kind === 'relic' ? (
            targetSelect('relic', d.targetId, (id) => setOne(i, { targetId: id }))
          ) : (
            <span className="muted">等概率随机一个候选</span>
          )}
          <input className="input narrow" type="number" min={1} value={d.count}
            onChange={(e) => setOne(i, { count: Number(e.target.value) })} />
          <button className="btn-mini btn-danger"
            onClick={() => onChange(fixed.filter((_, j) => j !== i))}>删</button>
          {d.kind === 'random' && (
            <div className="fixed-candidates">
              {(d.candidates ?? []).map((c, j) => (
                <div className="drop-row fixed-candidate" key={c.id}>
                  <span className="muted">候选项{j + 1}</span>
                  <select className="input narrow" value={c.kind}
                    onChange={(e) => setOne(i, {
                      candidates: (d.candidates ?? []).map((x, k) =>
                        k === j
                          ? {
                              ...x,
                              kind: e.target.value as FixedDropCandidate['kind'],
                              targetId: e.target.value === 'material' ? materials[0]?.id ?? '' : x.targetId,
                            }
                          : x),
                    })}>
                    <option value="material">材料</option>
                    <option value="coin">哈哈币</option>
                    <option value="item">藏品</option>
                    <option value="relic">遗物</option>
                  </select>
                  {c.kind === 'coin' ? (
                    <span className="muted">哈哈币 ×</span>
                  ) : (
                    targetSelect(c.kind, c.targetId, (id) => setOne(i, {
                      candidates: (d.candidates ?? []).map((x, k) =>
                        k === j ? { ...x, targetId: id } : x),
                    }))
                  )}
                  <input className="input narrow" type="number" min={1} value={c.count}
                    onChange={(e) => setOne(i, {
                      candidates: (d.candidates ?? []).map((x, k) =>
                        k === j ? { ...x, count: Number(e.target.value) } : x),
                    })} />
                  <button className="btn-mini btn-danger"
                    onClick={() => setOne(i, {
                      candidates: (d.candidates ?? []).filter((_, k) => k !== j),
                    })}>删</button>
                </div>
              ))}
              <button className="btn-mini"
                onClick={() => setOne(i, { candidates: [...(d.candidates ?? []), newCandidate()] })}>
                ＋ 添加候选项
              </button>
            </div>
          )}
        </div>
      ))}
      <button className="btn-mini" onClick={() => onChange([...fixed, newEntry()])}>
        ＋ 添加固定掉落
      </button>
    </div>
  );
}
