// ===== 基础属性 =====
export interface BaseStats {
  hp: number;
  mp: number;
  atk: number;
  def: number;
  mres: number; // 百分比法抗，1点=1%，硬上限90
  spdMin: number;
  spdMax: number;
}

export const EXTRA_KEYS = ['str', 'int', 'agi', 'luk', 'cha', 'wil'] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];
export type ExtraStats = Record<ExtraKey, number>;

export type Slot = 'weapon' | 'helmet' | 'armor' | 'boots' | 'accessory' | 'consumable' | 'material' | 'blueprint';
export type MaterialKind = 'enhance' | 'forge' | 'collection';
export type Rarity = 'common' | 'uncommon' | 'fine' | 'rare' | 'epic' | 'legendary';
export type DamageType = 'physical' | 'magical' | 'true' | 'fixed';
export type WeaponType = 'melee' | 'ranged' | 'magic';
export type SkillTarget = 'enemyOne' | 'enemyAll' | 'self' | 'allyOne';
export type Job = 'cat' | 'typhon' | 'kayn' | 'logos' | 'dandan' | 'masked' | 'augusta' | 'lee' | 'donk' | 'exusiai' | 'eimis' | 'rein';
export type AiKind = 'basic' | 'caster' | 'boss';
export type Side = 'ally' | 'enemy';

// ===== BUFF 系统 =====
// BUFF 效果 = stacks（层数） × intensity（强度），回合末 stacks - decay
export type BuffId =
  | 'swift'        // 迅捷：+速度
  | 'bind'         // 束缚：-速度
  | 'strength'     // 强壮：+全能增伤
  | 'protection'   // 护佑：+全能减伤
  | 'armorBreak'   // 破甲：-全能减伤（可减为负转增伤）
  | 'weak'         // 虚弱：-全能增伤（减攻方输出）
  | 'regen'        // 再生：回合末回血
  | 'poison'       // 中毒：回合末受到真实伤害
  | 'burn'          // 烧伤：回合末受到当前生命百分比的真实伤害
  | 'bleed'         // 流血：回合末受到最大生命百分比的法术伤害
  | 'huff'          // 哈气：攻击&防御各-10（扁平值，每层每强度）
  | 'huntMark'      // 狩猎标记：回合末受到施放者攻击力X%的物理伤害（永久，不随回合衰减）
  | 'agiStrength'   // 敏捷强度：每层强度+1速度（凯隐蓝形态掠影步）
  | 'worship'       // 膜拜：防御与法抗减半（袁绍抉择，两回合）
  | 'chill'         // 寒冷：回合末受到法术伤害（乘算）
  | 'apoptosis'    // 凋亡：达到3层时引爆，造成固定伤害
  | 'konohaMark'  // 木叶印记：里莲华的伤害因子，不随回合衰减
  | 'fireAddiction' // 开火成瘾：每次攻击额外消耗弹药（强度=额外消耗数）
  | 'needle' // 葬花针：应龙的层数标记（永久，不随回合衰减）
  | 'potianSpd' // 破天速度：冥王破天的受击加速层数（永久，不随回合衰减）
  | 'gouDog' // 挂狗：背水一战触发标记（永久，不随回合衰减）
  | 'implosion' // 聚爆：爱弥斯施加，达到层数上限时引爆，永久不衰减
  | 'plague' // 瘟疫：回合末受到最大生命X%真实伤害，可叠加
  // ===== 里恩 · 神谕代行者 =====
  | 'reinMask' // 遮盖伤口的假面：全能减伤（强度=百分比小数），永久
  | 'reinWound' // 灼烧着的伤口：全能减伤+速度+攻击（强度=减伤百分比小数），永久
  | 'reinKarma' // 业：每层防御-10%（乘算）、法抗-5，永久，上限5层
  | 'reinLiberation' // 解放（I/II/III）：强度=档位1/2/3，永久，覆盖式
  | 'reinHeart'; // 心-命运：速度+最高六维+每回合MP，永久

export interface BuffDef {
  id: BuffId;
  name: string;
  desc: string;
  icon?: string;
  positive: boolean;
}

export interface Buff {
  id: BuffId;
  stacks: number;
  intensity: number;
  ownerUid?: string; // 施加者 uid（狩猎标记等需要施放者攻击力的 BUFF）
}

// 8 个增伤/减伤属性（由 BUFF 动态计算，不存固定值）
export interface DamageMods {
  allDmgAmp: number;
  trueDmgAmp: number;
  physDmgAmp: number;
  magicDmgAmp: number;
  allDmgRed: number;
  trueDmgRed: number;
  physDmgRed: number;
  magicDmgRed: number;
}

// ===== 藏品 =====
// 遗物效果类型（后续新遗物在此扩展）
export type RelicEffect =
  | { kind: 'lifeCrystal' } // 每层+1层，我方每层*20生命上限，上限10层
  | { kind: 'manaCrystal' } // 每个紧急挑战+1层，我方每层*10魔力上限，上限10层
  | { kind: 'corruptAltar' } // 敌方攻击+20，防御+20
  | { kind: 'bloodAltar' } // 敌方行动后恢复10%最大生命
  | { kind: 'altarCrimson' } // 灾厄猩红祭坛：敌方每次行动恢复5%最大生命
  | { kind: 'altarCorruption' } // 灾厄腐化祭坛：敌方每次行动随机减我方单位5攻或5防
  | { kind: 'plagueLetter' } // 痛苦之村的求救信：每走一个节点最大生命-2%
  // ===== 数值类（已实装）=====
  | { kind: 'stats'; bonus: Partial<BaseStats> } // 固定数值：攻击/防御/法抗/生命/魔力+X
  | { kind: 'pctStats'; hpPct?: number; atkPct?: number; defPct?: number } // 百分比属性
  | { kind: 'dmgAmp'; phys?: number; magic?: number } // 物理/法术增伤（0.15=15%）
  | { kind: 'dmgRed'; all: number } // 全能减伤
  | { kind: 'sixStats'; bonus: Partial<ExtraStats> } // 六维加成（幸运影响幸运掉落判定）
  | { kind: 'shieldPerTurns'; every: number; amount: number } // 每N回合获得护盾
  | { kind: 'shieldGainBonus'; amount: number } // 获得护盾时额外增加
  | { kind: 'damageCapPct'; pct: number } // 单次受伤不超过最大生命百分比
  | { kind: 'healTurnEnd'; amount: number } // 每回合末恢复固定生命
  | { kind: 'shieldDmgAmp'; pct: number } // 存在护盾时伤害+X%
  | { kind: 'chaosShield'; hpPct: number } // 每回合开始扣最大生命X%转化为等量护盾
  | { kind: 'healOnPickup'; hpPct?: number; full?: boolean } // 拾取时立刻回复生命
  | { kind: 'torchHealOnPickup'; torch: number; hpPct: number; mpPct: number } // 拾取时获得火把并回复全队HP/MP
  | { kind: 'torchOnPickup'; amount: number } // 拾取时立刻获得火把
  | { kind: 'grantRelics'; count: number } // 拾取时随机获得N个未获得的遗物
  | { kind: 'grantItem'; rarity: Rarity } // 拾取时获得一件当前副本等级的指定稀有度藏品
  // ===== 局内条件类（战斗内动态生效）=====
  | { kind: 'condAtkPct'; minUnits: number; pct: number } // 场上单位≥N时攻击+X%（基于局外面板乘算）
  | { kind: 'spdDmgAmp'; perPoint: number; cap: number } // 每高于目标1点速度伤害+X%，上限Y
  | { kind: 'lowSpdDmgAmp'; perPoint: number; cap: number } // 每低于目标1点速度伤害+X%，上限Y（blast的电锯）
  | { kind: 'atkPerHit'; pct: number } // 每次攻击后攻击力+X%（奶蛙的玉足，战斗中成长）
  | { kind: 'trueDmgOnHit'; pct: number } // 每次攻击额外造成目标最大生命X%的真实伤害（奶蛙的手臂）
  | { kind: 'firstHitDouble' } // 战斗中首次造成的伤害翻倍（大刀丸）
  | { kind: 'killBook'; pctPerKill: number; maxStacks: number } // 每通关一次作战攻击+X%，上限N层（杀人书）
  // ===== 机制类（已实装）=====
  | { kind: 'enemyDefDownPct'; pct: number } // 敌方防御-X%（蠕虫之牙）
  | { kind: 'torchDmgAmp'; pctPerTorch: number } // 每根火把伤害+X%（火把神之力）
  | { kind: 'torchHpPerTorch'; hpPerTorch: number; maxStacks: number } // 每消耗一根火把+X HP上限，上限N层（火把神的祝福）
  | { kind: 'startShield'; amount: number } // 进入战斗获得X点护盾
  | { kind: 'startShieldStacks'; stacks: number } // 进入战斗获得X层次数盾（防弹衣/药杈）
  | { kind: 'shopDiscountPct'; pct: number } // 商店售价-X%（锈蚀的铁链）
  | { kind: 'shopFreeRandom'; count: number } // 商店随机N件商品免费（坎诺特的触须）
  | { kind: 'failSave'; hpPct: number } // 非BOSS战失败时回复X%最大生命并继续（时光之末）
  | { kind: 'endgameLink' } // 终局联系：标记型遗物，效果由各系统按 id 分发（全副本敌人强化/商店涨价/第四层等）
  // ===== 新增：局内数值/机制类 =====
  | { kind: 'enemyMresDown'; amount: number } // 敌方法抗-X
  | { kind: 'enemyMaxHpDown'; pct: number } // 敌方最大生命-X%
  | { kind: 'firstTurnAtk'; pct: number } // 我方第一回合攻击+X%
  | { kind: 'startMp'; amount: number } // 进入战斗立即恢复X点MP
  | { kind: 'normalAtkAmp'; pct: number } // 普攻倍率+X%
  | { kind: 'healAmp'; pct: number } // 生命恢复效果+X%
  | { kind: 'healTurnEndPct'; pct: number } // 回合末恢复最大生命X%
  | { kind: 'mpTurnEnd'; amount: number } // 每回合末恢复X点MP
  | { kind: 'torchDefAmp'; pctPerTorch: number } // 每根火把防御+X%
  | { kind: 'meleeAtkPct'; pct: number } // 近战单位攻击+X%
  | { kind: 'rangedSpd'; amount: number } // 远程单位速度+X
  | { kind: 'magicDmgAmp2'; pct: number } // 魔法单位法术伤害+X%
  | { kind: 'lowHpEnemyDmgAmp'; threshold: number; pct: number } // 对HP低于阈值%的敌人伤害+X%
  | { kind: 'allyCountAtkPct'; perUnit: number; cap: number } // 每有一个我方单位攻击+X%，上限Y
  | { kind: 'lastStandDef'; defPct: number; mres: number } // 只剩一个单位时防御+X%，法抗+Y
  | { kind: 'lastStandAtk'; atkPct: number; spd: number } // 只剩一个单位时攻击+X%，速度+Y
  | { kind: 'coinsSpd'; perCoins: number; cap: number } // 每X哈哈币速度+1，上限Y
  | { kind: 'turnStartBuff'; turn: number; defPct: number; mres: number } // 第N回合开始全体防御+X%，法抗+Y
  | { kind: 'enemyHpUpCoins'; hpPct: number; coins: number } // 敌方HP+X%，每场战斗额外Y币
  | { kind: 'meleeTradeoff'; spdDown: number; physDmgUp: number } // 近战速度-X，物理伤害+Y%
  | { kind: 'buffStackBonus'; amount: number } // 我方施加的所有buff层数+X
  | { kind: 'buffIntensityBonus'; amount: number } // 我方施加的强度类buff强度+X且上限+X
  | { kind: 'surviveLethalInvincible' } // 致命伤保1血并本回合无敌（每场1次）
  | { kind: 'randomAllyBuffDot'; atkPct: number; defPct: number; dotPct: number } // 随机友方攻防+X%，回合末受Y%最大生命真伤
  | { kind: 'lowestHpShield'; amount: number } // 进入战斗HP最低友方获得X护盾
  | { kind: 'allyPostActionHealPct'; pct: number } // 友方每次行动后恢复X%最大生命
  | { kind: 'detonateDouble' } // 敌方受到层数引爆伤害时额外再受到一次同样伤害
  | { kind: 'noSkillAtkBuff'; pct: number; cap: number } // 行动不使用技能则攻击+X%（上限Y）
  | { kind: 'swordHammer'; mpExtra: number; atkPct: number; defPct: number; mres: number } // 技能多耗X MP，攻/防+Y%，法抗+Z
  | { kind: 'killInvincible' } // 击杀后本回合无敌
  | { kind: 'killMpRestore'; amount: number } // 击杀后恢复X MP
  | { kind: 'killHpRestore'; amount: number } // 击杀后恢复X HP
  | { kind: 'killSpdBuff'; amount: number } // 击杀后下回合速度+X
  | { kind: 'hpLossAtk'; hpLossPctPer: number; atkPctPer: number } // 每损失X%生命攻击+Y%
  | { kind: 'hpLossSpd'; hpLossPctPer: number; spdPer: number } // 每损失X%生命速度+Y
  | { kind: 'actionHpToShield'; hpLoss: number; shieldGain: number } // 每次行动后失去X HP获得Y护盾
  | { kind: 'noHitShield'; amount: number } // 回合开始若上回合未受击则获得X护盾
  | { kind: 'skillDmgStack'; pct: number; cap: number } // 每次使用技能伤害+X%（上限Y）
  // ===== 拾取/局外效果 =====
  | { kind: 'grantCoins'; amount: number } // 拾取时立即获得X哈哈币
  | { kind: 'grantMaterials'; itemId: string; count: number } // 拾取时获得X个指定材料
  // ===== 地图/招募效果 =====
  | { kind: 'hiddenNode' } // 每层随机一个节点有迷藏标志，经过随机获得遗物
  | { kind: 'extraRefresh' } // 行商和招募多免费刷新一次
  | { kind: 'nextRecruitSpd'; amount: number } // 下个王牌招募单位速度+X
  | { kind: 'nextRecruitDmgNoSkill'; dmgPct: number } // 下个王牌招募单位伤害+X%但无法主动技能
  | { kind: 'nextRecruitAtk'; pct: number } // 下个王牌招募单位攻击+X%
  | { kind: 'unlockAct6' } // 完成第五层后可进入第6层
  | { kind: 'unlockAct7' } // 完成第六层后可进入第7层
  | { kind: 'maxHpDownPerNode'; pct: number } // 每走一个节点最大生命-X%
  | { kind: 'threeBattleCurse'; hpPct: number; coins: number } // 接下来3场作战敌方HP+X%，3场后获得Y币
  // ===== 机制类（图鉴展示，暂未实装）=====
  | { kind: 'unimplemented'; note?: string };

