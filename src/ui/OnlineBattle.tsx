// 联机战斗界面：复用单人战斗 UI（OrderBar/UnitCard/Modal + battle-page CSS），服务器权威推进
// 交互完全对齐单人版 Battle：被动不显示、自动目标技能直接释放、先选技能再选目标、虚化增强、道具、BOSS 血条
import { useEffect, useRef, useState } from 'react';
import { C2S, S2C } from '../net/proto';
import type { BattleView, LegalItemView, LegalSkillView, PopupView } from '../net/proto';
import { online } from '../net/online';
import { OrderBar } from '../components/battle/OrderBar';
import { UnitCard } from '../components/battle/StatBar';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';
import type { Combatant, LogEntry } from '../types';
import { currentActor } from '../engine/battle';
import { BUFF_LIBRARY } from '../engine/buffs';

interface Props {
  onMap: () => void;
}

type Pending =
  | { kind: 'attack' }
  | { kind: 'skill'; ls: LegalSkillView; enhance: boolean }
  | { kind: 'item'; li: LegalItemView };

function logTextOf(l: LogEntry): string {
  if ('text' in l) return l.text;
  const tag = ({ buff: '增益', damage: '伤害', heal: '回复', shield: '护盾', stun: '眩晕', break: '部位损毁', survive: '幸存', info: '情报', vfx: '特效' } as Record<string, string>)[l.t] ?? l.t;
  return `【${tag}】`;
}

