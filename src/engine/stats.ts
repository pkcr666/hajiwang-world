import type { BaseStats, Character, DamageType, Equip, ExtraStats, Item, ItemPassives } from '../types';
import { EXTRA_KEYS } from '../types';
import { RELIC_MAP } from '../data/relics';

export const LIFE_CRYSTAL_ID = 'rl_life_crystal';
export const MANA_CRYSTAL_ID = 'rl_mana_crystal';
export const CRYSTAL_CAP = 10;

// 所有职业共用的初始模板
export const BASE_TEMPLATE: BaseStats = {
  hp: 300, mp: 60, atk: 50, def: 20, mres: 0, spdMin: 2, spdMax: 5,
};

export const START_EXTRA: ExtraStats = { str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 10 };
export const EXTRA_MIN = 10;
export const EXTRA_MAX = 40;
export const EXTRA_BUDGET = 80;
export const MRES_CAP = 90;

// 角色等级相关：默认 10 级；每升 10 级一档固定属性（20级=1档、30级=2档…）
export const LEVEL_BASE = 10;
export const LEVEL_TIER = 10;
export const LEVEL_BONUS: BaseStats = {
  hp: 50, mp: 20, atk: 10, def: 5, mres: 0, spdMin: 1, spdMax: 1,
};

export function levelBonus(level: number): BaseStats {
  const lv = Math.floor(Math.max(0, level - LEVEL_BASE) / LEVEL_TIER);
  return {
    hp: LEVEL_BONUS.hp * lv,
    mp: LEVEL_BONUS.mp * lv,
    atk: LEVEL_BONUS.atk * lv,
    def: LEVEL_BONUS.def * lv,
    mres: 0,
    spdMin: LEVEL_BONUS.spdMin * lv,
    spdMax: LEVEL_BONUS.spdMax * lv,
  };
}

// ===== 额外6维换算（仅角色初始加点参与，装备/遗物六维加成不换算）=====
// 初始 10 点不计算加成：有效点数 = 属性值 - 10
// 力量 1点=+1攻 · 智力 1点=+1MP · 幸运 1点=+2HP
// 意志/魅力 2点=+1防/法抗（向下取整）
// 敏捷每 5 点一档交替提升：1/3/5档+最小速度，2/4/6档+最大速度（40敏=+3/+3）
// 注意：应传入角色的 baseExtra（创建时锁定的初始六维），自由属性点不参与基础属性换算
export function extraStatBonus(extra?: ExtraStats): BaseStats {
  const out: BaseStats = { hp: 0, mp: 0, atk: 0, def: 0, mres: 0, spdMin: 0, spdMax: 0 };
  if (!extra) return out;
  const eff = (v: number) => Math.max(0, v - EXTRA_MIN);
  out.atk = eff(extra.str);
  out.mp = eff(extra.int);
  out.hp = eff(extra.luk) * 2;
  out.def = Math.floor(eff(extra.wil) / 2);
  out.mres = Math.floor(eff(extra.cha) / 2);
  const tiers = Math.floor(eff(extra.agi) / 5);
  out.spdMin = Math.ceil(tiers / 2);
  out.spdMax = Math.floor(tiers / 2);
  return out;
}

// 额外6维：每项 10~40，总和必须为 60+80=140
export function validateExtra(e: ExtraStats): boolean {
  return (
    EXTRA_KEYS.every((k) => e[k] >= EXTRA_MIN && e[k] <= EXTRA_MAX) &&
    EXTRA_KEYS.reduce((sum, k) => sum + e[k], 0) === 60 + EXTRA_BUDGET
  );
}

