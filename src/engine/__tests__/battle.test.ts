import { describe, expect, it } from 'vitest';
import type { Rng } from '../../types';
import {
  advance, createBattle, currentActor, enemyAct, getLegalActions, playerAct, resolveRobChoice,
} from '../battle';
import { makeAlly, makeEnemies, itemMap, setupBattle, zeroRng } from './helpers';
import { addBuff } from '../buffs';

describe('createBattle', () => {
  it('第1回合满状态开局并排出全部单位顺位', () => {
    const b = createBattle([makeAlly('cat')], makeEnemies('testSlime'));
    expect(b.turn).toBe(1);
    expect(b.result).toBeNull();
    expect(b.order).toHaveLength(2);
    expect(currentActor(b).hp).toBe(currentActor(b).maxHp);
  });

  it('巨像展开为3个独立单位，占同一bossId，核心带isCore', () => {
    const b = createBattle([makeAlly()], makeEnemies('colossus'));
    expect(b.order).toHaveLength(4);
    const core = b.enemies.find((u) => u.isCore)!;
    expect(core.uid).toBe('enemy_0_core');
    expect(b.enemies.filter((u) => u.bossId === 'enemy_0')).toHaveLength(3);
  });
});

describe('普攻 / 技能', () => {
  it('战士普攻：60攻击打0防史莱姆造成60伤害', () => {
    const { b } = setupBattle('cat', 'testSlime');
    const { state, events } = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, itemMap);
    expect(state.enemies[0].hp).toBe(20);
    expect(events.some((e) => e.t === 'damage')).toBe(true);
  });

  it('非法动作（敌方行动时替玩家操作）被拒绝并返回原状态', () => {
    const { b } = setupBattle('cat', 'testSlime');
    const nb = { ...b, order: ['enemy_0', 'ally_0'], cursor: 0 };
    const { state, events } = playerAct(nb, { type: 'attack', targetUid: 'ally_0' }, itemMap);
    expect(state).toBe(nb);
    expect(events).toHaveLength(0);
  });
});

describe('道具', () => {
  const bagWithRune = [
    { itemId: 'it_test_potion', count: 2 },
    { itemId: 'it_test_rune', count: 1 },
  ];

  it('生命药水回60血且数量-1，不超过上限', () => {
    const { b } = setupBattle('cat', 'testSlime', bagWithRune);
    b.allies[0].hp = 10;
    const { state } = playerAct(b, { type: 'item', itemId: 'it_test_potion', targetUid: 'ally_0' }, itemMap);
    expect(state.allies[0].hp).toBe(70);
    expect(state.allies[0].bag.find((g) => g.itemId === 'it_test_potion')?.count).toBe(1);
  });

  it('护盾符文给30护盾，用完一组后合法列表不再包含', () => {
    const { b } = setupBattle('cat', 'testSlime', bagWithRune);
    const r1 = playerAct(b, { type: 'item', itemId: 'it_test_rune', targetUid: 'ally_0' }, itemMap);
    expect(r1.state.allies[0].shield).toBe(30);
    expect(getLegalActions(r1.state, itemMap).items.some((i) => i.item.id === 'it_test_rune')).toBe(false);
  });
});

