import type { BattleState, BossDef, Character, Combatant, Equip, ExtraStats, Job, MonsterUnit, Rng, Skill } from '../../types';
import { itemMapOf } from '../../data/content';
import { JOB_DEFS, STARTER_BAG } from '../../data/jobs';
import { DEFAULT_MONSTERS } from '../../data/monsters';
import { LEVEL_BASE } from '../stats';
import { createBattle } from '../battle';
import { buildAllyCombatant, buildEnemyCombatants } from '../unit';

export const itemMap = itemMapOf({ customItems: [] });

// 测试专用消耗品（正式图鉴已移除消耗品，此处仅用于测试道具机制）
itemMap.set('it_test_potion', {
  id: 'it_test_potion', name: '测试药水', slot: 'consumable', rarity: 'common', price: 0,
  usable: { hp: 60 }, desc: '回60血',
});
itemMap.set('it_test_rune', {
  id: 'it_test_rune', name: '测试符文', slot: 'consumable', rarity: 'common', price: 0,
  usable: { shield: 30 }, desc: '30护盾',
});

const BASE_EXTRA: ExtraStats = { str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 10 };

export function makeChar(
  job: Job = 'cat',
  bag: Character['bag'] = STARTER_BAG.map((b) => ({ ...b })),
  level = LEVEL_BASE,
): Character {
  const equip: Equip = { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] };
  for (const id of JOB_DEFS[job].startItems) {
    const it = itemMap.get(id)!;
    if (it.slot === 'weapon') equip.weapon = id;
    else if (it.slot === 'helmet') equip.helmet = id;
    else if (it.slot === 'armor') equip.armor = id;
    else if (it.slot === 'boots') equip.boots = id;
  }
  return { id: `c_${job}`, name: JOB_DEFS[job].name, job, level, extra: { ...BASE_EXTRA }, equip, relics: [], inventory: [], bag, storage: [], coins: 0, createdAt: 0 };
}

export function makeAlly(job: Job = 'cat', bag?: Character['bag']): Combatant {
  return buildAllyCombatant(makeChar(job, bag), itemMap, 0);
}

export function makeEnemies(enemyId: string): Combatant[] {
  const m = enemyId === 'colossus'
    ? TEST_COLOSSUS
    : enemyId === 'testCaster'
      ? TEST_CASTER
      : enemyId === 'testSlime'
        ? TEST_SLIME
        : DEFAULT_MONSTERS.find((x) => x.id === enemyId)!;
  return buildEnemyCombatants(m, 0, new Map(DEFAULT_MONSTERS.map((x) => [x.id, x])));
}

// ===== 测试专用怪物夹具（正式图鉴已不包含，仅用于覆盖多部位BOSS/施法AI引擎逻辑） =====
const s = (
  hp: number, atk: number, def: number, mres: number,
  spdMin: number, spdMax: number,
) => ({ hp, mp: 0, atk, def, mres, spdMin, spdMax });

const TEST_BOLT: Skill = {
  id: 'sk_test_bolt', name: '测试暗影弹', kind: 'active', mpCost: 0, target: 'enemyOne',
  damageType: 'magical', multiplier: 1.3, cooldown: 2, desc: '测试用130%法术单体。',
};
export const TEST_CASTER: MonsterUnit = {
  id: 'testCaster', name: '测试法师', desc: '施法AI测试夹具。',
  stats: s(120, 32, 5, 10, 2, 5), skills: [TEST_BOLT], ai: 'caster',
};

// 数值稳定的测试史莱姆：引擎机制断言依赖它，不随图鉴改数值而波动
export const TEST_SLIME: MonsterUnit = {
  id: 'testSlime', name: '测试史莱姆', desc: '引擎测试夹具。',
  stats: s(80, 18, 0, 0, 1, 3), skills: [], ai: 'basic',
};

const TEST_BEAM: Skill = {
  id: 'sk_test_beam', name: '核心光束', kind: 'active', mpCost: 0, target: 'enemyOne',
  damageType: 'magical', multiplier: 1, desc: '100%法术单体。',
};
const TEST_BURST: Skill = {
  id: 'sk_test_burst', name: '魔光爆发', kind: 'active', mpCost: 0, target: 'enemyAll',
  damageType: 'magical', multiplier: 1.2, cooldown: 3, desc: '120%法术群体。',
};
const TEST_ARMSMASH: Skill = {
  id: 'sk_test_armsmash', name: '左臂重击', kind: 'active', mpCost: 0, target: 'enemyOne',
  damageType: 'physical', multiplier: 1.5, cooldown: 2, desc: '150%物理单体。',
};
const TEST_ARMSWEEP: Skill = {
  id: 'sk_test_armsweep', name: '右臂横扫', kind: 'active', mpCost: 0, target: 'enemyAll',
  damageType: 'physical', multiplier: 0.8, cooldown: 3, desc: '80%物理群体。',
};
export const TEST_COLOSSUS: BossDef = {
  id: 'colossus', name: '测试巨像', desc: '多部位BOSS引擎夹具。', ai: 'boss', enrageThreshold: 0.5,
  stats: s(300, 35, 10, 15, 1, 2),
  skills: [TEST_BURST, TEST_BEAM],
  parts: [
    { id: 'core', name: '核心', onBreak: null,
      stats: s(300, 35, 10, 15, 1, 2), skills: [TEST_BURST, TEST_BEAM] },
    { id: 'leftArm', name: '左臂', onBreak: 'coreAtkDown30',
      stats: s(150, 40, 10, 10, 2, 4), skills: [TEST_ARMSMASH] },
    { id: 'rightArm', name: '右臂', onBreak: 'coreDefDown50',
      stats: s(150, 40, 10, 10, 2, 4), skills: [TEST_ARMSWEEP] },
  ],
};

export interface Setup {
  b: BattleState;
  allyUid: string;
  enemyUids: string[];
}

// 开战并强制友方排在最前（测试只关心规则，不关心掷点顺序时使用）
export function setupBattle(job: Job = 'cat', enemyId = 'testSlime', bag?: Character['bag']): Setup {
  const a = makeAlly(job, bag);
  const es = makeEnemies(enemyId);
  const b = createBattle([a], es);
  b.order = [a.uid, ...es.map((u) => u.uid)];
  b.cursor = 0;
  return { b, allyUid: a.uid, enemyUids: es.map((u) => u.uid) };
}

export const zeroRng: Rng = { int: () => 0 };
