import type { Combatant, Rng } from '../types';
import { mathRng } from '../types';
import { effSpd } from './buffs';

// 冥王破天的行动槽后缀：破天 / 冥王（速度独立计算）
const POTIAN_SLOT = '#potian';
const MINGWANG_SLOT = '#mingwang';
// 肉山的双行动槽后缀：行动1 / 行动2（每槽各执行一个随机行动，速度一致）
const ROUSHAN_ACT1 = '#act1';
const ROUSHAN_ACT2 = '#act2';

// 回合开始：每个存活单位掷速度点 + 1~1000 同速判定；就地写回 roll/tieBreak，返回顺位 uid 列表。
// 冥王破天（monsterId === 'mingwangPotian' 或 'ct_076' 全开冥王破天）会生成两个顺位条目，
// 分别对应破天与冥王行动槽，速度独立掷点。
// 肉山（ct_068）会生成两个顺位条目，分别对应行动1/行动2，每回合分两次行动。
// rollsOut 若提供，则按「带后缀的 uid」记录每个顺位条目的独立掷点（用于双槽单位显示）。
export function rollOrder(units: Combatant[], rng: Rng = mathRng, rollsOut?: Record<string, number>): string[] {
  const alive = units.filter((u) => u.alive);
  // 展开多行动槽单位
  const entries: { uid: string; unit: Combatant; spdMin: number; spdMax: number }[] = [];
  for (const u of alive) {
    if (u.monsterId === 'mingwangPotian' || u.monsterId === 'ct_076') {
      // 破天槽：速度由 potianSpd 决定（受击加速）
      const potianSpd = u.crisis?.mingwang?.potianSpd ?? 1;
      entries.push({ uid: u.uid + POTIAN_SLOT, unit: u, spdMin: potianSpd, spdMax: potianSpd });
      // 冥王槽：使用单位自身速度区间
      const spd = effSpd(u);
      entries.push({ uid: u.uid + MINGWANG_SLOT, unit: u, spdMin: spd.min, spdMax: spd.max });
    } else if (u.monsterId === 'ct_068') {
      // 肉山双行动槽：两个槽位速度一致（基础6，每回合末+2）
      const spd = effSpd(u);
      entries.push({ uid: u.uid + ROUSHAN_ACT1, unit: u, spdMin: spd.min, spdMax: spd.max });
      entries.push({ uid: u.uid + ROUSHAN_ACT2, unit: u, spdMin: spd.min, spdMax: spd.max });
    } else {
      const spd = effSpd(u);
      entries.push({ uid: u.uid, unit: u, spdMin: spd.min, spdMax: spd.max });
    }
  }
  // 每个条目独立掷点；对单槽单位同步写回 unit.roll（兼容现有逻辑）
  for (const e of entries) {
    const roll = rng.int(e.spdMin, e.spdMax);
    const tie = rng.int(1, 1000);
    if (rollsOut) rollsOut[e.uid] = roll;
    // 单槽单位或最后处理的槽写回 unit（双槽单位用 rollsOut 区分）
    e.unit.roll = roll;
    e.unit.tieBreak = tie;
  }
  // 极端情况下速度点与同速判定都相同：再掷一次最终随机值（按 uid 区分）
  const finalTie = new Map<string, number>(entries.map((e) => [e.uid, rng.int(1, 1_000_000)]));
  return [...entries]
    .sort(
      (a, b) =>
        (rollsOut ? (rollsOut[b.uid] - rollsOut[a.uid]) : (b.unit.roll! - a.unit.roll!)) ||
        (b.unit.tieBreak! - a.unit.tieBreak!) ||
        (finalTie.get(b.uid)! - finalTie.get(a.uid)!),
    )
    .map((e) => e.uid);
}

// 从顺位条目中剥离行动槽后缀，返回真实 uid
export function stripSlotUid(uid: string): string {
  return uid.replace(POTIAN_SLOT, '').replace(MINGWANG_SLOT, '').replace(ROUSHAN_ACT1, '').replace(ROUSHAN_ACT2, '');
}

// 获取当前顺位条目的行动槽（'potian' | 'mingwang' | 'act1' | 'act2' | null）
export function slotOf(uid: string): 'potian' | 'mingwang' | 'act1' | 'act2' | null {
  if (uid.endsWith(POTIAN_SLOT)) return 'potian';
  if (uid.endsWith(MINGWANG_SLOT)) return 'mingwang';
  if (uid.endsWith(ROUSHAN_ACT1)) return 'act1';
  if (uid.endsWith(ROUSHAN_ACT2)) return 'act2';
  return null;
}

