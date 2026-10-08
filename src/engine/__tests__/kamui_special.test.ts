import { describe, expect, it } from 'vitest';
import { createBattle, enemyAct, resolveReaction } from '../battle';
import { itemMap, makeChar, makeEnemies, zeroRng } from './helpers';
import { buildAllyCombatant } from '../unit';
import { resolveCharacterSkills } from '../skills';

// 40级神秘面具男（解锁全部技能），默认技能等级1（T1）
function setupMaskedVs(enemyId: string) {
  const char = { ...makeChar('masked', undefined, 40) };
  const a = buildAllyCombatant(char, itemMap, 0);
  a.skills = resolveCharacterSkills(char).skills;
  // 虚化次数：回合初由 applyTurnStartTriggers 重置，测试直接初始化满值
  a.kamuiUses = a.kamuiMaxUses ?? 1;
  const es = makeEnemies(enemyId);
  const b = createBattle([a], es, zeroRng);
  return { b, allyUid: a.uid, enemies: es, a };
}

// 让克苏鲁之脑进入可攻击阶段：清空眼球（无敌解除）
function activateCthulhu(b: ReturnType<typeof setupMaskedVs>['b']) {
  const brain = b.enemies.find((e) => e.monsterId === 'ct_027')!;
  for (const e of b.enemies) {
    if (e.monsterId === 'ct_027_eye') { e.alive = false; e.hp = 0; }
  }
  return brain;
}

// 让腐巢意志进入可攻击阶段：消灭腐化囊（无敌解除）
function activateRotNest(b: ReturnType<typeof setupMaskedVs>['b']) {
  const nest = b.enemies.find((e) => e.monsterId === 'ct_042')!;
  const sac = b.enemies.find((e) => e.monsterId === 'ct_042_sac');
  if (sac) { sac.alive = false; sac.hp = 0; }
  return nest;
}

describe('面具男虚化 vs 特殊AI直伤分支（无敌转正常后）', () => {
  it('克苏鲁之脑本体：攻击面具男时触发虚化暂停（special 行动）', () => {
    const { b, allyUid, a } = setupMaskedVs('ct_027');
    activateCthulhu(b);
    // 行动顺序：面具男在前，克苏鲁之脑在后 → 满足虚化顺位条件
    const brain = b.enemies.find((e) => e.monsterId === 'ct_027')!;
    b.order = [allyUid, brain.uid, ...b.enemies.filter((e) => e.uid !== brain.uid && e.alive).map((e) => e.uid)];
    b.cursor = b.order.indexOf(brain.uid);
    b.turn = 1;

    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    expect(r.state.pendingReaction!.action.kind).toBe('special');
    expect(r.state.pendingReaction!.targetUid).toBe(allyUid);

    const hpBefore = a.hp;
    const r2 = resolveReaction(r.state, true);
    const ns = r2.state;
    const masked = ns.allies[0];
    expect(masked.hp).toBe(hpBefore); // 攻击被闪避，行动作废
    expect(masked.buffs.find((x) => x.id === 'strength')).toBeTruthy();
    expect(masked.kamuiUses).toBe(0);
  });

  it('腐巢意志本体：攻击面具男时触发虚化暂停（special 行动）', () => {
    const { b, allyUid, a } = setupMaskedVs('ct_042');
    activateRotNest(b);
    const nest = b.enemies.find((e) => e.monsterId === 'ct_042')!;
    b.order = [allyUid, nest.uid, ...b.enemies.filter((e) => e.uid !== nest.uid && e.alive).map((e) => e.uid)];
    b.cursor = b.order.indexOf(nest.uid);
    b.turn = 1;

    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    expect(r.state.pendingReaction!.action.kind).toBe('special');

    const hpBefore = a.hp;
    const r2 = resolveReaction(r.state, true);
    const ns = r2.state;
    expect(ns.allies[0].hp).toBe(hpBefore);
    expect(ns.allies[0].buffs.find((x) => x.id === 'strength')).toBeTruthy();
  });

  it('拒绝虚化时重新执行特殊行动并承受伤害（腐巢意志攻击生效）', () => {
    const { b, allyUid, a } = setupMaskedVs('ct_042');
    activateRotNest(b);
    const nest = b.enemies.find((e) => e.monsterId === 'ct_042')!;
    b.order = [allyUid, nest.uid, ...b.enemies.filter((e) => e.uid !== nest.uid && e.alive).map((e) => e.uid)];
    b.cursor = b.order.indexOf(nest.uid);
    b.turn = 1;

    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    const hpBefore = a.hp;
    const r2 = resolveReaction(r.state, false);
    expect(r2.state.replaySpecial).toBe(true);
    // 调用方重放特殊行动
    const r3 = enemyAct(r2.state, zeroRng);
    expect(r3.state.replaySpecial).toBeFalsy();
    expect(r3.state.allies[0].hp).toBeLessThan(hpBefore); // 未虚化 → 受到伤害
  });
});

