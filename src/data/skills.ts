import type { Skill } from '../types';

// ===== 职业技能（角色专属：消耗技能点升级，1~3级）=====
// 职业定义里 skills 数组顺序 = 解锁顺序：前 2 个初始可用，第 3 个 20 级解锁，第 4 个 40 级解锁
const excl = (unlockLevel = 1): Partial<Skill> => ({ exclusive: true, unlockLevel });

export const SK_POWER: Skill = {
  id: 'sk_power', name: '强力击', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'physical', multiplier: 1.5,
  desc: 'Lv.1 对敌方单体造成攻击力150%的物理伤害。',
  ...excl(),
  tiers: [
    { mpCost: 10, multiplier: 1.5, desc: '对敌方单体造成攻击力150%的物理伤害。' },
    { mpCost: 12, multiplier: 1.8, desc: '对敌方单体造成攻击力180%的物理伤害。' },
    { mpCost: 14, multiplier: 2.1, desc: '对敌方单体造成攻击力210%的物理伤害。' },
  ],
};
export const SK_DEFEND_WAR: Skill = {
  id: 'sk_defend_war', name: '铁壁防御', kind: 'active', mpCost: 10, target: 'self', shield: 55,
  desc: 'Lv.1 获得(40+角色等级×1.5)点护盾，伤害先扣护盾；重复获得取较大值，战斗内持续存在。',
  ...excl(),
  tiers: [
    { mpCost: 10, levelScale: { shield: { base: 40, perLevel: 1.5 } }, desc: '获得(40+角色等级×1.5)点护盾，伤害先扣护盾；重复获得取较大值，战斗内持续存在。' },
    { mpCost: 10, levelScale: { shield: { base: 40, perLevel: 1.5 } }, desc: '获得(40+角色等级×1.5)点护盾，伤害先扣护盾；重复获得取较大值，战斗内持续存在。' },
    { mpCost: 12, levelScale: { shield: { base: 40, perLevel: 1.5 } }, desc: '获得(40+角色等级×1.5)点护盾，伤害先扣护盾；重复获得取较大值，战斗内持续存在。' },
  ],
};
export const SK_FIREBALL: Skill = {
  id: 'sk_fireball', name: '火球术', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'magical', multiplier: 1.5,
  desc: 'Lv.1 对敌方单体造成攻击力150%的法术伤害。',
  ...excl(),
  tiers: [
    { mpCost: 10, multiplier: 1.5, desc: '对敌方单体造成攻击力150%的法术伤害。' },
    { mpCost: 12, multiplier: 1.8, desc: '对敌方单体造成攻击力180%的法术伤害。' },
    { mpCost: 14, multiplier: 2.2, desc: '对敌方单体造成攻击力220%的法术伤害。' },
  ],
};
export const SK_STORM: Skill = {
  id: 'sk_storm', name: '雷暴术', kind: 'active', mpCost: 15, target: 'enemyAll',
  damageType: 'magical', multiplier: 1,
  desc: 'Lv.1 对敌方群体造成攻击力100%的法术伤害。',
  ...excl(),
  tiers: [
    { mpCost: 15, multiplier: 1, desc: '对敌方群体造成攻击力100%的法术伤害。' },
    { mpCost: 18, multiplier: 1.3, desc: '对敌方群体造成攻击力130%的法术伤害。' },
    { mpCost: 20, multiplier: 1.6, desc: '对敌方群体造成攻击力160%的法术伤害。' },
  ],
};
export const SK_PIERCE: Skill = {
  id: 'sk_pierce', name: '贯穿射击', kind: 'active', mpCost: 15, target: 'enemyAll',
  damageType: 'physical', multiplier: 1.2,
  desc: 'Lv.1 对敌方群体造成攻击力120%的物理伤害。',
  ...excl(),
  tiers: [
    { mpCost: 15, multiplier: 1.2, desc: '对敌方群体造成攻击力120%的物理伤害。' },
    { mpCost: 18, multiplier: 1.5, desc: '对敌方群体造成攻击力150%的物理伤害。' },
    { mpCost: 20, multiplier: 1.8, desc: '对敌方群体造成攻击力180%的物理伤害。' },
  ],
};
export const SK_TRIPLE: Skill = {
  id: 'sk_triple', name: '三连发', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'physical', multiplier: 0.8, hits: 3,
  desc: 'Lv.1 对敌方单体造成攻击力80%的物理伤害3次。',
  ...excl(),
  tiers: [
    { mpCost: 10, multiplier: 0.8, hits: 3, desc: '对敌方单体造成攻击力80%的物理伤害3次。' },
    { mpCost: 12, multiplier: 1, hits: 3, desc: '对敌方单体造成攻击力100%的物理伤害3次。' },
    { mpCost: 15, multiplier: 1.2, hits: 3, desc: '对敌方单体造成攻击力120%的物理伤害3次。' },
  ],
};

// ===== 小猫 · 传奇灵兽技能 =====
// 哈气：反应技能，受击前对攻击来源施加减益（攻防-5%/层 + 扁平-等级/5/层）
export const SK_HUFF: Skill = {
  id: 'sk_huff', name: '哈气', kind: 'reaction', mpCost: 10, target: 'enemyOne',
  reaction: { buffId: 'huff', maxStacks: 2, intensity: 0 },
  desc: 'Lv.1 被动·反应：即将受到伤害时弹窗选择是否哈气（耗10MP），使攻击来源攻防各-5%并减去等级/5；最多2层，战斗内永久持续。',
  ...excl(),
  tiers: [
    { mpCost: 10, reactionMaxStacks: 2, levelScale: { reactionIntensity: { base: 0, perLevel: 0.2 } }, desc: '受击前哈气（耗10MP），使攻击来源攻防各-5%并减去等级/5；最多2层，永久持续。' },
    { mpCost: 10, reactionMaxStacks: 3, levelScale: { reactionIntensity: { base: 0, perLevel: 0.2 } }, desc: '受击前哈气（耗10MP），使攻击来源攻防各-5%并减去等级/5；最多3层，永久持续。' },
    { mpCost: 5, reactionMaxStacks: 3, levelScale: { reactionIntensity: { base: 0, perLevel: 0.2 } }, desc: '受击前哈气（耗5MP），使攻击来源攻防各-5%并减去等级/5；最多3层，永久持续。' },
  ],
};
// 爪击：对敌方单体造成攻击力X%的物理伤害；对带哈气目标额外提升层数×20%伤害（增伤区）
export const SK_CLAW: Skill = {
  id: 'sk_claw', name: '爪击', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'physical', multiplier: 1.5,
  desc: 'Lv.1 对敌方单体造成攻击力150%的物理伤害。若目标带有哈气，额外提升（层数×20%）伤害。',
  ...excl(),
  tiers: [
    { mpCost: 10, multiplier: 1.5, desc: '对敌方单体造成攻击力150%的物理伤害。若目标带有哈气，额外提升（层数×20%）伤害。' },
    { mpCost: 10, multiplier: 2.5, desc: '对敌方单体造成攻击力250%的物理伤害。若目标带有哈气，额外提升（层数×20%）伤害。' },
    { mpCost: 10, multiplier: 2.5, desc: '对敌方单体造成攻击力250%的物理伤害。若目标带有哈气，额外提升（层数×20%）伤害。' },
  ],
};
// 自动吸附：获得智力×X护盾，并使1个友方单位本回合受到的伤害转为自己承受（嘲讽）
export const SK_ABSORB: Skill = {
  id: 'sk_absorb', name: '自动吸附', kind: 'active', mpCost: 10, target: 'allyOne',
  shield: 0,
  shieldBonusFromInt: 2,
  desc: 'Lv.1 获得智力×2的护盾，并使1个友方单位本回合受到的伤害转为自己承受。',
  ...excl(20),
  tiers: [
    { mpCost: 10, shield: 0, shieldBonusFromInt: 2, desc: '获得智力×2的护盾，并使1个友方单位本回合受到的伤害转为自己承受。' },
    { mpCost: 10, shield: 0, shieldBonusFromInt: 2, levelScale: { shield: { base: 0, perLevel: 1 } }, desc: '获得(智力×2+等级)的护盾，并使1个友方单位本回合受到的伤害转为自己承受。' },
    { mpCost: 10, shield: 0, shieldBonusFromInt: 2, levelScale: { shield: { base: 0, perLevel: 1.5 } }, desc: '获得(智力×2+等级×1.5)的护盾，并使1个友方单位本回合受到的伤害转为自己承受。' },
  ],
};
// 运之夹角：对敌方单体同时造成物理+法术+真实三种伤害
export const SK_LUCK_CORNER: Skill = {
  id: 'sk_luck_corner', name: '运之夹角', kind: 'active', mpCost: 20, target: 'enemyOne',
  damageType: 'physical', multiplier: 30,
  multiDamageTypes: ['physical', 'magical', 'true'],
  desc: 'Lv.1 对敌方单体造成(3×角色等级+30)点物理、法术、真实伤害。',
  ...excl(40),
  tiers: [
    { mpCost: 20, levelScale: { multiplier: { base: 30, perLevel: 3 } }, desc: '对敌方单体造成(3×角色等级+30)点物理、法术、真实伤害。' },
    { mpCost: 20, levelScale: { multiplier: { base: 40, perLevel: 3 } }, desc: '对敌方单体造成(3×角色等级+40)点物理、法术、真实伤害。' },
    { mpCost: 20, levelScale: { multiplier: { base: 50, perLevel: 3 } }, desc: '对敌方单体造成(3×角色等级+50)点物理、法术、真实伤害。' },
  ],
};

