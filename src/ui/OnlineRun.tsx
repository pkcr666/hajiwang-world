// 联机副本界面：共享地图 + 全员投票（移动/事件/掉落）+ 日志 + 结算 + 个人背包（服务端权威，对齐单人版）
import { useEffect, useMemo, useRef, useState } from 'react';
import { C2S, S2C } from '../net/proto';
import type { BagView, EventView, PersonalView, ResultView, RunView, VoteView } from '../net/proto';
import { online } from '../net/online';
import { loadSave, saveSave } from '../save/storage';
import { Modal } from '../components/Modal';
import { Sprite } from '../components/Sprite';
import { MONSTER_IMAGES, itemIcon } from '../assets/config';
import { RARITY_COLORS, RARITY_LABELS, SLOT_LABELS } from './labels';
import { itemMapOf } from '../data/content';
import { haggleLabel, merchantSellPrice, potionSellPrice } from '../engine/nodes';
import { torchEdgeKey } from '../engine/run';
import { OnlineBag } from './OnlineBag';

interface Props {
  onBattle: () => void;
  onBack: () => void;
}

const KIND_LABEL: Record<string, string> = {
  combat: '作战', boss: 'BOSS', encounter: '不期而遇', rest: '休息', merchant: '行商',
  trade: '交易', skirmish: '狭路相逢', recruit: '王牌招募', altar: '祭坛', fate: '命运', sub: '子层',
};

