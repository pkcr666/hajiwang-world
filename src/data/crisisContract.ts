// 危机合约 S1 词条与计分数据

export interface CrisisStatEffect {
  hpBonus?: number;
  atkBonus?: number;
  defBonus?: number;
  mresBonus?: number;
  spdBonus?: number;
}

export interface CrisisTerm {
  id: string;
  name: string;
  desc: string;
  score: number;
  category: 'universal' | 'exclusive';
  // 作用关卡 id（exclusive 时填写），universal 留空
  stageId?: string;
  // 作用怪物 id（仅作用于特定怪物时填写），留空表示全体
  monsterId?: string;
  // 数值加成（可作用于全体或特定怪物）
  stat?: CrisisStatEffect;
  // 特殊效果标记（战斗引擎在 D 阶段解析）
  flag?: string;
  // 休息点恢复倍率（仅休息词条）
  restHealPct?: number;
  // 互斥组（同组只能选一个）
  mutexGroup?: string;
}

export const CRISIS_STAGE_BASE_SCORE: Record<string, number> = {
  cc_s1_1: 150,
  cc_s1_2: 180,
  cc_s1_3: 200,
  cc_s1_4: 250,
  cc_s1_5: 300,
};

export const CRISIS_STAGE_ORDER = [
  'cc_s1_1',
  'cc_s1_2',
  'cc_s1_3',
  'cc_s1_4',
  'cc_s1_5',
];

// 固定节点序列：战1-战2-休1-战3-休2-战4-休3-战5
export const CRISIS_NODE_LAYOUT: Array<
  | { type: 'combat'; stageId: string }
  | { type: 'rest'; restIndex: number }
> = [
  { type: 'combat', stageId: 'cc_s1_1' },
  { type: 'combat', stageId: 'cc_s1_2' },
  { type: 'rest', restIndex: 0 },
  { type: 'combat', stageId: 'cc_s1_3' },
  { type: 'rest', restIndex: 1 },
  { type: 'combat', stageId: 'cc_s1_4' },
  { type: 'rest', restIndex: 2 },
  { type: 'combat', stageId: 'cc_s1_5' },
];

