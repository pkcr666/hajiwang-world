import type { AceSkill, AceUnit, Character, Combatant, Item, MonsterUnit, Skill, StageMechanic } from '../types';
import { isBoss } from '../types';
import { JOB_IMAGES } from '../assets/config';
import { makeCombatant } from './damage';
import { resolveCharacterSkills } from './skills';
import { BASE_TEMPLATE, collectExtraBonus, collectPassives, computeStats, equippedIds, outerStats, relicPanelBonus, weaponAttackType } from './stats';

// 正式角色 / 测试角色 → 战斗单位（同一套 Character 结构）
// runRelics：本次副本遗物+层数（缺省用角色自带 relics，局外通常为空）；
// 面板类遗物（stats/pctStats/sixStats/水晶）直接算进局外面板，applyRelics 不再重复结算
export function buildAllyCombatant(
  c: Character,
  items: Map<string, Item>,
  index: number,
  runRelics?: { relics?: string[]; relicStacks?: Record<string, number>; killBook?: number; maxHpPctDown?: number },
): Combatant {
  const equipped = equippedIds(c.equip)
    .map((id) => items.get(id))
    .filter((x): x is Item => !!x);
  const relics = runRelics?.relics ?? c.relics ?? [];
  const base = computeStats(BASE_TEMPLATE, equipped, c.level, c.baseExtra ?? c.extra);
  const stacks = runRelics?.killBook
    ? { ...runRelics.relicStacks, rl_kill_book: runRelics.killBook }
    : runRelics?.relicStacks;
  const panel = relicPanelBonus(relics, stacks);
  const stats = outerStats(base, panel);
  const passives = collectPassives(equipped);
  // 敏捷（六维）：角色基础 + 装备 extraBonus + 遗物 sixStats 加成（凯隐技能用）
  const agi = (c.extra?.agi ?? 0) + (collectExtraBonus(equipped).agi ?? 0) + (panel.six.agi ?? 0);
  // 魅力（六维）：角色基础 + 装备 extraBonus + 遗物 sixStats 加成（提丰弱点侦查用）
  const cha = (c.extra?.cha ?? 0) + (collectExtraBonus(equipped).cha ?? 0) + (panel.six.cha ?? 0);
  // 智力（六维）：角色基础 + 装备 extraBonus + 遗物 sixStats 加成（逻各斯技能用）
  const int = (c.extra?.int ?? 0) + (collectExtraBonus(equipped).int ?? 0) + (panel.six.int ?? 0);
  // 力量（六维）：角色基础 + 装备 extraBonus + 遗物 sixStats 加成（神秘面具男技能用）
  const str = (c.extra?.str ?? 0) + (collectExtraBonus(equipped).str ?? 0) + (panel.six.str ?? 0);
  // 意志（六维）：角色基础 + 装备 extraBonus + 遗物 sixStats 加成（奥古斯塔技能用）
  const wil = (c.extra?.wil ?? 0) + (collectExtraBonus(equipped).wil ?? 0) + (panel.six.wil ?? 0);
  // 幸运（六维）：角色基础 + 装备 extraBonus + 遗物 sixStats 加成
  const luk = (c.extra?.luk ?? 0) + (collectExtraBonus(equipped).luk ?? 0) + (panel.six.luk ?? 0);
  // 专属技能按角色等级解析：未解锁的排除，被动效果汇总到战斗单位
  const { skills: charSkills, ignoreDefPct, chaTrueDmgMul, kaynPassive, ignoreMresFlat, afterHitRandomMagicMul, applyApoptosisOnHit, executeIntMul, executeChain, chillAdhesionStacks, chillAdhesionIntensity, augustaMomentum, gatesMaxLayers, ammoStartBase, ammoPreActionCost, ammoMulPerBullet, ammoTurnEndTrueDmgPct } = resolveCharacterSkills(c);
  // 装备赋予的技能（传说武器等）
  const itemSkills: Skill[] = equipped.filter((i) => i.grantsSkill).map((i) => ({ ...i.grantsSkill! }));
  const skills = [...charSkills, ...itemSkills];
  // 武器被动汇总到角色被动（与技能被动叠加）
  const totalIgnoreDefPct = (ignoreDefPct ?? 0) + (passives.ignoreDefPct ?? 0);
  const totalIgnoreMresFlat = (ignoreMresFlat ?? 0) + (passives.ignoreMresFlat ?? 0);
  // 八门遁甲每层攻击力：从技能读取（10/15/20）
  const gatesSkill = skills.find((sk) => sk.gatesAtkPerLayer !== undefined);
  const gatesAtkPerLayer = gatesSkill?.gatesAtkPerLayer ?? Math.floor(c.level / 2);
  // 虚化：从反应技能中读取每回合次数上限与MP消耗
  const kamuiSkill = skills.find((sk) => sk.kind === 'reaction' && sk.reaction?.mode === 'kamui');
  const kamuiMaxUses = kamuiSkill?.reaction?.usesPerTurn;
  const kamuiMpCost = kamuiSkill?.mpCost;
  const combatant = makeCombatant({
    uid: `ally_${index}`,
    side: 'ally',
    name: c.name,
    job: c.job,
    icon: JOB_IMAGES[c.job],
    stats,
    attackType: weaponAttackType(equipped),
    weaponType: equipped.find((i) => i.slot === 'weapon')?.weaponType,
    passives,
    turnStartEnemyDmg: passives.turnStartEnemyDmg,
    skills,
    itemSkillIds: itemSkills.map((s) => s.id),
    ignoreDefPct: totalIgnoreDefPct || undefined,
    ignoreMresFlat: totalIgnoreMresFlat || undefined,
    chaTrueDmgMul: chaTrueDmgMul || undefined,
    weaponHealOnAction: passives.healOnAction,
    weaponSpdUpPerAtk: passives.spdUpPerAtk,
    weaponAdaptiveBasicAttack: passives.adaptiveBasicAttack,
    weaponAoeTrueDmgPct: passives.aoeTrueDmgPct,
    weaponBasicAttackHits: passives.basicAttackHits,
    weaponExtraRandomHit: passives.extraRandomHit,
    weaponBrokenArk: passives.brokenArk,
    weaponSpdGained: 0,
    healTurnEnd: passives.healTurnEnd,
    shield: passives.startShield ?? 0,
    // 藏品带来的增减伤：预填入 relicMods，applyRelics 会继续叠加
    relicMods: (() => {
      const rm: { physDmgAmp?: number; magicDmgAmp?: number } = {};
      if (passives.physDmgAmp) rm.physDmgAmp = passives.physDmgAmp;
      if (passives.magicDmgAmp) rm.magicDmgAmp = passives.magicDmgAmp;
      return Object.keys(rm).length > 0 ? rm : undefined;
    })(),
    statuses: { stunTurns: 0, atkModPct: passives.atkModPct ?? 0, defModPct: 0 },
    agi,
    cha,
    int,
    str,
    wil,
    luk,
    baseSnapshot: { stats: { ...stats }, agi, cha, int, str, wil, luk },
    charLevel: c.level,
    afterHitRandomMagicMul: afterHitRandomMagicMul || undefined,
    applyApoptosisOnHit,
    executeIntMul: executeIntMul || undefined,
    executeChain,
    chillAdhesionStacks: chillAdhesionStacks || undefined,
    chillAdhesionIntensity: chillAdhesionIntensity || undefined,
    kamuiMaxUses,
    kamuiMpCost,
    kamuiUses: kamuiMaxUses,
    bag: c.bag.map((b) => ({ ...b })),
    // 凯隐：初始化能量、形态、被动参数
    ...(kaynPassive ? {
      form: 'red' as const,
      energy: 0,
      energyMax: kaynPassive.energyMax,
      energyOverflowRatio: kaynPassive.overflowRatio,
      kaynEnergyPerSkill: kaynPassive.energyPerSkill,
      kaynHpThreshold: kaynPassive.hpThreshold,
      kaynEnergyOnTrigger: kaynPassive.energyOnTrigger,
      kaynPassiveUsed: false,
      kaynFirstSwitch: false,
    } : {}),
    // 奥古斯塔：初始化战势
    ...(augustaMomentum ? {
      momentum: 0,
      momentumMax: augustaMomentum.max,
      momentumHitGainedThisTurn: 0,
    } : {}),
    // 小李：初始化八门遁甲
    ...(gatesMaxLayers ? {
      eightGates: 0,
      eightGatesMax: gatesMaxLayers,
      eightGatesAtkPerLayer: gatesAtkPerLayer,
    } : {}),
    // DONK：初始化世一步/闪身步追踪字段
    ...(c.job === 'donk' ? {
      donkTotalMpConsumed: 0,
      donkDodgerSpdGained: 0,
      donkShiyiPendingProcs: 0,
    } : {}),
    // 爱弥斯：初始化聚爆/形态/同步率字段
    ...(c.job === 'eimis' ? {
      eimisForm: 'human' as const,
      eimisSyncRate: 0,
      eimisSyncMax: 4,
      eimisNextAtkHuiMang: true, // 首次普攻为辉芒
      eimisOverflowMulBonus: 0,
      eimisDetonatedThisTurn: false,
    } : {}),
    // 新约能天使：初始化弹药（= 幸运 + ammoStartBase）
    ...(ammoPreActionCost !== undefined ? {
      ammo: Math.max(0, luk + (ammoStartBase ?? 0)),
      ammoMax: Math.max(0, luk + (ammoStartBase ?? 0)),
      ammoNextMulBonus: 0,
      ammoConsumedTotal: 0,
      ammoPreActionCost,
      ammoMulPerBullet: ammoMulPerBullet ?? 0.1,
      ammoTurnEndTrueDmgPct: ammoTurnEndTrueDmgPct ?? 0.1,
    } : {}),
    // 里恩：初始化神谕代行者状态（指令标/代行层数/解放档位）
    ...(c.job === 'rein' ? {
      reinOracle: { stacks: 0, markedVariantId: '', markedTargetUid: '', liberation: 0, sixApplied: 0, atkApplied: 0, ampApplied: 0 },
      reinHeartFate: false,
      reinFuriosoUsed: false,
    } : {}),
  });
  // 痛苦之村求救信：每走一个节点最大生命-X%（按累计比例削减）
  const down = runRelics?.maxHpPctDown ?? 0;
  if (down > 0) {
    const mult = Math.max(0, 1 - down);
    combatant.maxHp = Math.max(1, Math.floor(combatant.maxHp * mult));
    combatant.hp = Math.min(combatant.hp, combatant.maxHp);
  }
  return combatant;
}

