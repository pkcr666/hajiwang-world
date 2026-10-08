import { describe, expect, it } from 'vitest';
import { decideEnemy } from '../ai';
import { enemyAct } from '../battle';
import { setupBattle, zeroRng } from './helpers';

describe('decideEnemy', () => {
  it('basic 怪只会普攻', () => {
    const { b } = setupBattle('cat', 'testSlime');
    b.order = ['enemy_0', 'ally_0'];
    b.cursor = 0;
    const d = decideEnemy(b, b.enemies[0], zeroRng);
    expect(d.type).toBe('attack');
    if (d.type === 'attack') expect(d.targetUid).toBe('ally_0');
  });

  it('caster 开局第一个技能可用时优先放技能', () => {
    const { b } = setupBattle('cat', 'testCaster');
    b.order = ['enemy_0', 'ally_0'];
    b.cursor = 0;
    const d = decideEnemy(b, b.enemies[0], zeroRng);
    expect(d).toMatchObject({ type: 'skill', skillId: 'sk_test_bolt' });
  });

  it('巨像核心首次低于50%血时狂暴：攻击+30%且只触发一次', () => {
    const { b } = setupBattle('cat', 'colossus');
    const core = b.enemies.find((u) => u.isCore)!;
    b.order = [core.uid, 'ally_0'];
    b.cursor = 0;
    core.hp = 140; // 140/300 < 50%

    const r1 = enemyAct(b, zeroRng);
    const core2 = r1.state.enemies.find((u) => u.isCore)!;
    expect(core2.enraged).toBe(true);
    expect(core2.statuses.atkModPct).toBe(30);
    expect(r1.events.some((e) => e.t === 'info')).toBe(true);

    // 下一次行动不再叠加
    r1.state.order = [core.uid, 'ally_0'];
    r1.state.cursor = 0;
    const r2 = enemyAct(r1.state, zeroRng);
    const core3 = r2.state.enemies.find((u) => u.isCore)!;
    expect(core3.statuses.atkModPct).toBe(30);
  });
});