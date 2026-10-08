import { describe, expect, it } from 'vitest';
import { advance, playerAct } from '../battle';
import { itemMap, setupBattle } from './helpers';
import { addBuff } from '../buffs';
import { calcDamage, makeCombatant } from '../damage';

const atk = (atk: number) => makeCombatant({ uid: 'a', name: '攻', stats: { hp: 100, mp: 0, atk, def: 0, mres: 0, spdMin: 2, spdMax: 5 } });
const def = (def: number, mres = 0) =>
  makeCombatant({ uid: 'd', name: '守', side: 'enemy', stats: { hp: 200, mp: 0, atk: 0, def, mres, spdMin: 2, spdMax: 5 } });

// 推进到回合末（眩晕敌方避免其行动干扰），触发 DoT 结算
function runToEndOfTurn(b: ReturnType<typeof setupBattle>['b']) {
  b.enemies[0].statuses.stunTurns = 1;
  const r1 = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, itemMap);
  return advance(r1.state);
}

// ===== 常规伤害（有 attacker）：完整计算来源方增伤/穿透 + 受伤方减伤/法抗 =====
describe('常规伤害（calcDamage）', () => {
  it('物理：来源方增伤(强壮) + 受伤方减伤(保护) + 防御', () => {
    const a = atk(100);
    addBuff(a, 'strength', 1, 1); // intensity=1 → +10% 全能增伤
    const d = def(20);
    addBuff(d, 'protection', 1, 1); // intensity=1 → +10% 全能减伤
    // raw = max(10, 100*1 - 20) = 80
    // ×(1+0.1) = 88
    // ×(1-0.1) = 79.2 → ceil 80
    expect(calcDamage(a, d, 1, 'physical')).toBe(80);
  });

  it('物理：来源方穿透(无视防御%)生效', () => {
    const a = atk(100);
    a.ignoreDefPct = 0.5; // 无视50%防御
    const d = def(40);
    // def = 40 × (1-0.5) = 20
    // raw = max(10, 100 - 20) = 80
    expect(calcDamage(a, d, 1, 'physical')).toBe(80);
  });

  it('法术：来源方增伤 + 受伤方法抗 + 减伤', () => {
    const a = atk(100);
    addBuff(a, 'strength', 1, 1); // +10%
    const d = def(0, 50); // 50法抗
    addBuff(d, 'protection', 1, 1); // +10% 减伤
    // raw = 100 × (1-0.5) = 50
    // ×(1+0.1) = 55
    // ×(1-0.1) = 49.5 → ceil 50
    expect(calcDamage(a, d, 1, 'magical')).toBe(50);
  });

  it('法术：来源方穿透(无视法抗扁平)生效', () => {
    const a = atk(100);
    a.ignoreMresFlat = 30; // 无视30点法抗
    const d = def(0, 50);
    // mres = max(0, 50-30) = 20
    // raw = 100 × (1-0.2) = 80
    expect(calcDamage(a, d, 1, 'magical')).toBe(80);
  });

  it('真实伤害：来源方增伤 + 受伤方减伤，无视防御法抗', () => {
    const a = atk(100);
    addBuff(a, 'strength', 1, 5); // intensity=5 → +50%
    const d = def(999, 999); // 高防高抗，真实伤害无视
    addBuff(d, 'protection', 1, 5); // intensity=5 → -50% 受伤
    // raw = 100
    // ×(1+0.5) = 150
    // ×(1-0.5) = 75
    expect(calcDamage(a, d, 1, 'true')).toBe(75);
  });
});

// ===== 持续性伤害（DoT：无 attacker）：仅应用受伤方减伤/法抗，不计算来源方增伤/穿透 =====
describe('DoT 伤害（回合末结算）', () => {
  it('中毒（真实）：受伤方减伤(保护)生效', () => {
    const { b } = setupBattle('cat', 'testSlime');
    const ally = b.allies[0];
    addBuff(ally, 'poison', 1, 1); // 10点真实伤害（乘算：1×1×10）
    addBuff(ally, 'protection', 1, 2); // intensity=2 → +20% 减伤
    const hpBefore = ally.hp;
    const after = runToEndOfTurn(b);
    const dmg = hpBefore - after.allies[0].hp;
    // 10 × (1 - 0.2) = 8
    expect(dmg).toBe(8);
  });

  it('中毒（真实）：来源方强壮不影响 DoT（无 attacker）', () => {
    const { b } = setupBattle('cat', 'testSlime');
    const ally = b.allies[0];
    b.enemies[0].stats.hp = 999; // 避免被击杀
    addBuff(ally, 'poison', 1, 1); // 10点
    addBuff(b.enemies[0], 'strength', 1, 5); // 敌方（中毒来源方）有强壮，但 DoT 无 attacker 不生效
    const hpBefore = ally.hp;
    const after = runToEndOfTurn(b);
    const dmg = hpBefore - after.allies[0].hp;
    expect(dmg).toBe(10);
  });

  it('流血（法术）：受伤方法抗 + 减伤生效', () => {
    const { b } = setupBattle('cat', 'testSlime');
    const ally = b.allies[0];
    ally.stats.mres = 50;
    addBuff(ally, 'bleed', 1, 1); // ceil(maxHp × 3%) 法术伤害
    addBuff(ally, 'protection', 1, 1); // +10% 减伤
    const hpBefore = ally.hp;
    const maxHp = ally.maxHp;
    const after = runToEndOfTurn(b);
    const dmg = hpBefore - after.allies[0].hp;
    const base = Math.ceil(maxHp * 0.03);
    const expected = Math.ceil(base * (1 - 0.5) * (1 - 0.1));
    expect(dmg).toBe(expected);
  });

  it('烧伤（真实）：受伤方减伤生效', () => {
    const { b } = setupBattle('cat', 'testSlime');
    const ally = b.allies[0];
    addBuff(ally, 'burn', 1, 1); // 当前生命 × 3% 真实伤害
    addBuff(ally, 'protection', 1, 1); // +10% 减伤
    const hpBefore = ally.hp;
    const after = runToEndOfTurn(b);
    const dmg = hpBefore - after.allies[0].hp;
    const base = Math.ceil(hpBefore * 0.03);
    const expected = Math.ceil(base * (1 - 0.1));
    expect(dmg).toBe(expected);
  });

  it('寒冷（法术）：受伤方法抗 + 减伤生效', () => {
    const { b } = setupBattle('cat', 'testSlime');
    const ally = b.allies[0];
    ally.stats.mres = 0;
    addBuff(ally, 'chill', 1, 1); // 20点法术伤害
    addBuff(ally, 'protection', 1, 1); // +10% 减伤
    const hpBefore = ally.hp;
    const after = runToEndOfTurn(b);
    const dmg = hpBefore - after.allies[0].hp;
    // 20 × (1-0) × (1-0.1) = 18
    expect(dmg).toBe(18);
  });

  it('寒冷（法术）：仅受伤方法抗减免，无来源方穿透', () => {
    const { b } = setupBattle('cat', 'testSlime');
    const ally = b.allies[0];
    ally.stats.mres = 50;
    addBuff(ally, 'chill', 1, 1); // 20点
    const hpBefore = ally.hp;
    const after = runToEndOfTurn(b);
    const dmg = hpBefore - after.allies[0].hp;
    // 20 × (1-0.5) = 10
    expect(dmg).toBe(10);
  });
});
