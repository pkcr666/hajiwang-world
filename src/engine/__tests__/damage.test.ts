import { describe, expect, it } from 'vitest';
import { absorb, applyShield, calcDamage, makeCombatant } from '../damage';

const atk = (atk: number) => makeCombatant({ uid: 'a', name: '攻', stats: { hp: 100, mp: 0, atk, def: 0, mres: 0, spdMin: 2, spdMax: 5 } });
const def = (def: number, mres = 0) =>
  makeCombatant({ uid: 'd', name: '守', side: 'enemy', stats: { hp: 200, mp: 0, atk: 0, def, mres, spdMin: 2, spdMax: 5 } });

describe('calcDamage', () => {
  it('物理 = 攻击×倍率 - 防御', () => {
    expect(calcDamage(atk(30), def(10), 1.5, 'physical')).toBe(35);
    expect(calcDamage(atk(30), def(10), 1, 'physical')).toBe(20);
  });

  it('物理最低造成 10 点（保底）', () => {
    expect(calcDamage(atk(5), def(200), 1, 'physical')).toBe(10);
  });

  it('物理伤害向上取整', () => {
    // 攻击15.5×1.5-0 = 23.25 → 24
    const a = atk(0);
    a.stats.atk = 15.5;
    expect(calcDamage(a, def(0), 1.5, 'physical')).toBe(24);
  });

  it('法术按法抗百分比减免（向上取整）', () => {
    // 30×1.5×(1-0.25) = 33.75 → 34
    expect(calcDamage(atk(30), def(0, 25), 1.5, 'magical')).toBe(34);
  });

  it('法抗超过 90 仍按 90% 减免（向上取整）', () => {
    // 30×1.5×0.1 = 4.5 → 5
    expect(calcDamage(atk(30), def(0, 95), 1.5, 'magical')).toBe(5);
  });

  it('攻击力百分比修正（狂暴+30% / 断臂-30%）', () => {
    const c = atk(100);
    c.statuses.atkModPct = 30;
    expect(calcDamage(c, def(0), 1, 'physical')).toBe(130);
    c.statuses.atkModPct = -30;
    expect(calcDamage(c, def(0), 1, 'physical')).toBe(70);
  });
});

describe('护盾', () => {
  it('先扣护盾再扣血', () => {
    const t = def(0);
    t.shield = 30;
    const toHp = absorb(t, 50);
    expect(toHp).toBe(20);
    expect(t.shield).toBe(0);
    t.hp -= toHp;
    expect(t.hp).toBe(180);
  });

  it('伤害未破盾时不掉血', () => {
    const t = def(0);
    t.shield = 30;
    expect(absorb(t, 20)).toBe(0);
    expect(t.shield).toBe(10);
  });

  it('重复获得护盾可叠加', () => {
    const t = def(0);
    expect(applyShield(t, 30)).toBe(30);
    expect(applyShield(t, 20)).toBe(20);
    expect(t.shield).toBe(50);
    expect(applyShield(t, 40)).toBe(40);
    expect(t.shield).toBe(90);
  });
});
