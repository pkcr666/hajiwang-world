import { useMemo, useState } from 'react';
import type { AceUnit, Character, MonsterUnit, SaveData, StageMechanic } from '../types';
import { EXTRA_KEYS, isBoss } from '../types';
import { allEnemies, itemMapOf } from '../data/content';
import { ACE_UNITS } from '../data/aceUnits';
import { JOB_DEFS } from '../data/jobs';
import { BASE_TEMPLATE, computeStats, equippedIds } from '../engine/stats';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';
import { TestCharEditor } from './TestCharEditor';
import { JOB_IMAGES } from '../assets/config';
import { spdText, EXTRA_LABELS, RARITY_COLORS, RARITY_LABELS } from '../ui/labels';
import { itemIcon } from '../assets/config';

const MAX_ACE = 2;

export function BattleSetup({ save, onStart, onBack }: {
  save: SaveData;
  onStart: (allies: Character[], enemies: string[], mechanics?: StageMechanic[], aceUnits?: AceUnit[]) => void;
  onBack: () => void;
}) {
  const enemies = useMemo(() => allEnemies(save), [save]);
  const [allies, setAllies] = useState<(Character | null)[]>([null, null, null]);
  const [testChars, setTestChars] = useState<Character[]>([]);
  const [aceUnits, setAceUnits] = useState<(AceUnit | null)[]>([null, null]);
  const [enemySlots, setEnemySlots] = useState<(string | null)[]>([null, null, null, null, null]);
  const [addAllyAt, setAddAllyAt] = useState<number | null>(null);
  const [addAceAt, setAddAceAt] = useState<number | null>(null);
  const [addEnemyAt, setAddEnemyAt] = useState<number | null>(null);
  const [tab, setTab] = useState<'roster' | 'test'>('roster');
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<Character | null>(null);
  // 按关卡快速编成：记录所选关卡，开战时把其「额外属性」一并带入战斗
  const [stageFill, setStageFill] = useState<string | null>(null);
  const activeStage = stageFill ? save.customStages.find((s) => s.id === stageFill) : undefined;

  const allyCount = allies.filter(Boolean).length;
  const enemyCount = enemySlots.filter(Boolean).length;

  const fillFromStage = (stageId: string) => {
    const st = save.customStages.find((s) => s.id === stageId);
    if (!st) return;
    const ids = st.monsters.flatMap((m) => Array(m.count).fill(m.monsterId));
    setEnemySlots((old) => {
      const next = [...old];
      for (let i = 0; i < next.length; i++) next[i] = i < ids.length ? ids[i] : null;
      return next;
    });
    setStageFill(stageId);
  };

  const placeAlly = (c: Character) => {
    if (addAllyAt === null) return;
    setAllies((old) => {
      const next = [...old];
      next[addAllyAt] = c;
      return next;
    });
    setAddAllyAt(null);
  };
  const placeAce = (a: AceUnit) => {
    if (addAceAt === null) return;
    setAceUnits((old) => {
      const next = [...old];
      next[addAceAt] = a;
      return next;
    });
    setAddAceAt(null);
  };
  const placeEnemy = (id: string) => {
    if (addEnemyAt === null) return;
    setEnemySlots((old) => {
      const next = [...old];
      next[addEnemyAt] = id;
      return next;
    });
    setAddEnemyAt(null);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>对战测试 · 编成</h2>
        <button className="btn" onClick={onBack}>回主界面</button>
      </div>

      <div className="setup-cols">
        <div className="setup-col">
          <h3>我方角色（{allyCount}/3）</h3>
          {allies.map((c, i) =>
            c ? (
              <div className="slot-card setup-slot" key={`a${i}`} onClick={() => setAllies((old) => old.map((x, j) => j === i ? null : x))} title="点击移除">
                <Sprite className="slot-sprite" src={JOB_IMAGES[c.job]} alt={c.name} />
                <div className="slot-info">
                  <div className="slot-name">{c.name}{c.test && <span className="test-tag">测试</span>}</div>
                  <div className="slot-job">{JOB_DEFS[c.job].name}（点击移除）</div>
                </div>
              </div>
            ) : (
              <div className="slot-empty setup-empty" key={`a${i}`} onClick={() => { setTab('roster'); setAddAllyAt(i); }}>
                <div className="slot-plus">＋</div>添加我方
              </div>
            ),
          )}
          <h4 style={{ marginTop: 12 }}>王牌单位（{aceUnits.filter(Boolean).length}/{MAX_ACE}）</h4>
          {aceUnits.map((a, i) =>
            a ? (
              <div className="slot-card setup-slot" key={`ac${i}`} onClick={() => setAceUnits((old) => old.map((x, j) => j === i ? null : x))} title="点击移除" style={{ borderColor: RARITY_COLORS[a.rarity] }}>
                <div className="slot-info">
                  <div className="slot-name" style={{ color: RARITY_COLORS[a.rarity] }}>{a.name} <span className="test-tag">{RARITY_LABELS[a.rarity]}</span></div>
                  <div className="slot-job">HP {a.stats.hp} · 攻 {a.stats.atk} · 速 {spdText(a.stats.spdMin, a.stats.spdMax)}（点击移除）</div>
                </div>
              </div>
            ) : (
              <div className="slot-empty setup-empty" key={`ac${i}`} onClick={() => setAddAceAt(i)}>
                <div className="slot-plus">＋</div>添加王牌单位
              </div>
            ),
          )}
        </div>

        <div className="setup-col">
          <h3>敌方（{enemyCount}/5）</h3>
          {enemySlots.map((id, i) => {
            const m = id ? enemies.find((x) => x.id === id) : undefined;
            return m ? (
              <div className="slot-card setup-slot" key={`e${i}`} onClick={() => setEnemySlots((old) => old.map((x, j) => j === i ? null : x))} title="点击移除">
                <Sprite className="slot-sprite" src={m.icon} alt={m.name} />
                <div className="slot-info">
                  <div className="slot-name">{m.name}{isBoss(m) ? <span className="boss-tag">多部位</span> : m.boss && <span className="boss-tag">BOSS</span>}</div>
                  <div className="slot-job">HP {m.stats.hp} · 速 {spdText(m.stats.spdMin, m.stats.spdMax)}（点击移除）</div>
                </div>
              </div>
            ) : (
              <div className="slot-empty setup-empty" key={`e${i}`} onClick={() => setAddEnemyAt(i)}>
                <div className="slot-plus">＋</div>添加敌方
              </div>
            );
          })}
          <div className="stage-quick-fill">
            <label className="muted small">按关卡快速编成（自带额外属性）</label>
            <select
              value={stageFill ?? ''}
              onChange={(e) => { if (e.target.value) fillFromStage(e.target.value); }}
            >
              <option value="">选择自定义关卡…</option>
              {save.customStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.difficulty === 'boss' ? 'BOSS' : s.difficulty === 'urgent' ? '紧急' : '普通'} · Lv.{s.level}）
                </option>
              ))}
            </select>
            {activeStage && activeStage.mechanics.length > 0 && (
              <div className="muted small stage-mech-tip">
                额外属性：{activeStage.mechanics.map((m) => m.desc).join('；')}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="start-row">
        <button
          className="btn primary big"
          disabled={allyCount + aceUnits.filter(Boolean).length === 0 || enemyCount === 0}
          onClick={() => onStart(
            allies.filter((x): x is Character => !!x),
            enemySlots.filter((x): x is string => !!x),
            activeStage?.mechanics,
            aceUnits.filter((x): x is AceUnit => !!x),
          )}
        >
          开战
        </button>
        {(allyCount + aceUnits.filter(Boolean).length === 0 || enemyCount === 0) && <span className="muted">双方至少各上阵1个单位</span>}
      </div>

      {addAllyAt !== null && (
        <Modal title="选择我方单位" onClose={() => setAddAllyAt(null)} wide>
          <div className="tabs">
            <button className={`chip ${tab === 'roster' ? 'chip-on' : ''}`} onClick={() => setTab('roster')}>正式角色</button>
            <button className={`chip ${tab === 'test' ? 'chip-on' : ''}`} onClick={() => setTab('test')}>测试角色</button>
            <button className="chip" onClick={() => setEditing(true)}>＋ 新建测试角色</button>
          </div>
          {tab === 'roster' && (
            <div className="pick-list">
              {save.characters.filter(Boolean).length === 0 && <p className="muted">名册还没有角色，请先去角色名册创建。</p>}
              {save.characters.filter(Boolean).map((c) => c && (
                <PickAlly key={c.id} c={c} save={save} onPick={() => placeAlly(c)} onDetail={() => setDetail(c)} />
              ))}
            </div>
          )}
          {tab === 'test' && (
            <div className="pick-list">
              {testChars.length === 0 && <p className="muted">还没有测试角色，点上方「新建测试角色」自由搭配。</p>}
              {testChars.map((c) => (
                <PickAlly key={c.id} c={c} save={save} onPick={() => placeAlly(c)}
                  onDetail={() => setDetail(c)}
                  onDelete={() => setTestChars((old) => old.filter((x) => x.id !== c.id))} />
              ))}
            </div>
          )}
        </Modal>
      )}

      {addAceAt !== null && (
        <Modal title="选择王牌单位" onClose={() => setAddAceAt(null)} wide>
          <p className="muted small" style={{ marginBottom: 10 }}>
            王牌单位为固定属性的临时队友，不升级不穿装备。最多上阵 {MAX_ACE} 个。
          </p>
          <div className="pick-list">
            {ACE_UNITS.map((a) => (
              <div
                key={a.id}
                className="card pick-card clickable"
                style={{ borderColor: RARITY_COLORS[a.rarity] }}
                onClick={() => placeAce(a)}
              >
                <div>
                  <div className="slot-name" style={{ color: RARITY_COLORS[a.rarity] }}>
                    {a.name} <span className="test-tag">{RARITY_LABELS[a.rarity]}</span>
                  </div>
                  <div className="muted small">
                    HP {a.stats.hp} · MP {a.stats.mp} · 攻 {a.stats.atk} · 防 {a.stats.def} · 抗 {a.stats.mres}% · 速 {spdText(a.stats.spdMin, a.stats.spdMax)}
                  </div>
                  <div className="muted small" style={{ marginTop: 2 }}>
                    技能：{a.skills.map((s) => s.name).join('、')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {addEnemyAt !== null && (
        <Modal title="选择敌方单位" onClose={() => setAddEnemyAt(null)} wide>
          <div className="pick-list enemy-pick">
            {enemies.map((m: MonsterUnit) => (
              <div key={m.id} className="card pick-card clickable" onClick={() => placeEnemy(m.id)}>
                <Sprite className="monster-icon" src={m.icon} alt={m.name} />
                <div>
                  <div className="slot-name">{m.name}{isBoss(m) ? <span className="boss-tag">多部位BOSS·占1格</span> : m.boss && <span className="boss-tag">BOSS</span>}</div>
                  <div className="muted small">
                    HP {m.stats.hp} · 攻 {m.stats.atk} · 防 {m.stats.def} · 抗 {m.stats.mres}% · 速 {spdText(m.stats.spdMin, m.stats.spdMax)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {editing && (
        <TestCharEditor
          save={save}
          onClose={() => setEditing(false)}
          onSave={(c) => {
            setTestChars((old) => [...old, c]);
            setEditing(false);
            setTab('test');
          }}
        />
      )}

      {detail && <TestCharDetail c={detail} save={save} onClose={() => setDetail(null)} />}
    </div>
  );
}

function PickAlly({ c, save, onPick, onDetail, onDelete }: {
  c: Character;
  save: SaveData;
  onPick: () => void;
  onDetail: () => void;
  onDelete?: () => void;
}) {
  const map = itemMapOf(save);
  const items = equippedIds(c.equip).map((id) => map.get(id)).filter((x) => !!x) as NonNullable<ReturnType<typeof map.get>>[];
  const stats = computeStats(BASE_TEMPLATE, items, c.level, c.baseExtra ?? c.extra);
  return (
    <div className="card pick-card clickable" onClick={onPick}>
      <Sprite className="monster-icon" src={JOB_IMAGES[c.job]} alt={c.name} />
      <div>
        <div className="slot-name">{c.name}{c.test && <span className="test-tag">测试</span>}</div>
        <div className="muted small">
          {JOB_DEFS[c.job].name} · HP {stats.hp} · 攻 {stats.atk} · 防 {stats.def} · 抗 {stats.mres}% · 速 {spdText(stats.spdMin, stats.spdMax)}
        </div>
      </div>
      <button className="btn btn-mini" onClick={(e) => { e.stopPropagation(); onDetail(); }}>详情</button>
      {c.test && onDelete && (
        <button className="btn-danger btn-mini" onClick={(e) => { e.stopPropagation(); onDelete(); }}>删</button>
      )}
    </div>
  );
}

function TestCharDetail({ c, save, onClose }: { c: Character; save: SaveData; onClose: () => void }) {
  const map = itemMapOf(save);
  const equipItems = equippedIds(c.equip).map((id) => map.get(id)).filter((x) => !!x) as NonNullable<ReturnType<typeof map.get>>[];
  const stats = computeStats(BASE_TEMPLATE, equipItems, c.level, c.baseExtra ?? c.extra);
  const extraSum: Record<string, number> = {};
  for (const it of equipItems) {
    if (!it.extraBonus) continue;
    for (const k of EXTRA_KEYS) extraSum[k] = (extraSum[k] ?? 0) + (it.extraBonus[k] ?? 0);
  }
  const job = JOB_DEFS[c.job];
  const slots: { label: string; itemId: string | null }[] = [
    { label: '武器', itemId: c.equip.weapon },
    { label: '头盔', itemId: c.equip.helmet },
    { label: '防具', itemId: c.equip.armor },
    { label: '靴子', itemId: c.equip.boots },
    { label: '饰品1', itemId: c.equip.accessory[0] },
    { label: '饰品2', itemId: c.equip.accessory[1] },
  ];
  const owned = (c.inventory ?? []).map((id) => map.get(id)).filter((x) => !!x) as NonNullable<ReturnType<typeof map.get>>[];
  return (
    <Modal title={`${c.name} · 属性详情`} onClose={onClose} xwide>
      <div className="runbag-grid test-detail-grid">
        {/* 列A：属性总览 */}
        <div className="runbag-col">
          <div className="runbag-stats card">
            <div className="test-detail-head">
              <Sprite className="detail-portrait-img" src={JOB_IMAGES[c.job]} alt={c.name} />
              <div>
                <div className="slot-name">{c.name}{c.test && <span className="test-tag">测试</span>}</div>
                <div className="muted small">Lv.{c.level} {job.name} · {job.allowedWeaponTypes.join('/')}</div>
              </div>
            </div>
            <h4>基础6维</h4>
            <div className="runbag-stat-grid">
              <span>生命 <b>{stats.hp}</b></span>
              <span>魔力 <b>{stats.mp}</b></span>
              <span>攻击 <b>{stats.atk}</b></span>
              <span>防御 <b>{stats.def}</b></span>
              <span>法抗 <b>{stats.mres}%</b></span>
              <span>速度 <b>{spdText(stats.spdMin, stats.spdMax)}</b></span>
            </div>
            <h4>额外6维</h4>
            <div className="runbag-stat-grid">
              {EXTRA_KEYS.map((k) => (
                <span key={k}>{EXTRA_LABELS[k]} <b>{c.extra[k] + (extraSum[k] ?? 0)}</b>{extraSum[k] ? <i className="bp-relic-delta">+{extraSum[k]}</i> : null}</span>
              ))}
            </div>
            <p className="muted small">测试角色不进入正式副本，属性仅用于对战测试编成。</p>
          </div>
        </div>

        {/* 列B：穿戴 */}
        <div className="runbag-col">
          <div className="runbag-panel card">
            <h4>穿戴</h4>
            <div className="runbag-slots">
              {slots.map((s) => {
                const item = s.itemId ? map.get(s.itemId) : undefined;
                return (
                  <div
                    key={s.label}
                    className="runbag-slot"
                    style={item ? { borderColor: RARITY_COLORS[item.rarity] } : undefined}
                    title={item ? item.name : '空'}
                  >
                    <span className="runbag-slot-label">{s.label}</span>
                    {item
                      ? <span className="runbag-slot-name" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}</span>
                      : <span className="muted small">空</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 列C：藏品 + 遗物 */}
        <div className="runbag-col">
          <div className="runbag-panel card">
            <h4>藏品（{owned.length}）</h4>
            <div className="runbag-inv">
              {owned.length === 0 && <span className="muted small">测试角色未携带藏品。</span>}
              {owned.map((it, i) => (
                <div key={`${it.id}_${i}`} className="runbag-item static" style={{ borderColor: RARITY_COLORS[it.rarity] }}>
                  <Sprite className="runbag-item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                  <span className="runbag-item-name" style={{ color: RARITY_COLORS[it.rarity] }}>{it.name}</span>
                </div>
              ))}
            </div>
            <h4>遗物</h4>
            <div className="runbag-relics">
              <span className="muted small">测试角色不携带遗物。</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
