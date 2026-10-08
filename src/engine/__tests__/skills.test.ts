import { describe, expect, it } from 'vitest';
import type { Character, RunState, SaveData } from '../../types';
import {
  availableSkillPoints, canUpgradeSkill, earnedSkillPoints, exclusiveSkillsOf,
  resolveCharacterSkills, resolveSkill, skillLevelOf, skillPointsEarned, skillUnlocked,
  spentSkillPoints,
} from '../skills';
import { SKILL_MAP } from '../../data/skills';
import { JOB_DEFS } from '../../data/jobs';
import { calcDamage } from '../damage';
import { playerAct, enemyAct, advance } from '../battle';
import { buildAllyCombatant } from '../unit';
import { applyTutorialRewards, completeRunWithLoot, spendFreePoint, upgradeSkill, TUTORIAL_DUNGEON_ID } from '../../save/storage';
import { makeChar, makeEnemies, itemMap, setupBattle, zeroRng } from './helpers';

// ===== 技能点体系 =====
describe('技能点', () => {
  it('从 20 级起每 10 级获得 1 点（10级=0、20级=1、50级=4）', () => {
    expect(skillPointsEarned(10)).toBe(0);
    expect(skillPointsEarned(20)).toBe(1);
    expect(skillPointsEarned(30)).toBe(2);
    expect(skillPointsEarned(50)).toBe(4);
  });

  it('可用 = 已获得 - 已消耗；创建角色 10 级有 0 点', () => {
    const c = makeChar('typhon');
    expect(earnedSkillPoints(c)).toBe(0);
    expect(spentSkillPoints(c)).toBe(0);
    expect(availableSkillPoints(c)).toBe(0);
  });

  it('升级消耗技能点：skillPoints 3 + 1 级已升 → 可用 2', () => {
    const c = { ...makeChar('typhon'), skillPoints: 3, skillLevels: { sk_typhon_triple: 2 } };
    expect(spentSkillPoints(c)).toBe(1);
    expect(availableSkillPoints(c)).toBe(2);
    expect(skillLevelOf(c, 'sk_typhon_triple')).toBe(2);
  });

  it('canUpgradeSkill：已解锁+未满级+有技能点才可升级', () => {
    const c = { ...makeChar('typhon'), skillPoints: 1 }; // 手动给1点模拟20级
    expect(canUpgradeSkill(c, SKILL_MAP.sk_typhon_triple)).toBe(true); // Lv.1→2，有1点
    expect(canUpgradeSkill(c, SKILL_MAP.sk_typhon_hunt)).toBe(false); // 40级解锁，10级未解锁
    const cFull = { ...c, skillLevels: { sk_typhon_triple: 3 } };
    expect(canUpgradeSkill(cFull, SKILL_MAP.sk_typhon_triple)).toBe(false); // 已满级
    const cNoPoint = { ...c, skillPoints: 0 };
    expect(canUpgradeSkill(cNoPoint, SKILL_MAP.sk_typhon_triple)).toBe(false); // 无技能点
  });

  it('upgradeSkill 落档：+1 级并扣点；非法请求拒绝', () => {
    const s: SaveData = {
      version: 1,
      characters: [makeChar('typhon', undefined, 20)], // 20级 → 1 点
      customItems: [], customMonsters: [], customStages: [], materials: [], coinsInStorage: 0,
      party: null, activeRun: null,
    };
    const next = upgradeSkill(s, 'c_typhon', 'sk_typhon_triple');
    expect(next.characters[0]!.skillLevels).toEqual({ sk_typhon_triple: 2 });
    expect(availableSkillPoints(next.characters[0]!)).toBe(0); // 20级1点 - 升级消耗1点 = 0
    // 未解锁技能不可升级
    const locked = upgradeSkill(s, 'c_typhon', 'sk_typhon_hunt');
    expect(locked.characters[0]!.skillLevels).toBeUndefined();
  });
});

// ===== 专属技能解锁进程 =====
describe('专属技能解锁', () => {
  it('提丰初始 2 个专属，20 级解锁第 3 个（被动），40 级解锁第 4 个', () => {
    const at = (level: number) => resolveCharacterSkills({ ...makeChar('typhon'), level });

    expect(at(10).skills.map((s) => s.id)).toEqual(['sk_typhon_triple', 'sk_typhon_pierce']);
    expect(at(10).ignoreDefPct).toBe(0);

    const lv20 = at(20);
    expect(lv20.skills.map((s) => s.id)).toEqual(['sk_typhon_triple', 'sk_typhon_pierce', 'sk_typhon_recon']);
    expect(lv20.ignoreDefPct).toBe(0.1);

    const lv40 = at(40);
    expect(lv40.skills.map((s) => s.id)).toEqual(['sk_typhon_triple', 'sk_typhon_pierce', 'sk_typhon_recon', 'sk_typhon_hunt']);
  });

  it('skillUnlocked 按角色等级判断', () => {
    expect(skillUnlocked(SKILL_MAP.sk_typhon_triple, 10)).toBe(true);
    expect(skillUnlocked(SKILL_MAP.sk_typhon_recon, 19)).toBe(false);
    expect(skillUnlocked(SKILL_MAP.sk_typhon_recon, 20)).toBe(true);
    expect(skillUnlocked(SKILL_MAP.sk_typhon_hunt, 40)).toBe(true);
  });
});