export const CRISIS_TERMS: CrisisTerm[] = [
  // ========== 通用词条 ==========
  { id: 'u_hp100', name: '敌方HP+100', desc: '所有敌方最大生命值+100', score: 20, category: 'universal', stat: { hpBonus: 100 } },
  { id: 'u_hp200', name: '敌方HP+200', desc: '所有敌方最大生命值+200', score: 40, category: 'universal', stat: { hpBonus: 200 } },
  { id: 'u_hp300', name: '敌方HP+300', desc: '所有敌方最大生命值+300', score: 60, category: 'universal', stat: { hpBonus: 300 } },

  { id: 'u_atk20', name: '敌方攻击+20', desc: '所有敌方攻击力+20', score: 20, category: 'universal', stat: { atkBonus: 20 } },
  { id: 'u_atk40', name: '敌方攻击+40', desc: '所有敌方攻击力+40', score: 40, category: 'universal', stat: { atkBonus: 40 } },
  { id: 'u_atk60', name: '敌方攻击+60', desc: '所有敌方攻击力+60', score: 60, category: 'universal', stat: { atkBonus: 60 } },

  { id: 'u_def10', name: '敌方防御+10', desc: '所有敌方防御力+10', score: 20, category: 'universal', stat: { defBonus: 10 } },
  { id: 'u_def20', name: '敌方防御+20', desc: '所有敌方防御力+20', score: 40, category: 'universal', stat: { defBonus: 20 } },
  { id: 'u_def30', name: '敌方防御+30', desc: '所有敌方防御力+30', score: 60, category: 'universal', stat: { defBonus: 30 } },

  { id: 'u_mres10', name: '敌方法抗+10', desc: '所有敌方法术抗性+10', score: 20, category: 'universal', stat: { mresBonus: 10 } },
  { id: 'u_mres20', name: '敌方法抗+20', desc: '所有敌方法术抗性+20', score: 40, category: 'universal', stat: { mresBonus: 20 } },
  { id: 'u_mres30', name: '敌方法抗+30', desc: '所有敌方法术抗性+30', score: 60, category: 'universal', stat: { mresBonus: 30 } },

  { id: 'u_spd1', name: '敌方速度+1', desc: '所有敌方速度+1', score: 20, category: 'universal', stat: { spdBonus: 1 } },
  { id: 'u_spd2', name: '敌方速度+2', desc: '所有敌方速度+2', score: 40, category: 'universal', stat: { spdBonus: 2 } },
  { id: 'u_spd3', name: '敌方速度+3', desc: '所有敌方速度+3', score: 60, category: 'universal', stat: { spdBonus: 3 } },

  { id: 'u_rest30', name: '休息恢复30%', desc: '休息点恢复从50%降为30%', score: 60, category: 'universal', restHealPct: 0.3, mutexGroup: 'restHeal' },
  { id: 'u_rest10', name: '休息恢复10%', desc: '休息点恢复从50%降为10%', score: 100, category: 'universal', restHealPct: 0.1, mutexGroup: 'restHeal' },

  // ========== 作战1 专属 ==========
  { id: 'e1_disable', name: '组长能力失效', desc: '狂暴宿主组长每回合扣血能力失效', score: 50, category: 'exclusive', stageId: 'cc_s1_1', monsterId: 'berserkerLeader', flag: 'disableBurn' },
  { id: 'e1_spd5', name: '组长速度+5', desc: '狂暴宿主组长速度+5', score: 40, category: 'exclusive', stageId: 'cc_s1_1', monsterId: 'berserkerLeader', stat: { spdBonus: 5 } },
  { id: 'e1_atk50', name: '组长攻击+50', desc: '狂暴宿主组长攻击力+50', score: 50, category: 'exclusive', stageId: 'cc_s1_1', monsterId: 'berserkerLeader', stat: { atkBonus: 50 } },

  // ========== 作战2 专属 ==========
  { id: 'e2_shuHp600', name: '鼠鼠HP+600', desc: '鼠鼠最大生命值+600', score: 60, category: 'exclusive', stageId: 'cc_s1_2', monsterId: 'shuShu', stat: { hpBonus: 600 } },
  { id: 'e2_gouStart', name: '挂狗能力初始触发', desc: '挂狗能力从战斗开始就触发', score: 60, category: 'exclusive', stageId: 'cc_s1_2', monsterId: 'gouDog', flag: 'gouStartTriggered' },

  // ========== 作战3 专属 ==========
  { id: 'e3_jackAtkUp', name: '杰克每回合攻击+10', desc: '畸变杰克每回合攻击力+10（无上限）', score: 50, category: 'exclusive', stageId: 'cc_s1_3', monsterId: 'distortedJack', flag: 'jackAtkPerTurn' },
  { id: 'e3_jackDouble', name: '杰克两段攻击', desc: '杰克攻击变为两段80%攻击力的自适应伤害', score: 50, category: 'exclusive', stageId: 'cc_s1_3', monsterId: 'distortedJack', flag: 'jackDoubleStrike' },

  // ========== 作战4 专属 ==========
  { id: 'e4_shield20', name: '护盾变为20', desc: '冥王破天获得的护盾变为20', score: 50, category: 'exclusive', stageId: 'cc_s1_4', monsterId: 'mingwangPotian', flag: 'shieldValue20' },
  { id: 'e4_potianSpd5', name: '破天基础速度5', desc: '破天基础速度变为5', score: 50, category: 'exclusive', stageId: 'cc_s1_4', monsterId: 'mingwangPotian', flag: 'potianBaseSpd5' },

  // ========== 作战5 专属 ==========
  { id: 'e5_needle4', name: '开局葬花针4层', desc: '应龙开局葬花针变为4层', score: 60, category: 'exclusive', stageId: 'cc_s1_5', monsterId: 'yingLong', flag: 'needleStart4' },
  { id: 'e5_luolei500', name: '落雷HP500', desc: '落雷HP变为500', score: 40, category: 'exclusive', stageId: 'cc_s1_5', monsterId: 'yingLong', flag: 'luoleiHp500' },
];

export const CRISIS_REST_BUFFS: Array<{
  restIndex: number;
  options: Array<{
    id: string;
    name: string;
    desc: string;
    apply: string; // 标识，由引擎解析
  }>;
}> = [
  {
    restIndex: 0,
    options: [
      { id: 'r0_atk10', name: '攻击力+10%', desc: '攻击力+10%', apply: 'cc_r0_atk10' },
      { id: 'r0_def10', name: '防御力+10%', desc: '防御力+10%', apply: 'cc_r0_def10' },
      { id: 'r0_mres10', name: '法抗+10', desc: '法术抗性+10', apply: 'cc_r0_mres10' },
      { id: 'r0_hp10', name: '最大生命+10%', desc: '最大生命值+10%', apply: 'cc_r0_hp10' },
    ],
  },
  {
    restIndex: 1,
    options: [
      { id: 'r1_str20', name: '力量+20', desc: '力量+20', apply: 'cc_r1_str20' },
      { id: 'r1_int20', name: '智力+20', desc: '智力+20', apply: 'cc_r1_int20' },
      { id: 'r1_agi20', name: '敏捷+20', desc: '敏捷+20', apply: 'cc_r1_agi20' },
      { id: 'r1_will20', name: '意志+20', desc: '意志+20', apply: 'cc_r1_will20' },
      { id: 'r1_luk20', name: '幸运+20', desc: '幸运+20', apply: 'cc_r1_luk20' },
      { id: 'r1_cha20', name: '魅力+20', desc: '魅力+20', apply: 'cc_r1_cha20' },
    ],
  },
  {
    restIndex: 2,
    options: [
      { id: 'r2_phys30', name: '物理伤害+30%', desc: '物理伤害+30%', apply: 'cc_r2_phys30' },
      { id: 'r2_magic30', name: '法术伤害+30%', desc: '法术伤害+30%', apply: 'cc_r2_magic30' },
      { id: 'r2_dr30', name: '减伤+30%', desc: '受到伤害-30%', apply: 'cc_r2_dr30' },
    ],
  },
];