export interface Relic {
  id: string;
  name: string;
  rarity: Rarity;
  positive: boolean; // true=正面效果，false=负面效果
  icon?: string;
  desc: string;
  effect: RelicEffect;
  origin?: '通用' | '泰拉' | '危机合约'; // 出处
  inPool?: boolean; // 是否进入随机掉落池（缺省=true）
}

// 特殊被动能力（后续新能力在此扩展）
export interface ItemPassives {
  surviveLethal?: boolean; // 受到致命伤时保留1滴血（每场战斗1次）
  basicAttackAll?: boolean; // 普攻变为对敌方全体
  basicAttackMagic?: boolean; // 普攻变为法术伤害（魔法武器）
  onHitMagicBonus?: number; // 普攻命中后额外造成的法术伤害（附魔武器）
  turnStartEnemyDmg?: number; // 回合开始时随机对一名敌人造成N点真实伤害（卢克索的礼物；多部位敌人则全部部位）
  ignoreDefPct?: number; // 普攻无视目标X%防御（腐化武器）
  ignoreMresFlat?: number; // 普攻无视目标X点法抗（腐化杖）
  healOnAction?: number; // 行动后恢复自身N点HP（血腥武器）
  spdUpPerAtk?: { amount: number; cap: number }; // 每次攻击后速度+amount（上限cap）（风之武器）
  adaptiveBasicAttack?: boolean; // 普攻变为自适应伤害（取物理/法术较大值）（残缺环境刃）
  aoeTrueDmgPct?: number; // 普攻额外对敌方群体造成本次伤害X%的真伤（凝胶武器）
  basicAttackHits?: { count: number; mul: number }; // 普攻变为count段mul伤害（月光弓）
  extraRandomHit?: { mul: number; type: DamageType }; // 普攻额外对随机目标造成mul伤害（永夜射线）
  brokenArk?: { mpCost: number; dmgRedPct: number; buffStacks: number; buffIntensity: number }; // 破碎方舟：受击消耗MP抵消伤害并获得强壮
  healTurnEnd?: number; // 回合末恢复N点HP（血腥防具）
  physDmgAmp?: number; // 物理伤害+X%（腐化甲）
  magicDmgAmp?: number; // 法术伤害+X%（腐化头盔）
  startShield?: number; // 进入战斗获得X点护盾（钨钢防具）
  atkModPct?: number; // 攻击力增减百分比（硬脚防具：负数=减攻）
}

export interface Item {
  id: string;
  name: string;
  slot: Slot;
  rarity: Rarity;
  level?: number; // 装备等级要求（角色等级需>=此值，缺省=0无要求）
  weaponType?: WeaponType; // 仅武器：近战/远程/魔法
  icon?: string;
  desc: string;
  bonuses?: Partial<BaseStats>;
  extraBonus?: Partial<ExtraStats>; // 额外6维加成（饰品）
  usable?: { hp?: number; mp?: number; shield?: number }; // 仅消耗道具
  passives?: ItemPassives; // 特殊能力
  grantsSkill?: Skill; // 装备时赋予角色的主动技能（传说武器等）
  inPool?: boolean; // 是否进入随机掉落池（缺省=true）
  price: number;
  custom?: boolean;
  materialKind?: MaterialKind; // 仅材料：强化/锻造/典藏
}

// ===== 技能 =====
export interface SkillBuff {
  id: BuffId;
  stacks: number;
  intensity: number;
  target: 'self' | 'enemy';
}

// 里恩一技能「不可预测的变化无常」的三种释放方式（变体）
export interface ReinVariant {
  id: string; // 'frozen' 冻血缠绕 / 'pierce' 无声贯穿 / 'leaf' 落叶哭泣
  name: string;
  desc: string;
  damageType?: DamageType;
  randSixMulBase?: number; // 倍率基础百分比（冻血/无声贯穿：(base + 随机六维×per)%）
  randSixMulPer?: number; // 每点随机六维的倍率系数（L1=1 / L2=1.2 / L3=1.4）
  randSixIgnoreDefMul?: number; // 无声贯穿：无视防御 = 随机六维×此值
  splashMul?: number; // 冻血缠绕：对剩余敌方造成 主倍率×此值 的法术伤害（0.5/0.6/0.7）
  trueDmgMul?: number; // 落叶哭泣：真实伤害倍率（1.0/1.25/1.5）
  healRandomSix?: boolean; // 落叶哭泣：恢复自身随机六维HP
}

// 专属技能等级化数据（tiers[i] = i+1 级：1~3级）；缺省 tiers 时技能保持顶层字段不变
export interface SkillTier {
  mpCost: number;
  hpCost?: number; // HP消耗（凯隐红形态技能）
  energyCost?: number; // 能量消耗（凯隐掠影步）
  multiplier?: number; // 1.5 = 150%
  hits?: number; // 3 = 三连发
  shield?: number; // 30 = 防御
  applyBuffs?: SkillBuff[]; // 技能命中后施加的 BUFF
  trueDmgAtkMul?: number; // 附加 攻击力×此值 的真实伤害（爪击2/3级）
  shieldBonusFromInt?: number; // 获得 智力×此值 的护盾（自动吸附）
  ignoreDefPct?: number; // 被动（弱点侦查）：攻击无视目标X%防御
  chaTrueDmgMul?: number; // 被动（弱点侦查）：每次攻击附加 魅力×此值 的真实伤害
  markPct?: number; // 主动（永恒狩猎）：施加的狩猎标记回合末伤害倍率
  // ===== 逻各斯专属 =====
  intMulBase?: number; // 提喻：伤害倍率基础百分比（50=50%）
  intMulPerInt?: number; // 提喻：每点智力增加的倍率百分比（0.5=0.5%）
  ignoreMresFlat?: number; // 语汇演化：无视敌方X点法抗（扁平值）
  afterHitRandomMagicMul?: number; // 语汇演化：每次攻击后对随机敌人造成 智力×此值% 攻击力的法术伤害
  applyApoptosisOnHit?: boolean; // 语汇演化：攻击命中后施加一层凋亡
  apoptosisIntensityUp?: number; // 延异视阈：命中后使目标凋亡强度+X
  executeIntMul?: number; // 殁亡：斩杀阈值 = 等级×2 + 智力×此值
  executeChain?: boolean; // 殁亡：斩杀后是否连锁
  reactionIntensity?: number; // 反应技能减益强度（哈气）
  reactionMaxStacks?: number; // 反应技能减益最大层数（哈气：Lv.1=1层，Lv.2/3=2层）
  reactionUsesPerTurn?: number; // 虚化：每回合可用次数（Lv.1=1，Lv.2/3=2）
  formEffects?: { red?: Partial<Omit<Skill, 'formEffects'>>; blue?: Partial<Omit<Skill, 'formEffects'>> }; // 凯隐双形态（按等级）
  kaynPassive?: Skill['kaynPassive']; // 凯隐被动参数（按等级）
  // ===== 氮氮专属 =====
  flatDmgBase?: number; // 杜瓦冷罐：固定伤害 = base + 智力×flatDmgIntMul
  flatDmgIntMul?: number; // 杜瓦冷罐：每点智力的固定伤害
  applyArmorBreak?: { intensity: number; stacks: number }; // 震撼弹：施加破甲
  consumeHalfChillIntMul?: number; // 震撼弹：目标存在寒冷时，消耗一半寒冷层数，造成 消耗层数×智力×此值 的法术伤害
  condensGrenade?: { turns: number; chillPerHit: number; keepOne: boolean }; // 冷凝榴弹（旧）：普攻附加寒冷，用技时消耗
  condensDefRedPct?: number; // 冷凝榴弹（被动）：寒冷伤害阈值触发的防御降低百分比
  condensMresRed?: number; // 冷凝榴弹（被动）：寒冷伤害阈值触发的法抗降低
  condensPermSpdRed?: number; // 冷凝榴弹（被动）：消耗寒冷层数阈值触发的永久速度降低
  chillAdhesionStacks?: number; // 低温附着（被动）：带寒冷的敌方回合末所有效果层数+X
  chillAdhesionIntensity?: number; // 低温附着（被动）：带寒冷的敌方回合末所有效果强度+X
  // ===== 神秘面具男专属 =====
  strMulBase?: number; // 豪火球之术：伤害倍率基础百分比
  strMulPer?: number; // 豪火球之术：每点力量的倍率系数（缺省1）
  spdMulBase?: number; // 天锁爆葬：伤害倍率基础百分比
  spdMulPer?: number; // 天锁爆葬：每点速度的倍率（缺省10）
  enhanceMpCost?: number; // 虚化增强：额外MP消耗
  enhanceMulBonus?: number; // 虚化增强：额外伤害倍率
  enhanceKamuiCost?: number; // 虚化增强：消耗的虚化次数
  enhanceApplyBuffs?: SkillBuff[]; // 虚化增强命中后施加的BUFF
  trueDmgBase?: number; // 神威放逐：真实伤害基础值
  trueDmgPerBuff?: number; // 神威放逐：每BUFF种数增加的真实伤害
  kamuiExecute?: boolean; // 神威放逐：可斩杀
  kamuiExecuteHpPct?: number; // 神威放逐：斩杀血量阈值
  kamuiExecuteMpCost?: number; // 神威放逐：斩杀额外MP
  kamuiExecuteKamuiCost?: number; // 神威放逐：斩杀消耗虚化次数
  // ===== 奥古斯塔专属 =====
  augustaMomentum?: Skill['augustaMomentum']; // 诸王的冠冕（被动）：战势参数
  augustaEnhanceMulBonus?: number; // 贯星长枪/纯粹武力强化：额外伤害倍率
  augustaEnhanceHealFromStr?: number; // 贯星长枪强化：恢复 力量×X 的HP
  augustaEnhanceAllyShield?: boolean; // 驭冕铸雷之权强化：我方全体也获得等值护盾
  augustaEnhanceConsumeAll?: boolean; // 纯粹武力强化：消耗所有战势层数
  augustaEnhanceMulPerStack?: number; // 纯粹武力强化：每消耗1层战势提升的倍率
  shieldFromStrWilMul?: number; // 驭冕铸雷之权：护盾 = (力量+意志) × 此值
  lowHpBonusMulPct?: number; // 贯星长枪：目标HP低于50%时伤害提升比例（0.5=+50%）
  // ===== 小李 · 八门遁甲体系 =====
  gatesMaxLayers?: number;
  gatesAtkPerLayer?: number; // 每层八门遁甲提供的攻击力（10/15/20）
  gatesEndTurnDmgFlat?: number; // 八门遁甲回合末自伤 = 层数 × 此值（10/8/6）
  konohaMarkPassive?: boolean;
  konohaTrueDmgTier?: number;
  konohaMarkAgiMul?: number;
  konohaTrueDmgMul?: number; // 瞬风：普攻附伤 = 印记层数 × 此值 的真实伤害（0.1/0.2/0.3）
  gatesRequired?: number;
  lotusHits?: number;
  lotusAtkMul?: number;
  lotusFlatPerGate?: number;
  lotusMarkMul?: number; // 表莲华：每段伤害 = 印记层数 × 此值（0.8/0.9/1.0）
  lotusKillHealPct?: number; // 表莲华：击杀回复 最大生命 × 此值（0.15）
  lotusHpCostPct?: number;
  reverseLotusTrueHits?: number;
  reverseLotusTrueMul?: number;
  reverseLotusMaxHpMul?: number; // 里莲华：真实伤害 = 目标最大生命 × 此值（0.05/0.075/0.10）
  reverseLotusPhysMul?: number; // 里莲华终结真伤 = (印记层数×八门层数) × 此值（1/3, 1/2.5, 1/2）
  // ===== DONK · 世一步 / 闪身步 / 魔王 =====
  shiyiMpCost?: number; // 世一步：每次普攻消耗的MP
  shiyiTrueDmgStrMul?: number; // 世一步：每消耗30MP额外真伤 = 力量×此值% ×攻击力（0.8/0.9/1.0）
  shiyiMpRestorePct?: number; // 世一步：MP归零时恢复最大MP的比例
  shiyiAtkBonusPct?: number; // 世一步：MP归零时获得 累计消耗MP×此比例 的攻击力
  shiyiAtkCap?: number; // 世一步：攻击力加成上限
  dodgerMpPerSpd?: number; // 闪身步：每消耗X点MP获得1速度
  dodgerSpdCap?: number; // 闪身步：速度上限
  demonMpThreshold?: number; // 魔王：累计消耗MP达到此值时触发每回合强壮（50）
  demonStrMul?: number; // 魔王：攻击附带 力量×此值% ×攻击力 的真伤（1.0/1.25/1.5）
  demonStrCap?: number; // 魔王：强壮强度上限
  shootBaseMul?: number; // 射击：基础攻击力倍率（1.0/1.2/1.4）
  shootSpdBonusPct?: number; // 射击：每点最大速度+X%攻击力（5）
  shootBonusPer30Mp?: number; // 射击：每消耗30MP提升的倍率（0.5/0.6/0.7）
  shootBonusMaxUpgrades?: number; // 射击：倍率提升上限次数（1/2/2）
  // ===== 爱弥斯 · 聚爆 / 形态 / 同步率 =====
  eimisHuiMangBasePct?: number; // 永远的启明星：辉芒基础倍率%（80/90/100）
  eimisHuiMangChaMul?: number; // 永远的启明星：辉芒魅力倍率（1.0/1.2/1.4）
  eimisHuiMangStacks?: number; // 永远的启明星：辉芒施加聚爆层数（3/4/4）
  eimisImplosionBaseCap?: number; // 永远的启明星：聚爆层数上限基数（10）
  eimisImplosionDmgPctPerStack?: number; // 聚爆引爆：每层伤害%攻击力（15）
  eimisHumanChaGain?: number; // 共赴长航：切人形态魅力+X（10/15/20）
  eimisHumanChaCap?: number; // 共赴长航：人形态魅力上限（20/30/40）
  eimisMechShieldChaMul?: number; // 共赴长航：切机甲获得 魅力×此值 护盾（1.5/1.75/2.0）
  eimisSyncCapBonus?: number; // 为寂静赋形：每点同步率使聚爆上限+5
  eimisMresPenPerSync?: number; // 为寂静赋形：每点同步率无视法抗（3/4/5）
  eimisUltimateCapMul?: number; // 飞至启明之时：伤害=上限×此值×20%攻击力（2）
  // ===== 新约能天使 · 弹药体系 =====
  ammoStartBase?: number; // 铳弹协约：初始弹药 = 幸运 + 此值（Lv3=10）
  ammoPreActionCost?: number; // 铳弹协约：行动前消耗弹药数（默认5）
  ammoMulPerBullet?: number; // 铳弹协约：每发弹药提供的下次攻击倍率（默认0.1=10%）
  ammoTurnEndTrueDmgPct?: number; // 铳弹协约：回合末自损最大HP百分比（0.1=10%）
  // ===== 里恩 · 不可预测的变化无常 / 神谕代行者 =====
  variants?: ReinVariant[]; // 一技能三种释放方式（tiers[i].variants 覆盖顶层）
  reinMask?: { // 一切都是假的，只有爱是真的（被动：假面→伤口）
    maskDmgRed: number; // 遮盖伤口的假面：全能减伤（0.10/0.15/0.20）
    woundThreshold: number; // 回合末 HP 低于该比例切换为伤口（0.40/0.45/0.50）
    woundDmgRed: number; // 灼烧着的伤口：全能减伤（0.20/0.25/0.30）
  }; // 伤口额外：速度=角色等级/10、攻击=角色等级×1（固定公式）
  reinOracle?: { // 神谕代行者（被动）
    maxStacks: number; // 代行-赫尔墨斯上限（12）
    freedomISix: number; // 解放I：额外6维+X（10/20/30）
    freedomIISix: number; // 解放II：额外6维+X（20/30/40）
    freedomIIAtkPerLv: number; // 解放II：攻击力=角色等级×此值（1/1.25/1.5）
    freedomIIISix: number; // 解放III：额外6维+X（30/40/50）
    freedomIIIAtkPerLv: number; // 解放III：攻击力=角色等级×此值（1/1.25/1.5）
    freedomIIIAllAmp: number; // 解放III：全能增伤（0.20/0.30/0.40）
    fateSpd: number; // 心-命运：速度+X（3/4/5）
    fateMpPerTurn: number; // 心-命运：每回合MP恢复（10）
    karmaDefPct: number; // 业：每层防御力-10%（乘算）
    karmaMres: number; // 业：每层法抗-5
    karmaMax: number; // 业上限（5）
  };
  reinFurioso?: { // Furioso-Replica（大招）
    requireStacks: number; // 需代行-赫尔墨斯层数（12）
    hits: number; // 随机攻击次数（9）
    dmgPctOfRandomSix: number; // 每次造成 随机六维×此值 % 攻击力的真实伤害
  };
  fireAddictionShieldAgiMul?: number; // 开火成瘾症：护盾 = 敏捷×此值
  fireAddictionExtraAmmo?: number; // 开火成瘾症：每次攻击额外消耗弹药（默认5，有友方时10）
  fireAddictionAllyExtraAmmo?: number; // 开火成瘾症：有友方时额外消耗弹药（默认10）
  radioAmmoThreshold?: number; // 火力电台：每消耗多少发弹药触发（默认10）
  radioDmgBasePct?: number; // 火力电台：伤害基础百分比（100=100%），实际倍率=(basePct+敏捷)/100
  radioHealLukMul?: number; // 火力电台：回血 = 幸运×此值（默认1）
  missionAmmoGain?: number; // 使命必达：获得弹药数（20/25/30）
  levelScale?: Record<string, { base: number; perLevel: number }>; // 指定字段数值 = base + 角色等级 × perLevel（覆盖 tier 固定值）
  desc?: string; // 该等级的描述
}

