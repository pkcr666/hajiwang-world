import type { Character, Skill, SkillTier } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { SKILL_MAP } from '../data/skills';

// ===== 角色专属技能体系 =====
// 技能点：从 20 级起每 10 级获得 1 点（10 级=0 点，20 级=1 点，30 级=2 点…）
// 技能点仅用于升级专属技能，每升一级消耗 1 点，上限 3 级
// 专属技能解锁：初始 2 个 → 20 级解锁第 3 个 → 40 级解锁第 4 个
// 额外技能槽：本期未实装
export const SKILL_MAX_LEVEL = 3;
export const SKILL_POINT_EVERY_LEVELS = 10;
export const SKILL_POINT_START_LEVEL = 20; // 首次获得技能点的等级
export const EXCLUSIVE_UNLOCK_LEVEL = 20; // 第3个专属技能解锁等级
export const EXCLUSIVE_UNLOCK2_LEVEL = 40; // 第4个专属技能解锁等级

// 技能点计算：10级=0，20级=1，30级=2，40级=3，50级=4…
// 公式：max(0, floor((level - START + EVERY) / EVERY))
export const skillPointsEarned = (level: number): number =>
  Math.max(0, Math.floor((level - SKILL_POINT_START_LEVEL + SKILL_POINT_EVERY_LEVELS) / SKILL_POINT_EVERY_LEVELS));

// 角色专属技能（按职业定义顺序，即解锁顺序）
export function exclusiveSkillsOf(c: Pick<Character, 'job'>): Skill[] {
  return (JOB_DEFS[c.job]?.skills ?? [])
    .map((id) => SKILL_MAP[id])
    .filter((sk): sk is Skill => !!sk && sk.exclusive === true);
}

// 技能是否已解锁（等级 >= 解锁等级；缺省=1 初始可用）
export const skillUnlocked = (sk: Skill, level: number): boolean =>
  level >= (sk.unlockLevel ?? 1);

// 角色某专属技能当前等级（1~3，缺省1）
export const skillLevelOf = (c: Pick<Character, 'skillLevels'>, skillId: string): number =>
  Math.max(1, Math.min(SKILL_MAX_LEVEL, c.skillLevels?.[skillId] ?? 1));

// 已消耗的技能点 = Σ(技能等级 - 1)
export function spentSkillPoints(c: Pick<Character, 'skillLevels'>): number {
  return Object.values(c.skillLevels ?? {}).reduce((sum, lv) => sum + Math.max(0, lv - 1), 0);
}

// 已获得技能点总数（存档缺省按当前等级折算）
export const earnedSkillPoints = (c: Pick<Character, 'skillPoints' | 'level'>): number =>
  c.skillPoints ?? skillPointsEarned(c.level);

// 当前可用技能点
export function availableSkillPoints(c: Pick<Character, 'skillPoints' | 'skillLevels' | 'level'>): number {
  return Math.max(0, earnedSkillPoints(c) - spentSkillPoints(c));
}

// 是否可升级：已解锁 + 未满级 + 有技能点
export function canUpgradeSkill(
  c: Pick<Character, 'skillPoints' | 'skillLevels' | 'level'>,
  sk: Skill,
): boolean {
  return (
    sk.exclusive === true &&
    skillUnlocked(sk, c.level) &&
    skillLevelOf(c, sk.id) < SKILL_MAX_LEVEL &&
    availableSkillPoints(c) > 0
  );
}

