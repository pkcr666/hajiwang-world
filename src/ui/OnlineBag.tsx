// 联机个人背包：展示结构与交互完全对齐单人版 RunBag（runbag-*/bp-* 样式类复用）
// 数据由服务端权威下发（BagView），穿戴/卸下通过回调上报服务端执行
import { useMemo, useState } from 'react';
import type { BagView, BagItemBrief } from '../net/proto';
import { EXTRA_KEYS } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES, itemIcon } from '../assets/config';
import { isUnimplemented, RELIC_MAP } from '../data/relics';
import { plagueLetterHpDown } from '../engine/run';
import { crystalStacksOf } from '../engine/stats';
import { Modal } from '../components/Modal';
import { Sprite } from '../components/Sprite';
import {
  EXTRA_LABELS, RARITY_COLORS, RARITY_LABELS, SLOT_LABELS, spdText, WEAPON_TYPE_LABELS,
} from './labels';

const EQUIP_SLOTS: { key: string; label: string }[] = [
  { key: 'weapon', label: '武器' },
  { key: 'helmet', label: '头盔' },
  { key: 'armor', label: '防具' },
  { key: 'boots', label: '靴子' },
  { key: 'acc1', label: '饰品1' },
  { key: 'acc2', label: '饰品2' },
];

const RARITY_ORDER: Record<string, number> = {
  legendary: 5, epic: 4, rare: 3, fine: 2, uncommon: 1, common: 0,
};

// BagView 里的 rarity/job/slot 是 string，转为强类型索引
const rarityColor = (r: string) => RARITY_COLORS[r as keyof typeof RARITY_COLORS] ?? '#9fb0d8';
const slotLabel = (s: string) => SLOT_LABELS[s as keyof typeof SLOT_LABELS] ?? s;

