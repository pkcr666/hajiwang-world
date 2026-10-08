import { useMemo, useState } from 'react';
import type { Character, Equip, Job, SaveData, Slot } from '../types';
import { JOB_DEFS, STARTER_SLOT } from '../data/jobs';
import { allItems } from '../data/content';
import { RELICS } from '../data/relics';
import { newId } from '../save/storage';
import { START_EXTRA, validateExtra, LEVEL_BASE } from '../engine/stats';
import { Modal } from '../components/Modal';
import { ExtraAllocator } from '../components/ExtraAllocator';
import { RARITY_COLORS, RARITY_LABELS, SLOT_LABELS } from '../ui/labels';

const JOBS: Job[] = ['cat', 'typhon', 'kayn', 'logos', 'dandan', 'masked', 'augusta', 'lee', 'donk', 'exusiai', 'eimis', 'rein'];
type EquipSlotKey = 'weapon' | 'helmet' | 'armor' | 'boots' | 'acc1' | 'acc2';

export function TestCharEditor({ save, onClose, onSave }: {
  save: SaveData;
  onClose: () => void;
  onSave: (c: Character) => void;
}) {
  const items = useMemo(() => allItems(save), [save]);
  const [job, setJob] = useState<Job>('cat');
  const [name, setName] = useState('测试勇者');
  const [level, setLevel] = useState(LEVEL_BASE);
  const [extra, setExtra] = useState({ ...START_EXTRA, str: 30, int: 30, agi: 30, luk: 30 });
  const [equip, setEquip] = useState<Equip>(() => starterEquip('cat'));
  const [relicIds, setRelicIds] = useState<string[]>([]);
  const [bag, setBag] = useState<Character['bag']>([]);

  const changeJob = (j: Job) => {
    setJob(j);
    setEquip(starterEquip(j));
  };

  const setSlot = (key: EquipSlotKey, itemId: string | null) => {
    setEquip((e) => {
      if (key === 'acc1' || key === 'acc2') {
        const accessory: [string | null, string | null] = [...e.accessory];
        accessory[key === 'acc1' ? 0 : 1] = itemId;
        return { ...e, accessory };
      }
      return { ...e, [key]: itemId };
    });
  };

  const getSlot = (key: EquipSlotKey): string | null =>
    key === 'acc1' ? equip.accessory[0] : key === 'acc2' ? equip.accessory[1] : equip[key];

  const consumables = items.filter((i) => i.slot === 'consumable');
  const countOf = (id: string) => bag.find((b) => b.itemId === id)?.count ?? 0;
  const changeBag = (id: string, delta: number) => {
    setBag((old) => {
      const next = old.map((b) => ({ ...b }));
      const g = next.find((b) => b.itemId === id);
      if (!g) {
        if (delta > 0) next.push({ itemId: id, count: 1 });
      } else {
        g.count = Math.max(0, Math.min(9, g.count + delta));
      }
      return next.filter((b) => b.count > 0);
    });
  };

  const valid = name.trim().length > 0 && name.trim().length <= 8 && validateExtra(extra);

  const submit = () => {
    if (!valid) return;
    onSave({
      id: newId('testchar'),
      name: name.trim(),
      job,
      level,
      extra: { ...extra },
      baseExtra: { ...extra },
      equip: structuredClone(equip),
      relics: [...relicIds],
      inventory: [],
      bag: bag.map((b) => ({ ...b })),
      storage: [],
      coins: 0,
      createdAt: Date.now(),
      test: true,
    });
  };

  const slotOptions = (slot: Slot) => {
    if (slot === 'weapon') {
      const allowed = JOB_DEFS[job].allowedWeaponTypes;
      return items.filter((i) => i.slot === 'weapon' && allowed.includes(i.weaponType ?? 'melee'));
    }
    return items.filter((i) => i.slot === slot);
  };

  return (
    <Modal title="测试角色配置" onClose={onClose} wide>
      <div className="form-grid">
        <label>职业（决定技能组）
          <select className="input" value={job} onChange={(e) => changeJob(e.target.value as Job)}>
            {JOBS.map((j) => <option key={j} value={j}>{JOB_DEFS[j].name}</option>)}
          </select>
        </label>
        <label>名称<input className="input" value={name} maxLength={8} onChange={(e) => setName(e.target.value)} /></label>
        <label>等级
          <input
            className="input"
            type="number"
            min={1}
            max={90}
            value={level}
            onChange={(e) => setLevel(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
          />
        </label>
      </div>

      <h4>额外6维（80点）</h4>
      <ExtraAllocator value={extra} onChange={setExtra} />

      <h4>装备（藏品库自由搭配）</h4>
      <div className="form-grid">
        {(['weapon', 'helmet', 'armor', 'boots', 'acc1', 'acc2'] as EquipSlotKey[]).map((key) => (
          <label key={key}>
            {key === 'acc1' ? '饰品1' : key === 'acc2' ? '饰品2' : SLOT_LABELS[key]}
            <select className="input" value={getSlot(key) ?? ''} onChange={(e) => setSlot(key, e.target.value || null)}>
              <option value="">（空）</option>
              {slotOptions(key.startsWith('acc') ? 'accessory' : (key as Slot)).map((i) => (
                <option key={i.id} value={i.id} disabled={(i.level ?? 0) > level}>
                  {i.name}{i.level ? `（Lv.${i.level}）` : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <h4>遗物（可多选，无上限）</h4>
      <div className="relic-list">
        {RELICS.map((r) => {
          const on = relicIds.includes(r.id);
          return (
            <label
              key={r.id}
              className={`relic-row ${on ? 'relic-on' : ''}`}
              style={on ? { borderColor: RARITY_COLORS[r.rarity] } : undefined}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => setRelicIds((old) => on ? old.filter((x) => x !== r.id) : [...old, r.id])}
              />
              <span className="relic-name" style={{ color: RARITY_COLORS[r.rarity] }}>
                {r.name}
                <span className="muted small">（{RARITY_LABELS[r.rarity]} · {r.positive ? '正面' : '负面'}）</span>
              </span>
              <span className="muted small relic-desc">{r.desc}</span>
            </label>
          );
        })}
      </div>

      <h4>携带道具</h4>
      <div className="bag-editor">
        {consumables.map((i) => (
          <div key={i.id} className="bag-row">
            <span>{i.name}</span>
            <button className="btn-step" onClick={() => changeBag(i.id, -1)}>−</button>
            <b>{countOf(i.id)}</b>
            <button className="btn-step" onClick={() => changeBag(i.id, 1)}>＋</button>
          </div>
        ))}
      </div>

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!valid} onClick={submit}>保存测试角色</button>
      </div>
    </Modal>
  );
}

function starterEquip(job: Job): Equip {
  const equip: Equip = { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] };
  for (const id of JOB_DEFS[job].startItems) {
    const slot = STARTER_SLOT[id];
    if (slot === 'weapon') equip.weapon = id;
    else if (slot === 'helmet') equip.helmet = id;
    else if (slot === 'armor') equip.armor = id;
    else if (slot === 'boots') equip.boots = id;
  }
  return equip;
}
