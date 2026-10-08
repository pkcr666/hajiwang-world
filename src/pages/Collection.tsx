import { useMemo, useState } from 'react';
import type { BaseStats, ExtraStats, Item, Rarity, SaveData, Slot, WeaponType } from '../types';
import { EXTRA_KEYS } from '../types';
import { allItems } from '../data/content';
import { itemIcon } from '../assets/config';
import { addCustomItem, removeCustomItem, setItemInPool } from '../save/storage';
import { ItemCard } from '../components/ItemCard';
import { Modal } from '../components/Modal';
import { EXTRA_LABELS, RARITY_LABELS, SLOT_LABELS, SLOT_ORDER, STAT_LABELS, WEAPON_TYPE_LABELS } from '../ui/labels';

const BONUS_KEYS: (keyof BaseStats)[] = ['hp', 'mp', 'atk', 'def', 'mres', 'spdMin', 'spdMax'];

export function Collection({ save, onChange }: {
  save: SaveData;
  onChange: (s: SaveData) => void;
}) {
  const items = useMemo(() => allItems(save), [save]);
  const [slot, setSlot] = useState<Slot | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Item | null>(null);

  const shown = slot === 'all' ? items : items.filter((i) => i.slot === slot);

  return (
    <div className="page">
      <div className="page-head">
        <h2>藏品库（{items.length}）</h2>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setCreating(true)}>+ 自定义藏品</button>
        </div>
      </div>

      <div className="filter-row">
        <button className={`chip ${slot === 'all' ? 'chip-on' : ''}`} onClick={() => setSlot('all')}>全部</button>
        {SLOT_ORDER.map((s) => (
          <button key={s} className={`chip ${slot === s ? 'chip-on' : ''}`} onClick={() => setSlot(s)}>
            {SLOT_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="item-grid">
        {shown.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            onDelete={item.custom ? () => setDeleting(item) : undefined}
            onTogglePool={(inPool) => onChange(setItemInPool(save, item.id, inPool))}
          />
        ))}
      </div>

      {creating && (
        <ItemEditor
          onClose={() => setCreating(false)}
          onSave={(it) => { onChange(addCustomItem(save, it)); setCreating(false); }}
        />
      )}
      {deleting && (
        <Modal title="删除自定义藏品" onClose={() => setDeleting(null)}>
          <p>删除自定义藏品「{deleting.name}」？不影响已存档角色身上的配置。</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleting(null)}>取消</button>
            <button className="btn-danger" onClick={() => { onChange(removeCustomItem(save, deleting.id)); setDeleting(null); }}>
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ItemEditor({ onClose, onSave }: {
  onClose: () => void;
  onSave: (it: Omit<Item, 'id' | 'custom'>) => void;
}) {
  const [name, setName] = useState('');
  const [slot, setSlot] = useState<Slot>('weapon');
  const [rarity, setRarity] = useState<Rarity>('common');
  const [price, setPrice] = useState(20);
  const [level, setLevel] = useState(0);
  const [bonuses, setBonuses] = useState<BaseStats>({ hp: 0, mp: 0, atk: 0, def: 0, mres: 0, spdMin: 0, spdMax: 0 });
  const [extraBonus, setExtraBonus] = useState<ExtraStats>({ str: 0, int: 0, agi: 0, luk: 0, cha: 0, wil: 0 });
  const [weaponType, setWeaponType] = useState<WeaponType>('melee');
  const [basicAttackMagic, setBasicAttackMagic] = useState(false);
  const [onHitMagicBonus, setOnHitMagicBonus] = useState(0);
  const [usable, setUsable] = useState({ hp: 0, mp: 0, shield: 0 });
  const [iconPath, setIconPath] = useState('');
  const [inPool, setInPool] = useState(true);

  const isConsumable = slot === 'consumable';
  const isWeapon = slot === 'weapon';
  const isAccessory = slot === 'accessory';

  const setBonus = (k: keyof BaseStats, v: number) => setBonuses((b) => ({ ...b, [k]: Math.max(0, Math.round(v)) }));
  const setExtra = (k: keyof ExtraStats, v: number) => setExtraBonus((b) => ({ ...b, [k]: Math.max(0, Math.round(v)) }));

  const hasBonus = Object.values(bonuses).some((v) => v > 0);
  const hasExtra = Object.values(extraBonus).some((v) => v > 0);
  const valid =
    name.trim().length > 0 &&
    (!isConsumable || usable.hp > 0 || usable.mp > 0 || usable.shield > 0) &&
    (isConsumable || hasBonus || hasExtra || (isWeapon && (basicAttackMagic || onHitMagicBonus > 0)));

  const save = () => {
    if (!valid) return;
    const pickedBonus = Object.fromEntries(Object.entries(bonuses).filter(([, v]) => v > 0)) as Partial<BaseStats>;
    const pickedExtra = Object.fromEntries(Object.entries(extraBonus).filter(([, v]) => v > 0)) as Partial<ExtraStats>;
    const pickedUsable = isConsumable
      ? Object.fromEntries(Object.entries(usable).filter(([, v]) => v > 0))
      : undefined;
    const passives: Item['passives'] = {};
    if (basicAttackMagic) passives.basicAttackMagic = true;
    if (onHitMagicBonus > 0) passives.onHitMagicBonus = onHitMagicBonus;
    const descParts: string[] = [];
    for (const [k, v] of Object.entries(pickedBonus)) descParts.push(`${STAT_LABELS[k]}+${v}`);
    for (const [k, v] of Object.entries(pickedExtra)) descParts.push(`${EXTRA_LABELS[k]}+${v}`);
    if (basicAttackMagic) descParts.push('普攻变为法术伤害');
    if (onHitMagicBonus > 0) descParts.push(`普攻额外造成${onHitMagicBonus}点法术伤害`);
    if (pickedUsable) {
      if (usable.hp) descParts.push(`回复${usable.hp}生命`);
      if (usable.mp) descParts.push(`回复${usable.mp}魔力`);
      if (usable.shield) descParts.push(`${usable.shield}护盾`);
    }
    onSave({
      name: name.trim(),
      slot,
      rarity,
      price: Math.max(0, price),
      level: Math.max(0, Math.round(level)),
      bonuses: isConsumable ? undefined : pickedBonus,
      extraBonus: isConsumable ? undefined : (hasExtra ? pickedExtra : undefined),
      weaponType: isWeapon ? weaponType : undefined,
      passives: Object.keys(passives).length ? passives : undefined,
      usable: pickedUsable as Item['usable'],
      desc: descParts.join('，'),
      icon: iconPath.trim() || itemIcon(slot),
      inPool,
    });
  };

  return (
    <Modal title="自定义藏品" onClose={onClose} wide>
      <div className="form-grid">
        <label>名称<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={10} /></label>
        <label>部位
          <select className="input" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>
            {SLOT_ORDER.filter((s) => s !== 'material').map((s) => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
          </select>
        </label>
        <label>稀有度
          <select className="input" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
            {(Object.keys(RARITY_LABELS) as Rarity[]).map((r) => <option key={r} value={r}>{RARITY_LABELS[r]}</option>)}
          </select>
        </label>
        <label>价格<input className="input" type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label>
        <label>装备等级<input className="input" type="number" min={0} value={level} onChange={(e) => setLevel(Number(e.target.value))} title="角色等级≥此值才能装备，0=无要求" /></label>
        <label className="form-wide">图片路径或URL（留空用默认图）
          <input className="input" value={iconPath} placeholder="/img/items/xxx.png 或 https://…"
            onChange={(e) => setIconPath(e.target.value)} />
        </label>
        <label className="form-wide radio-line">
          <input type="checkbox" checked={inPool} onChange={(e) => setInPool(e.target.checked)} />
          进入随机掉落池（关闭后该藏品不会在宝箱/随机掉落中出现，仍可手动装备）
        </label>
      </div>

      {!isConsumable && (
        <>
          <h4>属性加成</h4>
          <div className="form-grid">
            {BONUS_KEYS.map((k) => (
              <label key={k}>{STAT_LABELS[k]}
                <input className="input" type="number" min={0} value={bonuses[k]}
                  onChange={(e) => setBonus(k, Number(e.target.value))} />
              </label>
            ))}
          </div>
          {isAccessory && (
            <>
              <h4>额外6维加成</h4>
              <div className="form-grid">
                {EXTRA_KEYS.map((k) => (
                  <label key={k}>{EXTRA_LABELS[k]}
                    <input className="input" type="number" min={0} value={extraBonus[k]}
                      onChange={(e) => setExtra(k, Number(e.target.value))} />
                  </label>
                ))}
              </div>
            </>
          )}
          {isWeapon && (
            <>
              <h4>武器类型</h4>
              <div className="form-grid">
                <label>武器类型
                  <select className="input" value={weaponType} onChange={(e) => setWeaponType(e.target.value as WeaponType)}>
                    {(['melee', 'ranged', 'magic'] as WeaponType[]).map((w) => (
                      <option key={w} value={w}>{WEAPON_TYPE_LABELS[w]}</option>
                    ))}
                  </select>
                </label>
              </div>
              <h4>武器特效</h4>
              <label className="radio-line">
                <input type="checkbox" checked={basicAttackMagic} onChange={(e) => setBasicAttackMagic(e.target.checked)} /> 普攻变为法术伤害
              </label>
              <label>普攻额外法术伤害
                <input className="input" type="number" min={0} value={onHitMagicBonus}
                  onChange={(e) => setOnHitMagicBonus(Math.max(0, Number(e.target.value)))} />
              </label>
            </>
          )}
        </>
      )}

      {isConsumable && (
        <>
          <h4>使用效果（至少填一项）</h4>
          <div className="form-grid">
            <label>回复生命<input className="input" type="number" min={0} value={usable.hp} onChange={(e) => setUsable((u) => ({ ...u, hp: Math.max(0, Number(e.target.value)) }))} /></label>
            <label>回复魔力<input className="input" type="number" min={0} value={usable.mp} onChange={(e) => setUsable((u) => ({ ...u, mp: Math.max(0, Number(e.target.value)) }))} /></label>
            <label>护盾<input className="input" type="number" min={0} value={usable.shield} onChange={(e) => setUsable((u) => ({ ...u, shield: Math.max(0, Number(e.target.value)) }))} /></label>
          </div>
        </>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!valid} onClick={save}>保存</button>
      </div>
    </Modal>
  );
}
