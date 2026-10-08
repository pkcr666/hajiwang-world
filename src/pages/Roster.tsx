import { useState } from 'react';
import type { Job, SaveData } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES } from '../assets/config';
import { itemMapOf } from '../data/content';
import { BASE_TEMPLATE, computeStats, equippedIds } from '../engine/stats';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';

const JOBS: Job[] = ['cat', 'typhon', 'kayn', 'logos', 'dandan', 'masked', 'augusta', 'lee', 'donk', 'exusiai', 'eimis', 'rein'];

const WEAPON_LABEL: Record<string, string> = {
  melee: '钻石剑',
  ranged: '钻石弓',
  magic: '钻石杖',
};

export function Roster({ save, onOpen, onCreate, onQuickCreate, onDelete }: {
  save: SaveData;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onQuickCreate: (job: Job) => void;
  onDelete: (slot: number) => void;
}) {
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const full = save.characters.every((c) => c !== null);
  const used = save.characters.filter((c) => c !== null).length;
  const total = save.characters.length;

  const handleQuickPick = (j: Job) => {
    onQuickCreate(j);
    setQuickOpen(false);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>角色名册</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={full} onClick={() => setQuickOpen(true)} title="快速创建30级钻石装备角色">
            ⚡ 快速创建
          </button>
          <button className="btn" disabled={full} onClick={onCreate}>
            {full ? `存档已满（${used}/${total}）` : `+ 创建角色（${used}/${total}）`}
          </button>
        </div>
      </div>
      <div className="slot-grid">
        {save.characters.map((c, i) =>
          c === null ? (
            <div className="slot-empty" key={i} onClick={onCreate}>
              <div className="slot-plus">＋</div>
              <div>空槽位 {i + 1}</div>
            </div>
          ) : (
            <div className="slot-card" key={c.id} onClick={() => onOpen(c.id)}>
              <Sprite className="slot-sprite" src={JOB_IMAGES[c.job]} alt={JOB_DEFS[c.job].name} />
              {c.labUsed && <span className="hack-badge hack-badge-roster" title="该角色使用过遗物测试界面">外挂</span>}
              {c.crisisScore?.crisisContract && (() => {
                const s = c.crisisScore.crisisContract;
                // 旧档兼容：可能是 number
                const obj = typeof s === 'number' ? { single: s } : s;
                return (
                  <div className="crisis-score-badges">
                    {obj.single != null && (
                      <span className="hack-badge" style={{ background: '#7c3aed' }} title="危机合约S1单人最高分">S1单人：{obj.single}</span>
                    )}
                    {obj.dual != null && (
                      <span className="hack-badge" style={{ background: '#db2777' }} title="危机合约S1双人最高分">S1双人：{obj.dual}</span>
                    )}
                  </div>
                );
              })()}
              <div className="slot-info">
                <div className="slot-name">{c.name} <span className="slot-level">Lv.{c.level}</span></div>
                <div className="slot-job">{JOB_DEFS[c.job].name}</div>
                <SlotStats id={c.id} save={save} />
              </div>
              <button
                className="btn-danger btn-mini"
                onClick={(e) => { e.stopPropagation(); setConfirmDel(i); }}
              >
                删除
              </button>
            </div>
          ),
        )}
      </div>

      {confirmDel !== null && save.characters[confirmDel] && (
        <Modal title="删除角色" onClose={() => setConfirmDel(null)}>
          <p>确定删除「{save.characters[confirmDel]!.name}」吗？此操作不可恢复。</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDel(null)}>取消</button>
            <button
              className="btn-danger"
              onClick={() => { onDelete(confirmDel); setConfirmDel(null); }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
      {quickOpen && (
        <Modal title="快速创建 · 选择职业" onClose={() => setQuickOpen(false)} xwide>
          <p style={{ margin: '0 0 12px', color: '#888' }}>
            将创建 30 级角色，自动装备：对应钻石武器 + 钻石甲 + 钻石头盔 + 赫尔墨斯之靴 + 攻击护符 + 生命护符
          </p>
          <div className="job-grid">
            {JOBS.map((j) => {
              const d = JOB_DEFS[j];
              const wt = d.allowedWeaponTypes[0] ?? 'melee';
              return (
                <div
                  key={j}
                  className="card job-card"
                  onClick={() => handleQuickPick(j)}
                  title={`自动装备：${WEAPON_LABEL[wt]}`}
                >
                  {d.tier === 'legendary' && (
                    <span className="job-tier-badge">传奇</span>
                  )}
                  <Sprite className="job-sprite" src={JOB_IMAGES[j]} alt={d.name} />
                  <div className="job-name">{d.name}</div>
                  <div className="job-desc">{d.desc}</div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#a78bfa' }}>
                    武器：{WEAPON_LABEL[wt]}
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

function SlotStats({ id, save }: { id: string; save: SaveData }) {
  const c = save.characters.find((x) => x?.id === id);
  if (!c) return null;
  const map = itemMapOf(save);
  const items = equippedIds(c.equip).map((x) => map.get(x)).filter(Boolean) as ReturnType<typeof map.get>[];
  const stats = computeStats(
    BASE_TEMPLATE,
    items.filter((x): x is NonNullable<typeof x> => !!x),
    c.level,
    c.baseExtra ?? c.extra,
  );
  return (
    <div className="slot-stats">
      HP {stats.hp} · 攻击 {stats.atk} · 防御 {stats.def} · 速度 {stats.spdMin}-{stats.spdMax}
    </div>
  );
}
