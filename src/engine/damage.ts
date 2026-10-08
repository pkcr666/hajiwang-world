import type { BaseStats, Combatant, DamageType } from '../types';
import { BUFF_SCALE, buffValue, computeDamageMods, effDefBuffed } from './buffs';

const DEFAULT_STATS: BaseStats = { hp: 100, mp: 50, atk: 20, def: 0, mres: 0, spdMin: 2, spdMax: 5 };

// 测试与 unit 构建共用的战斗单位构造器
export function makeCombatant(
  partial: Partial<Combatant> & { uid: string; name: string },
): Combatant {
  const stats = partial.stats ?? DEFAULT_STATS;
  const maxHp = partial.maxHp ?? stats.hp;
  const baseMaxHp = partial.baseMaxHp ?? maxHp;
  return {
    side: 'ally',
    maxMp: stats.mp,
    mp: stats.mp,
    shield: 0,
    attackType: 'physical',
    skills: [],
    cooldowns: {},
    alive: true,
    statuses: { stunTurns: 0, atkModPct: 0, defModPct: 0 },
    enraged: false,
    passives: {},
    surviveUsed: false,
    summonStage: 0,
    bag: [],
    buffs: [],
    ai: 'basic',
    ...partial,
    stats,
    maxHp,
    baseMaxHp,
    hp: partial.hp ?? maxHp,
    baseSnapshot: partial.baseSnapshot ?? { stats: { ...stats }, agi: 0, cha: 0, int: 0, str: 0, wil: 0, luk: 0 },
  };
}

export const effAtk = (c: Combatant): number => {
  // 哈气：每层攻防-5%（百分比）+ 扁平-强度值
  const huffB = c.buffs.find((b) => b.id === 'huff');
  const huffStacks = huffB?.stacks ?? 0;
  const huffPct = huffStacks * 0.05;
  const huffFlat = buffValue(c, 'huff') * BUFF_SCALE.huff;
  // 攻击力百分比加成：所有加攻%遗物/技能叠加（atkPctBonus + 岩角号 + 黑色郁金香层数）
  const atkPctSum =
    (c.atkPctBonus ?? 0) + (c.allyCountAtkAmp ?? 0) + (c.noSkillAtkBuff?.stacks ?? 0);
  return Math.max(0, c.stats.atk * (1 + c.statuses.atkModPct / 100 + atkPctSum) * (1 - huffPct) - huffFlat);
};

export const PHYSICAL_MIN_DAMAGE = 10; // 物理伤害保底，防止高防小怪打不动
const REDUCTION_CAP = 0.9; // 减伤硬上限 90%

// 统一伤害结算，支持物理/法术/真实/固定四种
// fixed 类型：mult 作为固定数值使用，无视护盾、防御、法抗、增伤、减伤
// true 类型：吃增伤减伤，无视防御、法抗、护盾
export function calcDamage(
  attacker: Combatant,
  target: Combatant,
  mult: number,
  type: DamageType,
  extraAmp = 0,
  atkOverride?: number,
  extraAllAmp = 0,
): number {
  const amps = computeDamageMods(attacker);
  const reds = computeDamageMods(target);
  // 灾厄：持有护盾时伤害提升 X%（高阶护盾术士）
  if (attacker.shieldDmgAmpPct && (attacker.shield ?? 0) > 0) {
    amps.allDmgAmp += attacker.shieldDmgAmpPct;
  }
  const atkVal = atkOverride ?? effAtk(attacker);

  let raw: number;

  switch (type) {
    case 'physical': {
      // 弱点侦查（被动）：按比例无视目标有效防御
      const def = effDefBuffed(target) * (1 - (attacker.ignoreDefPct ?? 0));
      raw = Math.max(PHYSICAL_MIN_DAMAGE, atkVal * mult - def);
      // 贯星长枪低血量增伤与强壮/物理增伤同乘区，加法叠加
      raw *= 1 + amps.allDmgAmp + amps.physDmgAmp + extraAmp + extraAllAmp;
      raw *= 1 - Math.min(REDUCTION_CAP, reds.allDmgRed + reds.physDmgRed);
      break;
    }
    case 'magical': {
      // 膜拜：法抗减半（袁绍抉择）
      let mres = target.stats.mres * (buffValue(target, 'worship') > 0 ? 0.5 : 1);
      // 语汇演化（被动）：扁平无视法抗
      mres = Math.max(0, mres - (attacker.ignoreMresFlat ?? 0));
      // 里恩「业」：每层法抗-5（扁平）
      const karma = target.buffs.find((b) => b.id === 'reinKarma')?.stacks ?? 0;
      if (karma > 0) mres = Math.max(0, mres - karma * 5);
      raw = atkVal * mult * (1 - Math.min(REDUCTION_CAP, mres / 100));
      raw *= 1 + amps.allDmgAmp + amps.magicDmgAmp + extraAllAmp;
      raw *= 1 - Math.min(REDUCTION_CAP, reds.allDmgRed + reds.magicDmgRed);
      break;
    }
    case 'true': {
      raw = atkVal * mult;
      raw *= 1 + amps.allDmgAmp + amps.trueDmgAmp + extraAllAmp;
      raw *= 1 - Math.min(REDUCTION_CAP, reds.allDmgRed + reds.trueDmgRed);
      break;
    }
    case 'fixed':
    default: {
      raw = mult; // 固定伤害：纯数值，无视一切
      break;
    }
  }
  return Math.ceil(raw);
}

// 该伤害类型是否无视护盾
export function ignoresShield(type: DamageType): boolean {
  return type === 'true' || type === 'fixed';
}

// 护盾叠加：钨钢电池类遗物让每次获得护盾时额外+X
export function applyShield(c: Combatant, amount: number): number {
  if (amount <= 0) return 0;
  const gain = amount + (c.shieldGainBonus ?? 0);
  c.shield += gain;
  return gain;
}

// 伤害先扣护盾，返回真正打到血量上的伤害（会就地修改 c.shield）
export function absorb(c: Combatant, amount: number): number {
  let remain = amount;
  if (c.shield > 0) {
    const blocked = Math.min(c.shield, remain);
    c.shield -= blocked;
    remain -= blocked;
  }
  return remain;
}

