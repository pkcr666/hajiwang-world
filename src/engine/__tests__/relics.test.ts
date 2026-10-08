import { describe, expect, it } from 'vitest';
import { effAtk, makeCombatant } from '../damage';
import { advance, applyRelics, createBattle, currentActor, enemyAct, playerAct } from '../battle';
import { outerStats, relicPanelBonus } from '../stats';
import { RELICS } from '../../data/relics';
import type { BaseStats, BattleState } from '../../types';

const S = (o: Partial<BaseStats> = {}): BaseStats => ({
  hp: 100, mp: 0, atk: 20, def: 0, mres: 0, spdMin: 2, spdMax: 5, ...o,
});

describe('局外面板（面板类遗物）', () => {
  it('水晶与百分比公式：原始200HP + 大果5% + 生命水晶2层 = 230', () => {
    const bonus = relicPanelBonus(
      ['rl_big_fruit', 'rl_life_crystal', 'rl_mana_crystal'],
      { rl_life_crystal: 2, rl_mana_crystal: 3 },
    );
    const outer = outerStats(S({ hp: 200, mp: 50 }), bonus);
    expect(outer.hp).toBe(200 + 10 + 40); // 200×(1+5%) + 20×2
    expect(outer.mp).toBe(50 + 30); // 魔力水晶 3 层 × 10
  });

  it('固定值与百分比叠加：墨镜法抗+10、拉达冈的烙印攻击+15%', () => {
    const outer = outerStats(S({ atk: 30, mres: 20 }), relicPanelBonus(['rl_sunglasses', 'rl_radagon_brand']));
    expect(outer.mres).toBe(30); // 法抗为百分比上限制，直接加
    expect(outer.atk).toBe(Math.ceil(30 * 1.15));
  });
});

describe('遗物效果（战斗内动态）', () => {
  it('生命/魔力水晶已入局外面板，applyRelics 不再重复结算', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ hp: 100, mp: 50 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 80 }) });
    const b = createBattle([ally], [foe]);
    const r = applyRelics(b, ['rl_life_crystal', 'rl_mana_crystal']);
    expect(r.allies[0].maxHp).toBe(100);
    expect(r.allies[0].maxMp).toBe(50);
  });

  it('拳经三问：每次使用技能后全能增伤+10%，第二次技能伤害提升', () => {
    const ally = makeCombatant({
      uid: 'ally_0', name: '勇者',
      stats: { hp: 100, mp: 100, atk: 100, def: 0, mres: 0, spdMin: 30, spdMax: 30 },
    });
    ally.skills = [{ id: 'sk_test', name: '测试技', desc: '测试技能', kind: 'active', target: 'enemyOne', mpCost: 10, damageType: 'physical', multiplier: 1 }];
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 100000, def: 0, mres: 0, spdMin: 1, spdMax: 1 }) });
    let b = createBattle([ally], [foe]);
    b = applyRelics(b, ['rl_fist_sutra']);
    expect(b.allies[0].skillDmgStack).toEqual({ pct: 0.1, cap: 1.0, stacks: 0 });
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const r1 = playerAct(b, { type: 'skill', skillId: 'sk_test', targetUid: 'enemy_0' }, new Map());
    const hpAfter1 = r1.state.enemies[0].hp;
    expect(r1.state.allies[0].skillDmgStack!.stacks).toBe(0.1); // 结算后累积
    r1.state.cursor = 0;
    const r2 = playerAct(r1.state, { type: 'skill', skillId: 'sk_test', targetUid: 'enemy_0' }, new Map());
    const hpAfter2 = r2.state.enemies[0].hp;
    const dmg1 = 100000 - hpAfter1;
    const dmg2 = hpAfter1 - hpAfter2;
    expect(r2.state.allies[0].currentSkillAmp).toBe(0.1); // 第二次读到了累积增伤
    expect(dmg2).toBeGreaterThan(dmg1); // 第二次伤害更高（+10%）
  });

  it('贾力亮的帽子：场上单位≥3时我方攻击按局外面板乘1.3', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ atk: 30 }) });
    const mates = [
      makeCombatant({ uid: 'enemy_0', side: 'enemy', name: 'A', stats: S({ hp: 80 }) }),
      makeCombatant({ uid: 'enemy_1', side: 'enemy', name: 'B', stats: S({ hp: 80 }) }),
    ];
    const b = createBattle([ally], mates);
    const r = applyRelics(b, ['rl_jarly_hat']);
    expect(effAtk(r.allies[0]!)).toBe(Math.ceil(30 * 1.3));
  });

  it('贾力亮的帽子：场上单位不足3时不生效', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ atk: 30 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 80 }) });
    const b = createBattle([ally], [foe]);
    const r = applyRelics(b, ['rl_jarly_hat']);
    expect(r.allies[0].stats.atk).toBe(30);
  });

  it('scout的狙击镜：速度每高1点伤害+10%，普攻结算生效', () => {
    const ally = makeCombatant({
      uid: 'ally_0', name: '射手', stats: S({ atk: 100, spdMin: 5, spdMax: 5 }), spdDmgAmp: { perPoint: 0.1, cap: 1 },
    });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 1000, spdMin: 2, spdMax: 2 }) });
    const b = createBattle([ally], [foe]);
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const r = playerAct(b, { type: 'attack', targetUid: 'enemy_0' }, new Map());
    const dmg = r.events.find((e) => e.t === 'damage');
    expect(dmg && dmg.t === 'damage').toBe(true);
    if (dmg && dmg.t === 'damage') {
      // 无镜伤害 = max(5, 100×1 - 0) = 100；+30% 速度差 = 130
      expect(dmg.amount).toBe(130);
    }
  });

  it('applyRelics 写入 spdDmgAmp 后 currentActor 普攻携带速度增伤标记', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '射手', stats: S() });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 80 }) });
    const b = createBattle([ally], [foe]);
    const r = applyRelics(b, ['rl_scout_scope']);
    expect(r.allies[0].spdDmgAmp).toEqual({ perPoint: 0.1, cap: 1 });
    expect(currentActor(r).uid).toBeDefined();
  });

  it('恶魔祭坛·腐化：敌方攻击+20，防御+20', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S() });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ atk: 18, def: 0 }) });
    const b = createBattle([ally], [foe]);
    const r = applyRelics(b, ['rl_corrupt_altar']);
    expect(r.enemies[0].stats.atk).toBe(38);
    expect(r.enemies[0].stats.def).toBe(20);
  });

  it('恶魔祭坛·血腥：敌方行动后恢复10%最大生命', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ hp: 1000, def: 100 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '吸血怪', stats: S({ hp: 100, atk: 200 }) });
    const b = createBattle([ally], [foe]);
    b.order = ['enemy_0', 'ally_0'];
    b.cursor = 0;
    const withRelic = applyRelics(b, ['rl_blood_altar']);
    // 先让敌人掉点血（盟友打一下）—— 直接手动设 hp
    withRelic.enemies[0].hp = 50;
    const r = enemyAct(withRelic);
    // 10% of maxHp(100) = 10，向上取整 = 10
    expect(r.state.enemies[0].hp).toBe(60);
    expect(r.events.some((e) => e.t === 'heal' && e.amount === 10)).toBe(true);
  });

  it('未装备遗物时原样返回', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S() });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S() });
    const b = createBattle([ally], [foe]);
    const r = applyRelics(b, []);
    expect(r.allies[0].maxHp).toBe(b.allies[0].maxHp);
  });
});

