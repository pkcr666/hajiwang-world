import { describe, expect, it } from 'vitest';
import type { BaseStats, Item } from '../../types';
import { makeCombatant } from '../damage';
import { advance, createBattle, enemyAct, getLegalActions, playerAct } from '../battle';
import { collectPassives } from '../stats';

const S = (o: Partial<BaseStats> = {}): BaseStats => ({
  hp: 100, mp: 0, atk: 20, def: 0, mres: 0, spdMin: 2, spdMax: 5, ...o,
});

describe('致命保血（不死鸟之羽）', () => {
  it('受到致命伤时保留1血，且每场战斗只触发一次', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ hp: 10 }), passives: { surviveLethal: true } });
    const foe1 = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '杀手甲', stats: S({ hp: 1000, atk: 100 }) });
    const foe2 = makeCombatant({ uid: 'enemy_1', side: 'enemy', name: '杀手乙', stats: S({ hp: 1000, atk: 100 }) });
    const b = createBattle([ally], [foe1, foe2]);
    b.order = ['enemy_0', 'enemy_1', 'ally_0'];
    b.cursor = 0;

    const r1 = enemyAct(b);
    const a1 = r1.state.allies[0];
    expect(a1.hp).toBe(1);
    expect(a1.alive).toBe(true);
    expect(a1.surviveUsed).toBe(true);
    expect(r1.state.result).toBeNull();
    expect(r1.events.some((e) => e.t === 'survive')).toBe(true);
    expect(r1.events.find((e) => e.t === 'damage')?.t === 'damage' && (r1.events.find((e) => e.t === 'damage') as { killed: boolean }).killed).toBe(false);

    // 第二个敌人紧接着补刀：保命已用，正常倒下
    const b2 = advance(r1.state);
    expect(b2.order[b2.cursor]).toBe('enemy_1');
    const r2 = enemyAct(b2);
    const a2 = r2.state.allies[0];
    expect(a2.alive).toBe(false);
    expect(a2.hp).toBe(0);
    expect(r2.state.result).toBe('lose');
    expect(r2.events.some((e) => e.t === 'survive')).toBe(false);
  });

  it('没有被动时致命伤直接击杀', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ hp: 10 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '杀手', stats: S({ hp: 1000, atk: 100 }) });
    const b = createBattle([ally], [foe]);
    b.order = ['enemy_0', 'ally_0'];
    b.cursor = 0;

    const r = enemyAct(b);
    expect(r.state.allies[0].alive).toBe(false);
    expect(r.state.result).toBe('lose');
    expect(r.events.some((e) => e.t === 'survive')).toBe(false);
  });
});

describe('普攻群攻（狂战之魂）', () => {
  it('普攻对每个存活敌方各造成一次100%伤害', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '狂战', stats: S({ atk: 30 }), passives: { basicAttackAll: true } });
    const foe1 = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆甲', stats: S({ hp: 50 }) });
    const foe2 = makeCombatant({ uid: 'enemy_1', side: 'enemy', name: '史莱姆乙', stats: S({ hp: 50 }) });
    const b = createBattle([ally], [foe1, foe2]);
    b.order = ['ally_0', 'enemy_0', 'enemy_1'];
    b.cursor = 0;

    expect(getLegalActions(b, new Map()).attackAll).toBe(true);

    const r = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, new Map());
    expect(r.state.enemies.map((e) => e.hp)).toEqual([20, 20]);
    const action = r.events.find((e) => e.t === 'action');
    expect(action?.t === 'action' && action.targetUids).toEqual(['enemy_0', 'enemy_1']);
    expect(r.events.filter((e) => e.t === 'damage')).toHaveLength(2);
  });

  it('群攻击杀所有目标时正常判胜', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '狂战', stats: S({ atk: 100 }), passives: { basicAttackAll: true } });
    const foe1 = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '甲', stats: S({ hp: 5 }) });
    const foe2 = makeCombatant({ uid: 'enemy_1', side: 'enemy', name: '乙', stats: S({ hp: 5 }) });
    const b = createBattle([ally], [foe1, foe2]);
    b.order = ['ally_0', 'enemy_0', 'enemy_1'];
    b.cursor = 0;

    const r = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, new Map());
    expect(r.state.enemies.every((e) => !e.alive)).toBe(true);
    expect(r.state.result).toBe('win');
  });

  it('无群攻被动时普攻仍然只打单体', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '平A', stats: S({ atk: 30 }) });
    const foe1 = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '甲', stats: S({ hp: 50 }) });
    const foe2 = makeCombatant({ uid: 'enemy_1', side: 'enemy', name: '乙', stats: S({ hp: 50 }) });
    const b = createBattle([ally], [foe1, foe2]);
    b.order = ['ally_0', 'enemy_0', 'enemy_1'];
    b.cursor = 0;

    expect(getLegalActions(b, new Map()).attackAll).toBe(false);
    const r = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, new Map());
    expect(r.state.enemies.map((e) => e.hp)).toEqual([20, 50]);
  });
});

describe('藏品被动装配', () => {
  it('饰品被动汇总到战斗单位', () => {
    const phoenix: Item = {
      id: 't_phoenix', name: '不死鸟之羽', slot: 'accessory', rarity: 'epic', price: 0,
      passives: { surviveLethal: true }, desc: '',
    };
    const berserk: Item = {
      id: 't_berserk', name: '狂战之魂', slot: 'accessory', rarity: 'epic', price: 0,
      passives: { basicAttackAll: true }, desc: '',
    };
    expect(collectPassives([phoenix])).toEqual({ surviveLethal: true });
    expect(collectPassives([berserk]).basicAttackAll).toBe(true);
    // 同名被动按或汇总
    expect(collectPassives([phoenix, berserk])).toEqual({ surviveLethal: true, basicAttackAll: true });
  });

  it('附魔武器被动：basicAttackMagic 与 onHitMagicBonus 汇总', () => {
    const enchanted: Item = {
      id: 't_ench', name: '附魔剑', slot: 'weapon', rarity: 'epic', price: 0,
      weaponType: 'melee', passives: { onHitMagicBonus: 30 }, desc: '',
    };
    const staff: Item = {
      id: 't_staff', name: '木杖', slot: 'weapon', rarity: 'common', price: 0,
      weaponType: 'magic', passives: { basicAttackMagic: true }, desc: '',
    };
    expect(collectPassives([enchanted]).onHitMagicBonus).toBe(30);
    expect(collectPassives([staff]).basicAttackMagic).toBe(true);
  });
});