export interface Skill {
  id: string;
  name: string;
  desc: string;
  kind: 'active' | 'passive' | 'reaction';
  mpCost: number;
  hpCost?: number; // HP消耗（凯隐红形态技能）
  energyCost?: number; // 能量消耗（凯隐掠影步）
  target: SkillTarget;
  damageType?: DamageType;
  multiplier?: number; // 1.5 = 150%
  hits?: number; // 3 = 三连发
  randomTargetPerHit?: boolean; // 每段随机选目标（女妖之笔）
  sameTargetMulBonus?: number; // 连续命中相同目标时额外伤害倍率（女妖之笔）
  shield?: number; // 30 = 防御
  cooldown?: number; // 怪物技能：行动次数冷却
  evenTurnOnly?: boolean; // 怪物技能：仅偶数回合释放，奇数回合普攻
  applyBuffs?: SkillBuff[]; // 技能命中后施加的 BUFF
  trueDmgAtkMul?: number; // 附加 攻击力×此值 的真实伤害（爪击2/3级）
  // ===== 王牌单位技能字段 =====
  aceTrueDmgFlat?: number; // 额外固定真实伤害
  aceMaxHpTrueDmgPct?: number; // 额外目标最大生命百分比真伤
  aceShieldMissingHp?: boolean; // 护盾 = 已损生命值
  aceAllyShield?: number; // 随机1名友方获得护盾
  aceOncePerBattle?: boolean; // 每场战斗仅一次
  aceChargeTurns?: number; // 蓄力回合数
  aceStatUp?: { def?: number; mres?: number; defCap?: number; mresCap?: number }; // 扁平属性提升
  shieldBonusFromInt?: number; // 获得 智力×此值 的护盾（自动吸附）
  multiDamageTypes?: DamageType[]; // 同时造成多种伤害类型（运之夹角：物+法+真）
  shieldBonusFromAgi?: number; // 获得 敏捷×X 的护盾（凯隐红狂镰，旧版）
  healFromAgi?: number; // 回复 敏捷×X 的HP（凯隐红裂舍影，旧版）
  damageBonusFromShieldPct?: number; // 额外造成 施法者当前护盾×X 的伤害（凯隐红狂镰，旧版）
  executeRefundMp?: number; // 击杀敌人时恢复MP（凯隐蓝狂镰）
  // ===== 凯隐新版技能字段 =====
  agiMulBase?: number; // 红狂镰/红裂舍影：伤害倍率 = (agiMulBase + 敏捷×agiMulPer) / 100
  agiMulPer?: number; // 红狂镰/红裂舍影：每点敏捷的倍率
  strMulPer?: number; // 蓝狂镰：每点力量的倍率（配合 strMulBase，倍率 = (strMulBase + 力量×strMulPer) / 100）
  spdMulPer?: number; // 红裂舍影：每点速度的倍率（配合 spdMulBase，倍率 = (spdMulBase + 速度×spdMulPer) / 100）
  atkGainOnCast?: number; // 红狂镰：释放时获得攻击力（本场战斗内有效）
  atkGainCap?: number; // 红狂镰：攻击力加成上限
  firstSwitchStr?: number; // 首次切换形态时永久+X力量（凯隐红掠影步）
  energyGainFromAgi?: number; // 红裂舍影：获得 敏捷×X 的能量
  consumeAllEnergy?: boolean; // 蓝裂舍影：消耗所有能量
  energyStrMul?: number; // 蓝裂舍影：伤害 = energyStrMul×(力量+消耗能量) + energyAtkMul×攻击力
  energyAtkMul?: number; // 蓝裂舍影：攻击力部分系数
  switchForm?: boolean; // 切换形态（凯隐掠影步）
  healFromShieldPct?: number; // 回复 施法者护盾×X 的HP（凯隐红掠影步）
  firstSwitchMp?: number; // 首次切换形态时恢复X点MP（凯隐掠影步）
  consumeShieldStacks?: number; // 消耗X层次数盾（凯隐蓝掠影步）
  swiftTurnEnd?: { intensity: number; stacks: number }; // 回合末给自己施加迅捷（凯隐蓝掠影步）
  firstSwitchAgi?: number; // 首次切换形态时永久+X敏捷（凯隐掠影步）
  kaynPassive?: { // 凯隐被动「暗裔魔镰」参数（按技能等级配置）
    hpThreshold: number; // 失去该比例最大生命后触发（0.7=70%）
    energyOnTrigger: number; // 触发时获得的能量
    energyMax: number; // 能量上限
    overflowRatio: number; // 能量超出上限后 1:X 转换为护盾
    energyPerSkill: number; // 每次释放技能获得的能量
  };
  formEffects?: { // 凯隐双形态：红/蓝各自的参数覆盖（与顶层字段合并）
    red?: Partial<Omit<Skill, 'formEffects'>>;
    blue?: Partial<Omit<Skill, 'formEffects'>>;
  };
  // ===== 小李 · 八门遁甲体系 =====
  gatesMaxLayers?: number;
  gatesAtkPerLayer?: number; // 每层八门遁甲提供的攻击力（10/15/20）
  gatesEndTurnDmgFlat?: number; // 八门遁甲回合末自伤 = 层数 × 此值（10/8/6）
  konohaMarkPassive?: boolean;
  konohaTrueDmgTier?: number;
  konohaMarkAgiMul?: number;
  konohaTrueDmgMul?: number; // 瞬风：普攻附伤 = 印记层数 × 此值 的真实伤害（0.1/0.2/0.3）
  gatesRequired?: number;
  lotusHits?: number;
  lotusAtkMul?: number;
  lotusFlatPerGate?: number;
  lotusMarkMul?: number; // 表莲华：每段伤害 = 印记层数 × 此值（0.8/0.9/1.0）
  lotusKillHealPct?: number; // 表莲华：击杀回复 最大生命 × 此值（0.15）
  lotusHpCostPct?: number;
  reverseLotusTrueHits?: number;
  reverseLotusTrueMul?: number;
  reverseLotusMaxHpMul?: number; // 里莲华：真实伤害 = 目标最大生命 × 此值（0.05/0.075/0.10）
  reverseLotusPhysMul?: number; // 里莲华终结真伤 = (印记层数×八门层数) × 此值
  // ===== DONK · 世一步 / 闪身步 / 魔王 =====
  shiyiMpCost?: number; // 世一步：每次普攻消耗的MP
  shiyiTrueDmgStrMul?: number; // 世一步：每消耗30MP额外真伤 = 力量×此值% ×攻击力
  shiyiMpRestorePct?: number; // 世一步：MP归零时恢复最大MP的比例
  shiyiAtkBonusPct?: number; // 世一步：MP归零时获得 累计消耗MP×此比例 的攻击力
  shiyiAtkCap?: number; // 世一步：攻击力加成上限
  dodgerMpPerSpd?: number; // 闪身步：每消耗X点MP获得1速度
  dodgerSpdCap?: number; // 闪身步：速度上限
  demonMpThreshold?: number; // 魔王：累计消耗MP达到此值时触发每回合强壮
  demonStrMul?: number; // 魔王：攻击附带 力量×此值% ×攻击力 的真伤
  demonStrCap?: number; // 魔王：强壮强度上限
  shootBaseMul?: number; // 射击：基础攻击力倍率
  shootSpdBonusPct?: number; // 射击：每点最大速度+X%攻击力
  shootBonusPer30Mp?: number; // 射击：每消耗30MP提升的倍率
  shootBonusMaxUpgrades?: number; // 射击：倍率提升上限次数
  // ===== 爱弥斯 · 聚爆 / 形态 / 同步率 =====
  eimisHuiMangBasePct?: number; // 辉芒基础倍率%
  eimisHuiMangChaMul?: number; // 辉芒魅力倍率
  eimisHuiMangStacks?: number; // 辉芒施加聚爆层数
  eimisImplosionBaseCap?: number; // 聚爆层数上限基数
  eimisImplosionDmgPctPerStack?: number; // 聚爆引爆每层伤害%攻击力
  eimisHumanChaGain?: number; // 切人形态魅力+X
  eimisHumanChaCap?: number; // 人形态魅力上限
  eimisMechShieldChaMul?: number; // 切机甲获得 魅力×此值 护盾
  eimisSyncCapBonus?: number; // 每点同步率使聚爆上限+X
  eimisMresPenPerSync?: number; // 每点同步率无视法抗
  eimisUltimateCapMul?: number; // 飞至启明之时 伤害=上限×此值×20%攻击力
  // ===== 新约能天使 · 弹药体系 =====
  ammoStartBase?: number; // 铳弹协约：初始弹药 = 幸运 + 此值
  ammoPreActionCost?: number; // 铳弹协约：行动前消耗弹药数
  ammoMulPerBullet?: number; // 铳弹协约：每发弹药提供的下次攻击倍率
  ammoTurnEndTrueDmgPct?: number; // 铳弹协约：回合末自损最大HP百分比
  // ===== 里恩 · 不可预测的变化无常 / 神谕代行者 =====
  variants?: ReinVariant[]; // 一技能三种释放方式（tiers[i].variants 覆盖顶层）
  reinMask?: { // 一切都是假的，只有爱是真的（被动：假面→伤口）
    maskDmgRed: number; // 遮盖伤口的假面：全能减伤（0.10/0.15/0.20）
    woundThreshold: number; // 回合末 HP 低于该比例切换为伤口（0.40/0.45/0.50）
    woundDmgRed: number; // 灼烧着的伤口：全能减伤（0.20/0.25/0.30）
  }; // 伤口额外：速度=角色等级/10、攻击=角色等级×1（固定公式）
  reinOracle?: { // 神谕代行者（被动）
    maxStacks: number; // 代行-赫尔墨斯上限（12）
    freedomISix: number; // 解放I：额外6维+X（10/20/30）
    freedomIISix: number; // 解放II：额外6维+X（20/30/40）
    freedomIIAtkPerLv: number; // 解放II：攻击力=角色等级×此值（1/1.25/1.5）
    freedomIIISix: number; // 解放III：额外6维+X（30/40/50）
    freedomIIIAtkPerLv: number; // 解放III：攻击力=角色等级×此值（1/1.25/1.5）
    freedomIIIAllAmp: number; // 解放III：全能增伤（0.20/0.30/0.40）
    fateSpd: number; // 心-命运：速度+X（3/4/5）
    fateMpPerTurn: number; // 心-命运：每回合MP恢复（10）
    karmaDefPct: number; // 业：每层防御力-10%（乘算）
    karmaMres: number; // 业：每层法抗-5
    karmaMax: number; // 业上限（5）
  };
  reinFurioso?: { // Furioso-Replica（大招）
    requireStacks: number; // 需代行-赫尔墨斯层数（12）
    hits: number; // 随机攻击次数（9）
    dmgPctOfRandomSix: number; // 每次造成 随机六维×此值 % 攻击力的真实伤害
  };
  fireAddictionShieldAgiMul?: number; // 开火成瘾症：护盾 = 敏捷×此值
  fireAddictionExtraAmmo?: number; // 开火成瘾症：每次攻击额外消耗弹药
  fireAddictionAllyExtraAmmo?: number; // 开火成瘾症：有友方时额外消耗弹药
  radioAmmoThreshold?: number; // 火力电台：每消耗多少发弹药触发
  radioDmgBasePct?: number; // 火力电台：伤害基础百分比，实际倍率=(basePct+敏捷)/100
  radioHealLukMul?: number; // 火力电台：回血 = 幸运×此值
  missionAmmoGain?: number; // 使命必达：获得弹药数
  reaction?: { // 反应式技能（kind='reaction'）：即将受到伤害时弹窗选择是否使用
    mode?: 'debuff' | 'kamui'; // debuff=哈气（施减益攻击继续），kamui=虚化（无效化攻击+自身增益）
    buffId?: BuffId; // 对攻击来源施加的减益（debuff模式）
    maxStacks?: number; // 减益叠加层数上限（debuff模式）
    intensity?: number; // 减益强度（哈气：每层降低攻防 = intensity * 10）
    // kamui 模式：虚化闪避
    usesPerTurn?: number; // 每回合可用次数
    selfBuffId?: BuffId; // 成功虚化后对自身施加的增益（强壮）
    selfBuffStacks?: number; // 自身增益层数
    minIntensity?: number; // 自身增益强度下限
    intensityFromSpdDiff?: boolean; // 自身增益强度 = 双方速度差
    selfBuffIntensityAddOne?: boolean; // 强度+1模式：叠加时强度在原有基础上+1（而非取较大值）
  };
  ignoreDefPct?: number; // 被动（弱点侦查）：攻击无视目标X%防御
  chaTrueDmgMul?: number; // 被动（弱点侦查）：每次攻击附加 魅力×此值 的真实伤害
  markPct?: number; // 主动（永恒狩猎）：施加的狩猎标记回合末伤害倍率
  // ===== 逻各斯专属 =====
  intMulBase?: number; // 提喻：伤害倍率基础百分比（50=50%）
  intMulPerInt?: number; // 提喻：每点智力增加的倍率百分比（0.5=0.5%）
  ignoreMresFlat?: number; // 语汇演化：无视敌方X点法抗（扁平值）
  afterHitRandomMagicMul?: number; // 语汇演化：每次攻击后对随机敌人造成 智力×此值% 攻击力的法术伤害
  applyApoptosisOnHit?: boolean; // 语汇演化：攻击命中后施加一层凋亡
  apoptosisIntensityUp?: number; // 延异视阈：命中后使目标凋亡强度+X
  executeIntMul?: number; // 殁亡：斩杀阈值 = 等级×2 + 智力×此值
  executeChain?: boolean; // 殁亡：斩杀后是否连锁
  // ===== 氮氮专属 =====
  flatDmgBase?: number; // 杜瓦冷罐：固定伤害 = base + 智力×flatDmgIntMul
  flatDmgIntMul?: number; // 杜瓦冷罐：每点智力的固定伤害
  applyArmorBreak?: { intensity: number; stacks: number }; // 震撼弹：施加破甲
  consumeHalfChillIntMul?: number; // 震撼弹：目标存在寒冷时，消耗一半寒冷层数，造成 消耗层数×智力×此值 的法术伤害
  condensGrenade?: { turns: number; chillPerHit: number; keepOne: boolean }; // 冷凝榴弹（旧）：普攻附加寒冷，用技时消耗
  condensDefRedPct?: number; // 冷凝榴弹（被动）：寒冷伤害阈值触发的防御降低百分比
  condensMresRed?: number; // 冷凝榴弹（被动）：寒冷伤害阈值触发的法抗降低
  condensPermSpdRed?: number; // 冷凝榴弹（被动）：消耗寒冷层数阈值触发的永久速度降低
  chillAdhesionStacks?: number; // 低温附着（被动）：带寒冷的敌方回合末所有效果层数+X
  chillAdhesionIntensity?: number; // 低温附着（被动）：带寒冷的敌方回合末所有效果强度+X
  // ===== 神秘面具男专属 =====
  strMulBase?: number; // 豪火球之术：伤害倍率基础百分比，实际倍率=(strMulBase+力量)/100
  spdMulBase?: number; // 天锁爆葬：伤害倍率基础百分比，实际倍率=(spdMulBase+速度×10)/100
  enhanceMpCost?: number; // 虚化增强：额外MP消耗
  enhanceMulBonus?: number; // 虚化增强：额外伤害倍率（0.6=+60%）
  enhanceKamuiCost?: number; // 虚化增强：消耗的虚化次数（默认1）
  enhanceApplyBuffs?: SkillBuff[]; // 虚化增强命中后施加的BUFF
  trueDmgBase?: number; // 神威放逐：真实伤害基础值
  trueDmgPerBuff?: number; // 神威放逐：每1个BUFF种数增加的真实伤害
  kamuiExecute?: boolean; // 神威放逐：伤害后可斩杀
  kamuiExecuteHpPct?: number; // 神威放逐：斩杀血量阈值（0.1=10%）
  kamuiExecuteMpCost?: number; // 神威放逐：斩杀额外MP消耗
  kamuiExecuteKamuiCost?: number; // 神威放逐：斩杀消耗的虚化次数
  // ===== 奥古斯塔专属（战势强化）=====
  augustaMomentum?: { // 诸王的冠冕（被动）：战势参数
    max: number; // 战势层数上限
    onHitPerTurn: number; // 受击每回合最多获得层数
    enhanceThreshold: number; // 触发强化的层数阈值（3）
    enhancedBasicHits: number; // 强化普攻的攻击段数
    enhancedBasicMul: number; // 强化普攻每段倍率（1.0=100%）
    turnStartGain?: number; // 2/3档：每回合开始获得的战势层数
  };
  augustaEnhanceMulBonus?: number; // 贯星长枪/纯粹武力强化：额外伤害倍率
  augustaEnhanceHealFromStr?: number; // 贯星长枪强化：恢复 力量×X 的HP
  augustaEnhanceAllyShield?: boolean; // 驭冕铸雷之权强化：我方全体也获得等值护盾
  augustaEnhanceConsumeAll?: boolean; // 纯粹武力强化：消耗所有战势层数
  augustaEnhanceMulPerStack?: number; // 纯粹武力强化：每消耗1层战势提升的倍率
  shieldFromStrWilMul?: number; // 驭冕铸雷之权：护盾 = (力量+意志) × 此值
  lowHpBonusMulPct?: number; // 贯星长枪：目标HP低于50%时伤害提升比例（0.5=+50%）
  // ===== 角色专属技能（可升级体系）=====
  exclusive?: boolean; // 专属技能：消耗技能点升级（每级1点，上限3级）
  unlockLevel?: number; // 解锁等级（缺省=1：初始可用；第3个专属=20；第4个=40）
  tiers?: SkillTier[]; // 等级化数据：tiers[i] 为 i+1 级；缺省=固定技能（怪物技能等）
}

