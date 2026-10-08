import type { Job, Slot, WeaponType } from '../types';
import type { ExtraStats } from '../types';

export interface JobDef {
  id: Job;
  name: string;
  desc: string;
  allowedWeaponTypes: WeaponType[];
  startItems: string[];
  skills: string[];
  tier?: 'legendary'; // 传奇品质职业（创建页显示传奇标记）
  defaultExtra?: ExtraStats; // 传奇职业默认加点（创建页无需手动分配）
}

export const JOB_DEFS: Record<Job, JobDef> = {
  cat: {
    id: 'cat', name: '小猫', desc: '传奇灵兽：受击前可哈气削弱敌人，爪击凌厉，可吸附援护队友。',
    allowedWeaponTypes: ['melee'],
    startItems: ['it_sword_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_huff', 'sk_claw', 'sk_absorb', 'sk_luck_corner'],
    tier: 'legendary',
    defaultExtra: { str: 10, int: 30, agi: 10, luk: 40, cha: 10, wil: 40 },
  },
  typhon: {
    id: 'typhon', name: '提丰', desc: '终末猎手：远程多段与贯穿压制，狩猎标记让猎物无处可逃。',
    allowedWeaponTypes: ['ranged'],
    startItems: ['it_bow_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_typhon_triple', 'sk_typhon_pierce', 'sk_typhon_recon', 'sk_typhon_hunt'],
    tier: 'legendary',
    defaultExtra: { str: 30, int: 10, agi: 30, luk: 30, cha: 30, wil: 10 },
  },
  kayn: {
    id: 'kayn', name: '凯隐', desc: '暗裔魔镰：红形态近战吸血、蓝形态法术群攻，能量与双形态切换为核心。',
    allowedWeaponTypes: ['melee'],
    startItems: ['it_sword_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_kayn_passive', 'sk_kayn_scythe', 'sk_kayn_step', 'sk_kayn_realm'],
    tier: 'legendary',
    defaultExtra: { str: 30, int: 20, agi: 40, wil: 10, luk: 20, cha: 20 },
  },
  logos: {
    id: 'logos', name: '逻各斯', desc: '终末言灵：魔法伤害与凋亡操控，殁亡斩杀连锁收割残血敌人。',
    allowedWeaponTypes: ['magic'],
    startItems: ['it_staff_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_logos_mort', 'sk_logos_metonymy', 'sk_logos_evolve', 'sk_logos_diffrance'],
    tier: 'legendary',
    defaultExtra: { str: 20, int: 40, agi: 10, wil: 20, luk: 30, cha: 20 },
  },
  dandan: {
    id: 'dandan', name: '氮氮', desc: '低温掌控者：以寒冷为核心，群体法术压制与消耗敌方效果连锁爆发。',
    allowedWeaponTypes: ['magic'],
    startItems: ['it_staff_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_dandan_dewar', 'sk_dandan_adhesion', 'sk_dandan_grenade', 'sk_dandan_condens'],
    tier: 'legendary',
    defaultExtra: { str: 10, int: 40, agi: 20, wil: 30, luk: 30, cha: 10 },
  },
  masked: {
    id: 'masked', name: '神秘面具男', desc: '时空间忍术大师：虚化闪避敌方攻击，以力量与速度驱动忍术，神威斩杀残血之敌。',
    allowedWeaponTypes: ['melee'],
    startItems: ['it_sword_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_masked_fireball', 'sk_masked_chain', 'sk_masked_kamui', 'sk_masked_exile'],
    tier: 'legendary',
    defaultExtra: { str: 30, int: 30, agi: 40, wil: 10, luk: 20, cha: 10 },
  },
  augusta: {
    id: 'augusta', name: '奥古斯塔', desc: '诸王的冠冕：以战势驱动强化，攻防一体的近战王者，低血量敌人的噩梦。',
    allowedWeaponTypes: ['melee'],
    startItems: ['it_sword_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_augusta_crown', 'sk_augusta_spear', 'sk_augusta_thunder', 'sk_augusta_force'],
    tier: 'legendary',
    defaultExtra: { str: 40, int: 10, agi: 30, wil: 30, luk: 20, cha: 10 },
  },
  lee: {
    id: 'lee', name: '小李', desc: '八门遁甲：以生命为代价爆发极致速度与力量，木叶印记标记敌人，莲华之技一击必杀。',
    allowedWeaponTypes: ['melee'],
    startItems: ['it_sword_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_lee_gates', 'sk_lee_wind', 'sk_lee_front_lotus', 'sk_lee_reverse_lotus'],
    tier: 'legendary',
    defaultExtra: { str: 40, int: 10, agi: 40, wil: 10, luk: 30, cha: 10 },
  },
  donk: {
    id: 'donk', name: 'DONK', desc: '世一步：以MP为燃料的爆发射手，MP耗尽时绝地反击；闪身步越打越快，魔王之力碾压弱者。',
    allowedWeaponTypes: ['ranged'],
    startItems: ['it_bow_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_donk_shiyi', 'sk_donk_shoot', 'sk_donk_dodger', 'sk_donk_demon'],
    tier: 'legendary',
    defaultExtra: { str: 40, int: 10, agi: 30, wil: 20, luk: 20, cha: 20 },
  },
  exusiai: {
    id: 'exusiai', name: '新约能天使', desc: '弹药专家：以弹药驱动攻击，行动前消耗弹药提升伤害，火力电台每10发弹药倾泻火力，使命必达为队友创造额外回合。',
    allowedWeaponTypes: ['ranged'],
    startItems: ['it_bow_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_exusiai_pact', 'sk_exusiai_addiction', 'sk_exusiai_radio', 'sk_exusiai_mission'],
    tier: 'legendary',
    defaultExtra: { str: 20, int: 20, agi: 30, wil: 10, luk: 40, cha: 20 },
  },
  eimis: {
    id: 'eimis', name: '爱弥斯', desc: '聚爆魔导：以聚爆层数引爆为核心，人/机甲形态切换叠加魅力与护盾，同步率提升聚爆上限与法穿，满同步率释放飞至启明之时清场。',
    allowedWeaponTypes: ['magic'],
    startItems: ['it_staff_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_eimis_star', 'sk_eimis_voyage', 'sk_eimis_shape', 'sk_eimis_dawn'],
    tier: 'legendary',
    defaultExtra: { str: 30, int: 10, agi: 20, wil: 10, luk: 30, cha: 40 },
  },
  rein: {
    id: 'rein', name: '里恩', desc: '神谕代行者：随机六维驱动三式一击，指令标与代行层数层层解放，假面之下是灼烧的伤口，Furioso 九连真伤终局一响。',
    allowedWeaponTypes: ['melee'],
    startItems: ['it_sword_wood', 'it_helmet_wood', 'it_armor_wood'],
    skills: ['sk_rein_variable', 'sk_rein_mask', 'sk_rein_oracle', 'sk_rein_furioso'],
    tier: 'legendary',
    defaultExtra: { str: 30, int: 20, agi: 30, wil: 20, luk: 20, cha: 20 },
  },
};

// 起始藏品对应的穿戴槽位
export const STARTER_SLOT: Record<string, Slot> = {
  it_sword_wood: 'weapon', it_bow_wood: 'weapon', it_staff_wood: 'weapon',
  it_helmet_wood: 'helmet', it_armor_wood: 'armor',
};

// 起始背包：本期无消耗品，背包为空
export const STARTER_BAG: { itemId: string; count: number }[] = [];