// 最终六维 = 模板 + 等级加成 + 全部穿戴藏品的固定加成 + 初始加点六维换算；mres clamp 到 [0,90]
export function computeStats(base: BaseStats, items: Item[], level = LEVEL_BASE, extra?: ExtraStats): BaseStats {
  const out: BaseStats = { ...base };
  const lb = levelBonus(level);
  for (const k of ['hp', 'mp', 'atk', 'def', 'mres', 'spdMin', 'spdMax'] as const) {
    (out as unknown as Record<string, number>)[k] += (lb as unknown as Record<string, number>)[k];
  }
  for (const item of items) {
    for (const [k, v] of Object.entries(item.bonuses ?? {})) {
      (out as unknown as Record<string, number>)[k] += v as number;
    }
  }
  const eb = extraStatBonus(extra);
  for (const k of ['hp', 'mp', 'atk', 'def', 'mres', 'spdMin', 'spdMax'] as const) {
    (out as unknown as Record<string, number>)[k] += (eb as unknown as Record<string, number>)[k];
  }
  out.mres = Math.min(MRES_CAP, Math.max(0, out.mres));
  for (const k of ['hp', 'mp', 'atk', 'def', 'spdMin', 'spdMax'] as const) {
    out[k] = Math.max(0, out[k]);
  }
  return out;
}

// 武器普攻伤害类型：装备了带 basicAttackMagic 被动的武器时为法术，否则物理
export function weaponAttackType(items: Item[]): DamageType {
  return items.some((i) => i.slot === 'weapon' && i.passives?.basicAttackMagic) ? 'magical' : 'physical';
}

// 同名被动在多件藏品上同时存在时按“或”汇总（拥有即生效）
export function collectPassives(items: Item[]): ItemPassives {
  const out: ItemPassives = {};
  for (const it of items) {
    const p = it.passives;
    if (!p) continue;
    if (p.surviveLethal) out.surviveLethal = true;
    if (p.basicAttackAll) out.basicAttackAll = true;
    if (p.basicAttackMagic) out.basicAttackMagic = true;
    if (p.onHitMagicBonus) out.onHitMagicBonus = Math.max(out.onHitMagicBonus ?? 0, p.onHitMagicBonus);
    if (p.turnStartEnemyDmg) out.turnStartEnemyDmg = Math.max(out.turnStartEnemyDmg ?? 0, p.turnStartEnemyDmg);
    if (p.ignoreDefPct) out.ignoreDefPct = Math.max(out.ignoreDefPct ?? 0, p.ignoreDefPct);
    if (p.ignoreMresFlat) out.ignoreMresFlat = Math.max(out.ignoreMresFlat ?? 0, p.ignoreMresFlat);
    if (p.healOnAction) out.healOnAction = Math.max(out.healOnAction ?? 0, p.healOnAction);
    if (p.spdUpPerAtk) {
      if (!out.spdUpPerAtk || p.spdUpPerAtk.cap > out.spdUpPerAtk.cap) out.spdUpPerAtk = p.spdUpPerAtk;
    }
    if (p.adaptiveBasicAttack) out.adaptiveBasicAttack = true;
    if (p.aoeTrueDmgPct) out.aoeTrueDmgPct = Math.max(out.aoeTrueDmgPct ?? 0, p.aoeTrueDmgPct);
    if (p.basicAttackHits) out.basicAttackHits = p.basicAttackHits;
    if (p.extraRandomHit) out.extraRandomHit = p.extraRandomHit;
    if (p.brokenArk) out.brokenArk = p.brokenArk;
    if (p.healTurnEnd) out.healTurnEnd = (out.healTurnEnd ?? 0) + p.healTurnEnd;
    if (p.physDmgAmp) out.physDmgAmp = (out.physDmgAmp ?? 0) + p.physDmgAmp;
    if (p.magicDmgAmp) out.magicDmgAmp = (out.magicDmgAmp ?? 0) + p.magicDmgAmp;
    if (p.startShield) out.startShield = (out.startShield ?? 0) + p.startShield;
    if (p.atkModPct) out.atkModPct = (out.atkModPct ?? 0) + p.atkModPct;
  }
  return out;
}

// 额外6维加成汇总（饰品等，不影响战斗，仅显示）
export function collectExtraBonus(items: Item[]): Partial<ExtraStats> {
  const out: Partial<ExtraStats> = {};
  for (const it of items) {
    if (!it.extraBonus) continue;
    for (const k of EXTRA_KEYS) {
      if (it.extraBonus[k]) out[k] = (out[k] ?? 0) + (it.extraBonus[k] as number);
    }
  }
  return out;
}