// ===== 提丰 · 终末猎手（远程）=====
// 超绝3连发：对敌方单体造成攻击力X%的物理伤害3次
export const SK_TYPHON_TRIPLE: Skill = {
  id: 'sk_typhon_triple', name: '超绝3连发', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'physical', multiplier: 0.8, hits: 3,
  desc: 'Lv.1 对敌方单体造成攻击力80%的物理伤害3次。',
  ...excl(),
  tiers: [
    { mpCost: 10, multiplier: 0.8, hits: 3, desc: '对敌方单体造成攻击力80%的物理伤害3次。' },
    { mpCost: 10, multiplier: 1, hits: 3, desc: '对敌方单体造成攻击力100%的物理伤害3次。' },
    { mpCost: 10, multiplier: 1.2, hits: 3, desc: '对敌方单体造成攻击力120%的物理伤害3次。' },
  ],
};
// 贯穿射击：对敌方群体造成攻击力X%的物理伤害
export const SK_TYPHON_PIERCE: Skill = {
  id: 'sk_typhon_pierce', name: '贯穿射击', kind: 'active', mpCost: 20, target: 'enemyAll',
  damageType: 'physical', multiplier: 1,
  desc: 'Lv.1 对敌方群体造成攻击力100%的物理伤害。',
  ...excl(),
  tiers: [
    { mpCost: 20, multiplier: 1, desc: '对敌方群体造成攻击力100%的物理伤害。' },
    { mpCost: 15, multiplier: 1.2, desc: '对敌方群体造成攻击力120%的物理伤害。' },
    { mpCost: 15, multiplier: 1.5, desc: '对敌方群体造成攻击力150%的物理伤害。' },
  ],
};
// 弱点侦查：被动，攻击无视目标X%防御 + 魅力×Y真实伤害
export const SK_TYPHON_RECON: Skill = {
  id: 'sk_typhon_recon', name: '弱点侦查', kind: 'passive', mpCost: 0, target: 'self',
  desc: 'Lv.1 被动：攻击无视目标10%防御，并额外造成魅力×0.5的真实伤害。',
  ...excl(20),
  tiers: [
    { mpCost: 0, ignoreDefPct: 0.1, chaTrueDmgMul: 0.5, desc: '被动：攻击无视目标10%防御，并额外造成魅力×0.5的真实伤害。' },
    { mpCost: 0, ignoreDefPct: 0.2, chaTrueDmgMul: 0.6, desc: '被动：攻击无视目标20%防御，并额外造成魅力×0.6的真实伤害。' },
    { mpCost: 0, ignoreDefPct: 0.3, chaTrueDmgMul: 0.7, desc: '被动：攻击无视目标30%防御，并额外造成魅力×0.7的真实伤害。' },
  ],
};
// 永恒狩猎：施加永久「狩猎标记」（回合末受到施放者攻击力X%的物理伤害）+ 3层破甲
export const SK_TYPHON_HUNT: Skill = {
  id: 'sk_typhon_hunt', name: '永恒狩猎', kind: 'active', mpCost: 50, target: 'enemyOne',
  desc: 'Lv.1 对敌方单体施加「狩猎标记」：回合末受到施放者攻击力100%的物理伤害，永久持续；并施加3层破甲（强度3）。',
  ...excl(40),
  markPct: 1.0,
  applyBuffs: [
    { id: 'armorBreak', stacks: 3, intensity: 3, target: 'enemy' },
  ],
  tiers: [
    {
      mpCost: 50, markPct: 1.0,
      applyBuffs: [{ id: 'armorBreak', stacks: 3, intensity: 3, target: 'enemy' }],
      desc: '对敌方单体施加「狩猎标记」：回合末受到施放者攻击力100%的物理伤害，永久持续；并施加3层破甲（强度3）。',
    },
    {
      mpCost: 40, markPct: 1.0,
      applyBuffs: [{ id: 'armorBreak', stacks: 3, intensity: 4, target: 'enemy' }],
      desc: '对敌方单体施加「狩猎标记」：回合末受到施放者攻击力100%的物理伤害，永久持续；并施加3层破甲（强度4）。',
    },
    {
      mpCost: 40, markPct: 1.2,
      applyBuffs: [{ id: 'armorBreak', stacks: 3, intensity: 5, target: 'enemy' }],
      desc: '对敌方单体施加「狩猎标记」：回合末受到施放者攻击力120%的物理伤害，永久持续；并施加3层破甲（强度5）。',
    },
  ],
};

// ===== 凯隐 · 暗裔魔镰（近战，能量+双形态）=====
// 被动：失去X%最大生命后触发，获得能量+1次数盾（每场1次）；能量上限/溢出转盾/每次技能获能随等级提升
export const SK_KAYN_PASSIVE: Skill = {
  id: 'sk_kayn_passive', name: '暗裔魔镰', kind: 'passive', mpCost: 0, target: 'self',
  desc: '被动：失去一定比例最大生命后触发，获得能量与次数盾。',
  ...excl(),
  kaynPassive: { hpThreshold: 0.7, energyOnTrigger: 20, energyMax: 50, overflowRatio: 1, energyPerSkill: 25 },
  tiers: [
    { mpCost: 0, kaynPassive: { hpThreshold: 0.7, energyOnTrigger: 20, energyMax: 50, overflowRatio: 1, energyPerSkill: 25 },
      desc: '失去70%生命后获得20能量+1次数盾；能量上限50，超出1:1转护盾；每次技能+25能量。' },
    { mpCost: 0, kaynPassive: { hpThreshold: 0.6, energyOnTrigger: 30, energyMax: 60, overflowRatio: 1, energyPerSkill: 30 },
      desc: '失去60%生命后获得30能量+1次数盾；能量上限60，超出1:1转护盾；每次技能+30能量。' },
    { mpCost: 0, kaynPassive: { hpThreshold: 0.5, energyOnTrigger: 40, energyMax: 80, overflowRatio: 1, energyPerSkill: 40 },
      desc: '失去50%生命后获得40能量+1次数盾；能量上限80，超出1:1转护盾；每次技能+40能量。' },
  ],
};
// 狂镰横扫：红形态=单体物伤+攻击力成长；蓝形态=群体法伤+斩杀回蓝
export const SK_KAYN_SCYTHE: Skill = {
  id: 'sk_kayn_scythe', name: '狂镰横扫', kind: 'active', mpCost: 20, target: 'enemyOne',
  damageType: 'physical',
  desc: '红形态：消耗MP对单体造成物理伤害并提升攻击力；蓝形态：群体法术伤害，斩杀回蓝。',
  ...excl(),
  tiers: [
    { mpCost: 20, formEffects: {
      red: { mpCost: 10, target: 'enemyOne', damageType: 'physical', agiMulBase: 100, agiMulPer: 1, atkGainOnCast: 10, atkGainCap: 40 },
      blue: { mpCost: 15, target: 'enemyAll', damageType: 'magical', strMulBase: 80, strMulPer: 1, executeRefundMp: 5 },
    }, desc: '红：耗10MP，单体(100%+敏捷×1%)物伤，+10攻击力(上限40)；蓝：耗15MP，群体(80%+力量×1%)法伤，击杀回5MP。' },
    { mpCost: 20, formEffects: {
      red: { mpCost: 10, target: 'enemyOne', damageType: 'physical', agiMulBase: 100, agiMulPer: 1.25, atkGainOnCast: 15, atkGainCap: 45 },
      blue: { mpCost: 15, target: 'enemyAll', damageType: 'magical', strMulBase: 80, strMulPer: 1.25, executeRefundMp: 5 },
    }, desc: '红：耗10MP，单体(100%+敏捷×1.25%)物伤，+15攻击力(上限45)；蓝：耗15MP，群体(80%+力量×1.25%)法伤，击杀回5MP。' },
    { mpCost: 15, formEffects: {
      red: { mpCost: 10, target: 'enemyOne', damageType: 'physical', agiMulBase: 100, agiMulPer: 1.5, atkGainOnCast: 15, atkGainCap: 60 },
      blue: { mpCost: 10, target: 'enemyAll', damageType: 'magical', strMulBase: 100, strMulPer: 1.5, executeRefundMp: 5 },
    }, desc: '红：耗10MP，单体(100%+敏捷×1.5%)物伤，+15攻击力(上限60)；蓝：耗10MP，群体(100%+力量×1.5%)法伤，击杀回5MP。' },
  ],
};
// 掠影步：切换形态。红=消耗所有护盾回血，首次切换+力量；蓝=回合末迅捷，首次切换+敏捷
export const SK_KAYN_STEP: Skill = {
  id: 'sk_kayn_step', name: '掠影步', kind: 'active', mpCost: 0, target: 'self',
  switchForm: true,
  desc: '消耗30能量切换形态，红形态回血、蓝形态获迅捷。',
  ...excl(20),
  tiers: [
    { mpCost: 0, energyCost: 30, formEffects: {
      red: { switchForm: true, healFromShieldPct: 0.75, firstSwitchStr: 5 },
      blue: { switchForm: true, swiftTurnEnd: { intensity: 1, stacks: 2 }, firstSwitchAgi: 5 },
    }, desc: '红：耗30能量，消耗所有护盾，回75%×盾量HP，首次切换+5力量；蓝：耗30能量，回合末迅捷强度1(2层)，首次切换+5敏捷。' },
    { mpCost: 0, energyCost: 30, formEffects: {
      red: { switchForm: true, healFromShieldPct: 1.0, firstSwitchStr: 10 },
      blue: { switchForm: true, swiftTurnEnd: { intensity: 1, stacks: 3 }, firstSwitchAgi: 10 },
    }, desc: '红：耗30能量，消耗所有护盾，回100%×盾量HP，首次切换+10力量；蓝：耗30能量，回合末迅捷强度1(3层)，首次切换+10敏捷。' },
    { mpCost: 0, energyCost: 30, formEffects: {
      red: { switchForm: true, healFromShieldPct: 1.0, firstSwitchStr: 15 },
      blue: { switchForm: true, swiftTurnEnd: { intensity: 1, stacks: 3 }, firstSwitchAgi: 15 },
    }, desc: '红：耗30能量，消耗所有护盾，回100%×盾量HP，首次切换+15力量；蓝：耗30能量，回合末迅捷强度1(3层)，首次切换+15敏捷。' },
  ],
};
// 裂舍影：红=单体物伤(速度倍率)+获能量；蓝=消耗能量造成法伤+流血
export const SK_KAYN_REALM: Skill = {
  id: 'sk_kayn_realm', name: '裂舍影', kind: 'active', mpCost: 40, target: 'enemyOne',
  damageType: 'physical',
  desc: '红形态：消耗HP造成物理伤害并获得能量；蓝形态：消耗所有能量造成法术伤害并施加流血。',
  ...excl(40),
  tiers: [
    { mpCost: 40, formEffects: {
      red: { mpCost: 0, hpCost: 40, target: 'enemyOne', damageType: 'physical', spdMulBase: 120, spdMulPer: 10, energyGainFromAgi: 1 },
      blue: { mpCost: 30, target: 'enemyOne', damageType: 'magical', consumeAllEnergy: true, energyStrMul: 1.0, energyAtkMul: 1.0, applyBuffs: [{ id: 'bleed', stacks: 2, intensity: 2, target: 'enemy' }] },
    }, desc: '红：耗40HP，单体(120%+速度×10%)物伤，获敏捷×1能量；蓝：耗30MP+所有能量，100%×(力量+消耗能量)+100%×攻击力法伤，流血(强度2,2层)。' },
    { mpCost: 40, formEffects: {
      red: { mpCost: 0, hpCost: 40, target: 'enemyOne', damageType: 'physical', spdMulBase: 120, spdMulPer: 10, energyGainFromAgi: 1.5 },
      blue: { mpCost: 20, target: 'enemyOne', damageType: 'magical', consumeAllEnergy: true, energyStrMul: 1.25, energyAtkMul: 1.25, applyBuffs: [{ id: 'bleed', stacks: 2, intensity: 2, target: 'enemy' }] },
    }, desc: '红：耗40HP，单体(120%+速度×10%)物伤，获敏捷×1.5能量；蓝：耗20MP+所有能量，125%×(力量+消耗能量)+125%×攻击力法伤，流血(强度2,2层)。' },
    { mpCost: 40, formEffects: {
      red: { mpCost: 0, hpCost: 40, target: 'enemyOne', damageType: 'physical', spdMulBase: 150, spdMulPer: 15, energyGainFromAgi: 2 },
      blue: { mpCost: 20, target: 'enemyOne', damageType: 'magical', consumeAllEnergy: true, energyStrMul: 1.5, energyAtkMul: 1.5, applyBuffs: [{ id: 'bleed', stacks: 2, intensity: 2, target: 'enemy' }] },
    }, desc: '红：耗40HP，单体(150%+速度×15%)物伤，获敏捷×2能量；蓝：耗20MP+所有能量，150%×(力量+消耗能量)+150%×攻击力法伤，流血(强度2,2层)。' },
  ],
};

