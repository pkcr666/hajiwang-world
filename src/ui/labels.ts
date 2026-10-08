import type { Item, Rarity, Slot } from '../types';

export const SLOT_LABELS: Record<Slot, string> = {
  weapon: '武器', helmet: '头盔', armor: '防具', boots: '靴子',
  accessory: '饰品', consumable: '道具', material: '材料', blueprint: '图纸',
};

export const SLOT_ORDER: Slot[] = ['weapon', 'helmet', 'armor', 'boots', 'accessory', 'consumable', 'material', 'blueprint'];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: '普通', uncommon: '优秀', fine: '精良', rare: '稀有', epic: '史诗', legendary: '传说',
};

export const RARITY_COLORS: Record<Rarity, string> = {
  common: 'var(--rarity-common)',
  uncommon: 'var(--rarity-uncommon)',
  fine: 'var(--rarity-fine)',
  rare: 'var(--rarity-rare)',
  epic: 'var(--rarity-epic)',
  legendary: 'var(--rarity-legendary)',
};

export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary'];

export const STAT_LABELS: Record<string, string> = {
  hp: '生命', mp: '魔力', atk: '攻击', def: '防御', mres: '法抗',
  spdMin: '速度下限', spdMax: '速度上限',
};

export const EXTRA_LABELS: Record<string, string> = {
  str: '力量', int: '智力', agi: '敏捷', luk: '幸运', cha: '魅力', wil: '意志',
};

export const WEAPON_TYPE_LABELS: Record<string, string> = {
  melee: '近战', ranged: '远程', magic: '魔法',
};

export function bonusLines(item: Item): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(item.bonuses ?? {})) {
    if (v) lines.push(`${STAT_LABELS[k] ?? k}+${v}`);
  }
  for (const [k, v] of Object.entries(item.extraBonus ?? {})) {
    if (v) lines.push(`${EXTRA_LABELS[k] ?? k}+${v}`);
  }
  const p = item.passives;
  if (p?.basicAttackMagic) lines.push('普攻变为法术伤害');
  if (p?.onHitMagicBonus) lines.push(`普攻额外造成${p.onHitMagicBonus}点法术伤害`);
  if (p?.surviveLethal) lines.push('致命伤保留1血（每场1次）');
  if (p?.basicAttackAll) lines.push('普攻变为群体攻击');
  if (p?.brokenArk) lines.push(`受击消耗${p.brokenArk.mpCost}MP抵消${Math.round(p.brokenArk.dmgRedPct * 100)}%伤害并强壮`);
  if (p?.healTurnEnd) lines.push(`回合末恢复${p.healTurnEnd}点HP`);
  if (p?.physDmgAmp) lines.push(`物理伤害+${Math.round(p.physDmgAmp * 100)}%`);
  if (p?.magicDmgAmp) lines.push(`法术伤害+${Math.round(p.magicDmgAmp * 100)}%`);
  if (p?.startShield) lines.push(`进入战斗获得${p.startShield}点护盾`);
  if (p?.atkModPct) lines.push(`攻击力${p.atkModPct > 0 ? '+' : ''}${p.atkModPct}%`);
  const u = item.usable;
  if (u) {
    if (u.hp) lines.push(`回复${u.hp}生命`);
    if (u.mp) lines.push(`回复${u.mp}魔力`);
    if (u.shield) lines.push(`${u.shield}护盾`);
  }
  return lines;
}

export const spdText = (min: number, max: number) => (min === max ? `${min}` : `${min}-${max}`);