// 王牌单位 → 战斗单位（固定属性，无装备/遗物/等级）
export function buildAceCombatant(ace: AceUnit, index: number): Combatant {
  const skills: Skill[] = ace.skills
    .filter((s) => s.kind === 'active')
    .map((s, i) => aceSkillToSkill(ace.id, s, i));

  const passives = ace.skills.filter((s) => s.kind === 'passive');
  const basicAttack = passives.find((p) => p.basicAttack);
  const lowHp = passives.find((p) => p.lowHpDmgAmp);
  const taunt = passives.find((p) => p.taunt);
  const untargetable = passives.find((p) => p.untargetable);
  const dmgRed = passives.find((p) => p.dmgRedOnHit);
  const defUp = passives.find((p) => p.defUpOnHit);
  const implCap = passives.find((p) => p.implosionCapBonus);
  const implTurnEnd = passives.find((p) => p.implosionTurnEnd);

  return makeCombatant({
    uid: `ace_${index}`,
    side: 'ally',
    name: ace.name,
    icon: ace.icon,
    stats: { ...ace.stats },
    attackType: basicAttack?.basicAttack?.dmgType === 'magic' ? 'magical' : 'physical',
    skills,
    passives: {},
    aceTaunt: taunt?.taunt,
    aceUntargetable: untargetable?.untargetable,
    aceDmgRedOnHit: dmgRed?.dmgRedOnHit ? { phys: 0, magic: 0, cap: 0.8 } : undefined,
    aceDmgRedOnHitGain: dmgRed?.dmgRedOnHit,
    aceDefUpOnHit: defUp?.defUpOnHit,
    aceImplosionCapBonus: implCap?.implosionCapBonus,
    aceImplosionTurnEnd: implTurnEnd?.implosionTurnEnd,
    aceBasicAttack: basicAttack?.basicAttack ? {
      dmgPct: basicAttack.basicAttack.dmgPct,
      dmgType: basicAttack.basicAttack.dmgType === 'magic' ? 'magical' : 'physical',
    } : undefined,
    lowHpEnemyDmgAmp: lowHp?.lowHpDmgAmp ? { threshold: lowHp.lowHpDmgAmp.threshold, pct: lowHp.lowHpDmgAmp.amp } : undefined,
    aceOncePerBattleUsed: {},
    bag: [],
    ai: 'basic',
  });
}

