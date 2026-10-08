import { describe, expect, it } from 'vitest';
import type { MonsterUnit, Rng } from '../../types';
import { createBattle, enemyAct, playerAct } from '../battle';
import { buildEnemyCombatants } from '../unit';
import { makeAlly } from './helpers';
import { DEFAULT_MONSTERS } from '../../data/monsters';

// 按脚本依次返回随机数的 Rng
const script = (vals: number[]): Rng => {
  const q = [...vals];
  return { int: () => q.shift() ?? 0 };
};

const mapOf = (list: MonsterUnit[]) => new Map(list.map((m) => [m.id, m]));

// 敌方先行动：把顺位指针拨到敌人
function enemyFirst(a: ReturnType<typeof makeAlly>, e: ReturnType<typeof buildEnemyCombatants>) {
  const b = createBattle([a], e, script([0]));
  b.order = [e[0].uid, a.uid];
  b.cursor = 0;
  return b;
}

describe('怪物机制', () => {
  it('史莱姆之王受击后跌破70%召1只、跌破40%再召1只（共2只，每档仅一次）', () => {
    const king = DEFAULT_MONSTERS.find((m) => m.id === 'kingSlime')!;
    const a = makeAlly('cat');
    const e = buildEnemyCombatants(king, 0, mapOf(DEFAULT_MONSTERS));
    const b = createBattle([a], e, script([0]));
    b.order = [a.uid, e[0].uid];
    b.cursor = 0;
    const spdBefore = b.enemies[0].stats.spdMin;

    // 第一击：血量 211 跌破 70%（210）→ 召一只，自身速度+1
    b.enemies[0].hp = 211;
    const r1 = playerAct(b, { type: 'attack', targetUid: e[0].uid }, new Map());
    expect(r1.state.enemies.length).toBe(2);
    expect(r1.state.enemies[1].name).toBe('史莱姆');
    expect(r1.state.enemies[0].stats.spdMin).toBe(spdBefore + 1);
    expect(r1.events.some((x) => x.t === 'summon')).toBe(true);

    // 第二击：血量 121 跌破 40%（120）→ 再召一只
    const s1 = r1.state;
    s1.enemies[0].hp = 121;
    s1.order = [a.uid, s1.enemies[0].uid];
    s1.cursor = 0;
    const r2 = playerAct(s1, { type: 'attack', targetUid: s1.enemies[0].uid }, new Map());
    expect(r2.state.enemies.length).toBe(3);
    expect(r2.state.enemies[0].stats.spdMin).toBe(spdBefore + 2);

    // 第三击：两档均已触发，不再召唤
    const s2 = r2.state;
    s2.enemies[0].hp = 100;
    s2.order = [a.uid, s2.enemies[0].uid];
    s2.cursor = 0;
    const r3 = playerAct(s2, { type: 'attack', targetUid: s2.enemies[0].uid }, new Map());
    expect(r3.state.enemies.length).toBe(3);
  });

  it('史莱姆之王血量未跌破阈值时不召唤', () => {
    const king = DEFAULT_MONSTERS.find((m) => m.id === 'kingSlime')!;
    const a = makeAlly('cat');
    const e = buildEnemyCombatants(king, 0, mapOf(DEFAULT_MONSTERS));
    const b = createBattle([a], e, script([0]));
    b.order = [a.uid, e[0].uid];
    b.cursor = 0;
    b.allies[0].stats.atk = 0; // 压低攻击，确保一击后仍在70%以上
    const r = playerAct(b, { type: 'attack', targetUid: e[0].uid }, new Map());
    expect(r.state.enemies.length).toBe(1);
  });

  it('克苏鲁之眼低于50%血触发狂暴：速度+3、攻击+20、防御-20', () => {
    const eye = DEFAULT_MONSTERS.find((m) => m.id === 'eyeOfCthulhu')!;
    const a = makeAlly('cat');
    const e = buildEnemyCombatants(eye, 0, mapOf(DEFAULT_MONSTERS));
    const b = enemyFirst(a, e);
    const base = { ...b.enemies[0].stats };
    b.enemies[0].hp = 100; // 100/250 < 50%
    const r = enemyAct(b, script([0]));
    const s2 = r.state.enemies[0].stats;
    expect(s2.spdMin).toBe(base.spdMin + 3);
    expect(s2.atk).toBe(base.atk + 20);
    expect(s2.def).toBe(base.def - 20);
    expect(r.state.enemies[0].enraged).toBe(true);
  });

  it('克苏鲁之眼狂暴只触发一次', () => {
    const eye = DEFAULT_MONSTERS.find((m) => m.id === 'eyeOfCthulhu')!;
    const a = makeAlly('cat');
    const e = buildEnemyCombatants(eye, 0, mapOf(DEFAULT_MONSTERS));
    const b = enemyFirst(a, e);
    b.enemies[0].hp = 100;
    const r1 = enemyAct(b, script([0]));
    const after1 = r1.state.enemies[0].stats.atk;
    r1.state.order = [r1.state.enemies[0].uid, a.uid];
    r1.state.cursor = 0;
    const r2 = enemyAct(r1.state, script([0]));
    expect(r2.state.enemies[0].stats.atk).toBe(after1);
  });
});