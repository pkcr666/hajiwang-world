import { useState } from 'react';
import type { AceUnit, AceSkill } from '../types';
import { ACE_UNITS } from '../data/aceUnits';
import { ACE_IMAGES } from '../assets/config';
import { RARITY_LABELS, RARITY_COLORS, spdText } from '../ui/labels';

export function AceLibrary({ onBack }: { onBack: () => void }) {
  const [detail, setDetail] = useState<AceUnit | null>(null);
  // 用 version 强制刷新列表，使编辑后的属性立即反映到卡片上
  const [, setVersion] = useState(0);
  const epics = ACE_UNITS.filter((u) => u.rarity === 'epic');
  const rares = ACE_UNITS.filter((u) => u.rarity === 'rare');

  const refresh = () => setVersion((v) => v + 1);

  return (
    <div className="page">
      <div className="page-head">
        <h2>王牌单位库（{ACE_UNITS.length}）</h2>
        <button className="btn" onClick={onBack}>返回</button>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        王牌单位为固定属性的临时队友，不升级不穿装备。可在副本「王牌招募」节点或对战测试中加入我方。
        <br />点击卡片可直接修改属性与技能参数，修改立即生效（仅本次运行，刷新页面后恢复默认）。
      </p>

      <h3 style={{ color: RARITY_COLORS.epic }}>史诗（{epics.length}）</h3>
      <div className="ace-grid">
        {epics.map((u) => (
          <AceCard key={u.id} unit={u} onClick={() => setDetail(u)} />
        ))}
      </div>

      <h3 style={{ color: RARITY_COLORS.rare, marginTop: 16 }}>稀有（{rares.length}）</h3>
      <div className="ace-grid">
        {rares.map((u) => (
          <AceCard key={u.id} unit={u} onClick={() => setDetail(u)} />
        ))}
      </div>

      {detail && <AceDetail unit={detail} onClose={() => { setDetail(null); refresh(); }} />}
    </div>
  );
}

// 立绘兜底：图片缺失/加载失败时显示稀有度首字徽章
function AcePortrait({ unit, size = 132 }: { unit: AceUnit; size?: number }) {
  const src = unit.icon ?? ACE_IMAGES[unit.id];
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <div className="ace-portrait" style={{ height: size }}>
        <img src={src} alt={unit.name} className="ace-portrait-img" onError={() => setBroken(true)} />
      </div>
    );
  }
  return (
    <div
      className="ace-portrait ace-portrait-fallback"
      style={{ height: size, background: `${RARITY_COLORS[unit.rarity]}22`, color: RARITY_COLORS[unit.rarity], borderColor: RARITY_COLORS[unit.rarity] }}
    >
      {unit.name.charAt(0)}
    </div>
  );
}

function AceCard({ unit, onClick }: { unit: AceUnit; onClick: () => void }) {
  const active = unit.skills.filter((s) => s.kind === 'active').length;
  const passive = unit.skills.filter((s) => s.kind === 'passive').length;
  return (
    <div
      className="card ace-card clickable"
      style={{ borderColor: RARITY_COLORS[unit.rarity] }}
      onClick={onClick}
    >
      <AcePortrait unit={unit} />
      <div className="ace-card-head">
        <div className="ace-card-name" style={{ color: RARITY_COLORS[unit.rarity] }}>{unit.name}</div>
        <span className="ace-tag" style={{ color: RARITY_COLORS[unit.rarity], borderColor: RARITY_COLORS[unit.rarity] }}>
          {RARITY_LABELS[unit.rarity]}
        </span>
      </div>
      <div className="ace-stat-grid">
        <span title="生命"><i>HP</i><b>{unit.stats.hp}</b></span>
        <span title="魔力"><i>MP</i><b>{unit.stats.mp}</b></span>
        <span title="攻击"><i>攻</i><b>{unit.stats.atk}</b></span>
        <span title="防御"><i>防</i><b>{unit.stats.def}</b></span>
        <span title="法抗"><i>抗</i><b>{unit.stats.mres}%</b></span>
        <span title="速度"><i>速</i><b>{spdText(unit.stats.spdMin, unit.stats.spdMax)}</b></span>
      </div>
      <div className="ace-skill-summary">
        <span className="ace-skill-kind active">{active} 主动</span>
        <span className="ace-skill-kind passive">{passive} 被动</span>
      </div>
      <div className="muted small ace-skill-names">
        {unit.skills.slice(0, 2).map((s) => s.name).join(' / ')}
      </div>
    </div>
  );
}

const STAT_FIELDS: { key: keyof AceUnit['stats']; label: string; min?: number }[] = [
  { key: 'hp', label: '生命', min: 1 },
  { key: 'mp', label: '魔力', min: 0 },
  { key: 'atk', label: '攻击', min: 0 },
  { key: 'def', label: '防御', min: 0 },
  { key: 'mres', label: '法抗(%)', min: 0 },
  { key: 'spdMin', label: '速度下限', min: 1 },
  { key: 'spdMax', label: '速度上限', min: 1 },
];

