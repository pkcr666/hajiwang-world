import { describe, expect, it } from 'vitest';
import type { BattleState, MonsterUnit } from '../../types';
import { DEFAULT_MONSTERS } from '../../data/monsters';
import { createBattle, enemyAct, playerAct } from '../battle';
import { buildEnemyCombatants } from '../unit';
import { itemMap, makeAlly, zeroRng } from './helpers';

const mapOf = (list: MonsterUnit[]) => new Map(list.map((m) => [m.id, m]));
const find = (id: string) => DEFAULT_MONSTERS.find((x) => x.id === id)!;
const build = (id: string, index = 0) => buildEnemyCombatants(find(id), index, mapOf(DEFAULT_MONSTERS));

function plainAlly(hp?: number) {
  const a = makeAlly();
  a.skills = a.skills.filter((s) => s.kind !== 'reaction');
  if (hp) { a.maxHp = hp; a.hp = hp; }
  return a;
}

function twoAllies(hp?: number) {
  const a = plainAlly(hp);
  const a2 = plainAlly(hp);
  a2.uid = 'ally_1';
  return [a, a2] as const;
}

// 让指定怪物行动一次（cursor 指向该怪物）
function actMonster(b: BattleState, monsterId: string): BattleState {
  const idx = b.order.findIndex((uid) => b.enemies.some((e) => e.uid === uid && e.monsterId === monsterId));
  if (idx < 0) return b;
  b.cursor = idx;
  return enemyAct(b, zeroRng).state;
}

function findM(b: BattleState, monsterId: string) {
  return b.enemies.find((e) => e.monsterId === monsterId)!;
}

function playerAttack(b: BattleState, targetUid: string): BattleState {
  const idx = b.order.findIndex((uid) => b.allies.some((al) => al.uid === uid && al.alive));
  if (idx < 0) return b;
  b.cursor = idx;
  return playerAct(b, { type: 'attack', targetUid }, itemMap).state;
}

