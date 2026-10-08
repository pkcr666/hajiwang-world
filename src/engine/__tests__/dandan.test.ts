import { describe, expect, it } from 'vitest';
import { advance, createBattle, enemyAct, playerAct } from '../battle';
import { itemMap, makeChar, makeEnemies, zeroRng } from './helpers';
import { buildAllyCombatant } from '../unit';
import { resolveCharacterSkills } from '../skills';

// 用40级氮氮（解锁全部技能），默认技能等级为1（T1）
function setupDandan(enemyId = 'testSlime', skillLevels?: Record<string, number>) {
  const char = { ...makeChar('dandan', undefined, 40), skillLevels };
  const a = buildAllyCombatant(char, itemMap, 0);
  a.skills = resolveCharacterSkills(char).skills;
  const es = makeEnemies(enemyId);
  const b = createBattle([a], es);
  b.order = [a.uid, ...es.map((u) => u.uid)];
  b.cursor = 0;
  return { b, allyUid: a.uid, enemyUids: es.map((u) => u.uid), int: a.int ?? 0 };
}

// 把第一个敌人血量拉满，避免被普攻击杀导致寒冷挂不上
function buffEnemyHp(b: ReturnType<typeof setupDandan>['b'], hp = 9999) {
  const e = b.enemies[0];
  e.maxHp = hp; e.hp = hp;
}

describe('氮氮 · 杜瓦冷罐', () => {
  it('T1：对群体造成(30+智力×1)法术伤害并施加寒冷2层强度1', () => {
    const { b, int } = setupDandan();
    const { state } = playerAct(b, { type: 'skill', skillId: 'sk_dandan_dewar' }, itemMap);
    const e = state.enemies[0];
    expect(e.hp).toBe(80 - (30 + int));
    expect(e.buffs.find((x) => x.id === 'chill')).toMatchObject({ stacks: 2, intensity: 1 });
    expect(state.allies[0].mp).toBe(state.allies[0].maxMp - 10);
  });

  it('T2/T3：基础伤害提升，寒冷强度统一为1', () => {
    const ctx2 = setupDandan('testSlime', { sk_dandan_dewar: 2 });
    buffEnemyHp(ctx2.b, 9999);
    const r2 = playerAct(ctx2.b, { type: 'skill', skillId: 'sk_dandan_dewar' }, itemMap);
    expect(r2.state.enemies[0].buffs.find((x) => x.id === 'chill')).toMatchObject({ stacks: 3, intensity: 1 });

    const ctx3 = setupDandan('testSlime', { sk_dandan_dewar: 3 });
    buffEnemyHp(ctx3.b, 9999);
    const r3 = playerAct(ctx3.b, { type: 'skill', skillId: 'sk_dandan_dewar' }, itemMap);
    expect(r3.state.enemies[0].buffs.find((x) => x.id === 'chill')).toMatchObject({ stacks: 4, intensity: 1 });
  });
});

describe('氮氮 · 低温附着（被动）', () => {
  it('T1：敌方携带寒冷时，回合末其所有效果层数+1', () => {
    const { b } = setupDandan();
    const e = b.enemies[0];
    e.maxHp = 9999; e.hp = 9999;
    e.buffs.push({ id: 'chill', stacks: 1, intensity: 1 });
    e.buffs.push({ id: 'poison', stacks: 2, intensity: 1 });
    let st = advance(b);
    st = enemyAct(st, zeroRng).state;
    st = advance(st);
    const e2 = st.enemies[0];
    expect(e2.buffs.find((x) => x.id === 'chill')?.stacks).toBe(1); // 1+1-1
    expect(e2.buffs.find((x) => x.id === 'poison')?.stacks).toBe(2); // 2+1-1
  });
});