// 王牌单位技能 → 游戏 Skill
function aceSkillToSkill(aceId: string, s: AceSkill, i: number): Skill {
  const dmgTypeMap = { phys: 'physical' as const, magic: 'magical' as const, true: 'true' as const };
  const targetMap = { single: 'enemyOne' as const, all: 'enemyAll' as const };
  const skill: Skill = {
    id: `${aceId}_sk${i}`,
    name: s.name,
    desc: s.desc,
    kind: 'active',
    mpCost: s.mpCost ?? 0,
    target: s.target ? targetMap[s.target] : 'self',
    damageType: s.dmgType ? dmgTypeMap[s.dmgType] : undefined,
    multiplier: s.dmgPct,
    shield: s.shield,
    applyBuffs: s.applyBuff ? [{ id: s.applyBuff.id, stacks: s.applyBuff.stacks, intensity: s.applyBuff.intensity, target: s.target ? 'enemy' : 'self' }] : undefined,
    aceTrueDmgFlat: s.trueDmgFlat,
    aceMaxHpTrueDmgPct: s.maxHpTrueDmgPct,
    aceShieldMissingHp: s.shieldMissingHp,
    aceAllyShield: s.allyShield,
    aceOncePerBattle: s.oncePerBattle,
    aceChargeTurns: s.chargeTurns,
    aceStatUp: s.statUp,
  };
  return skill;
}


