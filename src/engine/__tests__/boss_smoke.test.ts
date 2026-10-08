import { describe, expect, it } from 'vitest';
import type { MonsterUnit } from '../../types';
import { DEFAULT_MONSTERS } from '../../data/monsters';
import { advance, createBattle, enemyAct } from '../battle';
import { buildEnemyCombatants } from '../unit';
import { makeAlly, zeroRng } from './helpers';

const mapOf = (list: MonsterUnit[]) => new Map(list.map((m) => [m.id, m]));
const find = (id: string) => DEFAULT_MONSTERS.find((x) => x.id === id)!;
const build = (id: string, index = 0) => buildEnemyCombatants(find(id), index, mapOf(DEFAULT_MONSTERS));

function plainAlly() {
  const a = makeAlly();
  a.skills = a.skills.filter((s) => s.kind !== 'reaction');
  return a;
}

function runBoss(id: string, turns = 4): void {
  const a = plainAlly();
  const enemies = build(id, 0);
  let b = createBattle([a], enemies, zeroRng);
  for (let t = 0; t < turns; t++) {
    // 推进所有敌方行动
    let guard = 0;
    while (b.cursor < b.order.length && !b.result && guard < 50) {
      const cur = b.order[b.cursor];
      const real = cur?.replace(/_(potian|mingwang)$/, '');
      const u = b.enemies.find((e) => e.uid === real);
      if (u && u.alive) {
        const r = enemyAct(b, zeroRng);
        b = r.state;
      } else {
        b.cursor++;
      }
      guard++;
    }
    if (b.result) break;
    b = advance(b, zeroRng);
  }
}

const BOSS_IDS = [
  'ct_026', 'ct_027', 'ct_037', 'ct_041', 'ct_042',
  'ct_057', 'ct_068', 'ct_075', 'ct_076', 'ct_079', 'ct_083',
];

describe('灾厄 BOSS 烟雾测试', () => {
  for (const id of BOSS_IDS) {
    it(`${id} 运行4回合不崩溃`, () => {
      expect(() => runBoss(id, 4)).not.toThrow();
    });
  }

  it('世界吞噬者：展开为5个部位，AOE减免60%', () => {
    const enemies = build('ct_026', 0);
    expect(enemies).toHaveLength(5);
    for (const e of enemies) {
      expect(e.aoeReductionPct).toBe(60);
      expect(e.bossId).toBeDefined();
    }
  });

  it('克苏鲁之脑：开局无敌并召唤4眼球', () => {
    const enemies = build('ct_027', 0);
    const b = createBattle([plainAlly()], enemies, zeroRng);
    const brain = b.enemies.find((e) => e.monsterId === 'ct_027')!;
    expect(brain.invincible).toBe(true);
    const eyes = b.enemies.filter((e) => e.monsterId === 'ct_027_eye');
    expect(eyes).toHaveLength(4);
  });

  it('腐巢意志：开局无敌并召唤腐化囊+2噬魂怪', () => {
    const enemies = build('ct_042', 0);
    const b = createBattle([plainAlly()], enemies, zeroRng);
    const host = b.enemies.find((e) => e.monsterId === 'ct_042')!;
    expect(host.invincible).toBe(true);
    expect(b.enemies.filter((e) => e.monsterId === 'ct_042_sac')).toHaveLength(1);
    expect(b.enemies.filter((e) => e.monsterId === 'ct_030')).toHaveLength(2);
  });

  it('骷髅王：展开为头+双手', () => {
    const enemies = build('ct_057', 0);
    expect(enemies).toHaveLength(3);
    const head = enemies.find((e) => e.monsterId === 'ct_057_head')!;
    expect(head.isCore).toBe(true);
    expect(enemies.filter((e) => e.monsterId === 'ct_057_hand')).toHaveLength(2);
  });

  it('无敌单位免疫伤害与BUFF', () => {
    const a = plainAlly();
    const e = build('ct_027', 0);
    const b = createBattle([a], e, zeroRng);
    const brain = b.enemies.find((x) => x.monsterId === 'ct_027')!;
    expect(brain.invincible).toBe(true);
    // 直接伤害应被免疫
    const hpBefore = brain.hp;
    enemyAct({ ...b, cursor: b.order.indexOf(a.uid) } as never, zeroRng);
    expect(brain.hp).toBe(hpBefore);
  });
});