// 某技能指定等级的技能数据（tiers[i] = i+1 级）；tierLevel 为技能等级 1~3（不判断解锁，解锁由调用方负责）
export function resolveSkill(sk: Skill, tierLevel: number): Skill | null {
  if (!sk.tiers?.length) return sk;
  const t = sk.tiers[Math.min(Math.max(1, tierLevel) - 1, sk.tiers.length - 1)] ?? sk.tiers[sk.tiers.length - 1];
  return {
    ...sk,
    mpCost: t.mpCost,
    hpCost: t.hpCost,
    energyCost: t.energyCost,
    multiplier: t.multiplier,
    hits: t.hits,
    shield: t.shield,
    applyBuffs: t.applyBuffs,
    trueDmgAtkMul: t.trueDmgAtkMul,
    shieldBonusFromInt: t.shieldBonusFromInt,
    ignoreDefPct: t.ignoreDefPct,
    chaTrueDmgMul: t.chaTrueDmgMul,
    markPct: t.markPct,
    // 逻各斯专属字段（tier 覆盖顶层）
    intMulBase: t.intMulBase,
    intMulPerInt: t.intMulPerInt,
    ignoreMresFlat: t.ignoreMresFlat,
    afterHitRandomMagicMul: t.afterHitRandomMagicMul,
    applyApoptosisOnHit: t.applyApoptosisOnHit,
    apoptosisIntensityUp: t.apoptosisIntensityUp,
    executeIntMul: t.executeIntMul,
    executeChain: t.executeChain,
    // 氮氮专属字段
    flatDmgBase: t.flatDmgBase,
    flatDmgIntMul: t.flatDmgIntMul,
    applyArmorBreak: t.applyArmorBreak,
    consumeHalfChillIntMul: t.consumeHalfChillIntMul,
    condensGrenade: t.condensGrenade,
    condensDefRedPct: t.condensDefRedPct,
    condensMresRed: t.condensMresRed,
    condensPermSpdRed: t.condensPermSpdRed,
    chillAdhesionStacks: t.chillAdhesionStacks,
    chillAdhesionIntensity: t.chillAdhesionIntensity,
    // 神秘面具男专属字段
    strMulBase: t.strMulBase,
    spdMulBase: t.spdMulBase,
    spdMulPer: t.spdMulPer,
    enhanceMpCost: t.enhanceMpCost,
    enhanceMulBonus: t.enhanceMulBonus,
    enhanceKamuiCost: t.enhanceKamuiCost,
    enhanceApplyBuffs: t.enhanceApplyBuffs,
    trueDmgBase: t.trueDmgBase,
    trueDmgPerBuff: t.trueDmgPerBuff,
    kamuiExecute: t.kamuiExecute,
    kamuiExecuteHpPct: t.kamuiExecuteHpPct,
    kamuiExecuteMpCost: t.kamuiExecuteMpCost,
    kamuiExecuteKamuiCost: t.kamuiExecuteKamuiCost,
    // 奥古斯塔专属字段
    augustaMomentum: t.augustaMomentum ?? sk.augustaMomentum,
    augustaEnhanceMulBonus: t.augustaEnhanceMulBonus,
    augustaEnhanceHealFromStr: t.augustaEnhanceHealFromStr,
    augustaEnhanceAllyShield: t.augustaEnhanceAllyShield,
    augustaEnhanceConsumeAll: t.augustaEnhanceConsumeAll,
    augustaEnhanceMulPerStack: t.augustaEnhanceMulPerStack,
    shieldFromStrWilMul: t.shieldFromStrWilMul,
    lowHpBonusMulPct: t.lowHpBonusMulPct,
    // 小李专属字段
    gatesMaxLayers: t.gatesMaxLayers,
    gatesAtkPerLayer: t.gatesAtkPerLayer,
    gatesEndTurnDmgFlat: t.gatesEndTurnDmgFlat,
    konohaMarkPassive: t.konohaMarkPassive,
    konohaTrueDmgTier: t.konohaTrueDmgTier,
    konohaMarkAgiMul: t.konohaMarkAgiMul,
    konohaTrueDmgMul: t.konohaTrueDmgMul,
    gatesRequired: t.gatesRequired,
    lotusHits: t.lotusHits,
    lotusAtkMul: t.lotusAtkMul,
    lotusFlatPerGate: t.lotusFlatPerGate,
    lotusMarkMul: t.lotusMarkMul,
    lotusKillHealPct: t.lotusKillHealPct,
    lotusHpCostPct: t.lotusHpCostPct,
    reverseLotusTrueHits: t.reverseLotusTrueHits,
    reverseLotusTrueMul: t.reverseLotusTrueMul,
    reverseLotusMaxHpMul: t.reverseLotusMaxHpMul,
    reverseLotusPhysMul: t.reverseLotusPhysMul,
    // DONK 专属字段
    shiyiMpCost: t.shiyiMpCost,
    shiyiTrueDmgStrMul: t.shiyiTrueDmgStrMul,
    shiyiMpRestorePct: t.shiyiMpRestorePct,
    shiyiAtkBonusPct: t.shiyiAtkBonusPct,
    shiyiAtkCap: t.shiyiAtkCap,
    dodgerMpPerSpd: t.dodgerMpPerSpd,
    dodgerSpdCap: t.dodgerSpdCap,
    demonMpThreshold: t.demonMpThreshold,
    demonStrMul: t.demonStrMul,
    demonStrCap: t.demonStrCap,
    shootBaseMul: t.shootBaseMul,
    shootSpdBonusPct: t.shootSpdBonusPct,
    shootBonusPer30Mp: t.shootBonusPer30Mp,
    shootBonusMaxUpgrades: t.shootBonusMaxUpgrades,
    // 爱弥斯 聚爆 / 形态 / 同步率
    eimisHuiMangBasePct: t.eimisHuiMangBasePct,
    eimisHuiMangChaMul: t.eimisHuiMangChaMul,
    eimisHuiMangStacks: t.eimisHuiMangStacks,
    eimisImplosionBaseCap: t.eimisImplosionBaseCap,
    eimisImplosionDmgPctPerStack: t.eimisImplosionDmgPctPerStack,
    eimisHumanChaGain: t.eimisHumanChaGain,
    eimisHumanChaCap: t.eimisHumanChaCap,
    eimisMechShieldChaMul: t.eimisMechShieldChaMul,
    eimisSyncCapBonus: t.eimisSyncCapBonus,
    eimisMresPenPerSync: t.eimisMresPenPerSync,
    eimisUltimateCapMul: t.eimisUltimateCapMul,
    // 新约能天使弹药体系
    ammoStartBase: t.ammoStartBase ?? sk.ammoStartBase,
    ammoPreActionCost: t.ammoPreActionCost ?? sk.ammoPreActionCost,
    ammoMulPerBullet: t.ammoMulPerBullet ?? sk.ammoMulPerBullet,
    ammoTurnEndTrueDmgPct: t.ammoTurnEndTrueDmgPct ?? sk.ammoTurnEndTrueDmgPct,
    // 里恩专属字段（tier 覆盖顶层）
    variants: t.variants ?? sk.variants,
    reinMask: t.reinMask ?? sk.reinMask,
    reinOracle: t.reinOracle ?? sk.reinOracle,
    reinFurioso: t.reinFurioso ?? sk.reinFurioso,
    formEffects: t.formEffects ?? sk.formEffects,
    kaynPassive: t.kaynPassive ?? sk.kaynPassive,
    reaction: sk.reaction
      ? {
          ...sk.reaction,
          intensity: t.reactionIntensity ?? sk.reaction.intensity,
          maxStacks: t.reactionMaxStacks ?? sk.reaction.maxStacks,
          usesPerTurn: t.reactionUsesPerTurn ?? sk.reaction.usesPerTurn,
        }
      : sk.reaction,
    desc: t.desc ?? sk.desc,
  };
}

