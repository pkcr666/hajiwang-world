import type { Buff, BuffDef, BuffId, Combatant, DamageMods } from '../types';

// BUFF 图鉴：每种 BUFF 的基础定义
export const BUFF_LIBRARY: Record<BuffId, BuffDef> = {
  swift: {
    id: 'swift', name: '迅捷', positive: true,
    desc: '速度+1（强度决定效果，层数为剩余回合数）',
  },
  bind: {
    id: 'bind', name: '束缚', positive: false,
    desc: '速度-1（强度决定效果，层数为剩余回合数）',
  },
  strength: {
    id: 'strength', name: '强壮', positive: true,
    desc: '增加10%增伤（强度决定效果，层数为剩余回合数）',
  },
  protection: {
    id: 'protection', name: '护佑', positive: true,
    desc: '增加10%减伤（强度决定效果，层数为剩余回合数）',
  },
  armorBreak: {
    id: 'armorBreak', name: '破甲', positive: false,
    desc: '减少10%减伤（强度决定效果，层数为剩余回合数）',
  },
  weak: {
    id: 'weak', name: '虚弱', positive: false,
    desc: '减少10%增伤（强度决定效果，层数为剩余回合数）',
  },
  regen: {
    id: 'regen', name: '再生', positive: true,
    desc: '回合末恢复10HP（层数×强度 乘算）',
  },
  poison: {
    id: 'poison', name: '中毒', positive: false,
    desc: '回合末受到10点真实伤害（层数×强度 乘算）',
  },
  burn: {
    id: 'burn', name: '烧伤', positive: false,
    desc: '回合末受到当前生命值3%的真实伤害（层数×强度 乘算）',
  },
  bleed: {
    id: 'bleed', name: '流血', positive: false,
    desc: '回合末受到最大生命值3%的法术伤害（层数×强度 乘算）',
  },
  chill: {
    id: 'chill', name: '寒冷', positive: false,
    desc: '回合末受到20点法术伤害（层数×强度 乘算）',
  },
  apoptosis: {
    id: 'apoptosis', name: '凋亡', positive: false,
    desc: '达到3层时引爆，造成100%魔力上限×强度的固定伤害',
  },
  huff: {
    id: 'huff', name: '哈气', positive: false,
    desc: '每层使攻击来源攻防各-5%（百分比）并减去强度值（扁平），战斗内永久持续',
  },
  huntMark: {
    id: 'huntMark', name: '狩猎标记', positive: false,
    desc: '回合末受到施放者攻击力对应强度的物理伤害，永久持续（不随回合衰减）',
  },
  agiStrength: {
    id: 'agiStrength', name: '敏捷强度', positive: true,
    desc: '每层强度+1速度（凯隐蓝形态掠影步）',
  },
  worship: {
    id: 'worship', name: '膜拜', positive: true,
    desc: '防御与法抗减半（袁绍被膜拜两回合）',
  },
  konohaMark: {
    id: 'konohaMark', name: '木叶印记', positive: false,
    desc: '里莲华的伤害因子，永久持续（不随回合衰减）',
  },
  fireAddiction: {
    id: 'fireAddiction', name: '开火成瘾', positive: true,
    desc: '每次攻击额外消耗弹药（强度=额外消耗数），弹药不足时解除',
  },
  needle: {
    id: 'needle', name: '葬花针', positive: false,
    desc: '应龙的葬花针层数（每层攻击+10%、防御+10%、法抗+5，永久持续）',
  },
  potianSpd: {
    id: 'potianSpd', name: '破天速度', positive: true,
    desc: '冥王破天的当前破天速度（受击加速，永久持续）',
  },
  gouDog: {
    id: 'gouDog', name: '挂狗', positive: true,
    desc: '背水一战已触发：速度提升，攻击无视防御（永久持续）',
  },
  implosion: {
    id: 'implosion', name: '聚爆', positive: false,
    desc: '爱弥斯施加，达到层数上限时引爆造成层数×20%攻击力法术伤害，永久持续（不随回合衰减）',
  },
  plague: {
    id: 'plague', name: '瘟疫', positive: false,
    desc: '永久降低最大生命值，每层削减2%最大生命上限（层数可叠加，不随回合衰减）',
  },
  reinMask: {
    id: 'reinMask', name: '遮盖伤口的假面', positive: true,
    desc: '全能减伤（强度=减伤百分比小数，如0.10=10%），永久持续',
  },
  reinWound: {
    id: 'reinWound', name: '灼烧着的伤口', positive: true,
    desc: '全能减伤（强度=减伤百分比小数），速度+角色等级/10、攻击+角色等级，永久持续',
  },
  reinKarma: {
    id: 'reinKarma', name: '业', positive: false,
    desc: '每层防御力-10%（乘算）、法抗-5，上限5层，永久持续',
  },
  reinLiberation: {
    id: 'reinLiberation', name: '解放', positive: true,
    desc: '神谕代行者解放（强度=档位1/2/3，覆盖式），永久持续',
  },
  reinHeart: {
    id: 'reinHeart', name: '心-命运', positive: true,
    desc: '速度+X、一技能随机6维按最高值计算、每回合MP恢复，永久持续',
  },
};