// ===== 角色 =====
export interface Equip {
  weapon: string | null;
  helmet: string | null;
  armor: string | null;
  boots: string | null;
  accessory: [string | null, string | null];
}

export interface Character {
  id: string;
  name: string;
  job: Job;
  level: number;
  extra: ExtraStats;
  baseExtra?: ExtraStats; // 创建时锁定的初始六维（仅用于基础属性换算；自由属性点不影响基础属性）
  equip: Equip;
  relics: string[]; // 装备的遗物ID（无携带上限）
  inventory: string[]; // 已拥有的未穿戴藏品（每件占一个背包格；同名可重复）
  bag: { itemId: string; count: number }[];
  storage: { itemId: string; count: number }[]; // 角色独享仓库（藏品+消耗品）
  coins: number; // 个人哈哈币存款（进副本时汇入共享币池）
  createdAt: number;
  // ===== 技能体系 =====
  skillPoints?: number; // 已获得技能点总数（每10级+1；新手村完成额外+1）；可用=总数-已消耗
  skillLevels?: Record<string, number>; // 专属技能等级（1~3），缺省 1
  freeExtraPoints?: number; // 可分配自由属性点（新手村完成+10）
  test?: boolean; // 测试角色不进存档
  labUsed?: boolean; // 是否使用过遗物测试界面（永久标记，名册显示"外挂"角标）
  crisisScore?: Record<string, { single?: number; dual?: number }>; // 危机合约各副本最高分（按单人/双人分别记录）
}

// ===== 怪物 / BOSS =====
// 普攻命中后附加的 BUFF（施加到被命中的目标身上）
export interface AttackBuff {
  id: BuffId;
  stacks: number;
  intensity: number;
}

// 召唤机制：受击后生命跌破各档阈值时依次召唤一只怪物，可附带自身速度提升
export interface MonsterSummon {
  monsterId: string; // 召唤的怪物 id
  thresholds: number[]; // 血线阈值（从高到低，如 [0.7, 0.4]）：每跌破一档召唤一只，每档仅一次
  selfSpdUp?: number; // 每次召唤成功时自身速度区间整体+N
}

// 自定义狂暴：生命低于阈值时一次性固定数值变化（区别于多部位BOSS的通用+30%攻击狂暴）
export interface MonsterEnrage {
  hpBelow: number; // 0.5 = 半血触发
  spd?: number; // 速度区间整体+N
  atk?: number; // 攻击+固定值
  def?: number; // 防御+固定值（可为负）
  defZero?: boolean; // 触发后防御归0（岩冠兽）
  mresZero?: boolean; // 触发后法抗归0（岩冠兽）
}

export interface MonsterUnit {
  id: string;
  name: string;
  icon?: string;
  desc: string;
  stats: BaseStats;
  skills: Skill[]; // 普攻为引擎内置，不列入
  ai: AiKind;
  attackType?: DamageType; // 普攻伤害类型（默认 physical）
  boss?: boolean; // 单体BOSS标记（仅展示用；多部位BOSS走 BossDef）
  elite?: boolean; // 精英标记（仅展示用）
  basicAttackBuffs?: AttackBuff[]; // 普攻命中后附加的 BUFF
  summon?: MonsterSummon; // 召唤机制
  enrage?: MonsterEnrage; // 自定义狂暴
  healTurnEnd?: number; // 每回合末恢复固定生命（马神残躯能力1）
  dmgCapPerTurn?: number; // 每回合受到的总伤害上限（马神残躯能力2）
  atkUpIfNotHitLastTurn?: number; // 上回合未被攻击则本回合攻击力+X（夺舍红狼）
  debuffOnHit?: { atk: number; def: number; mres: number; maxTimes: number }; // 每被攻击一次攻防法抗-X，最多N次（猛攻肥区）
  fleeOnTurn?: number; // 第N回合末直接离开战场（不算击败）
  bonusDropOnKill?: FixedDrop; // 成功击杀时额外掉落
  turnStartBurn?: { intensity: number; stacks: number }; // 每回合开始使敌方烧伤（乌鲁鲁老先生）
  // ===== 灾厄泰拉怪物通用能力 =====
  ignoreDefPct?: number; // 普攻无视目标 X% 防御（僵尸人鱼）
  lifestealPct?: number; // 普攻造成伤害的 X% 转为自身治疗（脸怪）
  lifestealAllPct?: number; // 普攻造成伤害的 X% 转为全体友方治疗（猩红喀迈拉）
  healAllTurnEnd?: number; // 每回合末恢复全体友方固定生命（滴滴怪）
  healAllTurnEndPct?: number; // 每回合末恢复全体友方 X% 最大生命（富养鳐鱼）
  mpDrain?: number; // 普攻减少目标 X 点 MP（噬魂怪）
  poisonOnHit?: { intensity: number; stacks: number }; // 被攻击时使攻击者获得中毒（剧毒鲶鱼）
  plagueOnHit?: { intensity: number; stacks: number }; // 普攻附加瘟疫层数（暗精灵僵尸）
  initialShield?: number; // 初始护盾（钨钢悬浮坦克）
  initialShieldStacks?: number; // 初始次数盾层数（钨钢漫步者）
  shieldDmgAmpPct?: number; // 持有护盾时伤害提升 X%（高阶护盾术士）
  spdUpOnHit?: number; // 被攻击后下回合速度 +X（污染躯壳）
  aoeBasicAttack?: boolean; // 普攻变为群体伤害（炮弹水母）
  multiHit?: number; // 普攻连击 X 次（卧龙海马/超巨大乌贼）
  reviveOnce?: boolean; // 死亡后复活一次（食尸鬼）
  counterTrueDmg?: number; // 被攻击时对攻击者造成 X 点真实伤害（渊海海胆）
  maxHpTrueDmgPct?: number; // 普攻额外造成目标最大生命 X% 的真实伤害（灵魂饮食者）
  defUpOnHit?: { amount: number; cap: number }; // 每次被攻击防御+X（上限）（棱晶背龟）
  evenTurnGuard?: { def: number }; // 偶数回合进入守备（花岗岩巨人）
  shieldAllTurnEnd?: number; // 每回合末给全体友方 X 点护盾（钨钢增幅器）
  selfDestructOnSurvive?: boolean; // 被攻击后回合末仍存活则自爆（自爆源石虫）
  defDownOnHit?: number; // 普攻减少目标 X 点防御（装甲步兵）
  plagueStackBonusTrueDmg?: number; // 普攻额外造成 瘟疫层数×X 真实伤害（哀嚎暗精灵僵尸）
  plagueStackBonusMagicDmg?: number; // 普攻造成 80+瘟疫层数×X 法术伤害（悲鸣暗精灵僵尸）
  // ===== 灾厄泰拉怪物通用能力（第二批）=====
  multiHitMul?: number; // multiHit 每段伤害倍率（默认1）（卧龙海马/超巨大乌贼 0.8）
  multiHitRandom?: boolean; // multiHit 每段随机选择目标（卧龙海马/超巨大乌贼）
  basicAttackDefMul?: number; // 普攻伤害以防御力×倍率计算（棱晶背龟 1.0）
  spdTrueDmgMul?: number; // 普攻附加 当前速度×X 真实伤害（木裂战士 5）
  hpLossPerStep?: { stepPct: number; atk: number; spd: number }; // 每损失X%生命，回合末攻击+Y速度+Z（狂暴宿主组长PLUS）
  poisonStackAtkMul?: { base: number; perStack: number }; // 普攻伤害倍率 = base + 目标中毒层数×perStack（硫磺比目鱼）
  aoeSplashPct?: number; // 群攻普攻时，非主目标伤害倍率（镰刀恶魔 0.5）
  turnEndAoeMagic?: number; // 回合末对全场敌方造成 X 点法术伤害（花癫疯 100）
  hitTurnPattern?: { start: number; interval: number }; // 仅在 (回合-start)%interval===0 时可被攻击（宝石爬虫）
  summonBelowAllies?: { count: number; pool: string[] }; // 友方不足count时回合末随机召唤pool中怪物（钨钢制造者）
  perAllyStats?: { def: number; mres: number }; // 每有一个存活友方，防御+X法抗+Y（深池战士）
  onAllyDeath?: { allyName: string; multiHit?: number; atk?: number; def?: number; mres?: number }; // 特定友方死亡时获得属性/连击（僵尸新娘/新郎）
  bleedStackDmgAmp?: number; // 普攻伤害随目标流血层数提升（每层+X，雾凇猎犬 0.2）
  aiPriority?: 'mostBleed' | 'fastest' | 'lowestHp'; // AI 目标偏好
  dmgToMaxHp?: boolean; // 普攻造成的伤害等额转化为自身最大HP（血浆哥布林鲨鱼）
  lifestealMissingHp?: boolean; // 普攻后恢复自身 目标已损HP 量（刀疤鼠）
  lowHpBurst?: { hpPct: number; spd: number; atk: number }; // HP低于阈值时回满血并加速加攻（每场一次，血浆哥布林鲨鱼）
  onDeathHealAllyPct?: number; // 死亡后随机友方恢复X%最大HP（血腥史莱姆 0.3）
  onDeathBuffAlly?: { atk: number; spd: number }; // 死亡后随机友方攻击+X速度+Y（腐化史莱姆）
  attackGroupPoison?: { intensity: number; stacks: number }; // 普攻使敌方全体中毒层数+X（蜂王）
  summonEachTurn?: string; // 每回合末召唤一只指定怪物（蜂王）
  lowHpConsumeSummon?: { summonName: string; healPct: number; hpPct: number }; // 低血时吞噬一只同名召唤物回血（每场一次，蜂王）
  doublePoisonOnHit?: boolean; // 普攻使目标中毒层数翻倍（剧毒米诺鱼）
  spdBasedDmg?: { base: number; mul: number }; // 普攻造成 (base + 目标速度×mul) 物理伤害（魔鬼鱼）
  startHpPct?: number; // 登场时最大生命乘以X（融合暗精灵僵尸 0.5）
  consumePlagueOnHit?: { healPctPerStack: number; atkPerStack: number }; // 普攻消除目标瘟疫，回X%/层并获Y攻击/层（融合暗精灵僵尸）
  invincibleWhileAllies?: boolean; // 仍有其他友方存活时无敌且无法行动（融合暗精灵僵尸）
  lockTarget?: boolean; // 普攻锁定目标直至其死亡（自动战车）
  atkMulScaling?: number; // 每次攻击同一目标伤害倍率+X（换目标重置，自动战车 0.5）
  turnCycleAttack?: { every: number; hits: number; mul: number; ignoreDefPct: number }; // 每N回合攻击变为多段（超重力机甲）
  spdUpOnHitCap?: number; // 被攻击后速度提升上限（木裂战士 +20）
  bindAtkBoost?: number; // 攻击时攻击力=目标当前束缚层数×X，攻击后消失（捣碎鳄 5）
  taunt?: boolean; // 嘲讽：敌方无法选择其他友方单位为攻击目标（巨像蛤）
  defLoseOnHitCha?: boolean; // 每次被攻击自身防御-=攻击者魅力值（巨像蛤）
  dmgToDefOnDeal?: boolean; // 自身造成的伤害等额提升自身防御（巨像蛤）
  aoeTrueDmgOnHit?: number; // 每次被攻击对敌方全体造成X点真实伤害（巨像蛤 10）
  // ===== 灾厄 BOSS 通用能力 =====
  invincible?: boolean; // 持续无敌：免疫所有伤害与BUFF（克苏鲁之脑/腐巢意志初始）
  aoeReductionPct?: number; // 受到的群体伤害减少 X%（世界吞噬者 60）
  basicAttackMul?: number; // 普攻倍率（部位差异化，世界吞噬者身0.8）
  spdBasedDmgPct?: { base: number; mul: number }; // 普攻造成 (base+目标速度×mul)% 攻击力物理伤害（魔鬼鱼）
  // ===== 危机合约怪物专属能力 =====
  crisis?: {
    // 狂暴宿主组长：每回合末扣除自身最大生命 X%
    selfBurnPct?: number;
    // 挂狗：我方仅剩1单位时无视防御+速+speedUp
    lastStandExecute?: { ignoreDef: boolean; speedUp: number };
    // 鼠鼠：免疫群攻，每回合不攻击而是回复全体友方 healPct 最大HP
    supportHealer?: { aoeImmune: boolean; healPct: number };
    // 畸变杰克：普攻自适应伤害（取物理/法术较大值）
    adaptive?: boolean;
    // 畸变杰克：同时面对2个敌人时攻防法抗提升
    buff1v2?: { atk: number; def: number; mres: number };
  };
  custom?: boolean;
}