// ===== 逻各斯 · 终末言灵（魔法）=====
// 殁亡：被动，回合末若敌方HP低于阈值则斩杀，之后对随机敌方造成法术伤害，可连锁
export const SK_LOGOS_MORT: Skill = {
  id: 'sk_logos_mort', name: '殁亡', kind: 'passive', mpCost: 0, target: 'self',
  desc: 'Lv.1 被动：回合末若敌方HP低于(等级×2+智力×1)则直接斩杀，并对随机敌方造成斩杀时该单位HP的法术伤害，可连锁。',
  ...excl(),
  tiers: [
    { mpCost: 0, executeIntMul: 1, executeChain: true, desc: '被动：回合末若敌方HP低于(等级×2+智力×1)则直接斩杀，并对随机敌方造成斩杀时该单位HP的法术伤害，可连锁。' },
    { mpCost: 0, executeIntMul: 1.5, executeChain: true, desc: '被动：回合末若敌方HP低于(等级×2+智力×1.5)则直接斩杀，并对随机敌方造成斩杀时该单位HP的法术伤害，可连锁。' },
    { mpCost: 0, executeIntMul: 2, executeChain: true, desc: '被动：回合末若敌方HP低于(等级×2+智力×2)则直接斩杀，并对随机敌方造成斩杀时该单位HP的法术伤害，可连锁。' },
  ],
};
// 提喻：主动，对敌方单体造成两段 (基础+智力×系数)% 攻击力的法术伤害
export const SK_LOGOS_METONYMY: Skill = {
  id: 'sk_logos_metonymy', name: '提喻', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'magical',
  desc: 'Lv.1 对敌方单体造成两段(50+智力×0.5)%攻击力的法术伤害。',
  ...excl(),
  tiers: [
    { mpCost: 10, intMulBase: 50, intMulPerInt: 0.5, hits: 2, desc: '对敌方单体造成两段(50+智力×0.5)%攻击力的法术伤害。' },
    { mpCost: 10, intMulBase: 60, intMulPerInt: 0.6, hits: 2, desc: '对敌方单体造成两段(60+智力×0.6)%攻击力的法术伤害。' },
    { mpCost: 10, intMulBase: 70, intMulPerInt: 0.7, hits: 2, desc: '对敌方单体造成两段(70+智力×0.7)%攻击力的法术伤害。' },
  ],
};
// 语汇演化：被动，无视法抗 + 攻击后随机伤害 + 攻击附加凋亡
export const SK_LOGOS_EVOLVE: Skill = {
  id: 'sk_logos_evolve', name: '语汇演化', kind: 'passive', mpCost: 0, target: 'self',
  desc: 'Lv.1 被动：无视敌方5点法抗，每次攻击后随机对敌方单位造成(智力×0.5)%攻击力的法术伤害，攻击都会施加一层凋亡。',
  ...excl(20),
  tiers: [
    { mpCost: 0, ignoreMresFlat: 5, afterHitRandomMagicMul: 0.5, applyApoptosisOnHit: true, desc: '被动：无视敌方5点法抗，每次攻击后随机对敌方单位造成(智力×0.5)%攻击力的法术伤害，攻击都会施加一层凋亡。' },
    { mpCost: 0, ignoreMresFlat: 10, afterHitRandomMagicMul: 0.75, applyApoptosisOnHit: true, desc: '被动：无视敌方10点法抗，每次攻击后随机对敌方单位造成(智力×0.75)%攻击力的法术伤害，攻击都会施加一层凋亡。' },
    { mpCost: 0, ignoreMresFlat: 10, afterHitRandomMagicMul: 1, applyApoptosisOnHit: true, desc: '被动：无视敌方10点法抗，每次攻击后随机对敌方单位造成(智力×1)%攻击力的法术伤害，攻击都会施加一层凋亡。' },
  ],
};
// 延异视阈：主动，对敌方全体造成法术伤害并使凋亡强度+2
export const SK_LOGOS_DIFFRANCE: Skill = {
  id: 'sk_logos_diffrance', name: '延异视阈', kind: 'active', mpCost: 40, target: 'enemyAll',
  damageType: 'magical', multiplier: 1.2,
  desc: 'Lv.1 对敌方全体造成120%的法术伤害，并使目标凋亡强度+2。',
  ...excl(40),
  tiers: [
    { mpCost: 40, multiplier: 1.2, apoptosisIntensityUp: 2, desc: '对敌方全体造成120%的法术伤害，并使目标凋亡强度+2。' },
    { mpCost: 40, multiplier: 1.5, apoptosisIntensityUp: 2, desc: '对敌方全体造成150%的法术伤害，并使目标凋亡强度+2。' },
    { mpCost: 30, multiplier: 1.8, apoptosisIntensityUp: 2, desc: '对敌方全体造成180%的法术伤害，并使目标凋亡强度+2。' },
  ],
};

// ===== 氮氮：低温掌控者 =====
// 杜瓦冷罐：群体法术伤害（固定值+智力加成）并施加寒冷
export const SK_DANDAN_DEWAR: Skill = {
  id: 'sk_dandan_dewar', name: '杜瓦冷罐', kind: 'active', mpCost: 10, target: 'enemyAll',
  damageType: 'magical',
  desc: 'Lv.1 对敌方群体造成(30+智力×1)的法术伤害，并施加寒冷强度1层数2。',
  ...excl(),
  tiers: [
    { mpCost: 10, flatDmgBase: 30, flatDmgIntMul: 1, applyBuffs: [{ id: 'chill', stacks: 2, intensity: 1, target: 'enemy' }], desc: '对敌方群体造成(30+智力×1)的法术伤害，并施加寒冷强度1层数2。' },
    { mpCost: 10, flatDmgBase: 50, flatDmgIntMul: 1, applyBuffs: [{ id: 'chill', stacks: 3, intensity: 1, target: 'enemy' }], desc: '对敌方群体造成(50+智力×1)的法术伤害，并施加寒冷强度1层数3。' },
    { mpCost: 10, flatDmgBase: 70, flatDmgIntMul: 1, applyBuffs: [{ id: 'chill', stacks: 4, intensity: 1, target: 'enemy' }], desc: '对敌方群体造成(70+智力×1)的法术伤害，并施加寒冷强度1层数4。' },
  ],
};
// 低温附着（被动）：敌方携带寒冷时，回合末所有效果层数+X（T3额外强度+1）
export const SK_DANDAN_ADHESION: Skill = {
  id: 'sk_dandan_adhesion', name: '低温附着', kind: 'passive', mpCost: 0, target: 'self',
  desc: 'Lv.1 被动：敌方携带寒冷效果时，回合末其身上所有效果层数+1。',
  ...excl(20),
  tiers: [
    { mpCost: 0, chillAdhesionStacks: 1, desc: '被动：敌方携带寒冷效果时，回合末其身上所有效果层数+1。' },
    { mpCost: 0, chillAdhesionStacks: 2, desc: '被动：敌方携带寒冷效果时，回合末其身上所有效果层数+2。' },
    { mpCost: 0, chillAdhesionStacks: 3, desc: '被动：敌方携带寒冷效果时，回合末其身上所有效果层数+3。' },
  ],
};
// 温感追踪震撼弹：单体施加破甲；若目标存在寒冷，消耗一半寒冷层数造成法术伤害
export const SK_DANDAN_GRENADE: Skill = {
  id: 'sk_dandan_grenade', name: '温感追踪震撼弹', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'magical',
  desc: 'Lv.1 对敌方单体施加破甲强度1层数1；若敌方存在寒冷，消耗一半寒冷层数，造成消耗层数×智力的法术伤害。',
  ...excl(),
  tiers: [
    { mpCost: 10, applyArmorBreak: { intensity: 1, stacks: 1 }, consumeHalfChillIntMul: 1, desc: '对敌方单体施加破甲强度1层数1；若敌方存在寒冷，消耗一半寒冷层数，造成消耗层数×智力的法术伤害。' },
    { mpCost: 10, applyArmorBreak: { intensity: 1, stacks: 2 }, consumeHalfChillIntMul: 1, desc: '对敌方单体施加破甲强度1层数2；若敌方存在寒冷，消耗一半寒冷层数，造成消耗层数×智力的法术伤害。' },
    { mpCost: 5, applyArmorBreak: { intensity: 1, stacks: 3 }, consumeHalfChillIntMul: 1, desc: '对敌方单体施加破甲强度1层数3；若敌方存在寒冷，消耗一半寒冷层数，造成消耗层数×智力的法术伤害。' },
  ],
};
// 冷凝榴弹（被动）：追踪敌方受到的寒冷伤害与被消耗的寒冷层数，触发减益
export const SK_DANDAN_CONDENS: Skill = {
  id: 'sk_dandan_condens', name: '冷凝榴弹', kind: 'passive', mpCost: 0, target: 'self',
  desc: '被动：敌方累计寒冷伤害>500时，-5%防御、-5法抗；>1000时再触发一次。累计消耗寒冷>10层时，永久-1速度（仅触发一次）。',
  ...excl(40),
  condensDefRedPct: 5,
  condensMresRed: 5,
  condensPermSpdRed: 1,
  tiers: [
    { mpCost: 0, condensDefRedPct: 5, condensMresRed: 5, condensPermSpdRed: 1, desc: '敌方累计寒冷伤害>500时-5%防御-5法抗，>1000再触发一次；累计消耗寒冷>10层永久-1速度。' },
    { mpCost: 0, condensDefRedPct: 10, condensMresRed: 5, condensPermSpdRed: 1, desc: '敌方累计寒冷伤害>500时-10%防御-5法抗，>1000再触发一次；累计消耗寒冷>10层永久-1速度。' },
    { mpCost: 0, condensDefRedPct: 10, condensMresRed: 5, condensPermSpdRed: 2, desc: '敌方累计寒冷伤害>500时-10%防御-5法抗，>1000再触发一次；累计消耗寒冷>10层永久-2速度。' },
  ],
};

