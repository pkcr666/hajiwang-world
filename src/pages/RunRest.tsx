import { useMemo, useState } from 'react';
import type { Item, SaveData } from '../types';
import { itemMapOf } from '../data/content';
import { sumRelicSixStats } from '../data/relics';
import { partyEntries } from '../engine/party';
import { plagueLetterHpDown, resolveNode } from '../engine/run';
import { restHealPercent } from '../engine/nodes';
import { buildAceCombatant, buildAllyCombatant } from '../engine/unit';
import { collectExtraBonus, equippedIds } from '../engine/stats';
import { persistRun } from '../save/storage';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES } from '../assets/config';
import { Sprite } from '../components/Sprite';
import { CRISIS_REST_BUFFS, crisisRestHealPct } from '../data/crisisContract';

export function RunRest({ save, nodeId, onChange, onBack }: {
  save: SaveData;
  nodeId: string;
  onChange: (s: SaveData) => void;
  onBack: () => void;
}) {
  const run = save.activeRun!;
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const members = useMemo(() => partyEntries(run.party, save.characters), [run.party, save.characters]);

  // 危机合约休息点：从 node.note 解析 restIndex
  const isCrisis = run.dungeonId === 'crisisContract' && !!run.crisis;
  const crisisNote = isCrisis ? (run.acts[1]?.nodes.find((n) => n.id === nodeId)?.note ?? '') : '';
  const restMatch = crisisNote.match(/cc_rest_(\d+)/);
  const restIndex = restMatch ? Number(restMatch[1]) : -1;
  const crisisRest = restIndex >= 0 ? CRISIS_REST_BUFFS.find((r) => r.restIndex === restIndex) : undefined;
  const [selectedBuff, setSelectedBuff] = useState<string | null>(null);
  const isCalamity = run.dungeonId === 'preWallCalamity';
  const [revived, setRevived] = useState<Set<string>>(new Set());

  // 危机合约：固定恢复比例（受词条影响，默认50%）
  const crisisHealPct = isCrisis ? crisisRestHealPct(run.crisis!.termIds) : 0;

  // 普通休息点：每名队员用自己的「意志」+1D50 掷恢复比例
  const results = useState(() => members.map((e, i) => {
    const isAce = e.kind === 'ace';
    const u = isAce
      ? buildAceCombatant(e.data, i)
      : buildAllyCombatant(e.data, itemMap, i, {
          relics: run.relics, relicStacks: run.relicStacks, killBook: run.killBook,
          maxHpPctDown: plagueLetterHpDown(run),
        });
    let pct = crisisHealPct * 100;
    let roll = 0;
    if (!isCrisis) {
      const seed = (run.createdAt + nodeId.length * 31 + i * 7) >>> 0;
      let s = seed || 1;
      const seededRng = {
        int: (min: number, max: number) => {
          s = (s * 1103515245 + 12345) >>> 0;
          return min + (s % (max - min + 1));
        },
      };
      let wil = 0;
      if (!isAce) {
        const equipped = equippedIds(e.data.equip)
          .map((id) => itemMap.get(id))
          .filter((x): x is Item => !!x);
        wil = (e.data.extra?.wil ?? 0)
          + (collectExtraBonus(equipped).wil ?? 0)
          + sumRelicSixStats(run.relics ?? []).wil;
      }
      const r = restHealPercent(wil, seededRng, run.dungeonId);
      roll = r.roll;
      pct = r.pct;
    }
    const cur = run.hpMp[e.id] ?? { hp: 0, mp: 0 };
    const hpNow = Math.max(0, cur.hp);
    const mpNow = Math.max(0, cur.mp);
    return {
      e, i, u, roll, pct, cur, isAce,
      hpNow, mpNow,
      healHp: Math.min(u.maxHp - hpNow, Math.ceil(u.maxHp * pct / 100)),
      healMp: Math.min(u.maxMp - mpNow, Math.ceil(u.maxMp * pct / 100)),
    };
  }))[0];

  const finish = () => {
    const next = structuredClone(run);
    for (const res of results) {
      if (revived.has(res.e.id)) {
        // 灾厄泰拉：复活死亡单位至 50% 最大生命，MP 回满
        next.hpMp[res.e.id] = { hp: Math.ceil(res.u.maxHp * 0.5), mp: res.u.maxMp };
      } else {
        next.hpMp[res.e.id] = {
          hp: Math.min(res.u.maxHp, res.hpNow + res.healHp),
          mp: Math.min(res.u.maxMp, res.mpNow + res.healMp),
        };
      }
    }
    // 危机合约：应用选中的休息 buff（作为遗物加入本局）
    if (isCrisis && selectedBuff && crisisRest) {
      const opt = crisisRest.options.find((o) => o.id === selectedBuff);
      if (opt && !next.relics.includes(opt.apply)) {
        next.relics.push(opt.apply);
      }
      if (next.crisis) next.crisis.buffs[restIndex] = selectedBuff;
    }
    onChange(persistRun(save, resolveNode(next, nodeId)));
    onBack();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>{isCrisis ? '危机合约·休整点' : '安全的角落'}
          <span className="slot-level">
            {isCrisis ? `恢复 ${Math.round(crisisHealPct * 100)}% 生命与魔力` : '围坐篝火休整 · 恢复 (意志+1D50)% 的生命与魔力'}
          </span>
        </h2>
        <div className="page-head-actions">
          <button className="btn primary" onClick={finish} disabled={isCrisis && crisisRest && !selectedBuff}>
            {isCrisis && crisisRest ? '选择加成后继续前行' : '休整完毕，继续前行'}
          </button>
        </div>
      </div>

      <div className="card rest-wrap">
        <div className="rest-grid">
          {results.map((res) => {
            const e = res.e;
            return (
            <div key={e.id} className="rest-member">
              <div className="rest-member-head">
                {e.kind === 'ace' ? (
                  <span className="head-job-icon" style={{ color: e.data.rarity === 'epic' ? '#c084fc' : '#67e8f9', fontSize: '2em' }}>★</span>
                ) : (
                  <Sprite className="head-job-icon" src={JOB_IMAGES[e.data.job]} alt={JOB_DEFS[e.data.job].name} />
                )}
                <b>{e.name}{e.id === run.party.leaderId && <span className="party-badge">队长</span>}</b>
                <span className="muted small">
                  {e.kind === 'ace'
                    ? `${e.data.rarity === 'epic' ? '史诗' : '稀有'}王牌`
                    : `${JOB_DEFS[e.data.job].name} · Lv.${e.data.level}`}
                </span>
              </div>
              {!isCrisis && (
                <div className="rest-roll">🎲 意志 恢复 {res.pct}%</div>
              )}
              {isCrisis && (
                <div className="rest-roll">固定恢复 {Math.round(crisisHealPct * 100)}%</div>
              )}

              <div className="rest-bar rest-bar-hp">
                <span className="rest-bar-fill" style={{ width: `${Math.round((res.hpNow / res.u.maxHp) * 100)}%` }} />
                <span className="rest-bar-text">HP {res.hpNow} → {Math.min(res.u.maxHp, res.hpNow + res.healHp)} / {res.u.maxHp}</span>
              </div>
              <div className="rest-bar rest-bar-mp">
                <span className="rest-bar-fill" style={{ width: `${Math.round((res.mpNow / res.u.maxMp) * 100)}%` }} />
                <span className="rest-bar-text">MP {res.mpNow} → {Math.min(res.u.maxMp, res.mpNow + res.healMp)} / {res.u.maxMp}</span>
              </div>
              <p className="muted small rest-gain">
                +{res.healHp} HP · +{res.healMp} MP
              </p>
              {isCalamity && res.hpNow <= 0 && (
                <button
                  className={`btn ${revived.has(e.id) ? '' : 'primary'}`}
                  onClick={() => {
                    const s = new Set(revived);
                    if (s.has(e.id)) s.delete(e.id);
                    else s.add(e.id);
                    setRevived(s);
                  }}
                >
                  {revived.has(e.id) ? '取消复活' : '复活（恢复50%生命）'}
                </button>
              )}
            </div>
            );
          })}
        </div>
        {isCrisis ? (
          <p className="muted small">生命与魔力跨战斗继承；恢复比例由合约词条决定。</p>
        ) : (
          <p className="muted small">生命与魔力跨战斗继承；恢复比例按各自意志计算，封顶 100%。</p>
        )}
      </div>

      {isCrisis && crisisRest && (
        <div className="card">
          <b>选择一项加成（仅本次危机合约生效）</b>
          <div className="term-grid">
            {crisisRest.options.map((o) => (
              <label
                key={o.id}
                className={`term-card ${selectedBuff === o.id ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="crisisBuff"
                  checked={selectedBuff === o.id}
                  onChange={() => setSelectedBuff(o.id)}
                />
                <div className="term-name">{o.name}</div>
                <div className="term-desc muted small">{o.desc}</div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