// 永久 BUFF：不随回合末衰减
export const PERMANENT_BUFFS: ReadonlySet<BuffId> = new Set(['huff', 'huntMark', 'konohaMark', 'needle', 'potianSpd', 'gouDog', 'implosion', 'plague', 'reinMask', 'reinWound', 'reinKarma', 'reinLiberation', 'reinHeart']);

// 乘算 BUFF：效果 = 层数 × 强度 × 基础系数
// 非乘算 BUFF：效果 = 强度 × 基础系数（层数仅作剩余回合数）
export const MULTIPLICATIVE_BUFFS: ReadonlySet<BuffId> = new Set([
  'poison', 'burn', 'bleed', 'chill', 'regen', 'huff', 'plague',
]);

// 凋亡引爆层数
export const APOPTOSIS_TRIGGER_STACKS = 3;

// BUFF 效果系数（每层每强度 或 每强度，取决于是否乘算）
export const BUFF_SCALE: Record<BuffId, number> = {
  swift: 1,
  bind: 1,
  strength: 0.10,   // +10% 全能增伤
  protection: 0.10, // +10% 全能减伤
  armorBreak: 0.10, // -10% 全能减伤
  weak: 0.10,       // -10% 全能增伤
  regen: 10,        // 回10血（乘算）
  poison: 10,       // 10点真实伤害（乘算）
  burn: 0.03,       // 当前生命的3%真实伤害（乘算）
  bleed: 0.03,      // 最大生命的3%法术伤害（乘算）
  chill: 20,        // 20点法术伤害（乘算）
  apoptosis: 1,     // 引爆伤害系数（1 = 100% 最大MP × 强度）
  huff: 1,          // 每层强度攻防各减对应值（扁平值）
  huntMark: 1,      // 强度=施放者攻击力倍率
  agiStrength: 1,   // 每层强度+1速度
  worship: 1,       // 膜拜：防御与法抗减半
  konohaMark: 1,    // 木叶印记：层数即印记数
  fireAddiction: 1, // 开火成瘾：强度=每次攻击额外消耗弹药数
  needle: 1,        // 葬花针：层数即针数
  potianSpd: 1,     // 破天速度：层数即当前速度
  gouDog: 1,        // 挂狗：层数=1（标记型）
  implosion: 1,     // 聚爆：层数即聚爆层数
  plague: 0.02,     // 每层削减2%最大生命上限（永久，乘算层数）
  reinMask: 1,      // 假面：强度=减伤百分比小数
  reinWound: 1,     // 伤口：强度=减伤百分比小数
  reinKarma: 1,     // 业：层数即业层数（减防减抗在 effDefBuffed/calcDamage 处理）
  reinLiberation: 1, // 解放：强度=档位
  reinHeart: 1,     // 心-命运：标记型
};

// BUFF 效果值：乘算类 = stacks × intensity；非乘算类 = intensity（层数仅作回合数）
export const buffValue = (c: Combatant, id: BuffId): number => {
  const b = c.buffs.find((x) => x.id === id);
  if (!b) return 0;
  return MULTIPLICATIVE_BUFFS.has(id) ? b.stacks * b.intensity : b.intensity;
};

// 给目标添加/叠加 BUFF（同 ID 合并：层数相加）
// intensityMode: 'max'（默认）= 强度取新旧较大值；'add' = 强度在原有基础上叠加
// 凋亡特殊：叠加后若达到3层则立即引爆（由调用方处理引爆伤害）
export function addBuff(
  c: Combatant, id: BuffId, stacks: number, intensity: number, ownerUid?: string,
  intensityMode: 'max' | 'add' = 'max',
  caster?: Combatant,
): Buff {
  // 无敌状态：免疫所有BUFF（群体施加也不生效），含持续无敌与本回合无敌
  if (c.invincible || c.invincibleThisTurn) {
    return { id, stacks: 0, intensity: 0, ownerUid };
  }
  // 悬丝傀儡/精神治疗录像带：我方施加的所有buff层数+X（哈气为独立BUFF，只根据小猫自身技能叠层，不吃任何额外层数加成）
  if (caster?.buffStackBonus && id !== 'huff') stacks += caster.buffStackBonus;
  // 混乱初始：强度类buff强度+X且上限+X
  if (caster?.buffIntensityBonus) intensity += caster.buffIntensityBonus;
  const existing = c.buffs.find((b) => b.id === id);
  if (existing) {
    existing.stacks += stacks;
    existing.intensity = intensityMode === 'add'
      ? existing.intensity + intensity
      : Math.max(existing.intensity, intensity);
    if (ownerUid) existing.ownerUid = ownerUid;
    if (id === 'plague') applyPlagueMaxHp(c);
    return existing;
  }
  const b: Buff = { id, stacks, intensity, ownerUid };
  c.buffs.push(b);
  if (id === 'plague') applyPlagueMaxHp(c);
  return b;
}