// ===== 神秘面具男 =====
// 豪火球之术：群体法术伤害，倍率=(strMulBase+力量)%攻击力；可选虚化增强
export const SK_MASKED_FIREBALL: Skill = {
  id: 'sk_masked_fireball', name: '豪火球之术', kind: 'active', mpCost: 10, target: 'enemyAll',
  damageType: 'magical',
  desc: 'Lv.1 10MP，造成群体(80+力量)%攻击力的法术伤害。可额外消耗5MP和1次虚化次数使倍率+60%，并造成2层强度1的烧伤。',
  ...excl(1),
  tiers: [
    { mpCost: 10, strMulBase: 80, enhanceMpCost: 5, enhanceMulBonus: 0.6, enhanceKamuiCost: 1, enhanceApplyBuffs: [{ id: 'burn', stacks: 2, intensity: 1, target: 'enemy' }], desc: '10MP，造成群体(80+力量)%攻击力的法术伤害。可额外消耗5MP和1次虚化次数使倍率+60%，并造成2层强度1的烧伤。' },
    { mpCost: 10, strMulBase: 100, enhanceMpCost: 5, enhanceMulBonus: 0.8, enhanceKamuiCost: 1, enhanceApplyBuffs: [{ id: 'burn', stacks: 2, intensity: 2, target: 'enemy' }], desc: '10MP，造成群体(100+力量)%攻击力的法术伤害。可额外消耗5MP和1次虚化次数使倍率+80%，并造成2层强度2的烧伤。' },
    { mpCost: 10, strMulBase: 120, enhanceMpCost: 5, enhanceMulBonus: 1.0, enhanceKamuiCost: 1, enhanceApplyBuffs: [{ id: 'burn', stacks: 2, intensity: 2, target: 'enemy' }], desc: '10MP，造成群体(120+力量)%攻击力的法术伤害。可额外消耗5MP和1次虚化次数使倍率+100%，并造成2层强度2的烧伤。' },
  ],
};

// 天锁爆葬：单体物理伤害，倍率=(spdMulBase+当前速度×spdMulPer)%攻击力；可选虚化增强
export const SK_MASKED_CHAIN: Skill = {
  id: 'sk_masked_chain', name: '天锁爆葬', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'physical',
  desc: 'Lv.1 10MP，造成单体(80+当前速度×10)%攻击力的物理伤害。可额外消耗5MP和1次虚化次数使倍率+60%，并造成2层强度1的束缚。',
  ...excl(1),
  tiers: [
    { mpCost: 10, spdMulBase: 80, spdMulPer: 10, enhanceMpCost: 5, enhanceMulBonus: 0.6, enhanceKamuiCost: 1, enhanceApplyBuffs: [{ id: 'bind', stacks: 2, intensity: 1, target: 'enemy' }], desc: '10MP，造成单体(80+当前速度×10)%攻击力的物理伤害。可额外消耗5MP和1次虚化次数使倍率+60%，并造成2层强度1的束缚。' },
    { mpCost: 10, spdMulBase: 90, spdMulPer: 10, enhanceMpCost: 5, enhanceMulBonus: 0.8, enhanceKamuiCost: 1, enhanceApplyBuffs: [{ id: 'bind', stacks: 2, intensity: 2, target: 'enemy' }], desc: '10MP，造成单体(90+当前速度×10)%攻击力的物理伤害。可额外消耗5MP和1次虚化次数使倍率+80%，并造成2层强度2的束缚。' },
    { mpCost: 10, spdMulBase: 100, spdMulPer: 10, enhanceMpCost: 5, enhanceMulBonus: 1.0, enhanceKamuiCost: 1, enhanceApplyBuffs: [{ id: 'bind', stacks: 2, intensity: 3, target: 'enemy' }], desc: '10MP，造成单体(100+当前速度×10)%攻击力的物理伤害。可额外消耗5MP和1次虚化次数使倍率+100%，并造成2层强度3的束缚。' },
  ],
};

// 虚化：反应技能，受击前选择虚化闪避攻击并获得强壮
export const SK_MASKED_KAMUI: Skill = {
  id: 'sk_masked_kamui', name: '虚化', kind: 'reaction', mpCost: 10, target: 'self',
  reaction: {
    mode: 'kamui',
    usesPerTurn: 1,
    selfBuffId: 'strength',
    selfBuffStacks: 2,
    minIntensity: 1,
    intensityFromSpdDiff: true,
  },
  desc: 'Lv.1 被动·反应：攻击顺序在自己之后的敌方攻击自身时，可选择虚化（耗10MP）无效本次攻击，自身强壮层数+2（强度=双方速度差，至少1）。每回合1次。',
  ...excl(20),
  tiers: [
    { mpCost: 10, reactionUsesPerTurn: 1, desc: '被动·反应：敌方攻击自身时可虚化（耗10MP）闪避，自身强壮+2层（强度=速度差，至少1）。每回合1次。' },
    { mpCost: 10, reactionUsesPerTurn: 2, desc: '被动·反应：敌方攻击自身时可虚化（耗10MP）闪避，自身强壮+2层（强度=速度差，至少1）。每回合2次。' },
    { mpCost: 5, reactionUsesPerTurn: 2, desc: '被动·反应：敌方攻击自身时可虚化（耗5MP）闪避，自身强壮+2层（强度=速度差，至少1）。每回合2次。' },
  ],
};

// 神威•放逐：单体真实伤害=基础+双方BUFF种数×系数；可斩杀残血
export const SK_MASKED_EXILE: Skill = {
  id: 'sk_masked_exile', name: '神威•放逐', kind: 'active', mpCost: 30, target: 'enemyOne',
  damageType: 'true',
  desc: 'Lv.1 30MP，造成单体(100+双方BUFF层数与强度之和×20)的真实伤害。若伤害后敌方HP低于最大生命值10%，可额外消耗10MP和1次虚化次数将其斩杀。',
  ...excl(40),
  tiers: [
    { mpCost: 30, trueDmgBase: 100, trueDmgPerBuff: 20, kamuiExecute: true, kamuiExecuteHpPct: 0.1, kamuiExecuteMpCost: 10, kamuiExecuteKamuiCost: 1, desc: '30MP，造成单体(100+双方BUFF层数与强度之和×20)的真实伤害。若伤害后敌方HP低于最大生命值10%，可额外消耗10MP和1次虚化次数斩杀。' },
    { mpCost: 30, trueDmgBase: 100, trueDmgPerBuff: 30, kamuiExecute: true, kamuiExecuteHpPct: 0.1, kamuiExecuteMpCost: 10, kamuiExecuteKamuiCost: 1, desc: '30MP，造成单体(100+双方BUFF层数与强度之和×30)的真实伤害。若伤害后敌方HP低于最大生命值10%，可额外消耗10MP和1次虚化次数斩杀。' },
    { mpCost: 30, trueDmgBase: 100, trueDmgPerBuff: 40, kamuiExecute: true, kamuiExecuteHpPct: 0.1, kamuiExecuteMpCost: 10, kamuiExecuteKamuiCost: 1, desc: '30MP，造成单体(100+双方BUFF层数与强度之和×40)的真实伤害。若伤害后敌方HP低于最大生命值10%，可额外消耗10MP和1次虚化次数斩杀。' },
  ],
};

