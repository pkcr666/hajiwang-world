import { describe, expect, it } from 'vitest';
import { makeCombatant } from '../damage';
import { advance, applyTurnStartTriggers, createBattle, playerAct } from '../battle';
import { SK_REIN_VARIABLE, SK_REIN_MASK, SK_REIN_ORACLE, SK_REIN_FURIOSO } from '../../data/skills';
import { effDefBuffed } from '../buffs';
import type { BaseStats, Combatant, Skill } from '../../types';

const S = (o: Partial<BaseStats> = {}): BaseStats => ({
  hp: 100, mp: 100, atk: 100, def: 20, mres: 20, spdMin: 20, spdMax: 30, ...o,
});

// 构造里恩战斗单位：挂三/四技能 + 初始化神谕状态
function makeRein(over: Partial<Combatant> = {}): Combatant {
  const c = makeCombatant({ uid: 'ally_0', name: '里恩', charLevel: 30, stats: S(), str: 30, int: 20, agi: 30, wil: 20, luk: 20, cha: 20, ...over });
  c.skills = [
    SK_REIN_VARIABLE as Skill,
    SK_REIN_MASK as Skill,
    SK_REIN_ORACLE as Skill,
    SK_REIN_FURIOSO as Skill,
  ];
  c.reinOracle = { stacks: 0, markedVariantId: '', markedTargetUid: '', liberation: 0, sixApplied: 0, atkApplied: 0, ampApplied: 0 };
  c.reinHeartFate = false;
  c.reinFuriosoUsed = false;
  return c;
}

function makeFoe(): Combatant {
  return makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '巨像蛤', stats: S({ hp: 100000, def: 20, spdMin: 1, spdMax: 2 }) });
}

// 跑完整一回合（我方行动→敌方行动→回合末）
function runFullTurn(b: ReturnType<typeof createBattle>, action: Parameters<typeof playerAct>[1]): ReturnType<typeof createBattle> {
  let s = playerAct(b, action, new Map()).state;
  s = advance(s);
  s = advance(s);
  return s;
}

describe('里恩 · 登场假面与指令标', () => {
  it('战斗开始挂上「遮盖伤口的假面」（10%全能减伤），并生成指令标', () => {
    const rein = makeRein();
    const foe = makeFoe();
    const b = applyTurnStartTriggers(createBattle([rein], [foe]));
    const r = b.allies[0];
    expect(r.buffs.some((bb) => bb.id === 'reinMask' && bb.intensity === 0.10)).toBe(true);
    expect(r.reinOracle!.markedVariantId).not.toBe('');
    expect(r.reinOracle!.markedTargetUid).toBe('enemy_0');
  });
});

describe('里恩 · 代行层数与业', () => {
  it('使用带指令标变体且选中带指令标目标 → +3 层', () => {
    const rein = makeRein();
    const b = applyTurnStartTriggers(createBattle([rein], [makeFoe()]));
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const markedV = b.allies[0].reinOracle!.markedVariantId;
    const markedT = b.allies[0].reinOracle!.markedTargetUid;
    const s = playerAct(b, { type: 'skill', skillId: 'sk_rein_variable', targetUid: markedT, variantId: markedV }, new Map()).state;
    expect(s.allies[0].reinOracle!.stacks).toBe(3);
  });

  it('仅使用带指令标变体（目标不带标）→ +1 层', () => {
    const rein = makeRein();
    const b = applyTurnStartTriggers(createBattle([rein], [makeFoe()]));
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    // 强制指令标目标指向一个额外敌人？单敌人场景下 markedTarget 就是唯一敌人，改用普攻验证「均不满足」。
    // 此用例改为：手动把 markedVariantId 设为当前使用的变体、markedTargetUid 清空模拟「目标非标」
    const markedV = b.allies[0].reinOracle!.markedVariantId;
    b.allies[0].reinOracle!.markedTargetUid = 'other_uid';
    const s = playerAct(b, { type: 'skill', skillId: 'sk_rein_variable', targetUid: 'enemy_0', variantId: markedV }, new Map()).state;
    expect(s.allies[0].reinOracle!.stacks).toBe(1);
  });

  it('普攻未使用指令标 → 不获得层数，获得1层「业」', () => {
    const rein = makeRein();
    const b = applyTurnStartTriggers(createBattle([rein], [makeFoe()]));
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const s = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, new Map()).state;
    expect(s.allies[0].reinOracle!.stacks).toBe(0);
    expect(s.allies[0].buffs.some((bb) => bb.id === 'reinKarma' && bb.stacks === 1)).toBe(true);
  });

  it('业：每层防御-10%（乘算）', () => {
    const rein = makeRein();
    rein.buffs.push({ id: 'reinKarma', stacks: 2, intensity: 1 });
    // 防御20，两层业 → 20×0.8=16
    expect(effDefBuffed(rein)).toBeCloseTo(16);
  });
});