// ===== 提丰专属技能等级数据 =====
describe('提丰技能等级数据', () => {
  it('超绝3连发：10MP，80%/100%/120% ×3 单体物理', () => {
    const sk = SKILL_MAP.sk_typhon_triple;
    expect(resolveSkill(sk, 1)).toMatchObject({ mpCost: 10, multiplier: 0.8, hits: 3 });
    expect(resolveSkill(sk, 2)).toMatchObject({ mpCost: 10, multiplier: 1, hits: 3 });
    expect(resolveSkill(sk, 3)).toMatchObject({ mpCost: 10, multiplier: 1.2, hits: 3 });
  });

  it('贯穿射击：20/15/15MP，100%/120%/150% 群体物理', () => {
    const sk = SKILL_MAP.sk_typhon_pierce;
    expect(resolveSkill(sk, 1)).toMatchObject({ mpCost: 20, multiplier: 1, target: 'enemyAll' });
    expect(resolveSkill(sk, 2)).toMatchObject({ mpCost: 15, multiplier: 1.2 });
    expect(resolveSkill(sk, 3)).toMatchObject({ mpCost: 15, multiplier: 1.5 });
  });

  it('弱点侦查：无视 10%/20%/30% 防御（被动）', () => {
    const sk = SKILL_MAP.sk_typhon_recon;
    expect(sk.kind).toBe('passive');
    expect(resolveSkill(sk, 1)?.ignoreDefPct).toBe(0.1);
    expect(resolveSkill(sk, 2)?.ignoreDefPct).toBe(0.2);
    expect(resolveSkill(sk, 3)?.ignoreDefPct).toBe(0.3);
  });

  it('永恒狩猎：50/40/40MP，标记回合末 100%/100%/120%，破甲3层强度3/4/5', () => {
    const sk = SKILL_MAP.sk_typhon_hunt;
    expect(resolveSkill(sk, 1)).toMatchObject({
      mpCost: 50, markPct: 1,
      applyBuffs: [{ id: 'armorBreak', stacks: 3, intensity: 3, target: 'enemy' }],
    });
    expect(resolveSkill(sk, 2)?.applyBuffs?.[0]).toMatchObject({ id: 'armorBreak', stacks: 3, intensity: 4 });
    expect(resolveSkill(sk, 3)).toMatchObject({ mpCost: 40, markPct: 1.2 });
    expect(resolveSkill(sk, 3)?.applyBuffs?.[0]).toMatchObject({ id: 'armorBreak', stacks: 3, intensity: 5 });
  });
});

// ===== 战斗实装 =====
// 永恒狩猎 40 级解锁：战斗测试统一把角色技能解析为 40 级技能集
const withLv40Skills = (sb: ReturnType<typeof setupBattle>): ReturnType<typeof setupBattle> => {
  sb.b.allies[0].skills = resolveCharacterSkills({ ...makeChar('typhon'), level: 40 }).skills;
  return sb;
};

describe('永恒狩猎 · 狩猎标记', () => {
  it('重复施放刷新标记不叠加；施放者死亡后不再结算', () => {
    const { b, enemyUids } = withLv40Skills(setupBattle('typhon', 'testSlime'));
    const r1 = playerAct(b, { type: 'skill', skillId: 'sk_typhon_hunt', targetUid: enemyUids[0] }, itemMap);
    const st = r1.state;
    // 第二次施放（灌满 MP 保证耗魔不拒绝）
    st.allies[0].mp = 999;
    const r2 = playerAct(st, { type: 'skill', skillId: 'sk_typhon_hunt', targetUid: enemyUids[0] }, itemMap);
    const marks = r2.state.enemies[0].buffs.filter((x) => x.id === 'huntMark');
    expect(marks).toHaveLength(1); // 刷新不叠加
    expect(marks[0]).toMatchObject({ stacks: 1, intensity: 1 });
    // 施放者死亡：回合末不再触发伤害
    r2.state.allies[0].alive = false;
    const r3 = advance(r2.state);
    const r4 = enemyAct(r3, zeroRng);
    const r5 = advance(r4.state);
    expect(r5.enemies[0].hp).toBe(80); // 未受伤
  });
});

describe('弱点侦查 · 无视防御', () => {
  it('20级提丰的被动随角色进入战斗，物理伤害按 10% 无视防御', () => {
    const c: Character = { ...makeChar('typhon', undefined, 20) };
    const a = buildAllyCombatant(c, itemMap, 0);
    expect(a.ignoreDefPct).toBe(0.1);
    const e = makeEnemies('testSlime')[0];
    e.stats.def = 30;
    const dmgWith = calcDamage(a, e, 1, 'physical');
    const prev = a.ignoreDefPct;
    a.ignoreDefPct = 0;
    const dmgWithout = calcDamage(a, e, 1, 'physical');
    a.ignoreDefPct = prev;
    expect(dmgWith).toBeGreaterThan(dmgWithout);
    expect(dmgWith - dmgWithout).toBe(Math.ceil(30 * 0.1)); // 无视 10% 防御 = 3 点
  });
});