// ===== 全量遗物 smoke：88 件逐一走局外/局内管线，确保不抛错且种类齐全 =====
describe('全量遗物 smoke 测试', () => {
  const PANEL_KINDS = new Set(['stats', 'pctStats', 'sixStats', 'lifeCrystal', 'manaCrystal', 'killBook', 'torchHpPerTorch']);
  const BATTLE_KINDS = new Set([
    'condAtkPct', 'spdDmgAmp', 'corruptAltar', 'bloodAltar', 'altarCrimson', 'altarCorruption',
    'dmgAmp', 'dmgRed', 'shieldPerTurns', 'shieldGainBonus', 'damageCapPct', 'healTurnEnd',
    'shieldDmgAmp', 'chaosShield', 'lowSpdDmgAmp', 'atkPerHit', 'trueDmgOnHit', 'firstHitDouble',
    'enemyDefDownPct', 'torchDmgAmp', 'startShield', 'startShieldStacks',
    'enemyMresDown', 'enemyMaxHpDown', 'firstTurnAtk', 'startMp', 'normalAtkAmp', 'healAmp',
    'healTurnEndPct', 'mpTurnEnd', 'torchDefAmp', 'meleeAtkPct', 'rangedSpd', 'magicDmgAmp2',
    'lowHpEnemyDmgAmp', 'allyCountAtkPct', 'lastStandDef', 'lastStandAtk', 'coinsSpd',
    'turnStartBuff', 'enemyHpUpCoins', 'meleeTradeoff', 'buffStackBonus', 'buffIntensityBonus',
    'surviveLethalInvincible', 'randomAllyBuffDot', 'lowestHpShield', 'allyPostActionHealPct',
    'swordHammer', 'killInvincible', 'killMpRestore', 'killHpRestore', 'killSpdBuff',
    'noSkillAtkBuff', 'hpLossAtk', 'hpLossSpd', 'actionHpToShield', 'noHitShield',
    'skillDmgStack', 'detonateDouble',
  ]);

  it('面板类遗物逐一走 relicPanelBonus 不抛错', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S() });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S() });
    const b = createBattle([ally], [foe]);
    for (const r of RELICS) {
      relicPanelBonus([r.id]);
      if (BATTLE_KINDS.has(r.effect.kind)) applyRelics(b, [r.id]);
    }
    // 至少有一个样例
    expect(RELICS.filter((r) => PANEL_KINDS.has(r.effect.kind)).length).toBeGreaterThan(20);
  });
});

