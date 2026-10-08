import { useMemo, useState, type DragEvent } from 'react';
import type { Equip, Item, Rarity, SaveData, Slot } from '../types';
import { EXTRA_KEYS, enhanceOf } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES, itemIcon } from '../assets/config';
import { itemMapOf } from '../data/content';
import { RELIC_MAP } from '../data/relics';
import { updateCharacterEquip, updateCharacterInventory, upgradeSkill, spendFreePoint, FREE_EXTRA_MAX, moveInventoryToStorage, withdrawStorageToInventory, resetSkillPoints, resetFreePoints } from '../save/storage';
import { BASE_TEMPLATE, collectPassives, computeStats, equippedIds, outerStats, relicPanelBonus } from '../engine/stats';
import { canUpgradeSkill, exclusiveSkillsOf, SKILL_MAX_LEVEL, skillLevelOf, skillUnlocked, tierOf, availableSkillPoints } from '../engine/skills';
import { COIN_NAME } from '../engine/drops';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';
import {
  bonusLines, EXTRA_LABELS, RARITY_COLORS, RARITY_LABELS, SLOT_LABELS, spdText, WEAPON_TYPE_LABELS,
} from '../ui/labels';

type EquipSlotKey = 'weapon' | 'helmet' | 'armor' | 'boots' | 'acc1' | 'acc2';

const EQUIP_SLOTS: { key: EquipSlotKey; label: string }[] = [
  { key: 'weapon', label: '武器' },
  { key: 'helmet', label: '头盔' },
  { key: 'armor', label: '防具' },
  { key: 'boots', label: '靴子' },
  { key: 'acc1', label: '饰品1' },
  { key: 'acc2', label: '饰品2' },
];

const MOD_ROWS: [string, string][] = [
  ['全能增伤', 'allDmgAmp'], ['真实增伤', 'trueDmgAmp'], ['物理增伤', 'physDmgAmp'], ['法术增伤', 'magicDmgAmp'],
  ['全能减伤', 'allDmgRed'], ['真实减伤', 'trueDmgRed'], ['物理减伤', 'physDmgRed'], ['法术减伤', 'magicDmgRed'],
];

const slotOf = (key: EquipSlotKey): Slot => (key === 'acc1' || key === 'acc2') ? 'accessory' : key;

// 稀有度从高到低排序（藏品浏览更有序）
const RARITY_ORDER: Record<Rarity, number> = {
  legendary: 5, epic: 4, rare: 3, fine: 2, uncommon: 1, common: 0,
};

type DragPayload =
  | { kind: 'bag'; itemId: string }
  | { kind: 'equip'; key: EquipSlotKey; itemId: string };

