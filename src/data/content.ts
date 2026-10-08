import type { Item, MonsterUnit, SaveData } from '../types';
import { ITEMS } from './items';
import { baseItemId, enhanceOf, ENHANCE_BONUS, ENHANCEABLE_SLOTS } from '../types';

type CustomSource = Pick<SaveData, 'customItems'>;
type MonsterSource = Pick<SaveData, 'customMonsters'>;

export const allItems = (s: CustomSource): Item[] => {
  const overrides = (s as SaveData).itemPoolOverrides;
  if (!overrides) return [...ITEMS, ...s.customItems];
  return [...ITEMS, ...s.customItems].map((i) =>
    overrides[i.id] !== undefined ? { ...i, inPool: overrides[i.id] } : i,
  );
};
// itemMap.get 自动剥离强化后缀（"it_xxx+5" → "it_xxx"），并把强化属性加成合并进 bonuses
export const itemMapOf = (s: CustomSource): Map<string, Item> => {
  const map = new Map(allItems(s).map((i) => [i.id, i]));
  const origGet = map.get.bind(map);
  map.get = (id: string): Item | undefined => {
    const base = origGet(baseItemId(id));
    if (!base) return undefined;
    const enhance = enhanceOf(id);
    if (enhance <= 0 || (base.level ?? 0) < 30 || !ENHANCEABLE_SLOTS.includes(base.slot)) return base;
    const bonus = ENHANCE_BONUS[base.slot as 'weapon' | 'helmet' | 'armor'];
    if (!bonus) return base;
    const merged: Record<string, number> = { ...(base.bonuses ?? {}) };
    for (const k of Object.keys(bonus) as (keyof typeof bonus)[]) {
      merged[k] = (merged[k] ?? 0) + (bonus[k] ?? 0) * enhance;
    }
    return { ...base, bonuses: merged };
  };
  return map;
};

// 怪物以存档为唯一事实源：loadSave 时会播种内置名单，图鉴内可直接改数值或删除。
export const allEnemies = (s: MonsterSource): MonsterUnit[] => s.customMonsters;
export const enemyMapOf = (s: MonsterSource) => new Map(allEnemies(s).map((m) => [m.id, m]));

export { ITEMS };
