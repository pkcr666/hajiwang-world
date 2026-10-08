import { describe, expect, it } from 'vitest';
import type { BaseStats, BattleState, Rng } from '../../types';
import { makeCombatant } from '../damage';
import { SK_CLAW, SK_HUFF } from '../../data/skills';
import {
  createBattle, enemyAct, getLegalActions, playerAct, resolveReaction,
} from '../battle';
import { tickBuffsEndOfTurn } from '../buffs';

// 确定性 RNG：int 一律取下限（目标选第一个、速度掷点取最小）
const rng: Rng = { int: (min: number) => min };

const catStats: BaseStats = {
  hp: 300, mp: 60, atk: 60, def: 10, mres: 0, spdMin: 2, spdMax: 3,
};
const foeStats: BaseStats = {
  hp: 200, mp: 0, atk: 40, def: 5, mres: 0, spdMin: 9, spdMax: 9,
};

// 猫速度2-3、敌速度9 → 敌方必定先手，顺位 [e1, a1]
function mkBattle(): BattleState {
  const cat = makeCombatant({
    uid: 'a1', name: '可爱小猫', stats: catStats, skills: [SK_HUFF, SK_CLAW],
  });
  const foe = makeCombatant({
    uid: 'e1', side: 'enemy', name: '史莱姆', stats: foeStats,
  });
  return createBattle([cat], [foe], rng);
}

const damageAmount = (s: BattleState): number => {
  const dmg = s.log.filter((e) => e.t === 'damage');
  return dmg[dmg.length - 1]!.amount as number;
};

describe('哈气 · 受击前反应技能', () => {
  it('选择不哈气：不扣蓝、不加减益，按满攻受伤', () => {
    const rr = resolveReaction(enemyAct(mkBattle(), rng).state, false);
    const cat = rr.state.allies[0]!;
    expect(cat.mp).toBe(60);
    expect(rr.state.enemies[0]!.buffs).toEqual([]);
    // 满攻40 - 防10 = 30
    expect(damageAmount(rr.state)).toBe(30);
    expect(cat.hp).toBe(270);
  });

  it('MP不足5点时不弹窗，敌方直接完成攻击', () => {
    const s = mkBattle();
    s.allies[0]!.mp = 4;
    const er = enemyAct(s, rng);
    expect(er.state.pendingReaction).toBeUndefined();
    expect(er.state.allies[0]!.hp).toBe(270);
  });

  it('哈气是永久减益：回合末不衰减、不移除', () => {
    let s = resolveReaction(enemyAct(mkBattle(), rng).state, true).state;
    s = resolveReaction(enemyAct(s, rng).state, true).state;
    const foe = s.enemies[0]!;
    expect(foe.buffs[0]!.stacks).toBe(2);
    // 多个回合末结算后仍保持2层
    expect(tickBuffsEndOfTurn(foe)).toEqual([]);
    expect(tickBuffsEndOfTurn(foe)).toEqual([]);
    expect(foe.buffs).toContainEqual(
      expect.objectContaining({ id: 'huff', stacks: 2, intensity: 0 }),
    );
  });
});

describe('爪击 · 主动技能', () => {
  it('行动菜单只显示主动技能（哈气不进菜单）', () => {
    const s = mkBattle();
    s.cursor = s.order.indexOf('a1');
    const legal = getLegalActions(s, new Map());
    expect(legal.skills.map((ls) => ls.skill.id)).toEqual(['sk_claw']);
  });

  it('耗10MP造成攻击力150%的单体物理伤害', () => {
    const s = mkBattle();
    s.cursor = s.order.indexOf('a1');
    const r = playerAct(s, { type: 'skill', skillId: 'sk_claw', targetUid: 'e1' }, new Map());
    const cat = r.state.allies[0]!;
    const foe = r.state.enemies[0]!;
    expect(cat.mp).toBe(50);
    // 60×1.5=90，减防5 → 85
    expect(damageAmount(r.state)).toBe(85);
    expect(foe.hp).toBe(115);
  });
});
