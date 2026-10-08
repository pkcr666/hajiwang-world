import { useMemo, useState } from 'react';
import type { Character, SaveData } from '../types';
import { mathRng } from '../types';
import { allItems } from '../data/content';
import { DUNGEONS } from '../data/dungeons';
import { inPoolRelics, isUnimplemented, RELIC_MAP } from '../data/relics';
import { COIN_NAME, openChestRelic } from '../engine/drops';
import type { PickReward } from '../engine/run';
import { itemIcon } from '../assets/config';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES } from '../assets/config';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';
import { RARITY_COLORS, RARITY_LABELS, SLOT_LABELS } from '../ui/labels';

interface CardView {
  reward: PickReward;
  icon: 'coin' | 'torch' | 'dice' | 'relic' | 'item';
  src?: string;
  name: string;
  sub: string;
  desc?: string;
  color?: string;
}

export function RunPick({ save, rewards, ownedRelics, dungeonId, members, leaderId, onConfirm }: {
  save: SaveData;
  rewards: PickReward[];
  ownedRelics: string[];
  dungeonId: string;
  members: Character[];
  leaderId: string;
  onConfirm: (picked: PickReward[]) => void;
}) {
  const itemMap = useMemo(() => new Map(allItems(save).map((i) => [i.id, i])), [save]);
  const relicMap = RELIC_MAP;
  const dungeonLevel = DUNGEONS.find((d) => d.id === dungeonId)?.level ?? 10;

  const [extras, setExtras] = useState<PickReward[]>([]);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [ownerAsk, setOwnerAsk] = useState<string | null>(null); // 待分配队员的 item 卡 key

  const all = useMemo(() => [...rewards, ...extras], [rewards, extras]);
  const total = all.length;
  const pickedCount = all.filter((r) => picked.has(r.key)).length;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  // grant 类遗物（谷地树实/宝箱）首次拾取时展开衍生卡片
  const deriveCards = (r: PickReward): PickReward[] => {
    if (r.kind !== 'relic') return [];
    const def = relicMap[r.relicId];
    if (!def) return [];
    if (def.effect.kind === 'grantRelics') {
      const granted = new Set([
        ...ownedRelics,
        ...all.filter((x) => x.kind === 'relic').map((x) => x.relicId),
      ]);
      const pool = inPoolRelics().filter((x) => !granted.has(x.id) && !isUnimplemented(x));
      const out: PickReward[] = [];
      for (let i = 0; i < def.effect.count && pool.length > 0; i++) {
        const idx = mathRng.int(0, pool.length - 1);
        const [pick] = pool.splice(idx, 1);
        out.push({ key: `x_${r.key}_${i}`, kind: 'relic', relicId: pick.id, note: def.name });
      }
      return out;
    }
    if (def.effect.kind === 'grantItem') {
      const it = openChestRelic(allItems(save), def.effect.rarity, dungeonLevel, mathRng);
      if (!it) return [];
      return [{ key: `x_${r.key}`, kind: 'item', itemId: it.id, note: def.name }];
    }
    return [];
  };

  const toggle = (r: PickReward) => {
    if (r.kind === 'luckyFail') return;
    const was = picked.has(r.key);
    const next = new Set(picked);
    if (was) {
      // 再点一次取消拾取（藏品类同时清除归属，可重新选人）
      next.delete(r.key);
      if (r.kind === 'item') {
        setOwners((o) => { const n = { ...o }; delete n[r.key]; return n; });
      }
      setPicked(next);
      return;
    }
    // 藏品/消耗品：先选队员再入包
    if (r.kind === 'item') { setOwnerAsk(r.key); return; }
    next.add(r.key);
    setPicked(next);
    if (!opened.has(r.key)) {
      const gen = deriveCards(r);
      if (gen.length) {
        setOpened((o) => { const s = new Set(o); s.add(r.key); return s; });
        setExtras((e) => [...e, ...gen]);
      }
    }
  };

  // 选定队员：藏品/消耗品立即标记归属并计入拾取
  const chooseOwner = (cid: string) => {
    if (!ownerAsk) return;
    const r = all.find((x) => x.key === ownerAsk);
    setOwners((o) => ({ ...o, [ownerAsk]: cid }));
    setOwnerAsk(null);
    if (!r || picked.has(r.key)) return;
    const next = new Set(picked);
    next.add(r.key);
    setPicked(next);
    if (!opened.has(r.key)) {
      const gen = deriveCards(r);
      if (gen.length) {
        setOpened((o) => { const s = new Set(o); s.add(r.key); return s; });
        setExtras((e) => [...e, ...gen]);
      }
    }
  };

  const pickAll = () => {
    const next = new Set(picked);
    const own = { ...owners };
    const genList: PickReward[] = [];
    const openedSet = new Set(opened);
    for (const r of all) {
      if (r.kind === 'luckyFail') continue;
      next.add(r.key);
      if (r.kind === 'item' && !own[r.key]) own[r.key] = leaderId; // 未选人的默认归队长
      // grant 类遗物（谷地树实/宝箱）展开衍生卡片，与单次拾取行为一致
      if (r.kind === 'relic' && !openedSet.has(r.key)) {
        openedSet.add(r.key);
        genList.push(...deriveCards(r));
      }
    }
    // 衍生卡片也全部拾取
    for (const g of genList) {
      next.add(g.key);
      if (g.kind === 'item' && !own[g.key]) own[g.key] = leaderId;
    }
    if (genList.length) setExtras((e) => [...e, ...genList]);
    if (openedSet.size !== opened.size) setOpened(openedSet);
    setPicked(next);
    setOwners(own);
  };
  const clearAll = () => {
    setPicked(new Set());
    setOwners({});
    setOwnerAsk(null);
  };

  const confirm = () => onConfirm(
    all
      .filter((r) => picked.has(r.key))
      .map((r) => (r.kind === 'item' ? { ...r, owner: owners[r.key] ?? leaderId } : r)),
  );

  const viewOf = (r: PickReward): CardView => {
    switch (r.kind) {
      case 'coin':
        return { reward: r, icon: 'coin', name: `${r.count} ${COIN_NAME}`, sub: '共享币池' };
      case 'torch':
        return { reward: r, icon: 'torch', name: `火把 ×${r.count}`, sub: '探索道具' };
      case 'material': {
        const it = itemMap.get(r.itemId);
        return {
          reward: r, icon: 'item', src: it ? itemIcon(it.slot, it.icon) : undefined,
          name: `${it?.name ?? r.itemId} ×${r.count}`, sub: RARITY_LABELS[it?.rarity ?? 'common'],
          color: RARITY_COLORS[it?.rarity ?? 'common'],
        };
      }
      case 'item': {
        const it = itemMap.get(r.itemId);
        return {
          reward: r, icon: 'item', src: it ? itemIcon(it.slot, it.icon) : undefined,
          name: it?.name ?? r.itemId,
          sub: it ? `${RARITY_LABELS[it.rarity]} · ${SLOT_LABELS[it.slot]}` : '',
          desc: r.note ? `来源：${r.note}` : undefined,
          color: it ? RARITY_COLORS[it.rarity] : undefined,
        };
      }
      case 'relic': {
        const rl = relicMap[r.relicId];
        return {
          reward: r, icon: 'relic', src: rl?.icon,
          name: rl?.name ?? r.relicId,
          sub: rl ? `${RARITY_LABELS[rl.rarity]}${rl.origin ? ` · ${rl.origin}` : ''}${isUnimplemented(rl) ? ' · 未实装' : ''}` : '',
          desc: rl?.desc ?? (r.note ? `来源：${r.note}` : undefined),
          color: rl ? RARITY_COLORS[rl.rarity] : undefined,
        };
      }
      case 'luckyFail':
        return { reward: r, icon: 'dice', name: '幸运判定失败', sub: '本次未通过', desc: r.text };
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>战利品
          <span className="slot-level">点击卡片拾取 · 藏品选择归属队员 · 未拾取的留在原地</span>
        </h2>
        <span className="coin-pill">已拾取 {pickedCount} / {total}</span>
      </div>

      <div className="card pick-grid">
        {all.map((r) => {
          const v = viewOf(r);
          const isPicked = picked.has(r.key);
          const dead = r.kind === 'luckyFail';
          return (
            <button
              key={r.key}
              type="button"
              className={`pick-card ${isPicked ? 'picked' : ''} ${dead ? 'dead' : ''}`}
              disabled={dead}
              onClick={() => toggle(r)}
            >
              <span className="pick-icon">
                {v.icon === 'coin' && <span className="pick-emoji">💰</span>}
                {v.icon === 'torch' && <span className="pick-emoji">🔥</span>}
                {v.icon === 'dice' && <span className="pick-emoji">🎲</span>}
                {v.icon === 'relic' && (v.src
                  ? <Sprite className="pick-img" src={v.src} alt={v.name} />
                  : <span className="pick-emoji">📿</span>)}
                {v.icon === 'item' && (v.src
                  ? <Sprite className="pick-img" src={v.src} alt={v.name} />
                  : <span className="pick-emoji">📦</span>)}
              </span>
              <span className="pick-name" style={v.color ? { color: v.color } : undefined}>{v.name}</span>
              <span className="pick-sub">{v.sub}</span>
              {v.desc && <span className="pick-desc">{v.desc}</span>}
              {isPicked && (
                <span className="pick-tick">
                  ✓ 已拾取{r.kind === 'item' ? ` · ${nameOf(owners[r.key] ?? leaderId)}` : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="modal-actions pick-actions">
        <button className="btn" onClick={pickAll}>全部拾取</button>
        <button className="btn" onClick={clearAll}>放弃全部</button>
        <button className="btn primary" onClick={confirm}>
          继续（拾取 {pickedCount} · 放弃 {total - pickedCount}）
        </button>
      </div>

      {/* 藏品/消耗品归属队员选择 */}
      {ownerAsk && (() => {
        const r = all.find((x) => x.key === ownerAsk);
        if (!r || r.kind !== 'item') return null;
        const it = itemMap.get(r.itemId);
        return (
          <Modal title="归谁所有？" onClose={() => setOwnerAsk(null)}>
            <p className="muted small">
              「{it?.name ?? r.itemId}」将立即放入所选队员的背包{it?.slot === 'consumable' ? '（消耗品）' : ''}。
            </p>
            <div className="runbag-targets">
              {members.map((m) => (
                <button key={m.id} className="btn runbag-target" onClick={() => chooseOwner(m.id)}>
                  <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={JOB_DEFS[m.job].name} />
                  {m.name}
                  <span className="btn-sub">
                    {JOB_DEFS[m.job].name} · 背包 {(m.inventory ?? []).length} 格
                    {m.id === leaderId ? ' · 队长' : ''}
                  </span>
                </button>
              ))}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