// 某技能指定等级的 tier 数据（UI 展示用；缺省返回顶层字段投影）
export function tierOf(sk: Skill, level: number): SkillTier {
  if (!sk.tiers?.length) {
    return {
      mpCost: sk.mpCost,
      hpCost: sk.hpCost,
      energyCost: sk.energyCost,
      multiplier: sk.multiplier,
      hits: sk.hits,
      shield: sk.shield,
      applyBuffs: sk.applyBuffs,
      desc: sk.desc,
    };
  }
  return sk.tiers[Math.min(Math.max(1, level) - 1, sk.tiers.length - 1)] ?? sk.tiers[sk.tiers.length - 1];
}

// 战斗构建用：按角色当前等级把专属技能解析为实际技能列表（未解锁的排除），并汇总被动效果
export function resolveCharacterSkills(c: Pick<Character, 'job' | 'skillLevels' | 'level'>): {
  skills: Skill[];
  ignoreDefPct: number;
  chaTrueDmgMul: number;
  kaynPassive?: NonNullable<Skill['kaynPassive']>;
  // 逻各斯被动汇总
  ignoreMresFlat: number;
  afterHitRandomMagicMul: number;
  applyApoptosisOnHit: boolean;
  executeIntMul: number;
  executeChain: boolean;
  // 氮氮被动汇总
  chillAdhesionStacks: number;
  chillAdhesionIntensity: number;
  // 奥古斯塔被动汇总
  augustaMomentum?: NonNullable<Skill['augustaMomentum']>;
  // 小李被动汇总
  gatesMaxLayers?: number;
  // 新约能天使弹药体系
  ammoStartBase?: number;
  ammoPreActionCost?: number;
  ammoMulPerBullet?: number;
  ammoTurnEndTrueDmgPct?: number;
} {
  const skills: Skill[] = [];
  let ignoreDefPct = 0;
  let chaTrueDmgMul = 0;
  let kaynPassive: NonNullable<Skill['kaynPassive']> | undefined;
  let ignoreMresFlat = 0;
  let afterHitRandomMagicMul = 0;
  let applyApoptosisOnHit = false;
  let executeIntMul = 0;
  let executeChain = false;
  let chillAdhesionStacks = 0;
  let chillAdhesionIntensity = 0;
  let augustaMomentum: NonNullable<Skill['augustaMomentum']> | undefined;
  let gatesMaxLayers: number | undefined;
  let ammoStartBase: number | undefined;
  let ammoPreActionCost: number | undefined;
  let ammoMulPerBullet: number | undefined;
  let ammoTurnEndTrueDmgPct: number | undefined;
  for (const sk of exclusiveSkillsOf(c)) {
    if (!skillUnlocked(sk, c.level)) continue; // 角色等级未到解锁线：技能不进入战斗
    const lv = skillLevelOf(c, sk.id);
    const resolved = resolveSkill(sk, lv);
    if (!resolved) continue;
    // 角色等级缩放：tier.levelScale 指定的字段用 base + 角色等级 × perLevel 覆盖固定值
    const tier = sk.tiers?.[Math.min(Math.max(1, lv) - 1, (sk.tiers?.length ?? 1) - 1)];
    if (tier?.levelScale) {
      for (const [field, { base, perLevel }] of Object.entries(tier.levelScale)) {
        const val = Math.floor(base + c.level * perLevel);
        (resolved as any)[field] = val;
        // reactionIntensity 需同步到 reaction.intensity
        if (field === 'reactionIntensity' && resolved.reaction) {
          resolved.reaction = { ...resolved.reaction, intensity: val };
        }
      }
    }
    skills.push(resolved);
    if (resolved.ignoreDefPct) ignoreDefPct = Math.max(ignoreDefPct, resolved.ignoreDefPct);
    if (resolved.chaTrueDmgMul) chaTrueDmgMul = Math.max(chaTrueDmgMul, resolved.chaTrueDmgMul);
    if (resolved.kaynPassive) kaynPassive = resolved.kaynPassive;
    // 逻各斯被动
    if (resolved.ignoreMresFlat) ignoreMresFlat = Math.max(ignoreMresFlat, resolved.ignoreMresFlat);
    if (resolved.afterHitRandomMagicMul) afterHitRandomMagicMul = Math.max(afterHitRandomMagicMul, resolved.afterHitRandomMagicMul);
    if (resolved.applyApoptosisOnHit) applyApoptosisOnHit = true;
    if (resolved.executeIntMul) executeIntMul = Math.max(executeIntMul, resolved.executeIntMul);
    if (resolved.executeChain) executeChain = true;
    // 氮氮被动
    if (resolved.chillAdhesionStacks) chillAdhesionStacks = Math.max(chillAdhesionStacks, resolved.chillAdhesionStacks);
    if (resolved.chillAdhesionIntensity) chillAdhesionIntensity = Math.max(chillAdhesionIntensity, resolved.chillAdhesionIntensity);
    // 奥古斯塔被动
    if (resolved.augustaMomentum) augustaMomentum = resolved.augustaMomentum;
    // 小李被动
    if (resolved.gatesMaxLayers) gatesMaxLayers = resolved.gatesMaxLayers;
    // 新约能天使弹药体系（铳弹协约）
    if (resolved.ammoStartBase !== undefined) ammoStartBase = resolved.ammoStartBase;
    if (resolved.ammoPreActionCost !== undefined) ammoPreActionCost = resolved.ammoPreActionCost;
    if (resolved.ammoMulPerBullet !== undefined) ammoMulPerBullet = resolved.ammoMulPerBullet;
    if (resolved.ammoTurnEndTrueDmgPct !== undefined) ammoTurnEndTrueDmgPct = resolved.ammoTurnEndTrueDmgPct;
  }
  return { skills, ignoreDefPct, chaTrueDmgMul, kaynPassive, ignoreMresFlat, afterHitRandomMagicMul, applyApoptosisOnHit, executeIntMul, executeChain, chillAdhesionStacks, chillAdhesionIntensity, augustaMomentum, gatesMaxLayers, ammoStartBase, ammoPreActionCost, ammoMulPerBullet, ammoTurnEndTrueDmgPct };
}
