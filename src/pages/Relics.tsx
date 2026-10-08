import { useMemo, useState } from 'react';
import { isUnimplemented, RELICS } from '../data/relics';
import { Sprite } from '../components/Sprite';
import { RARITY_COLORS, RARITY_LABELS } from '../ui/labels';

type OriginFilter = 'all' | '通用' | '泰拉';

const FILTERS: { id: OriginFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: '通用', label: '通用' },
  { id: '泰拉', label: '泰拉' },
];

export function Relics({ onBack }: { onBack: () => void }) {
  const [origin, setOrigin] = useState<OriginFilter>('all');

  const list = useMemo(
    () => RELICS.filter((r) => origin === 'all' || r.origin === origin),
    [origin],
  );
  const poolCount = RELICS.filter((r) => r.inPool !== false).length;
  const wipCount = RELICS.filter(isUnimplemented).length;

  return (
    <div className="page">
      <div className="page-head">
        <h2>遗物图鉴
          <span className="slot-level">共 {RELICS.length} 件 · 随机池 {poolCount} · 未实装 {wipCount}</span>
        </h2>
        <button className="btn" onClick={onBack}>返回</button>
      </div>

      <p className="muted small">
        遗物只在副本中生效：开局自带生命水晶与魔力水晶，途中拾取的遗物在通关/团灭后消失。
        「随机池」标记的遗物会出现在随机/幸运掉落中；标注「未实装」的机制类遗物暂只图鉴展示。
      </p>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${origin === f.id ? 'chip-on' : ''}`} onClick={() => setOrigin(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="relic-grid">
        {list.map((r) => (
          <div key={r.id} className="relic-card" style={{ borderColor: RARITY_COLORS[r.rarity] }}>
            <div className="relic-card-head">
              {r.icon
                ? <Sprite className="relic-card-icon" src={r.icon} alt={r.name} />
                : <span className="relic-card-icon relic-emoji">📿</span>}
              <b className="relic-name" style={{ color: RARITY_COLORS[r.rarity] }}>{r.name}</b>
            </div>
            <div className="relic-card-tags">
              <span className="relic-tag" style={{ color: RARITY_COLORS[r.rarity] }}>{RARITY_LABELS[r.rarity]}</span>
              {r.origin && <span className="relic-tag">{r.origin}</span>}
              <span className={`relic-tag ${r.inPool !== false ? 'pool' : 'nopool'}`}>
                {r.inPool !== false ? '随机池' : '非随机池'}
              </span>
              {isUnimplemented(r) && <span className="relic-tag wip">未实装</span>}
            </div>
            <div className="relic-desc">{r.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
