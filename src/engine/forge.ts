import type { Item, SaveData, Rarity, ForgeRecipe } from '../types';
import {
  baseItemId, enhanceOf, withEnhance,
  ENHANCE_MAX, ENHANCE_RATES, enhanceStoneCount, ENHANCE_BONUS, ENHANCEABLE_SLOTS,
  mathRng,
} from '../types';
import { FORGE_RECIPES } from '../data/forgeRecipes';
import { itemMapOf } from '../data/content';
import { updateCharacterInventory, updateCharacterEquip, saveSave } from '../save/storage';

// ===== 材料统计（共享仓库 + 角色独享仓库）=====
// 通关结算会把材料/图纸按成员发到「角色独享仓库」(character.storage)，而商店购买/部分掉落进入
// 「共享材料仓库」(save.materials)。锻造炉读取与扣减时必须合并两处，否则仓库里有材料却显示 0。
export function countMaterial(save: SaveData, charId: string | null, itemId: string): number {
  const shared = save.materials.find((m) => m.itemId === itemId)?.count ?? 0;
  if (!charId) return shared;
  const c = save.characters.find((x) => x?.id === charId);
  const own = c ? (c.storage ?? []).find((g) => g.itemId === itemId)?.count ?? 0 : 0;
  return shared + own;
}

// 扣除材料：优先共享仓库，不够再从当前角色独享仓库扣
function consumeMaterial(next: SaveData, charId: string, itemId: string, count: number): void {
  let need = count;
  const shared = next.materials.find((m) => m.itemId === itemId);
  if (shared) {
    const take = Math.min(shared.count, need);
    shared.count -= take;
    need -= take;
    if (shared.count <= 0) next.materials = next.materials.filter((m) => m.itemId !== itemId);
  }
  if (need > 0) {
    const c = next.characters.find((x) => x?.id === charId);
    if (c && Array.isArray(c.storage)) {
      const g = c.storage.find((x) => x.itemId === itemId);
      if (g) {
        g.count -= need;
        c.storage = c.storage.filter((x) => x.count > 0);
      }
    }
  }
}

// ===== 强化石映射 =====
const STONE_BY_RARITY: Record<Rarity, string | null> = {
  common: null, uncommon: null, fine: null,
  rare: 'it_stone_rare', epic: 'it_stone_epic', legendary: 'it_stone_legendary',
};

// 统计某角色可用于强化的全部物品（装备中 + 背包藏品）
export interface EnhanceCandidate {
  ref: string; // 物品引用ID（可能带 +N 后缀）
  item: Item;
  enhance: number;
  equipped: boolean;
  equipSlot?: 'weapon' | 'helmet' | 'armor';
}

export function listEnhanceCandidates(save: SaveData, charId: string): EnhanceCandidate[] {
  const c = save.characters.find((x) => x?.id === charId);
  if (!c) return [];
  const itemMap = itemMapOf(save);
  const out: EnhanceCandidate[] = [];
  const push = (ref: string, equipped: boolean, slot?: 'weapon' | 'helmet' | 'armor') => {
    const it = itemMap.get(ref);
    if (!it) return;
    out.push({ ref, item: it, enhance: enhanceOf(ref), equipped, equipSlot: slot });
  };
  // 装备中的武器/头盔/防具
  for (const slot of ['weapon', 'helmet', 'armor'] as const) {
    const ref = c.equip[slot];
    if (ref) push(ref, true, slot);
  }
  // 背包中的武器/头盔/防具
  for (const ref of c.inventory ?? []) {
    const it = itemMap.get(ref);
    if (!it) continue;
    if (ENHANCEABLE_SLOTS.includes(it.slot)) push(ref, false);
  }
  return out;
}

// 是否可强化
export function canEnhance(item: Item, currentEnhance: number): { ok: boolean; reason?: string } {
  if (!ENHANCEABLE_SLOTS.includes(item.slot)) return { ok: false, reason: '仅武器、头盔、防具可强化' };
  if ((item.level ?? 0) < 30) return { ok: false, reason: '仅30级以上藏品可强化' };
  const max = ENHANCE_MAX[item.rarity];
  if (max <= 0) return { ok: false, reason: '该品质藏品无法强化' };
  if (currentEnhance >= max) return { ok: false, reason: `已达强化上限 +${max}` };
  return { ok: true };
}

// 强化所需强化石
export function enhanceCost(item: Item, currentEnhance: number): { stoneId: string; count: number } | null {
  const target = currentEnhance + 1;
  const stoneId = STONE_BY_RARITY[item.rarity];
  if (!stoneId) return null;
  return { stoneId, count: enhanceStoneCount(target) };
}