export type BreakEffect = 'coreAtkDown30' | 'coreDefDown50' | 'stunCoreOnce' | 'coreDefMresZero';

export interface BossPart {
  id: string;
  name: string;
  stats: BaseStats;
  skills: Skill[];
  onBreak: BreakEffect | null;
}

export interface BossDef extends MonsterUnit {
  ai: 'boss';
  enrageThreshold: number; // 0.5 = 半血狂暴
  parts: BossPart[]; // 核心固定在 [0]
}

export const isBoss = (m: MonsterUnit): m is BossDef =>
  m.ai === 'boss' && Array.isArray((m as BossDef).parts);

// ===== 战斗运行时 =====
export interface Statuses {
  stunTurns: number;
  atkModPct: number;
  defModPct: number;
}

export interface Combatant {
  uid: string;
  side: Side;
  name: string;
  job?: Job; // 角色职业（登场动画/职业判定用；王牌单位与怪物无此字段）
  icon?: string;
  maxHp: number;
  baseMaxHp?: number; // 瘟疫削减前的原始最大生命（用于按层数重算）
  hp: number;
  maxMp: number;
  mp: number;
  stats: BaseStats; // 开战前算好的最终值
  baseSnapshot?: { stats: BaseStats; agi: number; cha: number; int: number; str: number; wil: number; luk: number }; // 局外基础快照（含遗物），用于战斗面板差值显示
  shield: number;
  attackType: DamageType;
  weaponType?: WeaponType; // 武器类型：近战/远程/魔法（用于遗物分类判定）
  skills: Skill[];
  ignoreDefPct?: number; // 被动技能：攻击无视目标X%防御（弱点侦查）
  chaTrueDmgMul?: number; // 被动技能：每次攻击附加 魅力×此值 的真实伤害（弱点侦查）
  cooldowns: Record<string, number>;
  alive: boolean;
  statuses: Statuses;
  enraged: boolean;
  passives: ItemPassives;
  surviveUsed: boolean; // 本场战斗是否已触发致命保血
  bag: { itemId: string; count: number }[];
  buffs: Buff[]; // 当前携带的 BUFF
  ai: AiKind;
  monsterId?: string; // 敌方单位对应的图鉴怪物 id（用于召唤/机制回查）
  basicAttackBuffs?: AttackBuff[]; // 怪物普攻命中后附加的 BUFF
  summon?: MonsterSummon; // 召唤机制配置
  summonTemplate?: Combatant; // 召唤物模板（开战前构建，进场时重设 uid）
  summonStage?: number; // 已触发的召唤档数（每跌破一档+1，达到 thresholds.length 后不再召唤）
  enrage?: MonsterEnrage; // 自定义狂暴配置
  bossId?: string;
  isCore?: boolean;
  partBreak?: BreakEffect;
  postActionHealPct?: number; // 行动后恢复最大生命百分比（恶魔祭坛-血腥）
  postActionDebuffAlly?: boolean; // 腐化祭坛：行动后随机减我方单位5攻或5防
  // ===== 遗物带来的战斗加成（applyRelics 在战斗开局写入我方单位）=====
  relicMods?: Partial<DamageMods>; // 遗物增伤/减伤汇总
  shieldGainBonus?: number; // 获得护盾时额外增加（钨钢电池）
  damageCapPct?: number; // 单次受伤不超过最大生命百分比（马克温的披风）
  healTurnEnd?: number; // 每回合末恢复固定生命（朱天使的戒指）
  shieldPerTurns?: { every: number; amount: number }; // 每N回合获得护盾（钨钢防护罩）
  chaosShieldPct?: number; // 每回合开始扣最大生命X%转化为等量护盾（混沌与调和）
  shieldDmgAmp?: number; // 存在护盾时伤害+X%（奶蛙的肚皮）
  spdDmgAmp?: { perPoint: number; cap: number }; // 每高于目标1点速度伤害+perPoint，上限cap（scout的狙击镜）
  lowSpdDmgAmp?: { perPoint: number; cap: number }; // 每低于目标1点速度伤害+perPoint，上限cap（blast的电锯）
  atkPerHit?: number; // 每次攻击后攻击力+X%（奶蛙的玉足）
  trueDmgOnHit?: number; // 每次攻击附加目标最大生命X%的真实伤害（奶蛙的手臂）
  turnStartEnemyDmg?: number; // 回合开始对随机敌人造成N点真实伤害（卢克索的礼物，多部位则全部部位）
  firstHitDouble?: boolean; // 战斗中首次伤害翻倍（大刀丸，未消耗）
  firstHitUsed?: boolean; // 大刀丸翻倍已消耗
  // ===== 新遗物战斗标记 =====
  firstTurnAtkUsed?: boolean; // 第一回合攻击加成是否已结算
  firstTurnAtkBase?: number; // 第一回合攻击加成前的基础攻击力（用于第2回合还原）
  normalAtkAmp?: number; // 普攻倍率+X%
  healAmp?: number; // 生命恢复效果+X%
  // ===== 武器被动（灾厄泰拉 30 级武器）=====
  weaponHealOnAction?: number; // 行动后恢复自身N点HP（血腥武器）
  weaponSpdUpPerAtk?: { amount: number; cap: number }; // 每次攻击后速度+amount（上限cap）（风之武器）
  weaponAdaptiveBasicAttack?: boolean; // 普攻自适应伤害（残缺环境刃）
  weaponAoeTrueDmgPct?: number; // 普攻额外对敌方群体造成本次伤害X%真伤（凝胶武器）
  weaponBasicAttackHits?: { count: number; mul: number }; // 普攻多段（月光弓）
  weaponExtraRandomHit?: { mul: number; type: DamageType }; // 普攻额外随机命中（永夜射线）
  weaponBrokenArk?: { mpCost: number; dmgRedPct: number; buffStacks: number; buffIntensity: number }; // 破碎方舟被动
  weaponSpdGained?: number; // 风之武器已获得的速度加成（用于上限判断）
  healTurnEndPct?: number; // 回合末恢复最大生命X%
  mpTurnEnd?: number; // 每回合末恢复X点MP
  lowHpEnemyDmgAmp?: { threshold: number; pct: number }; // 对低血量敌人增伤
  lastStandDef?: { defPct: number; mres: number }; // 只剩一个单位时防御/法抗加成
  lastStandDefTriggered?: boolean;
  lastStandAtk?: { atkPct: number; spd: number }; // 只剩一个单位时攻击/速度加成
  lastStandAtkTriggered?: boolean;
  turnStartBuff?: { turn: number; defPct: number; mres: number }; // 第N回合开始全体buff
  buffStackBonus?: number; // 施加的buff层数+X
  buffIntensityBonus?: number; // 施加的强度类buff强度+X且上限+X
  surviveLethalInvincible?: boolean; // 致命伤保1血并本回合无敌（每场1次）
  invincibleThisTurn?: boolean; // 本回合无敌（名刀司命/伪翅）
  chitinDotPct?: number; // 几丁质刺刀：回合末受X%最大生命真伤
  swordHammerMpExtra?: number; // 剑锤：技能额外消耗MP
  killInvincible?: boolean; // 击杀后本回合无敌
  killMpRestore?: number; // 击杀后恢复X MP
  killHpRestore?: number; // 击杀后恢复X HP
  killSpdBuff?: number; // 击杀后下回合速度+X
  noSkillAtkBuff?: { pct: number; cap: number; stacks: number }; // 不使用技能则攻击+X%（层数直接计入atkPctBonus）
  hpLossAtk?: { hpLossPctPer: number; atkPctPer: number }; // 每损失X%生命攻击+Y%
  hpLossAtkBase?: number; // 热辣可可：记录基础攻击力
  hpLossAtkContrib?: number; // 热辣可可当前计入atkPctBonus的攻%（小数），重算时先减后加
  atkPctBonus?: number; // 攻击力百分比加成累加（小数），所有加攻%遗物/技能叠加在此，effAtk统一乘算
  allyCountAtkCfg?: { perUnit: number; cap: number }; // 岩角号配置
  allyCountAtkAmp?: number; // 岩角号当前回合攻击力加成（小数），每回合开始重算
  hpLossSpd?: { hpLossPctPer: number; spdPer: number }; // 每损失X%生命速度+Y
  hpLossSpdBase?: { min: number; max: number }; // 肾上腺素：记录基础速度
  actionHpToShield?: { hpLoss: number; shieldGain: number }; // 每次行动后失X HP得Y护盾
  noHitShield?: number; // 上回合未受击则回合开始获得X护盾
  wasHitLastTurn?: boolean; // 上回合是否受到过伤害（种植者名单判定）
  turnStartBuffTriggered?: boolean; // 古堡的子嗣是否已触发
  skillDmgStack?: { pct: number; cap: number; stacks: number }; // 每次使用技能伤害+X%
  currentSkillAmp?: number; // 本次技能伤害倍率（拳经三问，临时）
  detonateDouble?: boolean; // 层数引爆伤害双倍
  // ===== 王牌单位被动 =====
  aceTaunt?: boolean; // 嘲讽：敌方优先攻击自身
  aceUntargetable?: boolean; // 敌方优先不选取自身
  aceDmgRedOnHit?: { phys: number; magic: number; cap: number }; // 受击获得对应减伤
  aceDmgRedOnHitGain?: number; // 每次受击减伤增量
  aceDefUpOnHit?: { def: number; mres: number; defCap?: number; mresCap?: number }; // 受击防御/法抗提升（可选次数上限）
  aceDefUpOnHitCount?: { def: number; mres: number }; // 受击防御/法抗提升累计次数
  aceImplosionCapBonus?: number; // 敌方聚爆上限+X
  aceImplosionTurnEnd?: boolean; // 回合末敌方全体获聚爆
  aceBasicAttack?: { dmgPct: number; dmgType: DamageType }; // 普攻改写
  aceOncePerBattleUsed?: Record<string, boolean>; // 每场一次技能是否已用
  aceChargeSkill?: { skillId: string; turnsLeft: number }; // 蓄力中技能
  aceStatUpTotal?: { def: number; mres: number }; // 已累计的属性提升（用于上限判定）
  // ===== 角色属性（战斗技能计算用）=====
  agi?: number; // 敏捷（六维之一，凯隐技能按敏捷×倍率计算护盾/回血）
  cha?: number; // 魅力（六维之一，提丰弱点侦查按魅力×倍率附加真实伤害）
  int?: number; // 智力（六维之一，逻各斯技能按智力×倍率计算伤害）
  str?: number; // 力量（六维之一，神秘面具男豪火球之术按力量计算伤害倍率）
  wil?: number; // 意志（六维之一，奥古斯塔驭冕铸雷之权按意志计算护盾）
  luk?: number; // 幸运（六维之一，面板展示用）
  charLevel?: number; // 角色等级（殁亡斩杀阈值计算用）
  // ===== 逻各斯被动汇总 =====
  ignoreMresFlat?: number; // 无视法抗扁平值（语汇演化）
  afterHitRandomMagicMul?: number; // 攻击后随机法术伤害倍率（语汇演化）
  applyApoptosisOnHit?: boolean; // 攻击附加凋亡（语汇演化）
  executeIntMul?: number; // 殁亡斩杀：智力倍率
  executeChain?: boolean; // 殁亡斩杀后是否连锁
  // ===== 氮氮被动汇总 =====
  chillAdhesionStacks?: number; // 低温附着：带寒冷的敌方回合末所有效果层数+X
  chillAdhesionIntensity?: number; // 低温附着：带寒冷的敌方回合末所有效果强度+X
  condensGrenadeActive?: { turnsLeft: number; chillPerHit: number; keepOne: boolean }; // 冷凝榴弹生效中
  // ===== 神秘面具男：虚化 =====
  kamuiUses?: number; // 本回合剩余虚化次数
  kamuiMaxUses?: number; // 每回合虚化次数上限
  kamuiMpCost?: number; // 每次虚化的MP消耗
  // ===== 次数盾（免疫伤害次数，多段伤害逐段消耗）=====
  shieldStacks?: number; // 次数盾：每层免疫1次伤害（凯隐被动/掠影步）
  // ===== 凯隐能量与双形态 =====
  energy?: number; // 当前能量
  energyMax?: number; // 能量上限
  energyOverflowRatio?: number; // 能量超出上限后 1:X 转换为护盾
  kaynEnergyPerSkill?: number; // 每次释放技能获得的能量
  kaynHpThreshold?: number; // 暗裔魔镰被动触发血量阈值（失去该比例最大生命后触发）
  kaynEnergyOnTrigger?: number; // 被动触发时获得的能量
  form?: 'red' | 'blue'; // 凯隐形态（红=近战物理/蓝=法术），初始红
  kaynPassiveUsed?: boolean; // 暗裔魔镰被动是否已触发（每场1次）
  kaynFirstSwitch?: boolean; // 掠影步首次切换形态的加成是否已用
  kaynAtkGain?: number; // 狂镰横扫红形态累计获得的攻击力（本场战斗内，用于上限判定）
  momentum?: number; // 奥古斯塔战势层数
  momentumMax?: number; // 战势层数上限
  momentumHitGainedThisTurn?: number; // 本回合受击已获得的战势层数（用于上限判定）
  // ===== 小李 · 八门遁甲 =====
  eightGates?: number; // 八门遁甲当前层数
  eightGatesMax?: number; // 八门遁甲层数上限
  eightGatesAtkPerLayer?: number; // 每层八门遁甲提供的攻击力（=等级/2）
  // ===== DONK · 世一步 / 闪身步 / 魔王 =====
  donkFirstAttackUsed?: boolean; // 本场战斗首次普攻真伤是否已触发
  donkTotalMpConsumed?: number; // 本场战斗累计消耗的MP（用于闪身步加速与世一步攻强）
  donkDodgerSpdGained?: number; // 闪身步已获得的速度（用于上限判定）
  donkShiyiPendingProcs?: number; // 世一步待触发的真伤次数（每消耗30MP累积1次）
  // ===== 爱弥斯 · 聚爆 / 形态 / 同步率 =====
  eimisForm?: 'human' | 'mech'; // 人/机甲形态，登场为人形态
  eimisSyncRate?: number; // 同步率（0~上限4，永久资源，飞至启明之时清空）
  eimisSyncMax?: number; // 同步率上限（4）
  eimisNextAtkHuiMang?: boolean; // 下次普攻是否为强化普攻"辉芒"
  eimisOverflowMulBonus?: number; // 聚爆溢出层数累积的倍率加成（每层+10%，累加）
  eimisDetonatedThisTurn?: boolean; // 本回合是否有敌方聚爆被引爆（共赴长航被动判定）
  // ===== 新约能天使 · 弹药体系 =====
  ammo?: number; // 当前弹药数
  ammoMax?: number; // 弹药上限（用于UI条显示，初始弹药数）
  ammoNextMulBonus?: number; // 下次攻击的倍率加成（每发弹药+10%），攻击后清零
  ammoConsumedTotal?: number; // 本场累计消耗弹药数（火力电台阈值判定）
  ammoPreActionCost?: number; // 行动前消耗弹药数
  ammoMulPerBullet?: number; // 每发弹药提供的倍率
  ammoTurnEndTrueDmgPct?: number; // 回合末自损最大HP百分比
  // ===== 里恩 · 神谕代行者 =====
  reinOracle?: { // 神谕代行者运行时状态
    stacks: number; // 代行-赫尔墨斯层数（0~12，不清零持续累计）
    markedVariantId: string; // 本回合指令标选中的一技能变体（''=无）
    markedTargetUid: string; // 本回合指令标选中的敌方目标（''=无）
    liberation: 0 | 1 | 2 | 3; // 当前解放档位（覆盖式，0=未解放）
    sixApplied: number; // 已施加的六维加成（用于档位切换时撤销）
    atkApplied: number; // 已施加的攻击力加成
    ampApplied: number; // 已施加的全能增伤
  };
  reinHeartFate?: boolean; // 心-命运是否已获得（速度/最高六维/每回合MP）
  reinFuriosoUsed?: boolean; // Furioso-Replica 是否已使用（整场一次）
  reinLiberationAmp?: number; // 解放III的全能增伤（并入增伤区）
  // ===== 氮氮 · 冷凝榴弹（被动追踪）=====
  condensChillDmg?: number; // 该单位累计受到的寒冷伤害
  condensConsumedChill?: number; // 该单位累计被消耗的寒冷层数
  condensDmgTier?: number; // 寒冷伤害阈值已触发次数（0/1/2）
  condensSpdApplied?: boolean; // 永久减速是否已触发
  pendingSwift?: { intensity: number; stacks: number }; // 掠影步蓝形态：回合末待施加的迅捷
  // ===== 嘲讽（小猫自动吸附：本回合替指定友方承受伤害）=====
  tauntForUid?: string; // 替该友方单位承受接下来的伤害（本回合有效）
  atkCut?: number; // 拿钱砸袁绍：本回合攻击力削减量（回合末恢复）
  dmgCapPerTurn?: number; // 每回合受到的总伤害上限（马神残躯能力2）
  dmgTakenThisTurn?: number; // 本回合已受到的伤害累计（回合末清零）
  atkUpIfNotHitLastTurn?: number; // 上回合未被攻击则本回合攻击力+X（夺舍红狼）
  hitThisTurn?: boolean; // 本回合是否被攻击过（夺舍红狼判定）
  atkUpActive?: number; // 本回合已激活的临时攻击力加成（回合末扣除）
  debuffOnHit?: { atk: number; def: number; mres: number; maxTimes: number }; // 猛攻肥区
  debuffOnHitCount?: number; // 猛攻肥区已减益次数
  fleeOnTurn?: number; // 第N回合末逃离（老板）
  bonusDropOnKill?: FixedDrop; // 击杀额外掉落（老板）
  turnStartBurn?: { intensity: number; stacks: number }; // 每回合开始敌方烧伤（乌鲁鲁）
  fled?: boolean; // 是否已逃离战场
  // ===== 灾厄泰拉怪物运行时状态 =====
  lifestealPct?: number; // 普攻伤害 X% 转为自身治疗
  lifestealAllPct?: number; // 普攻伤害 X% 转为全体友方治疗
  healAllTurnEnd?: number; // 回合末恢复全体友方固定生命
  healAllTurnEndPct?: number; // 回合末恢复全体友方 X% 最大生命
  mpDrain?: number; // 普攻减少目标 X MP
  poisonOnHit?: { intensity: number; stacks: number }; // 被攻击时使攻击者中毒
  plagueOnHit?: { intensity: number; stacks: number }; // 普攻附加瘟疫
  initialShield?: number; // 初始护盾
  shieldDmgAmpPct?: number; // 持有护盾时伤害提升 X%
  spdUpOnHit?: number; // 被攻击后下回合速度 +X
  spdUpPending?: number; // 待结算的速度提升（回合开始应用，回合末清零）
  spdUpApplied?: number; // 本回合已应用的速度提升（回合末还原）
  aoeBasicAttack?: boolean; // 普攻群体伤害
  multiHit?: number; // 普攻连击次数
  reviveOnce?: boolean; // 死亡后复活一次
  revived?: boolean; // 是否已复活
  counterTrueDmg?: number; // 被攻击时反伤真实伤害
  maxHpTrueDmgPct?: number; // 普攻额外造成目标最大生命 X% 真实伤害
  defUpOnHit?: { amount: number; cap: number }; // 被攻击防御+X（上限）
  defUpOnHitCount?: number; // 防御提升累计次数
  evenTurnGuard?: { def: number }; // 偶数回合守备
  evenTurnGuardActive?: boolean; // 本回合是否守备
  shieldAllTurnEnd?: number; // 回合末给全体友方护盾
  selfDestructOnSurvive?: boolean; // 被攻击后回合末存活则自爆
  wasHitThisTurn?: boolean; // 本回合是否被攻击过（自爆判定用）
  defDownOnHit?: number; // 普攻减少目标防御
  plagueStackBonusTrueDmg?: number; // 普攻额外 瘟疫层数×X 真实伤害
  plagueStackBonusMagicDmg?: number; // 普攻 80+瘟疫层数×X 法术伤害
  poisonStackBonusTrueDmg?: number; // 普攻额外 中毒层数×X 真实伤害（Viper）
  // ===== 灾厄泰拉怪物运行时（第二批）=====
  multiHitMul?: number; // multiHit 每段倍率
  multiHitRandom?: boolean; // multiHit 每段随机目标
  basicAttackDefMul?: number; // 普攻以防御力×倍率计算
  spdTrueDmgMul?: number; // 普攻附速度×X 真实伤害
  hpLossPerStep?: { stepPct: number; atk: number; spd: number };
  hpLossBonusLast?: number; // 上次结算的损失档位
  poisonStackAtkMul?: { base: number; perStack: number };
  aoeSplashPct?: number;
  turnEndAoeMagic?: number;
  hitTurnPattern?: { start: number; interval: number };
  summonBelowAllies?: { count: number; pool: string[] };
  summonPoolTemplates?: Combatant[]; // 召唤池模板（开战前构建）
  perAllyStats?: { def: number; mres: number };
  perAllyBaseStats?: { def: number; mres: number }; // 基准防御/法抗（用于每回合重算）
  onAllyDeath?: { allyName: string; multiHit?: number; atk?: number; def?: number; mres?: number };
  onAllyDeathTriggered?: boolean;
  bleedStackDmgAmp?: number;
  aiPriority?: 'mostBleed' | 'fastest' | 'lowestHp';
  dmgToMaxHp?: boolean;
  lifestealMissingHp?: boolean;
  lowHpBurst?: { hpPct: number; spd: number; atk: number };
  lowHpBurstUsed?: boolean;
  onDeathHealAllyPct?: number;
  onDeathBuffAlly?: { atk: number; spd: number };
  attackGroupPoison?: { intensity: number; stacks: number };
  summonEachTurn?: string;
  summonEachTurnTemplate?: Combatant; // 每回合召唤物模板（开战前构建）
  lowHpConsumeSummon?: { summonName: string; healPct: number; hpPct: number };
  lowHpConsumeSummonUsed?: boolean;
  doublePoisonOnHit?: boolean;
  spdBasedDmg?: { base: number; mul: number };
  startHpPct?: number;
  consumePlagueOnHit?: { healPctPerStack: number; atkPerStack: number };
  invincibleWhileAllies?: boolean;
  lockTarget?: boolean;
  atkMulScaling?: number;
  lockedTargetUid?: string;
  atkMulBonus?: number; // 累计伤害倍率加成
  turnCycleAttack?: { every: number; hits: number; mul: number; ignoreDefPct: number };
  extraDmgProc?: boolean; // 额外伤害递归保护（灾厄怪物普攻额外真伤/法伤内部用）
  spdUpOnHitCap?: number; // 被攻击后速度提升上限
  bindAtkBoost?: number; // 攻击时攻击力=目标束缚层数×X（攻击后恢复）
  taunt?: boolean; // 嘲讽：敌方无法选择其他友方单位为攻击目标
  defLoseOnHitCha?: boolean; // 每次被攻击自身防御-=攻击者魅力
  dmgToDefOnDeal?: boolean; // 自身造成伤害等额提升自身防御
  aoeTrueDmgOnHit?: number; // 每次被攻击对敌方全体真伤
  invincible?: boolean; // 持续无敌：免疫伤害与BUFF
  aoeReductionPct?: number; // 受到的群体伤害减少 X%
  basicAttackMul?: number; // 普攻倍率
  spdBasedDmgPct?: { base: number; mul: number }; // (base+目标速度×mul)% 攻击力物理伤害
  roll?: number;
  tieBreak?: number;
  // ===== 危机合约怪物运行时状态 =====
  crisis?: {
    selfBurnPct?: number;
    lastStandExecute?: { ignoreDef: boolean; speedUp: number };
    lastStandActive?: boolean; // 挂狗能力是否已触发
    supportHealer?: { aoeImmune: boolean; healPct: number };
    adaptive?: boolean;
    buff1v2?: { atk: number; def: number; mres: number };
    buff1v2Active?: boolean;
    // 冥王破天：区分破天（核心）与冥王（部位）两个行动槽
    role?: 'potian' | 'mingwang';
    // 冥王破天
    mingwang?: {
      potianSpd: number; // 破天当前速度
      potianDmgThisTurn: number; // 破天本回合受到的伤害（用于速度增长）
      potianExtraAtk?: number; // 杰克词条：每回合攻击+10累计
      lastProcessedTurn?: number; // 最近一次结算受击加速的回合（避免双槽重复）
    };
    // 应龙
    yinglong?: {
      needle: number; // 葬花针层数
      needleBaseAtk?: number; // 攻击力+10%/层的基数
      needleBaseDef?: number; // 防御+10%/层的基数
      needleBaseMres?: number; // 法抗+5/层的基数
      luoleiHp?: number; // 落雷HP
      usedStats?: ('str' | 'int' | 'agi' | 'wil' | 'luk' | 'cha')[]; // 已用过的六维
    };
    // ===== 灾厄 BOSS 运行时状态 =====
    worldeater?: { partsDead: number }; // 世界吞噬者已死亡部位数
    cthulhuBrain?: { phase: 'invincible' | 'active' }; // 克苏鲁之脑阶段
    rotNest?: { phase: 'invincible' | 'active'; cycleStep: number; enraged: boolean }; // 腐巢意志
    fleshHost?: { wormsSummoned: number }; // 血肉宿主已召唤蠕虫数
    skeletron?: { handsDead: boolean; reviveCounter: number }; // 骷髅王
    wallOfFlesh?: { atkBonus: number; turn: number; steps: number[]; stepIdx: number; lastEvaded: number }; // 肉山（双行动槽）
    direge?: { phase: 1 | 2 }; // 黑色瘟疫·狄瑞吉
    huanglei?: { burst70: boolean; burst40: boolean }; // 煌雷龙两档爆发是否已触发
    akado?: { bloodPool: number; revived?: boolean; buff200?: boolean; buff500?: boolean }; // 阿卡多血槽
    laoxian?: { red: number }; // 劳贤红温印记（0/3）
  };
}

