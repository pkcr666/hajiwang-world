import type { ForgeRecipe } from '../types';

// 锻造配方库——直接在此添加新配方即可
// 附魔藏品 → 附魔PRO藏品 的映射
const ENCHANTED_TO_PRO: Record<string, string> = {
  it_sword_enchanted: 'it_cm_enchanted_pro_sword',
  it_bow_enchanted: 'it_cm_enchanted_pro_bow',
  it_staff_enchanted: 'it_cm_enchanted_pro_staff',
  it_helmet_enchanted: 'it_cm_enchanted_pro_helmet',
  it_armor_enchanted: 'it_cm_enchanted_pro_armor',
};

// 10级护符 → 30级护符 的映射
const ACC_TIER1_TO_TIER2: Record<string, string> = {
  it_acc_str: 'it_cm_acc_str1',
  it_acc_int: 'it_cm_acc_int1',
  it_acc_wil: 'it_cm_acc_wil1',
  it_acc_cha: 'it_cm_acc_cha1',
  it_acc_agi: 'it_cm_acc_agi1',
  it_acc_luk: 'it_cm_acc_luk1',
  it_acc_atk: 'it_cm_acc_atk1',
  it_acc_hp: 'it_cm_acc_hp1',
  it_acc_def: 'it_cm_acc_def1',
  it_acc_mp: 'it_cm_acc_mp1',
  it_acc_mres: 'it_cm_acc_mres1',
  it_acc_spd: 'it_cm_acc_spd1',
};

function buildEnchantedProRecipes(): ForgeRecipe[] {
  return Object.entries(ENCHANTED_TO_PRO).map(([src, dst], i) => ({
    id: `rcp_enchanted_pro_${i}`,
    name: '附魔PRO锻造',
    resultId: dst,
    blueprintId: 'it_bp_enchanted_pro',
    requiredMaterials: [{ itemId: src, count: 1 }],
    optionalForgeMaterialCount: 1,
    desc: '附魔藏品 + 附魔PRO图纸 + 任意锻造材料 = 附魔PRO藏品',
  }));
}

function buildAccTier2Recipes(): ForgeRecipe[] {
  return Object.entries(ACC_TIER1_TO_TIER2).map(([src, dst], i) => ({
    id: `rcp_acc_tier2_${i}`,
    name: '二级护符锻造',
    resultId: dst,
    blueprintId: 'it_bp_acc_tier2',
    requiredMaterials: [{ itemId: src, count: 1 }],
    optionalForgeMaterialCount: 0,
    desc: '10级护符 + 二级护符图章 = 对应30级护符',
  }));
}

export const FORGE_RECIPES: ForgeRecipe[] = [
  // 闪电靴：赫尔墨斯之靴 + 图纸 + 1任意锻造材料
  {
    id: 'rcp_lightning_boots',
    name: '闪电靴锻造',
    resultId: 'it_cm_lightning_boots',
    blueprintId: 'it_bp_lightning_boots',
    requiredMaterials: [{ itemId: 'it_boots_hermes', count: 1 }],
    optionalForgeMaterialCount: 1,
    desc: '赫尔墨斯之靴 + 闪电靴图纸 + 任意锻造材料 = 闪电靴',
  },
  ...buildEnchantedProRecipes(),
  ...buildAccTier2Recipes(),
];