export interface EnhanceResult {
  save: SaveData;
  success: boolean;
  newEnhance: number;
  downgraded: boolean;
  ref: string;
}

// 执行强化
export function doEnhance(save: SaveData, charId: string, ref: string): EnhanceResult | { error: string } {
  const c = save.characters.find((x) => x?.id === charId);
  if (!c) return { error: '角色不存在' };
  const itemMap = itemMapOf(save);
  const item = itemMap.get(ref);
  if (!item) return { error: '物品不存在' };
  const cur = enhanceOf(ref);
  const check = canEnhance(item, cur);
  if (!check.ok) return { error: check.reason ?? '无法强化' };

  const cost = enhanceCost(item, cur);
  if (!cost) return { error: '无法强化' };
  // 检查共享材料仓库与当前角色独享仓库中的强化石
  const have = countMaterial(save, charId, cost.stoneId);
  if (have < cost.count) {
    return { error: `${itemMap.get(cost.stoneId)?.name ?? '强化石'}不足（需${cost.count}个，现有${have}个）` };
  }

  const target = cur + 1;
  const rate = ENHANCE_RATES[target - 1] ?? 0;
  const roll = Math.random();
  const success = roll < rate;

  const next = structuredClone(save);
  const nc = next.characters.find((x) => x?.id === charId)!;
  // 扣除强化石（优先共享仓库，不足从角色独享仓库扣）
  consumeMaterial(next, charId, cost.stoneId, cost.count);

  let newEnhance: number;
  let downgraded = false;
  if (success) {
    newEnhance = target;
  } else {
    // +5 以上失败降级
    if (cur >= 5) {
      newEnhance = Math.max(0, cur - 1);
      downgraded = true;
    } else {
      newEnhance = cur;
    }
  }

  const newRef = withEnhance(baseItemId(ref), newEnhance);
  // 替换装备中或背包中的引用
  const slot = ['weapon', 'helmet', 'armor'].find((s) => nc.equip[s as 'weapon'] === ref) as 'weapon' | 'helmet' | 'armor' | undefined;
  if (slot) {
    nc.equip[slot] = newRef;
    updateCharacterEquip(next, charId, nc.equip);
  } else {
    const inv = [...(nc.inventory ?? [])];
    const idx = inv.indexOf(ref);
    if (idx >= 0) inv[idx] = newRef;
    updateCharacterInventory(next, charId, inv);
  }

  return { save: next, success, newEnhance, downgraded, ref: newRef };
}

// ===== 锻造 =====

// 获取某角色可用的锻造材料列表（共享仓库 + 该角色独享仓库中 materialKind==='forge' 的材料）
export function listForgeMaterials(save: SaveData, charId?: string | null): { itemId: string; item: Item; count: number }[] {
  const itemMap = itemMapOf(save);
  const acc = new Map<string, { itemId: string; item: Item; count: number }>();
  const add = (itemId: string, count: number) => {
    const it = itemMap.get(itemId);
    if (!it || it.materialKind !== 'forge') return;
    const prev = acc.get(itemId);
    acc.set(itemId, { itemId, item: it, count: (prev?.count ?? 0) + count });
  };
  for (const m of save.materials) add(m.itemId, m.count);
  if (charId) {
    const c = save.characters.find((x) => x?.id === charId);
    for (const g of c?.storage ?? []) add(g.itemId, g.count);
  }
  return [...acc.values()];
}

export function getRecipes(): ForgeRecipe[] {
  return FORGE_RECIPES;
}

// 检查配方是否可锻造
export function canForge(
  save: SaveData,
  charId: string,
  recipe: ForgeRecipe,
  optionalMatIds: string[],
): { ok: boolean; reason?: string } {
  const c = save.characters.find((x) => x?.id === charId);
  if (!c) return { ok: false, reason: '角色不存在' };
  const itemMap = itemMapOf(save);
  // 图纸（共享仓库或当前角色独享仓库）
  const bpHave = countMaterial(save, charId, recipe.blueprintId);
  if (bpHave < 1) return { ok: false, reason: `${itemMap.get(recipe.blueprintId)?.name ?? '图纸'}不足` };
  // 必须材料（装备类从背包取）
  for (const req of recipe.requiredMaterials) {
    const have = (c.inventory ?? []).filter((id) => baseItemId(id) === req.itemId).length;
    if (have < req.count) {
      return { ok: false, reason: `${itemMap.get(req.itemId)?.name ?? '材料'}不足（需${req.count}件）` };
    }
  }
  // 可选锻造材料数量
  if (optionalMatIds.length > recipe.optionalForgeMaterialCount) {
    return { ok: false, reason: `最多添加${recipe.optionalForgeMaterialCount}个锻造材料` };
  }
  for (const mid of optionalMatIds) {
    const have = countMaterial(save, charId, mid);
    const it = itemMap.get(mid);
    if (have < 1 || !it || it.materialKind !== 'forge') {
      return { ok: false, reason: `${it?.name ?? '锻造材料'}不足` };
    }
  }
  return { ok: true };
}