// 瘟疫：按层数永久削减最大生命上限（每层 2%），并把当前生命压到新上限以内
export function applyPlagueMaxHp(c: Combatant): void {
  const base = c.baseMaxHp ?? c.maxHp;
  // buffValue 对乘算 buff = stacks × intensity；再乘 BUFF_SCALE.plague(0.02) 得到削减比例
  const down = buffValue(c, 'plague') * BUFF_SCALE.plague;
  const newMax = Math.max(1, Math.floor(base * (1 - down)));
  c.maxHp = newMax;
  if (c.hp > newMax) c.hp = newMax;
}

// 由 BUFF 计算 8 个增伤/减伤属性（百分比小数，0.1 = 10%）
export function computeDamageMods(c: Combatant): DamageMods {
  const str = buffValue(c, 'strength');
  const weak = buffValue(c, 'weak');
  const prot = buffValue(c, 'protection');
  const ab = buffValue(c, 'armorBreak');
  const rm = c.relicMods ?? {};
  const out: DamageMods = {
    allDmgAmp: (str - weak) * BUFF_SCALE.strength,
    trueDmgAmp: 0,
    physDmgAmp: 0,
    magicDmgAmp: 0,
    // 破甲抵扣全能减伤（含遗物减伤），可减为负转为增伤
    allDmgRed: (prot - ab) * BUFF_SCALE.protection,
    trueDmgRed: 0,
    physDmgRed: 0,
    magicDmgRed: 0,
  };
  // 遗物带来的增伤/减伤（战斗开局由 applyRelics 汇总写入）
  out.allDmgAmp += rm.allDmgAmp ?? 0;
  out.trueDmgAmp += rm.trueDmgAmp ?? 0;
  out.physDmgAmp += rm.physDmgAmp ?? 0;
  out.magicDmgAmp += rm.magicDmgAmp ?? 0;
  out.allDmgRed += rm.allDmgRed ?? 0;
  out.trueDmgRed += rm.trueDmgRed ?? 0;
  out.physDmgRed += rm.physDmgRed ?? 0;
  out.magicDmgRed += rm.magicDmgRed ?? 0;
  // 里恩：假面/伤口全能减伤（强度=减伤百分比小数）+ 解放III全能增伤
  out.allDmgRed += buffValue(c, 'reinMask') + buffValue(c, 'reinWound');
  out.allDmgAmp += c.reinLiberationAmp ?? 0;
  // 奶蛙的肚皮：存在护盾时伤害+X%
  if (c.shieldDmgAmp && c.shield > 0) out.allDmgAmp += c.shieldDmgAmp;
  // 王牌单位「适应」：受击积累的对应类型减伤
  if (c.aceDmgRedOnHit) {
    out.physDmgRed += c.aceDmgRedOnHit.phys;
    out.magicDmgRed += c.aceDmgRedOnHit.magic;
  }
  return out;
}

// 有效防御（破甲已改为削减全能减伤，不再影响防御；哈气=百分比-5%/层 + 扁平强度值/层）
export function effDefBuffed(c: Combatant): number {
  const huffB = c.buffs.find((b) => b.id === 'huff');
  const huffStacks = huffB?.stacks ?? 0;
  const huffPct = huffStacks * 0.05; // 每层攻防-5%
  const huffFlat = buffValue(c, 'huff') * BUFF_SCALE.huff; // 每层扁平-强度值
  let def = Math.max(0, c.stats.def * (1 + c.statuses.defModPct / 100) * (1 - huffPct) - huffFlat);
  // 里恩「业」：每层防御力-10%（乘算）
  const karma = c.buffs.find((b) => b.id === 'reinKarma')?.stacks ?? 0;
  if (karma > 0) def *= 1 - karma * 0.1;
  // 膜拜：防御减半（袁绍抉择）
  if (buffValue(c, 'worship') > 0) return Math.floor(def * 0.5);
  return def;
}

// 有效速度区间（含迅捷/束缚 BUFF）
export function effSpd(c: Combatant): { min: number; max: number } {
  const swift = buffValue(c, 'swift');
  const bind = buffValue(c, 'bind');
  const agiStr = buffValue(c, 'agiStrength');
  const delta = swift - bind + agiStr;
  return {
    min: Math.max(0, c.stats.spdMin + delta),
    max: Math.max(0, c.stats.spdMax + delta),
  };
}

// 回合末：BUFF 层数 -1，移除过期；永久 BUFF 跳过；返回被移除的 BUFF id 列表
export function tickBuffsEndOfTurn(c: Combatant): BuffId[] {
  const removed: BuffId[] = [];
  for (let i = c.buffs.length - 1; i >= 0; i--) {
    if (PERMANENT_BUFFS.has(c.buffs[i].id)) continue;
    c.buffs[i].stacks -= 1;
    if (c.buffs[i].stacks <= 0) {
      removed.push(c.buffs[i].id);
      c.buffs.splice(i, 1);
    }
  }
  return removed;
}
