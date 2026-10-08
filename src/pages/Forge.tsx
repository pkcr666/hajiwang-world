import { useMemo, useState, useEffect } from 'react';
import type { SaveData } from '../types';
import { ENHANCE_RATES, baseItemId } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES } from '../assets/config';
import { Sprite } from '../components/Sprite';
import { itemMapOf } from '../data/content';
import { SLOT_LABELS, RARITY_LABELS, RARITY_COLORS, bonusLines } from '../ui/labels';
import {
  listEnhanceCandidates, canEnhance, enhanceCost, doEnhance,
  getRecipes, canForge, doForge, listForgeMaterials, countMaterial,
  SHOP_ITEMS, buyShopItem,
} from '../engine/forge';

type ForgeTab = 'enhance' | 'forge' | 'archive' | 'shop';

const TABS: { key: ForgeTab; label: string }[] = [
  { key: 'enhance', label: '强化' },
  { key: 'forge', label: '锻造' },
  { key: 'archive', label: '典藏' },
  { key: 'shop', label: '商店' },
];

// ===== 强化动画弹窗（DNF锻造炉风格） =====
function EnhanceModal({
  itemName, targetLevel, onDone,
}: {
  itemName: string; targetLevel: number; onDone: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'forging' | 'done'>('forging');

  useEffect(() => {
    const duration = 5000;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setPhase('done');
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="modal-backdrop" onClick={phase === 'done' ? onDone : undefined}>
      <div className="forge-modal" onClick={(e) => e.stopPropagation()}>
        <div className="forge-furnace">
          <div className={`forge-flame ${phase === 'done' ? 'forge-flame-done' : ''}`} />
          <div className="forge-anvil">
            <span className="forge-item-name">{itemName}</span>
            <span className="forge-target">强化至 +{targetLevel}</span>
          </div>
          <div className="forge-progress-track">
            <div className="forge-progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="forge-progress-text">
            {phase === 'forging' ? '锻造中…' : '完成！点击关闭'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 强化结果弹窗（成功金色 / 失败灰色） =====
function EnhanceResultModal({
  success, newLevel, downgraded, itemName, onClose,
}: {
  success: boolean; newLevel: number; downgraded: boolean; itemName: string; onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`forge-result-modal ${success ? 'success' : 'fail'}`} onClick={(e) => e.stopPropagation()}>
        <div className={`forge-result-glow ${success ? 'glow-gold' : 'glow-gray'}`} />
        <div className="forge-result-icon">{success ? '✦' : '✕'}</div>
        <h3 className="forge-result-title">
          {success ? '强化成功！' : downgraded ? '强化失败，等级下降！' : '强化失败'}
        </h3>
        <p className="forge-result-item">
          {itemName} {newLevel > 0 ? `+${newLevel}` : ''}
        </p>
        <button className="btn" onClick={onClose}>确定</button>
      </div>
    </div>
  );
}

// ===== 锻造动画弹窗 =====
function ForgeModal({ resultName, onDone }: { resultName: string; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'forging' | 'done'>('forging');
  useEffect(() => {
    const duration = 2500;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setPhase('done');
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="modal-backdrop" onClick={phase === 'done' ? onDone : undefined}>
      <div className="forge-modal" onClick={(e) => e.stopPropagation()}>
        <div className="forge-furnace">
          <div className={`forge-flame ${phase === 'done' ? 'forge-flame-done' : ''}`} />
          <div className="forge-anvil">
            <span className="forge-item-name">锻造中</span>
            <span className="forge-target">{resultName}</span>
          </div>
          <div className="forge-progress-track">
            <div className="forge-progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="forge-progress-text">
            {phase === 'forging' ? '千锤百炼…' : '锻造完成！点击关闭'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Forge({ save, onBack, onChange }: {
  save: SaveData;
  onBack: () => void;
  onChange: (s: SaveData) => void;
}) {
  const [charId, setCharId] = useState<string | null>(null);
  const [tab, setTab] = useState<ForgeTab>('enhance');

  const chars = save.characters.filter((c): c is NonNullable<typeof c> => !!c);

  if (!charId) {
    return (
      <div className="page">
        <div className="page-head">
          <h2>锻造炉 · 选择角色</h2>
          <button className="btn" onClick={onBack}>返回</button>
        </div>
        <div className="slot-grid">
          {chars.length === 0 && <p className="muted">还没有角色，先去角色名册创建。</p>}
          {chars.map((c) => (
            <div className="slot-card" key={c.id} onClick={() => setCharId(c.id)}>
              <Sprite className="slot-sprite" src={JOB_IMAGES[c.job]} alt={JOB_DEFS[c.job].name} />
              <div className="slot-info">
                <div className="slot-name">{c.name} <span className="slot-level">Lv.{c.level}</span></div>
                <div className="slot-job">{JOB_DEFS[c.job].name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const c = chars.find((x) => x.id === charId) ?? null;
  if (!c) { setCharId(null); return null; }

  return (
    <div className="page">
      <div className="page-head">
        <h2>
          <Sprite className="head-job-icon" src={JOB_IMAGES[c.job]} alt={JOB_DEFS[c.job].name} />
          锻造炉 · {c.name}
          <span className="slot-level">Lv.{c.level} · {JOB_DEFS[c.job].name}</span>
        </h2>
        <div>
          <button className="btn" onClick={() => setCharId(null)}>切换角色</button>
          <button className="btn" onClick={onBack} style={{ marginLeft: 8 }}>返回</button>
        </div>
      </div>

      <div className="forge-layout">
        <div className="forge-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`forge-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="forge-content card">
          {tab === 'enhance' && <EnhancePanel save={save} charId={c.id} onChange={onChange} />}
          {tab === 'forge' && <ForgePanel save={save} charId={c.id} onChange={onChange} />}
          {tab === 'archive' && (
            <div className="forge-placeholder">
              <h3>典藏</h3>
              <p className="muted">典藏材料：曼德尔砖等稀有收藏。<br />（功能开发中）</p>
            </div>
          )}
          {tab === 'shop' && <ShopPanel save={save} charId={c.id} onChange={onChange} />}
        </div>
      </div>
    </div>
  );
}

// ===== 强化面板 =====
function EnhancePanel({ save, charId, onChange }: {
  save: SaveData; charId: string; onChange: (s: SaveData) => void;
}) {
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const candidates = useMemo(() => listEnhanceCandidates(save, charId), [save, charId]);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: 'forging'; itemName: string; target: number } | { kind: 'result'; success: boolean; newLevel: number; downgraded: boolean; itemName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const selected = candidates.find((x) => x.ref === selectedRef) ?? null;

  const handleEnhance = () => {
    if (!selected) return;
    const res = doEnhance(save, charId, selected.ref);
    if ('error' in res) { setErr(res.error); return; }
    setErr(null);
    const target = selected.enhance + 1;
    setModal({ kind: 'forging', itemName: selected.item.name, target });
    // 动画结束后显示结果
    setTimeout(() => {
      onChange(res.save);
      setModal({
        kind: 'result',
        success: res.success,
        newLevel: res.newEnhance,
        downgraded: res.downgraded,
        itemName: selected.item.name,
      });
    }, 5100);
  };

  return (
    <div>
      <h3 style={{ margin: '0 0 12px' }}>藏品强化</h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        仅30级以上武器/头盔/防具可强化。稀有上限+10，史诗+12，传说+15。+5以上失败降级。
      </p>
      {err && <div className="hint-error" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="enhance-candidates">
        {candidates.length === 0 && <p className="muted">没有可强化的藏品。</p>}
        {candidates.map((cd) => {
          const check = canEnhance(cd.item, cd.enhance);
          const stoneInfo = enhanceCost(cd.item, cd.enhance);
          const stoneItem = stoneInfo ? itemMap.get(stoneInfo.stoneId) : null;
          const stoneOwned = stoneInfo ? countMaterial(save, charId, stoneInfo.stoneId) : 0;
          const target = cd.enhance + 1;
          const rate = ENHANCE_RATES[target - 1] ?? 0;
          return (
            <div
              key={cd.ref}
              className={`enhance-card ${selectedRef === cd.ref ? 'selected' : ''} ${!check.ok ? 'disabled' : ''}`}
              onClick={() => check.ok && setSelectedRef(cd.ref)}
              style={{ borderColor: RARITY_COLORS[cd.item.rarity] }}
            >
              <div className="enhance-card-head">
                <span className="enhance-name" style={{ color: RARITY_COLORS[cd.item.rarity] }}>
                  {cd.item.name}{cd.enhance > 0 ? ` +${cd.enhance}` : ''}
                </span>
                <span className="enhance-slot">{SLOT_LABELS[cd.item.slot]}</span>
                {cd.equipped && <span className="enhance-tag">已装备</span>}
              </div>
              <div className="enhance-card-body">
                {bonusLines(cd.item).slice(0, 3).map((l, i) => (
                  <div key={i} className="muted" style={{ fontSize: 12 }}>{l}</div>
                ))}
              </div>
              <div className="enhance-card-foot">
                {check.ok ? (
                  <>
                    <span>成功率 {Math.round(rate * 100)}%</span>
                    <span>
                      {stoneItem?.name} ×{stoneInfo?.count}
                      <span className={stoneOwned >= (stoneInfo?.count ?? 0) ? 'ok' : 'bad'}>（{stoneOwned}）</span>
                    </span>
                  </>
                ) : (
                  <span className="muted">{check.reason}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && canEnhance(selected.item, selected.enhance).ok && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button className="btn primary" onClick={handleEnhance}>
            强化 {selected.item.name}（+{selected.enhance} → +{selected.enhance + 1}）
          </button>
        </div>
      )}

      {modal?.kind === 'forging' && (
        <EnhanceModal itemName={modal.itemName} targetLevel={modal.target} onDone={() => {}} />
      )}
      {modal?.kind === 'result' && (
        <EnhanceResultModal
          success={modal.success}
          newLevel={modal.newLevel}
          downgraded={modal.downgraded}
          itemName={modal.itemName}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ===== 锻造面板 =====
function ForgePanel({ save, charId, onChange }: {
  save: SaveData; charId: string; onChange: (s: SaveData) => void;
}) {
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const recipes = useMemo(() => getRecipes(), []);
  const forgeMats = useMemo(() => listForgeMaterials(save, charId), [save, charId]);
  const ch = save.characters.find((x) => x?.id === charId);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(recipes[0]?.id ?? null);
  const [optionalMatIds, setOptionalMatIds] = useState<string[]>([]);
  const [modal, setModal] = useState<{ resultName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const recipe = recipes.find((r) => r.id === selectedRecipeId) ?? null;

  const toggleOptional = (itemId: string) => {
    if (!recipe) return;
    setOptionalMatIds((prev) => {
      if (prev.includes(itemId)) return prev.filter((x) => x !== itemId);
      if (prev.length >= recipe.optionalForgeMaterialCount) return prev;
      return [...prev, itemId];
    });
  };

  const handleForge = () => {
    if (!recipe) return;
    const res = doForge(save, charId, recipe, optionalMatIds);
    if ('error' in res) { setErr(res.error); return; }
    setErr(null);
    setModal({ resultName: res.resultName });
    setTimeout(() => {
      onChange(res.save);
      setOptionalMatIds([]);
      setModal(null);
    }, 2600);
  };

  if (!recipe) return <p className="muted">没有可用配方。</p>;

  const check = canForge(save, charId, recipe, optionalMatIds);
  const resultItem = itemMap.get(recipe.resultId);
  const bpItem = itemMap.get(recipe.blueprintId);
  const bpOwned = countMaterial(save, charId, recipe.blueprintId);

  return (
    <div>
      <h3 style={{ margin: '0 0 12px' }}>藏品锻造</h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        消耗图纸与材料锻造新藏品，图纸单次使用后消失。
      </p>

      <div className="forge-recipe-list">
        {recipes.map((r) => {
          const ri = itemMap.get(r.resultId);
          return (
            <div
              key={r.id}
              className={`forge-recipe-card ${selectedRecipeId === r.id ? 'selected' : ''}`}
              onClick={() => { setSelectedRecipeId(r.id); setOptionalMatIds([]); }}
            >
              <span style={{ color: ri ? RARITY_COLORS[ri.rarity] : undefined }}>
                {ri?.name ?? r.resultId}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>{r.name}</span>
            </div>
          );
        })}
      </div>

      <div className="forge-recipe-detail card" style={{ marginTop: 12 }}>
        <div className="forge-recipe-title">
          {resultItem && (
            <span style={{ color: RARITY_COLORS[resultItem.rarity], fontWeight: 600 }}>
              {resultItem.name}
            </span>
          )}
          <span className="muted" style={{ marginLeft: 8 }}>{RARITY_LABELS[resultItem?.rarity ?? 'common']} · {SLOT_LABELS[resultItem?.slot ?? 'material']}</span>
        </div>
        {recipe.desc && <p className="muted" style={{ fontSize: 13 }}>{recipe.desc}</p>}

        <div className="forge-mat-section">
          <div className="forge-mat-label">所需图纸</div>
          <div className="forge-mat-item">
            {bpItem?.name} ×1
            <span className={bpOwned >= 1 ? 'ok' : 'bad'}>
              （{bpOwned}）
            </span>
          </div>
        </div>

        <div className="forge-mat-section">
          <div className="forge-mat-label">必须材料</div>
          {recipe.requiredMaterials.map((req) => {
            const it = itemMap.get(req.itemId);
            const owned = (ch?.inventory ?? []).filter((id) => baseItemId(id) === req.itemId).length;
            return (
              <div key={req.itemId} className="forge-mat-item">
                {it?.name} ×{req.count}
                <span className={owned >= req.count ? 'ok' : 'bad'}>（{owned}）</span>
              </div>
            );
          })}
        </div>

        {recipe.optionalForgeMaterialCount > 0 && (
          <div className="forge-mat-section">
            <div className="forge-mat-label">
              任意锻造材料（可选，最多{recipe.optionalForgeMaterialCount}个）
            </div>
            {forgeMats.length === 0 && <p className="muted">没有锻造材料。</p>}
            <div className="forge-optional-mats">
              {forgeMats.map((m) => {
                const sel = optionalMatIds.includes(m.itemId);
                return (
                  <div
                    key={m.itemId}
                    className={`forge-optional-mat ${sel ? 'selected' : ''}`}
                    onClick={() => toggleOptional(m.itemId)}
                  >
                    {m.item.name} ×{m.count}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {err && <div className="hint-error" style={{ margin: '8px 0' }}>{err}</div>}

        <button
          className="btn primary"
          style={{ marginTop: 12 }}
          disabled={!check.ok}
          onClick={handleForge}
        >
          开始锻造
        </button>
      </div>

      {modal && <ForgeModal resultName={modal.resultName} onDone={() => {}} />}
    </div>
  );
}

// ===== 商店面板 =====
function ShopPanel({ save, charId, onChange }: {
  save: SaveData; charId: string; onChange: (s: SaveData) => void;
}) {
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const ch = save.characters.find((x) => x?.id === charId);
  const coins = ch?.coins ?? 0;
  const [err, setErr] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const buy = (itemId: string) => {
    const count = counts[itemId] ?? 1;
    const res = buyShopItem(save, charId, itemId, count);
    if ('error' in res) { setErr(res.error); return; }
    setErr(null);
    onChange(res);
  };

  return (
    <div>
      <h3 style={{ margin: '0 0 12px' }}>商店</h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        消耗角色哈哈币购买强化石，材料进入共享仓库。当前哈哈币：<b style={{ color: '#e8a93a' }}>{coins}</b>
      </p>
      {err && <div className="hint-error" style={{ margin: '8px 0' }}>{err}</div>}
      <div className="shop-list">
        {SHOP_ITEMS.map((s) => {
          const it = itemMap.get(s.itemId);
          if (!it) return null;
          const owned = countMaterial(save, charId, s.itemId);
          const count = counts[s.itemId] ?? 1;
          const total = s.price * count;
          const canBuy = coins >= total;
          return (
            <div key={s.itemId} className="shop-item card" style={{ borderColor: RARITY_COLORS[it.rarity] }}>
              <div>
                <div className="shop-item-name" style={{ color: RARITY_COLORS[it.rarity] }}>{it.name}</div>
                <div className="muted small">{it.desc}</div>
                <div className="muted small">单价 {s.price} 哈哈币 · 已拥有 {owned}</div>
              </div>
              <div className="shop-item-actions">
                <div className="shop-qty">
                  <button className="btn btn-mini" onClick={() => setCounts((c) => ({ ...c, [s.itemId]: Math.max(1, (c[s.itemId] ?? 1) - 1) }))}>－</button>
                  <span className="shop-qty-num">{count}</span>
                  <button className="btn btn-mini" onClick={() => setCounts((c) => ({ ...c, [s.itemId]: (c[s.itemId] ?? 1) + 1 }))}>＋</button>
                </div>
                <button className="btn primary" disabled={!canBuy} onClick={() => buy(s.itemId)}>
                  购买（{total}币）
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
