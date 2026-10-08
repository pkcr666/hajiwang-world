import { useState } from 'react';
import type { DungeonDef } from '../data/dungeons';
import { DUNGEONS } from '../data/dungeons';
import { Modal } from '../components/Modal';
import { Sprite } from '../components/Sprite';

export function floorText(f: [number, number]) {
  return f[0] === f[1] ? `${f[0]} 层` : `${f[0]}–${f[1]} 层`;
}

export function levelText(d: DungeonDef): string {
  return d.levelMax && d.levelMax > d.level ? `Lv.${d.level}-${d.levelMax}` : `Lv.${d.level}`;
}

export function Dungeons({ onBack, onStart }: {
  onBack: () => void;
  onStart: (d: DungeonDef) => void;
}) {
  const [detail, setDetail] = useState<DungeonDef | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <h2>冒险启程 · 选择副本</h2>
        <button className="btn" onClick={onBack}>回主界面</button>
      </div>

      <div className="dungeon-grid">
        {DUNGEONS.map((d) => (
          <div key={d.id} className="dungeon-card clickable" onClick={() => setDetail(d)}>
            <Sprite className="dungeon-banner" src={d.banner} alt={d.name} />
            <div className="dungeon-info">
              <div className="dungeon-name">{d.name}</div>
              <div className="dungeon-tags">
                <span className="dungeon-tag">{'★'.repeat(d.stars)}</span>
                <span className="dungeon-tag">{levelText(d)}</span>
                <span className="dungeon-tag">最多 {d.maxParty} 人</span>
                <span className="dungeon-tag">{floorText(d.floors)}</span>
              </div>
              <div className="dungeon-desc">{d.desc}</div>
              <div className="dungeon-cta muted small">点击查看详情</div>
            </div>
          </div>
        ))}
      </div>

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <Sprite className="dungeon-banner modal-banner" src={detail.banner} alt={detail.name} />
          <p className="dungeon-tags">
            <span className="dungeon-tag big-tag">难度 {'★'.repeat(detail.stars)}{'☆'.repeat(5 - detail.stars)}</span>
            <span className="dungeon-tag big-tag">推荐 {levelText(detail)}</span>
            <span className="dungeon-tag big-tag">最多 {detail.maxParty} 人出战</span>
            <span className="dungeon-tag big-tag">总层数 {floorText(detail.floors)}</span>
          </p>
          <p>{detail.desc}</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDetail(null)}>返回</button>
            <button className="btn primary" onClick={() => { const d = detail; setDetail(null); onStart(d); }}>
              编队出战
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