// ===== 奥古斯塔 · 诸王的冠冕（近战，战势强化）=====
// 诸王的冠冕（被动）：行动/受击累积战势，达到阈值触发强化
export const SK_AUGUSTA_CROWN: Skill = {
  id: 'sk_augusta_crown', name: '诸王的冠冕', kind: 'passive', mpCost: 0, target: 'self',
  desc: '被动：每次行动或受击获得战势。战势达到3层时，普攻/技能触发强化效果并消耗3层。',
  ...excl(),
  augustaMomentum: { max: 3, onHitPerTurn: 1, enhanceThreshold: 3, enhancedBasicHits: 2, enhancedBasicMul: 0.9 },
  tiers: [
    { mpCost: 0, augustaMomentum: { max: 3, onHitPerTurn: 1, enhanceThreshold: 3, enhancedBasicHits: 2, enhancedBasicMul: 0.9 },
      desc: '被动：非强化普攻/技能或受击获得1层战势（受击每回合最多1层，上限3层）。达3层时普攻/技能强化并消耗3层。强化普攻：两段90%物伤。' },
    { mpCost: 0, augustaMomentum: { max: 4, onHitPerTurn: 2, enhanceThreshold: 3, enhancedBasicHits: 2, enhancedBasicMul: 1.0, turnStartGain: 1 },
      desc: '被动：每次行动或受击获得1层战势（受击每回合最多2层，上限4层），每回合开始获得1层战势。达3层时普攻/技能强化并消耗3层。强化普攻：两段100%物伤。' },
    { mpCost: 0, augustaMomentum: { max: 5, onHitPerTurn: 2, enhanceThreshold: 3, enhancedBasicHits: 2, enhancedBasicMul: 1.1, turnStartGain: 1 },
      desc: '被动：每次行动或受击获得1层战势（受击每回合最多2层，上限5层），每回合开始获得1层战势。达3层时普攻/技能强化并消耗3层。强化普攻：两段110%物伤。' },
  ],
};
// 贯星长枪：单体物伤，倍率=(base+力量×strMulPer)%攻击力；目标HP<50%时伤害提升；强化：倍率+X并回血
export const SK_AUGUSTA_SPEAR: Skill = {
  id: 'sk_augusta_spear', name: '贯星长枪', kind: 'active', mpCost: 10, target: 'enemyOne',
  damageType: 'physical',
  desc: 'Lv.1 10MP，造成单体(70+力量)%攻击力的物理伤害。目标HP<50%时伤害+50%。强化：倍率+50%并恢复力量×1的HP。',
  ...excl(),
  tiers: [
    { mpCost: 10, strMulBase: 70, strMulPer: 1, lowHpBonusMulPct: 0.5, augustaEnhanceMulBonus: 0.5, augustaEnhanceHealFromStr: 1, desc: '10MP，单体(70+力量)%物伤，目标HP<50%时伤害+50%。强化：倍率+50%，恢复力量×1的HP。' },
    { mpCost: 10, strMulBase: 80, strMulPer: 1.2, lowHpBonusMulPct: 0.6, augustaEnhanceMulBonus: 0.6, augustaEnhanceHealFromStr: 1.25, desc: '10MP，单体(80+力量×1.2)%物伤，目标HP<50%时伤害+60%。强化：倍率+60%，恢复力量×1.25的HP。' },
    { mpCost: 10, strMulBase: 90, strMulPer: 1.4, lowHpBonusMulPct: 0.7, augustaEnhanceMulBonus: 0.7, augustaEnhanceHealFromStr: 1.25, desc: '10MP，单体(90+力量×1.4)%物伤，目标HP<50%时伤害+70%。强化：倍率+70%，恢复力量×1.25的HP。' },
  ],
};
// 驭冕铸雷之权：获得(力量+意志)×系数护盾；强化：我方全体也获得等值护盾
export const SK_AUGUSTA_THUNDER: Skill = {
  id: 'sk_augusta_thunder', name: '驭冕铸雷之权', kind: 'active', mpCost: 10, target: 'self',
  desc: 'Lv.1 10MP，获得(力量+意志)的护盾。强化：我方全体也获得等值护盾。',
  ...excl(20),
  tiers: [
    { mpCost: 10, shieldFromStrWilMul: 1.0, augustaEnhanceAllyShield: true, desc: '10MP，获得(力量+意志)的护盾。强化：我方全体也获得等值护盾。' },
    { mpCost: 10, shieldFromStrWilMul: 1.2, augustaEnhanceAllyShield: true, desc: '10MP，获得(力量+意志)×1.2的护盾。强化：我方全体也获得等值护盾。' },
    { mpCost: 10, shieldFromStrWilMul: 1.4, augustaEnhanceAllyShield: true, desc: '10MP，获得(力量+意志)×1.4的护盾。强化：我方全体也获得等值护盾。' },
  ],
};
// 纯粹的武力：单体物伤，无视部分防御；强化：消耗所有战势，每层提升倍率
export const SK_AUGUSTA_FORCE: Skill = {
  id: 'sk_augusta_force', name: '纯粹的武力', kind: 'active', mpCost: 30, target: 'enemyOne',
  damageType: 'physical',
  desc: 'Lv.1 30MP，造成单体200%攻击力的物理伤害，无视10%防御。强化：消耗所有战势，每层提升10%倍率。',
  ...excl(40),
  tiers: [
    { mpCost: 30, multiplier: 2.0, ignoreDefPct: 0.1, augustaEnhanceConsumeAll: true, augustaEnhanceMulPerStack: 0.1, desc: '30MP，单体200%物伤，无视10%防御。强化：消耗所有战势，每层+10%倍率。' },
    { mpCost: 30, multiplier: 2.2, ignoreDefPct: 0.15, augustaEnhanceConsumeAll: true, augustaEnhanceMulPerStack: 0.15, desc: '30MP，单体220%物伤，无视15%防御。强化：消耗所有战势，每层+15%倍率。' },
    { mpCost: 30, multiplier: 2.4, ignoreDefPct: 0.2, augustaEnhanceConsumeAll: true, augustaEnhanceMulPerStack: 0.2, desc: '30MP，单体240%物伤，无视20%防御。强化：消耗所有战势，每层+20%倍率。' },
  ],
};

// ===== 小李 · 八门遁甲（近战，爆发型）=====
// 八门遁甲（被动·回合开始抉择）：每层+1最大速度、+固定攻击力；回合末受 层数×扁平值 真实伤害
export const SK_LEE_GATES: Skill = {
  id: 'sk_lee_gates', name: '八门遁甲', kind: 'passive', mpCost: 0, target: 'self',
  desc: '回合开始时可选择叠加1层八门遁甲。每层+1最大速度、+10攻击力，上限5层。回合末受 层数×10 真实伤害（MP足够时优先扣MP），本场战斗永久持续。',
  ...excl(),
  gatesMaxLayers: 5,
  gatesAtkPerLayer: 10,
  gatesEndTurnDmgFlat: 10,
  tiers: [
    { mpCost: 0, gatesMaxLayers: 5, gatesAtkPerLayer: 10, gatesEndTurnDmgFlat: 10, desc: '每层+1最大速度、+10攻击力。回合末受 层数×10 真实伤害（优先扣MP）。' },
    { mpCost: 0, gatesMaxLayers: 5, gatesAtkPerLayer: 15, gatesEndTurnDmgFlat: 8, desc: '每层+1最大速度、+15攻击力。回合末受 层数×8 真实伤害（优先扣MP）。' },
    { mpCost: 0, gatesMaxLayers: 5, gatesAtkPerLayer: 20, gatesEndTurnDmgFlat: 6, desc: '每层+1最大速度、+20攻击力。回合末受 层数×6 真实伤害（优先扣MP）。' },
  ],
};
// 瞬风（被动）：八门遁甲后对全体敌方施加 floor(敏捷/2+等级) 层木叶印记，普攻附加 印记层数×倍率 真实伤害
export const SK_LEE_WIND: Skill = {
  id: 'sk_lee_wind', name: '瞬风', kind: 'passive', mpCost: 0, target: 'self',
  desc: '每次八门遁甲后对全体敌方施加 floor(敏捷/2+等级) 层木叶印记；每次普攻附加 印记层数×0.1 的真实伤害（独立计算）。',
  ...excl(),
  konohaMarkPassive: true,
  konohaTrueDmgMul: 0.1,
  tiers: [
    { mpCost: 0, konohaMarkPassive: true, konohaTrueDmgMul: 0.1, desc: '八门遁甲后施加 floor(敏捷/2+等级) 层印记；普攻附加 印记层数×0.1 真实伤害。' },
    { mpCost: 0, konohaMarkPassive: true, konohaTrueDmgMul: 0.2, desc: '八门遁甲后施加 floor(敏捷/2+等级) 层印记；普攻附加 印记层数×0.2 真实伤害。' },
    { mpCost: 0, konohaMarkPassive: true, konohaTrueDmgMul: 0.3, desc: '八门遁甲后施加 floor(敏捷/2+等级) 层印记；普攻附加 印记层数×0.3 真实伤害。' },
  ],
};
// 表莲华：需八门遁甲≥1层，2次(印记层数×倍率)物理伤害，自损当前HP 20/15/10%，击杀回血=最大HP×15%
export const SK_LEE_FRONT_LOTUS: Skill = {
  id: 'sk_lee_front_lotus', name: '表莲华', kind: 'active', mpCost: 0, target: 'enemyOne',
  damageType: 'physical',
  desc: '需八门遁甲≥1层。对单体造成2次(印记层数×0.8)物理伤害，自损当前HP 20%，击杀回复最大HP 15%。',
  ...excl(20),
  gatesRequired: 1,
  tiers: [
    { mpCost: 0, gatesRequired: 1, lotusHits: 2, lotusMarkMul: 0.8, lotusHpCostPct: 0.2, lotusKillHealPct: 0.15, desc: '需八门≥1层。2次(印记层数×0.8)物理伤害，自损当前HP 20%，击杀回血=最大HP×15%。' },
    { mpCost: 0, gatesRequired: 1, lotusHits: 2, lotusMarkMul: 0.9, lotusHpCostPct: 0.15, lotusKillHealPct: 0.15, desc: '需八门≥1层。2次(印记层数×0.9)物理伤害，自损当前HP 15%，击杀回血=最大HP×15%。' },
    { mpCost: 0, gatesRequired: 1, lotusHits: 2, lotusMarkMul: 1.0, lotusHpCostPct: 0.1, lotusKillHealPct: 0.15, desc: '需八门≥1层。2次(印记层数×1.0)物理伤害，自损当前HP 10%，击杀回血=最大HP×15%。' },
  ],
};
// 里莲华：需八门≥3层，1次(目标最大HP×倍率)真伤 + 1次(印记×八门层数/除数)真伤，自损最大HP 40%，清空印记与八门
export const SK_LEE_REVERSE_LOTUS: Skill = {
  id: 'sk_lee_reverse_lotus', name: '里莲华', kind: 'active', mpCost: 0, target: 'enemyOne',
  damageType: 'physical',
  desc: '需八门遁甲≥3层。对单体造成 最大HP×5% 真实伤害 + 1次(印记层数×八门层数/3)真实伤害，自损最大HP 40%，清空木叶印记与八门遁甲。',
  ...excl(40),
  gatesRequired: 3,
  tiers: [
    { mpCost: 0, gatesRequired: 3, reverseLotusMaxHpMul: 0.05, reverseLotusPhysMul: 1/3, lotusHpCostPct: 0.4, desc: '需八门≥3层。最大HP×5%真伤 + (印记×八门层数)/3真伤，自损最大HP 40%，清空印记与八门。' },
    { mpCost: 0, gatesRequired: 3, reverseLotusMaxHpMul: 0.075, reverseLotusPhysMul: 1/2.5, lotusHpCostPct: 0.4, desc: '需八门≥3层。最大HP×7.5%真伤 + (印记×八门层数)/2.5真伤，自损最大HP 40%，清空印记与八门。' },
    { mpCost: 0, gatesRequired: 3, reverseLotusMaxHpMul: 0.10, reverseLotusPhysMul: 1/2, lotusHpCostPct: 0.4, desc: '需八门≥3层。最大HP×10%真伤 + (印记×八门层数)/2真伤，自损最大HP 40%，清空印记与八门。' },
  ],
};