describe('面具男虚化 vs 其它特殊AI直伤分支（无无敌阶段）', () => {
  function setup(enemyId: string, monsterId: string) {
    const { b, allyUid, a } = setupMaskedVs(enemyId);
    const foe = b.enemies.find((e) => e.monsterId === monsterId)!;
    b.order = [allyUid, foe.uid, ...b.enemies.filter((e) => e.uid !== foe.uid && e.alive).map((e) => e.uid)];
    b.cursor = b.order.indexOf(foe.uid);
    b.turn = 1;
    return { b, allyUid, a, foe };
  }

  // 肉山：固定本回合行动序列（1=单体物理、0=群体物理、2=中毒、3=单体法术）
  function fixRouShan(foe: { crisis?: unknown }, steps: number[]) {
    foe.crisis = { wallOfFlesh: { atkBonus: 0, turn: 1, steps, stepIdx: 0, lastEvaded: -1 } };
  }

  it('肉山（单体行动）：被面具男虚化打断（special 行动）', () => {
    const { b, a, foe } = setup('ct_068', 'ct_068');
    fixRouShan(foe, [1, 2]);
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    expect(r.state.pendingReaction!.action.kind).toBe('special');
    const hpBefore = a.hp;
    const r2 = resolveReaction(r.state, true);
    expect(r2.state.allies[0].hp).toBe(hpBefore); // 闪避该次单体行动
    expect(r2.state.allies[0].buffs.find((x) => x.id === 'strength')).toBeTruthy();
  });

  it('肉山：虚化接受后第二个行动槽仍正常执行（分两次行动）', () => {
    const { b, a, foe } = setup('ct_068', 'ct_068');
    fixRouShan(foe, [1, 2]); // 第一槽=单体物理（被打断作废），第二槽=中毒（正常执行）
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    const r2 = resolveReaction(r.state, true); // 接受虚化 → 行动作废
    expect(r2.state.replaySpecial).toBeFalsy();
    // 第二行动槽：执行中毒（不弹窗、不承伤但叠加中毒）
    const r3 = enemyAct(r2.state, zeroRng);
    expect(r3.state.pendingReaction).toBeFalsy();
    expect(r3.state.allies[0].buffs.some((bd) => bd.id === 'poison')).toBe(true);
    expect(a.hp).toBe(r3.state.allies[0].hp); // 未承伤（第一槽已作废，第二槽是中毒）
  });

  it('肉山（群体物理）：弹窗选择闪避后仅面具男免疫自身，其他角色照常承伤', () => {
    const { b, a, foe } = setup('ct_068', 'ct_068');
    // 追加一个速度比肉山低的普通队友作为"其他角色"
    const buddy = { ...a, uid: 'buddy_1', name: '队友', kamuiUses: undefined, kamuiMaxUses: undefined, mp: 0, maxMp: 0, skills: [], hp: a.maxHp, maxHp: a.maxHp };
    buddy.stats = { ...a.stats, spdMin: 1, spdMax: 1 };
    b.allies.push(buddy);
    b.order = [a.uid, foe.uid, buddy.uid];
    b.cursor = b.order.indexOf(foe.uid);
    fixRouShan(foe, [0, 2]); // 第一槽=群体物理
    const hpBefore = a.hp;
    const buddyHpBefore = buddy.hp;
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy(); // 群体攻击也弹窗
    const pa = r.state.pendingReaction!.action;
    expect(pa.kind === 'special' && pa.aoeKamui).toBe(true);
    // 接受闪避 → 行动重放：面具男免、队友承伤
    const r2 = resolveReaction(r.state, true);
    expect(r2.state.replaySpecial).toBe(true);
    const r3 = enemyAct(r2.state, zeroRng);
    const masked = r3.state.allies.find((x) => x.uid === a.uid)!;
    const buddyNow = r3.state.allies.find((x) => x.uid === buddy.uid)!;
    expect(masked.hp).toBe(hpBefore); // 面具男免疫自身
    expect(buddyNow.hp).toBeLessThan(buddyHpBefore); // 其他角色承伤
    expect(masked.buffs.find((x) => x.id === 'strength')).toBeTruthy();
    expect(masked.kamuiUses).toBe(0);
  });

  it('肉山（群体物理）：拒绝闪避则队友照常承伤、面具男不消耗虚化（肉山群体物理只打速度低于自身的单位，面具男高速本就不承伤）', () => {
    const { b, a, foe } = setup('ct_068', 'ct_068');
    const buddy = { ...a, uid: 'buddy_1', name: '队友', kamuiUses: undefined, kamuiMaxUses: undefined, mp: 0, maxMp: 0, skills: [], hp: a.maxHp, maxHp: a.maxHp };
    buddy.stats = { ...a.stats, spdMin: 1, spdMax: 1 };
    b.allies.push(buddy);
    b.order = [a.uid, foe.uid, buddy.uid];
    b.cursor = b.order.indexOf(foe.uid);
    fixRouShan(foe, [0, 2]); // 第一槽=群体物理（仅打低速单位）
    const buddyHpBefore = buddy.hp;
    const kamuiBefore = a.kamuiUses;
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    const r2 = resolveReaction(r.state, false); // 拒绝 → 重放无标记
    expect(r2.state.replaySpecial).toBe(true);
    const r3 = enemyAct(r2.state, zeroRng);
    const masked = r3.state.allies.find((x) => x.uid === a.uid)!;
    const buddyNow = r3.state.allies.find((x) => x.uid === buddy.uid)!;
    expect(masked.kamuiUses).toBe(kamuiBefore); // 未消耗虚化（拒绝）
    expect(masked.buffs.some((x) => x.id === 'strength')).toBe(false); // 无强壮
    expect(buddyNow.hp).toBeLessThan(buddyHpBefore); // 队友照常承伤
  });

  it('肉山：拒绝虚化后重放并承受伤害', () => {
    const { b, a, foe } = setup('ct_068', 'ct_068');
    fixRouShan(foe, [1, 2]);
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    const hpBefore = a.hp;
    const r2 = resolveReaction(r.state, false);
    expect(r2.state.replaySpecial).toBe(true);
    const r3 = enemyAct(r2.state, zeroRng);
    expect(r3.state.replaySpecial).toBeFalsy();
    expect(r3.state.allies[0].hp).toBeLessThan(hpBefore); // 未虚化 → 单体物理承伤
  });

  it('劳贤（单体攻击）：被面具男虚化打断', () => {
    const { b } = setup('ct_077', 'ct_077');
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    expect(r.state.pendingReaction!.action.kind).toBe('special');
  });

  it('马神（眩晕重击回合）：被面具男虚化打断', () => {
    const { b } = setup('ct_078', 'ct_078');
    b.turn = 3; // 3/6/9/12 为单体重击回合
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    expect(r.state.pendingReaction!.action.kind).toBe('special');
  });

  it('马神（群体真伤回合）：弹窗选择闪避后仅面具男免疫自身，其他角色照常承伤', () => {
    const { b, a, foe } = setup('ct_078', 'ct_078');
    b.turn = 1; // 非3倍数 → 群体真伤
    const buddy = { ...a, uid: 'buddy_1', name: '队友', kamuiUses: undefined, kamuiMaxUses: undefined, mp: 0, maxMp: 0, skills: [], hp: a.maxHp, maxHp: a.maxHp };
    buddy.stats = { ...a.stats, spdMin: 1, spdMax: 1 };
    b.allies.push(buddy);
    b.order = [a.uid, foe.uid, buddy.uid];
    b.cursor = b.order.indexOf(foe.uid);
    const hpBefore = a.hp;
    const buddyHpBefore = buddy.hp;
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    const pa = r.state.pendingReaction!.action;
    expect(pa.kind === 'special' && pa.aoeKamui).toBe(true);
    const r2 = resolveReaction(r.state, true);
    const r3 = enemyAct(r2.state, zeroRng);
    const masked = r3.state.allies.find((x) => x.uid === a.uid)!;
    const buddyNow = r3.state.allies.find((x) => x.uid === buddy.uid)!;
    expect(masked.hp).toBe(hpBefore); // 面具男免疫自身
    expect(buddyNow.hp).toBeLessThan(buddyHpBefore); // 其他角色承伤
  });

  it('阿卡多（单体攻击）：被面具男虚化打断（非召唤回合）', () => {
    const { b } = setup('ct_070', 'ct_070');
    b.turn = 2; // 1/3/5/7/9 为召唤回合，用第2回合验证攻击
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    expect(r.state.pendingReaction!.action.kind).toBe('special');
  });

  it('阿卡多（召唤回合）：召唤食尸鬼不占用攻击，仍正常攻击', () => {
    const { b } = setup('ct_070', 'ct_070');
    b.turn = 1; // 召唤回合
    const r = enemyAct(b, zeroRng);
    // 已召唤食尸鬼
    expect(r.state.enemies.some((e) => e.monsterId === 'ct_069')).toBe(true);
    // 且本回合仍触发攻击的虚化弹窗（召唤不占用攻击）
    expect(r.state.pendingReaction).toBeTruthy();
  });

  it('马神（群体真伤回合）：拒绝闪避则全员照常承伤', () => {
    const { b, a, foe } = setup('ct_078', 'ct_078');
    b.turn = 1; // 非3倍数 → 群体真伤
    const buddy = { ...a, uid: 'buddy_1', name: '队友', kamuiUses: undefined, kamuiMaxUses: undefined, mp: 0, maxMp: 0, skills: [], hp: a.maxHp, maxHp: a.maxHp };
    buddy.stats = { ...a.stats, spdMin: 1, spdMax: 1 };
    b.allies.push(buddy);
    b.order = [a.uid, foe.uid, buddy.uid];
    b.cursor = b.order.indexOf(foe.uid);
    const hpBefore = a.hp;
    const buddyHpBefore = buddy.hp;
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    const r2 = resolveReaction(r.state, false);
    expect(r2.state.replaySpecial).toBe(true);
    const r3 = enemyAct(r2.state, zeroRng);
    const masked = r3.state.allies.find((x) => x.uid === a.uid)!;
    const buddyNow = r3.state.allies.find((x) => x.uid === buddy.uid)!;
    expect(masked.hp).toBeLessThan(hpBefore); // 面具男也承伤（真伤无速度限制）
    expect(buddyNow.hp).toBeLessThan(buddyHpBefore); // 队友承伤
  });

  it('阿卡多（双目标，血槽≥100）：弹窗选择闪避后仅面具男免疫自身，其他目标照常承伤', () => {
    const { b, a, foe } = setup('ct_070', 'ct_070');
    b.turn = 2;
    foe.crisis = { akado: { bloodPool: 100, revived: false } };
    const buddy = { ...a, uid: 'buddy_1', name: '队友', kamuiUses: undefined, kamuiMaxUses: undefined, mp: 0, maxMp: 0, skills: [], hp: a.maxHp, maxHp: a.maxHp };
    buddy.stats = { ...a.stats, spdMin: 1, spdMax: 1 };
    b.allies.push(buddy);
    b.order = [a.uid, foe.uid, buddy.uid];
    b.cursor = b.order.indexOf(foe.uid);
    const hpBefore = a.hp;
    const buddyHpBefore = buddy.hp;
    const r = enemyAct(b, zeroRng);
    expect(r.state.pendingReaction).toBeTruthy();
    const pa = r.state.pendingReaction!.action;
    expect(pa.kind === 'special' && pa.aoeKamui).toBe(true);
    const r2 = resolveReaction(r.state, true);
    const r3 = enemyAct(r2.state, zeroRng);
    const masked = r3.state.allies.find((x) => x.uid === a.uid)!;
    const buddyNow = r3.state.allies.find((x) => x.uid === buddy.uid)!;
    expect(masked.hp).toBe(hpBefore); // 面具男免疫自身
    expect(buddyNow.hp).toBeLessThan(buddyHpBefore); // 其他目标承伤
  });

  it('肉山 rollOrder 展开两个行动槽', () => {
    const { b } = setupMaskedVs('ct_068');
    const foe = b.enemies.find((e) => e.monsterId === 'ct_068')!;
    const slotCount = b.order.filter((u) => u.startsWith(foe.uid) && (u.endsWith('#act1') || u.endsWith('#act2'))).length;
    expect(slotCount).toBe(2);
  });
});
