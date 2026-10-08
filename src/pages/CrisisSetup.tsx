import { useMemo, useState } from 'react';
import type { Character, Party, SaveData } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES } from '../assets/config';
import { itemMapOf } from '../data/content';
import { normalizeParty, partyMembers, validateParty } from '../engine/party';
import { startCrisisRun } from '../engine/run';
import { beginRun, saveParty } from '../save/storage';
import { buildAllyCombatant } from '../engine/unit';
import {
  CRISIS_TERMS, CRISIS_STAGE_BASE_SCORE, CRISIS_STAGE_ORDER,
  calcCrisisTotalScore, areTermsMutex,
} from '../data/crisisContract';
import { calcCrisisStageScore } from '../engine/run';
import { Sprite } from '../components/Sprite';

export function CrisisSetup({ save, onChange, onBack, onLaunch }: {
  save: SaveData;
  onChange: (s: SaveData) => void;
  onBack: () => void;
  onLaunch: () => void;
}) {
  const roster = useMemo(
    () => save.characters.filter((c): c is Character => !!c && !c.test),
    [save.characters],
  );
  // 仅可选择 30 级且无外挂标的角色
  const eligible = roster.filter((c) => c.level >= 30 && !c.labUsed);

  const initial = (): Party => {
    const p = save.party;
    const valid = p && validateParty(p, save.characters, 2);
    if (valid) {
      const leader = roster.find((c) => c.id === p.leaderId);
      if (leader && leader.level >= 30 && !leader.labUsed) return structuredClone(p);
    }
    const first = eligible[0];
    return first ? { leaderId: first.id, memberIds: [first.id] } : { leaderId: '', memberIds: [] };
  };
  const [party, setParty] = useState<Party>(initial);
  const [mode, setMode] = useState<'single' | 'dual'>('single');
  const [termIds, setTermIds] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);

  const members = partyMembers(party, save.characters);
  const memberSet = new Set(party.memberIds);
  // 单人作战上限 1 人，双人作战上限 2 人
  const maxParty = mode === 'single' ? 1 : 2;
  const full = party.memberIds.length >= maxParty;

  const toggle = (id: string) => {
    const c = roster.find((x) => x.id === id);
    if (c && (c.level < 30 || c.labUsed)) {
      setHint('仅 30 级且无外挂标的角色可进入危机合约。');
      return;
    }
    if (memberSet.has(id)) {
      const rest = party.memberIds.filter((x) => x !== id);
      if (party.leaderId !== id) setParty({ ...party, memberIds: rest });
      else setParty(rest.length ? normalizeParty(rest[0], rest) : { leaderId: '', memberIds: [] });
      return;
    }
    if (full) { setHint(`队伍已满（最多 ${maxParty} 人）。`); return; }
    setParty(
      party.memberIds.length
        ? { ...party, memberIds: [...party.memberIds, id] }
        : normalizeParty(id, [id]),
    );
  };

  const makeLeader = (id: string) => {
    const c = roster.find((x) => x.id === id);
    if (c && (c.level < 30 || c.labUsed)) {
      setHint('仅 30 级且无外挂标的角色可进入危机合约。');
      return;
    }
    if (memberSet.has(id)) { setParty(normalizeParty(id, party.memberIds)); return; }
    if (full) { setHint(`队伍已满（最多 ${maxParty} 人）。`); return; }
    setParty(normalizeParty(id, [...party.memberIds, id]));
  };

  const toggleTerm = (id: string) => {
    const term = CRISIS_TERMS.find((t) => t.id === id);
    if (!term) return;
    setTermIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // 互斥组：取消同组其他
      if (term.mutexGroup) {
        const filtered = prev.filter((x) => {
          const t = CRISIS_TERMS.find((y) => y.id === x);
          return !t || t.mutexGroup !== term.mutexGroup;
        });
        return [...filtered, id];
      }
      return [...prev, id];
    });
  };

  const totalScore = calcCrisisTotalScore(termIds);
  const baseScore = Object.values(CRISIS_STAGE_BASE_SCORE).reduce((a, b) => a + b, 0);
  const termScore = totalScore - baseScore;

  const universalTerms = CRISIS_TERMS.filter((t) => t.category === 'universal');
  const exclusiveByStage = CRISIS_STAGE_ORDER.map((sid) => ({
    stageId: sid,
    terms: CRISIS_TERMS.filter((t) => t.category === 'exclusive' && t.stageId === sid),
  }));

  const error = validateParty(party, save.characters, maxParty);

  const launch = () => {
    if (error) return;
    if (mode === 'dual' && party.memberIds.length < 2) {
      setHint('双人作战需要 2 名角色。');
      return;
    }
    const members2 = partyMembers(party, save.characters);
    const itemsMap = itemMapOf(save);
    const initialHpMp: Record<string, { hp: number; mp: number }> = {};
    members2.forEach((c, i) => {
      const u = buildAllyCombatant(c, itemsMap, i, {
        relics: [], // 危机合约默认不带生命/魔力水晶
        relicStacks: {},
      });
      initialHpMp[c.id] = { hp: u.maxHp, mp: u.maxMp };
    });
    const run = startCrisisRun({
      party, initialHpMp, pooledCoins: 0, mode, termIds,
    });
    const s = beginRun(save, run);
    // 危机合约不携带药水，不发放消耗品
    onChange(saveParty(s, party));
    onLaunch();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>危机合约 S1 · 编队与词条</h2>
        <button className="btn" onClick={onBack}>返回副本</button>
      </div>

      {hint && <div className="card warn" style={{ marginBottom: 12 }}>{hint}</div>}

      <div className="setup-cols">
        {/* 左侧：词条选择 */}
        <div className="setup-col" style={{ flex: 1.4 }}>
          <h3>合约词条（已选 {termIds.length}）</h3>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="muted small">基础分：{baseScore}　词条分：{termScore}　</div>
            <div className="dungeon-tag big-tag" style={{ background: '#7c3aed' }}>预计总分：{totalScore}</div>
            <div className="muted small" style={{ marginTop: 6 }}>通用词条加成对每一关都生效（非单次）；仅通关关卡计入得分。</div>
            <div className="crisis-stage-scores">
              {CRISIS_STAGE_ORDER.map((sid) => (
                <span key={sid} className="stage-score-chip">
                  {sid.replace('cc_s1_', '作战')}：<b>{calcCrisisStageScore(sid, termIds)}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <b>通用词条（作用于所有关卡）</b>
            <div className="term-grid">
              {universalTerms.map((t) => {
                const selected = termIds.includes(t.id);
                const disabledByMutex = !selected && termIds.some((id) => {
                  const o = CRISIS_TERMS.find((x) => x.id === id);
                  return o && areTermsMutex(o, t);
                });
                return (
                  <label
                    key={t.id}
                    className={`term-card ${selected ? 'selected' : ''} ${disabledByMutex ? 'disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabledByMutex}
                      onChange={() => toggleTerm(t.id)}
                    />
                    <div className="term-name">{t.name} <span className="term-score">+{t.score}</span></div>
                    <div className="term-desc muted small">{t.desc}</div>
                  </label>
                );
              })}
            </div>
          </div>

          {exclusiveByStage.map(({ stageId, terms }) => (
            <div className="card" key={stageId}>
              <b>{stageId.replace('cc_s1_', '作战')} 专属词条</b>
              <div className="term-grid">
                {terms.map((t) => {
                  const selected = termIds.includes(t.id);
                  return (
                    <label key={t.id} className={`term-card ${selected ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleTerm(t.id)}
                      />
                      <div className="term-name">{t.name} <span className="term-score">+{t.score}</span></div>
                      <div className="term-desc muted small">{t.desc}</div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 右侧：角色与模式 */}
        <div className="setup-col">
          <h3>出战角色（{mode === 'single' ? '单人，最多 1 人' : '双人，最多 2 人'}）</h3>
          <div className="card" style={{ marginBottom: 12 }}>
            <div>作战模式：</div>
            <div className="mode-toggle">
              <button
                className={mode === 'single' ? 'btn primary' : 'btn'}
                onClick={() => {
                  // 切到单人时，若队伍超过 1 人则只保留队长
                  if (party.memberIds.length > 1) {
                    setParty(normalizeParty(party.leaderId, [party.leaderId]));
                  }
                  setMode('single');
                }}
              >单人作战</button>
              <button
                className={mode === 'dual' ? 'btn primary' : 'btn'}
                onClick={() => setMode('dual')}
              >双人作战</button>
            </div>
            <div className="muted small">仅 30 级且无外挂标的角色可选。双人作战部分怪物数量增加。危机合约不携带药水。</div>
          </div>

          <div className="card">
            <b>当前编队</b>
            {party.memberIds.length === 0 && <div className="muted small">请从下方选择角色</div>}
            {members.map((c) => (
              <div className="slot-card setup-slot" key={c.id} onClick={() => toggle(c.id)} title="点击移除">
                <Sprite className="slot-sprite" src={JOB_IMAGES[c.job]} alt={c.name} />
                <div className="slot-info">
                  <div className="slot-name">
                    {c.name} Lv.{c.level}
                    {c.id === party.leaderId && <span className="dungeon-tag">队长</span>}
                  </div>
                  <div className="slot-job">{JOB_DEFS[c.job].name}</div>
                </div>
                {c.id !== party.leaderId && (
                  <button className="btn btn-mini" onClick={(e) => { e.stopPropagation(); makeLeader(c.id); }}>设为队长</button>
                )}
              </div>
            ))}
          </div>

          <div className="card">
            <b>可选角色</b>
            {eligible.length === 0 && <div className="muted small">没有符合条件（30级无外挂标）的角色</div>}
            {eligible.map((c) => {
              const inParty = memberSet.has(c.id);
              return (
                <div
                  key={c.id}
                  className={`slot-card setup-slot ${inParty ? '' : 'clickable'}`}
                  onClick={() => !inParty && toggle(c.id)}
                >
                  <Sprite className="slot-sprite" src={JOB_IMAGES[c.job]} alt={c.name} />
                  <div className="slot-info">
                    <div className="slot-name">{c.name} Lv.{c.level}</div>
                    <div className="slot-job">{JOB_DEFS[c.job].name}{c.crisisScore?.crisisContract && (() => {
                      const s = c.crisisScore.crisisContract;
                      const obj = typeof s === 'number' ? { single: s } : s;
                      return ` · S1单人: ${obj.single ?? 0}${obj.dual != null ? ` / 双人: ${obj.dual}` : ''}`;
                    })()}</div>
                  </div>
                  {inParty ? <span className="dungeon-tag">已选</span> : <span className="muted small">点击加入</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="page-actions">
        <button className="btn primary" disabled={!!error} onClick={launch}>
          开始挑战（总分 {totalScore}）
        </button>
      </div>
    </div>
  );
}