export type LogEntry =
  | { id: number; t: 'info'; text: string }
  | { id: number; t: 'roll'; turn: number }
  | { id: number; t: 'stun'; uid: string; name: string }
  | { id: number; t: 'survive'; uid: string; name: string }
  | { id: number; t: 'death'; uid: string; name: string }
  | { id: number; t: 'break'; uid: string; bossId: string; partName: string }
  | { id: number; t: 'summon'; uid: string; name: string; targetUid: string; targetName: string }
  | {
      id: number;
      t: 'action';
      actorUid: string;
      kind: 'attack' | 'skill' | 'item';
      label: string;
      targetUids: string[];
    }
  | { id: number; t: 'damage'; targetUid: string; amount: number; type: DamageType; killed: boolean; blocked?: number }
  | { id: number; t: 'heal' | 'shield'; targetUid: string; amount: number }
  | { id: number; t: 'buff'; uid: string; buffId: BuffId; stacks: number; intensity: number; applied: boolean }
  | { id: number; t: 'vfx'; uid: string; kind: VfxKind };

export type VfxKind = 'kayn-form-red' | 'kayn-form-blue' | 'masked-enhance' | 'masked-execute' | 'masked-kamui' | 'augusta-enhance' | 'augusta-momentum' | 'logos-execute' | 'logos-apoptosis' | 'reinLib1' | 'reinLib2' | 'reinLib3' | 'reinMaskGif' | 'reinLibSwitch' | 'eimisFormSwitch' | 'eimisEntry' | 'logosEntry' | 'exusiaiEntry';