export function equippedIds(equip: Equip | undefined): string[] {
  if (!equip) return [];
  return [equip.weapon, equip.helmet, equip.armor, equip.boots, ...equip.accessory].filter(
    (x): x is string => !!x,
  );
}

// 角色幸运值（幸运掉落判定用）：基础六维 + 装备 extraBonus 中的幸运
export function characterLuck(c: Character, items: Map<string, Item>): number {
  let luk = c.extra?.luk ?? 0;
  for (const id of equippedIds(c.equip)) {
    const it = items.get(id);
    if (it?.extraBonus?.luk) luk += it.extraBonus.luk;
  }
  return luk;
}

// ===== 局外面板体系 =====
// 原始面板 = 基础模板 + 等级 + 穿戴藏品
// 局外面板 = 原始面板 × (1 + 遗物百分比合计) + 遗物固定值 + 水晶层数加成（先乘后加）
export interface RelicPanelBonus {
  fixed: Partial<BaseStats>; // stats 类遗物固定值合计
  pct: { hp: number; atk: number; def: number }; // pctStats 类百分比合计
  crystalLife: number; // 生命水晶层数（未持有=0）
  crystalMana: number; // 魔力水晶层数（未持有=0）
  six: Partial<ExtraStats>; // sixStats 六维加成合计
  dmgAmp: { phys: number; magic: number }; // 战斗内常驻增伤（局外展示用）
}

// 层数遗物当前层数（旧档 relicStacks 缺省时：生命水晶按当前层数兜底由调用方处理，这里缺省视为1/0）
export function crystalStacksOf(
  relics: string[],
  stacks: Record<string, number> | undefined,
): { life: number; mana: number } {
  const hasLife = relics.includes(LIFE_CRYSTAL_ID);
  const hasMana = relics.includes(MANA_CRYSTAL_ID);
  const clamp = (n: number) => Math.max(0, Math.min(CRYSTAL_CAP, Math.floor(n)));
  return {
    life: hasLife ? clamp(stacks?.[LIFE_CRYSTAL_ID] ?? 1) : 0,
    mana: hasMana ? clamp(stacks?.[MANA_CRYSTAL_ID] ?? 0) : 0,
  };
}