export default function OnlineBattle({ onMap }: Props) {
  const [b, setB] = useState<BattleView | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState('');
  const [infoUid, setInfoUid] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off1 = online.on(S2C.battleView, (d) => { setB(d as BattleView); setToast(''); setPending(null); });
    const off2 = online.on(S2C.runState, (d) => {
      const r = d as { phase: string };
      if (r.phase !== 'battle') onMap();
    });
    const off3 = online.on(S2C.result, () => onMap());
    const off4 = online.on(S2C.err, (d) => setToast((d as { text: string }).text ?? '操作失败'));
    // 挂载即请求当前战斗/副本状态（切视图会错过初始广播，需主动拉取）
    online.emit(C2S.runSync, {});
    return () => { off1(); off2(); off3(); off4(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [b?.full?.log.length]);

  if (!b || !b.full) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1020', color: '#8fa0c8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        战斗加载中…
      </div>
    );
  }

  const s = b.full;
  const actor = currentActor(s);
  const popup = b.popup;
  const legal = b.myLegal;
  const isMyTurn = !!actor && actor.side === 'ally' && !!b.myUnits?.includes(actor.uid) && !popup && !b.result;
  const canResolve = popup && popup.ownerPlayerId === online.myPlayerId;
  const waitingText = popup
    ? (canResolve ? '请处理弹窗抉择' : `等待队友处理【${popup.title}】…`)
    : b.result
      ? (b.result === 'win' ? '战斗胜利！' : '战斗失败…')
      : actor
        ? (isMyTurn ? `轮到 ${actor.name} 行动` : `等待 ${actor.name} 行动…`)
        : '战斗进行中…';

  const act = (action: { type: 'attack'; targetUid: string } | { type: 'skill'; skillId: string; targetUid?: string; enhance?: boolean } | { type: 'item'; itemId: string; targetUid: string }) => {
    online.emit(C2S.battleAct, { action });
    setPending(null);
  };

  const resolve = (kind: PopupView['kind'], opt: { id?: string; form?: 'red' | 'blue'; accept?: boolean; stat?: string }) => {
    online.emit(C2S.battleResolve, { kind, optionId: opt.id, form: opt.form, accept: opt.accept, stat: opt.stat, allyUid: b.myAllyUid ?? undefined });
  };

  const infoUnit = (uid: string): Combatant | undefined =>
    s.allies.find((a) => a.uid === uid) ?? s.enemies.find((e) => e.uid === uid);

  // 目标高亮（与单人版同规则：普攻=存活敌人；技能=技能合法目标；道具=道具目标）
  const targetUids = pending
    ? pending.kind === 'item'
      ? pending.li.targetUids
      : pending.kind === 'skill'
        ? (pending.ls.targetUids ?? [])
        : s.enemies.filter((u) => u.alive).map((u) => u.uid)
    : [];
  const isTarget = (uid: string) => targetUids.includes(uid);

  // BOSS 血条（对齐单人版：多部位 BOSS 取核心部位）
  const bossEntries: { uid: string; name: string; hp: number; maxHp: number; multi: boolean; tag?: string }[] = [];
  const enemyGroups: { bossId?: string; units: typeof s.enemies }[] = [];
  for (const u of s.enemies) {
    if (u.bossId) {
      let g = enemyGroups.find((x) => x.bossId === u.bossId);
      if (!g) { g = { bossId: u.bossId, units: [] }; enemyGroups.push(g); }
      g.units.push(u);
    } else {
      enemyGroups.push({ units: [u] });
    }
  }
  for (const g of enemyGroups) {
    if (g.bossId) {
      const core = g.units.find((u) => u.isCore) ?? g.units[0];
      if (core) {
        bossEntries.push({
          uid: core.uid,
          name: core.name.split('·')[0],
          hp: Math.max(0, Math.ceil(core.hp)),
          maxHp: core.maxHp,
          multi: g.units.length > 1,
        });
      }
    } else {
      const u = g.units[0];
      if (u.monsterId === 'yingLong' || u.monsterId === 'ct_079') {
        bossEntries.push({
          uid: u.uid,
          name: u.name,
          hp: Math.max(0, Math.ceil(u.hp)),
          maxHp: u.maxHp,
          multi: false,
          tag: `葬花针 ${u.crisis?.yinglong?.needle ?? '??'}`,
        });
      }
    }
  }

  const fireSkill = (ls: LegalSkillView, enhance: boolean) => {
    if (ls.disabled) return;
    if (ls.targetUids === null) {
      act({ type: 'skill', skillId: ls.id, enhance });
    } else {
      setPending({ kind: 'skill', ls, enhance });
    }
  };

  const fireItem = (li: LegalItemView) => {
    setPending({ kind: 'item', li });
  };

  return (
    <div className="battle-page">
      <OrderBar state={s} />

      <div className="battle-field">
        {bossEntries.length > 0 && (
          <div className="boss-hp-bar-area">
            {bossEntries.map((boss, idx) => {
              const pct = boss.maxHp > 0 ? Math.max(0, (boss.hp / boss.maxHp) * 100) : 0;
              return (
                <div key={boss.uid} className={`boss-hp-bar ${boss.multi ? 'boss-hp-multi' : ''}`} style={{ animationDelay: `${idx * 60}ms` }}>
                  <div className="boss-hp-name">
                    <span className="boss-hp-crown">♛</span>
                    {boss.name}
                    {boss.tag && <span className="boss-hp-tag">{boss.tag}</span>}
                    {boss.multi && <span className="boss-hp-tag">多部位</span>}
                  </div>
                  <div className="boss-hp-track">
                    <div className="boss-hp-fill" style={{ width: `${pct}%` }} />
                    <span className="boss-hp-text">{boss.hp} / {boss.maxHp}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="battle-side battle-allies">
          {s.allies.map((u) => (
            <UnitCard
              key={u.uid}
              u={u}
              active={isMyTurn && actor.uid === u.uid}
              dead={!u.alive}
              floats={[]}
              onInfo={() => setInfoUid(u.uid)}
              selectable={!!pending && (pending.kind === 'item' || pending.kind === 'skill') && isTarget(u.uid)}
              onClick={() => {
                if (!pending) return;
                if (pending.kind === 'item') act({ type: 'item', itemId: pending.li.itemId, targetUid: u.uid });
                else if (pending.kind === 'skill') act({ type: 'skill', skillId: pending.ls.id, targetUid: u.uid, enhance: pending.enhance });
              }}
            />
          ))}
        </div>

        <div className="vs-mark">VS</div>

        <div className="battle-side battle-enemies">
          {enemyGroups.map((g, gi) =>
            g.bossId ? (
              <div className="boss-group" key={g.bossId}>
                <Sprite className="boss-img" src={g.units[0].icon} alt={g.units[0].name} />
                <div className="boss-parts-col">
                  {g.units.map((u) => (
                    <UnitCard
                      key={u.uid}
                      u={u}
                      small
                      active={!b.result && actor.uid === u.uid}
                      dead={!u.alive}
                      floats={[]}
                      onInfo={() => setInfoUid(u.uid)}
                      selectable={!!pending && pending.kind !== 'item' && isTarget(u.uid)}
                      onClick={() => {
                        if (!pending || pending.kind === 'item') return;
                        if (pending.kind === 'attack') act({ type: 'attack', targetUid: u.uid });
                        else act({ type: 'skill', skillId: pending.ls.id, targetUid: u.uid, enhance: pending.enhance });
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <UnitCard
                key={`${gi}_${g.units[0].uid}`}
                u={g.units[0]}
                active={!b.result && actor.uid === g.units[0].uid}
                dead={!g.units[0].alive}
                floats={[]}
                onInfo={() => setInfoUid(g.units[0].uid)}
                selectable={!!pending && pending.kind !== 'item' && isTarget(g.units[0].uid)}
                onClick={() => {
                  const u = g.units[0];
                  if (!pending || pending.kind === 'item') return;
                  if (pending.kind === 'attack') act({ type: 'attack', targetUid: u.uid });
                  else act({ type: 'skill', skillId: pending.ls.id, targetUid: u.uid, enhance: pending.enhance });
                }}
              />
            ),
          )}
        </div>
      </div>

      <div className="battle-bottom">
        <div className="log-panel" ref={logRef}>
          {s.log.slice(-40).map((e, i) => <div key={i} className="log-line">{logTextOf(e)}</div>)}
        </div>

        <div className="action-panel">
          {isMyTurn ? (
            pending ? (
              <>
                <div className="target-tip">
                  {pending.kind === 'item' ? '选择一名我方单位' : '选择目标'}
                </div>
                <button className="btn" onClick={() => setPending(null)}>返回</button>
              </>
            ) : (
              <>
                <div className="actor-tip">轮到【{actor.name}】行动</div>
                <div className="action-btns">
                  <button
                    className="btn"
                    disabled={!legal?.canAttack}
                    title={legal?.attackAll ? '普攻对敌方全体生效' : undefined}
                    onClick={() => {
                      if (!legal) return;
                      if (legal.attackAll) {
                        const first = s.enemies.find((u) => u.alive);
                        if (first) act({ type: 'attack', targetUid: first.uid });
                      } else {
                        setPending({ kind: 'attack' });
                      }
                    }}
                  >
                    普攻{legal?.attackAll ? <span className="btn-sub">群攻</span> : null}
                  </button>
                  {(legal?.skills ?? []).map((ls) => {
                    const hasEnhance = !!ls.enhance && ls.enhance.mpCost > 0;
                    const enhanceMpCost = ls.enhance?.mpCost ?? 0;
                    const enhanceKamuiCost = ls.enhance?.kamuiCost ?? 0;
                    const baseMp = ls.mpCost ?? 0;
                    const enhanceMpOk = actor.mp >= baseMp + enhanceMpCost;
                    const enhanceKamuiOk = (actor.kamuiUses ?? 0) >= enhanceKamuiCost;
                    const enhanceDisabled = ls.disabled || !enhanceMpOk || !enhanceKamuiOk;
                    const enhanceReason = !enhanceMpOk
                      ? `需${baseMp + enhanceMpCost}MP`
                      : !enhanceKamuiOk
                        ? `需${enhanceKamuiCost}次虚化`
                        : ls.reason;
                    return (
                      <div key={ls.id} className="skill-row">
                        <button
                          className="btn skill-btn"
                          disabled={ls.disabled}
                          title={ls.desc}
                          onClick={() => fireSkill(ls, false)}
                        >
                          {ls.name}
                          <span className="btn-sub">
                            {ls.disabled ? ls.reason : (ls.costText ?? '—')}
                          </span>
                        </button>
                        {hasEnhance && (
                          <button
                            className="btn skill-btn enhance-btn"
                            disabled={enhanceDisabled}
                            title={`${ls.name} · 虚化增强\n额外消耗 ${enhanceMpCost}MP 与 ${enhanceKamuiCost}次虚化，倍率+${Math.round((ls.enhance?.mulBonus ?? 0) * 100)}%`}
                            onClick={() => fireSkill(ls, true)}
                          >
                            虚化增强
                            <span className="btn-sub">
                              {enhanceDisabled ? enhanceReason : `+${enhanceMpCost}MP ${enhanceKamuiCost}虚化`}
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {(legal?.items ?? []).map((li) => (
                    <button key={li.itemId} className="btn skill-btn" onClick={() => fireItem(li)}>
                      {li.name}<span className="btn-sub">×{li.count}</span>
                    </button>
                  ))}
                </div>
              </>
            )
          ) : (
            <div className="actor-tip">{waitingText}</div>
          )}
          {toast && <div className="actor-tip" style={{ color: '#ff8f6b' }}>{toast}</div>}
        </div>
      </div>

      {popup && canResolve && (
        <Modal title={popup.title} onClose={() => {}}>
          <div style={{ color: '#c8b8e0', fontSize: 13, marginBottom: 12 }}>{popup.desc}</div>
          <div className="modal-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {popup.options.map((o) => (
              <button key={o.id} className="btn" style={{ textAlign: 'left' }} onClick={() => resolve(popup.kind, { id: o.id, form: o.id as 'red', accept: o.id === 'yes', stat: o.id })}>
                {o.label}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {popup && !canResolve && (
        <div className="modal-mask">
          <div className="modal">
            <div className="modal-head"><h3>{popup.title}</h3></div>
            <div className="modal-body">
              <div style={{ color: '#8fa0c8', fontSize: 13 }}>等待队友处理弹窗…</div>
            </div>
          </div>
        </div>
      )}

      {infoUid && (() => {
        const u = infoUnit(infoUid);
        if (!u) return null;
        return (
          <Modal title={u.name} onClose={() => setInfoUid(null)}>
            <div className="unit-info-flex">
              <Sprite className="unit-info-portrait" src={u.icon} alt={u.name} />
              <div>
                <div className="unit-info-roll">
                  HP {Math.ceil(u.hp)}/{u.maxHp} · MP {Math.ceil(u.mp)}/{u.maxMp}
                </div>
                <div>攻击 {u.stats.atk} · 防御 {u.stats.def} · 法抗 {u.stats.mres}</div>
                <div>速度 {u.stats.spdMin}-{u.stats.spdMax}</div>
                {u.shield > 0 && <div>护盾 {u.shield}</div>}
              </div>
            </div>
            <div className="unit-info-buffs">
              {(u.buffs ?? []).map((buf) => (
                <span key={buf.id} className="buff-chip">{BUFF_LIBRARY[buf.id]?.name ?? buf.id}{buf.stacks > 1 ? `×${buf.stacks}` : ''}</span>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setInfoUid(null)}>关闭</button>
            </div>
          </Modal>
        );
      })()}

      {b.result && (
        <Modal title={b.result === 'win' ? '战斗胜利！' : '战斗失败…'} onClose={() => {}}>
          <div className="modal-actions">
            <button className="btn primary" onClick={onMap}>返回地图</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
