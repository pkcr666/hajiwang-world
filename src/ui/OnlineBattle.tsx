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
import { BUFF_LIBRARY, addBuff, computeDamageMods, effDefBuffed, effSpd } from '../engine/buffs';
import { useDragScroll } from '../hooks/useDragScroll';
import { effAtk } from '../engine/damage';
import { spdText } from './labels';

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
  const [showFullLog, setShowFullLog] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const fullLogRef = useRef<HTMLDivElement>(null);
  // 行动按钮横向拖拽滚动（鼠标拖拽/触摸滑动）
  const actionScroll = useDragScroll<HTMLDivElement>();

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

  // 完整日志弹窗打开时：滚动到最新一条；战斗中产生新日志也跟随
  useEffect(() => {
    if (showFullLog) fullLogRef.current?.scrollTo({ top: fullLogRef.current.scrollHeight });
  }, [showFullLog, b?.full?.log.length]);

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
        <div className="log-panel-wrap">
          <div className="log-panel-head">
            <span>战斗日志</span>
            <button className="log-more-btn" onClick={() => setShowFullLog(true)}>完整日志（{s.log.length}）</button>
          </div>
          <div className="log-panel" ref={logRef}>
            {s.log.slice(-40).map((e, i) => <div key={i} className="log-line">{logTextOf(e)}</div>)}
          </div>
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
                <div className="action-btns" ref={actionScroll}>
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

      {popup && popup.kind === 'reaction' && (() => {
        const pr = popup.reaction!;
        const attacker = [...s.allies, ...s.enemies].find((x) => x.uid === pr.attackerUid);
        const target = s.allies.find((x) => x.uid === pr.targetUid);
        const rsk = target?.skills?.find((x) => x.id === pr.skillId);
        if (!attacker || !target || !rsk?.reaction) return null;
        const rx = rsk.reaction;
        const choose = (accept: boolean) => resolve('reaction', { accept });
        return (
          <Modal title={`${rsk.name}？`} onClose={() => (canResolve ? choose(false) : undefined)}>
            <p>【{attacker.name}】即将攻击【{target.name}】，是否使用「{rsk.name}」？</p>
            {rx.mode === 'kamui' ? (
              <p className="muted small">
                消耗 {rsk.mpCost} MP 与 1 次虚化次数（剩余 {target.kamuiUses ?? 0} 次），
                无效本次攻击并获得强壮增益。
              </p>
            ) : (
              (() => {
                const cur = attacker.buffs.find((b) => b.id === rx.buffId)?.stacks ?? 0;
                const canStack = cur < (rx.maxStacks ?? 1);
                const atkNow = effAtk(attacker);
                const defNow = effDefBuffed(attacker);
                const sim = structuredClone(attacker);
                addBuff(sim, rx.buffId!, 1, rx.intensity ?? 1);
                const atkAfter = effAtk(sim);
                const defAfter = effDefBuffed(sim);
                return (
                  <>
                    <p className="muted small">
                      消耗 {rsk.mpCost} MP：{attacker.name} 攻击、防御各-5%/层并减强度值
                      （当前 {cur} 层 · 上限 {rx.maxStacks ?? 1} 层）
                    </p>
                    <div className="huff-stats">
                      <div className="huff-row">
                        <span>当前攻击力</span>
                        <b>{atkNow}</b>
                        <span className="huff-arrow">→</span>
                        <b className={canStack ? 'huff-after' : 'huff-same'}>{atkAfter}</b>
                      </div>
                      <div className="huff-row">
                        <span>当前防御力</span>
                        <b>{defNow}</b>
                        <span className="huff-arrow">→</span>
                        <b className={canStack ? 'huff-after' : 'huff-same'}>{defAfter}</b>
                      </div>
                      {!canStack && (
                        <p className="muted small">已达 {rx.maxStacks ?? 1} 层上限，本次哈气不会进一步削弱。</p>
                      )}
                    </div>
                  </>
                );
              })()
            )}
            <div className="modal-actions">
              {canResolve ? (
                <>
                  <button className="btn primary" onClick={() => choose(true)}>
                    {rx.mode === 'kamui' ? '虚化！' : `${rsk.name}！`}
                  </button>
                  <button className="btn" onClick={() => choose(false)}>
                    {rx.mode === 'kamui' ? '不闪避' : `不${rsk.name}`}
                  </button>
                </>
              ) : (
                <p className="muted small" style={{ color: '#8fa0c8' }}>等待队友处理弹窗…</p>
              )}
            </div>
          </Modal>
        );
      })()}

      {popup && popup.kind === 'brokenArk' && (() => {
        const pb = popup.brokenArk!;
        const target = s.allies.find((x) => x.uid === pb.targetUid);
        const ba = target?.weaponBrokenArk;
        if (!target || !ba) return null;
        const reduced = Math.floor(pb.toHp * (1 - ba.dmgRedPct));
        const choose = (accept: boolean) => resolve('brokenArk', { accept });
        return (
          <Modal title="破碎方舟" onClose={() => (canResolve ? choose(false) : undefined)}>
            <p>【{target.name}】即将受到 <b>{pb.toHp}</b> 点伤害，是否启动「破碎方舟」？</p>
            <p className="muted small">
              消耗 {ba.mpCost} MP（当前 {target.mp}/{target.maxMp}）：抵消 {Math.round(ba.dmgRedPct * 100)}% 伤害
              （{pb.toHp} → {reduced}），并获得 {ba.buffStacks} 层强壮（强度 {ba.buffIntensity}，+{ba.buffIntensity * 10}% 增伤）。
            </p>
            <p className="muted small">
              强壮强度固定为 {ba.buffIntensity}，多次触发仅累加回合数，不会继续上涨。
            </p>
            <div className="modal-actions">
              {canResolve ? (
                <>
                  <button className="btn primary" onClick={() => choose(true)}>启动方舟！</button>
                  <button className="btn" onClick={() => choose(false)}>硬抗</button>
                </>
              ) : (
                <p className="muted small" style={{ color: '#8fa0c8' }}>等待队友处理弹窗…</p>
              )}
            </div>
          </Modal>
        );
      })()}

      {popup && canResolve && popup.kind !== 'reaction' && popup.kind !== 'brokenArk' && (
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

      {popup && !canResolve && popup.kind !== 'reaction' && popup.kind !== 'brokenArk' && (
        <div className="modal-mask">
          <div className="modal">
            <div className="modal-head"><h3>{popup.title}</h3></div>
            <div className="modal-body">
              <div style={{ color: '#8fa0c8', fontSize: 13 }}>等待队友处理弹窗…</div>
            </div>
          </div>
        </div>
      )}

      {showFullLog && (
        <Modal title={`完整战斗日志 · 共 ${s.log.length} 条`} onClose={() => setShowFullLog(false)}>
          <div className="full-log-panel" ref={fullLogRef}>
            {s.log.map((e, i) => <div key={i} className="log-line">{logTextOf(e)}</div>)}
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setShowFullLog(false)}>关闭</button>
          </div>
        </Modal>
      )}

      {infoUid && (() => {
        const u = infoUnit(infoUid);
        if (!u) return null;
        const base = u.baseSnapshot;
        const bStats = base?.stats;
        const curAtk = effAtk(u);
        const curDef = effDefBuffed(u);
        const curMres = u.stats.mres;
        const curSpd = effSpd(u);
        const mods = computeDamageMods(u);
        const relicMods = u.relicMods ?? {};
        const d = (cur: number, baseVal?: number) => {
          if (baseVal === undefined || cur === baseVal) return null;
          const diff = cur - baseVal;
          return diff > 0
            ? <i className="bp-relic-delta" style={{ color: '#2e7d32' }}>+{diff}</i>
            : <i className="bp-relic-delta" style={{ color: '#c62828' }}>{diff}</i>;
        };
        const dpct = (cur: number, baseVal?: number) => {
          if (baseVal === undefined || cur === baseVal) return null;
          const diff = Math.round((cur - baseVal) * 100);
          return diff > 0
            ? <i className="bp-relic-delta" style={{ color: '#2e7d32' }}>+{diff}%</i>
            : <i className="bp-relic-delta" style={{ color: '#c62828' }}>{diff}%</i>;
        };
        const six: [string, number | undefined, number | undefined][] = [
          ['力量', u.str, base?.str],
          ['智力', u.int, base?.int],
          ['敏捷', u.agi, base?.agi],
          ['幸运', u.luk, base?.luk],
          ['魅力', u.cha, base?.cha],
          ['意志', u.wil, base?.wil],
        ];
        const modRows: [string, number, number | undefined][] = [
          ['全能增伤', mods.allDmgAmp, relicMods.allDmgAmp],
          ['真实增伤', mods.trueDmgAmp, relicMods.trueDmgAmp],
          ['物理增伤', mods.physDmgAmp, relicMods.physDmgAmp],
          ['法术增伤', mods.magicDmgAmp, relicMods.magicDmgAmp],
          ['全能减伤', mods.allDmgRed, relicMods.allDmgRed],
          ['真实减伤', mods.trueDmgRed, relicMods.trueDmgRed],
          ['物理减伤', mods.physDmgRed, relicMods.physDmgRed],
          ['法术减伤', mods.magicDmgRed, relicMods.magicDmgRed],
        ];
        return (
          <Modal title={u.name} onClose={() => setInfoUid(null)}>
            <div className="unit-info-flex">
              <Sprite className="unit-info-portrait" src={u.icon} alt={u.name} />
              <div className="unit-info-roll">
                本回合速度掷点：<b>{u.roll}</b>
                <span className="muted small">（基础 {spdText(u.stats.spdMin, u.stats.spdMax)}，同速判定 {u.tieBreak}）</span>
              </div>
            </div>
            <h4>基础属性<span className="muted small">（局外面板含遗物，绿+红-为局内变化）</span></h4>
            <div className="stat-grid unit-info-grid">
              <span>生命 <b>{u.maxHp}</b>{d(u.maxHp, bStats?.hp)}</span>
              <span>魔力 <b>{u.maxMp}</b>{d(u.maxMp, bStats?.mp)}</span>
              <span>攻击 <b>{curAtk}</b>{d(curAtk, bStats?.atk)}</span>
              <span>防御 <b>{curDef}</b>{d(curDef, bStats?.def)}</span>
              <span>法抗 <b>{curMres}%</b>{d(curMres, bStats?.mres)}</span>
              <span>速度 <b>{spdText(curSpd.min, curSpd.max)}</b>{d(curSpd.max, bStats?.spdMax)}</span>
            </div>
            <h4>额外6维</h4>
            <div className="stat-grid unit-info-grid">
              {six.map(([label, cur, bv]) => (
                <span key={label}>{label} <b>{cur ?? 0}</b>{d(cur ?? 0, bv)}</span>
              ))}
            </div>
            <h4>增伤 / 减伤</h4>
            <div className="stat-grid unit-info-grid bp-mod-grid">
              {modRows.map(([label, cur, bv]) => (
                <span key={label}>{label} <b>{Math.round(cur * 100)}%</b>{dpct(cur, bv)}</span>
              ))}
            </div>
            {u.buffs.length > 0 && (
              <>
                <h4>当前 BUFF</h4>
                <div className="unit-info-buffs">
                  {u.buffs.map((b, i) => {
                    const def = BUFF_LIBRARY[b.id];
                    return (
                      <span key={i} className="buff-tag" title={def?.desc ?? b.id}>
                        {def?.name ?? b.id} ×{b.stacks}
                        {b.intensity > 1 ? `(强度${b.intensity})` : ''}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
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