describe('里恩 · 解放（覆盖式）与心-命运', () => {
  it('回合末代行≥3 → 解放I（六维+10），≥6 → 解放II覆盖（六维+20而非+30）', () => {
    const rein = makeRein();
    const foe = makeFoe();
    let b = applyTurnStartTriggers(createBattle([rein], [foe]));
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    b.allies[0].reinOracle!.stacks = 3;
    let s = runFullTurn(b, { type: 'attack', targetUid: 'enemy_0' });
    expect(s.allies[0].reinOracle!.liberation).toBe(1);
    expect(s.allies[0].str).toBe(40); // 30 + 解放I 10
    // 继续叠到6层 → 解放II 覆盖：撤销+10 加 +20 → 50
    s.allies[0].reinOracle!.stacks = 6;
    s = runFullTurn(s, { type: 'attack', targetUid: 'enemy_0' });
    expect(s.allies[0].reinOracle!.liberation).toBe(2);
    expect(s.allies[0].str).toBe(50); // 30+20
    expect(s.allies[0].stats.atk).toBe(100 + 30); // 解放II 攻击+等级30
  });

  it('代行12层 → 解放III + 心-命运（全能增伤、速度+、MP恢复）', () => {
    const rein = makeRein();
    let b = applyTurnStartTriggers(createBattle([rein], [makeFoe()]));
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    b.allies[0].reinOracle!.stacks = 12;
    const s = runFullTurn(b, { type: 'attack', targetUid: 'enemy_0' });
    const r = s.allies[0];
    expect(r.reinOracle!.liberation).toBe(3);
    expect(r.reinHeartFate).toBe(true);
    expect(r.reinLiberationAmp).toBe(0.20); // 解放III 全能增伤20%（Lv1技能）
    expect(r.str).toBe(60); // 30 + 解放III 30
    expect(r.stats.spdMax).toBe(30 + 3); // 心-命运 速度+3
    expect(r.icon).toContain('里恩解放');
  });

  it('Furioso-Replica：12层时释放，9次随机真伤且整场一次', () => {
    const rein = makeRein();
    rein.mp = 100;
    rein.reinOracle!.stacks = 12;
    const foe = makeFoe();
    let b = applyTurnStartTriggers(createBattle([rein], [foe]));
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const hpBefore = b.enemies[0].hp;
    const s = playerAct(b, { type: 'skill', skillId: 'sk_rein_furioso' }, new Map()).state;
    expect(s.enemies[0].hp).toBeLessThan(hpBefore);
    expect(s.allies[0].reinFuriosoUsed).toBe(true);
    // 第二次不可用（getLegalActions 层面由 UI 处理；引擎直接执行也会因 used 标记返回无额外伤害）
    const hp2 = s.enemies[0].hp;
    const s2 = playerAct(s, { type: 'skill', skillId: 'sk_rein_furioso' }, new Map()).state;
    expect(s2.enemies[0].hp).toBe(hp2);
  });
});

describe('里恩 · 假面切换为灼烧着的伤口', () => {
  it('回合末HP低于40% → 假面移除、伤口挂上（减伤20%、速度+3、攻击+30）', () => {
    const rein = makeRein();
    const foe = makeFoe();
    let b = applyTurnStartTriggers(createBattle([rein], [foe]));
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    b.allies[0].hp = 35; // maxHp 100 → 35%
    const s = runFullTurn(b, { type: 'attack', targetUid: 'enemy_0' });
    const r = s.allies[0];
    expect(r.buffs.some((bb) => bb.id === 'reinWound' && bb.intensity === 0.20)).toBe(true);
    expect(r.buffs.some((bb) => bb.id === 'reinMask')).toBe(false);
    expect(r.stats.spdMax).toBe(30 + 3); // 等级30/10=3
    expect(r.stats.atk).toBe(100 + 30); // 攻击+等级
  });
});
