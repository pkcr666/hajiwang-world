import type { BattleState, Combatant, Rng } from '../types';

export type EnemyDecision =
  | { type: 'attack'; targetUid: string }
  | { type: 'skill'; skillId: string; targetUid?: string };

// 纯决策：basic 永远普攻；caster/boss 按技能列表顺序取第一个冷却已转好的技能，否则普攻。
export function decideEnemy(s: BattleState, self: Combatant, rng: Rng): EnemyDecision {
  const aliveAllies = s.allies.filter((u) => u.alive);
  const pickTarget = (): string => {
    // 嘲讽：优先攻击带嘲讽的单位
    const taunters = aliveAllies.filter((u) => u.aceTaunt);
    if (taunters.length > 0) return taunters[rng.int(0, taunters.length - 1)].uid;
    // 不可选：排除带 untargetable 的单位（除非全部不可选）
    const selectable = aliveAllies.filter((u) => !u.aceUntargetable);
    const pool = selectable.length > 0 ? selectable : aliveAllies;
    // 目标偏好
    if (self.aiPriority && pool.length > 0) {
      if (self.aiPriority === 'mostBleed') {
        let best = pool[0];
        let bestStacks = best.buffs.find((b) => b.id === 'bleed')?.stacks ?? 0;
        for (const cand of pool) {
          const st = cand.buffs.find((b) => b.id === 'bleed')?.stacks ?? 0;
          if (st > bestStacks) { best = cand; bestStacks = st; }
        }
        return best.uid;
      }
      if (self.aiPriority === 'fastest') {
        let best = pool[0];
        let bestSpd = best.stats.spdMax;
        for (const cand of pool) {
          if (cand.stats.spdMax > bestSpd) { best = cand; bestSpd = cand.stats.spdMax; }
        }
        return best.uid;
      }
      if (self.aiPriority === 'lowestHp') {
        let best = pool[0];
        for (const cand of pool) {
          if (cand.hp < best.hp) best = cand;
        }
        return best.uid;
      }
    }
    return pool[rng.int(0, Math.max(0, pool.length - 1))].uid;
  };

  if (self.ai === 'basic' || self.skills.length === 0) {
    return { type: 'attack', targetUid: pickTarget() };
  }
  const ready = self.skills.find(
    (sk) => (self.cooldowns[sk.id] ?? 0) <= 0 && (!sk.evenTurnOnly || s.turn % 2 === 0),
  );
  if (!ready) return { type: 'attack', targetUid: pickTarget() };
  if (ready.target === 'enemyAll') return { type: 'skill', skillId: ready.id };
  return { type: 'skill', skillId: ready.id, targetUid: pickTarget() };
}
