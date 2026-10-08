import { useMemo, useState } from 'react';
import type { Item, Relic, SaveData } from '../types';
import { mathRng } from '../types';
import { allItems, itemMapOf } from '../data/content';
import { RELIC_MAP, isUnimplemented, sumRelicSixStats } from '../data/relics';
import { DUNGEONS } from '../data/dungeons';
import { partyMembers } from '../engine/party';
import { resolveNode } from '../engine/run';
import { characterLuck } from '../engine/stats';
import { executeTrade } from '../engine/nodes';
import { persistRun } from '../save/storage';
import { itemIcon } from '../assets/config';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES } from '../assets/config';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';
import { RARITY_COLORS, RARITY_LABELS, SLOT_LABELS } from '../ui/labels';
import { RunBag } from './RunBag';

// 待确认的交换对象（先问「交换/不交换」，确认后才掷点落定结果，防反复开关弹窗刷取）
type TradeAsk =
  | { type: 'item'; memberId: string; item: Item }
  | { type: 'relic'; relic: Relic };

export function RunTrade({ save, nodeId, onChange, onBack }: {
  save: SaveData;
  nodeId: string;
  onChange: (s: SaveData) => void;
  onBack: () => void;
}) {
  const run = save.activeRun!;
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const items = useMemo(() => allItems(save), [save]);
  const members = useMemo(() => partyMembers(run.party, save.characters), [run.party, save.characters]);
  const level = DUNGEONS.find((d) => d.id === run.dungeonId)?.level ?? 10;
  const maxExchanges = run.dungeonId === 'preWallCalamity' ? 2 : 1;

  const st = run.nodeStates?.[nodeId];
  const used = st?.kind === 'trade' && st.used;
  const [ask, setAsk] = useState<TradeAsk | null>(null); // 「交换/不交换」弹窗
  const [flash, setFlash] = useState<string | null>(null); // 交换结果提示
  const [error, setError] = useState<string | null>(null); // 池空等失败提示
  const [chestAsk, setChestAsk] = useState<{ itemId: string; text: string } | null>(null); // 换得宝箱开出的藏品，待选接收队员
  const [grantAsk, setGrantAsk] = useState<{ itemId: string; text: string } | null>(null); // 换得的藏品，待选接收队员
  const [bagOpen, setBagOpen] = useState(false);

  // 可交换的藏品：全队背包中未穿戴的装备藏品
  const itemCandidates = useMemo(() =>
    members.flatMap((m) =>
      (m.inventory ?? [])
        .map((id) => itemMap.get(id))
        .filter((it): it is Item => !!it && it.slot !== 'consumable' && it.slot !== 'material')
        .map((it) => ({ memberId: m.id, item: it })),
    ), [members, itemMap]);

  // 可交换的遗物：本局拥有、且在随机池内（水晶/祭坛等指定获取遗物不可换）
  const relicCandidates = useMemo(() =>
    (run.relics ?? [])
      .map((id) => RELIC_MAP[id])
      .filter((rl): rl is Relic => !!rl && rl.inPool !== false && !isUnimplemented(rl)),
    [run.relics]);

  const leaderLuck = useMemo(() => {
    const leader = members.find((m) => m.id === run.party.leaderId);
    return leader ? characterLuck(leader, itemMap) + sumRelicSixStats(run.relics ?? []).luk : 0;
  }, [members, itemMap, run.party.leaderId, run.relics]);

  const leave = () => {
    onChange(persistRun(save, resolveNode(run, nodeId)));
    onBack();
  };

  // 点击藏品/遗物：仅弹窗询问是否交换（不掷点、不改任何状态）
  const tryExchangeItem = (memberId: string, item: Item) => setAsk({ type: 'item', memberId, item });
  const tryExchangeRelic = (relic: Relic) => setAsk({ type: 'relic', relic });

  // 确认交换：此刻才掷点并立即落定（结果同时展示），标记节点已使用，之后不再提供交换入口
  const confirm = () => {
    if (!ask) return;
    const out = executeTrade({
      save, run,
      kind: ask.type,
      memberId: ask.type === 'item' ? ask.memberId : undefined,
      itemId: ask.type === 'item' ? ask.item.id : undefined,
      relicId: ask.type === 'relic' ? ask.relic.id : undefined,
      items,
      luck: leaderLuck,
      rng: mathRng,
      nodeId,
      level,
      dungeonId: run.dungeonId,
    });
    setAsk(null);
    if (out.error) { setError(out.error); return; }
    onChange(persistRun(out.save, out.run));
    if (out.chest) setChestAsk(out.chest);
    else if (out.grant) setGrantAsk(out.grant);
    else setFlash(out.text);
  };

  // 宝箱藏品归属：写入所选队员背包（交换结果已落盘，这里只补记藏品）；材料进共享仓库
  const giveChestItem = (memberId: string) => {
    if (!chestAsk) return;
    const s = structuredClone(save);
    const c = s.characters.find((x) => x?.id === memberId);
    const it = itemMap.get(chestAsk.itemId);
    if (it?.slot === 'material') {
      const found = s.materials.find((m) => m.itemId === chestAsk.itemId);
      if (found) found.count += 1;
      else s.materials.push({ itemId: chestAsk.itemId, count: 1 });
    } else if (c) {
      c.inventory = [...(c.inventory ?? []), chestAsk.itemId];
    }
    const text = chestAsk.text;
    setChestAsk(null);
    onChange(persistRun(s, save.activeRun ?? run));
    setFlash(text);
  };

  // 换得藏品归属：写入所选队员背包（交出藏品已移除、节点已标记，这里只补记新藏品）；材料进共享仓库
  const giveGrantItem = (memberId: string) => {
    if (!grantAsk) return;
    const s = structuredClone(save);
    const c = s.characters.find((x) => x?.id === memberId);
    const it = itemMap.get(grantAsk.itemId);
    if (it?.slot === 'material') {
      const found = s.materials.find((m) => m.itemId === grantAsk.itemId);
      if (found) found.count += 1;
      else s.materials.push({ itemId: grantAsk.itemId, count: 1 });
    } else if (c) {
      c.inventory = [...(c.inventory ?? []), grantAsk.itemId];
    }
    const text = grantAsk.text;
    setGrantAsk(null);
    onChange(persistRun(s, save.activeRun ?? run));
    setFlash(text);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>失与得
          <span className="slot-level">以一件藏品/遗物换同稀有度的另一件 · 幸运判定 &gt;60 品质提升一档</span>
        </h2>
        <div className="page-head-actions">
          <button className="btn" onClick={() => setBagOpen(true)}>🎒 打开背包</button>
          <button className="btn" onClick={leave}>离开</button>
        </div>
      </div>

      {used ? (
        <div className="card trade-done">
          <p>此处已完成{maxExchanges}次交换，低语归于平静。</p>
          <p className="muted small">本节点只能交换{maxExchanges}次，继续前进去寻找下一个节点吧。</p>
        </div>
      ) : (
        <>
          <div className="card">
            <h3>交换藏品（{itemCandidates.length}）</h3>
            {itemCandidates.length === 0 && (
              <div className="muted small">全队背包里没有可交换的藏品。</div>
            )}
            <div className="trade-group">
              {members.map((m) => {
                const mine = itemCandidates.filter((x) => x.memberId === m.id);
                if (mine.length === 0) return null;
                return (
                  <div key={m.id} className="sell-group">
                    <div className="sell-member">
                      <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={JOB_DEFS[m.job].name} />
                      <b>{m.name}{m.id === run.party.leaderId && <span className="party-badge">队长</span>}</b>
                      <span className="muted small">{JOB_DEFS[m.job].name}</span>
                    </div>
                    <div className="trade-list">
                      {mine.map(({ item }) => (
                        <button
                          key={`${m.id}_${item.id}`}
                          className="trade-chip"
                          onClick={() => tryExchangeItem(m.id, item)}
                        >
                          <Sprite className="sell-icon" src={itemIcon(item.slot, item.icon)} alt={item.name} />
                          <span className="sell-name" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}</span>
                          <span className="muted small">{RARITY_LABELS[item.rarity]} · {SLOT_LABELS[item.slot]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3>交换遗物（{relicCandidates.length}）</h3>
            {relicCandidates.length === 0 && (
              <div className="muted small">本局暂无可以交换的遗物（生命水晶、魔力水晶等指定遗物不可交换）。</div>
            )}
            <div className="trade-list">
              {relicCandidates.map((rl) => (
                <button key={rl.id} className="trade-chip" onClick={() => tryExchangeRelic(rl)}>
                  {rl.icon
                    ? <Sprite className="sell-icon" src={rl.icon} alt={rl.name} />
                    : <span className="pick-emoji">📿</span>}
                  <span className="sell-name" style={{ color: RARITY_COLORS[rl.rarity] }}>{rl.name}</span>
                  <span className="muted small">{RARITY_LABELS[rl.rarity]}{rl.origin ? ` · ${rl.origin}` : ''}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="muted small">
            规则：同稀有度随机交换；幸运判定（队长幸运 + 1D50）超过 60 时，换得的物品品质提升一档
            （优秀→精良→稀有→史诗；当前版本没有传说，史诗交换后仍为史诗）。本节点限交换{maxExchanges}次。
          </p>
        </>
      )}

      {chestAsk && (() => {
        const it = itemMap.get(chestAsk.itemId);
        return (
          <Modal title="宝箱开启" onClose={() => { setChestAsk(null); setFlash(chestAsk.text); }}>
            <p className="muted small">
              换得的宝箱已开启，获得藏品<b>「{it?.name ?? chestAsk.itemId}」</b>。选择接收它的队员：
            </p>
            <div className="runbag-targets">
              {members.map((m) => (
                <button key={m.id} className="btn runbag-target" onClick={() => giveChestItem(m.id)}>
                  <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={JOB_DEFS[m.job].name} />
                  {m.name}
                  <span className="btn-sub">
                    {JOB_DEFS[m.job].name} · 背包 {(m.inventory ?? []).length} 格
                    {m.id === run.party.leaderId ? ' · 队长' : ''}
                  </span>
                </button>
              ))}
            </div>
          </Modal>
        );
      })()}

      {grantAsk && (() => {
        const it = itemMap.get(grantAsk.itemId);
        return (
          <Modal title="交换完成 · 选择接收队员" onClose={() => { setGrantAsk(null); setFlash(grantAsk.text); }}>
            <p className="muted small">
              换得藏品<b>「{it?.name ?? grantAsk.itemId}」</b>。选择接收它的队员：
            </p>
            <div className="runbag-targets">
              {members.map((m) => (
                <button key={m.id} className="btn runbag-target" onClick={() => giveGrantItem(m.id)}>
                  <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={JOB_DEFS[m.job].name} />
                  {m.name}
                  <span className="btn-sub">
                    {JOB_DEFS[m.job].name} · 背包 {(m.inventory ?? []).length} 格
                    {m.id === run.party.leaderId ? ' · 队长' : ''}
                  </span>
                </button>
              ))}
            </div>
          </Modal>
        );
      })()}

      {flash && (
        <Modal title="交换完成" onClose={() => setFlash(null)}>
          <p>{flash}</p>
          <div className="modal-actions">
            {!used && (
              <button className="btn" onClick={() => setFlash(null)}>
                继续交换（还可交换{maxExchanges - (st?.kind === 'trade' ? st.exchangeCount ?? 0 : 0)}次）
              </button>
            )}
            <button className="btn primary" onClick={() => { setFlash(null); leave(); }}>继续前行</button>
          </div>
        </Modal>
      )}

      {ask && (
        <Modal title="确认交换？" onClose={() => setAsk(null)}>
          {ask.type === 'item' ? (
            <div className="trade-preview">
              <div className="trade-preview-row">
                <span className="muted small">交出</span>
                <b style={{ color: RARITY_COLORS[ask.item.rarity] }}>{ask.item.name}</b>
                <span className="muted small">{RARITY_LABELS[ask.item.rarity]}</span>
              </div>
            </div>
          ) : (
            <div className="trade-preview">
              <div className="trade-preview-row">
                <span className="muted small">交出</span>
                <b style={{ color: RARITY_COLORS[ask.relic.rarity] }}>{ask.relic.name}</b>
                <span className="muted small">{RARITY_LABELS[ask.relic.rarity]}</span>
              </div>
            </div>
          )}
          <p className="muted small trade-roll">
            点击「交换」后才会随机确定换得的{ask.type === 'item' ? '藏品' : '遗物'}并立即完成交换，
            结果无法反悔（幸运判定 &gt;60 时品质提升一档）。
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setAsk(null)}>不交换</button>
            <button className="btn primary" onClick={confirm}>交换</button>
          </div>
        </Modal>
      )}

      {error && (
        <Modal title="无法交换" onClose={() => setError(null)}>
          <p className="warn">{error}</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setError(null)}>知道了</button>
          </div>
        </Modal>
      )}

      {bagOpen && (
        <RunBag save={save} run={run} onChange={onChange} onClose={() => setBagOpen(false)} />
      )}
    </div>
  );
}