export interface ForgeResult {
  save: SaveData;
  resultItemId: string;
  resultName: string;
}

// 执行锻造
export function doForge(
  save: SaveData,
  charId: string,
  recipe: ForgeRecipe,
  optionalMatIds: string[],
): ForgeResult | { error: string } {
  const check = canForge(save, charId, recipe, optionalMatIds);
  if (!check.ok) return { error: check.reason ?? '无法锻造' };

  const next = structuredClone(save);
  const nc = next.characters.find((x) => x?.id === charId)!;
  const itemMapNext = itemMapOf(next);

  // 扣除图纸（优先共享仓库，不足从角色独享仓库扣）
  consumeMaterial(next, charId, recipe.blueprintId, 1);

  // 扣除必须材料（从背包移除对应baseId的一件）
  const inv = [...(nc.inventory ?? [])];
  for (const req of recipe.requiredMaterials) {
    const idx = inv.findIndex((id) => baseItemId(id) === req.itemId);
    if (idx >= 0) inv.splice(idx, 1);
  }

  // 扣除可选锻造材料（优先共享仓库，不足从角色独享仓库扣）
  for (const mid of optionalMatIds) consumeMaterial(next, charId, mid, 1);

  // 产出物品；若使用了祭坛碎片则额外 +10~20 HP
  const baseResult = itemMapNext.get(recipe.resultId);
  let resultId = recipe.resultId;
  let resultName = baseResult?.name ?? '未知藏品';
  const usedAltar = optionalMatIds.includes('it_mat_altar_shard');
  if (usedAltar && baseResult) {
    const bonus = mathRng.int(10, 20);
    const customItem: Item = {
      ...baseResult,
      id: `forge_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      custom: true,
      name: `${baseResult.name}·祭坛`,
      bonuses: { ...(baseResult.bonuses ?? {}), hp: (baseResult.bonuses?.hp ?? 0) + bonus },
      desc: `${baseResult.desc ?? ''}（祭坛碎片赋予 +${bonus} HP）`,
    };
    next.customItems.push(customItem);
    resultId = customItem.id;
    resultName = customItem.name;
  }

  inv.push(resultId);
  updateCharacterInventory(next, charId, inv);

  return { save: next, resultItemId: resultId, resultName };
}

// 计算强化带来的属性加成
export function enhanceBonusStats(item: Item, enhance: number): Partial<{ hp: number; atk: number; def: number }> {
  if (enhance <= 0) return {};
  if ((item.level ?? 0) < 30) return {};
  const bonus = ENHANCE_BONUS[item.slot as 'weapon' | 'helmet' | 'armor'];
  if (!bonus) return {};
  const out: Record<string, number> = {};
  for (const k of Object.keys(bonus) as (keyof typeof bonus)[]) {
    out[k] = (bonus[k] ?? 0) * enhance;
  }
  return out;
}

// ===== 商店 =====
export interface ShopItem {
  itemId: string;
  price: number;
}

// 商店商品：强化石
export const SHOP_ITEMS: ShopItem[] = [
  { itemId: 'it_stone_rare', price: 3000 },
  { itemId: 'it_stone_epic', price: 5000 },
  { itemId: 'it_stone_legendary', price: 10000 },
];

// 购买材料：扣除角色哈哈币，材料进入共享仓库
export function buyShopItem(
  save: SaveData,
  charId: string,
  itemId: string,
  count: number,
): SaveData | { error: string } {
  const c = save.characters.find((x) => x?.id === charId);
  if (!c) return { error: '角色不存在' };
  const shop = SHOP_ITEMS.find((s) => s.itemId === itemId);
  if (!shop) return { error: '商品不存在' };
  if (count <= 0) return { error: '数量无效' };
  const total = shop.price * count;
  if ((c.coins ?? 0) < total) return { error: `哈哈币不足（需${total}，当前${c.coins ?? 0}）` };

  const next = structuredClone(save);
  const nc = next.characters.find((x) => x?.id === charId)!;
  nc.coins = Math.max(0, (nc.coins ?? 0) - total);
  // 材料进共享仓库
  const found = next.materials.find((m) => m.itemId === itemId);
  if (found) found.count += count;
  else next.materials.push({ itemId, count });
  saveSave(next);
  return next;
}