// 角色背包：与冒险模式「队伍背包」一致的三列面板（属性总览 / 穿戴+道具 / 藏品+遗物），支持拖拽换装
export function Backpack({ save, id, onBack, onGoCollection, onChange }: {
  save: SaveData;
  id: string;
  onBack: () => void;
  onGoCollection: () => void;
  onChange: (s: SaveData) => void;
}) {
  const c = save.characters.find((x) => x?.id === id);
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const [showRelicStats, setShowRelicStats] = useState(true);
  const [showStorage, setShowStorage] = useState(false);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [detail, setDetail] = useState<{ kind: 'bag'; itemId: string } | { kind: 'equip'; key: EquipSlotKey; itemId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!c) {
    return (
      <div className="page">
        <button className="btn" onClick={onBack}>返回</button>
        <p>角色不存在。</p>
      </div>
    );
  }

  const job = JOB_DEFS[c.job];
  const equipItems = useMemo(() => equippedIds(c.equip).map((x) => itemMap.get(x)).filter((x) => !!x) as Item[], [c.equip, itemMap]);
  // 藏品被动：物理/法术增伤等（战斗内常驻生效，面板中展示）
  const itemPassives = useMemo(() => collectPassives(equipItems), [equipItems]);
  const itemMods = useMemo(() => ({
    physDmgAmp: itemPassives.physDmgAmp ?? 0,
    magicDmgAmp: itemPassives.magicDmgAmp ?? 0,
  }), [itemPassives]);
  const owned = useMemo(
    () => (c.inventory ?? []).map((ref) => ({ ref, item: itemMap.get(ref) }))
      .filter((x): x is { ref: string; item: Item } => !!x.item)
      .sort((a, b) => RARITY_ORDER[b.item.rarity] - RARITY_ORDER[a.item.rarity]),
    [c.inventory, itemMap],
  );

  // 属性面板：原始面板（模板+等级+藏品）↔ 局外面板（+遗物：先乘百分比后加固定值/水晶层数）
  const base = useMemo(() => computeStats(BASE_TEMPLATE, equipItems, c.level, c.baseExtra ?? c.extra), [equipItems, c.level, c.extra, c.baseExtra]);
  const bonus = useMemo(() => relicPanelBonus(c.relics ?? []), [c.relics]);
  const outer = useMemo(() => outerStats(base, bonus), [base, bonus]);
  const stats = showRelicStats ? outer : base;
  const relicDelta = (k: 'hp' | 'mp' | 'atk' | 'def' | 'mres') =>
    showRelicStats ? outer[k] - base[k] : 0;
  const extraSum = useMemo(() => {
    const sum: Record<string, number> = {};
    for (const it of equipItems) {
      if (!it.extraBonus) continue;
      for (const k of EXTRA_KEYS) sum[k] = (sum[k] ?? 0) + (it.extraBonus[k] ?? 0);
    }
    return sum;
  }, [equipItems]);

  const currentOf = (key: EquipSlotKey): string | null =>
    key === 'acc1' || key === 'acc2' ? c.equip.accessory[key === 'acc1' ? 0 : 1] : c.equip[key];

  const weaponOk = (item: Item) =>
    item.slot !== 'weapon' || job.allowedWeaponTypes.includes(item.weaponType ?? 'melee');
  const levelOk = (item: Item) => (item.level ?? 0) <= c.level;

  // 背包格 → 装备槽 / 卸下
  const doEquip = (itemId: string, key: EquipSlotKey): boolean => {
    const item = itemMap.get(itemId);
    if (!item || !itemMap) return false;
    if (item.slot !== slotOf(key)) { setErr(`「${item.name}」是${SLOT_LABELS[item.slot]}，不能放到${EQUIP_SLOTS.find((s) => s.key === key)?.label}槽。`); return false; }
    if (!weaponOk(item)) { setErr(`「${item.name}」是${WEAPON_TYPE_LABELS[item.weaponType ?? 'melee']}武器，${job.name}不能用。`); return false; }
    if (!levelOk(item)) { setErr(`「${item.name}」需要 Lv.${item.level}，当前等级不足。`); return false; }
    if (slotOf(key) === 'accessory') {
      const other = key === 'acc1' ? c.equip.accessory[1] : c.equip.accessory[0];
      if (other === itemId) { setErr('两件饰品不能是同一个藏品。'); return false; }
    }
    const next: Equip = structuredClone(c.equip);
    const old = currentOf(key);
    if (key === 'acc1' || key === 'acc2') next.accessory[key === 'acc1' ? 0 : 1] = itemId;
    else next[key] = itemId;
    // 背包扣除一件，旧穿戴回到背包
    const inv = [...(c.inventory ?? [])];
    const idx = inv.indexOf(itemId);
    if (idx >= 0) inv.splice(idx, 1);
    if (old) inv.push(old);
    setErr(null);
    onChange(updateCharacterInventory(updateCharacterEquip(save, c.id, next), c.id, inv));
    return true;
  };
  const doUnequip = (key: EquipSlotKey) => {
    const old = currentOf(key);
    if (!old) return;
    const next: Equip = structuredClone(c.equip);
    if (key === 'acc1' || key === 'acc2') next.accessory[key === 'acc1' ? 0 : 1] = null;
    else next[key] = null;
    onChange(updateCharacterInventory(updateCharacterEquip(save, c.id, next), c.id, [...(c.inventory ?? []), old]));
  };
  // 装备槽 → 装备槽：直接换位（旧件回背包）
  const doSwap = (from: EquipSlotKey, to: EquipSlotKey) => {
    const a = currentOf(from);
    if (!a) return;
    const item = itemMap.get(a);
    if (!item) return;
    if (item.slot !== slotOf(to)) { setErr(`「${item.name}」不能放到${EQUIP_SLOTS.find((s) => s.key === to)?.label}槽。`); return; }
    if (!weaponOk(item) || !levelOk(item)) return;
    if (slotOf(to) === 'accessory') {
      const other = to === 'acc1' ? c.equip.accessory[1] : c.equip.accessory[0];
      if (other === a) return;
    }
    const next: Equip = structuredClone(c.equip);
    const b = currentOf(to);
    if (to === 'acc1' || to === 'acc2') next.accessory[to === 'acc1' ? 0 : 1] = a;
    else next[to] = a;
    if (from === 'acc1' || from === 'acc2') next.accessory[from === 'acc1' ? 0 : 1] = null;
    else next[from] = null;
    const inv = [...(c.inventory ?? [])];
    if (b) inv.push(b);
    setErr(null);
    onChange(updateCharacterInventory(updateCharacterEquip(save, c.id, next), c.id, inv));
  };

  const slotLocked = (item: Item) => !weaponOk(item) || !levelOk(item);

  const dropOnSlot = (key: EquipSlotKey) => (e: DragEvent) => {
    e.preventDefault();
    if (!drag) return;
    if (drag.kind === 'bag') doEquip(drag.itemId, key);
    else if (drag.kind === 'equip' && drag.key !== key) doSwap(drag.key, key);
    setDrag(null);
  };
  const dropOnBag = (e: DragEvent) => {
    e.preventDefault();
    if (drag?.kind === 'equip') doUnequip(drag.key);
    setDrag(null);
  };

  const bagGroups = c.bag ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <h2>
          <Sprite className="head-job-icon" src={JOB_IMAGES[c.job]} alt={job.name} />
          {c.name} 的背包
          <span className="slot-level">Lv.{c.level} · {job.name}</span>
          <span className="coin-pill" title="个人哈哈币存款">💰 {c.coins} {COIN_NAME}</span>
        </h2>
        <div>
          <button className="btn" onClick={() => setShowStorage(true)}>仓库</button>
          <button className="btn" onClick={onBack} style={{ marginLeft: 8 }}>返回名册</button>
        </div>
      </div>

      {err && <div className="card bp-err">{err}</div>}

      {/* 角色摘要条：头像 + 关键属性 + 数量概览 */}
      <div className="card bp-hero">
        <Sprite className="bp-hero-avatar" src={JOB_IMAGES[c.job]} alt={job.name} />
        <div className="bp-hero-main">
          <b>{c.name}</b>
          <span className="muted small">{job.name} · Lv.{c.level} · 💰 {c.coins} {COIN_NAME}</span>
        </div>
        <div className="bp-hero-stats">
          <span>生命 <b>{stats.hp}</b>{relicDelta('hp') !== 0 && <i className="bp-relic-delta">+{relicDelta('hp')}</i>}</span>
          <span>魔力 <b>{stats.mp}</b>{relicDelta('mp') !== 0 && <i className="bp-relic-delta">+{relicDelta('mp')}</i>}</span>
          <span>攻击 <b>{stats.atk}</b>{relicDelta('atk') !== 0 && <i className="bp-relic-delta">+{relicDelta('atk')}</i>}</span>
          <span>防御 <b>{stats.def}</b>{relicDelta('def') !== 0 && <i className="bp-relic-delta">+{relicDelta('def')}</i>}</span>
          <span>法抗 <b>{stats.mres}%</b>{relicDelta('mres') !== 0 && <i className="bp-relic-delta">+{relicDelta('mres')}</i>}</span>
          <span>速度 <b>{spdText(stats.spdMin, stats.spdMax)}</b></span>
        </div>
        <div className="bp-hero-counts">
          <span>穿戴 <b>{equipItems.length}/6</b></span>
          <span>藏品 <b>{owned.length}</b></span>
          <span>道具 <b>{bagGroups.reduce((n, g) => n + g.count, 0)}</b></span>
        </div>
      </div>

      <div className="runbag-grid backpack-grid">
        {/* 列A：属性总览（原始面板 ↔ 局外面板） */}
        <div className="runbag-col">
          <div className="runbag-stats card">
            <div className="runbag-stats-head">
              <h4>{showRelicStats ? '局外面板（含遗物加成）' : '原始面板（仅穿戴藏品）'}</h4>
              <label className="bp-relic-toggle">
                <input type="checkbox" checked={showRelicStats} onChange={(e) => setShowRelicStats(e.target.checked)} />
                显示遗物加成
              </label>
            </div>
            <div className="runbag-stat-grid">
              <span>生命 <b>{stats.hp}</b>{relicDelta('hp') !== 0 && <i className="bp-relic-delta">+{relicDelta('hp')}</i>}</span>
              <span>魔力 <b>{stats.mp}</b>{relicDelta('mp') !== 0 && <i className="bp-relic-delta">+{relicDelta('mp')}</i>}</span>
              <span>攻击 <b>{stats.atk}</b>{relicDelta('atk') !== 0 && <i className="bp-relic-delta">+{relicDelta('atk')}</i>}</span>
              <span>防御 <b>{stats.def}</b>{relicDelta('def') !== 0 && <i className="bp-relic-delta">+{relicDelta('def')}</i>}</span>
              <span>法抗 <b>{stats.mres}%</b>{relicDelta('mres') !== 0 && <i className="bp-relic-delta">+{relicDelta('mres')}</i>}</span>
              <span>速度 <b>{spdText(stats.spdMin, stats.spdMax)}</b></span>
            </div>
            <h4>额外6维</h4>
            <div className="runbag-stat-grid">
              {EXTRA_KEYS.map((k) => (
                <span key={k}>{EXTRA_LABELS[k]} <b>{c.extra[k] + (extraSum[k] ?? 0)}</b>{extraSum[k] ? <i className="bp-relic-delta">+{extraSum[k]}</i> : null}</span>
              ))}
            </div>
            <h4>增伤 / 减伤<span className="muted small">（藏品增伤常驻生效；其余由战斗中 BUFF 动态计算）</span></h4>
            <div className="runbag-stat-grid bp-mod-grid">
              {MOD_ROWS.map(([label, key]) => (
                <span key={key}>{label} <b>{key === 'physDmgAmp' || key === 'magicDmgAmp' ? `${Math.round(itemMods[key] * 100)}%` : '0%'}</b></span>
              ))}
            </div>
            <h4>技能<span className="muted small">（专属技能可升级，1-3级；可用技能点 {availableSkillPoints(c)}，每10级+1）</span>
              <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => { if (confirm('确认重置所有技能等级？已消耗的技能点将全部返还。')) onChange(resetSkillPoints(save, c.id)); }}>重置技能点</button>
            </h4>
            <div className="skill-panel">
              {exclusiveSkillsOf(c).map((sk) => {
                const lv = skillLevelOf(c, sk.id);
                const unlocked = skillUnlocked(sk, c.level);
                const tier = unlocked ? tierOf(sk, lv) : null;
                const nextTier = unlocked && lv < SKILL_MAX_LEVEL ? tierOf(sk, lv + 1) : null;
                const upgradable = canUpgradeSkill(c, sk);
                return (
                  <div key={sk.id} className={`skill-card ${unlocked ? '' : 'skill-card-locked'}`}>
                    <div className="skill-card-head">
                      <b>{sk.name}</b>
                      <span className="muted small">
                        {sk.kind === 'passive' ? '被动' : `耗魔${tier?.mpCost ?? sk.mpCost}`}
                        {sk.kind !== 'passive' && tier?.hits && tier.hits > 1 ? `·${tier.hits}连击` : ''}
                        · Lv.{unlocked ? lv : '--'}/{SKILL_MAX_LEVEL}
                      </span>
                      {!unlocked ? (
                        <span className="skill-lock-tag">Lv.{sk.unlockLevel} 解锁</span>
                      ) : lv >= SKILL_MAX_LEVEL ? (
                        <span className="skill-max-tag">已满级</span>
                      ) : (
                        <button
                          className="btn-sm"
                          disabled={!upgradable}
                          onClick={() => onChange(upgradeSkill(save, c.id, sk.id))}
                        >
                          升级{upgradable ? `（剩${availableSkillPoints(c)}点）` : ''}
                        </button>
                      )}
                    </div>
                    <div className="skill-card-desc">{unlocked ? (tier?.desc ?? sk.desc) : `${sk.desc}`}</div>
                    {nextTier && (
                      <div className="skill-next muted small">下一级：{nextTier.desc}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <h4>自由属性点<span className="muted small">（剩余 {c.freeExtraPoints ?? 0}，每升10级获得10点，上限{FREE_EXTRA_MAX}/项）</span>
              <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => { if (confirm('确认重置所有额外6维加点？已消耗的自由属性点将全部返还。')) onChange(resetFreePoints(save, c.id)); }}>重置6维</button>
            </h4>
            <div className="runbag-stat-grid bp-free-grid">
              {EXTRA_KEYS.map((k) => (
                <span key={k} className="bp-free-row">
                  {EXTRA_LABELS[k]} <b>{c.extra[k] + (extraSum[k] ?? 0)}</b>
                  <button
                    className="btn-step"
                    disabled={(c.freeExtraPoints ?? 0) <= 0 || (c.extra[k] ?? 0) >= FREE_EXTRA_MAX}
                    onClick={() => onChange(spendFreePoint(save, c.id, k))}
                  >＋</button>
                </span>
              ))}
            </div>
            <p className="muted small">
              原始面板 = 基础 + 等级 + 穿戴藏品；局外面板 = 原始 × (1 + 遗物百分比) + 遗物固定值 + 水晶层数加成。
            </p>
          </div>
        </div>

        {/* 列B：穿戴（可拖拽）+ 道具 */}
        <div className="runbag-col">
          <div className="runbag-panel card" onDragOver={(e) => e.preventDefault()} onDrop={dropOnBag} title="拖到这里可卸下穿戴">
            <h4>穿戴<span className="muted small">（拖动藏品到对应槽位穿戴/换位，拖回此处卸下）</span></h4>
            <div className="bp-equip-grid">
              {EQUIP_SLOTS.map((s) => {
                const cur = currentOf(s.key);
                const item = cur ? itemMap.get(cur) : undefined;
                const enh = cur ? enhanceOf(cur) : 0;
                return (
                  <div
                    key={s.key}
                    className={`bp-slot ${drag ? 'runbag-slot-drop' : ''}`}
                    style={item ? { borderColor: RARITY_COLORS[item.rarity] } : undefined}
                    onClick={() => item ? setDetail({ kind: 'equip', key: s.key, itemId: cur! }) : undefined}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={dropOnSlot(s.key)}
                    draggable={!!item}
                    onDragStart={(e) => {
                      if (!item) return;
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ kind: 'equip', key: s.key, itemId: cur! });
                    }}
                    onDragEnd={() => setDrag(null)}
                    title={item ? item.name : `空 · ${s.label}`}
                  >
                    {item
                      ? <Sprite className="bp-slot-icon" src={itemIcon(item.slot, item.icon)} alt={item.name} />
                      : <span className="bp-slot-empty">＋</span>}
                    <div className="bp-slot-main">
                      <span className="runbag-slot-label">{s.label}</span>
                      {item
                        ? <span className="runbag-slot-name" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}{enh > 0 ? ` +${enh}` : ''}</span>
                        : <span className="muted small">空</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <h4>道具（消耗品）</h4>
            <div className="runbag-inv">
              {bagGroups.length === 0 && <span className="muted small">没有携带道具。</span>}
              {bagGroups.map((g) => {
                const it = itemMap.get(g.itemId);
                if (!it) return null;
                return (
                  <div key={g.itemId} className="runbag-item static" style={{ borderColor: RARITY_COLORS[it.rarity] }}>
                    <Sprite className="runbag-item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                    <span className="runbag-item-name" style={{ color: RARITY_COLORS[it.rarity] }}>{it.name}</span>
                    <span className="muted small">×{g.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 列C：藏品（点击查看/拖拽穿戴）+ 遗物 */}
        <div className="runbag-col">
          <div className="runbag-panel card">
            <h4>藏品（{owned.length}）<span className="muted small">· 点击查看详情，拖拽到左侧穿戴</span></h4>
            <div className="bp-own-grid" onDragOver={(e) => e.preventDefault()} onDrop={dropOnBag}>
              {owned.length === 0 && (
                <div className="card bag-empty">
                  背包里还没有藏品。通关副本战利品分配、或去
                  <button className="btn-link" onClick={onGoCollection}>藏品库</button>
                  创建自定义藏品后会出现在这里。
                </div>
              )}
              {owned.map(({ ref, item: it }, i) => {
                const locked = slotLocked(it);
                const enh = enhanceOf(ref);
                return (
                  <button
                    key={`${ref}_${i}`}
                    type="button"
                    className={`bp-own-item ${locked ? 'locked' : ''}`}
                    style={{ borderColor: RARITY_COLORS[it.rarity] }}
                    onClick={() => setDetail({ kind: 'bag', itemId: ref })}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDrag({ kind: 'bag', itemId: ref });
                    }}
                    onDragEnd={() => setDrag(null)}
                    title={locked ? (it.slot === 'weapon' ? '职业武器类型不符' : `需要 Lv.${it.level}`) : it.name}
                  >
                    <Sprite className="runbag-item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                    <span className="bp-own-name" style={{ color: RARITY_COLORS[it.rarity] }}>
                      {it.name}{enh > 0 ? ` +${enh}` : ''}
                    </span>
                    <span className="muted small">{RARITY_LABELS[it.rarity]} · {SLOT_LABELS[it.slot]}</span>
                    {locked && <span className="bp-cell-lock">不可穿戴</span>}
                  </button>
                );
              })}
            </div>

            <h4>遗物（副本外无遗物）</h4>
            <div className="runbag-relics">
              {c.relics && c.relics.length > 0 ? (
                c.relics.map((rid) => {
                  const r = RELIC_MAP[rid];
                  if (!r) return null;
                  return (
                    <div className="relic-row" key={rid}>
                      <b className="relic-name" style={{ color: RARITY_COLORS[r.rarity] }}>{r.name}</b>
                      <span className="relic-desc">{r.desc}</span>
                    </div>
                  );
                })
              ) : (
                <span className="muted small">遗物只能在副本中获取并使用，通关后不带出。</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {detail && (() => {
        const item = itemMap.get(detail.itemId);
        if (!item) { setDetail(null); return null; }
        const isEquip = detail.kind === 'equip';
        const enh = enhanceOf(detail.itemId);
        return (
          <Modal title={`${item.name}${enh > 0 ? ` +${enh}` : ''}`} onClose={() => setDetail(null)}>
            <div className="bag-detail">
              <Sprite className="item-icon" src={itemIcon(item.slot, item.icon)} alt={item.name} />
              <div>
                <div style={{ color: RARITY_COLORS[item.rarity] }}>
                  {RARITY_LABELS[item.rarity]} · {SLOT_LABELS[item.slot]}
                  {item.level ? ` · 需Lv.${item.level}` : ''}
                  {item.slot === 'weapon' ? ` · ${WEAPON_TYPE_LABELS[item.weaponType ?? 'melee']}` : ''}
                  {item.price > 0 ? ` · 价值 ${item.price}` : ''}
                </div>
                <div className="muted">{item.desc}</div>
                <div>{bonusLines(item).join('，') || '无特殊效果'}</div>
              </div>
            </div>
            <div className="modal-actions">
              {isEquip ? (
                <>
                  <button className="btn" onClick={() => setDetail(null)}>关闭</button>
                  <button className="btn-danger" onClick={() => { doUnequip(detail.key); setDetail(null); }}>卸下</button>
                </>
              ) : (
                <>
                  <button className="btn" onClick={() => setDetail(null)}>关闭</button>
                  <button
                    className="btn"
                    onClick={() => {
                      const r = moveInventoryToStorage(save, c.id, item.id);
                      if (r) { onChange(r); setDetail(null); }
                      else setErr('存入仓库失败（仓库可能已满）。');
                    }}
                  >存入仓库</button>
                  {item.slot === 'weapon' || item.slot === 'helmet' || item.slot === 'armor' || item.slot === 'boots' || item.slot === 'accessory' ? (
                    <button
                      className="btn primary"
                      disabled={slotLocked(item)}
                      onClick={() => {
                        const key: EquipSlotKey = item.slot === 'accessory'
                          ? (c.equip.accessory[0] ? 'acc2' : 'acc1')
                          : item.slot as 'weapon' | 'helmet' | 'armor' | 'boots';
                        if (doEquip(item.id, key)) setDetail(null);
                      }}
                    >
                      穿戴
                    </button>
                  ) : (
                    <button className="btn" disabled>不可穿戴</button>
                  )}
                </>
              )}
            </div>
          </Modal>
        );
      })()}

      {showStorage && (
        <Modal title={`${c.name} 的仓库（${(c.storage ?? []).length}/500）`} onClose={() => setShowStorage(false)}>
          <div className="muted small" style={{ marginBottom: 10 }}>点击藏品取出到背包；背包藏品可在详情中存入仓库。</div>
          <div className="runbag-inv">
            {(c.storage ?? []).length === 0 && <span className="muted small">仓库是空的。</span>}
            {(c.storage ?? []).map((g) => {
              const item = itemMap.get(g.itemId);
              if (!item) return null;
              const enh = enhanceOf(g.itemId);
              return (
                <button
                  key={g.itemId}
                  type="button"
                  className="runbag-item"
                  style={{ borderColor: RARITY_COLORS[item.rarity] }}
                  onClick={() => {
                    const r = withdrawStorageToInventory(save, c.id, g.itemId);
                    if (r) onChange(r);
                    else setErr(`「${item.name}」数量不足，无法取出。`);
                  }}
                  title={`取出 ${item.name} 到背包`}
                >
                  <Sprite className="runbag-item-icon" src={itemIcon(item.slot, item.icon)} alt={item.name} />
                  <span className="runbag-item-name" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}{enh > 0 ? ` +${enh}` : ''}</span>
                  <span className="muted small">×{g.count}</span>
                </button>
              );
            })}
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setShowStorage(false)}>关闭</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
