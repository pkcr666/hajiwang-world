import { describe, expect, it } from 'vitest';
import { DEFAULT_MONSTERS } from '../../data/monsters';
import { buildAllyCombatant, buildEnemyCombatants } from '../unit';
import { itemMap, makeChar, TEST_COLOSSUS } from './helpers';

describe('buildAllyCombatant', () => {
  it('凯隐：物理普攻，MP60，法抗0，10级解锁2个技能', () => {
    const c = buildAllyCombatant(makeChar('kayn'), itemMap, 1);
    expect(c.uid).toBe('ally_1');
    expect(c.attackType).toBe('physical');
    expect(c.maxMp).toBe(60);
    expect(c.stats.mres).toBe(0);
    // 10级：被动 + 狂镰横扫（掠影步20级、裂舍影40级解锁）
    expect(c.skills.map((s) => s.id)).toEqual(['sk_kayn_passive', 'sk_kayn_scythe']);
  });
});

describe('buildEnemyCombatants', () => {
  it('普通怪展开为1个单位，无bossId', () => {
    const slime = DEFAULT_MONSTERS.find((m) => m.id === 'slime')!;
    const units = buildEnemyCombatants(slime, 2);
    expect(units).toHaveLength(1);
    expect(units[0].uid).toBe('enemy_2');
    expect(units[0].bossId).toBeUndefined();
    expect(units[0].ai).toBe('basic');
  });

  it('巨像展开为核心+2部位共3个单位', () => {
    const units = buildEnemyCombatants(TEST_COLOSSUS, 0);
    expect(units).toHaveLength(3);
    expect(units[0].isCore).toBe(true);
    expect(units[0].ai).toBe('boss');
    expect(units.slice(1).map((u) => u.ai)).toEqual(['caster', 'caster']);
    expect(units.map((u) => u.bossId)).toEqual(['enemy_0', 'enemy_0', 'enemy_0']);
  });

  it('关卡额外属性：scope=all 全体生效，scope=monster 仅指定怪；速度/法抗钳制', () => {
    const slime = DEFAULT_MONSTERS.find((m) => m.id === 'slime')!;
    const shroom = DEFAULT_MONSTERS.find((m) => m.id === 'mushroom') ?? DEFAULT_MONSTERS[1]!;
    const mech = [
      { id: 'm1', desc: '', scope: 'all' as const, hp: 50, atk: 10, def: 10, mres: 200, spdMin: 100, spdMax: 200 },
      { id: 'm2', desc: '', scope: 'monster' as const, monsterId: slime.id, hp: 20 },
    ];
    const [u1] = buildEnemyCombatants(slime, 0, undefined, mech);
    const [u2] = buildEnemyCombatants(shroom, 1, undefined, mech);
    // slime：全体 HP+50/ATK+10/DEF+10 + 指定 HP+20；法抗钳90；速度钳99
    expect(u1.maxHp).toBe(slime.stats.hp + 70);
    expect(u1.stats.atk).toBe(slime.stats.atk + 10);
    expect(u1.stats.def).toBe(slime.stats.def + 10);
    expect(u1.stats.mres).toBe(90);
    expect(u1.stats.spdMin).toBe(99);
    expect(u1.stats.spdMax).toBe(99);
    // 其他怪：只吃全体一条
    expect(u2.maxHp).toBe(shroom.stats.hp + 50);
    expect(u2.stats.atk).toBe(shroom.stats.atk + 10);
  });
});