export function OnlineBag({ bag, err, onEquip, onUnequip, onClose }: {
  bag: BagView;
  err: string | null;
  onEquip: (itemId: string) => void;
  onUnequip: (slot: string) => void;
  onClose: () => void;
}) {
  const [showOuter, setShowOuter] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);

  const job = JOB_DEFS[bag.job as keyof typeof JOB_DEFS];
  const shown = showOuter ? bag.stats : bag.baseStats;
  const deltaOf = (k: 'hp' | 'mp' | 'atk' | 'def' | 'mres') =>
    showOuter ? bag.stats[k] - bag.baseStats[k] : 0;
  const crystal = crystalStacksOf(bag.relicIds, bag.relicStacks);
  const letterStacks = bag.plagueLetterStacks ?? 0;
  const letterHpDown = bag.relicIds.includes('rl_pain_village_letter')
    ? Math.round(plagueLetterHpDown({ plagueLetterStacks: letterStacks } as never) * 100) : 0;
  const pctText = (v: number) => `${Math.round(v * 100)}%`;

  // 藏品（局外背包 + 联机获得）合并，按稀有度排序；材料（强化石等）不属于藏品
  const owned = useMemo<BagItemBrief[]>(() => {
    const ids = [...(bag.inventory ?? []), ...(bag.perItems ?? [])];
    return ids.map((id) => bag.items[id]).filter((x): x is BagItemBrief => !!x && x.slot !== 'material')
      .sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]);
  }, [bag]);

  const briefOf = (id: string | null): BagItemBrief | undefined =>
    id ? bag.items[id] : undefined;
  const wornKey = detail ? EQUIP_SLOTS.find((s) => briefOf(bag.equip[s.key])?.id === detail) : undefined;
  const curItem = detail ? briefOf(detail) : undefined;
  const equippable = curItem ? ['weapon', 'helmet', 'armor', 'boots', 'accessory'].includes(curItem.slot) : false;
  const weaponOk = (it: BagItemBrief) =>
    !job || it.slot !== 'weapon' || job.allowedWeaponTypes.includes((it.weaponType ?? 'melee') as Parameters<typeof job.allowedWeaponTypes.includes>[0]);
  const levelOk = (it: BagItemBrief) => (it.level ?? 0) <= (bag.level ?? 1);
  const slotLocked = (it: BagItemBrief) => !weaponOk(it) || !levelOk(it);

  return (
    <Modal title={`我的背包 · ${bag.name}`} onClose={onClose} xwide>
      {err && <div className="warn">{err}</div>}

      <div className="runbag-hero">
        <Sprite className="head-job-icon" src={JOB_IMAGES[bag.job]} alt={job?.name} />
        <b>{bag.name}</b>
        <span className="muted small">Lv.{bag.level} {job?.name}</span>
        <span className="runbag-hpmp">HP {bag.hp}/{bag.maxHp} · MP {bag.mp}/{bag.maxMp}</span>
        <div className="bp-hero-stats">
          <span>攻击 <b>{shown.atk}</b></span>
          <span>防御 <b>{shown.def}</b></span>
          <span>法抗 <b>{shown.mres}%</b></span>
          <span>速度 <b>{spdText(shown.spdMin, shown.spdMax)}</b></span>
        </div>
      </div>

      <div className="runbag-grid">
        {/* 列0：材料背包 */}
        <div className="runbag-col">
          <div className="runbag-panel card">
            <h4>材料背包<span className="muted small">· 本次副本已获得（通关后一人一份入各成员独有仓库）</span></h4>
            <div className="runbag-inv">
              {(bag.materials ?? []).length === 0 && <span className="muted small">还没有获得材料。</span>}
              {(bag.materials ?? []).map((m) => {
                const it = bag.items[m.itemId];
                if (!it) return null;
                return (
                  <div key={m.itemId} className="runbag-item static" style={{ borderColor: rarityColor(it.rarity) }} title={it.name}>
                    <Sprite className="runbag-item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                    <span className="runbag-item-name" style={{ color: rarityColor(it.rarity) }}>{it.name}</span>
                    <span className="muted small">×{m.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 列A：属性总览 */}
        <div className="runbag-col">
          <div className="runbag-stats card">
            <div className="runbag-stats-head">
              <h4>{showOuter ? '局外面板（含遗物加成）' : '原始面板（仅穿戴藏品）'}</h4>
              <label className="bp-relic-toggle">
                <input type="checkbox" checked={showOuter} onChange={(e) => setShowOuter(e.target.checked)} />
                显示遗物加成
              </label>
            </div>
            <div className="runbag-stat-grid">
              <span>生命 <b>{shown.hp}</b>{deltaOf('hp') !== 0 && <i className="bp-relic-delta">+{deltaOf('hp')}</i>}</span>
              <span>魔力 <b>{shown.mp}</b>{deltaOf('mp') !== 0 && <i className="bp-relic-delta">+{deltaOf('mp')}</i>}</span>
              <span>攻击 <b>{shown.atk}</b>{deltaOf('atk') !== 0 && <i className="bp-relic-delta">+{deltaOf('atk')}</i>}</span>
              <span>防御 <b>{shown.def}</b>{deltaOf('def') !== 0 && <i className="bp-relic-delta">+{deltaOf('def')}</i>}</span>
              <span>法抗 <b>{shown.mres}%</b>{deltaOf('mres') !== 0 && <i className="bp-relic-delta">+{deltaOf('mres')}</i>}</span>
              <span>速度 <b>{spdText(shown.spdMin, shown.spdMax)}</b></span>
            </div>
            <h4>额外6维</h4>
            <div className="runbag-stat-grid">
              {EXTRA_KEYS.map((k) => (
                <span key={k}>
                  {EXTRA_LABELS[k]} <b>{(bag.extra[k] ?? 10) + (bag.extraEquip[k] ?? 0) + (bag.sixRelic[k] ?? 0)}</b>
                  {(bag.extraEquip[k] ?? 0) > 0 && <i className="bp-relic-delta">+{bag.extraEquip[k]}</i>}
                  {(bag.sixRelic[k] ?? 0) > 0 && <i className="bp-relic-delta">+{bag.sixRelic[k]}<span className="delta-src">遗</span></i>}
                </span>
              ))}
            </div>
            <h4>增伤 / 减伤<span className="muted small">（藏品+遗物常驻生效；其余由战斗中 BUFF 动态计算）</span></h4>
            <div className="runbag-stat-grid">
              <span>物理增伤 <b>{pctText(bag.relicMods.physAmp + bag.itemDmgAmp.phys)}</b></span>
              <span>法术增伤 <b>{pctText(bag.relicMods.magicAmp + bag.itemDmgAmp.magic)}</b></span>
              <span>全能增伤 <b>0%</b></span>
              <span>真实增伤 <b>0%</b></span>
              <span>全能减伤 <b>{pctText(bag.relicMods.allRed)}</b></span>
              <span>真实减伤 <b>0%</b></span>
              <span>物理减伤 <b>0%</b></span>
              <span>法术减伤 <b>0%</b></span>
            </div>
            <p className="muted small">
              原始面板 = 基础 + 等级 + 穿戴藏品；局外面板 = 原始 × (1 + 遗物百分比) + 遗物固定值 + 水晶层数加成。
              当前生命水晶 {crystal.life} 层（+{crystal.life * 20} 生命上限）· 魔力水晶 {crystal.mana} 层（+{crystal.mana * 10} 魔力上限）。
            </p>
          </div>
        </div>

        {/* 列B：穿戴 + 道具 */}
        <div className="runbag-col">
          <div className="runbag-panel card">
            <h4>穿戴</h4>
            <div className="bp-equip-grid">
              {EQUIP_SLOTS.map((s) => {
                const item = briefOf(bag.equip[s.key]);
                return (
                  <button
                    key={s.key}
                    type="button"
                    className="bp-slot"
                    style={item ? { borderColor: rarityColor(item.rarity) } : undefined}
                    onClick={() => (item ? setDetail(item.id) : undefined)}
                    title={item ? item.name : '空'}
                  >
                    {item
                      ? <Sprite className="bp-slot-icon" src={itemIcon(item.slot, item.icon)} alt={item.name} />
                      : <span className="bp-slot-empty">＋</span>}
                    <div className="bp-slot-main">
                      <span className="runbag-slot-label">{s.label}</span>
                      {item
                        ? <span className="runbag-slot-name" style={{ color: rarityColor(item.rarity) }}>{item.name}</span>
                        : <span className="muted small">空</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            <h4>道具（消耗品）</h4>
            <div className="runbag-inv">
              {(bag.bag ?? []).length === 0 && <span className="muted small">没有携带道具。</span>}
              {(bag.bag ?? []).map((g) => {
                const it = bag.items[g.itemId];
                if (!it) return null;
                return (
                  <div key={g.itemId} className="runbag-item static" style={{ borderColor: rarityColor(it.rarity) }}>
                    <Sprite className="runbag-item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                    <span className="runbag-item-name" style={{ color: rarityColor(it.rarity) }}>{it.name}</span>
                    <span className="muted small">×{g.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 列C：藏品 + 遗物 */}
        <div className="runbag-col">
          <div className="runbag-panel card">
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
                    style={{ borderColor: rarityColor(it.rarity) }}
                    onClick={() => setDetail(it.id)}
                    title={locked ? (it.slot === 'weapon' ? '职业武器类型不符' : `需要 Lv.${it.level}`) : it.name}
                  >
                    <Sprite className="runbag-item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                    <span className="bp-own-name" style={{ color: rarityColor(it.rarity) }}>{it.name}</span>
                  </button>
                );
              })}
            </div>

            <h4>本次副本遗物（{bag.relicIds?.length ?? 0}）</h4>
            <div className="runbag-relics">
              {(bag.relicIds ?? []).length === 0 && <span className="muted small">还没有遗物。</span>}
              {(bag.relicIds ?? []).map((rid) => {
                const r = RELIC_MAP[rid];
                if (!r) return null;
                const isLife = rid === 'rl_life_crystal';
                const isMana = rid === 'rl_mana_crystal';
                const isLetter = rid === 'rl_pain_village_letter';
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
      {detail && curItem && (
        <Modal title={curItem.name} onClose={() => setDetail(null)}>
          <div className="bag-detail">
            <Sprite className="item-icon" src={itemIcon(curItem.slot, curItem.icon)} alt={curItem.name} />
            <div>
              <div style={{ color: rarityColor(curItem.rarity) }}>
                {(RARITY_LABELS[curItem.rarity as keyof typeof RARITY_LABELS] ?? curItem.rarity)} · {slotLabel(curItem.slot)}
                {curItem.level ? ` · 需Lv.${curItem.level}` : ''}
                {curItem.slot === 'weapon' ? ` · ${WEAPON_TYPE_LABELS[curItem.weaponType as keyof typeof WEAPON_TYPE_LABELS] ?? curItem.weaponType}` : ''}
              </div>
              <div className="muted">{curItem.desc}</div>
              <div>{(curItem.bonus ?? []).join('，') || '无特殊效果'}</div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDetail(null)}>关闭</button>
            {wornKey && (
              <button className="btn btn-danger" onClick={() => { onUnequip(wornKey.key); setDetail(null); }}>卸下</button>
            )}
            {!wornKey && equippable && (
              <button
                className="btn primary"
                disabled={slotLocked(curItem)}
                onClick={() => { onEquip(curItem.id); setDetail(null); }}
              >
                穿戴
              </button>
            )}
          </div>
        </Modal>
      )}
    </Modal>
  );
}