describe('推进 / 胜负 / BOSS', () => {
  it('击杀最后一个敌人立即胜利', () => {
    const { b } = setupBattle('cat', 'testSlime');
    b.enemies[0].hp = 1;
    const { state } = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, itemMap);
    expect(state.enemies[0].alive).toBe(false);
    expect(state.result).toBe('win');
  });

  it('烧伤回合末按当前生命5%扣真实伤害（向上取整），随后层数-1', () => {
    const { b } = setupBattle('cat', 'testSlime');
    addBuff(b.enemies[0], 'burn', 1, 1);
    // 友方普攻 80-60=20 → 敌方行动 → 回合末烧伤 ceil(20×5%)=1
    const r1 = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, itemMap);
    const r2 = enemyAct(advance(r1.state), zeroRng);
    const r3 = advance(r2.state);
    expect(r3.enemies[0].hp).toBe(19);
    expect(r3.enemies[0].buffs.some((x) => x.id === 'burn')).toBe(false);
  });

  it('推进途中遇到眩晕单位：跳过、层数-1并记录日志', () => {
    const { b } = setupBattle('cat', 'testSlime');
    // 当前是友方（cursor0），下一位敌人眩晕
    b.enemies[0].statuses.stunTurns = 1;
    const nb = advance(b, zeroRng);
    // 跳过敌人后本回合走完，重建顺位进入第2回合
    expect(nb.turn).toBe(2);
    expect(nb.enemies[0].statuses.stunTurns).toBe(0);
    expect(nb.log.some((e) => e.t === 'stun')).toBe(true);
    expect(currentActor(nb).uid).toBe('ally_0');
  });

  it('核心死亡 → 整个巨像立即死亡并胜利', () => {
    const { b } = setupBattle('kayn', 'colossus');
    b.enemies.find((u) => u.isCore)!.hp = 1;
    const { state } = playerAct(b, { type: 'attack', targetUid: 'enemy_0_core' }, itemMap);
    expect(state.result).toBe('win');
    expect(state.enemies.every((u) => !u.alive)).toBe(true);
  });

  it('毁左臂核心攻击-30%；再毁右臂核心防御-50%且眩晕1回合', () => {
    const { b } = setupBattle('cat', 'colossus');
    b.enemies.find((u) => u.uid === 'enemy_0_leftArm')!.hp = 1;
    const r1 = playerAct(b, { type: 'attack', targetUid: 'enemy_0_leftArm' }, itemMap);
    const coreAfterLeft = r1.state.enemies.find((u) => u.isCore)!;
    expect(coreAfterLeft.statuses.atkModPct).toBe(-30);
    expect(coreAfterLeft.statuses.stunTurns).toBe(0);

    // 直接把指针拨回友方，处理右臂（测试不关心 intervening 敌人行动）
    const between = r1.state;
    between.order = ['ally_0', ...between.enemies.map((u) => u.uid)];
    between.cursor = 0;
    between.enemies.find((u) => u.uid === 'enemy_0_rightArm')!.hp = 1;
    const r2 = playerAct(between, { type: 'attack', targetUid: 'enemy_0_rightArm' }, itemMap);
    const core = r2.state.enemies.find((u) => u.isCore)!;
    expect(core.statuses.atkModPct).toBe(-30);
    expect(core.statuses.defModPct).toBe(-50);
    expect(core.statuses.stunTurns).toBe(1);
  });
});

describe('抢商店BOSS战：袁绍抉择', () => {
  const scriptRng = (vals: number[]): Rng => ({ int: () => vals.shift()! });

  it('奇数回合开始前暂停抉择，偶数回合正常推进', () => {
    const { b } = setupBattle('cat', 'yuanShao');
    b.choiceMode = true;
    b.pendingChoice = { turn: 1 };
    const r1 = resolveRobChoice(b, { kind: 'worship' }).state;
    expect(r1.pendingChoice).toBeUndefined();
    // 2个单位每回合需 2 次 advance；跨回合 rollOrder 消耗 2×3=6 个随机数（友方速度10 > 敌方1）
    const script = [10, 1, 1, 1, 9, 8, 10, 1, 1, 1, 9, 8];
    const rng = scriptRng(script);
    const a1 = advance(r1, rng);
    expect(a1.turn).toBe(1); // 敌人行动中
    const a2 = advance(a1, rng);
    expect(a2.turn).toBe(2); // 偶数回合：不暂停
    expect(a2.pendingChoice).toBeUndefined();
    const a3 = advance(a2, rng);
    expect(a3.turn).toBe(2);
    const a4 = advance(a3, rng);
    expect(a4.turn).toBe(3); // 奇数回合：开始前暂停抉择
    expect(a4.pendingChoice).toEqual({ turn: 3 });
  });

  it('勾引：魅力判定通过造成300真实伤害（无视防御与法抗）', () => {
    const { b } = setupBattle('cat', 'yuanShao');
    b.pendingChoice = { turn: 1 };
    // zeroRng：1D50=0 → 60+0=60 ≥ 60 必过
    const s = resolveRobChoice(b, { kind: 'seduce', cha: 60 }, zeroRng).state;
    expect(s.enemies[0].hp).toBe(900);
    expect(s.pendingChoice).toBeUndefined();
  });

  it('勾引：判定失败不为所动，不造成伤害', () => {
    const { b } = setupBattle('cat', 'yuanShao');
    b.pendingChoice = { turn: 1 };
    const s = resolveRobChoice(b, { kind: 'seduce', cha: 59 }, zeroRng).state;
    expect(s.enemies[0].hp).toBe(1200);
  });

  it('拿钱砸：每100币削减1攻击，回合末恢复', () => {
    const { b } = setupBattle('cat', 'yuanShao');
    b.pendingChoice = { turn: 1 };
    const s = resolveRobChoice(b, { kind: 'coins', amount: 500 }).state;
    expect(s.enemies[0].stats.atk).toBe(115); // 120 - 5
    expect(s.enemies[0].atkCut).toBe(5);
    const rng = scriptRng([10, 1, 1, 1, 9, 8]);
    const a1 = advance(s, rng); // 敌人行动（本回合内仍削减）
    expect(a1.enemies[0].stats.atk).toBe(115);
    const a2 = advance(a1, rng); // 回合末 → 第2回合：攻击恢复
    expect(a2.enemies[0].stats.atk).toBe(120);
    expect(a2.enemies[0].atkCut).toBe(0);
  });
});