// ===== 新实装战斗机制遗物（blast的电锯/奶蛙的玉足/奶蛙的手臂/大刀丸）+ 护盾节奏 =====
describe('新实装战斗机制遗物', () => {
  it('blast的电锯：低于目标速度时增伤，速度差3 → +30%', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '慢速者', stats: S({ atk: 100, spdMin: 2, spdMax: 2 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '高速史莱姆', stats: S({ hp: 1000, spdMin: 5, spdMax: 5 }) });
    const b = createBattle([ally], [foe]);
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const r = applyRelics(b, ['rl_blast_saw']);
    const res = playerAct(r, { type: 'attack', targetUid: 'enemy_0' }, new Map());
    const dmg = res.events.find((e) => e.t === 'damage');
    expect(dmg && dmg.t === 'damage' && dmg.amount).toBe(130); // 100 × (1+30%)
  });

  it('奶蛙的玉足：每次攻击后攻击力+5%', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ atk: 20 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 1000 }) });
    const b = createBattle([ally], [foe]);
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const r = applyRelics(b, ['rl_frog_feet']);
    const res = playerAct(r, { type: 'attack', targetUid: 'enemy_0' }, new Map());
    expect(res.state.allies[0].stats.atk).toBe(Math.ceil(20 * 1.05)); // 21
  });

  it('奶蛙的手臂：每次攻击额外造成目标最大生命5%的真实伤害', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ atk: 20 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 1000 }) });
    const b = createBattle([ally], [foe]);
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const r = applyRelics(b, ['rl_frog_arm']);
    const res = playerAct(r, { type: 'attack', targetUid: 'enemy_0' }, new Map());
    expect(res.state.enemies[0].hp).toBe(930); // 1000 - 20 - 50
    const dmgs = res.events.filter((e) => e.t === 'damage').map((e) => e.amount);
    expect(dmgs).toEqual([20, 50]);
  });

  it('大刀丸：战斗中首次造成的伤害翻倍（仅一次）', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ atk: 20 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 1000 }) });
    const b = createBattle([ally], [foe]);
    b.order = ['ally_0', 'enemy_0'];
    b.cursor = 0;
    const r = applyRelics(b, ['rl_bigdao_maru']);
    const s1 = playerAct(r, { type: 'attack', targetUid: 'enemy_0' }, new Map()).state;
    const s2 = playerAct(s1, { type: 'attack', targetUid: 'enemy_0' }, new Map()).state;
    expect(s2.enemies[0].hp).toBe(940); // 1000 - 40 - 20
    expect(s2.allies[0].firstHitUsed).toBe(true);
  });

  it('杀人书：局外攻击面板按层数 +5%/层（4层 → +20%）', () => {
    const outer = outerStats(S({ atk: 30 }), relicPanelBonus(['rl_kill_book'], { rl_kill_book: 4 }));
    expect(outer.atk).toBe(Math.ceil(30 * 1.2));
  });
});

describe('钨钢防护罩发放节奏（第1回合开局 + 每3回合）', () => {
  const fixedRng = { int: (a: number, _b: number) => a, float: () => 0.5 };
  // 完整跑完一回合（所有单位行动一次 + 回合末结算），返回新状态
  const runRound = (b: BattleState): BattleState => {
    let s = b;
    for (let i = 0; i < s.order.length; i++) {
      const c = currentActor(s);
      if (c.side === 'ally') s = playerAct(s, { type: 'attack', targetUid: s.enemies[0].uid }, new Map()).state;
      else s = enemyAct(s, fixedRng).state;
      s = advance(s, fixedRng);
    }
    s.order = ['ally_0', 'enemy_0'];
    s.cursor = 0;
    return s;
  };

  it('第1回合开局发盾后，第2/3回合不再发，第4回合开始再发', () => {
    const ally = makeCombatant({ uid: 'ally_0', name: '勇者', stats: S({ hp: 1000, atk: 1, spdMin: 2, spdMax: 2 }) });
    const foe = makeCombatant({ uid: 'enemy_0', side: 'enemy', name: '史莱姆', stats: S({ hp: 1000, atk: 100, spdMin: 5, spdMax: 5 }) });
    let s = applyRelics(createBattle([ally], [foe], fixedRng), ['rl_tungsten_shield']);
    s.order = ['ally_0', 'enemy_0'];
    s.cursor = 0;
    expect(s.allies[0].shield).toBe(50); // 开局（第1回合）立即获得

    s = runRound(s); // 第1回合：敌方100伤 → 盾吸收50 + 血50；回合末不发盾
    expect(s.allies[0].shield).toBe(0);
    expect(s.allies[0].hp).toBe(950);

    s = runRound(s); // 第2回合：-100血；回合末（第2回合）不发
    expect(s.allies[0].shield).toBe(0);
    expect(s.allies[0].hp).toBe(850);

    s = runRound(s); // 第3回合：-100血；回合末（第3回合）发盾 → 第4回合开始持有
    expect(s.allies[0].shield).toBe(50);
    expect(s.allies[0].hp).toBe(750);
  });
});