// 受击前反应暂停态：敌方行动已决策但未执行，等待玩家选择是否使用反应技能
export interface PendingReaction {
  attackerUid: string;
  targetUid: string; // 反应者（即将受击的我方）
  skillId: string; // 反应技能 id
  action:
    | { kind: 'attack'; targetUid: string }
    | { kind: 'skill'; skillId: string; targetUid?: string }
    | { kind: 'special'; targetUid: string; evadedStep?: number; aoeKamui?: boolean }; // 特殊AI直伤分支：闪避后行动作废；evadedStep 记录双槽单位被打断的行动步（如肉山）；aoeKamui=群体攻击（接受后仅面具男免疫自身，行动重放队友照常承伤）
}

// 破碎方舟受击抉择暂停态：伤害已计算但未扣血，等待玩家选择是否消耗MP抵消
export interface PendingBrokenArk {
  targetUid: string; // 被击方
  attackerUid: string; // 攻击来源
  toHp: number; // 扣除护盾/上限后的待扣血量（破碎方舟减伤前）
  damageType: DamageType;
  blocked: number; // 护盾抵消量（用于伤害日志）
}

export interface BattleState {
  turn: number;
  allies: Combatant[];
  enemies: Combatant[]; // 含展开后的 BOSS 部位
  order: string[]; // 本回合顺位 uid 列表（锁死）
  orderRolls?: Record<string, number>; // 每个顺位条目的独立速度掷点（双槽单位用）
  cursor: number; // 当前行动到 order 的哪一位
  log: LogEntry[];
  nextLogId: number;
  nextSummonId: number; // 召唤单位 uid 计数器
  pendingReaction?: PendingReaction; // 反应式技能等待玩家选择（存在时战斗暂停）
  replaySpecial?: boolean; // 特殊AI直伤：玩家拒绝虚化后，需重新执行该行动
  kamuiAoeImmunity?: string; // 群体攻击：面具男虚化自动免疫自己的本次群体伤害（其他目标照常承伤）
  pendingBrokenArk?: PendingBrokenArk; // 破碎方舟受击抉择（存在时战斗暂停）
  choiceMode?: boolean; // 抢商店BOSS战：奇数回合开始前需玩家抉择
  pendingChoice?: { turn: number }; // 当前暂停待抉择的回合（存在时战斗暂停）
  pendingGatesChoice?: { uid: string }; // 小李：回合开始时是否叠加八门遁甲的抉择
  pendingKaynForm?: { uid: string }; // 凯隐：开局选择红/蓝形态的抉择
  pendingEimisFormSwitch?: { uid: string }; // 爱弥斯：回合末聚爆引爆后是否消耗10MP切换形态的抉择
  result: null | 'win' | 'lose';
  bonusDrops?: FixedDrop[]; // 战斗中产生的额外掉落（如老板击杀奖励）
  crisisTermIds?: string[]; // 危机合约选中的词条 id（用于 flag 类词条判定）
  // ===== 应龙六维判定（危机合约S1作战5）=====
  yinglongCheck?: {
    available: ('str' | 'int' | 'agi' | 'wil' | 'luk' | 'cha')[]; // 本轮可选六维
    target: number; // 判定目标值（基础60 + 葬花针层数*5）
    pending: boolean; // 等待玩家选择
    chosenStat?: 'str' | 'int' | 'agi' | 'wil' | 'luk' | 'cha';
    chosenAllyUid?: string;
  };
  yinglongCheckedTurn?: number; // 本回合已触发过应龙判定（避免无限循环）
  turnStartStep?: number; // 回合开始前触发流水线阶段标记（0=应龙判定 → 1=袁绍抉择 → 2=八门遁甲抉择 → 3=单位被动；缺省=已完成）
}

// actor 恒为 currentActor(state)，不在动作里传 uid
export type PlayerAction =
  | { type: 'attack'; targetUid: string }
  | { type: 'skill'; skillId: string; targetUid?: string; enhance?: boolean; variantId?: string } // variantId：里恩一技能三种释放方式
  | { type: 'item'; itemId: string; targetUid: string };

// ===== 关卡 =====
export type StageDifficulty = 'normal' | 'urgent' | 'boss'; // 普通 / 紧急 / BOSS
export type StageAppear = 'regular' | 'event' | 'sublayer' | 'skirmish'; // 常规 / 事件 / 子层 / 狭路相逢
// 掉落目标类型：藏品 / 遗物 / 材料 / 消耗品 / 哈哈币
export type DropKind = 'item' | 'relic' | 'material' | 'consumable' | 'coin';

// 关卡怪物槽：同一种怪可放多只（全关卡合计≤5只）
export interface StageMonster {
  monsterId: string;
  count: number;
}

// 特殊机制（紧急/BOSS特性）：对全体或指定怪物附加固定数值
export interface StageMechanic {
  id: string;
  desc: string;
  scope: 'all' | 'monster'; // 作用于全体怪物 / 指定怪物
  monsterId?: string;
  hp?: number; atk?: number; def?: number; mres?: number;
  spdMin?: number; spdMax?: number;
}

// 掉落随机池可选稀有度（藏品/遗物；不含「普通」）
export const DROP_POOL_RARITIES: Rarity[] = ['uncommon', 'fine', 'rare', 'epic', 'legendary'];
// 随机稀有度分布：各稀有度百分比，合计应为100
export type RarityWeights = Partial<Record<Rarity, number>>;

// 掉落表条目（方案1：归一表，权重合计100，胜利时只roll一件）
export interface DropEntry {
  id: string;
  kind: DropKind;
  source: 'pool' | 'specific'; // pool=按稀有度/等级从藏品库随机；specific=指定具体物品
  rarity?: Rarity; // pool 用（藏品/遗物）；缺省=随机（配合 rarityWeights）
  rarityWeights?: RarityWeights; // rarity 缺省时：各稀有度出现概率（合计100）
  level?: number; // pool 用（藏品等级）
  targetId?: string; // specific 用：藏品/遗物/材料/消耗品的具体 id
  weight: number; // 百分比权重
  count?: number; // kind=coin：哈哈币数量
}

// 幸运掉落：每条独立判定，幸运+1D50 ≥ threshold 即获得（判定结果无论成败都展示）
export interface LuckyDrop {
  id: string;
  kind: DropKind;
  source: 'pool' | 'specific';
  rarity?: Rarity;
  rarityWeights?: RarityWeights;
  level?: number;
  targetId?: string;
  threshold: number; // 判定值
  count?: number; // kind=coin：哈哈币数量
}

// 固定掉落：通关必得，不占随机表权重。材料走共享仓库，哈哈币进副本共享币池
export type FixedDropKind = 'material' | 'coin' | 'item' | 'relic' | 'random';
// 固定掉落「随机一个」的候选：等概率出一件
export interface FixedDropCandidate {
  id: string;
  kind: 'coin' | 'material' | 'item' | 'relic';
  targetId?: string; // material/item/relic：物品 id
  count: number; // coin：数量
}
export interface FixedDrop {
  id: string;
  kind: FixedDropKind;
  targetId?: string; // material/item/relic：物品 id
  count: number; // coin：数量
  candidates?: FixedDropCandidate[]; // kind=random：随机候选
}

export interface StageDef {
  id: string;
  name: string;
  dungeon: string; // 出现副本 id（DUNGEONS）
  floor: number; // 出现层数
  difficulty: StageDifficulty;
  pairStageId?: string; // 紧急关卡对应的普通关卡
  appear: StageAppear;
  sublayerName?: string; // appear=sublayer 时：所属子层名称（同名归为同一子层）
  skirmishTier?: 1 | 2 | 3; // appear=skirmish 时：狭路相逢难度档位（1易/2中/3难）
  level: number; // 关卡等级（一般=副本等级）
  desc: string;
  monsters: StageMonster[];
  mechanics: StageMechanic[];
  drops: DropEntry[];
  luckyDrops: LuckyDrop[];
  fixedDrops?: FixedDrop[]; // 固定掉落（材料/哈哈币/藏品/遗物/随机），缺省视为空
  custom?: boolean;
}

// ===== 事件库（不期而遇）=====
// 出现条件：常规刷新，或携带火把/遗物/金币达到要求才进入抽取池
export type EventCondition =
  | { type: 'always' } // 常规刷新
  | { type: 'torchGte'; count: number } // 携带火把≥N
  | { type: 'relic'; relicId: string } // 持有指定遗物
  | { type: 'coinGte'; count: number }; // 金币≥N

// 事件奖励动作
export type EventReward =
  | { kind: 'relic'; relicId: string } // 获得指定遗物（进副本遗物栏）
  | { kind: 'item'; itemId: string } // 获得指定藏品（入队长背包）
  | { kind: 'randomItem'; rarity: Rarity; level: number; count?: number } // 随机N级指定稀有度藏品
  | { kind: 'randomRelic'; rarity?: Rarity; count?: number } // 随机指定稀有度遗物（缺省=任意未获得）
  | { kind: 'enchantedWeapon' } // 获得一件当前角色可穿戴的附魔武器（石中剑）
  | { kind: 'torch'; count: number } // 获得火把
  | { kind: 'heal'; hpPct: number; mpPct: number } // 按最大生命/魔力百分比恢复
  | { kind: 'damage'; hpPct: number; mpPct?: number } // 全队扣除最大生命/魔力百分比（HP最低保留1）
  | { kind: 'coins'; count: number } // 获得哈哈币
  | { kind: 'battle'; stageName: string; urgent?: boolean } // 触发指定关卡战斗（按名字查关卡库）
  | { kind: 'battleRandom'; stageNames: string[] } // 随机遭遇其一
  | { kind: 'randomOne'; rewards: EventReward[] } // 从奖励列表中随机选其一结算
  | { kind: 'removeRelic'; count: number } // 随机移除N个本局遗物
  | { kind: 'recruitAce'; aceId: string } // 王牌单位直接加入队伍
  | { kind: 'none' }; // 无奖励（直接离开等）

export type EventStatKey = 'str' | 'int' | 'agi' | 'luk' | 'wil' | 'cha';

// 事件选项
export interface EventOption {
  id: string;
  text: string; // 选项文案
  hint?: string; // 选项下的小字说明（结果/代价提示）
  cost?: { torch?: number; coins?: number }; // 需要消耗的资源（不足时选项置灰）
  outcome: {
    stat?: { key: EventStatKey; threshold: number }; // 六维判定：六维+1D50 ≥ 阈值；缺省 fail=离开节点
    rewards: EventReward[]; // 直接奖励 / 判定成功奖励
    fail?: EventReward[]; // 判定失败奖励（缺省=无奖励离开）
    stay?: boolean; // 结算后不离开节点，继续停留在事件中（用于多步事件）
    recruitRarity?: 'rare' | 'epic'; // 结算后打开王牌招募候选（灾厄重返家园）
    stepInc?: number; // 结算后 eventStep 增加 N（事不过四拿币计数）
    battleIfStepGte?: { step: number; stageName: string; urgent?: boolean }; // eventStep≥N 时触发对应战斗
  };
}

export interface EventDef {
  id: string;
  name: string;
  icon?: string; // 事件图标（缺省用文字装饰）
  dungeon: string; // 出现副本 id（DUNGEONS）
  floors: number[]; // 出现层数（可多个）
  cond: EventCondition; // 出现条件（常规刷新=always）
  text: string; // 事件文本（左侧展示）
  options: EventOption[]; // 选项（右侧展示）
}

// ===== 编队 =====
// memberIds 以队长开头；队长在编队首位、不可下阵，哈哈币平分余数归队长
export interface Party {
  leaderId: string;
  memberIds: string[];
  deployedIds?: string[]; // 上场成员（memberIds 的子集，最多3名）；缺省取前3名
}