function NumInput({ value, onChange, min, step = 1, width = 80 }: {
  value: number; onChange: (v: number) => void; min?: number; step?: number; width?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      step={step}
      style={{ width, padding: '4px 6px', background: '#1d1929', border: '1px solid var(--border)', borderRadius: 4, color: '#fff' }}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      }}
    />
  );
}

function AceDetail({ unit, onClose }: { unit: AceUnit; onClose: () => void }) {
  const target = ACE_UNITS.find((u) => u.id === unit.id) ?? unit;

  const setStat = (k: keyof AceUnit['stats'], v: number) => { target.stats[k] = v; };
  const setSkillField = (idx: number, patch: Partial<AceSkill>) => {
    Object.assign(target.skills[idx]!, patch);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="forge-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 4px', textAlign: 'left' }}>
          <div className="ace-detail-head">
            <AcePortrait unit={target} size={112} />
            <div>
              <h3 style={{ color: RARITY_COLORS[target.rarity], margin: '0 0 8px' }}>{target.name}</h3>
              <div className="muted small">
                {RARITY_LABELS[target.rarity]}王牌单位 · 修改后立即生效
              </div>
              <div className="ace-stat-grid ace-detail-stats">
                <span><i>HP</i><b>{target.stats.hp}</b></span>
                <span><i>MP</i><b>{target.stats.mp}</b></span>
                <span><i>攻</i><b>{target.stats.atk}</b></span>
                <span><i>防</i><b>{target.stats.def}</b></span>
                <span><i>抗</i><b>{target.stats.mres}%</b></span>
                <span><i>速</i><b>{spdText(target.stats.spdMin, target.stats.spdMax)}</b></span>
              </div>
            </div>
          </div>

          <h4 style={{ margin: '12px 0 6px' }}>基础属性（可编辑）</h4>
          <div className="runbag-stat-grid" style={{ marginBottom: 12 }}>
            {STAT_FIELDS.map((f) => (
              <span key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {f.label}
                <NumInput value={target.stats[f.key]} min={f.min} onChange={(v) => setStat(f.key, v)} width={70} />
              </span>
            ))}
          </div>

          <h4 style={{ margin: '8px 0 4px' }}>技能</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {target.skills.map((s, i) => (
              <div key={i} className="card" style={{ padding: '8px 10px' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  <input
                    value={s.name}
                    style={{ fontWeight: 600, padding: '2px 6px', width: 240, background: '#1d1929', border: '1px solid var(--border)', borderRadius: 4, color: '#fff' }}
                    onChange={(e) => setSkillField(i, { name: e.target.value })}
                  />
                  <span className="muted small" style={{ marginLeft: 6 }}>
                    {s.kind === 'passive' ? '被动' : '主动'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
                  {s.kind === 'active' && (
                    <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      MP消耗 <NumInput value={s.mpCost ?? 0} min={0} onChange={(v) => setSkillField(i, { mpCost: v })} width={56} />
                    </label>
                  )}
                  {s.dmgPct !== undefined && (
                    <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      伤害倍率 <NumInput value={s.dmgPct} min={0} step={0.1} onChange={(v) => setSkillField(i, { dmgPct: v })} width={56} />
                    </label>
                  )}
                  {s.trueDmgFlat !== undefined && (
                    <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      固定真伤 <NumInput value={s.trueDmgFlat} min={0} onChange={(v) => setSkillField(i, { trueDmgFlat: v })} width={60} />
                    </label>
                  )}
                  {s.maxHpTrueDmgPct !== undefined && (
                    <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      最大HP真伤% <NumInput value={s.maxHpTrueDmgPct} min={0} step={0.01} onChange={(v) => setSkillField(i, { maxHpTrueDmgPct: v })} width={56} />
                    </label>
                  )}
                  {s.shield !== undefined && (
                    <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      护盾 <NumInput value={s.shield} min={0} onChange={(v) => setSkillField(i, { shield: v })} width={56} />
                    </label>
                  )}
                  {s.oncePerBattle !== undefined && (
                    <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={s.oncePerBattle} onChange={(e) => setSkillField(i, { oncePerBattle: e.target.checked })} />
                      每场仅一次
                    </label>
                  )}
                </div>
                <textarea
                  value={s.desc}
                  rows={2}
                  style={{ width: '100%', padding: '4px 6px', background: '#1d1929', border: '1px solid var(--border)', borderRadius: 4, color: '#fff', resize: 'vertical' }}
                  onChange={(e) => setSkillField(i, { desc: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  );
}