// ===== DONK · 世一步 / 闪身步 / 魔王（远程，MP爆发型）=====
// 世一步（被动）：普攻消耗10MP，每消耗30MP额外造成(力量×0.8/0.9/1.0)%攻击力的真伤；MP归零时停回+恢复+攻强+回血
export const SK_DONK_SHIYI: Skill = {
  id: 'sk_donk_shiyi', name: '世一步', kind: 'passive', mpCost: 0, target: 'self',
  desc: '每次普攻消耗10MP，每消耗30MP额外造成(力量×0.8)%攻击力的真伤。回合开始MP为0时停止行动，恢复50%MP，获得0.5×累计消耗MP攻击力(上限50)并恢复(当前速度×4)HP。',
  ...excl(),
  shiyiMpCost: 10,
  shiyiTrueDmgStrMul: 0.8,
  shiyiMpRestorePct: 0.5,
  shiyiAtkBonusPct: 0.5,
  shiyiAtkCap: 50,
  tiers: [
    { mpCost: 0, shiyiMpCost: 10, shiyiTrueDmgStrMul: 0.8, shiyiMpRestorePct: 0.5, shiyiAtkBonusPct: 0.5, shiyiAtkCap: 50, desc: '普攻耗10MP，每消耗30MP额外造成(力量×0.8)%攻击力真伤。MP为0时停回、恢复50%MP、+0.5×累计消耗MP攻击力(上限50)并恢复(当前速度×4)HP。' },
    { mpCost: 0, shiyiMpCost: 10, shiyiTrueDmgStrMul: 0.9, shiyiMpRestorePct: 0.5, shiyiAtkBonusPct: 0.5, shiyiAtkCap: 50, desc: '普攻耗10MP，每消耗30MP额外造成(力量×0.9)%攻击力真伤。MP为0时停回、恢复50%MP、+0.5×累计消耗MP攻击力(上限50)并恢复(当前速度×4)HP。' },
    { mpCost: 0, shiyiMpCost: 10, shiyiTrueDmgStrMul: 1.0, shiyiMpRestorePct: 0.5, shiyiAtkBonusPct: 0.5, shiyiAtkCap: 50, desc: '普攻耗10MP，每消耗30MP额外造成(力量×1.0)%攻击力真伤。MP为0时停回、恢复50%MP、+0.5×累计消耗MP攻击力(上限50)并恢复(当前速度×4)HP。' },
  ],
};
// 射击（主动·30MP）：(基础倍率 + 5×最大速度)% 攻击力物理伤害，每消耗30MP提升倍率
export const SK_DONK_SHOOT: Skill = {
  id: 'sk_donk_shoot', name: '射击', kind: 'active', mpCost: 30, target: 'enemyOne',
  damageType: 'physical',
  desc: '30MP，造成(100+5×最大速度)%攻击力的物理伤害。局内每消耗30MP，倍率+50%（上限提升1次）。',
  ...excl(),
  shootBaseMul: 1.0,
  shootSpdBonusPct: 5,
  shootBonusPer30Mp: 0.5,
  shootBonusMaxUpgrades: 1,
  tiers: [
    { mpCost: 30, shootBaseMul: 1.0, shootSpdBonusPct: 5, shootBonusPer30Mp: 0.5, shootBonusMaxUpgrades: 1, desc: '30MP，造成(100+5×最大速度)%攻击力物理伤害。每消耗30MP倍率+50%（上限1次）。' },
    { mpCost: 30, shootBaseMul: 1.2, shootSpdBonusPct: 5, shootBonusPer30Mp: 0.6, shootBonusMaxUpgrades: 2, desc: '30MP，造成(120+5×最大速度)%攻击力物理伤害。每消耗30MP倍率+60%（上限2次）。' },
    { mpCost: 30, shootBaseMul: 1.4, shootSpdBonusPct: 5, shootBonusPer30Mp: 0.7, shootBonusMaxUpgrades: 2, desc: '30MP，造成(140+5×最大速度)%攻击力物理伤害。每消耗30MP倍率+70%（上限2次）。' },
  ],
};
// 闪身步（被动）：每消耗30MP，+1速度，上限Y
export const SK_DONK_DODGER: Skill = {
  id: 'sk_donk_dodger', name: '闪身步', kind: 'passive', mpCost: 0, target: 'self',
  desc: '每消耗30MP，+1速度，上限3。',
  ...excl(20),
  dodgerMpPerSpd: 30,
  dodgerSpdCap: 3,
  tiers: [
    { mpCost: 0, dodgerMpPerSpd: 30, dodgerSpdCap: 3, desc: '每消耗30MP，+1速度，上限3。' },
    { mpCost: 0, dodgerMpPerSpd: 30, dodgerSpdCap: 4, desc: '每消耗30MP，+1速度，上限4。' },
    { mpCost: 0, dodgerMpPerSpd: 30, dodgerSpdCap: 5, desc: '每消耗30MP，+1速度，上限5。' },
  ],
};
// 魔王（被动）：攻击附带(力量×倍率)%攻击力真伤；累计消耗50MP后每回合强壮+1层+1强度
export const SK_DONK_DEMON: Skill = {
  id: 'sk_donk_demon', name: '魔王', kind: 'passive', mpCost: 0, target: 'self',
  desc: '攻击附带(力量×1.0)%攻击力的真伤。若已消耗50MP，则每回合强壮层数+1、强度+1（强度上限2）。',
  ...excl(40),
  demonMpThreshold: 50,
  demonStrMul: 1.0,
  demonStrCap: 2,
  tiers: [
    { mpCost: 0, demonMpThreshold: 50, demonStrMul: 1.0, demonStrCap: 2, desc: '攻击附带(力量×1.0)%攻击力真伤。已消耗50MP时每回合强壮+1层+1强度（上限2）。' },
    { mpCost: 0, demonMpThreshold: 50, demonStrMul: 1.25, demonStrCap: 3, desc: '攻击附带(力量×1.25)%攻击力真伤。已消耗50MP时每回合强壮+1层+1强度（上限3）。' },
    { mpCost: 0, demonMpThreshold: 50, demonStrMul: 1.5, demonStrCap: 4, desc: '攻击附带(力量×1.5)%攻击力真伤。已消耗50MP时每回合强壮+1层+1强度（上限4）。' },
  ],
};

// ===== 新约能天使 · 弹药体系（远程）=====
// 铳弹协约：被动，进入战斗携带幸运值弹药，行动前消耗弹药提升下次攻击，回合末自伤
export const SK_EXUSIAI_PACT: Skill = {
  id: 'sk_exusiai_pact', name: '铳弹协约', kind: 'passive', mpCost: 0, target: 'self',
  desc: '进入战斗携带自身幸运+5的弹药数。每消耗1发弹药使下次攻击倍率+10%。自身行动前消耗5发弹药（不足则全部消耗）。回合末对自身造成当前生命值5%的真实伤害。',
  ...excl(),
  ammoStartBase: 5,
  ammoPreActionCost: 5,
  ammoMulPerBullet: 0.1,
  ammoTurnEndTrueDmgPct: 0.05,
  tiers: [
    { mpCost: 0, ammoStartBase: 5, ammoPreActionCost: 5, ammoMulPerBullet: 0.1, ammoTurnEndTrueDmgPct: 0.05, desc: '进入战斗携带幸运+5弹药。每发弹药下次攻击+10%。行动前消耗5发。回合末自损5%当前HP真伤。' },
    { mpCost: 0, ammoStartBase: 15, ammoPreActionCost: 5, ammoMulPerBullet: 0.1, ammoTurnEndTrueDmgPct: 0.05, desc: '进入战斗携带幸运+15弹药。每发弹药下次攻击+10%。行动前消耗5发。回合末自损5%当前HP真伤。' },
    { mpCost: 0, ammoStartBase: 25, ammoPreActionCost: 5, ammoMulPerBullet: 0.1, ammoTurnEndTrueDmgPct: 0.05, desc: '进入战斗携带幸运+25弹药。每发弹药下次攻击+10%。行动前消耗5发。回合末自损5%当前HP真伤。' },
  ],
};

// 开火成瘾症：主动，获得护盾并施加开火成瘾（攻击额外消耗弹药），有友方时给最低速友方护盾并提升消耗
export const SK_EXUSIAI_ADDICTION: Skill = {
  id: 'sk_exusiai_addiction', name: '开火成瘾症', kind: 'active', mpCost: 20, target: 'self',
  desc: '获得敏捷×1.5的护盾，自身获得开火成瘾（每次攻击额外消耗5发弹药）。若有友方单位，给速度最低的友方等值护盾且开火成瘾变为额外消耗10发。弹药不足行动前消耗时解除开火成瘾。',
  ...excl(10),
  fireAddictionShieldAgiMul: 1.5,
  fireAddictionExtraAmmo: 5,
  fireAddictionAllyExtraAmmo: 10,
  tiers: [
    { mpCost: 20, fireAddictionShieldAgiMul: 1.5, fireAddictionExtraAmmo: 5, fireAddictionAllyExtraAmmo: 10, desc: '获得敏捷×1.5护盾+开火成瘾(+5弹药/次)。有友方则最低速友方获等值护盾且消耗+10。' },
    { mpCost: 20, fireAddictionShieldAgiMul: 2.0, fireAddictionExtraAmmo: 5, fireAddictionAllyExtraAmmo: 10, desc: '获得敏捷×2护盾+开火成瘾(+5弹药/次)。有友方则最低速友方获等值护盾且消耗+10。' },
    { mpCost: 20, fireAddictionShieldAgiMul: 2.5, fireAddictionExtraAmmo: 5, fireAddictionAllyExtraAmmo: 10, desc: '获得敏捷×2.5护盾+开火成瘾(+5弹药/次)。有友方则最低速友方获等值护盾且消耗+10。' },
  ],
};

// 火力电台：被动，每消耗10发弹药对随机敌方造成物理伤害并回血
export const SK_EXUSIAI_RADIO: Skill = {
  id: 'sk_exusiai_radio', name: '火力电台', kind: 'passive', mpCost: 0, target: 'self',
  desc: '每消耗10发弹药，对随机敌方单位造成（100+敏捷）%攻击力的物理伤害并恢复自身幸运值的HP。',
  ...excl(20),
  radioAmmoThreshold: 10,
  radioDmgBasePct: 100,
  radioHealLukMul: 1,
  tiers: [
    { mpCost: 0, radioAmmoThreshold: 10, radioDmgBasePct: 100, radioHealLukMul: 1, desc: '每消耗10发弹药，对随机敌方造成（100+敏捷）%攻击力物理伤害并回复幸运值HP。' },
    { mpCost: 0, radioAmmoThreshold: 10, radioDmgBasePct: 120, radioHealLukMul: 1, desc: '每消耗10发弹药，对随机敌方造成（120+敏捷）%攻击力物理伤害并回复幸运值HP。' },
    { mpCost: 0, radioAmmoThreshold: 10, radioDmgBasePct: 140, radioHealLukMul: 1, desc: '每消耗10发弹药，对随机敌方造成（140+敏捷）%攻击力物理伤害并回复幸运值HP。' },
  ],
};