// 汇总遗物的局外面板加成
// ctx: 可选上下文（职业武器类型、火把数、哈哈币数），用于计算近战/远程/魔法专属及火把/币系遗物
export function relicPanelBonus(
  relics: string[],
  stacks?: Record<string, number>,
  ctx?: { weaponType?: 'melee' | 'ranged' | 'magic'; torches?: number; coins?: number },
): RelicPanelBonus {
  const out: RelicPanelBonus = {
    fixed: {}, pct: { hp: 0, atk: 0, def: 0 }, crystalLife: 0, crystalMana: 0, six: {}, dmgAmp: { phys: 0, magic: 0 },
  };
  const wt = ctx?.weaponType;
  for (const id of relics) {
    const r = RELIC_MAP[id];
    if (!r) continue;
    const eff = r.effect;
    if (eff.kind === 'stats') {
      for (const [k, v] of Object.entries(eff.bonus)) {
        out.fixed[k as keyof BaseStats] = (out.fixed[k as keyof BaseStats] ?? 0) + (v as number);
      }
    } else if (eff.kind === 'pctStats') {
      out.pct.hp += eff.hpPct ?? 0;
      out.pct.atk += eff.atkPct ?? 0;
      out.pct.def += eff.defPct ?? 0;
    } else if (eff.kind === 'killBook') {
      // 杀人书：层数记录在 run.killBook，由调用方写入 stacks['rl_kill_book']
      out.pct.atk += eff.pctPerKill * Math.min(eff.maxStacks, stacks?.[id] ?? 0);
    } else if (eff.kind === 'sixStats') {
      for (const k of EXTRA_KEYS) {
        if (eff.bonus[k]) out.six[k] = (out.six[k] ?? 0) + (eff.bonus[k] as number);
      }
    } else if (eff.kind === 'torchHpPerTorch') {
      // 火把神的祝福：每消耗一根火把+HP上限，层数记录在 run.relicStacks
      const st = Math.min(eff.maxStacks, stacks?.[id] ?? 0);
      out.fixed.hp = (out.fixed.hp ?? 0) + eff.hpPerTorch * st;
    } else if (eff.kind === 'meleeAtkPct') {
      // 百战/锋刃：近战单位攻击+X%
      if (wt === 'melee') out.pct.atk += eff.pct;
    } else if (eff.kind === 'rangedSpd') {
      // 残弩/神速：远程单位速度+X
      if (wt === 'ranged') {
        out.fixed.spdMin = (out.fixed.spdMin ?? 0) + eff.amount;
        out.fixed.spdMax = (out.fixed.spdMax ?? 0) + eff.amount;
      }
    } else if (eff.kind === 'magicDmgAmp2') {
      // 断杖/波纹：魔法单位法术伤害+X%
      if (wt === 'magic') out.dmgAmp.magic += eff.pct;
    } else if (eff.kind === 'meleeTradeoff') {
      // 以守待攻：近战速度-X，物理伤害+Y%
      if (wt === 'melee') {
        out.fixed.spdMin = (out.fixed.spdMin ?? 0) - eff.spdDown;
        out.fixed.spdMax = (out.fixed.spdMax ?? 0) - eff.spdDown;
        out.dmgAmp.phys += eff.physDmgUp;
      }
    } else if (eff.kind === 'torchDefAmp') {
      // 火把神的庇佑：每根火把防御+X%
      const amp = eff.pctPerTorch * Math.max(0, ctx?.torches ?? 0);
      out.pct.def += amp;
    } else if (eff.kind === 'coinsSpd') {
      // 金酒之杯：每Y币速度+1（上限）
      const spd = Math.min(eff.cap, Math.floor((ctx?.coins ?? 0) / eff.perCoins));
      out.fixed.spdMin = (out.fixed.spdMin ?? 0) + spd;
      out.fixed.spdMax = (out.fixed.spdMax ?? 0) + spd;
    } else if (eff.kind === 'swordHammer') {
      // 剑锤：攻/防+X%，法抗+Y
      out.pct.atk += eff.atkPct;
      out.pct.def += eff.defPct;
      out.fixed.mres = (out.fixed.mres ?? 0) + eff.mres;
    }
  }
  const cs = crystalStacksOf(relics, stacks);
  out.crystalLife = cs.life;
  out.crystalMana = cs.mana;
  return out;
}

// 原始面板 + 局外遗物加成 → 局外面板（百分比乘原始面板，固定值与水晶直加；向上取整）
export function outerStats(base: BaseStats, bonus: RelicPanelBonus): BaseStats {
  const mul = (v: number, pct: number) => v * (1 + pct);
  const out: BaseStats = {
    hp: Math.max(0, Math.ceil(mul(base.hp, bonus.pct.hp) + (bonus.fixed.hp ?? 0) + bonus.crystalLife * 20)),
    mp: Math.max(0, Math.ceil(mul(base.mp, 0) + (bonus.fixed.mp ?? 0) + bonus.crystalMana * 10)),
    atk: Math.max(0, Math.ceil(mul(base.atk, bonus.pct.atk) + (bonus.fixed.atk ?? 0))),
    def: Math.max(0, Math.ceil(mul(base.def, bonus.pct.def) + (bonus.fixed.def ?? 0))),
    mres: Math.min(MRES_CAP, Math.max(0, base.mres + (bonus.fixed.mres ?? 0))),
    spdMin: Math.max(0, Math.ceil(mul(base.spdMin, 0) + (bonus.fixed.spdMin ?? 0))),
    spdMax: Math.max(0, Math.ceil(mul(base.spdMax, 0) + (bonus.fixed.spdMax ?? 0))),
  };
  return out;
}
