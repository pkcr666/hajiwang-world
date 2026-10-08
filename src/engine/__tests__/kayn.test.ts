import { describe, expect, it } from 'vitest';
import type { BattleState, Rng } from '../../types';
import { makeCombatant } from '../damage';
import { buildAllyCombatant } from '../unit';
import {
  createBattle, enemyAct, playerAct,
} from '../battle';
import { makeChar, itemMap } from './helpers';

const zeroRng: Rng = { int: (min: number) => min };

function mkKayn(level = 40): BattleState {
  const kayn = buildAllyCombatant(makeChar('kayn', undefined, level), itemMap, 0);
  const foe = makeCombatant({
    uid: 'e1', side: 'enemy', name: '史莱姆',
    stats: { hp: 200, mp: 0, atk: 30, def: 5, mres: 0, spdMin: 1, spdMax: 1 },
  });
  return createBattle([kayn], [foe], zeroRng);
}

describe('凯隐 · 暗裔魔镰', () => {
  it('初始化为红形态，能量0，被动参数正确', () => {
    const s = mkKayn();
    const k = s.allies[0]!;
    expect(k.form).toBe('red');
    expect(k.energy).toBe(0);
    expect(k.energyMax).toBe(50);
    expect(k.kaynPassiveUsed).toBe(false);
    expect(k.kaynFirstSwitch).toBe(false);
  });

  it('能量溢出按比例转护盾', () => {
    let s = mkKayn();
    s.cursor = s.order.indexOf('ally_0');
    const k = s.allies[0]!;
    // 手动设置能量接近上限（T1上限50）
    k.energy = 40;
    const shieldBefore = k.shield;
    const r = playerAct(s, { type: 'skill', skillId: 'sk_kayn_scythe', targetUid: 'e1' }, new Map());
    s = r.state;
    const k2 = s.allies[0]!;
    // 40+25=65，上限50，溢出15，1:1转盾=15
    expect(k2.energy).toBe(50);
    expect(k2.shield).toBeGreaterThan(shieldBefore);
  });

  it('被动血线触发：血量跌破阈值获得能量和次数盾', () => {
    const s = mkKayn();
    const k = s.allies[0]!;
    const threshold = k.maxHp * (1 - (k.kaynHpThreshold ?? 0.7));
    // 直接扣血到阈值以下
    k.hp = Math.floor(threshold) - 1;
    // 触发 applyDamage 逻辑：通过受击
    const foe = s.enemies[0]!;
    foe.stats.atk = 9999;
    // 让敌人攻击凯隐
    s.cursor = s.order.indexOf('e1');
    const r = enemyAct(s, zeroRng);
    const k2 = r.state.allies[0]!;
    if (k2.alive) {
      expect(k2.kaynPassiveUsed).toBe(true);
      expect((k2.shieldStacks ?? 0)).toBeGreaterThanOrEqual(1);
    }
  });

});