// 使命必达：主动，获得弹药并让一名友方获得额外回合
export const SK_EXUSIAI_MISSION: Skill = {
  id: 'sk_exusiai_mission', name: '使命必达', kind: 'active', mpCost: 30, target: 'allyOne',
  desc: '获得20发弹药，选择一名友方单位使其获得一个额外回合（不占用该单位当前行动）。',
  ...excl(40),
  missionAmmoGain: 20,
  tiers: [
    { mpCost: 30, missionAmmoGain: 20, desc: '获得20发弹药，使一名友方获得额外回合。' },
    { mpCost: 30, missionAmmoGain: 25, desc: '获得25发弹药，使一名友方获得额外回合。' },
    { mpCost: 30, missionAmmoGain: 30, desc: '获得30发弹药，使一名友方获得额外回合。' },
  ],
};

// ===== 爱弥斯 · 聚爆 / 形态切换 / 同步率（魔法，叠层引爆型）=====
// 永远的启明星（被动）：聚爆体系核心；首击辉芒；每次攻击施加聚爆
export const SK_EIMIS_STAR: Skill = {
  id: 'sk_eimis_star', name: '永远的启明星', kind: 'passive', mpCost: 0, target: 'self',
  desc: '初始聚爆上限10，登场为人形态。首次普攻为强化普攻"即可响应-辉芒"，造成(80+魅力)%全体法术伤害并施加3层聚爆。每次攻击对目标施加魅力/10（向下取整）层聚爆。溢出层数每层使下次普攻/强化普攻倍率+10%。',
  ...excl(),
  eimisHuiMangBasePct: 80,
  eimisHuiMangChaMul: 1.0,
  eimisHuiMangStacks: 3,
  eimisImplosionBaseCap: 10,
  eimisImplosionDmgPctPerStack: 12,
  tiers: [
    { mpCost: 0, eimisHuiMangBasePct: 80, eimisHuiMangChaMul: 1.0, eimisHuiMangStacks: 3, eimisImplosionBaseCap: 10, eimisImplosionDmgPctPerStack: 12, desc: '聚爆上限10。首击辉芒(80+魅力)%全体法伤+3层聚爆。每次攻击施加floor(魅力/10)层聚爆，引爆造成上限×12%攻击力法伤，溢出每层下次倍率+10%。' },
    { mpCost: 0, eimisHuiMangBasePct: 90, eimisHuiMangChaMul: 1.2, eimisHuiMangStacks: 4, eimisImplosionBaseCap: 10, eimisImplosionDmgPctPerStack: 12, desc: '聚爆上限10。首击辉芒(90+魅力×1.2)%全体法伤+4层聚爆。每次攻击施加floor(魅力/10)层聚爆，引爆造成上限×12%攻击力法伤，溢出每层下次倍率+10%。' },
    { mpCost: 0, eimisHuiMangBasePct: 100, eimisHuiMangChaMul: 1.4, eimisHuiMangStacks: 4, eimisImplosionBaseCap: 10, eimisImplosionDmgPctPerStack: 12, desc: '聚爆上限10。首击辉芒(100+魅力×1.4)%全体法伤+4层聚爆。每次攻击施加floor(魅力/10)层聚爆，引爆造成上限×12%攻击力法伤，溢出每层下次倍率+10%。' },
  ],
};
// 共赴长航（主动·10MP）：切换人/机甲形态；被动：本回合有聚爆引爆则回合末可选择切换
export const SK_EIMIS_VOYAGE: Skill = {
  id: 'sk_eimis_voyage', name: '共赴长航', kind: 'active', mpCost: 10, target: 'self',
  desc: '10MP，切换人/机甲形态。人形态：魅力+10（上限20）；机甲形态：获得魅力×1.5护盾。被动：本回合任意敌方聚爆被引爆，回合末可选择消耗10MP切换一次形态并对敌方全体施加floor(等级/10)层聚爆。',
  ...excl(10),
  eimisHumanChaGain: 10,
  eimisHumanChaCap: 20,
  eimisMechShieldChaMul: 1.5,
  tiers: [
    { mpCost: 10, eimisHumanChaGain: 10, eimisHumanChaCap: 20, eimisMechShieldChaMul: 1.5, desc: '人形态魅力+10(上限20)；机甲形态获得魅力×1.5护盾。回合末引爆后可消耗10MP切换并给敌方全体floor(等级/10)层聚爆。' },
    { mpCost: 10, eimisHumanChaGain: 15, eimisHumanChaCap: 30, eimisMechShieldChaMul: 1.75, desc: '人形态魅力+15(上限30)；机甲形态获得魅力×1.75护盾。回合末引爆后可消耗10MP切换并给敌方全体floor(等级/10)层聚爆。' },
    { mpCost: 10, eimisHumanChaGain: 20, eimisHumanChaCap: 40, eimisMechShieldChaMul: 2.0, desc: '人形态魅力+20(上限40)；机甲形态获得魅力×2护盾。回合末引爆后可消耗10MP切换并给敌方全体floor(等级/10)层聚爆。' },
  ],
};
// 为寂静赋形（被动）：回合末切换形态获得同步率；同步率提升聚爆上限与法穿；死亡转移聚爆
export const SK_EIMIS_SHAPE: Skill = {
  id: 'sk_eimis_shape', name: '为寂静赋形', kind: 'passive', mpCost: 0, target: 'self',
  desc: '每次通过回合末触发切换形态获得1点同步率。每点同步率使聚爆上限+5、自身无视敌方法抗+3。每获得1点同步率，下次普攻变为辉芒。敌方单位死亡时将其聚爆层数转移给当前场上层数最高的单位。',
  ...excl(20),
  eimisSyncCapBonus: 5,
  eimisMresPenPerSync: 3,
  tiers: [
    { mpCost: 0, eimisSyncCapBonus: 5, eimisMresPenPerSync: 3, desc: '每点同步率：聚爆上限+5、无视法抗+3。获得同步率时下次普攻变辉芒。敌方死亡转移聚爆给层数最高者。' },
    { mpCost: 0, eimisSyncCapBonus: 5, eimisMresPenPerSync: 4, desc: '每点同步率：聚爆上限+5、无视法抗+4。获得同步率时下次普攻变辉芒。敌方死亡转移聚爆给层数最高者。' },
    { mpCost: 0, eimisSyncCapBonus: 5, eimisMresPenPerSync: 5, desc: '每点同步率：聚爆上限+5、无视法抗+5。获得同步率时下次普攻变辉芒。敌方死亡转移聚爆给层数最高者。' },
  ],
};
// 飞至启明之时（主动）：满同步率可用，清空同步率，对敌方全体造成(聚爆上限×2)×20%攻击力法伤，再获1点同步率
export const SK_EIMIS_DAWN: Skill = {
  id: 'sk_eimis_dawn', name: '飞至启明之时', kind: 'active', mpCost: 50, target: 'enemyAll',
  damageType: 'magical',
  desc: '50MP，满同步率时可使用。清空同步率，立即对敌方群体造成当前聚爆层数上限×2引爆时的伤害（即上限×2×20%攻击力法伤），并获得1点同步率。',
  ...excl(40),
  eimisUltimateCapMul: 2,
  tiers: [
    { mpCost: 50, eimisUltimateCapMul: 2, desc: '满同步率可用。50MP，清空同步率，对敌方全体造成(上限×2×20)%攻击力法伤，获得1点同步率。' },
    { mpCost: 40, eimisUltimateCapMul: 2, desc: '满同步率可用。40MP，清空同步率，对敌方全体造成(上限×2×20)%攻击力法伤，获得1点同步率。' },
    { mpCost: 30, eimisUltimateCapMul: 2, desc: '满同步率可用。30MP，清空同步率，对敌方全体造成(上限×2×20)%攻击力法伤，获得1点同步率。' },
  ],
};