describe('氮氮 · 温感追踪震撼弹', () => {
  it('T1：对单体施加破甲1层；目标无寒冷时不造成额外伤害', () => {
    const { b, enemyUids } = setupDandan();
    const { state } = playerAct(b, { type: 'skill', skillId: 'sk_dandan_grenade', targetUid: enemyUids[0] }, itemMap);
    expect(state.enemies[0].buffs.find((x) => x.id === 'armorBreak')).toMatchObject({ stacks: 1, intensity: 1 });
  });

  it('目标存在寒冷时，消耗一半寒冷层数并造成消耗层数×智力法术伤害（吃到破甲增伤）', () => {
    const { b, enemyUids, int } = setupDandan();
    const e0 = b.enemies[0];
    e0.maxHp = 9999; e0.hp = 9999;
    e0.buffs.push({ id: 'chill', stacks: 4, intensity: 1 });
    const { state } = playerAct(b, { type: 'skill', skillId: 'sk_dandan_grenade', targetUid: enemyUids[0] }, itemMap);
    const e = state.enemies[0];
    // 消耗一半：floor(4/2)=2层，剩余2层
    expect(e.buffs.find((x) => x.id === 'chill')?.stacks).toBe(2);
    // 破甲1层（先施加），使后续伤害+10%
    expect(e.buffs.find((x) => x.id === 'armorBreak')).toMatchObject({ stacks: 1, intensity: 1 });
    // 伤害 = ceil(2 × int × 1.1)（破甲1层=+10%伤害）
    expect(e.hp).toBe(9999 - Math.ceil(2 * int * 1.1));
  });

  it('寒冷层数为奇数时向下取整，至少消耗1层（吃到破甲增伤）', () => {
    const { b, enemyUids, int } = setupDandan();
    const e0 = b.enemies[0];
    e0.maxHp = 9999; e0.hp = 9999;
    e0.buffs.push({ id: 'chill', stacks: 3, intensity: 1 });
    const { state } = playerAct(b, { type: 'skill', skillId: 'sk_dandan_grenade', targetUid: enemyUids[0] }, itemMap);
    const e = state.enemies[0];
    // floor(3/2)=1层消耗，剩余2层
    expect(e.buffs.find((x) => x.id === 'chill')?.stacks).toBe(2);
    // 伤害 = ceil(1 × int × 1.1)
    expect(e.hp).toBe(9999 - Math.ceil(1 * int * 1.1));
  });

  it('T3：破甲3层，MP消耗5', () => {
    const { b, enemyUids } = setupDandan('testSlime', { sk_dandan_grenade: 3 });
    const mpBefore = b.allies[0].mp;
    const { state } = playerAct(b, { type: 'skill', skillId: 'sk_dandan_grenade', targetUid: enemyUids[0] }, itemMap);
    expect(state.enemies[0].buffs.find((x) => x.id === 'armorBreak')).toMatchObject({ stacks: 3, intensity: 1 });
    expect(state.allies[0].mp).toBe(mpBefore - 5);
  });
});

describe('氮氮 · 冷凝榴弹（被动）', () => {
  it('T1：敌方累计寒冷伤害>500时，防御-5%、法抗-5', () => {
    const { b } = setupDandan();
    const e = b.enemies[0];
    e.maxHp = 99999; e.hp = 99999;
    const defBefore = e.stats.def;
    const mresBefore = e.stats.mres;
    // 挂30层寒冷：回合末寒冷伤害 = 30×20 = 600 > 500
    e.buffs.push({ id: 'chill', stacks: 30, intensity: 1 });
    let st = advance(b);
    st = enemyAct(st, zeroRng).state;
    st = advance(st);
    const e2 = st.enemies[0];
    expect(e2.condensDmgTier).toBe(1);
    expect(e2.statuses.defModPct).toBe(-5);
    expect(e2.stats.mres).toBe(Math.max(0, mresBefore - 5));
    expect(e2.stats.def).toBe(defBefore); // 基础防御不变，减益通过 defModPct 生效
  });

  it('T1：累计寒冷伤害>1000时再次触发（叠加至-10%防御、-10法抗）', () => {
    const { b } = setupDandan();
    const e = b.enemies[0];
    e.maxHp = 99999; e.hp = 99999;
    const mresBefore = e.stats.mres;
    // 60层寒冷：回合末 60×20=1200 > 1000，一次结算跨过两个阈值
    e.buffs.push({ id: 'chill', stacks: 60, intensity: 1 });
    let st = advance(b);
    st = enemyAct(st, zeroRng).state;
    st = advance(st);
    const e2 = st.enemies[0];
    expect(e2.condensDmgTier).toBe(2);
    expect(e2.statuses.defModPct).toBe(-10);
    expect(e2.stats.mres).toBe(Math.max(0, mresBefore - 10));
  });

  it('累计消耗寒冷>10层时，永久-1速度（仅触发一次）', () => {
    const { b, enemyUids } = setupDandan();
    const e = b.enemies[0];
    e.maxHp = 99999; e.hp = 99999;
    const spdMinBefore = e.stats.spdMin;
    const spdMaxBefore = e.stats.spdMax;
    // 挂22层寒冷，震撼弹消耗一半=11层 > 10
    e.buffs.push({ id: 'chill', stacks: 22, intensity: 1 });
    b.allies[0].mp = 9999;
    const r = playerAct(b, { type: 'skill', skillId: 'sk_dandan_grenade', targetUid: enemyUids[0] }, itemMap);
    const e2 = r.state.enemies[0];
    expect(e2.condensConsumedChill).toBe(11);
    expect(e2.condensSpdApplied).toBe(true);
    expect(e2.stats.spdMin).toBe(Math.max(0, spdMinBefore - 1));
    expect(e2.stats.spdMax).toBe(Math.max(0, spdMaxBefore - 1));
  });

  it('T3：永久减速为-2速度', () => {
    const ctx = setupDandan('testSlime', { sk_dandan_condens: 3 });
    const { b, enemyUids } = ctx;
    const e = b.enemies[0];
    e.maxHp = 99999; e.hp = 99999;
    const spdMaxBefore = e.stats.spdMax;
    e.buffs.push({ id: 'chill', stacks: 22, intensity: 1 });
    b.allies[0].mp = 9999;
    const r = playerAct(b, { type: 'skill', skillId: 'sk_dandan_grenade', targetUid: enemyUids[0] }, itemMap);
    expect(r.state.enemies[0].stats.spdMax).toBe(Math.max(0, spdMaxBefore - 2));
  });
});
