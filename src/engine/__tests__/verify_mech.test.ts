import { describe, expect, it } from 'vitest';
import type { MonsterUnit } from '../../types';
import { DEFAULT_MONSTERS } from '../../data/monsters';
import { advance, applyTurnStartTriggers, createBattle, enemyAct, getLegalActions, playerAct } from '../battle';
import { buildEnemyCombatants } from '../unit';
import { makeAlly, zeroRng } from './helpers';
import { effSpd } from '../buffs';

const mapOf = (list: MonsterUnit[]) => new Map(list.map((m) => [m.id, m]));
const find = (id: string) => DEFAULT_MONSTERS.find((x) => x.id === id)!;
const build = (id: string, index = 0) => buildEnemyCombatants(find(id), index, mapOf(DEFAULT_MONSTERS));

function plainAlly() {
  const a = makeAlly();
  a.skills = a.skills.filter((s) => s.kind !== 'reaction');
  return a;
}

describe('灾厄怪物特殊能力验证', () => {
  it('深池战士：第一回合开始按存活友方数 防御+30/法抗+20', () => {
    const a = plainAlly();
    const e1 = build('ct_011', 0)[0];
    const e2 = build('ct_011', 1)[0];
    const b = createBattle([a], [e1, e2], zeroRng);
    expect(e1.perAllyBaseStats).toBeDefined();
    const base = e1.perAllyBaseStats!;
    expect(e1.stats.def).toBe(base.def); // 未判定前为基准值
    const ns = applyTurnStartTriggers(b, zeroRng); // 第一回合开始即判定
    expect(ns.enemies[0].stats.def).toBe(base.def + 2 * 30);
    expect(ns.enemies[0].stats.mres).toBe(Math.min(90, base.mres + 2 * 20));
    expect(ns.enemies[1].stats.def).toBe(base.def + 2 * 30);
  });

  it('木裂战士：被攻击后下回合速度+10，上限+20', () => {
    const a = plainAlly();
    const e = build('ct_036');
    const b = createBattle([a], e, zeroRng);
    b.order = [a.uid, e[0].uid];
    b.cursor = 0;
    const baseMin = e[0].stats.spdMin;
    const baseMax = e[0].stats.spdMax;
    let s = b;
    // 第1击 → pending 10
    let r = playerAct(s, { type: 'attack', targetUid: e[0].uid }, new Map());
    expect(r.state.enemies[0].spdUpPending).toBe(10);
    // 第2击 → pending 20（上限）
    s = r.state; s.order = [a.uid, e[0].uid]; s.cursor = 0;
    r = playerAct(s, { type: 'attack', targetUid: e[0].uid }, new Map());
    expect(r.state.enemies[0].spdUpPending).toBe(20);
    // 第3击 → 仍为20，不再累积
    s = r.state; s.order = [a.uid, e[0].uid]; s.cursor = 0;
    r = playerAct(s, { type: 'attack', targetUid: e[0].uid }, new Map());
    expect(r.state.enemies[0].spdUpPending).toBe(20);
    // 下一回合开始：速度+20 并清零
    const s3 = r.state;
    s3.turn = 2;
    const ns = applyTurnStartTriggers(s3, zeroRng);
    expect(ns.enemies[0].stats.spdMin).toBe(baseMin + 20);
    expect(ns.enemies[0].stats.spdMax).toBe(baseMax + 20);
    expect(ns.enemies[0].spdUpPending).toBe(0);
  });

  it('捣碎鳄：攻击时攻击力提升目标束缚层数×5，攻击后恢复', () => {
    // 对照组：无束缚
    const a0 = plainAlly();
    const e0 = build('ct_046');
    const b0 = createBattle([a0], e0, zeroRng);
    b0.order = [e0[0].uid, a0.uid];
    b0.cursor = 0;
    const hp0 = a0.hp;
    const r0 = enemyAct(b0, zeroRng);
    const dmgNoBind = hp0 - r0.state.allies[0].hp;
    // 实验组：目标带3层束缚
    const a1 = plainAlly();
    a1.buffs.push({ id: 'bind', intensity: 1, stacks: 3 });
    const e1 = build('ct_046', 1);
    const b1 = createBattle([a1], e1, zeroRng);
    b1.order = [e1[0].uid, a1.uid];
    b1.cursor = 0;
    const baseAtk = e1[0].stats.atk;
    const hp1 = a1.hp;
    const r1 = enemyAct(b1, zeroRng);
    const dmg = hp1 - r1.state.allies[0].hp;
    expect(dmg).toBe(dmgNoBind + 15); // 3层×5=15 攻击力加成计入伤害
    expect(r1.state.enemies[0].stats.atk).toBe(baseAtk); // 攻击后恢复原攻击力
  });

  it('灵魂饮食者：普攻不崩溃，附加最大生命3%真实伤害', () => {
    const a = plainAlly();
    const e = build('ct_067');
    const b = createBattle([a], e, zeroRng);
    b.order = [e[0].uid, a.uid];
    b.cursor = 0;
    const hp0 = a.hp;
    const r = enemyAct(b, zeroRng);
    const dmg = hp0 - r.state.allies[0].hp;
    const main = Math.max(5, e[0].stats.atk - a.stats.def);
    const extra = Math.ceil(a.maxHp * 0.03);
    expect(dmg).toBe(main + extra);
    expect(r.state.allies[0].alive).toBe(true);
  });

  it('哀嚎的暗精灵僵尸：普攻不崩溃，施加瘟疫并附瘟疫层数×20真伤', () => {
    const a = plainAlly();
    a.maxHp = 1000; a.hp = 1000; a.baseMaxHp = 1000;
    const e = build('ct_080');
    const b = createBattle([a], e, zeroRng);
    b.order = [e[0].uid, a.uid];
    b.cursor = 0;
    const r = enemyAct(b, zeroRng);
    expect(r.state.allies[0].alive).toBe(true);
    expect(r.state.allies[0].buffs.some((x) => x.id === 'plague')).toBe(true);
    // 第二次攻击继续正常行动（递归修复）
    const s2 = r.state;
    s2.order = [e[0].uid, a.uid];
    s2.cursor = 0;
    const r2 = enemyAct(s2, zeroRng);
    expect(r2.state.allies[0].alive).toBe(true);
  });

  it('悲鸣的暗精灵僵尸：普攻不崩溃，施加瘟疫并附(80+层数×10)法伤', () => {
    const a = plainAlly();
    a.maxHp = 1000; a.hp = 1000; a.baseMaxHp = 1000;
    const e = build('ct_081');
    const b = createBattle([a], e, zeroRng);
    b.order = [e[0].uid, a.uid];
    b.cursor = 0;
    const r = enemyAct(b, zeroRng);
    expect(r.state.allies[0].alive).toBe(true);
    expect(r.state.allies[0].buffs.some((x) => x.id === 'plague')).toBe(true);
    const s2 = r.state;
    s2.order = [e[0].uid, a.uid];
    s2.cursor = 0;
    const r2 = enemyAct(s2, zeroRng);
    expect(r2.state.allies[0].alive).toBe(true);
  });

  it('巨像蛤：嘲讽限制我方单体目标，玩家选其他目标被强制改选', () => {
    const a = plainAlly();
    a.cha = 10;
    const e0 = build('ct_056', 0)[0];
    const e1 = build('ct_011', 1)[0];
    const b = createBattle([a], [e0, e1], zeroRng);
    b.order = [a.uid, e0.uid, e1.uid];
    b.cursor = 0;
    // 合法行动：单体目标只能是巨像蛤
    const legal = getLegalActions(b, new Map());
    for (const sk of legal.skills) {
      if (sk.targetUids && sk.targetUids.length > 0 && sk.targetUids.length < 2) {
        expect(sk.targetUids).toEqual([e0.uid]);
      }
    }
    // 玩家指定攻击 e1（深池战士）→ 强制改为攻击 e0（巨像蛤）
    const def0 = e0.stats.def;
    const hp0 = e0.hp;
    const hp1 = e1.hp;
    const r = playerAct(b, { type: 'attack', targetUid: e1.uid }, new Map());
    expect(r.state.enemies[0].hp).toBeLessThan(hp0); // 巨像蛤受击
    expect(r.state.enemies[1].hp).toBe(hp1); // 深池战士未受击
    expect(r.state.enemies[0].stats.def).toBe(def0 - a.cha); // 受击减魅
    expect(r.state.allies[0].hp).toBeLessThan(a.hp); // 反10真伤打到我方
  });

  it('巨像蛤：自身造成的伤害等额提升自身防御', () => {
    const a = plainAlly();
    const e = build('ct_056');
    const b = createBattle([a], e, zeroRng);
    b.order = [e[0].uid, a.uid];
    b.cursor = 0;
    const baseDef = e[0].stats.def;
    const hp0 = a.hp;
    const r = enemyAct(b, zeroRng);
    const dmg = hp0 - r.state.allies[0].hp;
    expect(r.state.enemies[0].stats.def).toBe(baseDef + dmg);
  });

  it('花癫疯：回合末全场法伤包含友方与自身', () => {
    const a = plainAlly();
    const e = build('ct_058');
    const b = createBattle([a], e, zeroRng);
    b.order = [e[0].uid, a.uid];
    b.cursor = 1; // 下一格越界 → 触发回合末结算
    const hpAlly = a.hp;
    const hpSelf = e[0].hp;
    const ns = advance(b, zeroRng);
    expect(ns.allies[0].hp).toBeLessThan(hpAlly); // 友方受法伤
    expect(ns.enemies[0].hp).toBeLessThan(hpSelf); // 自身也受法伤
  });

  it('魔鬼鱼：伤害 = (100+目标速度×5)%×攻击力 - 防御', () => {
    const a = plainAlly();
    const e = build('ct_052');
    const b = createBattle([a], e, zeroRng);
    b.order = [e[0].uid, a.uid];
    b.cursor = 0;
    const hp0 = a.hp;
    const r = enemyAct(b, zeroRng);
    const dmg = hp0 - r.state.allies[0].hp;
    const mult = (100 + effSpd(a).max * 5) / 100;
    const expected = Math.max(5, Math.floor(e[0].stats.atk * mult) - a.stats.def);
    expect(dmg).toBe(expected);
  });

  it('雾凇猎犬：伤害 = 攻击×(1+流血层×0.2) - 防御', () => {
    const a = plainAlly();
    a.buffs.push({ id: 'bleed', intensity: 1, stacks: 5 });
    const e = build('ct_019');
    const b = createBattle([a], e, zeroRng);
    b.order = [e[0].uid, a.uid];
    b.cursor = 0;
    const hp0 = a.hp;
    const r = enemyAct(b, zeroRng);
    const dmg = hp0 - r.state.allies[0].hp;
    const expected = Math.max(5, Math.floor(e[0].stats.atk * (1 + 5 * 0.2)) - a.stats.def);
    expect(dmg).toBe(expected);
  });
});