// 图鉴怪物 → 战斗单位；多部位 BOSS 展开为多个单位（核心固定在数组首位）
// monsterMap 用于解析召唤物模板（缺省则召唤机制不生效）
// mechanics：关卡「额外属性」（紧急/BOSS特性），scope=all 作用于全部敌人，scope=monster 仅指定怪
export function buildEnemyCombatants(
  m: MonsterUnit,
  index: number,
  monsterMap?: Map<string, MonsterUnit>,
  mechanics?: StageMechanic[],
  endgame?: boolean,
): Combatant[] {
  const bossId = `enemy_${index}`;
  const applyMechanics = (stats: Combatant['stats']): Combatant['stats'] => {
    if (!mechanics?.length) return stats;
    const hit = mechanics.filter((x) =>
      x.scope === 'all' || (x.scope === 'monster' && x.monsterId === m.id));
    for (const x of hit) {
      stats.hp = Math.max(1, stats.hp + (x.hp ?? 0));
      stats.atk = Math.max(0, stats.atk + (x.atk ?? 0));
      stats.def = Math.max(0, stats.def + (x.def ?? 0));
      stats.mres = Math.min(90, Math.max(0, stats.mres + (x.mres ?? 0)));
      const lo = stats.spdMin + (x.spdMin ?? 0);
      const hi = stats.spdMax + (x.spdMax ?? 0);
      stats.spdMin = Math.min(99, Math.max(0, lo));
      stats.spdMax = Math.min(99, Math.max(stats.spdMin, hi));
    }
    return stats;
  };
  // 终局联系：全副本敌人 HP+100/攻+20/防+20/法抗+20/速+1（召唤物不加成）
  const applyEndgame = (stats: Combatant['stats']): Combatant['stats'] => {
    if (!endgame) return stats;
    stats.hp += 100;
    stats.atk += 20;
    stats.def += 20;
    stats.mres = Math.min(90, stats.mres + 20);
    stats.spdMin = Math.min(99, stats.spdMin + 1);
    stats.spdMax = Math.min(99, stats.spdMax + 1);
    return stats;
  };

  // ===== 灾厄多部位 BOSS 展开 =====
  // 世界吞噬者：头×1 身×3 尾×1，数值相同
  if (m.id === 'ct_026') {
    const s = applyEndgame(applyMechanics(structuredClone(m.stats)));
    const make = (partId: string, partName: string, kind: string, atkMul: number, dmgType: 'physical' | 'magical', poison: { stacks: number; intensity: number }) =>
      makeCombatant({
        uid: `${bossId}_${partId}`,
        side: 'enemy',
        name: `${m.name}·${partName}`,
        icon: m.icon,
        stats: { ...s },
        ai: 'basic',
        bossId,
        monsterId: `ct_026_${kind}`,
        attackType: dmgType,
        basicAttackMul: atkMul,
        aoeReductionPct: 60,
        basicAttackBuffs: [{ id: 'poison', stacks: poison.stacks, intensity: poison.intensity }],
      });
    return [
      make('head', '头部', 'head', 1, 'physical', { stacks: 2, intensity: 1 }),
      make('body1', '身体', 'body', 0.8, 'magical', { stacks: 2, intensity: 1 }),
      make('body2', '身体', 'body', 0.8, 'magical', { stacks: 2, intensity: 1 }),
      make('body3', '身体', 'body', 0.8, 'magical', { stacks: 2, intensity: 1 }),
      make('tail', '尾部', 'tail', 1, 'physical', { stacks: 1, intensity: 2 }),
    ];
  }
  // 骷髅王：头（核心）+ 双手
  if (m.id === 'ct_057') {
    const headStats = applyEndgame(applyMechanics(structuredClone(m.stats)));
    const handStats = applyEndgame(applyMechanics(structuredClone(m.stats)));
    handStats.hp = Math.floor(handStats.hp * 0.5);
    const head = makeCombatant({
      uid: `${bossId}_head`, side: 'enemy', name: `${m.name}·头`, icon: m.icon,
      stats: { ...headStats }, ai: 'basic', bossId, isCore: true, monsterId: 'ct_057_head',
    });
    const mkHand = (n: string) => makeCombatant({
      uid: `${bossId}_${n}`, side: 'enemy', name: `${m.name}·手`, icon: m.icon,
      stats: { ...handStats }, ai: 'basic', bossId, monsterId: 'ct_057_hand',
    });
    return [head, mkHand('hand_l'), mkHand('hand_r')];
  }

  if (isBoss(m)) {
    const parts = m.parts.map((p, j) =>
      makeCombatant({
        uid: `${bossId}_${p.id}`,
        side: 'enemy',
        name: `${m.name}·${p.name}`,
        icon: m.icon,
        stats: applyEndgame(applyMechanics(structuredClone(p.stats))),
        skills: p.skills.map((sk) => ({ ...sk })),
        ai: j === 0 ? 'boss' : 'caster',
        bossId,
        isCore: j === 0,
        partBreak: p.onBreak ?? undefined,
        monsterId: m.id,
      }),
    );
    return parts;
  }
  const finalStats = applyEndgame(applyMechanics(structuredClone(m.stats)));
  return [
    makeCombatant({
      uid: bossId,
      side: 'enemy',
      name: m.name,
      icon: m.icon,
      stats: finalStats,
      hp: m.startHpPct ? Math.floor(finalStats.hp * m.startHpPct) : undefined,
      skills: m.skills.map((sk) => ({ ...sk })),
      ai: m.ai,
      monsterId: m.id,
      basicAttackBuffs: m.basicAttackBuffs?.map((b) => ({ ...b })),
      summon: m.summon ? { ...m.summon, thresholds: [...m.summon.thresholds] } : undefined,
      summonTemplate: m.summon && monsterMap
        ? summonTemplateOf(m.summon.monsterId, monsterMap)
        : undefined,
      enrage: m.enrage ? { ...m.enrage } : undefined,
      healTurnEnd: m.healTurnEnd,
      dmgCapPerTurn: m.dmgCapPerTurn,
      atkUpIfNotHitLastTurn: m.atkUpIfNotHitLastTurn,
      debuffOnHit: m.debuffOnHit ? { ...m.debuffOnHit } : undefined,
      fleeOnTurn: m.fleeOnTurn,
      bonusDropOnKill: m.bonusDropOnKill ? { ...m.bonusDropOnKill } : undefined,
      turnStartBurn: m.turnStartBurn ? { ...m.turnStartBurn } : undefined,
      ignoreDefPct: m.ignoreDefPct,
      lifestealPct: m.lifestealPct,
      lifestealAllPct: m.lifestealAllPct,
      healAllTurnEnd: m.healAllTurnEnd,
      healAllTurnEndPct: m.healAllTurnEndPct,
      mpDrain: m.mpDrain,
      poisonOnHit: m.poisonOnHit ? { ...m.poisonOnHit } : undefined,
      plagueOnHit: m.plagueOnHit ? { ...m.plagueOnHit } : undefined,
      shield: m.initialShield ?? 0,
      shieldStacks: m.initialShieldStacks ?? 0,
      shieldDmgAmpPct: m.shieldDmgAmpPct,
      attackType: m.attackType ?? 'physical',
      spdUpOnHit: m.spdUpOnHit,
      aoeBasicAttack: m.aoeBasicAttack,
      multiHit: m.multiHit,
      reviveOnce: m.reviveOnce,
      counterTrueDmg: m.counterTrueDmg,
      maxHpTrueDmgPct: m.maxHpTrueDmgPct,
      defUpOnHit: m.defUpOnHit ? { ...m.defUpOnHit } : undefined,
      evenTurnGuard: m.evenTurnGuard ? { ...m.evenTurnGuard } : undefined,
      shieldAllTurnEnd: m.shieldAllTurnEnd,
      selfDestructOnSurvive: m.selfDestructOnSurvive,
      defDownOnHit: m.defDownOnHit,
      plagueStackBonusTrueDmg: m.plagueStackBonusTrueDmg,
      plagueStackBonusMagicDmg: m.plagueStackBonusMagicDmg,
      multiHitMul: m.multiHitMul,
      multiHitRandom: m.multiHitRandom,
      basicAttackDefMul: m.basicAttackDefMul,
      spdTrueDmgMul: m.spdTrueDmgMul,
      hpLossPerStep: m.hpLossPerStep ? { ...m.hpLossPerStep } : undefined,
      poisonStackAtkMul: m.poisonStackAtkMul ? { ...m.poisonStackAtkMul } : undefined,
      aoeSplashPct: m.aoeSplashPct,
      turnEndAoeMagic: m.turnEndAoeMagic,
      hitTurnPattern: m.hitTurnPattern ? { ...m.hitTurnPattern } : undefined,
      summonBelowAllies: m.summonBelowAllies ? { ...m.summonBelowAllies, pool: [...m.summonBelowAllies.pool] } : undefined,
      summonPoolTemplates: m.summonBelowAllies && monsterMap
        ? m.summonBelowAllies.pool.map((id) => summonTemplateOf(id, monsterMap)).filter((x): x is Combatant => !!x)
        : undefined,
      perAllyStats: m.perAllyStats ? { ...m.perAllyStats } : undefined,
      perAllyBaseStats: m.perAllyStats ? { def: finalStats.def, mres: finalStats.mres } : undefined,
      onAllyDeath: m.onAllyDeath ? { ...m.onAllyDeath } : undefined,
      bleedStackDmgAmp: m.bleedStackDmgAmp,
      aiPriority: m.aiPriority,
      dmgToMaxHp: m.dmgToMaxHp,
      lifestealMissingHp: m.lifestealMissingHp,
      lowHpBurst: m.lowHpBurst ? { ...m.lowHpBurst } : undefined,
      onDeathHealAllyPct: m.onDeathHealAllyPct,
      onDeathBuffAlly: m.onDeathBuffAlly ? { ...m.onDeathBuffAlly } : undefined,
      attackGroupPoison: m.attackGroupPoison ? { ...m.attackGroupPoison } : undefined,
      summonEachTurn: m.summonEachTurn,
      summonEachTurnTemplate: m.summonEachTurn && monsterMap
        ? summonTemplateOf(m.summonEachTurn, monsterMap)
        : undefined,
      lowHpConsumeSummon: m.lowHpConsumeSummon ? { ...m.lowHpConsumeSummon } : undefined,
      doublePoisonOnHit: m.doublePoisonOnHit,
      spdBasedDmg: m.spdBasedDmg ? { ...m.spdBasedDmg } : undefined,
      startHpPct: m.startHpPct,
      consumePlagueOnHit: m.consumePlagueOnHit ? { ...m.consumePlagueOnHit } : undefined,
      invincibleWhileAllies: m.invincibleWhileAllies,
      lockTarget: m.lockTarget,
      atkMulScaling: m.atkMulScaling,
      turnCycleAttack: m.turnCycleAttack ? { ...m.turnCycleAttack } : undefined,
      spdUpOnHitCap: m.spdUpOnHitCap,
      bindAtkBoost: m.bindAtkBoost,
      taunt: m.taunt,
      defLoseOnHitCha: m.defLoseOnHitCha,
      dmgToDefOnDeal: m.dmgToDefOnDeal,
      aoeTrueDmgOnHit: m.aoeTrueDmgOnHit,
      invincible: m.invincible,
      aoeReductionPct: m.aoeReductionPct,
      basicAttackMul: m.basicAttackMul,
      spdBasedDmgPct: m.spdBasedDmgPct ? { ...m.spdBasedDmgPct } : undefined,
      crisis: m.crisis ? structuredClone(m.crisis) : undefined,
    }),
  ];
}

// 召唤物模板：用被召唤怪物的属性构建一个占位单位，进场时重设 uid
function summonTemplateOf(monsterId: string, map: Map<string, MonsterUnit>): Combatant | undefined {
  const def = map.get(monsterId);
  if (!def) return undefined;
  return makeCombatant({
    uid: '__summon__',
    side: 'enemy',
    name: def.name,
    icon: def.icon,
    stats: structuredClone(def.stats),
    skills: def.skills.map((sk) => ({ ...sk })),
    ai: def.ai,
    monsterId: def.id,
    basicAttackBuffs: def.basicAttackBuffs?.map((b) => ({ ...b })),
  });
}