// ===== 新手村通关奖励 =====
describe('新手村教学完成奖励', () => {
  const mkRun = (): RunState => ({
    dungeonId: TUTORIAL_DUNGEON_ID,
    party: { leaderId: 'c1', memberIds: ['c1'] },
    acts: {
      1: { act: 1, cols: 1, rows: 1, nodes: [{ id: 'A', act: 1, col: 0, row: 0, kind: 'combat' }], edges: [] },
      2: { act: 2, cols: 1, rows: 1, nodes: [{ id: 'B', act: 2, col: 0, row: 0, kind: 'boss' }], edges: [] },
      3: { act: 3, cols: 1, rows: 1, nodes: [{ id: 'C', act: 3, col: 0, row: 0, kind: 'boss' }], edges: [] },
      4: { act: 4, cols: 1, rows: 1, nodes: [{ id: 'D', act: 4, col: 0, row: 0, kind: 'boss' }], edges: [] },
      5: { act: 5, cols: 0, rows: 0, nodes: [], edges: [] },
      6: { act: 6, cols: 0, rows: 0, nodes: [], edges: [] },
      7: { act: 7, cols: 0, rows: 0, nodes: [], edges: [] },
    },
    sublayer: null,
    act: 1, cleared: [], visitorNodeId: null, subDone: false,
    hpMp: { c1: { hp: 100, mp: 50 } },
    initialPool: 0, coins: 0,
    pendingMaterials: [], pendingItems: [], relics: [],
    torches: 2, openedEdges: [], createdAt: 1,
  });

  const mkChar = (id: string): Character => ({
    id, name: id, job: 'typhon', level: 10,
    extra: { str: 30, int: 10, agi: 30, luk: 30, cha: 30, wil: 10 },
    equip: { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] },
    relics: [], inventory: [], bag: [], storage: [], coins: 0, createdAt: 0,
  });

  it('applyTutorialRewards：20级 + 10自由点（技能点按等级折算=1）', () => {
    const out = applyTutorialRewards(mkChar('c1'));
    expect(out.level).toBe(20);
    expect(out.skillPoints).toBe(1); // 20级折算1，无教程额外奖励
    expect(out.freeExtraPoints).toBe(10);
    expect(earnedSkillPoints(out)).toBe(1);
  });

  it('completeRunWithLoot 对新手村成员发放奖励', () => {
    const s: SaveData = {
      version: 1,
      characters: [mkChar('c1')],
      customItems: [], customMonsters: [], customStages: [], materials: [], coinsInStorage: 0,
      party: null, activeRun: mkRun(),
    };
    const next = completeRunWithLoot(s, []);
    const c = next.characters[0]!;
    expect(c.level).toBe(20);
    expect(c.skillPoints).toBe(1);
    expect(c.freeExtraPoints).toBe(10);
    expect(next.activeRun).toBeNull();
  });

  it('spendFreePoint：消耗自由点加六维（上限100）', () => {
    const s: SaveData = {
      version: 1,
      characters: [mkChar('c1')],
      customItems: [], customMonsters: [], customStages: [], materials: [], coinsInStorage: 0,
      party: null, activeRun: null,
    };
    s.characters[0]!.freeExtraPoints = 10;
    const next = spendFreePoint(s, 'c1', 'str');
    expect(next.characters[0]!.extra.str).toBe(31);
    expect(next.characters[0]!.freeExtraPoints).toBe(9);
    // 单维上限 100
    s.characters[0]!.extra.str = 100;
    const capped = spendFreePoint(s, 'c1', 'str');
    expect(capped.characters[0]!.extra.str).toBe(100);
    expect(capped.characters[0]!.freeExtraPoints).toBe(10);
  });
});

describe('既有职业技能等级化', () => {
  it('全部职业均有 4 个槽位（职业 skills 数组 = 解锁顺序），技能点升级 3 级', () => {
    for (const job of ['cat', 'kayn', 'typhon', 'cat', 'typhon', 'kayn'] as const) {
      const def = JOB_DEFS[job];
      expect(def.skills.length).toBeGreaterThanOrEqual(2);
      for (const sid of def.skills) {
        const sk = SKILL_MAP[sid];
        expect(sk.exclusive).toBe(true);
        expect(sk.tiers?.length).toBe(3);
        expect(sk.unlockLevel ?? 1).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('exclusiveSkillsOf 按职业定义顺序返回', () => {
    expect(exclusiveSkillsOf({ job: 'typhon' }).map((s) => s.id)).toEqual(
      ['sk_typhon_triple', 'sk_typhon_pierce', 'sk_typhon_recon', 'sk_typhon_hunt'],
    );
  });
});