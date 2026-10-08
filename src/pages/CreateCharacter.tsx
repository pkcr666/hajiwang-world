import { useMemo, useState } from 'react';
import type { Character, Equip, Job, SaveData, Slot } from '../types';
import { EXTRA_KEYS } from '../types';
import { JOB_DEFS, STARTER_BAG, STARTER_SLOT } from '../data/jobs';
import { SKILL_MAP } from '../data/skills';
import { JOB_IMAGES } from '../assets/config';
import { itemMapOf } from '../data/content';
import { START_EXTRA, validateExtra, LEVEL_BASE } from '../engine/stats';
import { newId } from '../save/storage';
import { Sprite } from '../components/Sprite';
import { ExtraAllocator } from '../components/ExtraAllocator';
import { bonusLines, EXTRA_LABELS, SLOT_LABELS } from '../ui/labels';

const JOBS: Job[] = ['cat', 'typhon', 'kayn', 'logos', 'dandan', 'masked', 'augusta', 'lee', 'donk', 'exusiai', 'eimis', 'rein'];

export function CreateCharacter({ save, onCancel, onCreate }: {
  save: SaveData;
  onCancel: () => void;
  onCreate: (c: Character) => void;
}) {
  const [job, setJob] = useState<Job>('cat');
  const [name, setName] = useState('');
  const [extra, setExtra] = useState({ ...START_EXTRA });

  const map = useMemo(() => itemMapOf(save), [save]);
  const def = JOB_DEFS[job];
  const valid = name.trim().length > 0 && name.trim().length <= 8 && validateExtra(extra);

  const selectJob = (j: Job) => {
    setJob(j);
    const d = JOB_DEFS[j];
    if (d.defaultExtra) setExtra({ ...d.defaultExtra });
  };

  const submit = () => {
    if (!valid) return;
    const equip: Equip = { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] };
    for (const itemId of def.startItems) {
      const item = map.get(itemId);
      if (!item) continue;
      const slot: Slot = STARTER_SLOT[itemId] ?? item.slot;
      if (slot === 'weapon') equip.weapon = itemId;
      else if (slot === 'helmet') equip.helmet = itemId;
      else if (slot === 'armor') equip.armor = itemId;
      else if (slot === 'boots') equip.boots = itemId;
    }
    onCreate({
      id: newId('char'),
      name: name.trim(),
      job,
      level: LEVEL_BASE,
      extra: { ...extra },
      baseExtra: { ...extra },
      equip,
      relics: [],
      inventory: [],
      bag: STARTER_BAG.map((b) => ({ ...b })),
      storage: [],
      coins: 0,
      createdAt: Date.now(),
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>创建角色</h2>
        <button className="btn" onClick={onCancel}>返回</button>
      </div>

      <h3>① 选择职业</h3>
      <div className="job-grid">
        {JOBS.map((j) => (
          <div
            key={j}
            className={`card job-card ${job === j ? 'card-selected' : ''}`}
            onClick={() => selectJob(j)}
          >
            {JOB_DEFS[j].tier === 'legendary' && (
              <span className="job-tier-badge">传奇</span>
            )}
            <Sprite className="job-sprite" src={JOB_IMAGES[j]} alt={JOB_DEFS[j].name} />
            <div className="job-name">{JOB_DEFS[j].name}</div>
            <div className="job-desc">{JOB_DEFS[j].desc}</div>
          </div>
        ))}
      </div>

      <div className="create-detail">
        <div>
          <h3>② 名称（1~8字）</h3>
          <input
            className="input"
            value={name}
            maxLength={8}
            placeholder="输入角色名"
            onChange={(e) => setName(e.target.value)}
          />

          <h3>③ 分配额外6维（80点）</h3>
          {def.defaultExtra ? (
            <div className="allocator">
              <div className="allocator-left ok">传奇角色默认加点，无需手动分配</div>
              <div className="allocator-hint muted small">
                额外6维：{EXTRA_KEYS.map((k) => `${EXTRA_LABELS[k]} ${extra[k]}`).join(' / ')}
              </div>
            </div>
          ) : (
            <ExtraAllocator value={extra} onChange={setExtra} />
          )}
        </div>

        <div className="card job-summary">
          <h3>{def.name}·初始配置</h3>
          <div className="summary-block">
            <b>初始藏品</b>
            {def.startItems.map((id) => {
              const item = map.get(id);
              return item ? (
                <div key={id} className="summary-line">
                  【{SLOT_LABELS[item.slot]}】{item.name}
                  <span className="muted">（{bonusLines(item).join('，')}）</span>
                </div>
              ) : null;
            })}
          </div>
          <div className="summary-block">
            <b>技能<span className="muted small">（专属，1~3级，技能点每10级+1）</span></b>
            {def.skills.map((sid) => {
              const sk = SKILL_MAP[sid];
              if (!sk) return null;
              return (
                <div key={sid} className="summary-line">
                  {sk.name}
                  <span className="muted">
                    （{sk.kind === 'passive' ? '被动' : `耗魔${sk.mpCost}`} · Lv.{sk.unlockLevel ?? 1}解锁）{sk.desc}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="summary-block">
            <b>入册赠礼</b>
            <div className="summary-line">暂无</div>
          </div>
          <div className="muted small">
            额外6维：{EXTRA_KEYS.map((k) => `${k} ${extra[k]}`).join(' / ')}
            <br />本期不影响战斗，为后续探险事件预留。
          </div>
        </div>
      </div>

      <div className="create-actions">
        <button className="btn primary big" disabled={!valid} onClick={submit}>确认入册</button>
        {!valid && <span className="muted">请填写名称并把80点全部分配完</span>}
      </div>
    </div>
  );
}