describe('灾厄新怪物机制', () => {
  it('阿卡多：第1回合召唤食尸鬼且不占用攻击（召唤后仍攻击获得50血槽）', () => {
    const [a, a2] = twoAllies(9999);
    let b = createBattle([a, a2], build('ct_070', 0), zeroRng);
    b = actMonster(b, 'ct_070');
    expect(b.enemies.filter((e) => e.monsterId === 'ct_069')).toHaveLength(1);
    const ak = findM(b, 'ct_070');
    expect(ak.crisis?.akado?.bloodPool).toBe(50); // 召唤不占用攻击：攻击后血槽+50
  });

  it('阿卡多：攻击获得50血槽；血槽>=100攻击两个目标', () => {
    const [a, a2] = twoAllies(9999);
    let b = createBattle([a, a2], build('ct_070', 0), zeroRng);
    b.turn = 2; // 非召唤回合
    b = actMonster(b, 'ct_070');
    let ak = findM(b, 'ct_070');
    expect(ak.crisis?.akado?.bloodPool).toBe(50);
    // 抬血槽到120，再行动一次 → 双目标
    ak.crisis!.akado!.bloodPool = 120;
    b = actMonster(b, 'ct_070');
    ak = findM(b, 'ct_070');
    expect(ak.crisis?.akado?.bloodPool).toBe(170);
    expect(b.allies.every((x) => x.hp < 9999)).toBe(true);
  });

  it('阿卡多：任意单位死亡血槽+50（含食尸鬼第一条命）', () => {
    const [a, a2] = twoAllies(9999);
    let b = createBattle([a, a2], build('ct_070', 0), zeroRng);
    b = actMonster(b, 'ct_070'); // 召唤食尸鬼 + 攻击（血槽 0→50）
    const ghoul = b.enemies.find((e) => e.monsterId === 'ct_069')!;
    ghoul.hp = 1;
    b = playerAttack(b, ghoul.uid);
    const ak = findM(b, 'ct_070');
    expect(ak.crisis?.akado?.bloodPool).toBe(100); // 攻击50 + 食尸鬼死亡50
  });

  it('阿卡多：首次死亡后血槽归0并恢复血槽×10的HP，只复活一次', () => {
    const [a, a2] = twoAllies(9999);
    let b = createBattle([a, a2], build('ct_070', 0), zeroRng);
    let ak = findM(b, 'ct_070');
    ak.hp = 1;
    ak.crisis = { akado: { bloodPool: 300 } };
    b = playerAttack(b, ak.uid);
    ak = findM(b, 'ct_070');
    expect(ak.alive).toBe(true);
    expect(ak.revived).toBe(true);
    expect(ak.hp).toBe(3000); // 300×10
    expect(ak.crisis?.akado?.bloodPool).toBe(0);
  });

  it('冰霜巨人：攻击施加2层强度2寒冷；死亡自爆对随机敌方300法伤', () => {
    const a = plainAlly(9999);
    let b = createBattle([a], build('ct_071', 0), zeroRng);
    b = actMonster(b, 'ct_071');
    const chill = b.allies[0].buffs.find((x) => x.id === 'chill');
    expect(chill?.stacks).toBe(2);
    expect(chill?.intensity).toBe(2);
    const fg = findM(b, 'ct_071');
    fg.hp = 1;
    b = playerAttack(b, fg.uid);
    expect(findM(b, 'ct_071').alive).toBe(false);
    expect(b.allies[0].hp).toBeLessThan(9999);
  });

  it('Viper：行动前敌方全体中毒层数+1，攻击额外毒层×20真伤', () => {
    const a = plainAlly(9999);
    let b = createBattle([a], build('ct_072', 0), zeroRng);
    b.allies[0].buffs.push({ id: 'poison', stacks: 3, intensity: 1 });
    b = actMonster(b, 'ct_072');
    const poison = b.allies[0].buffs.find((x) => x.id === 'poison');
    expect(poison?.stacks).toBe(4);
    expect(b.allies[0].hp).toBeLessThan(9999);
  });

  it('大鸡婶婶：攻击造成对方HP上限10%的真实伤害；我方获得护盾时自身获得等量', () => {
    const a = plainAlly(9999);
    a.bag = [{ itemId: 'it_test_rune', count: 2 }];
    let b = createBattle([a], build('ct_073', 0), zeroRng);
    b = actMonster(b, 'ct_073');
    const ally = b.allies[0];
    expect(9999 - ally.hp).toBe(Math.ceil(9999 * 0.1));
    const pIdx = b.order.findIndex((uid) => b.allies.some((al) => al.uid === uid));
    b.cursor = pIdx;
    b = playerAct(b, { type: 'item', itemId: 'it_test_rune', targetUid: ally.uid }, itemMap).state;
    const big = findM(b, 'ct_073');
    expect(big.shield).toBe(30);
  });

  it('马神：群体100%真实伤害多段，攻击后速度+1', () => {
    const [a, a2] = twoAllies(99999);
    let b = createBattle([a, a2], build('ct_078', 0), zeroRng);
    const ma = findM(b, 'ct_078');
    const spdBefore = ma.stats.spdMin;
    b = actMonster(b, 'ct_078');
    expect(findM(b, 'ct_078').stats.spdMin).toBeGreaterThan(spdBefore);
    expect(b.allies.every((x) => x.hp < 99999)).toBe(true);
  });

  it('马神：第3回合行动变为单体200%物理并眩晕目标', () => {
    const [a, a2] = twoAllies(99999);
    let b = createBattle([a, a2], build('ct_078', 0), zeroRng);
    b.turn = 3;
    b = actMonster(b, 'ct_078');
    const stunned = b.allies.find((x) => (x.statuses.stunTurns ?? 0) > 0);
    expect(stunned).toBeDefined();
  });

  it('劳贤：受击/攻击红温+1，满时拍地板（群体伤害+防御20+法抗10+回血500）', () => {
    const a = plainAlly(9999);
    let b = createBattle([a], build('ct_077', 0), zeroRng);
    let lx = findM(b, 'ct_077');
    lx.hp = 9999; lx.maxHp = 9999;
    b = playerAttack(b, lx.uid);
    b = playerAttack(b, lx.uid);
    lx = findM(b, 'ct_077');
    expect(lx.crisis?.laoxian?.red).toBe(2);
    lx.hp = 4500; lx.maxHp = 5000;
    const defBefore = lx.stats.def;
    const mresBefore = lx.stats.mres;
    b = actMonster(b, 'ct_077');
    lx = findM(b, 'ct_077');
    expect(lx.crisis?.laoxian?.red).toBe(0);
    expect(lx.stats.def).toBe(defBefore + 20);
    expect(lx.stats.mres).toBe(mresBefore + 10);
    expect(lx.hp).toBe(5000); // 恢复500 → 5000
    expect(b.allies[0].hp).toBeLessThan(9999);
  });
});
