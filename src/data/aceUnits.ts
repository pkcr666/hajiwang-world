import type { AceUnit } from '../types';
import { ACE_IMAGES } from '../assets/config';

// 灾厄泰拉王牌单位库：固定属性与技能，不升级不穿装备，作为临时队友加入本次副本
// 直接编辑下方数据即可调整属性与技能倍率
export const ACE_UNITS: AceUnit[] = [
  // ============ 史诗 ============
  {
    id: 'ace_fangyuan',
    name: '超级方源大猩猩',
    rarity: 'epic',
    icon: ACE_IMAGES.ace_fangyuan,
    stats: { hp: 600, mp: 100, atk: 130, def: 60, mres: 30, spdMin: 6, spdMax: 11 },
    skills: [
      { name: '五湖四海皆兄弟', kind: 'passive', desc: '敌方优先不会选取方源为攻击对象。', untargetable: true },
      { name: '永别了，我的兄弟', kind: 'active', mpCost: 20, desc: '造成160%攻击力的物理伤害，并附加目标最大生命值5%的真实伤害。',
        dmgPct: 1.6, dmgType: 'phys', target: 'single', maxHpTrueDmgPct: 0.05 },
    ],
  },
  {
    id: 'ace_judianfu',
    name: '句点夫',
    rarity: 'epic',
    icon: ACE_IMAGES.ace_judianfu,
    stats: { hp: 500, mp: 90, atk: 150, def: 40, mres: 20, spdMin: 2, spdMax: 7 },
    skills: [
      { name: '补枪', kind: 'passive', desc: '对低于50%HP的敌人造成的伤害提升50%。',
        lowHpDmgAmp: { threshold: 0.5, amp: 0.5 } },
      { name: '工艺粉碎弹', kind: 'active', mpCost: 30, desc: '造成400%攻击力的物理伤害（每场战斗仅可使用一次）。',
        dmgPct: 4.0, dmgType: 'phys', target: 'single', oncePerBattle: true },
    ],
  },
  {
    id: 'ace_moxuluo',
    name: '魔虚罗',
    rarity: 'epic',
    icon: ACE_IMAGES.ace_moxuluo,
    stats: { hp: 800, mp: 100, atk: 120, def: 70, mres: 30, spdMin: 7, spdMax: 12 },
    skills: [
      { name: '适应', kind: 'passive', desc: '每次被攻击根据伤害类型获得10%对应减伤（各减伤上限80%）。',
        dmgRedOnHit: 0.1 },
      { name: '除魔之刃', kind: 'active', mpCost: 10, desc: '造成300点真实伤害。',
        dmgType: 'true', target: 'single', trueDmgFlat: 300 },
    ],
  },
  {
    id: 'ace_jiahao',
    name: '嘉豪',
    rarity: 'epic',
    icon: ACE_IMAGES.ace_jiahao,
    stats: { hp: 500, mp: 60, atk: 100, def: 70, mres: 40, spdMin: 1, spdMax: 1 },
    skills: [
      { name: '狮身人面像', kind: 'passive', desc: '单体伤害优先以自身为攻击对象，每次受到攻击防御+10、法抗+5（防御上限+20、法抗上限+10）。',
        taunt: true, defUpOnHit: { def: 10, mres: 5, defCap: 2, mresCap: 2 } },
      { name: '雨中漫步', kind: 'active', mpCost: 20, desc: '给予自身3层强度1的再生。',
        applyBuff: { id: 'regen', stacks: 3, intensity: 1 } },
    ],
  },
  // ============ 稀有 ============
  {
    id: 'ace_thunderbird',
    name: '雷鸟',
    rarity: 'rare',
    icon: ACE_IMAGES.ace_thunderbird,
    stats: { hp: 550, mp: 100, atk: 120, def: 50, mres: 30, spdMin: 5, spdMax: 9 },
    skills: [
      { name: '闪电', kind: 'passive', desc: '普攻造成攻击力120%的法术伤害。',
        basicAttack: { dmgPct: 1.2, dmgType: 'magic' } },
      { name: '雷击', kind: 'active', mpCost: 20, desc: '造成群体120%的法术伤害。',
        dmgPct: 1.2, dmgType: 'magic', target: 'all' },
    ],
  },
  {
    id: 'ace_huangleilong',
    name: '煌雷龙',
    rarity: 'rare',
    icon: ACE_IMAGES.ace_huangleilong,
    stats: { hp: 700, mp: 100, atk: 140, def: 55, mres: 40, spdMin: 10, spdMax: 13 },
    skills: [
      { name: '重爪击', kind: 'active', mpCost: 10, desc: '造成单体200%攻击力的物理伤害。',
        dmgPct: 2.0, dmgType: 'phys', target: 'single' },
      { name: '蓄能炮', kind: 'active', mpCost: 20, desc: '蓄力一回合，下回合行动时对敌方全体造成220%的法术伤害。',
        dmgPct: 2.2, dmgType: 'magic', target: 'all', chargeTurns: 1 },
    ],
  },
  {
    id: 'ace_super_warrior',
    name: '超级战士',
    rarity: 'rare',
    icon: ACE_IMAGES.ace_super_warrior,
    stats: { hp: 600, mp: 80, atk: 120, def: 60, mres: 10, spdMin: 6, spdMax: 9 },
    skills: [
      { name: '超级强力击', kind: 'active', mpCost: 10, desc: '造成单体200%攻击力的物理伤害。',
        dmgPct: 2.0, dmgType: 'phys', target: 'single' },
      { name: '超级护盾', kind: 'active', mpCost: 10, desc: '自身获得100点护盾。',
        shield: 100 },
    ],
  },
  {
    id: 'ace_daniya',
    name: '达尼娅',
    rarity: 'rare',
    icon: ACE_IMAGES.ace_daniya,
    stats: { hp: 500, mp: 100, atk: 100, def: 50, mres: 30, spdMin: 5, spdMax: 8 },
    skills: [
      { name: '泡影视阈', kind: 'passive', desc: '敌方聚爆层数上限+5，回合末敌方全体获得当前回合数的聚爆层数。',
        implosionCapBonus: 5, implosionTurnEnd: true },
      { name: '天衣无缝', kind: 'active', mpCost: 10, desc: '造成50%群体的法术伤害并施加5层聚爆。',
        dmgPct: 0.5, dmgType: 'magic', target: 'all', applyBuff: { id: 'implosion', stacks: 5, intensity: 1 } },
    ],
  },
  {
    id: 'ace_wangyuan',
    name: '王源',
    rarity: 'rare',
    icon: ACE_IMAGES.ace_wangyuan,
    stats: { hp: 600, mp: 90, atk: 100, def: 80, mres: 20, spdMin: 5, spdMax: 8 },
    skills: [
      { name: '水牛', kind: 'active', mpCost: 10, desc: '造成200%攻击力的法术伤害，并获得50点护盾。',
        dmgPct: 2.0, dmgType: 'magic', target: 'single', shield: 50 },
      { name: '吸烟', kind: 'active', mpCost: 10, desc: '获得80点护盾，提升5点法抗、10点防御力（上限+10法抗、+20防御）。',
        shield: 80, statUp: { def: 10, mres: 5, defCap: 20, mresCap: 10 } },
    ],
  },
  {
    id: 'ace_dingzhen',
    name: '丁真',
    rarity: 'rare',
    icon: ACE_IMAGES.ace_dingzhen,
    stats: { hp: 400, mp: 80, atk: 130, def: 80, mres: 20, spdMin: 7, spdMax: 8 },
    skills: [
      { name: '雪豹', kind: 'active', mpCost: 10, desc: '造成150%攻击力的物理伤害，使除自身以外的随机1名队友获得50点护盾。',
        dmgPct: 1.5, dmgType: 'phys', target: 'single', allyShield: 50 },
      { name: '吸烟', kind: 'active', mpCost: 10, desc: '获得80点护盾，提升5点法抗、10点防御力（上限+10法抗、+20防御）。',
        shield: 80, statUp: { def: 10, mres: 5, defCap: 20, mresCap: 10 } },
    ],
  },
  {
    id: 'ace_maikou',
    name: '麦扣',
    rarity: 'rare',
    icon: ACE_IMAGES.ace_maikou,
    stats: { hp: 600, mp: 90, atk: 150, def: 70, mres: 20, spdMin: 6, spdMax: 8 },
    skills: [
      { name: '嗷!', kind: 'active', mpCost: 10, desc: '造成150%攻击力的群体法术伤害。',
        dmgPct: 1.5, dmgType: 'magic', target: 'all' },
      { name: 'heehee', kind: 'active', mpCost: 30, desc: '为自身提供已损生命值的护盾。',
        shieldMissingHp: true },
    ],
  },
  {
    id: 'ace_dagou',
    name: '大狗',
    rarity: 'rare',
    icon: ACE_IMAGES.ace_dagou,
    stats: { hp: 500, mp: 70, atk: 100, def: 70, mres: 40, spdMin: 5, spdMax: 7 },
    skills: [
      { name: '嚼？', kind: 'active', mpCost: 10, desc: '造成单体150%物理伤害并给予2层强度1破甲。',
        dmgPct: 1.5, dmgType: 'phys', target: 'single', applyBuff: { id: 'armorBreak', stacks: 2, intensity: 1 } },
      { name: '叫！', kind: 'active', mpCost: 10, desc: '造成单体150%物理伤害并给予2层强度1虚弱。',
        dmgPct: 1.5, dmgType: 'phys', target: 'single', applyBuff: { id: 'weak', stacks: 2, intensity: 1 } },
    ],
  },
];

export const ACE_UNIT_MAP: Record<string, AceUnit> = Object.fromEntries(
  ACE_UNITS.map((u) => [u.id, u]),
);

// 按稀有度分组
export const ACE_UNITS_BY_RARITY: Record<'rare' | 'epic', AceUnit[]> = {
  rare: ACE_UNITS.filter((u) => u.rarity === 'rare'),
  epic: ACE_UNITS.filter((u) => u.rarity === 'epic'),
};