// 投票截止倒计时：独立小组件自持定时器，避免顶层每秒重渲染整棵树
function Deadline({ at }: { at?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = at ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
  return <span style={{ color: left !== null && left <= 10 ? '#ff8f6b' : '#8fa0c8' }}>{left !== null ? `⏳ ${left}s` : ''}</span>;
}

export default function OnlineRun({ onBattle, onBack }: Props) {
  const [run, setRun] = useState<RunView | null>(null);
  const [vote, setVote] = useState<VoteView | null>(null);
  const [event, setEvent] = useState<EventView | null>(null);
  const [personal, setPersonal] = useState<PersonalView | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [toast, setToast] = useState('');
  const [written, setWritten] = useState(false);
  const [rollMsg, setRollMsg] = useState('');
  const [showBag, setShowBag] = useState(false);
  const [bag, setBag] = useState<BagView | null>(null);
  const submittedRef = useRef(new Set<string>());

  useEffect(() => {
    const off1 = online.on(S2C.runState, (d) => {
      const r = d as RunView;
      setRun(r);
      if (r.phase === 'battle') onBattle();
    });
    const off2 = online.on(S2C.voteStart, (d) => { setVote(d as VoteView); });
    const off3 = online.on(S2C.voteUpdate, (d) => { setVote(d as VoteView); });
    const off4 = online.on(S2C.voteResult, (d) => {
      const r = d as { rolling?: boolean; choiceId?: string; rolledBy?: string };
      if (r.rolling) { setRollMsg('🎲 所有玩家已选择，正在随机…'); return; }
      setVote(null);
      setRollMsg(r.rolledBy ? `🎲 采纳了【${r.rolledBy}】的选择` : '');
    });
    const off5 = online.on(S2C.eventView, (d) => { setEvent(d as EventView); });
    const off6 = online.on(S2C.personalView, (d) => { setPersonal(d as PersonalView); });
    const off7 = online.on(S2C.err, (d) => setToast((d as { text: string }).text ?? '操作失败'));
    const off8 = online.on(S2C.result, (d) => { setResult(d as ResultView); setVote(null); });
    const off9 = online.on(S2C.bagView, (d) => setBag(d as BagView));
    // 挂载即请求当前副本状态（切视图会错过初始广播，需主动拉取）
    online.emit(C2S.runSync, {});
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off7(); off8(); off9(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hooks 必须在任何条件 return 之前无条件调用，否则 React 渲染报错（进入副本后黑屏）
  const itemMap = useMemo(() => {
    try { return itemMapOf(loadSave()); } catch { return new Map<string, never>(); }
  }, []);

  if (!run) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1020', color: '#8fa0c8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
        等待房间状态…（<button onClick={onBack} style={{ background: 'none', border: '1px solid #3a4a7c', color: '#c8d2ea', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>返回大厅</button>）
      </div>
    );
  }

  const s: Record<string, React.CSSProperties> = {
    wrap: { minHeight: '100vh', background: 'radial-gradient(1200px 600px at 20% 0%, #1d2b53 0%, #0b1020 55%, #060a14 100%)', color: '#e8ecf5', padding: 16, fontFamily: 'inherit' },
    bar: { display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', background: 'rgba(20,28,54,.82)', border: '1px solid rgba(140,165,255,.25)', borderRadius: 12, marginBottom: 12, flexWrap: 'wrap', fontSize: 13 },
    map: { position: 'relative', background: 'rgba(10,16,34,.7)', border: '1px solid rgba(140,165,255,.2)', borderRadius: 14, padding: '28px 18px', minHeight: 300 },
    node: { position: 'absolute', transform: 'translate(-50%,-50%)', width: 104, padding: '8px 4px', textAlign: 'center', borderRadius: 10, fontSize: 12, cursor: 'default', border: '1px solid #2c3a68', background: '#121a36', color: '#9fb0d8' },
    nodeAvail: { position: 'absolute', transform: 'translate(-50%,-50%)', width: 104, padding: '8px 4px', textAlign: 'center', borderRadius: 10, fontSize: 12, cursor: 'pointer', border: '1px solid #ffc46b', background: 'linear-gradient(135deg,#3d2f14,#241a0c)', color: '#ffd9a0', boxShadow: '0 0 12px rgba(255,196,107,.25)' },
    nodeCur: { border: '1px solid #3ddc84', boxShadow: '0 0 10px rgba(61,220,132,.4)' },
    nodeDone: { opacity: 0.45 },
    vote: { marginTop: 12, background: 'rgba(30,40,76,.9)', border: '1px solid rgba(140,165,255,.3)', borderRadius: 12, padding: 16 },
    opt: { display: 'block', width: '100%', textAlign: 'left', background: '#0d1326', border: '1px solid #2c3a68', color: '#e8ecf5', borderRadius: 8, padding: '10px 12px', marginBottom: 8, fontSize: 14, cursor: 'pointer' },
    optSel: { border: '1px solid #ffc46b', background: '#241a0c', color: '#ffd9a0' },
    log: { marginTop: 12, background: 'rgba(10,16,34,.7)', border: '1px solid rgba(140,165,255,.2)', borderRadius: 12, padding: 12, fontSize: 12, color: '#aab8d8', maxHeight: 180, overflowY: 'auto' },
    hp: { background: 'rgba(255,255,255,.06)', borderRadius: 8, padding: '6px 10px', display: 'inline-block' },
  };

  const myCharId = run.bindings[online.myPlayerId];
  const myHp = myCharId ? run.hpMp[myCharId] : undefined;
  const myRelics = myCharId ? run.perRelics[myCharId] ?? [] : [];
  const clearedSet = new Set(run.cleared ?? []);
  const nodeStates = run.nodeStates ?? {};
  const submitted = vote ? submittedRef.current.has(vote.voteId) : false;

  // 单人地图同款坐标/类型映射（640x360 画布，节点 96x56）
  const xOf = (n: RunView['nodes'][number]) => {
    const c = Math.max(1, run.cols ?? 1);
    return c === 1 ? 272 : 64 + ((n.col ?? 0) / (c - 1)) * (640 - 128);
  };
  const yOf = (n: RunView['nodes'][number]) => {
    const r = Math.max(1, run.rows ?? 1);
    return r === 1 ? 152 : 56 + ((n.row ?? 0) / (r - 1)) * (360 - 112);
  };
  const kindCls = (k: string) => {
    if (k === 'encounter' || k === 'trade' || k === 'fate') return 'visitor';
    if (k === 'sub') return 'combat';
    return k;
  };

  const submit = (optionId: string) => {
    if (!vote) return;
    submittedRef.current.add(vote.voteId);
    online.emit(C2S.voteSubmit, { choiceId: optionId });
  };

  // 把联机结算中属于「我」的收获写回本地存档
  const writeBack = () => {
    if (!result || written) return;
    const me = result.perPlayer.find((p) => p.playerId === online.myPlayerId);
    if (!me) return;
    const charId = run?.bindings[online.myPlayerId];
    if (!charId) { setToast('未找到我的角色，无法写回'); return; }
    const s = loadSave();
    const c = s.characters.find((x) => x?.id === charId);
    if (!c) { setToast('本地存档中未找到该角色，无法写回'); return; }
    c.coins = Math.max(0, Math.floor((c.coins ?? 0) + me.coins));
    const storage = [...(c.storage ?? [])];
    for (const m of me.materials) {
      const f = storage.find((g) => g.itemId === m.itemId);
      if (f) f.count += m.count;
      else storage.push({ itemId: m.itemId, count: m.count });
    }
    for (const id of me.itemIds) {
      const f = storage.find((g) => g.itemId === id);
      if (f) f.count += 1;
      else storage.push({ itemId: id, count: 1 });
    }
    c.storage = storage;
    saveSave(s);
    setWritten(true);
    setToast('✅ 已写入本地存档');
  };

  return (
    <div style={s.wrap}>
      <div style={s.bar}>
        <b style={{ fontSize: 16 }}>{run.dungeonId === 'starterVillage' ? '新手村（终局联系）' : run.dungeonName}</b>
        <span style={{ color: '#ffc46b', fontSize: 12 }}>副本</span>
        <span style={{ color: '#8fa0c8' }}>{run.actLabel}</span>
        {myHp && <span style={s.hp}>HP {myHp.hp} / MP {myHp.mp}</span>}
        <span style={s.hp}>哈哈币 {run.coins}</span>
        <span style={s.hp}>火把 {run.torches}</span>
        {run.relics.length > 0 && <span style={s.hp}>队伍遗物：{run.relics.length} 件</span>}
        {myRelics.length > 0 && <span style={s.hp}>我的遗物：{myRelics.length} 件</span>}
        <button onClick={() => { setShowBag(true); setBag(null); online.emit(C2S.bagOpen, {}); }} style={{ background: 'rgba(61,220,132,.15)', border: '1px solid #3ddc84', color: '#3ddc84', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}>我的背包</button>
        <button onClick={onBack} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #3a4a7c', color: '#c8d2ea', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>返回大厅</button>
      </div>

      {/* 地图（复用单人副本地图 UI） */}
      <div className="map-wrap card" style={{ overflow: 'hidden' }}>
        <div className="map-canvas" style={{ width: 640, height: 360 }}>
          <svg className="map-lines" width={640} height={360}>
            {(run.edges ?? []).map((e) => {
              const a = run.nodes.find((n) => n.id === e.from);
              const b = run.nodes.find((n) => n.id === e.to);
              if (!a || !b) return null;
              // 火把线：同列上下相邻节点的竖线，标注方向（↑上 / ↓下），避免同名节点分不清
              if (e.torch) {
                const key = torchEdgeKey(e.from, e.to);
                const lit = (run.openedEdges ?? []).includes(key);
                const x = xOf(a) + 48;
                const yMid = (yOf(a) + yOf(b)) / 2 + 28;
                const downward = yOf(a) < yOf(b); // a 在上、b 在下
                return (
                  <g key={`torch_${key}`}>
                    <line
                      x1={x} y1={yOf(a) + 28}
                      x2={x} y2={yOf(b) + 28}
                      className={`map-edge map-edge-torch ${lit ? 'on' : ''}`} />
                    {!lit && (
                      <text x={x + 5} y={yMid} fill="#ffc46b" fontSize={12} fontWeight={700}>
                        {downward ? '↓下' : '↑上'}
                      </text>
                    )}
                  </g>
                );
              }
              return (
                <line key={e.from + e.to}
                  x1={xOf(a) + 48} y1={yOf(a) + 28}
                  x2={xOf(b) + 48} y2={yOf(b) + 28}
                  className={`map-edge ${clearedSet.has(e.from) ? 'on' : ''}`} />
              );
            })}
          </svg>
          {run.nodes.map((n) => {
            const avail = (run.available ?? []).includes(n.id);
            const isCur = run.currentNodeId === n.id;
            const done = clearedSet.has(n.id) || nodeStates[n.id]?.used;
            const clickable = avail && vote?.kind === 'move';
            const cls = [
              'map-node',
              `map-node-${kindCls(n.kind)}`,
              isCur ? 'is-current' : '',
              done ? 'is-cleared' : avail ? 'is-open' : 'is-locked',
            ].filter(Boolean).join(' ');
            return (
              <button key={n.id} className={cls} style={{ left: xOf(n), top: yOf(n), width: 96, height: 56 }}
                disabled={!clickable} title={KIND_LABEL[n.kind] ?? n.kind}
                onClick={clickable ? () => submit(n.id) : undefined}>
                <span className="map-node-tag">{KIND_LABEL[n.kind] ?? n.kind}{n.urgent ? '⚡' : ''}</span>
                {done && <span className="map-node-done">✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 事件文本 */}
      {event && (
        <div style={{ ...s.vote, borderColor: '#6a4cff' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{event.name}</div>
          <div style={{ color: '#b8c4e0', fontSize: 13, whiteSpace: 'pre-wrap' }}>{event.text}</div>
        </div>
      )}

      {/* 个人操作节点：商店 / 失与得 / 王牌招募（每人独立界面） */}
      {personal && personal.kind === 'shop' && personal.shop && (() => {
        const sh = personal.shop!;
        const coins = sh.coins;
        const robVoting = !!vote && vote.kind === 'shopRob';
        const myItems = myCharId ? (run.perItems[myCharId] ?? []) : [];
        const myMats = myCharId ? (run.perMaterials[myCharId] ?? []) : [];
        // 可出售：藏品（perItems）+ 药水（perMaterials 中 slot=consumable）
        const sellEquip = myItems.map((id) => itemMap.get(id)).filter((it): it is NonNullable<typeof it> => !!it);
        const sellPotions = myMats.filter((m) => itemMap.get(m.itemId)?.slot === 'consumable')
          .map((m) => ({ it: itemMap.get(m.itemId)!, count: m.count }))
          .filter((x) => !!x.it);
        const sellableCount = sellEquip.length + sellPotions.length;
        const pct = (n: number) => `${Math.round(n * 100)}%`;
        return (
          <div style={{ ...s.vote, borderColor: '#ffc46b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <b>诡异行商（你的商店）</b>
              <span style={{ color: '#ffc46b', fontSize: 13 }}>你的哈哈币：{coins}</span>
              <span style={{ color: '#8fa0c8', fontSize: 12, marginLeft: 'auto' }}>已完成 {sh.doneCount}/{sh.total} 人</span>
            </div>

            <div className="merchant-layout" style={{ gap: 12, flexWrap: 'wrap' }}>
              <aside className="card merchant-panel" style={{ flex: '0 1 240px' }}>
                <Sprite className="merchant-portrait" src={MONSTER_IMAGES.yuanShao} alt="袁绍" />
                <b className="merchant-name">袁绍</b>
                <p className="muted small merchant-quote">「看上的就拿，铜板结账——这摊子只在你这一趟里出。」</p>
                <div className="merchant-buttons">
                  <button className="btn" disabled={!sh.robShopOpen || !!sh.robbed || robVoting}
                    onClick={() => online.emit(C2S.shopRobRequest, {})}
                    title={robVoting ? '抢商店投票进行中，见下方投票面板' : sh.robbed ? '本摊已被洗劫' : sh.robShopDone ? '本局已抢过商店' : '发起全员投票：抢商店（击败袁绍后本摊商品全 0，但本局其余行商不再进货）'}>
                    {robVoting ? '抢商店投票中…' : sh.robbed ? '本摊已洗劫' : sh.robShopDone ? '本局已抢过' : '抢商店（发起全队投票）'}
                  </button>
                  <button className={`btn ${sh.haggle ? '' : 'primary'}`} disabled={!!sh.haggle || !!sh.robbed}
                    onClick={() => online.emit(C2S.shopHaggle, {})}
                    title={sh.haggle ? '本摊已砍过价' : sh.robbed ? '货摊已被洗劫' : '以你角色魅力 + 1D50 判定砍价（每摊一次）'}>
                    {sh.haggle ? `已砍价 · ${haggleLabel(sh.haggle.discountPct)}` : '魅力判定砍价'}
                  </button>
                  <button className={`btn ${sh.nextRefreshCost !== undefined && sh.nextRefreshCost > 0 ? 'primary' : ''}`}
                    disabled={!!sh.robbed || (sh.dungeonId !== 'preWallCalamity' ? (sh.refreshFreeLeft ?? 0) <= 0 : (sh.torches ?? 0) < (sh.nextRefreshCost ?? 0))}
                    onClick={() => online.emit(C2S.shopRefresh, {})}
                    title={sh.robbed ? '货摊已被洗劫' : sh.dungeonId === 'preWallCalamity' ? `刷新货摊（消耗 ${sh.nextRefreshCost ?? 0} 火把）` : `免费刷新（剩余 ${sh.refreshFreeLeft ?? 0} 次）`}>
                    {sh.dungeonId === 'preWallCalamity'
                      ? ((sh.nextRefreshCost ?? 0) === 0 ? '免费刷新' : `刷新（🔥×${sh.nextRefreshCost}）`)
                      : ((sh.refreshFreeLeft ?? 0) > 0 ? `免费刷新（${sh.refreshFreeLeft}次）` : '免费刷新已用')}
                  </button>
                </div>
                {sh.robbed && <p className="merchant-haggle muted small">💰 货摊已被洗劫，商品一律免费！</p>}
                {sh.haggle && (
                  <p className="merchant-haggle muted small">
                    🎲 砍价判定 {sh.haggle.total}（1D50[{sh.haggle.roll}]）→ {haggleLabel(sh.haggle.discountPct)}
                  </p>
                )}
                {(sh.chainMul ?? 1) < 1 && (
                  <p className="merchant-haggle muted small">⛓ 商店遗物折扣生效：本摊价格实时享 {pct(1 - (sh.chainMul ?? 1))} 优惠（与砍价取最优、不叠加）</p>
                )}
                {(sh.freeCount ?? 0) > 0 && (
                  <p className="merchant-haggle muted small">🐙 商店免费商品生效：随机 {sh.freeCount} 件商品免费</p>
                )}
                <p className="muted small">出售价格 = 购买价格 × 50%。买下的藏品直接入你的背包，遗物挂到你的角色。</p>
              </aside>

              <div className="card merchant-shop" style={{ flex: '1 1 380px' }}>
                <h3>货摊商品（已售 {sh.bought.length} / {sh.slots.length}）</h3>
                <div className="shop-grid">
                  {sh.slots.map((slot) => {
                    const color = slot.rarity ? RARITY_COLORS[slot.rarity as keyof typeof RARITY_COLORS] : undefined;
                    const src = slot.icon ?? (slot.kind === 'relic' ? undefined : itemIcon('equip', slot.icon ?? ''));
                    return (
                      <div key={slot.id} className={`shop-card ${slot.sold ? 'sold' : ''}`}>
                        <span className="pick-icon">
                          {src ? <Sprite className="pick-img" src={src} alt={slot.label} /> : <span className="pick-emoji">{slot.kind === 'relic' ? '📿' : '📦'}</span>}
                        </span>
                        <span className="pick-name" style={color ? { color } : undefined}>{slot.label}</span>
                        <span className="pick-sub">{slot.sub}</span>
                        {slot.desc && <span className="pick-desc">{slot.desc}</span>}
                        <span className="shop-price">
                          💰 {slot.price}
                          {slot.free ? <span className="shop-free-tag" style={{ color: '#3ddc84', marginLeft: 4 }}>免费</span> : null}
                          {slot.price !== slot.price0 && !slot.free && <s className="shop-price-old"> {slot.price0}</s>}
                        </span>
                        {slot.sold ? (
                          <span className="shop-sold-tag">已售出</span>
                        ) : (
                          <button className="btn-mini" disabled={coins < slot.price}
                            onClick={() => online.emit(C2S.shopBuy, { slotId: slot.id })}
                            title={coins < slot.price ? `还差 ${slot.price - coins} 币` : '购买'}>
                            {coins < slot.price ? `差 ${slot.price - coins}` : '购买'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="card merchant-sell" style={{ marginTop: 12 }}>
              <h3>出售你的藏品 / 药水{sellableCount === 0 && <span className="muted small">（暂无可以出售的物品）</span>}</h3>
              <div className="sell-group">
                <div className="sell-list">
                  {sellableCount === 0 && <span className="muted small">背包空空如也。</span>}
                  {sellEquip.map((it) => (
                    <span key={`e_${it.id}`} className="sell-row">
                      <Sprite className="sell-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                      <span className="sell-name" style={{ color: RARITY_COLORS[it.rarity] }}>{it.name}</span>
                      <span className="muted small">{RARITY_LABELS[it.rarity]} · {SLOT_LABELS[it.slot]}</span>
                      <b className="sell-price">💰 {merchantSellPrice(it)}</b>
                      <button className="btn-mini" onClick={() => online.emit(C2S.shopSell, { itemId: it.id })}>出售</button>
                    </span>
                  ))}
                  {sellPotions.map(({ it, count }) => (
                    <span key={`p_${it.id}`} className="sell-row">
                      <Sprite className="sell-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                      <span className="sell-name" style={{ color: RARITY_COLORS[it.rarity] }}>{it.name} ×{count}</span>
                      <span className="muted small">药水</span>
                      <b className="sell-price">💰 {potionSellPrice() * count}</b>
                      <button className="btn-mini" onClick={() => online.emit(C2S.shopSell, { itemId: it.id, potion: true })}>出售</button>
                    </span>
                  ))}
                </div>
              </div>
              <p className="muted small">藏品出售后从你的背包移走；药水按瓶出售（每瓶为购买价的一半）。</p>
            </div>

            <button onClick={() => online.emit(C2S.nodeDone, {})} style={{ width: '100%', background: 'rgba(255,255,255,.08)', border: '1px solid #3a4a7c', color: '#c8d2ea', borderRadius: 8, padding: '9px', cursor: 'pointer', fontSize: 13, marginTop: 4 }}>
              完成购买，等待其他玩家…
            </button>
          </div>
        );
      })()}

      {personal && personal.kind === 'trade' && personal.trade && (
        <div style={{ ...s.vote, borderColor: '#6a4cff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <b>失与得（你的交换）</b>
            <span style={{ color: '#8fa0c8', fontSize: 12, marginLeft: 'auto' }}>已完成 {personal.trade.doneCount}/{personal.trade.total} 人</span>
          </div>
          <div style={{ color: '#8fa0c8', fontSize: 12, marginBottom: 8 }}>选择一件藏品交换（随机换得同品质或品质提升一档的藏品；每人本节点最多交换 2 次）</div>
          {personal.trade.offers.length === 0 && <div style={{ color: '#ff8f6b', fontSize: 13, marginBottom: 8 }}>你还没有可交换的藏品</div>}
          {personal.trade.offers.map((o) => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,.05)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 13 }}>
              <div style={{ flex: 1 }}><b>{o.label}</b></div>
              <button
                onClick={() => online.emit(C2S.tradePick, { itemId: o.id })}
                style={{ background: 'linear-gradient(135deg,#3d5afe,#6a4cff)', border: 'none', color: '#fff', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
                交换
              </button>
            </div>
          ))}
          <button onClick={() => online.emit(C2S.nodeDone, {})} style={{ width: '100%', background: 'rgba(255,255,255,.08)', border: '1px solid #3a4a7c', color: '#c8d2ea', borderRadius: 8, padding: '9px', cursor: 'pointer', fontSize: 13, marginTop: 4 }}>
            完成交换，等待其他玩家…
          </button>
        </div>
      )}

      {personal && personal.kind === 'recruit' && personal.recruit && (
        <div style={{ ...s.vote, borderColor: '#3ddc84' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <b>王牌招募（你的候选）</b>
            <span style={{ color: '#8fa0c8', fontSize: 12, marginLeft: 'auto' }}>已完成 {personal.recruit.doneCount}/{personal.recruit.total} 人</span>
          </div>
          <div style={{ color: '#8fa0c8', fontSize: 12, marginBottom: 8 }}>选择 1 名王牌单位加入你的队伍（战斗时由你操作）</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
            {personal.recruit.candidates.map((c) => (
              <div key={c.id} onClick={() => online.emit(C2S.recruitPick, { candidateId: c.id })}
                style={{ border: personal.recruit?.picked === c.id ? '1px solid #3ddc84' : '1px solid #2c3a68', background: personal.recruit?.picked === c.id ? 'rgba(61,220,132,.1)' : '#0d1326', borderRadius: 10, padding: 10, cursor: 'pointer', textAlign: 'center' }}>
                {c.icon && <img src={c.icon} alt={c.name} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, marginBottom: 4 }} />}
                <div style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: '#8fa0c8' }}>{c.rarity ?? ''} · HP {c.hp} 攻 {c.atk} 防 {c.def}</div>
                {personal.recruit?.picked === c.id && <div style={{ color: '#3ddc84', fontSize: 11, marginTop: 2 }}>已选择</div>}
              </div>
            ))}
          </div>
          <button onClick={() => online.emit(C2S.nodeDone, {})} style={{ width: '100%', background: 'rgba(255,255,255,.08)', border: '1px solid #3a4a7c', color: '#c8d2ea', borderRadius: 8, padding: '9px', cursor: 'pointer', fontSize: 13 }}>
            完成招募，等待其他玩家…
          </button>
        </div>
      )}

      {/* 投票面板 */}
      {vote && (
        <div style={s.vote}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <b>{vote.title}</b>
            {vote.deadlineAt && <span style={{ fontSize: 12 }}><Deadline at={vote.deadlineAt} /> 未提交玩家：{vote.waiting.join('、')}</span>}
          </div>
          {vote.desc && <div style={{ color: '#8fa0c8', fontSize: 12, marginBottom: 10 }}>{vote.desc}</div>}
          {vote.options.map((o) => {
            const picked = Object.values(vote.submissions).filter((x) => x === o.id).length;
            return (
              <button key={o.id} style={{ ...s.opt, ...(submitted ? s.optSel : {}) }} onClick={() => submit(o.id)} disabled={submitted}>
                {o.label} {o.desc && <span style={{ color: '#8fa0c8', fontSize: 11, marginLeft: 6 }}>{o.desc}</span>}
                {picked > 0 && <span style={{ color: '#ffc46b', float: 'right' }}>{picked} 人选择</span>}
              </button>
            );
          })}
          {submitted && <div style={{ color: '#3ddc84', fontSize: 12, marginTop: 6 }}>已提交，等待其他玩家…</div>}
          {toast && <div style={{ color: '#ff8f6b', fontSize: 12, marginTop: 6 }}>{toast}</div>}
        </div>
      )}

      {/* 随机裁决提示 */}
      {rollMsg && <div style={{ ...s.vote, borderColor: '#ffc46b', color: '#ffd9a0', textAlign: 'center' }}>{rollMsg}</div>}

      {/* 日志 */}
      {run.logs.length > 0 && (
        <div style={s.log}>
          {run.logs.map((t, i) => <div key={i} style={{ marginBottom: 2 }}>{t}</div>)}
        </div>
      )}

      {/* 结算 */}
      {result && (
        <div style={{ ...s.vote, borderColor: result.win ? '#3ddc84' : '#ff2e63', marginTop: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: result.win ? '#3ddc84' : '#ff8f6b' }}>
            {result.win ? '🎉 通关成功' : '💀 探索失败'}
          </div>
          <div style={{ color: '#b8c4e0', fontSize: 13, marginBottom: 12 }}>{result.reason}</div>
          {result.perPlayer.map((p) => (
            <div key={p.playerId} style={{ background: 'rgba(255,255,255,.05)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 13 }}>
              <b>{p.name}</b>：+{p.coins} 哈哈币
              {p.items.length > 0 && <span> · 藏品 {p.items.join('、')}</span>}
              {p.relics.length > 0 && <span> · 遗物 {p.relics.join('、')}</span>}
              {p.materials.length > 0 && <span> · 材料 {p.materials.map((m) => `${m.itemId}x${m.count}`).join('、')}</span>}
            </div>
          ))}
          <button onClick={writeBack} disabled={written}
            style={{ background: written ? 'rgba(255,255,255,.08)' : 'linear-gradient(135deg,#3d5afe,#6a4cff)', border: 'none', color: '#fff', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer', marginTop: 8, width: '100%' }}>
            {written ? '已写入本地存档' : '将我的收获写入本地存档'}
          </button>
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,.08)', border: '1px solid #3a4a7c', color: '#c8d2ea', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer', marginTop: 8, width: '100%' }}>返回大厅</button>
        </div>
      )}

      {/* 我的背包（服务端权威视图，展示/交互完全对齐单人 RunBag：属性+穿戴+切换） */}
      {showBag && (bag ? (
        <OnlineBag
          bag={bag}
          err={toast}
          onEquip={(itemId) => online.emit(C2S.bagEquip, { itemId })}
          onUnequip={(slot) => online.emit(C2S.bagUnequip, { slot })}
          onClose={() => { setShowBag(false); setBag(null); }}
        />
      ) : (
        <Modal title="背包" onClose={() => { setShowBag(false); setBag(null); }}>
          <p className="muted">加载背包中…</p>
        </Modal>
      ))}
    </div>
  );
}