// ===== 王牌单位（灾厄泰拉临时队友，固定属性不升级不穿装备）=====
// 王牌单位技能：数据驱动，便于直接编辑倍率与属性
export interface AceSkill {
  name: string;
  desc: string;
  kind: 'passive' | 'active';
  mpCost?: number;
  // —— 伤害 ——
  dmgPct?: number;              // 伤害倍率（基于攻击力），如 2.0 = 200%
  dmgType?: 'phys' | 'magic' | 'true';  // 伤害类型
  target?: 'single' | 'all';    // 目标：单体/群体
  trueDmgFlat?: number;         // 额外固定真实伤害
  maxHpTrueDmgPct?: number;     // 额外目标最大生命百分比真伤（0.05 = 5%）
  // —— 护盾 ——
  shield?: number;              // 自身获得护盾
  shieldMissingHp?: boolean;    // 护盾 = 已损生命值
  allyShield?: number;          // 随机1名友方获得护盾
  // —— 施加 BUFF/DEBUFF（命中后）——
  applyBuff?: { id: BuffId; stacks: number; intensity: number };
  // —— 扁平属性提升（带上限）——
  statUp?: { def?: number; mres?: number; defCap?: number; mresCap?: number };
  // —— 特殊限制 ——
  oncePerBattle?: boolean;      // 每场战斗仅可使用一次
  chargeTurns?: number;         // 蓄力回合数（1 = 蓄力一回合后释放）
  // —— 被动效果 ——
  basicAttack?: { dmgPct: number; dmgType: 'phys' | 'magic' };  // 普攻改写为指定倍率与类型
  lowHpDmgAmp?: { threshold: number; amp: number };  // 对低于 threshold% HP 的敌人伤害 +amp
  taunt?: boolean;              // 嘲讽：敌方优先攻击自身
  untargetable?: boolean;       // 敌方优先不选取自身
  dmgRedOnHit?: number;         // 每次受击获得对应伤害类型减伤（上限80%）
  defUpOnHit?: { def: number; mres: number; defCap?: number; mresCap?: number };  // 每次受击防御+X、法抗+Y（defCap/mresCap 为累计次数上限，缺省不限制）
  implosionCapBonus?: number;   // 敌方聚爆层数上限+X
  implosionTurnEnd?: boolean;   // 回合末敌方全体获得当前回合数的聚爆层数
}

export interface AceUnit {
  id: string;
  name: string;
  rarity: 'rare' | 'epic';
  stats: BaseStats;
  skills: AceSkill[];
  icon?: string;
}

// ===== 副本地图 =====
// 节点类型：作战 / 不期而遇 / 诡异行商 / 安全的角落 / 失与得 / 异界来客 / BOSS / 命运所指 / 狭路相逢 / 王牌招募 / 瘟疫之源 / 祭坛
export type MapNodeKind =
  | 'combat' | 'encounter' | 'merchant' | 'rest' | 'trade' | 'visitor' | 'boss' | 'fate'
  | 'skirmish' | 'recruit' | 'plague' | 'altar' | 'placeholder';

export type RunActId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 'sub';

export interface MapNode {
  id: string;
  act: RunActId;
  col: number; // 0-based 列（推进方向）
  row: number; // 0-based 行（纵向位置）
  kind: MapNodeKind;
  urgent?: boolean; // 作战节点：紧急
  stageId?: string; // 作战/BOSS 节点：关卡库抽中的关卡 id
  note?: string; // 特殊标注（异界来客：子层名称）
  hidden?: boolean; // 迷藏标记：经过该节点随机获得一件遗物
}

export interface MapEdge {
  from: string;
  to: string;
  torch?: boolean; // 上下联通的火把线：点击消耗1火把解锁通行
}

export interface ActMap {
  act: RunActId;
  cols: number; // 列数
  rows: number; // 纵向行槽数
  nodes: MapNode[];
  edges: MapEdge[];
}

// ===== 节点系统（诡异行商 / 失与得）=====
// 行商货摊上的一个商品槽：藏品 / 遗物 / 药水 / 道具
export interface MerchantSlot {
  kind: 'item' | 'relic' | 'potion' | 'material';
  id: string; // itemId / relicId
  price: number;
  sold: boolean; // 已售出
}

export interface MerchantShop {
  slots: MerchantSlot[];
}

// 魅力砍价判定结果（每次货摊仅一次；折扣率 0.5=五折 / 0.7 / 0.8 / 1=原价 / 1.2=涨价）
export interface HaggleResult {
  roll: number; // 1D50 点数
  total: number; // 魅力 + 1D50
  discountPct: number; // 价格倍率
}

// 节点的一次性状态（按节点 id 持久化，刷新/离开后不丢失、不能重复利用）
export type NodeState =
  | { kind: 'merchant'; shop: MerchantShop; refreshed: boolean; refreshCount?: number; haggle?: HaggleResult; robbed?: boolean } // 诡异行商：货摊 + 免费刷新是否已用 + 刷新次数 + 砍价结果 + 是否被抢（被抢后价格全0）
  | { kind: 'trade'; used: boolean; exchangeCount?: number } // 失与得：是否已完成交换 + 已交换次数
  | { kind: 'fate'; step: number; used: boolean; checked: boolean } // 命运所指：step=已处理选项数(0-6)，checked=当前选项是否已尝试过判定
  | { kind: 'skirmish'; used: boolean } // 狭路相逢：是否已完成
  | { kind: 'recruit'; refreshed: boolean; refreshCount: number; picked?: string } // 王牌招募：免费刷新是否已用 + 已刷新次数 + 已招募id
  | { kind: 'plague'; phase: 'fresh' | 'explored' | 'done' } // 瘟疫之源：未探索/已探索首战/已完成瘟疫蔓延
  | { kind: 'altar'; choice?: 'crimson' | 'corruption' | 'both' | 'leave' }; // 祭坛：玩家选择

// 一次副本探索的运行时状态（持久化，刷新可继续）
export interface RunState {
  dungeonId: string;
  party: Party;
  acts: Record<'1' | '2' | '3' | '4' | '5' | '6' | '7', ActMap>;
  sublayer: ActMap | null; // 异界来客子层（进入时生成）
  act: RunActId; // 当前所在层
  cleared: string[]; // 已清理节点 id
  at?: string | null; // 当前选定的节点（只能从它前进/上下走；缺省时旧档兜底为该层最后清理的节点）
  visitorNodeId: string | null; // 当前进入子层所经由的异界来客节点
  subReturnAct?: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 子层出口应返回的层号
  subDone: boolean; // 子层完成标记（兼容旧档）；新档按 doneSublayers 逐子层记录
  doneSublayers?: string[]; // 本局已完成的子层名：每子层限进一次，不同子层互不影响
  sublayerName?: string; // 当前子层的名称
  hpMp: Record<string, { hp: number; mp: number }>; // 成员跨战斗继承的生命/魔力
  initialPool: number; // 进本时汇入的币池（结算基准；团灭/撤离时按本局实际币池结算）
  coins: number; // 当前共享币池（汇入 + 途中固定掉落）
  pendingMaterials: { itemId: string; count: number }[]; // 通关后才入共享仓库
  pendingItems: { itemId: string; count: number }[]; // 途中获得的藏品/消耗品，通关时分配给队员（旧档兼容；新档拾取即入包）
  relics: string[]; // 途中获得的遗物（仅本次副本生效，通关/团灭不带出）
  relicStacks?: Record<string, number>; // 层数遗物当前层数（生命/魔力水晶，上限10）；旧档缺省
  failSaveUsed?: boolean; // 时光之末（failSave）是否已发动过（一次性；独立标记，不与测试室层数混淆）
  labUsed?: boolean; // 本局是否使用过遗物测试界面（用于标记"外挂"通关）
  robbedShop?: boolean; // 本局是否已抢过商店（抢店成功后其余行商节点变空摊）
  starterRelic?: string; // 进本时携带的初始遗物（终局联系等非随机池遗物，20级可选）
  fateBossDebuffs?: { // 命运所指对马神残躯的削弱（本局BOSS战永久）
    atkCut?: number; // 攻击力削减
    defCut?: number; // 防御力削减
    hpCut?: number; // 生命上限削减
    spdFixed?: boolean; // 速度固定为5-5
    noRegen?: boolean; // 失去回血能力
    noDmgCap?: boolean; // 失去伤害上限
  };
  torches: number; // 火把数量（初始2；作战胜利按 普通25%/紧急50%/BOSS100% 掉落）
  plagueLetterStacks?: number; // 痛苦之村求救信：已走过的节点层数（每节点+1，最大生命削减2%×层数，上限90%）
  hiddenRelicGain?: string; // 迷藏：最近一次经过隐藏节点获得的遗物id（弹窗展示后清除）
  plaguePhase2Unlocked?: boolean; // 瘟疫之源：首战完成后，下次进入瘟疫节点时触发第二战
  recruitedOwnChars?: string[]; // 本局已招募的自有角色 id（防止重复招募）
  aceUnits?: string[]; // 本局已招募的王牌单位 id
  killBook?: number; // 杀人书层数（每通关一次作战+1，上限10，局外攻击+X%/层）
  nextRecruitBonus?: RecruitBonus; // 下一个招募单位的加成（疗养礼品卡/指中狼/老妈的鼓励）
  recruitUnitBonuses?: Record<string, RecruitBonus>; // 已招募单位的加成（按单位id）
  threeBattleCurseCount?: number; // 失落之钥：已进行的受诅咒战斗数（0~3）
  eventStep?: number; // 当前多步事件的进度计数（如事不过四的拿取次数）
  seenEventsByFloor?: Record<number, string[]>; // 每层已触发过的事件 id（用于每层不重复刷新）
  nodeStates?: Record<string, NodeState>; // 特殊节点一次性状态（行商货摊/失与得交换），按节点 id 记录
  openedEdges: string[]; // 已消耗火把解锁的上下联通线（edgeKey）
  entrySnapshot?: { // 进本时刻各成员的背包/药品快照（撤离/团灭时恢复，清除本局获得）
    inventory: Record<string, string[]>;
    bag: Record<string, { itemId: string; count: number }[]>;
    coins?: Record<string, number>; // 进本时成员随身币（进本时存入仓库，撤离时归还）
  };
  result?: 'win'; // 通关后置位；团灭/撤离战果保留（藏品/币/材料）但 run 清除
  createdAt: number;
  // ===== 危机合约专属 =====
  crisis?: {
    mode: 'single' | 'dual'; // 单人/双人作战
    termIds: string[]; // 选中的合约词条 id
    buffs: Record<number, string>; // 休息点已选 buff（key 为 restIndex）
    score: number; // 结算总分（基础分 + 词条分）
    wishGranted?: boolean; // 是否已领取「得偿所愿」10级藏品自选
  };
}

// 招募单位加成（疗养礼品卡/指中狼/老妈的鼓励）
export interface RecruitBonus {
  spd?: number; // 速度+X
  atkPct?: number; // 攻击力+X%
  dmgPct?: number; // 伤害+X%
  noSkill?: boolean; // 无法使用主动技能
}

// ===== 存档 =====
export interface SaveData {
  version: 1;
  characters: (Character | null)[];
  customItems: Item[];
  customMonsters: MonsterUnit[];
  customStages: StageDef[];
  customEvents?: EventDef[]; // 自定义事件（不期而遇），与内置事件合并后参与抽取
  itemPoolOverrides?: Record<string, boolean>; // 藏品随机池开关覆盖（内置藏品用此记录，自定义藏品直接写 inPool）
  materials: { itemId: string; count: number }[]; // 共享材料仓库
  coinsInStorage: number; // 仓库中的哈哈币
  party?: Party | null; // 上次使用的编队
  activeRun?: RunState | null; // 进行中的副本探索
  monsterSeed?: number; // 内置怪物播种版本，缺/旧则用最新内置名单重置图鉴
  stageSeed?: number; // 内置关卡播种版本，缺/旧则用最新内置关卡重置关卡库
  updatedAt?: number; // 最近一次存档写入时间戳：dev 多端/标签页同步时「取新不取旧」，防旧档回退覆盖
}

// ===== 随机数（可注入，测试用） =====
export interface Rng {
  int(min: number, max: number): number;
}

export const mathRng: Rng = {
  int: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
};

// ===== 物品强化引用（编码在物品ID中：baseId 或 baseId+N）=====
// 强化等级 0 时直接存 baseId；>0 时存 "baseId+N"
export const ENHANCE_SEP = '+';
export function baseItemId(id: string): string {
  const idx = id.lastIndexOf(ENHANCE_SEP);
  if (idx < 0) return id;
  const tail = id.slice(idx + 1);
  return /^\d+$/.test(tail) ? id.slice(0, idx) : id;
}
export function enhanceOf(id: string): number {
  const idx = id.lastIndexOf(ENHANCE_SEP);
  if (idx < 0) return 0;
  const tail = id.slice(idx + 1);
  return /^\d+$/.test(tail) ? parseInt(tail, 10) : 0;
}
export function withEnhance(baseId: string, enhance: number): string {
  return enhance > 0 ? `${baseId}${ENHANCE_SEP}${enhance}` : baseId;
}

// ===== 强化系统配置 =====
export const ENHANCE_MAX: Record<Rarity, number> = {
  common: 0, uncommon: 0, fine: 0, rare: 10, epic: 12, legendary: 15,
};
// 强化成功率（目标等级 → 成功率），索引=目标强化等级
export const ENHANCE_RATES: number[] = [
  1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05,
];
// 强化石消耗（目标等级 → 数量），1-5=2, 6-10=3, 11-15=4
export function enhanceStoneCount(targetLevel: number): number {
  if (targetLevel <= 5) return 2;
  if (targetLevel <= 10) return 3;
  return 4;
}
// 30-40级每级强化加成
export const ENHANCE_BONUS: Record<'weapon' | 'helmet' | 'armor', Partial<BaseStats>> = {
  weapon: { atk: 2 },
  helmet: { hp: 10 },
  armor: { def: 2 },
};
// 可强化的部位
export const ENHANCEABLE_SLOTS: Slot[] = ['weapon', 'helmet', 'armor'];

// ===== 锻造配方 =====
export interface ForgeRecipe {
  id: string;
  name: string; // 配方名称
  resultId: string; // 产出物品ID
  blueprintId: string; // 所需图纸ID
  requiredMaterials: { itemId: string; count: number }[]; // 必须材料
  optionalForgeMaterialCount: number; // 可选任意锻造材料数量（0~2）
  desc?: string;
}