// ===== 里恩 · 不可预测的变化无常 / 假面 / 神谕代行者 / Furioso =====
// 一技能「不可预测的变化无常」：三种释放方式（冻血缠绕/无声贯穿/落叶哭泣），共享技能等级
export const SK_REIN_VARIABLE: Skill = {
  id: 'sk_rein_variable', name: '不可预测的变化无常', kind: 'active', mpCost: 10, target: 'enemyOne',
  desc: '一技能有三种释放方式：冻血缠绕（单体法伤+溅射）、无声贯穿（物伤无视防御）、落叶哭泣（真伤+回血）。',
  ...excl(),
  variants: [
    { id: 'frozen', name: '冻血缠绕', damageType: 'magical', randSixMulBase: 100, randSixMulPer: 1, splashMul: 0.5, desc: '对单体造成(100+随机6维)%攻击力法伤，并对剩余敌方造成该倍率×0.5的法伤。' },
    { id: 'pierce', name: '无声贯穿', damageType: 'physical', randSixMulBase: 120, randSixMulPer: 1, randSixIgnoreDefMul: 0.5, desc: '对单体造成(120+随机6维)%攻击力物伤，无视敌方(随机6维×0.5)防御。' },
    { id: 'leaf', name: '落叶哭泣', damageType: 'true', trueDmgMul: 1, healRandomSix: true, desc: '对单体造成100%攻击力真伤，并恢复自身随机6维HP。' },
  ],
  tiers: [
    {
      mpCost: 10, variants: [
        { id: 'frozen', name: '冻血缠绕', damageType: 'magical', randSixMulBase: 100, randSixMulPer: 1, splashMul: 0.5, desc: '对单体造成(100+随机6维)%攻击力法伤，并对剩余敌方造成该倍率×0.5的法伤。' },
        { id: 'pierce', name: '无声贯穿', damageType: 'physical', randSixMulBase: 120, randSixMulPer: 1, randSixIgnoreDefMul: 0.5, desc: '对单体造成(120+随机6维)%攻击力物伤，无视敌方(随机6维×0.5)防御。' },
        { id: 'leaf', name: '落叶哭泣', damageType: 'true', trueDmgMul: 1, healRandomSix: true, desc: '对单体造成100%攻击力真伤，并恢复自身随机6维HP。' },
      ], desc: '冻血缠绕：(100+随机6维)%单体法伤+×0.5溅射；无声贯穿：(120+随机6维)%物伤、无视随机6维×0.5防御；落叶哭泣：100%真伤+回随机6维HP。',
    },
    {
      mpCost: 10, variants: [
        { id: 'frozen', name: '冻血缠绕', damageType: 'magical', randSixMulBase: 120, randSixMulPer: 1, splashMul: 0.6, desc: '对单体造成(120+随机6维)%攻击力法伤，并对剩余敌方造成该倍率×0.6的法伤。' },
        { id: 'pierce', name: '无声贯穿', damageType: 'physical', randSixMulBase: 140, randSixMulPer: 1.2, randSixIgnoreDefMul: 0.75, desc: '对单体造成(140+随机6维×1.2)%攻击力物伤，无视敌方(随机6维×0.75)防御。' },
        { id: 'leaf', name: '落叶哭泣', damageType: 'true', trueDmgMul: 1.25, healRandomSix: true, desc: '对单体造成125%攻击力真伤，并恢复自身随机6维HP。' },
      ], desc: '冻血缠绕：(120+随机6维)%单体法伤+×0.6溅射；无声贯穿：(140+随机6维×1.2)%物伤、无视随机6维×0.75防御；落叶哭泣：125%真伤+回随机6维HP。',
    },
    {
      mpCost: 10, variants: [
        { id: 'frozen', name: '冻血缠绕', damageType: 'magical', randSixMulBase: 140, randSixMulPer: 1, splashMul: 0.7, desc: '对单体造成(140+随机6维)%攻击力法伤，并对剩余敌方造成该倍率×0.7的法伤。' },
        { id: 'pierce', name: '无声贯穿', damageType: 'physical', randSixMulBase: 160, randSixMulPer: 1.4, randSixIgnoreDefMul: 1, desc: '对单体造成(160+随机6维×1.4)%攻击力物伤，无视敌方(随机6维×1)防御。' },
        { id: 'leaf', name: '落叶哭泣', damageType: 'true', trueDmgMul: 1.5, healRandomSix: true, desc: '对单体造成150%攻击力真伤，并恢复自身随机6维HP。' },
      ], desc: '冻血缠绕：(140+随机6维)%单体法伤+×0.7溅射；无声贯穿：(160+随机6维×1.4)%物伤、无视随机6维×1防御；落叶哭泣：150%真伤+回随机6维HP。',
    },
  ],
};
// 二技能「一切都是假的，只有爱是真的」：登场假面减伤，回合末HP过低切换为伤口（额外速度/攻击）
export const SK_REIN_MASK: Skill = {
  id: 'sk_rein_mask', name: '一切都是假的，只有爱是真的', kind: 'passive', mpCost: 0, target: 'self',
  desc: '登场获得「遮盖伤口的假面」：全能减伤+10%。回合末若HP低于40%，假面更换为「灼烧着的伤口」：全能减伤+20%、速度+角色等级/10、攻击+角色等级。',
  ...excl(),
  reinMask: { maskDmgRed: 0.10, woundThreshold: 0.40, woundDmgRed: 0.20 },
  tiers: [
    { mpCost: 0, reinMask: { maskDmgRed: 0.10, woundThreshold: 0.40, woundDmgRed: 0.20 }, desc: '假面减伤10%；回合末HP<40%变伤口：减伤20%、速度+等级/10、攻击+等级。' },
    { mpCost: 0, reinMask: { maskDmgRed: 0.15, woundThreshold: 0.45, woundDmgRed: 0.25 }, desc: '假面减伤15%；回合末HP<45%变伤口：减伤25%、速度+等级/10、攻击+等级。' },
    { mpCost: 0, reinMask: { maskDmgRed: 0.20, woundThreshold: 0.50, woundDmgRed: 0.30 }, desc: '假面减伤20%；回合末HP<50%变伤口：减伤30%、速度+等级/10、攻击+等级。' },
  ],
};
// 三技能「神谕代行者」：回合开始随机指令标（技能变体+敌方目标），代行层数→解放（覆盖）/心-命运，未获层数→业
export const SK_REIN_ORACLE: Skill = {
  id: 'sk_rein_oracle', name: '神谕代行者', kind: 'passive', mpCost: 0, target: 'self',
  desc: '每回合开始随机对一技能的一个释放方式与一个敌方单位施加指令标。使用带指令标的技能+1层代行-赫尔墨斯，选择带指令标的目标+1层，两者都满足+3层。回合末达到3/6/9/12层触发解放I/II/III（覆盖）/心-命运。若本次行动未获得层数则获得1层「业」：防御-10%、法抗-5（上限5层）。',
  ...excl(20),
  reinOracle: { maxStacks: 12, freedomISix: 10, freedomIISix: 20, freedomIIAtkPerLv: 1, freedomIIISix: 30, freedomIIIAtkPerLv: 1, freedomIIIAllAmp: 0.20, fateSpd: 3, fateMpPerTurn: 10, karmaDefPct: 0.1, karmaMres: 5, karmaMax: 5 },
  tiers: [
    { mpCost: 0, reinOracle: { maxStacks: 12, freedomISix: 10, freedomIISix: 20, freedomIIAtkPerLv: 1, freedomIIISix: 30, freedomIIIAtkPerLv: 1, freedomIIIAllAmp: 0.20, fateSpd: 3, fateMpPerTurn: 10, karmaDefPct: 0.1, karmaMres: 5, karmaMax: 5 }, desc: '解放I：6维+10；解放II：6维+20、攻击+等级；解放III：6维+30、攻击+等级、全能增伤+20%；心-命运：速度+3、最高6维、每回合MP+10。' },
    { mpCost: 0, reinOracle: { maxStacks: 12, freedomISix: 20, freedomIISix: 30, freedomIIAtkPerLv: 1.25, freedomIIISix: 40, freedomIIIAtkPerLv: 1.25, freedomIIIAllAmp: 0.30, fateSpd: 4, fateMpPerTurn: 10, karmaDefPct: 0.1, karmaMres: 5, karmaMax: 5 }, desc: '解放I：6维+20；解放II：6维+30、攻击+等级×1.25；解放III：6维+40、攻击+等级×1.25、全能增伤+30%；心-命运：速度+4。' },
    { mpCost: 0, reinOracle: { maxStacks: 12, freedomISix: 30, freedomIISix: 40, freedomIIAtkPerLv: 1.5, freedomIIISix: 50, freedomIIIAtkPerLv: 1.5, freedomIIIAllAmp: 0.40, fateSpd: 5, fateMpPerTurn: 10, karmaDefPct: 0.1, karmaMres: 5, karmaMax: 5 }, desc: '解放I：6维+30；解放II：6维+40、攻击+等级×1.5；解放III：6维+50、攻击+等级×1.5、全能增伤+40%；心-命运：速度+5。' },
  ],
};
// 四技能「Furioso-Replica」：代行-赫尔墨斯12层+MP可用，随机9次 随机6维%攻击力 真伤，整场一次
export const SK_REIN_FURIOSO: Skill = {
  id: 'sk_rein_furioso', name: 'Furioso-Replica', kind: 'active', mpCost: 50, target: 'enemyAll',
  desc: '消耗50MP，代行-赫尔墨斯达到12层时可使用。随机对敌方单位造成9次自身随机6维%攻击力的真实伤害。整场战斗仅可使用一次。',
  ...excl(40),
  reinFurioso: { requireStacks: 12, hits: 9, dmgPctOfRandomSix: 1 },
  tiers: [
    { mpCost: 50, reinFurioso: { requireStacks: 12, hits: 9, dmgPctOfRandomSix: 1 }, desc: '50MP，代行12层可用。随机9次 随机6维%攻击力 真伤，整场一次。' },
    { mpCost: 40, reinFurioso: { requireStacks: 12, hits: 9, dmgPctOfRandomSix: 1 }, desc: '40MP，代行12层可用。随机9次 随机6维%攻击力 真伤，整场一次。' },
    { mpCost: 30, reinFurioso: { requireStacks: 12, hits: 9, dmgPctOfRandomSix: 1 }, desc: '30MP，代行12层可用。随机9次 随机6维%攻击力 真伤，整场一次。' },
  ],
};

// ===== 怪物技能（不耗蓝，冷却以行动次数计） =====
// 怪物以我方为目标：怪物的 enemyOne/enemyAll 在引擎里语义为"对方单体/群体"。
export const SK_THUNDER: Skill = {
  id: 'sk_thunder', name: '雷击', kind: 'active', mpCost: 0, target: 'enemyOne',
  damageType: 'magical', multiplier: 1, evenTurnOnly: true,
  desc: '偶数回合释放：对敌方单体造成攻击力100%的法术伤害，奇数回合普攻。',
};
export const SK_MINITHUNDER: Skill = {
  id: 'sk_minithunder', name: '小闪电', kind: 'active', mpCost: 0, target: 'enemyOne',
  damageType: 'magical', multiplier: 1.1, cooldown: 3,
  desc: '110%法术单体伤害，冷却3次行动。',
};

// 职业技能按 id 挂在角色定义上；怪物技能随怪物定义以对象形式携带，不入此表。
export const ALL_SKILLS: Skill[] = [
  SK_POWER, SK_DEFEND_WAR, SK_FIREBALL, SK_STORM, SK_PIERCE, SK_TRIPLE,
  SK_HUFF, SK_CLAW, SK_ABSORB, SK_LUCK_CORNER,
  SK_TYPHON_TRIPLE, SK_TYPHON_PIERCE, SK_TYPHON_RECON, SK_TYPHON_HUNT,
  SK_KAYN_PASSIVE, SK_KAYN_SCYTHE, SK_KAYN_STEP, SK_KAYN_REALM,
  SK_LOGOS_MORT, SK_LOGOS_METONYMY, SK_LOGOS_EVOLVE, SK_LOGOS_DIFFRANCE,
  SK_DANDAN_DEWAR, SK_DANDAN_ADHESION, SK_DANDAN_GRENADE, SK_DANDAN_CONDENS,
  SK_MASKED_FIREBALL, SK_MASKED_CHAIN, SK_MASKED_KAMUI, SK_MASKED_EXILE,
  SK_AUGUSTA_CROWN, SK_AUGUSTA_SPEAR, SK_AUGUSTA_THUNDER, SK_AUGUSTA_FORCE,
  SK_LEE_GATES, SK_LEE_WIND, SK_LEE_FRONT_LOTUS, SK_LEE_REVERSE_LOTUS,
  SK_DONK_SHIYI, SK_DONK_SHOOT, SK_DONK_DODGER, SK_DONK_DEMON,
  SK_EXUSIAI_PACT, SK_EXUSIAI_ADDICTION, SK_EXUSIAI_RADIO, SK_EXUSIAI_MISSION,
  SK_EIMIS_STAR, SK_EIMIS_VOYAGE, SK_EIMIS_SHAPE, SK_EIMIS_DAWN,
  SK_REIN_VARIABLE, SK_REIN_MASK, SK_REIN_ORACLE, SK_REIN_FURIOSO,
];

export const SKILL_MAP: Record<string, Skill> = Object.fromEntries(
  ALL_SKILLS.map((s) => [s.id, s]),
);