/** 计算选中词条总分 */
export function calcCrisisScore(termIds: string[]): number {
  return termIds
    .map(id => CRISIS_TERMS.find(t => t.id === id)?.score ?? 0)
    .reduce((a, b) => a + b, 0);
}

/** 计算基础分（所有关卡基础分之和） */
export function calcCrisisBaseScore(): number {
  return Object.values(CRISIS_STAGE_BASE_SCORE).reduce((a, b) => a + b, 0);
}

/** 获取选中词条下的总分（假设全部通关）：每关基础分 + 通用词条加成×关数 + 各关专属词条分 */
export function calcCrisisTotalScore(termIds: string[]): number {
  const universalBonus = termIds
    .map((id) => CRISIS_TERMS.find((t) => t.id === id))
    .filter((t): t is CrisisTerm => !!t && t.category === 'universal')
    .reduce((s, t) => s + t.score, 0);
  const exclusiveSum = termIds
    .map((id) => CRISIS_TERMS.find((t) => t.id === id))
    .filter((t): t is CrisisTerm => !!t && t.category === 'exclusive')
    .reduce((s, t) => s + t.score, 0);
  const stageCount = Object.keys(CRISIS_STAGE_BASE_SCORE).length;
  return calcCrisisBaseScore() + universalBonus * stageCount + exclusiveSum;
}

import type { StageMechanic } from '../types';

/** 判断两个词条是否互斥 */
export function areTermsMutex(a: CrisisTerm, b: CrisisTerm): boolean {
  if (!a.mutexGroup || !b.mutexGroup) return false;
  return a.mutexGroup === b.mutexGroup && a.id !== b.id;
}

/**
 * 将选中的危机词条转换为关卡 mechanics（仅数值类词条；特殊 flag 类由战斗引擎在 D 阶段处理）。
 * stageId 为当前作战关卡 id，用于筛选该关专属词条。
 */
export function crisisTermsToMechanics(termIds: string[], stageId: string): StageMechanic[] {
  const mechs: StageMechanic[] = [];
  let k = 0;
  for (const id of termIds) {
    const t = CRISIS_TERMS.find((x) => x.id === id);
    if (!t || !t.stat) continue;
    // 专属词条只作用于对应关卡
    if (t.category === 'exclusive' && t.stageId !== stageId) continue;
    const scope = t.monsterId ? 'monster' : 'all';
    const mech: StageMechanic = {
      id: `cc_mech_${k++}`,
      desc: t.name,
      scope,
      monsterId: t.monsterId,
    };
    if (t.stat.hpBonus) mech.hp = t.stat.hpBonus;
    if (t.stat.atkBonus) mech.atk = t.stat.atkBonus;
    if (t.stat.defBonus) mech.def = t.stat.defBonus;
    if (t.stat.mresBonus) mech.mres = t.stat.mresBonus;
    if (t.stat.spdBonus) { mech.spdMin = t.stat.spdBonus; mech.spdMax = t.stat.spdBonus; }
    mechs.push(mech);
  }
  return mechs;
}

/** 获取选中的休息点恢复倍率（默认 0.5） */
export function crisisRestHealPct(termIds: string[]): number {
  const t = termIds
    .map((id) => CRISIS_TERMS.find((x) => x.id === id))
    .find((x) => x?.restHealPct !== undefined);
  return t?.restHealPct ?? 0.5;
}

/** 双人模式下调整怪物数量（作战1 狂暴宿主组长 2→3） */
export function adjustMonsterCountForDual(
  monsters: { monsterId: string; count: number }[],
  mode: 'single' | 'dual',
): { monsterId: string; count: number }[] {
  if (mode !== 'dual') return monsters;
  return monsters.map((m) => {
    if (m.monsterId === 'berserkerLeader') return { ...m, count: m.count + 1 };
    return m;
  });
}
