import { useMemo, useState } from 'react';
import type { Character, Equip, ExtraStats, Item, Rarity, RunState, SaveData, Slot } from '../types';
import { EXTRA_KEYS } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES, itemIcon } from '../assets/config';
import { itemMapOf } from '../data/content';
import { isUnimplemented, RELIC_MAP } from '../data/relics';
import { partyEntries } from '../engine/party';
import { plagueLetterHpDown } from '../engine/run';
import {
  BASE_TEMPLATE, collectPassives, computeStats, crystalStacksOf, equippedIds, outerStats, relicPanelBonus,
} from '../engine/stats';
import { buildAceCombatant, buildAllyCombatant } from '../engine/unit';
import { persistRun, updateCharacterBag, updateCharacterEquip, updateCharacterInventory } from '../save/storage';
import { Modal } from '../components/Modal';
import { Sprite } from '../components/Sprite';
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

const slotOf = (key: EquipSlotKey): Slot => (key === 'acc1' || key === 'acc2') ? 'accessory' : key;

// 稀有度从高到低排序（藏品浏览更有序）
const RARITY_ORDER: Record<Rarity, number> = {
  legendary: 5, epic: 4, rare: 3, fine: 2, uncommon: 1, common: 0,
};

export function RunBag({ save, run, onChange, onClose }: {
  save: SaveData;
  run: RunState;
  onChange: (s: SaveData) => void;
  onClose: () => void;
}) {
  const members = useMemo(() => partyEntries(run.party, save.characters), [run.party, save.characters]);
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const [tabId, setTabId] = useState<string>(run.party.leaderId);
  const [detail, setDetail] = useState<{ itemId: string } | null>(null);
  const [potion, setPotion] = useState<{ owner: Character; item: Item } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showOuter, setShowOuter] = useState(true); // 勾选=局外面板（含遗物），取消=原始面板（仅藏品）

  const entry = members.find((m) => m.id === tabId) ?? members[0];
  if (!entry) {
    return (
      <Modal title="背包" onClose={onClose}>
        <p className="muted">没有队员。</p>
      </Modal>
    );
  }
  const isAce = entry.kind === 'ace';
  const ace = isAce ? entry.data : null;
  const c = isAce ? null : entry.data;
  const job = c ? JOB_DEFS[c.job] : null;

  const memberMax = (id: string) => {
    const i = members.findIndex((m) => m.id === id);
    if (i < 0) return { hp: 0, mp: 0 };
    const e = members[i];
    if (e.kind === 'ace') {
      const u = buildAceCombatant(e.data, i);
      return { hp: u.maxHp, mp: u.maxMp };
    }
    const u = buildAllyCombatant(e.data, itemMap, i, { relics: run.relics, relicStacks: run.relicStacks, killBook: run.killBook, maxHpPctDown: plagueLetterHpDown(run) });
    return { hp: u.maxHp, mp: u.maxMp };
  };

  const currentOf = (key: EquipSlotKey): string | null =>
    !c ? null : key === 'acc1' || key === 'acc2' ? c.equip.accessory[key === 'acc1' ? 0 : 1] : c.equip[key];

  const weaponOk = (item: Item) =>
    !job || item.slot !== 'weapon' || job.allowedWeaponTypes.includes(item.weaponType ?? 'melee');
  const levelOk = (item: Item) => !c || (item.level ?? 0) <= c.level;
  const slotLocked = (item: Item) => !weaponOk(item) || !levelOk(item);

  const owned = useMemo<Item[]>(
    () => (c ? (c.inventory ?? []).map((x) => itemMap.get(x)).filter((x): x is Item => !!x && x.slot !== 'material').sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]) : []),
    [c, itemMap],
  );
  const bagGroups = c?.bag ?? [];

  // ===== 属性面板：原始面板（模板+等级+藏品）↔ 局外面板（+遗物：先乘百分比后加固定值/水晶层数）=====
  const runRelics = run.relics ?? [];
  const panel = useMemo(() => {
    if (!c) return null;
    const equipItems = equippedIds(c.equip).map((id) => itemMap.get(id)).filter((x): x is Item => !!x);
    const base = computeStats(BASE_TEMPLATE, equipItems, c.level, c.baseExtra ?? c.extra);
    const stacks = run.killBook ? { ...run.relicStacks, rl_kill_book: run.killBook } : run.relicStacks;
    const weaponId = c.equip.weapon;
    const weaponType = weaponId ? itemMap.get(weaponId)?.weaponType : undefined;
    const bonus = relicPanelBonus(runRelics, stacks, { weaponType, torches: run.torches, coins: run.coins });
    return { base, bonus, outer: outerStats(base, bonus) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, itemMap, runRelics, run.relicStacks, run.killBook, run.torches, run.coins]);
  const shown = panel ? (showOuter ? panel.outer : panel.base) : null;
  // 穿戴藏品的六维加成（绿色+N；遗物六维单独标注「遗」）
  const extraEquipSum = useMemo(() => {
    const sum: Record<string, number> = {};
    if (!c) return sum;
    for (const id of equippedIds(c.equip)) {
      const it = itemMap.get(id);
      if (!it?.extraBonus) continue;
      for (const k of EXTRA_KEYS) sum[k] = (sum[k] ?? 0) + (it.extraBonus[k] ?? 0);
    }
    return sum;
  }, [c, itemMap]);
  const deltaOf = (k: 'hp' | 'mp' | 'atk' | 'def' | 'mres') =>
    panel ? (showOuter ? panel.outer[k] - panel.base[k] : 0) : 0;
  // 遗物六维加成（幸运等，影响掉落判定）
  const sixRelic: Partial<ExtraStats> = panel?.bonus.six ?? {};
  const crystal = crystalStacksOf(runRelics, run.relicStacks);
  // 遗物带来的增伤/减伤（战斗内动态生效）
  const relicMods = useMemo(() => {
    let physAmp = 0, magicAmp = 0, allRed = 0;
    for (const rid of runRelics) {
      const eff = RELIC_MAP[rid]?.effect;
      if (eff?.kind === 'dmgAmp') { physAmp += eff.phys ?? 0; magicAmp += eff.magic ?? 0; }
      if (eff?.kind === 'dmgRed') allRed += eff.all;
    }
    // 近战/魔法专属增伤（以守待攻、断杖/波纹等，按当前职业武器类型计入）
    physAmp += panel?.bonus.dmgAmp.phys ?? 0;
    magicAmp += panel?.bonus.dmgAmp.magic ?? 0;
    return { physAmp, magicAmp, allRed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runRelics, panel]);
  // 藏品带来的增伤（战斗内常驻生效）
  const itemDmgAmp = useMemo(() => {
    if (!c) return { phys: 0, magic: 0 };
    const equipItems = equippedIds(c.equip).map((id) => itemMap.get(id)).filter((x): x is Item => !!x);
    const p = collectPassives(equipItems);
    return { phys: p.physDmgAmp ?? 0, magic: p.magicDmgAmp ?? 0 };
  }, [c, itemMap]);
  const pctText = (v: number) => `${Math.round(v * 100)}%`;

  // ===== 换装（与角色背包同规则：武器职业限制/等级/饰品不重复）=====
  const doEquip = (itemId: string): boolean => {
    if (!c || !job) return false;
    const item = itemMap.get(itemId);
    if (!item) return false;
    const key: EquipSlotKey | null = item.slot === 'accessory'
      ? (c.equip.accessory[0] ? 'acc2' : 'acc1')
      : (['weapon', 'helmet', 'armor', 'boots'] as const).includes(item.slot as 'weapon') ? item.slot as EquipSlotKey : null;
    if (!key) { setErr('该物品不可穿戴。'); return false; }
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
    const inv = [...(c.inventory ?? [])];
    const at = inv.indexOf(itemId);
    if (at >= 0) inv.splice(at, 1);
    if (old) inv.push(old);
    setErr(null);
    setDetail(null);
    onChange(updateCharacterInventory(updateCharacterEquip(save, c.id, next), c.id, inv));
    return true;
  };

  const doUnequip = (key: EquipSlotKey) => {
    if (!c) return;
    const old = currentOf(key);
    if (!old) return;
    const next: Equip = structuredClone(c.equip);
    if (key === 'acc1' || key === 'acc2') next.accessory[key === 'acc1' ? 0 : 1] = null;
    else next[key] = null;
    setErr(null);
    setDetail(null);
    onChange(updateCharacterInventory(updateCharacterEquip(save, c.id, next), c.id, [...(c.inventory ?? []), old]));
  };

  // ===== 使用药水（地图中任意目标，立即生效并回写 run.hpMp）=====
  const applyPotion = (targetId: string) => {
    if (!potion) return;
    const u = potion.item.usable;
    if (!u) return;
    const bag = (potion.owner.bag ?? []).map((b) => ({ ...b }));
    const g = bag.find((b) => b.itemId === potion.item.id);
    if (!g || g.count <= 0) return;
    g.count -= 1;
    const rest = bag.filter((b) => b.count > 0);
    const cur = run.hpMp[targetId] ?? { hp: 0, mp: 0 };
    const max = memberMax(targetId);
    const hp = u.hp ? Math.min(max.hp, cur.hp + u.hp) : cur.hp;
    const mp = u.mp ? Math.min(max.mp, cur.mp + u.mp) : cur.mp;
    let s = updateCharacterBag(save, potion.owner.id, rest);
    s = persistRun(s, { ...run, hpMp: { ...run.hpMp, [targetId]: { hp, mp } } });
    onChange(s);
    setPotion(null);
  };

  const cur = run.hpMp[entry.id] ?? { hp: 0, mp: 0 };
  const max = memberMax(entry.id);

  // ===== 上场阵容：最多3名，必须包含至少1名传奇职业角色 =====
  const deployedIds = run.party.deployedIds ?? run.party.memberIds.slice(0, 3);
  const deployedSet = new Set(deployedIds);
  const isLegendary = (m: typeof members[number]) =>
    m.kind === 'char' && JOB_DEFS[m.data.job]?.tier === 'legendary';
  const deployedLegendaryCount = members.filter((m) => deployedSet.has(m.id) && isLegendary(m)).length;

  const toggleDeploy = (id: string) => {
    const isDeployed = deployedSet.has(id);
    let next: string[];
    if (isDeployed) {
      // 下场：若下场后无传奇角色或空阵则阻止
      const wouldBe = deployedIds.filter((x) => x !== id);
      const hasLegendary = members.some((m) => wouldBe.includes(m.id) && isLegendary(m));
      if (wouldBe.length === 0) { setErr('至少需要1名角色上场。'); return; }
      if (!hasLegendary) { setErr('上场阵容必须至少包含1名传奇职业角色。'); return; }
      next = wouldBe;
    } else {
      if (deployedIds.length >= 3) { setErr('上场阵容最多3名。'); return; }
      next = [...deployedIds, id];
    }
    setErr(null);
    onChange(persistRun(save, { ...run, party: { ...run.party, deployedIds: next } }));
  };

  return (
    <Modal title={`队伍背包 · ${run.act === 'sub' ? '子层' : `第 ${run.act} 层`}`} onClose={onClose} xwide>
      <div className="tabs runbag-tabs">
        {members.map((m) => (
          <button key={m.id} className={`chip ${m.id === entry.id ? 'chip-on' : ''}`} onClick={() => { setTabId(m.id); setErr(null); setDetail(null); }}>
            {m.name}{m.id === run.party.leaderId ? '（队长）' : ''}{m.kind === 'ace' ? '（王牌）' : ''}
          </button>
        ))}
      </div>

      {err && <div className="warn">{err}</div>}

      <div className="runbag-panel card" style={{ marginBottom: '12px' }}>
        <h4>上场阵容 <span className="muted small">· 最多3名，必须包含至少1名传奇职业角色（已部署传奇：{deployedLegendaryCount}）</span></h4>
        <div className="runbag-inv">
          {members.map((m) => {
            const deployed = deployedSet.has(m.id);
            const leg = isLegendary(m);
            return (
              <div key={m.id} className={`runbag-item static ${deployed ? '' : 'locked'}`} style={{ borderColor: deployed ? '#4ade80' : undefined }}>
                <span className="runbag-item-name">{m.name}{leg ? ' ★传奇' : ''}{m.id === run.party.leaderId ? '（队长）' : ''}{m.kind === 'ace' ? '（王牌）' : ''}</span>
                <button className="btn-mini" onClick={() => toggleDeploy(m.id)} disabled={!deployed && deployedIds.length >= 3 && !deployedSet.has(m.id)}>
                  {deployed ? '下场' : '上场'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="runbag-hero">
        {isAce && ace ? (
          <>
            <span className="head-job-icon" style={{ color: ace.rarity === 'epic' ? '#c084fc' : '#67e8f9', fontSize: '2em' }}>★</span>
            <b>{ace.name}</b>
            <span className="muted small">{ace.rarity === 'epic' ? '史诗' : '稀有'}王牌单位</span>
            <span className="runbag-hpmp">HP {cur.hp}/{max.hp} · MP {cur.mp}/{max.mp}</span>
            <div className="bp-hero-stats">
              <span>攻击 <b>{ace.stats.atk}</b></span>
              <span>防御 <b>{ace.stats.def}</b></span>
              <span>法抗 <b>{ace.stats.mres}%</b></span>
              <span>速度 <b>{spdText(ace.stats.spdMin, ace.stats.spdMax)}</b></span>
            </div>
          </>
        ) : (
          <>
            <Sprite className="head-job-icon" src={JOB_IMAGES[c!.job]} alt={job!.name} />
            <b>{c!.name}</b>
            <span className="muted small">Lv.{c!.level} {job!.name}</span>
            <span className="runbag-hpmp">HP {cur.hp}/{max.hp} · MP {cur.mp}/{max.mp}</span>
            <div className="bp-hero-stats">
              <span>攻击 <b>{shown!.atk}</b></span>
              <span>防御 <b>{shown!.def}</b></span>
              <span>法抗 <b>{shown!.mres}%</b></span>
              <span>速度 <b>{spdText(shown!.spdMin, shown!.spdMax)}</b></span>
            </div>
          </>
        )}
      </div>

      <div className="runbag-grid">
        {/* 列0：材料背包（本次副本已获得的材料） */}
        <div className="runbag-col">
          <div className="runbag-panel card">
            <h4>材料背包<span className="muted small">· 本次副本已获得（通关后一人一份入各成员独有仓库）</span></h4>
            <div className="runbag-inv">
              {(run.pendingMaterials ?? []).length === 0 && <span className="muted small">还没有获得材料。</span>}
              {(run.pendingMaterials ?? []).map((m) => {
                const it = itemMap.get(m.itemId);
                if (!it) return null;
                return (
                  <div key={m.itemId} className="runbag-item static" style={{ borderColor: RARITY_COLORS[it.rarity] }} title={it.name}>
                    <Sprite className="runbag-item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                    <span className="runbag-item-name" style={{ color: RARITY_COLORS[it.rarity] }}>{it.name}</span>
                    <span className="muted small">×{m.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 列A：属性总览（原始面板 ↔ 局外面板） */}
        <div className="runbag-col">
          <div className="runbag-stats card">
            {isAce && ace ? (
              <>
                <h4>王牌单位属性（固定，不受藏品/遗物加成）</h4>
                <div className="runbag-stat-grid">
                  <span>生命 <b>{ace.stats.hp}</b></span>
                  <span>魔力 <b>{ace.stats.mp}</b></span>
                  <span>攻击 <b>{ace.stats.atk}</b></span>
                  <span>防御 <b>{ace.stats.def}</b></span>
                  <span>法抗 <b>{ace.stats.mres}%</b></span>
                  <span>速度 <b>{spdText(ace.stats.spdMin, ace.stats.spdMax)}</b></span>
                </div>
                <h4>技能</h4>
                <div className="runbag-relics">
                  {ace.skills.map((sk, i) => (
                    <div className="relic-row" key={i}>
                      <b className="relic-name">{sk.name} {sk.kind === 'passive' ? <span className="relic-stack">被动</span> : <span className="relic-stack">主动 · MP {sk.mpCost}</span>}</b>
                      <span className="relic-desc">{sk.desc}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="runbag-stats-head">
                  <h4>{showOuter ? '局外面板（含遗物加成）' : '原始面板（仅穿戴藏品）'}</h4>
                  <label className="bp-relic-toggle">
                    <input type="checkbox" checked={showOuter} onChange={(e) => setShowOuter(e.target.checked)} />
                    显示遗物加成
                  </label>
                </div>
                <div className="runbag-stat-grid">
                  <span>生命 <b>{shown!.hp}</b>{deltaOf('hp') !== 0 && <i className="bp-relic-delta">+{deltaOf('hp')}</i>}</span>
                  <span>魔力 <b>{shown!.mp}</b>{deltaOf('mp') !== 0 && <i className="bp-relic-delta">+{deltaOf('mp')}</i>}</span>
                  <span>攻击 <b>{shown!.atk}</b>{deltaOf('atk') !== 0 && <i className="bp-relic-delta">+{deltaOf('atk')}</i>}</span>
                  <span>防御 <b>{shown!.def}</b>{deltaOf('def') !== 0 && <i className="bp-relic-delta">+{deltaOf('def')}</i>}</span>
                  <span>法抗 <b>{shown!.mres}%</b>{deltaOf('mres') !== 0 && <i className="bp-relic-delta">+{deltaOf('mres')}</i>}</span>
                  <span>速度 <b>{spdText(shown!.spdMin, shown!.spdMax)}</b></span>
                </div>
                <h4>额外6维</h4>
                <div className="runbag-stat-grid">
                  {EXTRA_KEYS.map((k) => (
                    <span key={k}>
                      {EXTRA_LABELS[k]} <b>{c!.extra[k] + (extraEquipSum[k] ?? 0) + (sixRelic[k] ?? 0)}</b>
                      {(extraEquipSum[k] ?? 0) > 0 && <i className="bp-relic-delta">+{extraEquipSum[k]}</i>}
                      {(sixRelic[k] ?? 0) > 0 && <i className="bp-relic-delta">+{sixRelic[k]}<span className="delta-src">遗</span></i>}
                    </span>
                  ))}
                </div>
                <h4>增伤 / 减伤<span className="muted small">（藏品+遗物常驻生效；其余由战斗中 BUFF 动态计算）</span></h4>
                <div className="runbag-stat-grid">
                  <span>物理增伤 <b>{pctText(relicMods.physAmp + itemDmgAmp.phys)}</b></span>
                  <span>法术增伤 <b>{pctText(relicMods.magicAmp + itemDmgAmp.magic)}</b></span>
                  <span>全能增伤 <b>0%</b></span>
                  <span>真实增伤 <b>0%</b></span>
                  <span>全能减伤 <b>{pctText(relicMods.allRed)}</b></span>
                  <span>真实减伤 <b>0%</b></span>
                  <span>物理减伤 <b>0%</b></span>
                  <span>法术减伤 <b>0%</b></span>
                </div>
                <p className="muted small">
                  原始面板 = 基础 + 等级 + 穿戴藏品；局外面板 = 原始 × (1 + 遗物百分比) + 遗物固定值 + 水晶层数加成。
                  当前生命水晶 {crystal.life} 层（+{crystal.life * 20} 生命上限）· 魔力水晶 {crystal.mana} 层（+{crystal.mana * 10} 魔力上限）。
                </p>
              </>
            )}
          </div>
        </div>

        {/* 列B：穿戴 + 道具 */}
        <div className="runbag-col">
          <div className="runbag-panel card">
            {isAce ? (
              <p className="muted small">王牌单位为临时队友，无穿戴与道具栏。</p>
            ) : (
              <>
                <h4>穿戴</h4>
                <div className="bp-equip-grid">
                  {EQUIP_SLOTS.map((s) => {
                    const curId = currentOf(s.key);
                    const item = curId ? itemMap.get(curId) : undefined;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        className="bp-slot"
                        style={item ? { borderColor: RARITY_COLORS[item.rarity] } : undefined}
                        onClick={() => item ? setDetail({ itemId: item.id }) : undefined}
                        title={item ? item.name : '空'}
                      >
                        {item
                          ? <Sprite className="bp-slot-icon" src={itemIcon(item.slot, item.icon)} alt={item.name} />
                          : <span className="bp-slot-empty">＋</span>}
                        <div className="bp-slot-main">
                          <span className="runbag-slot-label">{s.label}</span>
                          {item
                            ? <span className="runbag-slot-name" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}</span>
                            : <span className="muted small">空</span>}
                        </div>
                      </button>
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
                        {it.usable && (
                          <button className="btn-mini" onClick={() => setPotion({ owner: c!, item: it })}>使用</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 列C：藏品 + 遗物 */}
        <div className="runbag-col">
          <div className="runbag-panel card">
            {!isAce && (
              <>
                <h4>藏品（点击穿戴）</h4>
                <div className="bp-own-grid">
                  {owned.length === 0 && <span className="muted small">背包里没有藏品。</span>}
                  {owned.map((it, i) => {
                    const locked = slotLocked(it);
                    return (
                      <button
                        key={`${it.id}_${i}`}
                        type="button"
                        className={`bp-own-item ${locked ? 'locked' : ''}`}
                        style={{ borderColor: RARITY_COLORS[it.rarity] }}
                        onClick={() => setDetail({ itemId: it.id })}
                        title={locked ? (it.slot === 'weapon' ? '职业武器类型不符' : `需要 Lv.${it.level}`) : it.name}
                      >
                        <Sprite className="runbag-item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                        <span className="bp-own-name" style={{ color: RARITY_COLORS[it.rarity] }}>{it.name}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <h4>本次副本遗物（{run.relics?.length ?? 0}）</h4>
            <div className="runbag-relics">
              {(run.relics ?? []).length === 0 && <span className="muted small">还没有遗物。</span>}
              {(run.relics ?? []).map((rid) => {
                const r = RELIC_MAP[rid];
                if (!r) return null;
                const isLife = rid === 'rl_life_crystal';
                const isMana = rid === 'rl_mana_crystal';
                const isLetter = rid === 'rl_pain_village_letter';
                const letterStacks = run.plagueLetterStacks ?? 0;
                const letterHpDown = isLetter ? Math.round(plagueLetterHpDown(run) * 100) : 0;
                return (
                  <div className="relic-row" key={rid}>
                    <b className="relic-name" style={{ color: RARITY_COLORS[r.rarity] }}>
                      {r.name}
                      {isLife && <span className="relic-stack">当前 {crystal.life} 层 · +{crystal.life * 20} 生命上限</span>}
                      {isMana && <span className="relic-stack">当前 {crystal.mana} 层 · +{crystal.mana * 10} 魔力上限</span>}
                      {isLetter && <span className="relic-stack">当前 {letterStacks} 层 · 最大生命-{letterHpDown}%</span>}
                      {isUnimplemented(r) && <span className="relic-badge">未实装</span>}
                    </b>
                    <span className="relic-desc">{r.desc}</span>
                  </div>
                );
              })}
            </div>
            <p className="muted small">
              遗物仅本次副本生效，通关/团灭后消失。穿戴与道具变更立即保存，下场战斗生效。
            </p>
          </div>
        </div>
      </div>

      {/* 物品详情 */}
      {detail && (() => {
        const item = itemMap.get(detail.itemId);
        if (!item) { setDetail(null); return null; }
        const wornKey = EQUIP_SLOTS.find((s) => currentOf(s.key) === item.id);
        const equippable = ['weapon', 'helmet', 'armor', 'boots', 'accessory'].includes(item.slot);
        return (
          <Modal title={item.name} onClose={() => setDetail(null)}>
            <div className="bag-detail">
              <Sprite className="item-icon" src={itemIcon(item.slot, item.icon)} alt={item.name} />
              <div>
                <div style={{ color: RARITY_COLORS[item.rarity] }}>
                  {RARITY_LABELS[item.rarity]} · {SLOT_LABELS[item.slot]}
                  {item.level ? ` · 需Lv.${item.level}` : ''}
                  {item.slot === 'weapon' ? ` · ${WEAPON_TYPE_LABELS[item.weaponType ?? 'melee']}` : ''}
                </div>
                <div className="muted">{item.desc}</div>
                <div>{bonusLines(item).join('，') || '无特殊效果'}</div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDetail(null)}>关闭</button>
              {wornKey && (
                <button className="btn btn-danger" onClick={() => doUnequip(wornKey.key)}>卸下</button>
              )}
              {!wornKey && equippable && (
                <button
                  className="btn primary"
                  disabled={slotLocked(item)}
                  onClick={() => doEquip(item.id)}
                >
                  穿戴
                </button>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* 药水目标选择 */}
      {potion && (
        <Modal title={`使用 ${potion.item.name}`} onClose={() => setPotion(null)}>
          <p className="muted small">选择目标（恢复 {potion.item.usable?.hp ? `${potion.item.usable.hp} 生命` : ''}{potion.item.usable?.hp && potion.item.usable?.mp ? ' / ' : ''}{potion.item.usable?.mp ? `${potion.item.usable.mp} 魔力` : ''}）：</p>
          <div className="runbag-targets">
            {members.map((m) => {
              const cc = run.hpMp[m.id] ?? { hp: 0, mp: 0 };
              const mm = memberMax(m.id);
              return (
                <button key={m.id} className="btn runbag-target" onClick={() => applyPotion(m.id)}>
                  {m.name}
                  <span className="btn-sub">HP {cc.hp}/{mm.hp} · MP {cc.mp}/{mm.mp}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </Modal>
  );
}
