import type {
  BattleState, Combatant, DamageType, Item, LogEntry, PendingReaction, PlayerAction, Relic, Rng, Skill,
} from '../types';
import { mathRng } from '../types';
import { decideEnemy, type EnemyDecision } from './ai';
import { absorb, applyShield, calcDamage, effAtk, ignoresShield, makeCombatant } from './damage';
import { rollOrder, stripSlotUid, slotOf } from './order';
import { addBuff, APOPTOSIS_TRIGGER_STACKS, BUFF_SCALE, buffValue, computeDamageMods, effDefBuffed, effSpd, tickBuffsEndOfTurn } from './buffs';
import { statCheck } from './events';
import { RELIC_MAP } from '../data/relics';
import { JOB_IMAGES } from '../assets/config';

const BOSS_ENRAGE = 0.5;

// ---------- 基础查询 ----------
export const allCombatants = (s: BattleState): Combatant[] => [...s.allies, ...s.enemies];

export const byUid = (s: BattleState, uid: string): Combatant =>
  allCombatants(s).find((u) => u.uid === stripSlotUid(uid))!;
const alive = (us: Combatant[]) => us.filter((u) => u.alive);
const opponentsOf = (s: BattleState, c: Combatant): Combatant[] =>
  c.side === 'ally' ? s.enemies : s.allies;

export function currentActor(s: BattleState): Combatant {
  // 战斗已结束时顺位指针可能越界，返回首位存活单位避免渲染崩溃
  if (s.result) {
    const u = allCombatants(s).find((x) => x.alive) ?? allCombatants(s)[0];
    if (u) return u;
  }
  // cursor 越界（-1：回合开始前抉择弹窗暂停）时返回首位存活单位，避免 stripSlotUid(undefined) 抛错导致黑屏
  const uid = s.order[s.cursor];
  const u = uid ? byUid(s, uid) : undefined;
  if (!u) {
    const fallback = allCombatants(s).find((x) => x.alive) ?? allCombatants(s)[0];
    if (fallback) return fallback;
    throw new Error('顺位指针越界');
  }
  return u;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type LogInput = DistributiveOmit<LogEntry, 'id'>;

function addLog(s: BattleState, e: LogInput): LogEntry {
  const entry = { id: s.nextLogId++, ...e } as LogEntry;
  s.log.push(entry);
  return entry;
}

// 大鸡婶婶：我方（敌方视角的对手）获得护盾时，场上存活的自身获得等量护盾
function gainShield(s: BattleState, c: Combatant, amount: number): number {
  const gain = applyShield(c, amount);
  if (gain > 0 && c.side === 'ally') {
    for (const e of s.enemies) {
      if (e.alive && e.monsterId === 'ct_073') {
        const g2 = applyShield(e, gain);
        if (g2 > 0) addLog(s, { t: 'shield', targetUid: e.uid, amount: g2 });
      }
    }
  }
  return gain;
}

// 奥古斯塔：获得战势层数（受击时受每回合上限限制）
function gainMomentum(s: BattleState, c: Combatant, fromHit = false): void {
  if (c.momentumMax === undefined) return;
  const max = c.momentumMax;
  if ((c.momentum ?? 0) >= max) return;
  if (fromHit) {
    // 找到被动配置中的受击上限
    const passive = c.skills.find((sk) => sk.augustaMomentum);
    const hitLimit = passive?.augustaMomentum?.onHitPerTurn ?? 1;
    if ((c.momentumHitGainedThisTurn ?? 0) >= hitLimit) return;
    c.momentumHitGainedThisTurn = (c.momentumHitGainedThisTurn ?? 0) + 1;
  }
  c.momentum = Math.min(max, (c.momentum ?? 0) + 1);
  addLog(s, { t: 'info', text: `${c.name} 战势 +1（${c.momentum}/${max}）` });
}

// 奥古斯塔：是否触发强化（战势≥阈值）
function shouldAugustaEnhance(c: Combatant): boolean {
  const passive = c.skills.find((sk) => sk.augustaMomentum);
  if (!passive?.augustaMomentum) return false;
  return (c.momentum ?? 0) >= passive.augustaMomentum.enhanceThreshold;
}

// 奥古斯塔：消耗战势（强化触发时）
function consumeMomentumForEnhance(s: BattleState, c: Combatant, consumeAll = false): void {
  const passive = c.skills.find((sk) => sk.augustaMomentum);
  if (!passive?.augustaMomentum) return;
  const threshold = passive.augustaMomentum.enhanceThreshold;
  const before = c.momentum ?? 0;
  if (consumeAll) {
    c.momentum = 0;
  } else {
    c.momentum = Math.max(0, before - threshold);
  }
  addLog(s, { t: 'info', text: `${c.name} 触发强化，消耗 ${before - (c.momentum ?? 0)} 层战势（剩余 ${c.momentum}）` });
  addLog(s, { t: 'vfx', uid: c.uid, kind: 'augusta-enhance' });
}

function checkResult(s: BattleState): void {
  if (s.result) return;
  const allyAlive = s.allies.some((u) => u.alive);
  const enemyAlive = s.enemies.some((u) => u.alive);
  s.result = !enemyAlive ? 'win' : !allyAlive ? 'lose' : null;
}

// ---------- 开局 ----------
export function createBattle(
  allies: Combatant[],
  enemies: Combatant[],
  rng: Rng = mathRng,
): BattleState {
  const s: BattleState = {
    turn: 1,
    allies: structuredClone(allies),
    enemies: structuredClone(enemies),
    order: [],
    cursor: 0,
    log: [],
    nextLogId: 0,
    nextSummonId: 0,
    result: null,
  };
  s.orderRolls = {};
  // 副本内 0HP 进入战斗的角色直接判定死亡（而非被攻击后才死）
  for (const a of s.allies) {
    if (a.hp <= 0) {
      a.alive = false;
      a.hp = 0;
    }
  }
  // 灾厄 BOSS 开局召唤（在 order  roll 之前，使召唤物进入首回合顺位）
  for (const e of [...s.enemies]) {
    if (e.monsterId === 'ct_027') {
      // 克苏鲁之脑：无敌 + 4眼球
      e.invincible = true;
      for (let i = 0; i < 4; i++) {
        const eye = makeCombatant({
          uid: `summon_${s.nextSummonId++}`, side: 'enemy', name: '克苏鲁之眼',
          stats: { hp: Math.floor(e.maxHp * 0.25), mp: 0, atk: Math.floor(e.stats.atk * 0.8), def: e.stats.def, mres: 50, spdMin: 8, spdMax: 12 },
          ai: 'basic', monsterId: 'ct_027_eye', attackType: 'physical', bossId: e.uid,
        });
        s.enemies.push(eye);
      }
      addLog(s, { t: 'info', text: `【${e.name}】召唤了4只克苏鲁之眼，本体进入无敌` });
    }
    if (e.monsterId === 'ct_042') {
      // 腐巢意志：无敌 + 腐化囊 + 2噬魂怪
      e.invincible = true;
      const sac = makeCombatant({
        uid: `summon_${s.nextSummonId++}`, side: 'enemy', name: '腐化囊',
        stats: { hp: Math.floor(e.maxHp * 0.3), mp: 0, atk: 0, def: e.stats.def, mres: e.stats.mres, spdMin: 1, spdMax: 1 },
        ai: 'basic', monsterId: 'ct_042_sac', bossId: e.uid,
      });
      s.enemies.push(sac);
      for (let i = 0; i < 2; i++) {
        const w = makeCombatant({
          uid: `summon_${s.nextSummonId++}`, side: 'enemy', name: '噬魂怪',
          stats: { hp: 500, mp: 0, atk: 80, def: 50, mres: 50, spdMin: 2, spdMax: 6 },
          ai: 'basic', monsterId: 'ct_030', attackType: 'physical', mpDrain: 5,
        });
        s.enemies.push(w);
      }
      addLog(s, { t: 'info', text: `【${e.name}】召唤腐化囊与2只噬魂怪，本体进入无敌` });
    }
  }
  s.order = rollOrder(allCombatants(s), rng, s.orderRolls);
  syncInvincibleWhileAllies(s);
  // 登场动画（战斗开始播放角色登场视频/GIF）
  for (const a of s.allies) {
    if (a.eimisSyncMax !== undefined) {
      addLog(s, { t: 'vfx', uid: a.uid, kind: 'eimisEntry' });
    } else if (a.job === 'logos') {
      addLog(s, { t: 'vfx', uid: a.uid, kind: 'logosEntry' });
    } else if (a.job === 'exusiai') {
      addLog(s, { t: 'vfx', uid: a.uid, kind: 'exusiaiEntry' });
    }
  }
  addLog(s, { t: 'roll', turn: 1 });
  // 危机合约：冥王破天初始化破天速度（作为永久 BUFF 显示）
  for (const e of s.enemies) {
    if (e.monsterId === 'mingwangPotian' || e.monsterId === 'ct_076') {
      if (!e.crisis) e.crisis = {};
      if (!e.crisis.mingwang) {
        // 全开冥王破天：破天基础速度固定5；普通冥王破天由 e4_potianSpd5 词条决定
        const ccTerms = s.crisisTermIds ?? [];
        const baseSpd = e.monsterId === 'ct_076' ? 5 : (ccTerms.includes('e4_potianSpd5') ? 5 : 1);
        e.crisis.mingwang = { potianSpd: baseSpd, potianDmgThisTurn: 0 };
      }
      const spd = e.crisis.mingwang.potianSpd;
      if (!e.buffs.find((b) => b.id === 'potianSpd')) {
        e.buffs.push({ id: 'potianSpd', stacks: spd, intensity: 1 });
      }
    }
  }
  return s;
}

// 遗物效果在战斗开局一次性应用。
// 面板类遗物（stats/pctStats/sixStats/生命/魔力水晶）已在 buildAllyCombatant 算进局外面板，这里不再重复结算；
// 这里只处理战斗内动态效果（祭坛/增减伤/护盾/条件攻击/速度差增伤等）。
export function applyRelics(s: BattleState, relicIds: string[], torches = 0, coins = 0, threeBattleCurseCount = 0, ownerUids?: Set<string>): BattleState {
  const relics = relicIds.map((id) => RELIC_MAP[id]).filter((r): r is Relic => !!r);
  if (!relics.length) return s;
  const ns = structuredClone(s);
  // ownerUids 传入时（联机）只作用于该玩家的单位；单人版不传 = 全部我方
  const allies = () => ns.allies.filter((a) => a.alive && (!ownerUids || ownerUids.has(a.uid)));
  for (const r of relics) {
    switch (r.effect.kind) {
      case 'condAtkPct': {
        const { minUnits, pct } = r.effect;
        const unitCount = allCombatants(ns).filter((u) => u.alive).length;
        if (unitCount < minUnits) break;
        for (const a of allies()) a.atkPctBonus = (a.atkPctBonus ?? 0) + pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：场上单位≥${minUnits}，我方攻击+${Math.round(pct * 100)}%` });
        break;
      }
      case 'spdDmgAmp': {
        for (const a of allies()) a.spdDmgAmp = { perPoint: r.effect.perPoint, cap: r.effect.cap };
        addLog(ns, { t: 'info', text: `【${r.name}】生效：每高于目标1点速度伤害+${Math.round(r.effect.perPoint * 100)}%，上限${Math.round(r.effect.cap * 100)}%` });
        break;
      }
      case 'lowSpdDmgAmp': {
        for (const a of allies()) a.lowSpdDmgAmp = { perPoint: r.effect.perPoint, cap: r.effect.cap };
        addLog(ns, { t: 'info', text: `【${r.name}】生效：每低于目标1点速度伤害+${Math.round(r.effect.perPoint * 100)}%，上限${Math.round(r.effect.cap * 100)}%` });
        break;
      }
      case 'atkPerHit': {
        for (const a of allies()) a.atkPerHit = r.effect.pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：每次攻击后攻击力+${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'trueDmgOnHit': {
        for (const a of allies()) a.trueDmgOnHit = r.effect.pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：每次攻击额外造成目标最大生命${Math.round(r.effect.pct * 100)}%的真实伤害` });
        break;
      }
      case 'firstHitDouble': {
        for (const a of allies()) a.firstHitDouble = true;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：战斗中首次造成的伤害翻倍` });
        break;
      }
      case 'corruptAltar': {
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          e.stats.atk += 20;
          e.stats.def += 20;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：敌方攻击+20，防御+20` });
        break;
      }
      case 'bloodAltar': {
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          e.postActionHealPct = 0.1;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：敌方行动后恢复10%最大生命` });
        break;
      }
      case 'altarCrimson': {
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          e.postActionHealPct = 0.05;
        }
        addLog(ns, { t: 'info', text: `【猩红祭坛】生效：敌方每次行动恢复5%最大生命` });
        break;
      }
      case 'altarCorruption': {
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          e.postActionDebuffAlly = true;
        }
        addLog(ns, { t: 'info', text: `【腐化祭坛】生效：敌方每次行动随机减少我方单位5攻击或5防御` });
        break;
      }
      case 'dmgAmp': {
        for (const a of allies()) {
          const rm = (a.relicMods ??= {});
          if (r.effect.phys) rm.physDmgAmp = (rm.physDmgAmp ?? 0) + r.effect.phys;
          if (r.effect.magic) rm.magicDmgAmp = (rm.magicDmgAmp ?? 0) + r.effect.magic;
        }
        const parts: string[] = [];
        if (r.effect.phys) parts.push(`物理伤害+${Math.round(r.effect.phys * 100)}%`);
        if (r.effect.magic) parts.push(`法术伤害+${Math.round(r.effect.magic * 100)}%`);
        addLog(ns, { t: 'info', text: `【${r.name}】生效：我方${parts.join('，')}` });
        break;
      }
      case 'dmgRed': {
        for (const a of allies()) {
          const rm = (a.relicMods ??= {});
          rm.allDmgRed = (rm.allDmgRed ?? 0) + r.effect.all;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：我方减伤+${Math.round(r.effect.all * 100)}%` });
        break;
      }
      case 'shieldPerTurns': {
        for (const a of allies()) a.shieldPerTurns = { ...r.effect };
        addLog(ns, { t: 'info', text: `【${r.name}】生效：每${r.effect.every}回合获得${r.effect.amount}点护盾` });
        break;
      }
      case 'shieldGainBonus': {
        for (const a of allies()) a.shieldGainBonus = (a.shieldGainBonus ?? 0) + r.effect.amount;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：获得护盾时额外+${r.effect.amount}` });
        break;
      }
      case 'damageCapPct': {
        for (const a of allies()) a.damageCapPct = r.effect.pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：单次受伤不超过最大生命${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'healTurnEnd': {
        for (const a of allies()) a.healTurnEnd = (a.healTurnEnd ?? 0) + r.effect.amount;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：每回合末恢复${r.effect.amount}点生命` });
        break;
      }
      case 'shieldDmgAmp': {
        for (const a of allies()) a.shieldDmgAmp = (a.shieldDmgAmp ?? 0) + r.effect.pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：存在护盾时伤害+${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'chaosShield': {
        for (const a of allies()) a.chaosShieldPct = (a.chaosShieldPct ?? 0) + r.effect.hpPct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：每回合开始扣最大生命${Math.round(r.effect.hpPct * 100)}%转化为等量护盾` });
        break;
      }
      case 'enemyDefDownPct': {
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          e.stats.def = Math.max(0, Math.ceil(e.stats.def * (1 - r.effect.pct)));
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：敌方防御-${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'torchDmgAmp': {
        const amp = r.effect.pctPerTorch * Math.max(0, torches);
        for (const a of allies()) {
          const rm = (a.relicMods ??= {});
          rm.allDmgAmp = (rm.allDmgAmp ?? 0) + amp;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：持有${torches}根火把，伤害+${Math.round(amp * 100)}%` });
        break;
      }
      case 'startShield': {
        for (const a of allies()) {
          const gain = gainShield(s, a, r.effect.amount);
          if (gain > 0) addLog(ns, { t: 'shield', targetUid: a.uid, amount: gain });
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：进入战斗获得${r.effect.amount}点护盾` });
        break;
      }
      case 'startShieldStacks': {
        for (const a of allies()) {
          a.shieldStacks = (a.shieldStacks ?? 0) + r.effect.stacks;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：进入战斗获得${r.effect.stacks}层次数盾` });
        break;
      }
      case 'enemyMresDown': {
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          e.stats.mres = Math.max(0, e.stats.mres - r.effect.amount);
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：敌方法抗-${r.effect.amount}` });
        break;
      }
      case 'enemyMaxHpDown': {
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          const reduce = Math.ceil(e.maxHp * r.effect.pct);
          e.maxHp = Math.max(1, e.maxHp - reduce);
          e.hp = Math.min(e.hp, e.maxHp);
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：敌方最大生命-${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'firstTurnAtk': {
        for (const a of allies()) {
          // 累加多个第一回合攻击遗物（全军出击+我已做好准备可同时生效），第二回合统一还原
          a.firstTurnAtkBase = (a.firstTurnAtkBase ?? 0) + r.effect.pct;
          a.atkPctBonus = (a.atkPctBonus ?? 0) + r.effect.pct;
          a.firstTurnAtkUsed = false;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：我方第一回合攻击+${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'startMp': {
        for (const a of allies()) {
          a.mp = Math.min(a.maxMp, a.mp + r.effect.amount);
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：进入战斗恢复${r.effect.amount}点MP` });
        break;
      }
      case 'normalAtkAmp': {
        for (const a of allies()) a.normalAtkAmp = (a.normalAtkAmp ?? 0) + r.effect.pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：普攻倍率+${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'healAmp': {
        for (const a of allies()) a.healAmp = (a.healAmp ?? 0) + r.effect.pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：生命恢复效果+${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'healTurnEndPct': {
        for (const a of allies()) a.healTurnEndPct = (a.healTurnEndPct ?? 0) + r.effect.pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：回合末恢复最大生命${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'mpTurnEnd': {
        for (const a of allies()) a.mpTurnEnd = (a.mpTurnEnd ?? 0) + r.effect.amount;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：每回合末恢复${r.effect.amount}点MP` });
        break;
      }
      case 'torchDefAmp': {
        const amp = r.effect.pctPerTorch * Math.max(0, torches);
        for (const a of allies()) {
          a.stats.def = Math.ceil(a.stats.def * (1 + amp));
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：持有${torches}根火把，防御+${Math.round(amp * 100)}%` });
        break;
      }
      case 'meleeAtkPct': {
        for (const a of allies()) {
          if (a.weaponType === 'melee') a.atkPctBonus = (a.atkPctBonus ?? 0) + r.effect.pct;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：近战单位攻击+${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'rangedSpd': {
        for (const a of allies()) {
          if (a.weaponType === 'ranged') {
            a.stats.spdMin += r.effect.amount;
            a.stats.spdMax += r.effect.amount;
          }
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：远程单位速度+${r.effect.amount}` });
        break;
      }
      case 'magicDmgAmp2': {
        for (const a of allies()) {
          if (a.weaponType === 'magic') {
            const rm = (a.relicMods ??= {});
            rm.magicDmgAmp = (rm.magicDmgAmp ?? 0) + r.effect.pct;
          }
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：魔法单位法术伤害+${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'lowHpEnemyDmgAmp': {
        for (const a of allies()) a.lowHpEnemyDmgAmp = { threshold: r.effect.threshold, pct: r.effect.pct };
        addLog(ns, { t: 'info', text: `【${r.name}】生效：对HP低于${Math.round(r.effect.threshold * 100)}%的敌人伤害+${Math.round(r.effect.pct * 100)}%` });
        break;
      }
      case 'allyCountAtkPct': {
        const count = allies().length;
        const amp = Math.min(r.effect.cap, count * r.effect.perUnit);
        for (const a of allies()) {
          a.allyCountAtkCfg = { perUnit: r.effect.perUnit, cap: r.effect.cap };
          a.allyCountAtkAmp = amp;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：场上${count}个单位，攻击+${Math.round(amp * 100)}%` });
        break;
      }
      case 'lastStandDef': {
        for (const a of allies()) a.lastStandDef = { defPct: r.effect.defPct, mres: r.effect.mres };
        addLog(ns, { t: 'info', text: `【${r.name}】生效：只剩一个单位时防御+${Math.round(r.effect.defPct * 100)}%，法抗+${r.effect.mres}` });
        break;
      }
      case 'lastStandAtk': {
        for (const a of allies()) a.lastStandAtk = { atkPct: r.effect.atkPct, spd: r.effect.spd };
        addLog(ns, { t: 'info', text: `【${r.name}】生效：只剩一个单位时攻击+${Math.round(r.effect.atkPct * 100)}%，速度+${r.effect.spd}` });
        break;
      }
      case 'coinsSpd': {
        const spd = Math.min(r.effect.cap, Math.floor(coins / r.effect.perCoins));
        for (const a of allies()) {
          a.stats.spdMin += spd;
          a.stats.spdMax += spd;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：持有${coins}币，速度+${spd}` });
        break;
      }
      case 'turnStartBuff': {
        for (const a of allies()) a.turnStartBuff = { turn: r.effect.turn, defPct: r.effect.defPct, mres: r.effect.mres };
        addLog(ns, { t: 'info', text: `【${r.name}】生效：第${r.effect.turn}回合开始全体防御+${Math.round(r.effect.defPct * 100)}%，法抗+${r.effect.mres}` });
        break;
      }
      case 'enemyHpUpCoins': {
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          e.maxHp = Math.ceil(e.maxHp * (1 + r.effect.hpPct));
          e.hp = e.maxHp;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：敌方HP+${Math.round(r.effect.hpPct * 100)}%，每场战斗额外${r.effect.coins}币` });
        break;
      }
      case 'threeBattleCurse': {
        // 失落之钥：接下来3场作战敌方HP+X%
        if (threeBattleCurseCount < 3) {
          for (const e of ns.enemies) {
            if (!e.alive) continue;
            e.maxHp = Math.ceil(e.maxHp * (1 + r.effect.hpPct));
            e.hp = e.maxHp;
          }
          addLog(ns, { t: 'info', text: `【${r.name}】生效：第${threeBattleCurseCount + 1}/3场，敌方HP+${Math.round(r.effect.hpPct * 100)}%` });
        }
        break;
      }
      case 'meleeTradeoff': {
        for (const a of allies()) {
          if (a.weaponType === 'melee') {
            a.stats.spdMin = Math.max(1, a.stats.spdMin - r.effect.spdDown);
            a.stats.spdMax = Math.max(1, a.stats.spdMax - r.effect.spdDown);
            const rm = (a.relicMods ??= {});
            rm.physDmgAmp = (rm.physDmgAmp ?? 0) + r.effect.physDmgUp;
          }
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：近战速度-${r.effect.spdDown}，物理伤害+${Math.round(r.effect.physDmgUp * 100)}%` });
        break;
      }
      case 'buffStackBonus': {
        for (const a of allies()) a.buffStackBonus = (a.buffStackBonus ?? 0) + r.effect.amount;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：我方施加的buff层数+${r.effect.amount}` });
        break;
      }
      case 'buffIntensityBonus': {
        for (const a of allies()) a.buffIntensityBonus = (a.buffIntensityBonus ?? 0) + r.effect.amount;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：我方强度类buff强度+${r.effect.amount}且上限+${r.effect.amount}` });
        break;
      }
      case 'surviveLethalInvincible': {
        for (const a of allies()) a.surviveLethalInvincible = true;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：致命伤保1血并本回合无敌（每场1次）` });
        break;
      }
      case 'randomAllyBuffDot': {
        const aliveAllies = allies();
        if (aliveAllies.length > 0) {
          const target = aliveAllies[mathRng.int(0, aliveAllies.length - 1)];
          target.atkPctBonus = (target.atkPctBonus ?? 0) + r.effect.atkPct;
          target.stats.def = Math.ceil(target.stats.def * (1 + r.effect.defPct));
          target.chitinDotPct = r.effect.dotPct;
          addLog(ns, { t: 'info', text: `【${r.name}】生效：${target.name}攻防+${Math.round(r.effect.atkPct * 100)}%，回合末受${Math.round(r.effect.dotPct * 100)}%最大生命真伤` });
        }
        break;
      }
      case 'lowestHpShield': {
        const alive = allies();
        if (alive.length > 0) {
          const target = alive.reduce((min, a) => (a.hp / a.maxHp < min.hp / min.maxHp ? a : min), alive[0]);
          const gain = gainShield(s, target, r.effect.amount);
          if (gain > 0) addLog(ns, { t: 'shield', targetUid: target.uid, amount: gain });
          addLog(ns, { t: 'info', text: `【${r.name}】生效：${target.name}获得${r.effect.amount}点护盾` });
        }
        break;
      }
      case 'allyPostActionHealPct': {
        for (const a of allies()) a.postActionHealPct = (a.postActionHealPct ?? 0) + r.effect.pct;
        addLog(ns, { t: 'info', text: `【${r.name}】生效：行动后恢复${Math.round(r.effect.pct * 100)}%最大生命` });
        break;
      }
      case 'swordHammer': {
        for (const a of allies()) {
          a.atkPctBonus = (a.atkPctBonus ?? 0) + r.effect.atkPct;
          a.stats.def = Math.ceil(a.stats.def * (1 + r.effect.defPct));
          a.stats.mres = Math.min(90, a.stats.mres + r.effect.mres);
          a.swordHammerMpExtra = r.effect.mpExtra;
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效：技能多耗${r.effect.mpExtra}MP，攻击+${Math.round(r.effect.atkPct * 100)}%，防御+${Math.round(r.effect.defPct * 100)}%，法抗+${r.effect.mres}` });
        break;
      }
      case 'killInvincible':
      case 'killMpRestore':
      case 'killHpRestore':
      case 'killSpdBuff':
      case 'noSkillAtkBuff':
      case 'hpLossAtk':
      case 'hpLossSpd':
      case 'actionHpToShield':
      case 'noHitShield':
      case 'skillDmgStack':
      case 'detonateDouble': {
        // 标记型：在对应触发点（击杀/行动/回合）按 combatant 上的 flag 结算
        for (const a of allies()) {
          switch (r.effect.kind) {
            case 'killInvincible': a.killInvincible = true; break;
            case 'killMpRestore': a.killMpRestore = (a.killMpRestore ?? 0) + r.effect.amount; break;
            case 'killHpRestore': a.killHpRestore = (a.killHpRestore ?? 0) + r.effect.amount; break;
            case 'killSpdBuff': a.killSpdBuff = (a.killSpdBuff ?? 0) + r.effect.amount; break;
            case 'noSkillAtkBuff':
              a.noSkillAtkBuff = { pct: r.effect.pct, cap: r.effect.cap, stacks: 0 };
              break;
            case 'hpLossAtk': a.hpLossAtk = r.effect; break;
            case 'hpLossSpd': a.hpLossSpd = r.effect; break;
            case 'actionHpToShield': a.actionHpToShield = r.effect; break;
            case 'noHitShield': a.noHitShield = r.effect.amount; break;
            case 'skillDmgStack': a.skillDmgStack = { pct: r.effect.pct, cap: r.effect.cap, stacks: 0 }; break;
            case 'detonateDouble': a.detonateDouble = true; break;
          }
        }
        addLog(ns, { t: 'info', text: `【${r.name}】生效` });
        break;
      }
      // sixStats 只影响副本结算（幸运判定），战斗内无效果
      // healOnPickup / torchOnPickup / grantRelics / grantItem / grantCoins / grantMaterials 在拾取结算时生效
      // hiddenNode / extraRefresh / nextRecruit* / unlockAct6 / unlockAct7 / threeBattleCurse 在地图/招募/结算时生效
      default:
        break;
    }
  }
  // 开战当回合（第1回合）立即获得一次周期护盾（放在全部遗物处理后，保证钨钢电池加成生效）
  for (const a of ns.allies) {
    if (!a.alive || !a.shieldPerTurns) continue;
    const gain = gainShield(s, a, a.shieldPerTurns.amount);
    if (gain > 0) addLog(ns, { t: 'shield', targetUid: a.uid, amount: gain });
  }
  return ns;
}

// ---------- 死亡 / 部位 ----------
// 挂狗背水一战：激活（提速+无视防御+挂狗BUFF）
function applyGouDogLastStand(s: BattleState, u: Combatant): void {
  if (!u.crisis?.lastStandExecute || u.crisis.lastStandActive) return;
  u.crisis.lastStandActive = true;
  u.stats.spdMax = Math.min(99, u.stats.spdMax + u.crisis.lastStandExecute.speedUp);
  u.stats.spdMin = Math.min(99, u.stats.spdMin + u.crisis.lastStandExecute.speedUp);
  if (u.crisis.lastStandExecute.ignoreDef) u.ignoreDefPct = 1;
  if (!u.buffs.find((b) => b.id === 'gouDog')) {
    u.buffs.push({ id: 'gouDog', stacks: 1, intensity: 1 });
  }
  addLog(s, { t: 'info', text: `【${u.name}】触发背水一战：速度+${u.crisis.lastStandExecute.speedUp}，攻击无视防御` });
}

// 任意单位死亡后检测：若敌方仅剩 1 人且该单位有挂狗能力，立即触发背水一战
function checkGouDogOnDeath(s: BattleState): void {
  const aliveEnemies = alive(s.enemies);
  if (aliveEnemies.length !== 1) return;
  const last = aliveEnemies[0];
  if (last.crisis?.lastStandExecute && !last.crisis.lastStandActive) {
    applyGouDogLastStand(s, last);
  }
}

// 融合暗精灵僵尸等：仍有其他友方存活时无敌且无法行动（不可被选中）
// 同步将 invincibleWhileAllies 单位的 invincible 标记按场上友方存活情况刷新
function syncInvincibleWhileAllies(s: BattleState): void {
  for (const list of [s.allies, s.enemies]) {
    for (const c of list) {
      if (c.invincibleWhileAllies) {
        const hasAlly = list.some((a) => a.uid !== c.uid && a.alive);
        c.invincible = hasAlly;
      }
    }
  }
}

// 判断单位当前是否处于「不可选中」的无敌状态（仅 invincibleWhileAllies 生效中）
function isUntargetableInvincible(c: Combatant): boolean {
  return !!c.invincibleWhileAllies && !!c.invincible;
}

function handleDeath(s: BattleState, u: Combatant): void {
  if (u.bossId && !u.isCore) {
    addLog(s, { t: 'break', uid: u.uid, bossId: u.bossId, partName: u.name });
    const core = s.enemies.find((e) => e.bossId === u.bossId && e.isCore);
    if (core) {
      if (u.partBreak === 'coreAtkDown30') core.statuses.atkModPct -= 30;
      if (u.partBreak === 'coreDefDown50') core.statuses.defModPct -= 50;
      // 岩冠兽：头部被破坏时，身体防御力与法抗归0
      if (u.partBreak === 'coreDefMresZero') {
        core.stats.def = 0;
        core.stats.mres = 0;
        addLog(s, { t: 'info', text: `【${core.name}】头部被破坏，防御力与法抗归0` });
      }
      // 骷髅王：手部被破坏不眩晕头部
      const arms = s.enemies.filter((e) => e.bossId === u.bossId && !e.isCore);
      if (arms.length > 0 && arms.every((e) => !e.alive) && core.monsterId !== 'ct_057_head') {
        core.statuses.stunTurns = Math.max(core.statuses.stunTurns, 1);
      }
    }
  }
  if (u.isCore && u.bossId) {
    for (const part of s.enemies.filter((e) => e.bossId === u.bossId && e.alive)) {
      part.alive = false;
      addLog(s, { t: 'death', uid: part.uid, name: part.name });
    }
  }
  // 世界吞噬者：部位死亡增益
  if (u.monsterId && u.monsterId.startsWith('ct_026_')) {
    const siblings = s.enemies.filter((e) => e.bossId === u.bossId && e.alive);
    const kind = u.monsterId;
    for (const sib of siblings) {
      if (kind === 'ct_026_head') sib.stats.atk += 20;
      if (kind === 'ct_026_body') { sib.stats.spdMin += 2; sib.stats.spdMax += 2; }
      if (kind === 'ct_026_tail') sib.stats.def += 20;
      // 每死亡一个部位，AOE减免-20%
      sib.aoeReductionPct = Math.max(0, (sib.aoeReductionPct ?? 0) - 20);
    }
    addLog(s, { t: 'info', text: `【世界吞噬者】${u.name}被击破，存活部位获得增益，AOE减免-20%` });
  }
  // 骷髅王：手部死亡判定
  if (u.monsterId === 'ct_057_hand') {
    const head = s.enemies.find((e) => e.bossId === u.bossId && e.isCore && e.alive);
    const hands = s.enemies.filter((e) => e.bossId === u.bossId && e.monsterId === 'ct_057_hand');
    if (head && hands.every((h) => !h.alive)) {
      if (!head.crisis) head.crisis = {};
      head.crisis.skeletron = { handsDead: true, reviveCounter: 0 };
      addLog(s, { t: 'info', text: `【骷髅王】双手被破坏，头部伤害减免归0` });
    }
  }
  // 黑色瘟疫·狄瑞吉：一阶段死亡后复活进入二阶段
  if (u.monsterId === 'ct_083' && (u.crisis?.direge?.phase ?? 1) === 1) {
    if (!u.crisis) u.crisis = {};
    u.crisis.direge = { phase: 2 };
    // 清空自身BUFF
    u.buffs = [];
    // 根据敌方当前瘟疫层数总和，获得层数×2%生命上限并回满
    let totalPlague = 0;
    for (const a of s.allies) totalPlague += a.buffs.find((b) => b.id === 'plague')?.stacks ?? 0;
    const baseMax = u.baseMaxHp ?? u.maxHp;
    u.maxHp = Math.floor(baseMax * (1 + totalPlague * 0.02));
    u.hp = u.maxHp;
    // 提升敌方瘟疫总层数×5 的攻击力
    u.stats.atk += totalPlague * 5;
    u.alive = true;
    addLog(s, { t: 'info', text: `【${u.name}】死亡后复活进入二阶段！瘟疫层数${totalPlague}，生命上限提升至${u.maxHp}并回满，攻击力+${totalPlague * 5}` });
    return; // 跳过后续死亡处理
  }

  // 血腥史莱姆：死亡后随机友方恢复 X% 最大HP
  if (u.onDeathHealAllyPct) {
    const allies = (u.side === 'ally' ? s.allies : s.enemies).filter((a) => a.alive && a.uid !== u.uid);
    if (allies.length > 0) {
      const target = allies[Math.floor(Math.random() * allies.length)];
      const heal = Math.floor(target.maxHp * u.onDeathHealAllyPct);
      target.hp = Math.min(target.maxHp, target.hp + heal);
      addLog(s, { t: 'heal', targetUid: target.uid, amount: heal });
      addLog(s, { t: 'info', text: `【${u.name}】死亡，使【${target.name}】恢复${heal}HP` });
    }
  }
  // 腐化史莱姆：死亡后随机友方攻击+X速度+Y
  if (u.onDeathBuffAlly) {
    const allies = (u.side === 'ally' ? s.allies : s.enemies).filter((a) => a.alive && a.uid !== u.uid);
    if (allies.length > 0) {
      const target = allies[Math.floor(Math.random() * allies.length)];
      target.stats.atk += u.onDeathBuffAlly.atk;
      target.stats.spdMin += u.onDeathBuffAlly.spd;
      target.stats.spdMax += u.onDeathBuffAlly.spd;
      addLog(s, { t: 'info', text: `【${u.name}】死亡，使【${target.name}】攻击+${u.onDeathBuffAlly.atk}，速度+${u.onDeathBuffAlly.spd}` });
    }
  }
  // 僵尸新娘/新郎：特定友方死亡时获得增益
  const allies = u.side === 'ally' ? s.allies : s.enemies;
  for (const a of allies) {
    if (a.alive && a.onAllyDeath && !a.onAllyDeathTriggered && a.onAllyDeath.allyName === u.name) {
      const e = a.onAllyDeath;
      if (e.multiHit) a.multiHit = e.multiHit;
      if (e.atk) a.stats.atk += e.atk;
      if (e.def) a.stats.def += e.def;
      if (e.mres) a.stats.mres = Math.min(90, a.stats.mres + e.mres);
      a.onAllyDeathTriggered = true;
      const parts: string[] = [];
      if (e.multiHit) parts.push(`连击×${e.multiHit}`);
      if (e.atk) parts.push(`攻击+${e.atk}`);
      if (e.def) parts.push(`防御+${e.def}`);
      if (e.mres) parts.push(`法抗+${e.mres}`);
      addLog(s, { t: 'info', text: `【${a.name}】因【${u.name}】之死，${parts.join('，')}` });
    }
  }
  checkResult(s);
  // 挂狗：敌方仅剩 1 人时立即触发背水一战
  checkGouDogOnDeath(s);
  // 城墙之子 / 反三：我方只剩一个单位时触发
  if (u.side === 'ally') {
    const aliveAllies = s.allies.filter((a) => a.alive);
    if (aliveAllies.length === 1) {
      const last = aliveAllies[0];
      if (last.lastStandDef && !last.lastStandDefTriggered) {
        last.stats.def = Math.ceil(last.stats.def * (1 + last.lastStandDef.defPct));
        last.stats.mres = Math.min(90, last.stats.mres + last.lastStandDef.mres);
        last.lastStandDefTriggered = true;
        addLog(s, { t: 'info', text: `【城墙之子】${last.name} 防御+${Math.round(last.lastStandDef.defPct * 100)}%，法抗+${last.lastStandDef.mres}` });
      }
      if (last.lastStandAtk && !last.lastStandAtkTriggered) {
        last.atkPctBonus = (last.atkPctBonus ?? 0) + last.lastStandAtk.atkPct;
        last.stats.spdMin += last.lastStandAtk.spd;
        last.stats.spdMax += last.lastStandAtk.spd;
        last.lastStandAtkTriggered = true;
        addLog(s, { t: 'info', text: `【反三】${last.name} 攻击+${Math.round(last.lastStandAtk.atkPct * 100)}%，速度+${last.lastStandAtk.spd}` });
      }
    }
  }
}

// ---------- 伤害 / 治疗 ----------
function damageOne(
  s: BattleState, attacker: Combatant, targetUid: string, mult: number, type: Combatant['attackType'],
  opts?: { extraFlat?: number; executeRefundMp?: number; extraPhysAmp?: number; skillAmp?: number; atkOverride?: number; isAoe?: boolean },
): void {
  const t = byUid(s, targetUid);
  if (!t.alive) return;
  // scout的狙击镜：每高于目标1点速度伤害+X%，上限Y（固定伤害不触发）
  // blast的电锯：每低于目标1点速度伤害+X%，上限Y（固定伤害不触发）
  let spdAmp = 0;
  if (type !== 'fixed') {
    const mine = effSpd(attacker).max;
    const theirs = effSpd(t).max;
    if (attacker.spdDmgAmp && mine > theirs) {
      spdAmp = Math.min(attacker.spdDmgAmp.cap, (mine - theirs) * attacker.spdDmgAmp.perPoint);
    }
    if (attacker.lowSpdDmgAmp && theirs > mine) {
      spdAmp += Math.min(attacker.lowSpdDmgAmp.cap, (theirs - mine) * attacker.lowSpdDmgAmp.perPoint);
    }
  }
  // 新约能天使：弹药倍率加到攻击倍率上（在减防御之前生效），攻击后清零
  const ammoMul = attacker.ammoNextMulBonus ?? 0;
  // 拳经三问：每次使用技能后全能增伤+X%（上限），作为全能增伤计入所有伤害类型
  // opts.skillAmp（爪击哈气增伤等）：追加进同一增伤区
  const skillAmp = (attacker.currentSkillAmp ?? 0) + (opts?.skillAmp ?? 0);
  const totalMult = mult + ammoMul;
  // 畸变杰克：自适应伤害——计算物理与法术伤害，取较大值（显示类型跟随实际生效的类型）
  let amount: number;
  let effectiveType: DamageType = type;
  if (attacker.crisis?.adaptive && type !== 'fixed' && type !== 'true') {
    const phys = calcDamage(attacker, t, totalMult, 'physical', opts?.extraPhysAmp, opts?.atkOverride, skillAmp);
    const mag = calcDamage(attacker, t, totalMult, 'magical', 0, opts?.atkOverride, skillAmp);
    effectiveType = mag > phys ? 'magical' : 'physical';
    amount = Math.ceil(Math.max(phys, mag) * (1 + spdAmp));
  } else {
    amount = Math.ceil(calcDamage(attacker, t, totalMult, type, opts?.extraPhysAmp, opts?.atkOverride, skillAmp) * (1 + spdAmp));
  }
  if (ammoMul > 0) attacker.ammoNextMulBonus = 0;
  // 凯隐红狂镰：额外造成施法者护盾×X 的物理伤害（吃防御）
  if (opts?.extraFlat) {
    amount += Math.max(5, opts.extraFlat - t.stats.def);
  }
  // 大刀丸：战斗中首次造成的伤害翻倍（仅自身攻击伤害）
  if (attacker.firstHitDouble && !attacker.firstHitUsed) {
    attacker.firstHitUsed = true;
    amount *= 2;
    addLog(s, { t: 'info', text: `【大刀丸】生效：首次伤害翻倍，造成 ${amount} 点伤害` });
  }
  // 末日预告：对HP低于阈值的敌人伤害+X%
  if (attacker.lowHpEnemyDmgAmp && t.hp / t.maxHp < attacker.lowHpEnemyDmgAmp.threshold) {
    amount = Math.ceil(amount * (1 + attacker.lowHpEnemyDmgAmp.pct));
  }
  applyDamage(s, t, amount, effectiveType, attacker, opts?.isAoe);
  // 破碎方舟抉择暂停：停止后续命中处理
  if (s.pendingBrokenArk) return;
  // 凯隐蓝狂镰：斩杀敌人时恢复MP
  if (opts?.executeRefundMp && !t.alive) {
    const refund = Math.min(opts.executeRefundMp, attacker.maxMp - attacker.mp);
    if (refund > 0) {
      attacker.mp += refund;
      addLog(s, { t: 'info', text: `${attacker.name}斩杀回蓝 ${refund} 点` });
    }
  }
  afterHit(s, attacker, t.uid);
}

// 攻击命中后触发的遗物效果：奶蛙的手臂（附伤）/ 奶蛙的玉足（攻击成长）/ 弱点侦查（魅力真实伤害）
function afterHit(s: BattleState, c: Combatant, targetUid: string): void {
  const t = byUid(s, targetUid);
  if (t.alive && c.trueDmgOnHit) {
    const extra = Math.ceil(t.maxHp * c.trueDmgOnHit);
    damageFlat(s, t.uid, extra, 'true', c);
  }
  // 弱点侦查：每次攻击附加 魅力×倍率 的真实伤害
  if (t.alive && c.chaTrueDmgMul && c.cha) {
    const extra = Math.ceil(c.cha * c.chaTrueDmgMul);
    damageFlat(s, t.uid, extra, 'true', c);
  }
  // 语汇演化：攻击命中后施加一层凋亡
  if (t.alive && c.applyApoptosisOnHit) {
    const b = addBuff(t, 'apoptosis', 1, 1, c.uid, 'max', c);
    addLog(s, { t: 'buff', uid: t.uid, buffId: 'apoptosis', stacks: b.stacks, intensity: b.intensity, applied: true });
    tryTriggerApoptosis(s, t);
  }
  // 语汇演化：每次攻击后对随机敌方造成 智力×倍率% 攻击力的法术伤害
  if (c.afterHitRandomMagicMul && c.int) {
    const enemies = (c.side === 'ally' ? s.enemies : s.allies).filter((e) => e.alive);
    if (enemies.length > 0) {
      const target = enemies[Math.floor(Math.random() * enemies.length)];
      const mult = (c.int * c.afterHitRandomMagicMul) / 100;
      // calcDamage 已应用法抗减免与 ignoreMresFlat（无视法抗），直接 applyDamage 避免二次减免
      applyDamage(s, target, calcDamage(c, target, mult, 'magical'), 'magical');
      // 语汇演化：随机附伤命中后也附加一层凋亡
      if (target.alive && c.applyApoptosisOnHit) {
        const b = addBuff(target, 'apoptosis', 1, 1, c.uid);
        addLog(s, { t: 'buff', uid: target.uid, buffId: 'apoptosis', stacks: b.stacks, intensity: b.intensity, applied: true });
        tryTriggerApoptosis(s, target);
      }
    }
  }
  if (c.atkPerHit) {
    c.stats.atk = Math.ceil(c.stats.atk * (1 + c.atkPerHit));
    addLog(s, { t: 'info', text: `【奶蛙的玉足】生效：攻击力提升至 ${c.stats.atk}` });
  }
}

// 固定数值伤害（附魔武器的额外法术伤害 / 中毒等）
// attacker 传入时可触发大刀丸首次伤害翻倍，并应用来源方增伤与穿透；
// DoT 等不传 attacker 时，仅应用受伤角色自身的减伤与法抗/防御，不计算来源方任何加成
function damageFlat(s: BattleState, targetUid: string, amount: number, type: DamageType, attacker?: Combatant): void {
  const t = byUid(s, targetUid);
  if (!t.alive) return;
  // 大刀丸：首次造成的伤害翻倍（仅主动造成的伤害，DoT 不触发）
  if (attacker && attacker.firstHitDouble && !attacker.firstHitUsed) {
    attacker.firstHitUsed = true;
    amount *= 2;
    addLog(s, { t: 'info', text: `【大刀丸】生效：首次伤害翻倍，造成 ${amount} 点伤害` });
  }
  if (type === 'fixed') {
    // 固定伤害：纯数值，无视一切
    applyDamage(s, t, amount, type, attacker);
    return;
  }
  // 来源方增伤（仅当有 attacker 时计算；DoT 无 attacker 则不计算来源方增伤）
  const amps = attacker ? computeDamageMods(attacker) : null;
  // 受伤方减伤（始终计算）
  const reds = computeDamageMods(t);
  const RED_CAP = 0.9;

  let dmg = amount;
  if (type === 'true') {
    // 真实伤害：吃增伤减伤，无视防御、法抗、护盾
    if (amps) dmg *= 1 + amps.allDmgAmp + amps.trueDmgAmp;
    dmg *= 1 - Math.min(RED_CAP, reds.allDmgRed + reds.trueDmgRed);
  } else if (type === 'magical') {
    // 法术伤害：受伤方法抗减免（来源方有穿透时扣除），再算增伤减伤
    let mres = t.stats.mres * (buffValue(t, 'worship') > 0 ? 0.5 : 1);
    if (attacker?.ignoreMresFlat) mres = Math.max(0, mres - attacker.ignoreMresFlat);
    dmg = amount * (1 - Math.min(RED_CAP, mres / 100));
    if (amps) dmg *= 1 + amps.allDmgAmp + amps.magicDmgAmp;
    dmg *= 1 - Math.min(RED_CAP, reds.allDmgRed + reds.magicDmgRed);
  } else {
    // physical：受伤方防御减免（来源方有穿透时按比例无视），再算增伤减伤
    const def = effDefBuffed(t) * (1 - (attacker?.ignoreDefPct ?? 0));
    dmg = Math.max(5, amount - def);
    if (amps) dmg *= 1 + amps.allDmgAmp + amps.physDmgAmp;
    dmg *= 1 - Math.min(RED_CAP, reds.allDmgRed + reds.physDmgRed);
  }
  applyDamage(s, t, Math.ceil(dmg), type, attacker);
  // 破碎方舟抉择暂停
  if (s.pendingBrokenArk) return;
}

function applyDamage(s: BattleState, t: Combatant, amount: number, type: DamageType, attacker?: Combatant, isAoe = false): void {
  // 破碎方舟抉择暂停中：不再处理后续伤害
  if (s.pendingBrokenArk) return;
  // 无敌：名刀司命/伪翅，本回合免疫所有伤害
  if (t.invincibleThisTurn) {
    addLog(s, { t: 'info', text: `${t.name} 处于无敌状态，免疫本次伤害` });
    return;
  }
  // 持续无敌：免疫所有伤害（克苏鲁之脑/腐巢意志初始等）
  if (t.invincible) {
    addLog(s, { t: 'info', text: `【${t.name}】处于无敌状态，免疫本次伤害` });
    return;
  }
  // 骷髅王：双手存活时头部 90% 物理/法术减伤
  if (t.monsterId === 'ct_057_head') {
    const hands = s.enemies.filter((e) => e.bossId === t.bossId && e.monsterId === 'ct_057_hand' && e.alive);
    if (hands.length > 0) {
      amount = Math.ceil(amount * 0.1);
      addLog(s, { t: 'info', text: `【${t.name}】双手护持，伤害减免90%` });
    }
  }
  // 宝石爬虫：仅在特定回合可被攻击
  if (t.hitTurnPattern) {
    const tp = t.hitTurnPattern;
    if ((s.turn - tp.start) % tp.interval !== 0) {
      addLog(s, { t: 'info', text: `【${t.name}】本回合处于隐匿状态，免疫伤害` });
      return;
    }
  }
  // 融合暗精灵僵尸：仍有其他友方存活时无敌
  if (t.invincibleWhileAllies) {
    const allies = t.side === 'ally' ? s.allies : s.enemies;
    const otherAlive = allies.some((a) => a.alive && a.uid !== t.uid);
    if (otherAlive) {
      addLog(s, { t: 'info', text: `【${t.name}】有友方存活，处于无敌状态` });
      return;
    }
  }
  // 嘲讽转伤：若有友方单位（小猫自动吸附）替 t 承受本回合伤害
  const protector = s.allies.find((a) => a.alive && a.tauntForUid === t.uid);
  if (protector && protector.uid !== t.uid) {
    applyDamage(s, protector, amount, type, attacker);
    return;
  }
  // 奥古斯塔：受击获得战势（被次数盾/护盾抵挡也算受击，受每回合上限限制）
  if (t.momentumMax !== undefined) {
    gainMomentum(s, t, true);
  }
  // 次数盾：每层免疫1次不无视护盾的伤害（多段伤害逐段消耗）
  if (!ignoresShield(type) && (t.shieldStacks ?? 0) > 0) {
    t.shieldStacks = (t.shieldStacks ?? 0) - 1;
    addLog(s, { t: 'info', text: `${t.name}的次数盾抵消了本次伤害` });
    return;
  }
  const shieldBefore = ignoresShield(type) ? 0 : t.shield;
  let toHp = ignoresShield(type) ? amount : absorb(t, amount);
  const blocked = shieldBefore - t.shield;
  // 群体伤害减免（世界吞噬者）
  if (isAoe && t.aoeReductionPct && t.aoeReductionPct > 0) {
    toHp = Math.ceil(toHp * (1 - t.aoeReductionPct / 100));
  }
  // 马克温的披风：单次受伤（扣血部分）不超过最大生命值的X%
  if (t.damageCapPct && t.hp > 0) {
    const cap = Math.ceil(t.maxHp * t.damageCapPct);
    if (toHp > cap) toHp = cap;
  }
  // 马神残躯能力2：每回合受到的总伤害不超过 dmgCapPerTurn
  if (t.dmgCapPerTurn && t.dmgCapPerTurn > 0) {
    const remain = t.dmgCapPerTurn - (t.dmgTakenThisTurn ?? 0);
    if (remain <= 0) {
      toHp = 0;
    } else if (toHp > remain) {
      toHp = remain;
    }
    t.dmgTakenThisTurn = (t.dmgTakenThisTurn ?? 0) + toHp;
  }
  // 破碎方舟：受击时弹出抉择，玩家选择是否消耗MP抵消伤害（仅我方单位触发）
  if (t.side === 'ally' && t.weaponBrokenArk && toHp > 0 && t.mp >= t.weaponBrokenArk.mpCost) {
    const ba = t.weaponBrokenArk;
    s.pendingBrokenArk = {
      targetUid: t.uid,
      attackerUid: attacker?.uid ?? '',
      toHp,
      damageType: type,
      blocked,
    };
    addLog(s, { t: 'info', text: `【破碎方舟】${t.name} 即将受到 ${toHp} 点伤害，是否消耗${ba.mpCost}MP抵消${Math.round(ba.dmgRedPct * 100)}%？` });
    return;
  }
  applyHpDamage(s, t, toHp, type, attacker, blocked);
}

// 扣血 + 致死/存活/受击后触发逻辑（破碎方舟抉择后复用）
function applyHpDamage(
  s: BattleState, t: Combatant, toHp: number, type: DamageType,
  attacker: Combatant | undefined, blocked: number,
): void {
  const wouldKill = toHp >= t.hp && t.hp > 0;
  // 名刀司命：致命伤保1血并本回合无敌（每场1次）
  const immortalBlade = wouldKill && !!t.surviveLethalInvincible && !t.surviveUsed;
  const survived = wouldKill && (!!t.passives.surviveLethal || immortalBlade) && !t.surviveUsed;
  if (survived) {
    t.surviveUsed = true;
    t.hp = 1;
    if (immortalBlade) {
      t.invincibleThisTurn = true;
      addLog(s, { t: 'info', text: `【名刀司命】${t.name} 受到致命伤，保留1滴血并本回合无敌` });
    }
  } else {
    t.hp = Math.max(0, t.hp - toHp);
  }
  // 热辣可可/肾上腺素：受击后实时重算损血加成
  recalcHpLossBonuses(t);
  // 种植者名单：记录本回合是否受到HP伤害
  if (toHp > 0) t.wasHitLastTurn = true;
  // 冥王破天：累计本回合受到的伤害（用于破天速度增长）
  if (t.crisis?.mingwang && toHp > 0) {
    t.crisis.mingwang.potianDmgThisTurn += toHp;
  }
  const killed = t.hp <= 0;
  addLog(s, { t: 'damage', targetUid: t.uid, amount: toHp, type, killed, blocked: blocked > 0 ? blocked : undefined });
  // 被攻击标记（夺舍红狼判定用）
  t.hitThisTurn = true;
  // 猛攻肥区：每被攻击一次攻防法抗-X，最多N次
  if (t.debuffOnHit && (t.debuffOnHitCount ?? 0) < t.debuffOnHit.maxTimes) {
    const d = t.debuffOnHit;
    t.stats.atk = Math.max(0, t.stats.atk - d.atk);
    t.stats.def = Math.max(0, t.stats.def - d.def);
    t.stats.mres = Math.max(0, t.stats.mres - d.mres);
    t.debuffOnHitCount = (t.debuffOnHitCount ?? 0) + 1;
    addLog(s, { t: 'info', text: `【${t.name}】被攻击后攻防法抗各-${d.atk}（第${t.debuffOnHitCount}/${d.maxTimes}次）` });
  }
  // 王牌单位「适应」：受击后积累对应伤害类型减伤（上限80%）
  if (t.aceDmgRedOnHit && t.aceDmgRedOnHitGain) {
    const cap = t.aceDmgRedOnHit.cap;
    if (type === 'physical') {
      t.aceDmgRedOnHit.phys = Math.min(cap, t.aceDmgRedOnHit.phys + t.aceDmgRedOnHitGain);
    } else if (type === 'magical') {
      t.aceDmgRedOnHit.magic = Math.min(cap, t.aceDmgRedOnHit.magic + t.aceDmgRedOnHitGain);
    }
  }
  // 王牌单位「狮身人面像」：受击后防御+10、法抗+5（防御上限+20、法抗上限+10）
  if (t.aceDefUpOnHit && toHp > 0) {
    const cnt = t.aceDefUpOnHitCount ?? { def: 0, mres: 0 };
    const upd = { ...cnt };
    if (t.aceDefUpOnHit.defCap == null || upd.def < t.aceDefUpOnHit.defCap) {
      t.stats.def += t.aceDefUpOnHit.def;
      upd.def += 1;
    }
    if (t.aceDefUpOnHit.mresCap == null || upd.mres < t.aceDefUpOnHit.mresCap) {
      t.stats.mres += t.aceDefUpOnHit.mres;
      upd.mres += 1;
    }
    t.aceDefUpOnHitCount = upd;
  }
  // 灾厄：被攻击时使攻击者中毒（剧毒鲶鱼）
  if (t.poisonOnHit && attacker && toHp > 0) {
    const b = addBuff(attacker, 'poison', t.poisonOnHit.stacks, t.poisonOnHit.intensity, t.uid);
    addLog(s, { t: 'buff', uid: attacker.uid, buffId: 'poison', stacks: b.stacks, intensity: b.intensity, applied: true });
  }
  // 灾厄：被攻击时对攻击者造成真实伤害（渊海海胆）
  if (t.counterTrueDmg && attacker && toHp > 0 && attacker.alive) {
    damageFlat(s, attacker.uid, t.counterTrueDmg, 'true', t);
  }
  // 灾厄：每次被攻击防御+X（上限）（棱晶背龟）
  if (t.defUpOnHit && toHp > 0) {
    const cnt = t.defUpOnHitCount ?? 0;
    if (cnt < t.defUpOnHit.cap) {
      t.stats.def += t.defUpOnHit.amount;
      t.defUpOnHitCount = cnt + 1;
    }
  }
  // 灾厄：被攻击后下回合速度+X（污染躯壳/木裂战士，可设上限）
  if (t.spdUpOnHit && toHp > 0) {
    const cap = t.spdUpOnHitCap;
    const next = (t.spdUpPending ?? 0) + t.spdUpOnHit;
    t.spdUpPending = cap != null ? Math.min(cap, next) : next;
  }
  // 灾厄攻击者：吸血（脸怪/猩红喀迈拉）
  if (attacker && toHp > 0) {
    if (attacker.lifestealPct) {
      const heal = Math.ceil(toHp * attacker.lifestealPct);
      if (heal > 0 && attacker.alive) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
        addLog(s, { t: 'heal', targetUid: attacker.uid, amount: heal });
      }
    }
    if (attacker.lifestealAllPct) {
      const heal = Math.ceil(toHp * attacker.lifestealAllPct);
      if (heal > 0) {
        const allies = attacker.side === 'ally' ? s.allies : s.enemies;
        for (const a of allies) {
          if (a.alive) a.hp = Math.min(a.maxHp, a.hp + heal);
        }
        addLog(s, { t: 'info', text: `【${attacker.name}】吸血治疗全体 ${heal} 点` });
      }
    }
    // 灾厄：普攻减少目标 MP（噬魂怪）
    if (attacker.mpDrain && t.alive) {
      t.mp = Math.max(0, t.mp - attacker.mpDrain);
    }
    // 灾厄：额外造成目标最大生命 X% 真实伤害（灵魂饮食者）
    // 递归保护：extraDmgProc 置位期间不再触发，避免与 applyDamage/damageFlat 循环
    if (attacker.maxHpTrueDmgPct && t.alive && !attacker.extraDmgProc) {
      attacker.extraDmgProc = true;
      const extra = Math.ceil(t.maxHp * attacker.maxHpTrueDmgPct);
      if (extra > 0) damageFlat(s, t.uid, extra, 'true', attacker);
      attacker.extraDmgProc = false;
    }
    // 灾厄：攻击附带瘟疫（暗精灵僵尸）
    // extraDmgProc 保护：瘟疫法伤的子伤害调用会再次进入 applyHpDamage，避免重复施加导致层数翻倍
    if (attacker.plagueOnHit && t.alive && !attacker.extraDmgProc) {
      const b = addBuff(t, 'plague', attacker.plagueOnHit.stacks, attacker.plagueOnHit.intensity, attacker.uid);
      addLog(s, { t: 'buff', uid: t.uid, buffId: 'plague', stacks: b.stacks, intensity: b.intensity, applied: true });
    }
    // 灾厄：普攻减少目标防御（装甲步兵）
    if (attacker.defDownOnHit && t.alive) {
      t.stats.def = Math.max(0, t.stats.def - attacker.defDownOnHit);
    }
    // 灾厄：普攻额外造成 瘟疫层数×X 真实伤害（哀嚎暗精灵僵尸）
    if (attacker.plagueStackBonusTrueDmg && t.alive && !attacker.extraDmgProc) {
      attacker.extraDmgProc = true;
      const plagueBuff = t.buffs.find((b) => b.id === 'plague');
      const stacks = plagueBuff?.stacks ?? 0;
      if (stacks > 0) {
        const extra = Math.ceil(stacks * attacker.plagueStackBonusTrueDmg);
        damageFlat(s, t.uid, extra, 'true', attacker);
      }
      attacker.extraDmgProc = false;
    }
    // 灾厄：普攻额外造成 (80+瘟疫层数×X) 法术伤害（悲鸣暗精灵僵尸）
    if (attacker.plagueStackBonusMagicDmg && t.alive && !attacker.extraDmgProc) {
      attacker.extraDmgProc = true;
      const plagueBuff = t.buffs.find((b) => b.id === 'plague');
      const stacks = plagueBuff?.stacks ?? 0;
      const extra = 80 + Math.ceil(stacks * attacker.plagueStackBonusMagicDmg);
      applyDamage(s, t, extra, 'magical', attacker);
      attacker.extraDmgProc = false;
    }
  }
  // 巨像蛤：每次被攻击自身防御 -= 攻击者魅力值
  if (t.defLoseOnHitCha && attacker && toHp > 0) {
    const cha = attacker.cha ?? 0;
    if (cha > 0) {
      t.stats.def = Math.max(0, t.stats.def - cha);
      addLog(s, { t: 'info', text: `【${t.name}】防御-${cha}（攻击者魅力）` });
    }
  }
  // 巨像蛤：每次被攻击对敌方全体造成 X 点真实伤害
  if (t.aoeTrueDmgOnHit && toHp > 0) {
    for (const o of alive(opponentsOf(s, t))) {
      if (o.alive && o.uid !== t.uid) damageFlat(s, o.uid, t.aoeTrueDmgOnHit, 'true', t);
    }
    addLog(s, { t: 'info', text: `【${t.name}】对敌方全体造成 ${t.aoeTrueDmgOnHit} 点真实伤害` });
  }
  // 劳贤：受击获得1层红温印记
  if (t.monsterId === 'ct_077' && toHp > 0) {
    if (!t.crisis) t.crisis = {};
    if (!t.crisis.laoxian) t.crisis.laoxian = { red: 0 };
    const lx = t.crisis.laoxian;
    if (lx.red < 3) {
      lx.red = Math.min(3, lx.red + 1);
      addLog(s, { t: 'info', text: `【${t.name}】受击，红温印记+1（${lx.red}/3）` });
    }
  }
  if (survived) {
    addLog(s, { t: 'survive', uid: t.uid, name: t.name });
    return;
  }
  if (killed) {
    t.alive = false;
    addLog(s, { t: 'death', uid: t.uid, name: t.name });
    // 阿卡多：场上任意单位死亡（含食尸鬼第一条命）→ 血槽+50
    const akado = s.enemies.find((e) => e.monsterId === 'ct_070' && e.alive);
    if (akado && akado.crisis?.akado && akado.crisis.akado.bloodPool < 500) {
      akado.crisis.akado.bloodPool = Math.min(500, akado.crisis.akado.bloodPool + 50);
      addLog(s, { t: 'info', text: `【${akado.name}】因单位死亡血槽+50（当前${akado.crisis.akado.bloodPool}/500）` });
    }
    // 冰霜巨人：死亡自爆，对随机敌方单位造成300点法术伤害
    if (t.monsterId === 'ct_071') {
      const targets = alive(s.allies);
      if (targets.length) {
        const rt = targets[Math.floor(Math.random() * targets.length)];
        damageFlat(s, rt.uid, 300, 'magical', t);
        addLog(s, { t: 'info', text: `【${t.name}】死亡自爆，对【${rt.name}】造成300点法术伤害` });
      }
    }
    // 灾厄：死亡时复活一次（食尸鬼）
    if (t.reviveOnce && !t.revived) {
      t.hp = t.maxHp;
      t.alive = true;
      t.revived = true;
      addLog(s, { t: 'info', text: `【${t.name}】浴火重生，恢复全部生命` });
      return;
    }
    // 阿卡多：首次死亡后复活一次——血槽归0，恢复死亡前血槽×10的HP
    if (t.monsterId === 'ct_070' && !t.revived) {
      const ak = t.crisis?.akado;
      const heal = (ak?.bloodPool ?? 0) * 10;
      t.hp = Math.min(t.maxHp, heal);
      t.alive = true;
      t.revived = true;
      if (ak) ak.bloodPool = 0;
      addLog(s, { t: 'info', text: `【${t.name}】血槽归0，恢复 ${heal} HP（首次死亡复活）` });
      return;
    }
    // 爱弥斯：敌方死亡时转移聚爆层数
    transferImplosionFromDead(s, t);
    // 应龙死亡：落雷直接消失，不会自爆
    if (t.monsterId === 'yingLong' || t.monsterId === 'ct_079') {
      for (const luo of s.enemies) {
        if (luo.monsterId === 'luolei' && luo.alive) {
          luo.alive = false;
          luo.hp = 0;
          addLog(s, { t: 'info', text: `【落雷】随应龙一同消散` });
        }
      }
    }
    // 老板：成功击杀时额外掉落
    if (t.bonusDropOnKill && !t.fled) {
      s.bonusDrops ??= [];
      s.bonusDrops.push(t.bonusDropOnKill);
      addLog(s, { t: 'info', text: `【${t.name}】被击杀，额外掉落已记录` });
    }
    // 击杀触发遗物效果（伪翅/异香角/嗜血之兽/撕咬的渴望）
    if (attacker && attacker.side === 'ally' && attacker.alive) {
      if (attacker.killInvincible) {
        attacker.invincibleThisTurn = true;
        addLog(s, { t: 'info', text: `【伪翅】${attacker.name} 击杀后进入无敌状态` });
      }
      if (attacker.killMpRestore && attacker.mp < attacker.maxMp) {
        const gain = Math.min(attacker.killMpRestore, attacker.maxMp - attacker.mp);
        attacker.mp += gain;
      }
      if (attacker.killHpRestore && attacker.hp < attacker.maxHp) {
        let heal = attacker.killHpRestore;
        if (attacker.healAmp) heal = Math.floor(heal * (1 + attacker.healAmp));
        const gain = Math.min(heal, attacker.maxHp - attacker.hp);
        attacker.hp += gain;
        addLog(s, { t: 'heal', targetUid: attacker.uid, amount: gain });
      }
      if (attacker.killSpdBuff) {
        attacker.stats.spdMin += attacker.killSpdBuff;
        attacker.stats.spdMax += attacker.killSpdBuff;
        addLog(s, { t: 'info', text: `【撕咬的渴望】${attacker.name} 速度+${attacker.killSpdBuff}` });
      }
    }
    // 黑色瘟疫·狄瑞吉：击杀敌方单位时召唤一只随机暗精灵僵尸（哀嚎/悲鸣）
    if (attacker && attacker.monsterId === 'ct_083' && t.side === 'ally' && attacker.alive) {
      const isAimao = Math.random() < 0.5;
      const zid = isAimao ? 'ct_080' : 'ct_081';
      const zname = isAimao ? '哀嚎的暗精灵僵尸' : '悲鸣的暗精灵僵尸';
      const zombie = makeCombatant({
        uid: `summon_${s.nextSummonId++}`, side: 'enemy', name: zname,
        stats: { hp: 500, mp: 0, atk: 80, def: 50, mres: 50, spdMin: 2, spdMax: 6 },
        ai: 'basic', monsterId: zid, attackType: 'physical',
        plagueOnHit: { stacks: 2, intensity: 1 },
        ...(isAimao ? { plagueStackBonusTrueDmg: 20 } : { plagueStackBonusMagicDmg: 10 }),
      });
      s.enemies.push(zombie);
      addLog(s, { t: 'info', text: `【${attacker.name}】击杀了 ${t.name}，召唤了 ${zname}` });
    }
    handleDeath(s, t);
    syncInvincibleWhileAllies(s);
    return;
  }
  // 召唤机制：受击后血量跌破下一档阈值时召唤一只（每档仅触发一次）
  checkSummonOnHit(s, t);
  // 凯隐暗裔魔镰被动：血量跌破阈值时触发（每场1次）
  if (t.kaynHpThreshold && !t.kaynPassiveUsed) {
    const threshold = t.maxHp * (1 - t.kaynHpThreshold);
    if (t.hp <= threshold) {
      t.kaynPassiveUsed = true;
      const gain = t.kaynEnergyOnTrigger ?? 20;
      const max = t.energyMax ?? 100;
      const before = t.energy ?? 0;
      const after = before + gain;
      if (after > max) {
        t.energy = max;
        const overflow = after - max;
        const shieldGain = Math.floor(overflow * (t.energyOverflowRatio ?? 1));
        if (shieldGain > 0) {
          const g = gainShield(s, t, shieldGain);
          if (g > 0) addLog(s, { t: 'shield', targetUid: t.uid, amount: g });
        }
      } else {
        t.energy = after;
      }
      t.shieldStacks = (t.shieldStacks ?? 0) + 1;
      addLog(s, { t: 'info', text: `【暗裔魔镰】${t.name}血量跌破阈值，获得 ${gain} 能量与 1 次数盾` });
    }
  }
}

// 受击后按血线阈值依次召唤：每跌破一档追加一只召唤物（下回合起行动），可附带自身速度提升
function checkSummonOnHit(s: BattleState, t: Combatant): void {
  const sm = t.summon;
  if (!sm || !t.summonTemplate || !t.alive) return;
  let stage = t.summonStage ?? 0;
  while (stage < sm.thresholds.length && t.hp / t.maxHp <= sm.thresholds[stage]) {
    const unit = structuredClone(t.summonTemplate);
    unit.uid = `summon_${s.nextSummonId++}`;
    s.enemies.push(unit);
    if (sm.selfSpdUp) {
      t.stats.spdMin = Math.max(0, t.stats.spdMin + sm.selfSpdUp);
      t.stats.spdMax = Math.max(0, t.stats.spdMax + sm.selfSpdUp);
    }
    addLog(s, {
      t: 'summon', uid: t.uid, name: t.name,
      targetUid: unit.uid, targetName: unit.name,
    });
    stage += 1;
  }
  t.summonStage = stage;
}

// 危机合约应龙：召唤落雷（不攻击，回合末自爆造成剩余HP真实伤害）
function summonLuolei(s: BattleState, hp: number): void {
  const unit = makeCombatant({
    uid: `luolei_${s.nextSummonId++}`,
    name: '落雷',
    side: 'enemy',
    stats: { hp, mp: 0, atk: 0, def: 0, mres: 0, spdMin: 1, spdMax: 1 },
    ai: 'basic',
    monsterId: 'luolei',
  });
  s.enemies.push(unit);
  addLog(s, { t: 'summon', uid: '', name: '应龙', targetUid: unit.uid, targetName: '落雷' });
  addLog(s, { t: 'info', text: `应龙召唤了【落雷】（HP ${hp}），将在回合末自爆` });
}

// 凋亡引爆检测：若目标凋亡层数≥触发阈值则立即引爆，造成 最大MP×强度 的固定真实伤害，之后移除凋亡
function tryTriggerApoptosis(s: BattleState, u: Combatant): void {
  if (!u.alive) return;
  const apop = u.buffs.find((b) => b.id === 'apoptosis');
  if (apop && apop.stacks >= APOPTOSIS_TRIGGER_STACKS) {
    // 凋亡伤害 = 施加者（逻各斯）的魔力上限 × BUFF缩放 × 强度
    const owner = apop.ownerUid ? byUid(s, apop.ownerUid) : undefined;
    const baseMp = owner?.maxMp ?? u.maxMp;
    const dmg = Math.ceil(baseMp * BUFF_SCALE.apoptosis * apop.intensity);
    damageFlat(s, u.uid, dmg, 'true');
    // 万星园之辉：敌方受到层数引爆伤害时额外再受到一次同样的伤害
    if (owner?.detonateDouble) {
      damageFlat(s, u.uid, dmg, 'true');
      addLog(s, { t: 'info', text: `【万星园之辉】引爆伤害额外结算一次（${dmg}）` });
    }
    u.buffs = u.buffs.filter((b) => b.id !== 'apoptosis');
    addLog(s, { t: 'buff', uid: u.uid, buffId: 'apoptosis', stacks: 0, intensity: 0, applied: false });
    addLog(s, { t: 'vfx', uid: u.uid, kind: 'logos-apoptosis' });
  }
}

// ===== 爱弥斯 · 聚爆体系 =====
// 聚爆层数上限 = 基础上限 + 同步率×每点同步率上限加成
function eimisImplosionCap(c: Combatant): number {
  const star = c.skills.find((sk) => sk.eimisImplosionBaseCap);
  const base = star?.eimisImplosionBaseCap ?? 10;
  const shape = c.skills.find((sk) => sk.eimisSyncCapBonus);
  const perSync = shape?.eimisSyncCapBonus ?? 0;
  return base + (c.eimisSyncRate ?? 0) * perSync;
}

// 对目标施加聚爆层数；达到上限则引爆（伤害=上限×每层%攻击力），溢出转为下次倍率加成
function applyImplosionStacks(s: BattleState, c: Combatant, targetUid: string, stacks: number): void {
  if (stacks <= 0) return;
  const target = byUid(s, targetUid);
  if (!target || !target.alive) return;
  const star = c.skills.find((sk) => sk.eimisImplosionDmgPctPerStack);
  if (!star) return;
  const cap = eimisImplosionCap(c) + (s.allies.reduce((sum, a) => sum + (a.aceImplosionCapBonus ?? 0), 0));
  const dmgPctPerStack = star.eimisImplosionDmgPctPerStack ?? 12;
  const existing = target.buffs.find((b) => b.id === 'implosion');
  const cur = existing?.stacks ?? 0;
  const total = cur + stacks;
  if (total >= cap) {
    // 引爆：伤害 = 上限 × 每层% × 攻击力
    const dmg = Math.floor(cap * dmgPctPerStack / 100 * c.stats.atk);
    // 溢出层数 → 下次普攻/强化普攻倍率加成（每层+10%）
    const overflow = total - cap;
    if (overflow > 0) {
      c.eimisOverflowMulBonus = (c.eimisOverflowMulBonus ?? 0) + overflow * 0.10;
    }
    // 清零层数（可继续叠）
    if (existing) existing.stacks = 0;
    else addBuff(target, 'implosion', 0, 1, c.uid);
    if (dmg > 0) {
      damageFlat(s, targetUid, dmg, 'magical', c);
      // 万星园之辉：敌方受到层数引爆伤害时额外再受到一次同样的伤害
      if (c.detonateDouble) {
        damageFlat(s, targetUid, dmg, 'magical', c);
        addLog(s, { t: 'info', text: `【万星园之辉】引爆伤害额外结算一次（${dmg}）` });
      }
      addLog(s, { t: 'info', text: `【聚爆】${target.name} 层数达到上限 ${cap}，引爆造成 ${dmg} 点法术伤害${overflow > 0 ? `（溢出${overflow}层，下次倍率+${Math.round(overflow * 10)}%）` : ''}` });
    }
    c.eimisDetonatedThisTurn = true;
  } else {
    const b = addBuff(target, 'implosion', stacks, 1, c.uid);
    addLog(s, { t: 'buff', uid: targetUid, buffId: 'implosion', stacks: b.stacks, intensity: b.intensity, applied: true });
  }
}

// 爱弥斯：切换形态（人→机甲 / 机甲→人）
function doEimisFormSwitch(s: BattleState, c: Combatant, fromTurnEnd = false): void {
  const voyage = c.skills.find((sk) => sk.eimisHumanChaGain);
  if (!voyage) return;
  const wasHuman = c.eimisForm === 'human';
  // 切换
  c.eimisForm = wasHuman ? 'mech' : 'human';
  // 切换立绘：人形态用「爱弥斯」，机甲形态用「爱弥斯-机甲」
  c.icon = c.eimisForm === 'mech' ? JOB_IMAGES.eimisMech : JOB_IMAGES.eimis;
  // 回合末形态切换：播放「爱弥斯形态切换.avif」动画
  if (fromTurnEnd) addLog(s, { t: 'vfx', uid: c.uid, kind: 'eimisFormSwitch' });
  if (wasHuman) {
    // 切到机甲：获得 魅力×倍率 护盾
    const mul = voyage.eimisMechShieldChaMul ?? 1.5;
    const shield = Math.floor((c.cha ?? 0) * mul);
    if (shield > 0) {
      const gain = gainShield(s, c, shield);
      addLog(s, { t: 'shield', targetUid: c.uid, amount: gain });
    }
    addLog(s, { t: 'info', text: `【共赴长航】${c.name} 切换为机甲形态，获得 ${shield} 点护盾` });
  } else {
    // 切到人：魅力+X（上限=基础魅力+技能上限值），永久保留
    const gain = voyage.eimisHumanChaGain ?? 10;
    const capBonus = voyage.eimisHumanChaCap ?? 20;
    const baseCha = c.baseSnapshot?.cha ?? (c.cha ?? 0);
    const cap = baseCha + capBonus;
    const before = c.cha ?? 0;
    c.cha = Math.min(cap, before + gain);
    const actual = (c.cha ?? 0) - before;
    addLog(s, { t: 'info', text: `【共赴长航】${c.name} 切换为人形态，魅力+${actual}（当前 ${c.cha}/${cap}）` });
  }
  // 为寂静赋形：通过回合末触发切换获得1点同步率
  if (fromTurnEnd) {
    gainEimisSync(s, c, 1);
  }
}

// 爱弥斯：获得同步率（不超过上限），并标记下次普攻为辉芒
function gainEimisSync(s: BattleState, c: Combatant, amount: number): void {
  if (amount <= 0) return;
  const max = c.eimisSyncMax ?? 4;
  const before = c.eimisSyncRate ?? 0;
  const after = Math.min(max, before + amount);
  const gained = after - before;
  if (gained <= 0) return;
  c.eimisSyncRate = after;
  // 每点同步率：无视法抗 +X（扁平，叠加到 ignoreMresFlat）
  const shape = c.skills.find((sk) => sk.eimisMresPenPerSync);
  const penPer = shape?.eimisMresPenPerSync ?? 0;
  if (penPer > 0) {
    c.ignoreMresFlat = (c.ignoreMresFlat ?? 0) + gained * penPer;
  }
  // 每获得1点同步率，下次普攻变为辉芒
  c.eimisNextAtkHuiMang = true;
  addLog(s, { t: 'info', text: `【为寂静赋形】${c.name} 同步率 +${gained}（${after}/${max}），下次普攻变为辉芒` });
}

// 爱弥斯：敌方单位死亡时，将其聚爆层数转移给当前场上层数最高的存活敌方
function transferImplosionFromDead(s: BattleState, dead: Combatant): void {
  if (dead.side !== 'enemy') return;
  const imp = dead.buffs.find((b) => b.id === 'implosion');
  const stacks = imp?.stacks ?? 0;
  if (stacks <= 0) return;
  // 找场上（敌方）存活单位中聚爆层数最高的
  const candidates = s.enemies.filter((e) => e.alive && e.uid !== dead.uid);
  if (candidates.length === 0) return;
  let target = candidates[0];
  let maxStacks = target.buffs.find((b) => b.id === 'implosion')?.stacks ?? 0;
  for (const e of candidates) {
    const st = e.buffs.find((b) => b.id === 'implosion')?.stacks ?? 0;
    if (st > maxStacks) { maxStacks = st; target = e; }
  }
  // 转移层数（可能触发目标的引爆）
  const owner = imp?.ownerUid ? byUid(s, imp.ownerUid) : undefined;
  if (owner) applyImplosionStacks(s, owner, target.uid, stacks);
  else {
    addBuff(target, 'implosion', stacks, 1, imp?.ownerUid);
  }
  addLog(s, { t: 'info', text: `【为寂静赋形】${dead.name} 死亡，${stacks} 层聚爆转移至 ${target.name}` });
}

// 殁亡斩杀：回合末对敌方执行斩杀判定，可连锁
// 阈值 = 等级×2 + 智力×executeIntMul
// 斩杀后对随机存活敌方造成 被斩杀单位当前HP 的法术伤害，若使目标进入斩杀线则继续连锁
function executeMortChain(s: BattleState, caster: Combatant): void {
  if (!caster.executeIntMul || !caster.alive) return;
  const threshold = (caster.charLevel ?? 1) * 2 + (caster.int ?? 0) * caster.executeIntMul;
  const enemies = caster.side === 'ally' ? s.enemies : s.allies;
  let maxIterations = 20; // 安全上限，防止无限循环
  while (maxIterations-- > 0) {
    if (s.result) break;
    const targets = enemies.filter((e) => e.alive && e.hp <= threshold);
    if (targets.length === 0) break;
    // 斩杀第一个满足条件的目标
    const target = targets[0];
    const executeHp = target.hp;
    target.hp = 0;
    target.alive = false;
    addLog(s, { t: 'death', uid: target.uid, name: target.name });
    transferImplosionFromDead(s, target);
    addLog(s, { t: 'info', text: `【殁亡】${caster.name} 斩杀了 ${target.name}！` });
    addLog(s, { t: 'vfx', uid: target.uid, kind: 'logos-execute' });
    handleDeath(s, target); // 触发 BOSS 部位联动 + checkResult
    if (s.result) break;
    // 仅在 executeChain 为 true 时才对随机存活敌方造成溅射法术伤害并继续连锁
    if (!caster.executeChain) break;
    const others = enemies.filter((e) => e.alive);
    if (others.length === 0) break;
    const nextTarget = others[Math.floor(Math.random() * others.length)];
    // 把 executeHp 当作基础攻击力、倍率=1 来计算法术伤害
    const dmg = calcDamage(
      { ...caster, stats: { ...caster.stats, atk: executeHp } },
      nextTarget,
      1,
      'magical',
    );
    applyDamage(s, nextTarget, dmg, 'magical');
    if (s.result) break;
  }
}

// 怪物普攻命中存活目标后附加的 BUFF（束缚/中毒/流血等）
function applyBasicAttackBuffs(s: BattleState, c: Combatant, targetUid: string): void {
  if (!c.basicAttackBuffs?.length && !c.condensGrenadeActive) return;
  const t = byUid(s, targetUid);
  if (!t.alive) return;
  // 冷凝榴弹：普攻附加寒冷
  if (c.condensGrenadeActive) {
    const b = addBuff(t, 'chill', c.condensGrenadeActive.chillPerHit, 1, c.uid);
    addLog(s, { t: 'buff', uid: t.uid, buffId: 'chill', stacks: b.stacks, intensity: b.intensity, applied: true });
  }
  for (const ab of c.basicAttackBuffs ?? []) {
    const b = addBuff(t, ab.id, ab.stacks, ab.intensity);
    addLog(s, { t: 'buff', uid: t.uid, buffId: ab.id, stacks: b.stacks, intensity: b.intensity, applied: true });
  }
  // 凋亡：叠加后若达到3层立即引爆
  tryTriggerApoptosis(s, t);
}

// ===== DONK · 闪身步/世一步：追踪MP消耗并按阈值加速、累积世一步真伤 =====
function trackDonkMpConsumption(s: BattleState, c: Combatant, amount: number): void {
  if (amount <= 0) return;
  const before = c.donkTotalMpConsumed ?? 0;
  c.donkTotalMpConsumed = before + amount;
  // 闪身步：每 dodgerMpPerSpd MP +1速度（上限 dodgerSpdCap）
  const dodger = c.skills.find((sk) => sk.dodgerMpPerSpd);
  if (dodger) {
    const perSpd = dodger.dodgerMpPerSpd ?? 30;
    const cap = dodger.dodgerSpdCap ?? 3;
    const expected = Math.min(cap, Math.floor(c.donkTotalMpConsumed / perSpd));
    const gained = c.donkDodgerSpdGained ?? 0;
    if (expected > gained) {
      const add = expected - gained;
      c.stats.spdMin += add;
      c.stats.spdMax += add;
      c.donkDodgerSpdGained = expected;
      addLog(s, { t: 'info', text: `【闪身步】${c.name} 速度+${add}（当前最大速度 ${effSpd(c).max}）` });
    }
  }
  // 世一步：每消耗30MP累积1次真伤待触发
  const shiyi = c.skills.find((sk) => sk.shiyiMpCost);
  if (shiyi) {
    const newProcs = Math.floor(c.donkTotalMpConsumed / 30) - Math.floor(before / 30);
    if (newProcs > 0) {
      c.donkShiyiPendingProcs = (c.donkShiyiPendingProcs ?? 0) + newProcs;
    }
  }
}

// ===== 新约能天使 · 弹药消耗（含火力电台触发）=====
function consumeAmmo(s: BattleState, c: Combatant, amount: number): number {
  if (amount <= 0 || c.ammo === undefined) return 0;
  const actual = Math.min(amount, c.ammo);
  c.ammo -= actual;
  // 每发弹药提升下次攻击倍率
  const per = c.ammoMulPerBullet ?? 0.1;
  c.ammoNextMulBonus = (c.ammoNextMulBonus ?? 0) + actual * per;
  // 累计消耗，触发火力电台
  const before = c.ammoConsumedTotal ?? 0;
  c.ammoConsumedTotal = before + actual;
  triggerFireRadio(s, c, before, c.ammoConsumedTotal);
  return actual;
}

// ===== 新约能天使 · 火力电台：每消耗阈值发弹药触发一次 =====
function triggerFireRadio(s: BattleState, c: Combatant, beforeTotal: number, afterTotal: number): void {
  const radio = c.skills.find((sk) => sk.radioAmmoThreshold);
  if (!radio) return;
  const threshold = radio.radioAmmoThreshold ?? 10;
  const basePct = radio.radioDmgBasePct ?? 100;
  const dmgMul = (basePct + (c.agi ?? 0)) / 100;
  const healMul = radio.radioHealLukMul ?? 1;
  const times = Math.floor(afterTotal / threshold) - Math.floor(beforeTotal / threshold);
  if (times <= 0) return;
  const enemies = (c.side === 'ally' ? s.enemies : s.allies).filter((e) => e.alive);
  for (let i = 0; i < times; i++) {
    if (enemies.length === 0 || s.result) break;
    // 随机存活敌方
    const target = enemies[Math.floor(Math.random() * enemies.length)];
    if (!target.alive) continue;
    applyDamage(s, target, calcDamage(c, target, dmgMul, 'physical'), 'physical', c);
    addLog(s, { t: 'info', text: `【火力电台】${c.name} 倾泻火力，对 ${target.name} 造成 ${Math.round(dmgMul * 100)}% 攻击力物理伤害` });
    // 回复自身幸运值HP
    const heal = Math.floor((c.luk ?? 0) * healMul);
    if (heal > 0 && c.alive) {
      const beforeHp = c.hp;
      c.hp = Math.min(c.maxHp, c.hp + heal);
      const gained = c.hp - beforeHp;
      if (gained > 0) addLog(s, { t: 'heal', targetUid: c.uid, amount: gained });
    }
  }
}

// ===== 新约能天使 · 开火成瘾：攻击前额外消耗弹药（倍率加成作用于本次攻击）=====
function consumeFireAddictionAmmo(s: BattleState, c: Combatant): void {
  const buff = c.buffs.find((b) => b.id === 'fireAddiction');
  if (!buff) return;
  const extra = buff.intensity;
  if (extra <= 0) return;
  const actual = consumeAmmo(s, c, extra);
  if (actual < extra) {
    // 弹药不足：解除开火成瘾
    c.buffs = c.buffs.filter((b) => b.id !== 'fireAddiction');
    addLog(s, { t: 'info', text: `【开火成瘾】${c.name} 弹药不足，开火成瘾解除` });
  } else {
    addLog(s, { t: 'info', text: `【开火成瘾】${c.name} 额外消耗 ${actual} 发弹药` });
  }
}

// ===== DONK · 世一步：消耗待触发次数，每次造成(力量×倍率)%攻击力的真伤 =====
function applyDonkShiyiProc(s: BattleState, c: Combatant, targetUid: string): void {
  const procs = c.donkShiyiPendingProcs ?? 0;
  if (procs <= 0) return;
  const shiyi = c.skills.find((sk) => sk.shiyiMpCost);
  if (!shiyi) return;
  const strMul = shiyi.shiyiTrueDmgStrMul ?? 0;
  const atk = c.stats.atk;
  const dmgPerProc = Math.floor((c.str ?? 0) * strMul / 100 * atk);
  const target = byUid(s, targetUid);
  if (!target || !target.alive) return;
  if (dmgPerProc <= 0) {
    c.donkShiyiPendingProcs = 0;
    return;
  }
  c.donkShiyiPendingProcs = 0;
  let totalDmg = 0;
  for (let i = 0; i < procs; i++) {
    if (!target.alive) break;
    totalDmg += dmgPerProc;
    damageFlat(s, targetUid, dmgPerProc, 'true', c);
  }
  if (totalDmg > 0) {
    addLog(s, { t: 'info', text: `【世一步】${c.name} 触发 ${procs} 次真伤，每次 ${dmgPerProc}，共 ${totalDmg}` });
  }
}

// ===== DONK · 魔王：攻击附带(力量×倍率)%攻击力的真伤 =====
function applyDemonTrueDmg(s: BattleState, c: Combatant, targetUid: string): void {
  const demon = c.skills.find((sk) => sk.demonStrMul);
  if (!demon) return;
  const strMul = demon.demonStrMul ?? 0;
  const str = c.str ?? 0;
  const dmg = Math.floor(str * strMul / 100 * c.stats.atk);
  if (dmg > 0 && byUid(s, targetUid)?.alive) {
    damageFlat(s, targetUid, dmg, 'true', c);
    addLog(s, { t: 'info', text: `【魔王】附带 ${dmg} 点真实伤害` });
  }
}

// ===== DONK · 魔王：累计消耗MP达到阈值时，每回合获得强壮 =====
function applyDemonStrength(s: BattleState, c: Combatant): void {
  const demon = c.skills.find((sk) => sk.demonStrCap);
  if (!demon) return;
  const threshold = demon.demonMpThreshold ?? 50;
  if ((c.donkTotalMpConsumed ?? 0) < threshold) return;
  const cap = demon.demonStrCap ?? 2;
  const existing = c.buffs.find((b) => b.id === 'strength');
  if (existing) {
    existing.stacks += 1;
    existing.intensity = Math.min(cap, existing.intensity + 1);
  } else {
    addBuff(c, 'strength', 1, Math.min(cap, 1), c.uid);
  }
  const b = c.buffs.find((bb) => bb.id === 'strength')!;
  addLog(s, { t: 'buff', uid: c.uid, buffId: 'strength', stacks: b.stacks, intensity: b.intensity, applied: true });
  addLog(s, { t: 'info', text: `【魔王】${c.name} 已消耗 ${threshold}MP，获得强壮（层数${b.stacks}，强度${b.intensity}）` });
}

// ===== 氮氮 · 冷凝榴弹（被动）：寒冷伤害/消耗层数阈值触发减益 =====
const CONDENS_CHILL_DMG_T1 = 500;
const CONDENS_CHILL_DMG_T2 = 1000;
const CONDENS_CONSUMED_CHILL = 10;

function findCondensGrenade(s: BattleState): { defRedPct: number; mresRed: number; permSpdRed: number } | null {
  for (const a of s.allies) {
    const sk = a.skills.find((x) => x.id === 'sk_dandan_condens');
    if (sk) {
      return {
        defRedPct: sk.condensDefRedPct ?? 5,
        mresRed: sk.condensMresRed ?? 5,
        permSpdRed: sk.condensPermSpdRed ?? 1,
      };
    }
  }
  return null;
}

function checkCondensThresholds(s: BattleState, t: Combatant, cg: { defRedPct: number; mresRed: number; permSpdRed: number }): void {
  // 寒冷伤害阈值（>500 触发一次，>1000 再触发一次，叠加）
  const tier = t.condensDmgTier ?? 0;
  const dmg = t.condensChillDmg ?? 0;
  if (tier < 1 && dmg > CONDENS_CHILL_DMG_T1) {
    applyCondensDebuff(s, t, cg);
    t.condensDmgTier = 1;
  }
  if ((t.condensDmgTier ?? 0) < 2 && dmg > CONDENS_CHILL_DMG_T2) {
    applyCondensDebuff(s, t, cg);
    t.condensDmgTier = 2;
  }
  // 累计消耗寒冷层数 >10：永久减速（仅一次）
  if (!t.condensSpdApplied && (t.condensConsumedChill ?? 0) > CONDENS_CONSUMED_CHILL) {
    t.stats.spdMin = Math.max(0, t.stats.spdMin - cg.permSpdRed);
    t.stats.spdMax = Math.max(0, t.stats.spdMax - cg.permSpdRed);
    t.condensSpdApplied = true;
    addLog(s, { t: 'info', text: `【冷凝榴弹】${t.name} 累计消耗寒冷>10层，永久速度-${cg.permSpdRed}` });
  }
}

function applyCondensDebuff(s: BattleState, t: Combatant, cg: { defRedPct: number; mresRed: number; permSpdRed: number }): void {
  t.statuses.defModPct -= cg.defRedPct;
  t.stats.mres = Math.max(0, t.stats.mres - cg.mresRed);
  addLog(s, { t: 'info', text: `【冷凝榴弹】${t.name} 防御-${cg.defRedPct}%，法抗-${cg.mresRed}` });
}

function applyLeeWindPassive(s: BattleState, c: Combatant, targetUid?: string, applyMarks = true): void {
  const wind = c.skills.find((sk) => sk.konohaMarkPassive);
  if (!wind) return;
  const trueDmgMul = wind.konohaTrueDmgMul ?? 0.1;
  // 1. 对目标附加真实伤害（基于目标当前木叶印记层数 × 倍率，独立计算）
  const target = targetUid ? byUid(s, targetUid) : undefined;
  if (target && target.alive && target.side !== c.side) {
    const mark = target.buffs.find((b) => b.id === 'konohaMark');
    const markStacks = mark?.stacks ?? 0;
    const trueDmg = Math.floor(markStacks * trueDmgMul);
    if (trueDmg > 0) {
      damageFlat(s, target.uid, trueDmg, 'true', c);
      addLog(s, { t: 'info', text: `【瞬风】对 ${target.name} 附加 ${trueDmg} 点真实伤害` });
    }
  }
  // 2. 对全体敌方叠加木叶印记（层数 = floor(敏捷/2) + 等级，可叠加）——仅八门遁甲后调用
  if (applyMarks) {
    const enemies = alive(opponentsOf(s, c));
    const markStacks = Math.floor((c.agi ?? 0) / 2) + (c.charLevel ?? 1);
    if (markStacks > 0) {
      for (const e of enemies) {
        const b = addBuff(e, 'konohaMark', markStacks, 1, c.uid);
        addLog(s, { t: 'buff', uid: e.uid, buffId: 'konohaMark', stacks: b.stacks, intensity: b.intensity, applied: true });
      }
      if (enemies.length > 0) {
        addLog(s, { t: 'info', text: `【瞬风】对敌方全体叠加 ${markStacks} 层木叶印记` });
      }
    }
  }
}

// 风之武器：每次攻击后速度+amount（上限cap），作用于stats.spdMin/spdMax
function applyWeaponSpdUp(s: BattleState, c: Combatant): void {
  const cfg = c.weaponSpdUpPerAtk;
  if (!cfg) return;
  const gained = c.weaponSpdGained ?? 0;
  if (gained >= cfg.cap) return;
  c.weaponSpdGained = gained + cfg.amount;
  c.stats.spdMin += cfg.amount;
  c.stats.spdMax += cfg.amount;
  addLog(s, { t: 'info', text: `【${c.name}】速度+${cfg.amount}（已+${c.weaponSpdGained}/${cfg.cap}）` });
}

// 灾厄泰拉怪物普攻：根据能力计算倍率/攻击来源/额外真伤，并处理命中后效果
// 返回实际造成的HP伤害（用于伤害转上限等）
function monsterBasicHit(s: BattleState, c: Combatant, t: Combatant, baseMult: number, isAoe = false): number {
  let mult = c.basicAttackMul ?? baseMult;
  let atkOverride: number | undefined;
  let extraTrueDmg = 0;
  // 棱晶背龟：普攻以防御力×倍率计算
  if (c.basicAttackDefMul != null) atkOverride = c.stats.def * c.basicAttackDefMul;
  // 魔鬼鱼：(base + 目标速度×mul) 物理伤害
  if (c.spdBasedDmg) atkOverride = c.spdBasedDmg.base + effSpd(t).max * c.spdBasedDmg.mul;
  // 魔鬼鱼（百分比版）：造成 (base + 目标速度×mul)% 攻击力的物理伤害
  if (c.spdBasedDmgPct) mult = (c.spdBasedDmgPct.base + effSpd(t).max * c.spdBasedDmgPct.mul) / 100;
  // 硫磺比目鱼：倍率 = base + 目标中毒层数×perStack
  if (c.poisonStackAtkMul) {
    const ps = t.buffs.find((b) => b.id === 'poison');
    const stacks = ps?.stacks ?? 0;
    mult = c.poisonStackAtkMul.base + stacks * c.poisonStackAtkMul.perStack;
  }
  // 雾凇猎犬：每层流血伤害+X
  if (c.bleedStackDmgAmp) {
    const bs = t.buffs.find((b) => b.id === 'bleed');
    const stacks = bs?.stacks ?? 0;
    mult *= 1 + stacks * c.bleedStackDmgAmp;
  }
  // 木裂战士：攻击附 当前速度×X 真实伤害
  if (c.spdTrueDmgMul) extraTrueDmg += effSpd(c).max * c.spdTrueDmgMul;

  // 捣碎鳄：攻击时攻击力 = 目标当前束缚层数 × X（攻击后恢复）
  let bindBoost = 0;
  if (c.bindAtkBoost) {
    const bs = t.buffs.find((b) => b.id === 'bind');
    const stacks = bs?.stacks ?? 0;
    bindBoost = stacks * c.bindAtkBoost;
    if (bindBoost > 0) {
      c.stats.atk += bindBoost;
      addLog(s, { t: 'info', text: `【${c.name}】目标束缚${stacks}层，攻击力+${bindBoost}` });
    }
  }

  const hpBefore = t.hp;
  damageOne(s, c, t.uid, mult, c.attackType, atkOverride != null ? { atkOverride, isAoe } : (isAoe ? { isAoe } : undefined));
  let dmgDealt = Math.max(0, hpBefore - t.hp);
  if (bindBoost > 0) c.stats.atk -= bindBoost;

  if (extraTrueDmg > 0 && t.alive) {
    const hpBeforeTrue = t.hp;
    damageFlat(s, t.uid, extraTrueDmg, 'true', c);
    dmgDealt += Math.max(0, hpBeforeTrue - t.hp);
  }
  // 巨像蛤：自身造成的伤害等额提升自身防御
  if (c.dmgToDefOnDeal && dmgDealt > 0) {
    c.stats.def += dmgDealt;
    addLog(s, { t: 'info', text: `【${c.name}】防御+${dmgDealt}` });
  }

  // 剧毒米诺鱼：中毒层数翻倍
  if (c.doublePoisonOnHit && t.alive) {
    const ps = t.buffs.find((b) => b.id === 'poison');
    if (ps) ps.stacks *= 2;
  }
  // 融合暗精灵僵尸：消除目标瘟疫，回血并获得攻击力
  if (c.consumePlagueOnHit && t.alive) {
    const pl = t.buffs.find((b) => b.id === 'plague');
    if (pl && pl.stacks > 0) {
      const stacks = pl.stacks;
      const idx = t.buffs.indexOf(pl);
      if (idx >= 0) t.buffs.splice(idx, 1);
      const heal = Math.floor(c.maxHp * c.consumePlagueOnHit.healPctPerStack * stacks);
      c.hp = Math.min(c.maxHp, c.hp + heal);
      c.stats.atk += c.consumePlagueOnHit.atkPerStack * stacks;
      addLog(s, { t: 'info', text: `【${c.name}】消除${stacks}层瘟疫，恢复${heal}HP，攻击+${c.consumePlagueOnHit.atkPerStack * stacks}` });
    }
  }
  // 血浆哥布林鲨鱼：造成的伤害等额转化为自身最大HP
  if (c.dmgToMaxHp && dmgDealt > 0) {
    c.maxHp += dmgDealt;
    c.hp += dmgDealt;
    addLog(s, { t: 'info', text: `【${c.name}】最大HP+${dmgDealt}` });
  }
  // 刀疤鼠：恢复自身 目标已损HP 量
  if (c.lifestealMissingHp && t.alive) {
    const missing = t.maxHp - t.hp;
    if (missing > 0) {
      const heal = Math.min(missing, c.maxHp - c.hp);
      c.hp += heal;
      addLog(s, { t: 'info', text: `【${c.name}】吸取${heal}HP` });
    }
  }
  return dmgDealt;
}

// 灾厄泰拉怪物普攻后：全体中毒（蜂王）
function applyMonsterGroupPoison(s: BattleState, c: Combatant): void {
  if (!c.attackGroupPoison) return;
  const opponents = alive(opponentsOf(s, c));
  for (const o of opponents) {
    if (o.alive) {
      addBuff(o, 'poison', c.attackGroupPoison.stacks, c.attackGroupPoison.intensity, c.uid, 'max', c);
      addLog(s, { t: 'buff', uid: o.uid, buffId: 'poison', stacks: c.attackGroupPoison.stacks, intensity: c.attackGroupPoison.intensity, applied: true });
    }
  }
  addLog(s, { t: 'info', text: `【${c.name}】使敌方全体中毒+${c.attackGroupPoison.stacks}` });
}

function basicAttack(s: BattleState, c: Combatant, targetUid: string): void {
  // 清除技能伤害倍率（普攻不受拳经三问加成）
  c.currentSkillAmp = 0;
  // 剑锤遗物：普攻需消耗10MP，MP不足时无法普攻（后端拦截；前端 getActions 同步禁用按钮）
  if (c.swordHammerMpExtra) {
    if (c.mp < c.swordHammerMpExtra) {
      addLog(s, { t: 'info', text: `【${c.name}】剑锤代价：MP不足（${c.mp}/${c.swordHammerMpExtra}），无法普攻` });
      return;
    }
    c.mp -= c.swordHammerMpExtra;
    trackDonkMpConsumption(s, c, c.swordHammerMpExtra);
  }
  // 自动战车：锁定目标（直至目标死亡），每次攻击同一目标倍率+X，换目标重置
  let lockMul = 1;
  if (c.lockTarget) {
    const locked = c.lockedTargetUid ? byUid(s, c.lockedTargetUid) : null;
    if (locked && locked.alive) {
      targetUid = c.lockedTargetUid!; // 仍锁定旧目标，不重置倍率
    } else {
      // 旧目标已死亡或无锁定：锁定新目标，重置倍率
      c.lockedTargetUid = targetUid;
      c.atkMulBonus = 0;
    }
    lockMul = 1 + (c.atkMulBonus ?? 0);
  }
  // 新约能天使：开火成瘾——攻击前额外消耗弹药（其倍率加成作用于本次攻击）
  consumeFireAddictionAmmo(s, c);
  const bonus = c.passives.onHitMagicBonus;
  const doBonus = (uid: string) => {
    if (bonus && byUid(s, uid).alive) damageFlat(s, uid, bonus, 'magical', c);
  };
  // DONK 世一步：普攻消耗MP
  const shiyi = c.skills.find((sk) => sk.shiyiMpCost);
  if (shiyi) {
    const cost = shiyi.shiyiMpCost ?? 0;
    c.mp = Math.max(0, c.mp - cost);
    trackDonkMpConsumption(s, c, cost);
  }
  const donkPostDmg = (uid: string) => {
    // 世一步：消耗累计30MP触发的真伤
    applyDonkShiyiProc(s, c, uid);
    // 魔王：攻击附带力量%攻击力真伤
    applyDemonTrueDmg(s, c, uid);
  };
  // 爱弥斯：每次攻击对目标施加 floor(魅力/10) 层聚爆
  const eimisApplyImplosion = (uid: string) => {
    if (c.eimisSyncMax === undefined) return;
    const chaStacks = Math.floor((c.cha ?? 0) / 10);
    if (chaStacks > 0) applyImplosionStacks(s, c, uid, chaStacks);
  };
  // 爱弥斯：辉芒强化普攻（全体法术伤害 + 聚爆）
  if (c.eimisSyncMax !== undefined && c.eimisNextAtkHuiMang) {
    const star = c.skills.find((sk) => sk.eimisHuiMangBasePct);
    const basePct = star?.eimisHuiMangBasePct ?? 80;
    const chaMul = star?.eimisHuiMangChaMul ?? 1.0;
    const huiStacks = star?.eimisHuiMangStacks ?? 3;
    const overflow = c.eimisOverflowMulBonus ?? 0;
    const mul = (basePct + (c.cha ?? 0) * chaMul) / 100 + overflow;
    c.eimisNextAtkHuiMang = false;
    c.eimisOverflowMulBonus = 0;
    const targets = alive(opponentsOf(s, c));
    addLog(s, { t: 'action', actorUid: c.uid, kind: 'attack', label: '即可响应-辉芒', targetUids: targets.map((u) => u.uid) });
    for (const t of targets) {
      if (s.result) break;
      if (t.alive) {
        damageOne(s, c, t.uid, mul, 'magical');
        // 辉芒施加固定层数 + 每次攻击的魅力/10层
        applyImplosionStacks(s, c, t.uid, huiStacks);
        eimisApplyImplosion(t.uid);
      }
    }
    checkResult(s);
    return;
  }
  // 爱弥斯：溢出层数倍率加成（作用于本次普攻）
  const eimisOverflow = c.eimisOverflowMulBonus ?? 0;
  if (c.eimisSyncMax !== undefined && eimisOverflow > 0) c.eimisOverflowMulBonus = 0;
  // 奥古斯塔：战势≥阈值时普攻强化为多段
  const augustaEnhanced = shouldAugustaEnhance(c);
  const passive = c.skills.find((sk) => sk.augustaMomentum);
  // 超重力机甲：每 N 回合攻击变为多段（无视部分防御）
  if (c.turnCycleAttack && s.turn > 0 && s.turn % c.turnCycleAttack.every === 0) {
    const cy = c.turnCycleAttack;
    const oldIgnore = c.ignoreDefPct;
    c.ignoreDefPct = cy.ignoreDefPct;
    addLog(s, { t: 'action', actorUid: c.uid, kind: 'attack', label: `超重攻击（${cy.hits}段）`, targetUids: [targetUid] });
    for (let i = 0; i < cy.hits; i++) {
      if (s.result) break;
      const t = byUid(s, targetUid);
      if (!t || !t.alive) break;
      monsterBasicHit(s, c, t, cy.mul * lockMul);
      applyBasicAttackBuffs(s, c, targetUid);
      donkPostDmg(targetUid);
    }
    c.ignoreDefPct = oldIgnore;
    if (c.lockTarget && c.atkMulScaling) c.atkMulBonus = (c.atkMulBonus ?? 0) + c.atkMulScaling;
    applyWeaponSpdUp(s, c);
    applyMonsterGroupPoison(s, c);
    return;
  }
  // 群攻被动：普攻对每个存活敌方各造成一次 100% 普攻伤害（含灾厄 aoeBasicAttack）
  if (c.passives.basicAttackAll || c.aoeBasicAttack) {
    const targets = alive(opponentsOf(s, c));
    addLog(s, { t: 'action', actorUid: c.uid, kind: 'attack', label: augustaEnhanced ? '强化普攻' : '普攻', targetUids: targets.map((u) => u.uid) });
    for (const t of targets) {
      if (s.result) break;
      // 鼠鼠：免疫群体技能
      if (t.crisis?.supportHealer?.aoeImmune) {
        addLog(s, { t: 'info', text: `【${t.name}】免疫群体技能伤害` });
        continue;
      }
      // 镰刀恶魔：主目标100%，其他目标 aoeSplashPct
      const splash = c.aoeSplashPct != null && t.uid !== targetUid ? c.aoeSplashPct : 1;
      monsterBasicHit(s, c, t, splash * (1 + eimisOverflow), true);
      doBonus(t.uid);
      applyBasicAttackBuffs(s, c, t.uid);
      applyLeeWindPassive(s, c, t.uid, false); // 群攻：每目标附加真实伤害（印记仅八门遁甲后施加）
      donkPostDmg(t.uid);
      eimisApplyImplosion(t.uid);
    }
    if (!augustaEnhanced) gainMomentum(s, c);
    else consumeMomentumForEnhance(s, c);
    applyWeaponSpdUp(s, c);
    applyMonsterGroupPoison(s, c);
    return;
  }
  addLog(s, { t: 'action', actorUid: c.uid, kind: 'attack', label: augustaEnhanced ? '强化普攻' : '普攻', targetUids: [targetUid] });
  if (augustaEnhanced && passive?.augustaMomentum) {
    // 强化普攻：多段伤害
    const hits = passive.augustaMomentum.enhancedBasicHits;
    const mul = passive.augustaMomentum.enhancedBasicMul;
    for (let i = 0; i < hits; i++) {
      if (s.result) break;
      const t = byUid(s, targetUid);
      if (!t || !t.alive) break;
      damageOne(s, c, targetUid, mul, c.attackType);
    }
    doBonus(targetUid);
    applyBasicAttackBuffs(s, c, targetUid);
    applyLeeWindPassive(s, c, targetUid, false);
    donkPostDmg(targetUid);
    eimisApplyImplosion(targetUid);
    applyWeaponSpdUp(s, c);
    consumeMomentumForEnhance(s, c);
  } else {
    // 灾厄：多段普攻（multiHit）
    if (c.multiHit && !c.passives.basicAttackAll && !c.aoeBasicAttack) {
      const hitMul = (c.multiHitMul ?? 1) * (1 + eimisOverflow);
      const opponents = () => alive(opponentsOf(s, c));
      for (let i = 0; i < c.multiHit; i++) {
        if (s.result) break;
        // 卧龙海马/超巨大乌贼：每段随机目标
        let curUid = targetUid;
        if (c.multiHitRandom) {
          const pool = opponents();
          if (pool.length === 0) break;
          curUid = pool[Math.floor(Math.random() * pool.length)].uid;
        }
        const t = byUid(s, curUid);
        if (!t || !t.alive) {
          // 目标已死：随机挑一个新的（若 multiHitRandom 已挑则跳过）
          if (c.multiHitRandom) continue;
          const pool = opponents();
          if (pool.length === 0) break;
          curUid = pool[Math.floor(Math.random() * pool.length)].uid;
        }
        const hitTarget = byUid(s, curUid);
        if (!hitTarget || !hitTarget.alive) continue;
        monsterBasicHit(s, c, hitTarget, hitMul);
        doBonus(curUid);
        applyBasicAttackBuffs(s, c, curUid);
        donkPostDmg(curUid);
        eimisApplyImplosion(curUid);
      }
      applyWeaponSpdUp(s, c);
      applyMonsterGroupPoison(s, c);
      return;
    }
    // 月光弓：普攻变为多段伤害
    const baHits = c.weaponBasicAttackHits;
    // 残缺环境刃：普攻自适应伤害（物理/法术取较大值）
    const adaptive = c.weaponAdaptiveBasicAttack;
    const doAdaptiveDamage = (uid: string, mul: number) => {
      const t = byUid(s, uid);
      if (!t || !t.alive) return;
      if (adaptive) {
        const physDmg = calcDamage(c, t, mul, 'physical');
        const magDmg = calcDamage(c, t, mul, 'magical');
        const useType = physDmg >= magDmg ? 'physical' : 'magical';
        applyDamage(s, t, useType === 'physical' ? physDmg : magDmg, useType, c);
      } else {
        monsterBasicHit(s, c, t, mul);
      }
    };
    if (baHits) {
      for (let i = 0; i < baHits.count; i++) {
        if (s.result) break;
        const t = byUid(s, targetUid);
        if (!t || !t.alive) break;
        doAdaptiveDamage(targetUid, baHits.mul * (1 + (c.normalAtkAmp ?? 0)));
      }
    } else if (c.crisis?.adaptive && (s.crisisTermIds ?? []).includes('e3_jackDouble')) {
      for (let i = 0; i < 2; i++) {
        if (s.result) break;
        const t = byUid(s, targetUid);
        if (!t || !t.alive) break;
        damageOne(s, c, targetUid, 0.8 + eimisOverflow, c.attackType);
      }
    } else {
      // 王牌单位普攻改写（雷鸟：攻击力120%法术伤害）
      const aceMul = c.aceBasicAttack?.dmgPct ?? 1;
      doAdaptiveDamage(targetUid, aceMul * (1 + eimisOverflow) * (1 + (c.normalAtkAmp ?? 0)) * lockMul);
      // 自动战车：本次攻击后倍率累加
      if (c.lockTarget && c.atkMulScaling) c.atkMulBonus = (c.atkMulBonus ?? 0) + c.atkMulScaling;
    }
    doBonus(targetUid);
    applyBasicAttackBuffs(s, c, targetUid);
    applyLeeWindPassive(s, c, targetUid, false);
    donkPostDmg(targetUid);
    eimisApplyImplosion(targetUid);
    // 永夜射线：普攻额外对随机目标造成法术伤害
    if (c.weaponExtraRandomHit) {
      const enemies = alive(opponentsOf(s, c));
      if (enemies.length > 0) {
        const rand = enemies[Math.floor(Math.random() * enemies.length)];
        if (rand.alive) damageOne(s, c, rand.uid, c.weaponExtraRandomHit.mul, c.weaponExtraRandomHit.type);
      }
    }
    // 凝胶武器：普攻额外对敌方群体造成攻击力X%的真伤
    if (c.weaponAoeTrueDmgPct) {
      const aoeDmg = Math.floor(effAtk(c) * c.weaponAoeTrueDmgPct);
      const enemies = alive(opponentsOf(s, c));
      for (const e of enemies) {
        if (e.alive) damageFlat(s, e.uid, aoeDmg, 'true', c);
      }
    }
    // 风之武器：每次攻击后速度+1（上限）
    applyWeaponSpdUp(s, c);
    gainMomentum(s, c);
    applyMonsterGroupPoison(s, c);
  }
}

function castSkill(s: BattleState, c: Combatant, sk: Skill, targetUid?: string, enhance = false, chargeRelease = false, variantId?: string): void {
  // 凯隐双形态：合并当前形态的技能效果
  const eff: Skill = sk.formEffects && c.form
    ? ({ ...sk, ...sk.formEffects[c.form] } as Skill)
    : sk;

  // 王牌单位蓄力技能：首次使用进入蓄力，不造成伤害（chargeRelease 时跳过）
  if (eff.aceChargeTurns && !chargeRelease && !c.aceChargeSkill) {
    c.aceChargeSkill = { skillId: sk.id, turnsLeft: eff.aceChargeTurns };
    c.mp = Math.max(0, c.mp - (eff.mpCost ?? 0));
    addLog(s, { t: 'info', text: `【${c.name}】开始蓄力「${sk.name}」` });
    return;
  }

  // 奥古斯塔：战势≥阈值时自动触发强化
  const augustaEnhanced = shouldAugustaEnhance(c);

  // 拳经三问：本次技能使用此前累积的全能增伤（普攻不设此值，已在 basicAttack 清零）
  c.currentSkillAmp = c.skillDmgStack?.stacks ?? 0;

  // DONK 世一步：技能攻击时触发累计30MP的真伤；单体取目标，群体取首个存活敌方
  if ((c.donkShiyiPendingProcs ?? 0) > 0 && c.skills.some((sk) => sk.shiyiMpCost)) {
    if (eff.target === 'enemyOne' && targetUid) {
      applyDonkShiyiProc(s, c, targetUid);
    } else if (eff.target === 'enemyAll') {
      const first = alive(c.side === 'ally' ? s.enemies : s.allies)[0];
      if (first) applyDonkShiyiProc(s, c, first.uid);
    }
  }

  // 冷凝榴弹：若处于激活状态且本次不是激活技能本身，则消耗所有敌方寒冷层数并造成法术伤害
  if (c.condensGrenadeActive && sk.id !== 'sk_dandan_condens') {
    const cg = c.condensGrenadeActive;
    const enemies = c.side === 'ally' ? s.enemies : s.allies;
    let totalFactor = 0; // Σ(层数×强度 + 层数) = Σ(层数×(强度+1))
    for (const e of enemies) {
      if (!e.alive) continue;
      const chill = e.buffs.find((b) => b.id === 'chill');
      if (chill && chill.stacks > 0) {
        totalFactor += chill.stacks * (chill.intensity + 1);
        // 消耗所有层数
        e.buffs = e.buffs.filter((b) => b.id !== 'chill');
        // 保留1层寒冷（T2/T3）
        if (cg.keepOne) {
          addBuff(e, 'chill', 1, chill.intensity, c.uid);
        }
      }
    }
    if (totalFactor > 0) {
      const dmg = Math.floor(totalFactor * (c.int ?? 0));
      addLog(s, { t: 'info', text: `【冷凝榴弹】消耗寒冷效果，造成 ${dmg} 点法术伤害` });
      for (const e of enemies) {
        if (!e.alive) continue;
        // 走 calcDamage 结算，吃到法术增伤与法抗减免
        const fakeC: Combatant = { ...c, stats: { ...c.stats, atk: dmg } };
        applyDamage(s, e, calcDamage(fakeC, e, 1, 'magical'), 'magical');
      }
    }
  }

  c.mp = Math.max(0, c.mp - (eff.mpCost ?? 0));
  // 王牌单位：每场一次技能标记
  if (eff.aceOncePerBattle) {
    if (!c.aceOncePerBattleUsed) c.aceOncePerBattleUsed = {};
    c.aceOncePerBattleUsed[sk.id] = true;
  }

  // ===== 里恩：Furioso-Replica——代行12层+整场一次，随机9次 随机六维%攻击力 真伤 =====
  if (eff.reinFurioso) {
    const rf = eff.reinFurioso;
    if ((c.reinOracle?.stacks ?? 0) >= rf.requireStacks && !c.reinFuriosoUsed) {
      c.reinFuriosoUsed = true;
      let hitCount = 0;
      for (let i = 0; i < rf.hits; i++) {
        if (s.result) break;
        const pool = alive(opponentsOf(s, c));
        if (pool.length === 0) break;
        const t = pool[mathRng.int(0, pool.length - 1)];
        const six = randomSix(c, mathRng);
        const mult = six / 100;
        damageOne(s, c, t.uid, mult, 'true');
        hitCount++;
      }
      addLog(s, { t: 'info', text: `【${c.name}】Furioso-Replica！以随机六维之力降下 ${hitCount} 次真实伤害` });
      checkResult(s);
      return;
    }
  }
  // DONK 闪身步：追踪技能MP消耗
  if (eff.mpCost) trackDonkMpConsumption(s, c, eff.mpCost);
  // 剑锤：需要消耗MP的技能额外消耗MP
  if (c.swordHammerMpExtra && (eff.mpCost ?? 0) > 0) {
    c.mp = Math.max(0, c.mp - c.swordHammerMpExtra);
  }
  // 虚化增强：额外消耗MP与虚化次数
  if (enhance && eff.enhanceMpCost) {
    c.mp = Math.max(0, c.mp - eff.enhanceMpCost);
    trackDonkMpConsumption(s, c, eff.enhanceMpCost);
  }
  if (enhance && eff.enhanceKamuiCost && c.kamuiUses !== undefined) {
    c.kamuiUses = Math.max(0, c.kamuiUses - eff.enhanceKamuiCost);
    addLog(s, { t: 'vfx', uid: c.uid, kind: 'masked-enhance' });
  }
  // 能量消耗（凯隐掠影步）
  if (eff.energyCost) c.energy = Math.max(0, (c.energy ?? 0) - eff.energyCost);
  // 消耗所有能量（凯隐蓝裂舍影）
  let consumedEnergy = 0;
  if (eff.consumeAllEnergy) {
    consumedEnergy = c.energy ?? 0;
    c.energy = 0;
  }
  // HP 消耗技能（凯隐红形态）
  if (eff.hpCost) c.hp = Math.max(1, c.hp - eff.hpCost);

  let targetUids: string[] = [];
  if (eff.target === 'self') targetUids = [c.uid];
  else if (eff.target === 'enemyAll') targetUids = alive(opponentsOf(s, c)).map((u) => u.uid);
  else if (targetUid) targetUids = [targetUid];

  addLog(s, { t: 'action', actorUid: c.uid, kind: 'skill', label: eff.name, targetUids });

  // ===== 小李 · 表莲华 / 里莲华 =====
  const gates = c.eightGates ?? 0;
  const target = targetUids[0] ? byUid(s, targetUids[0]) : undefined;
  if (eff.lotusHits && target) {
    // 表莲华：N 次 (目标印记层数 × 倍率) 物理伤害
    const hits = eff.lotusHits;
    const markMul = eff.lotusMarkMul ?? 1;
    const beforeHp = target.hp;
    for (let i = 0; i < hits; i++) {
      if (s.result) break;
      const t = byUid(s, target.uid);
      if (!t || !t.alive) break;
      const markStacks = t.buffs.find((b) => b.id === 'konohaMark')?.stacks ?? 0;
      const dmg = Math.floor(markStacks * markMul);
      if (dmg > 0) {
        const fakeC: Combatant = { ...c, stats: { ...c.stats, atk: dmg } };
        applyDamage(s, t, calcDamage(fakeC, t, 1, 'physical'), 'physical');
      }
    }
    // 击杀回血：最大HP × 倍率
    const tAfter = byUid(s, target.uid);
    if (tAfter && !tAfter.alive && beforeHp > 0) {
      const healPct = eff.lotusKillHealPct ?? 0.15;
      const heal = Math.floor(c.maxHp * healPct);
      if (heal > 0) {
        const gain = Math.min(heal, c.maxHp - c.hp);
        c.hp += gain;
        addLog(s, { t: 'heal', targetUid: c.uid, amount: gain });
        addLog(s, { t: 'info', text: `【表莲华】击杀恢复 ${gain} 点生命` });
      }
    }
    // 自损当前HP百分比
    const hpCost = Math.floor(c.hp * (eff.lotusHpCostPct ?? 0));
    if (hpCost > 0) {
      c.hp = Math.max(1, c.hp - hpCost);
      addLog(s, { t: 'info', text: `【表莲华】自损 ${hpCost} 点生命` });
    }
    checkResult(s);
  } else if (eff.reverseLotusMaxHpMul !== undefined && target) {
    // 里莲华：1 次 (目标最大HP × 倍率) 真实伤害 + 1 次 (印记×八门层数 × 倍率) 真实伤害
    const t = byUid(s, target.uid);
    if (t && t.alive) {
      const maxHpDmg = Math.floor(t.maxHp * eff.reverseLotusMaxHpMul);
      if (maxHpDmg > 0) damageFlat(s, t.uid, maxHpDmg, 'true', c);
      // 终结真实伤害：(印记层数 × 八门层数) × 倍率
      const t2 = byUid(s, target.uid);
      if (t2 && t2.alive) {
        const markStacks = t2.buffs.find((b) => b.id === 'konohaMark')?.stacks ?? 0;
        const physMul = eff.reverseLotusPhysMul ?? 0.5;
        const trueDmg = Math.floor(markStacks * gates * physMul);
        if (trueDmg > 0) damageFlat(s, t2.uid, trueDmg, 'true', c);
        // 清空目标木叶印记
        t2.buffs = t2.buffs.filter((b) => b.id !== 'konohaMark');
      }
    }
    // 自损最大HP百分比
    const hpCost = Math.floor(c.maxHp * (eff.lotusHpCostPct ?? 0));
    if (hpCost > 0) {
      c.hp = Math.max(1, c.hp - hpCost);
      addLog(s, { t: 'info', text: `【里莲华】自损 ${hpCost} 点生命` });
    }
    // 清空小李八门遁甲层数
    c.eightGates = 0;
    addLog(s, { t: 'info', text: `【里莲华】清空八门遁甲层数与木叶印记` });
    checkResult(s);
  }

  // ===== DONK · 射击 =====
  if (eff.shootBaseMul !== undefined && target) {
    const baseMul = eff.shootBaseMul ?? 1;
    const spdPct = eff.shootSpdBonusPct ?? 5;
    const spdMax = effSpd(c).max;
    let mul = baseMul + (spdPct * spdMax) / 100;
    // 每消耗30MP提升倍率，上限 shootBonusMaxUpgrades 次
    const perUpgrade = eff.shootBonusPer30Mp ?? 0;
    const maxUpgrades = eff.shootBonusMaxUpgrades ?? 0;
    const upgrades = Math.min(maxUpgrades, Math.floor((c.donkTotalMpConsumed ?? 0) / 30));
    if (upgrades > 0 && perUpgrade > 0) {
      mul *= 1 + upgrades * perUpgrade;
    }
    if (target.alive) {
      applyDamage(s, target, calcDamage(c, target, mul, 'physical'), 'physical');
      applyDemonTrueDmg(s, c, target.uid);
    }
    checkResult(s);
  }

  // 基础护盾
  if (eff.shield) {
    const gain = gainShield(s, c, eff.shield);
    if (gain > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: gain });
  }
  // 王牌单位：自身已损生命值的护盾（麦扣 heehee）
  if (eff.aceShieldMissingHp) {
    const missing = Math.max(0, c.maxHp - c.hp);
    if (missing > 0) {
      const gain = gainShield(s, c, missing);
      if (gain > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: gain });
    }
  }
  // 王牌单位：随机1名友方获得护盾（丁真 雪豹）
  if (eff.aceAllyShield) {
    const friends = (c.side === 'ally' ? s.allies : s.enemies).filter((a) => a.alive && a.uid !== c.uid);
    if (friends.length > 0) {
      const ally = friends[Math.floor(Math.random() * friends.length)];
      const gain = gainShield(s, ally, eff.aceAllyShield);
      if (gain > 0) addLog(s, { t: 'shield', targetUid: ally.uid, amount: gain });
    }
  }
  // 王牌单位：扁平属性提升带上限（王源/丁真 吸烟）
  if (eff.aceStatUp) {
    if (!c.aceStatUpTotal) c.aceStatUpTotal = { def: 0, mres: 0 };
    const su = eff.aceStatUp;
    if (su.def) {
      const room = (su.defCap ?? Infinity) - c.aceStatUpTotal.def;
      const actual = Math.max(0, Math.min(su.def, room));
      if (actual > 0) { c.stats.def += actual; c.aceStatUpTotal.def += actual; }
    }
    if (su.mres) {
      const room = (su.mresCap ?? Infinity) - c.aceStatUpTotal.mres;
      const actual = Math.max(0, Math.min(su.mres, room));
      if (actual > 0) { c.stats.mres += actual; c.aceStatUpTotal.mres += actual; }
    }
  }
  // 凯隐红狂镰：获得 敏捷×X 护盾
  if (eff.shieldBonusFromAgi && c.agi) {
    const gain = gainShield(s, c, Math.floor(c.agi * eff.shieldBonusFromAgi));
    if (gain > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: gain });
  }
  // 自动吸附：获得 智力×X 护盾
  if (eff.shieldBonusFromInt && c.int) {
    const gain = gainShield(s, c, Math.floor(c.int * eff.shieldBonusFromInt));
    if (gain > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: gain });
  }
  // 凯隐红裂舍影：回复 敏捷×X HP
  if (eff.healFromAgi && c.agi) {
    let heal = Math.floor(c.agi * eff.healFromAgi);
    if (c.healAmp) heal = Math.floor(heal * (1 + c.healAmp));
    heal = Math.min(heal, c.maxHp - c.hp);
    if (heal > 0) { c.hp += heal; addLog(s, { t: 'heal', targetUid: c.uid, amount: heal }); }
  }
  // 奥古斯塔驭冕铸雷之权：获得 (力量+意志)×系数 护盾
  if (eff.shieldFromStrWilMul !== undefined) {
    const shieldAmt = Math.floor(((c.str ?? 0) + (c.wil ?? 0)) * eff.shieldFromStrWilMul);
    const gain = gainShield(s, c, shieldAmt);
    if (gain > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: gain });
    // 强化：我方全体也获得等值护盾
    if (augustaEnhanced && eff.augustaEnhanceAllyShield) {
      const allies = c.side === 'ally' ? s.allies : s.enemies;
      for (const a of allies) {
        if (!a.alive || a.uid === c.uid) continue;
        const ag = gainShield(s, a, shieldAmt);
        if (ag > 0) addLog(s, { t: 'shield', targetUid: a.uid, amount: ag });
      }
    }
  }
  // 奥古斯塔贯星长枪强化：回复 力量×系数 HP
  if (augustaEnhanced && eff.augustaEnhanceHealFromStr) {
    let heal = Math.floor((c.str ?? 0) * eff.augustaEnhanceHealFromStr);
    if (c.healAmp) heal = Math.floor(heal * (1 + c.healAmp));
    heal = Math.min(heal, c.maxHp - c.hp);
    if (heal > 0) { c.hp += heal; addLog(s, { t: 'heal', targetUid: c.uid, amount: heal }); }
  }
  // 凯隐红狂镰：释放时获得攻击力（本场战斗内有效，带上限）
  if (eff.atkGainOnCast) {
    const cap = eff.atkGainCap ?? Infinity;
    const currentGain = c.kaynAtkGain ?? 0;
    const room = Math.max(0, cap - currentGain);
    const actual = Math.min(eff.atkGainOnCast, room);
    if (actual > 0) {
      c.stats.atk += actual;
      c.kaynAtkGain = currentGain + actual;
      addLog(s, { t: 'info', text: `${c.name} 攻击力 +${actual}（累计加成 ${c.kaynAtkGain}/${cap}）` });
    }
  }
  // 凯隐红裂舍影：获得 敏捷×X 能量（溢出按比例转护盾）
  if (eff.energyGainFromAgi && c.agi) {
    const gain = Math.floor(c.agi * eff.energyGainFromAgi);
    if (gain > 0) {
      const max = c.energyMax ?? 100;
      const before = c.energy ?? 0;
      const after = before + gain;
      if (after > max) {
        c.energy = max;
        const overflow = after - max;
        const shieldGain = Math.floor(overflow * (c.energyOverflowRatio ?? 1));
        if (shieldGain > 0) {
          const g = gainShield(s, c, shieldGain);
          if (g > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: g });
        }
      } else {
        c.energy = after;
      }
      addLog(s, { t: 'info', text: `${c.name} 获得 ${gain} 能量` });
    }
  }

  // 运之夹角：同时造成多种伤害类型（物+法+真），multiplier 作为固定数值
  if (eff.multiDamageTypes?.length && targetUids[0]) {
    const t = byUid(s, targetUids[0]);
    if (t.alive) {
      for (const dt of eff.multiDamageTypes) {
        if (!t.alive || s.result) break;
        damageFlat(s, t.uid, eff.multiplier ?? 0, dt, c);
      }
    }
  } else if (eff.flatDmgBase !== undefined || eff.flatDmgIntMul) {
    // 杜瓦冷罐：固定伤害 = base + 智力×mul（用法术伤害结算，吃法术增伤/法抗）
    const base = eff.flatDmgBase ?? 0;
    const perInt = eff.flatDmgIntMul ?? 0;
    const flat = base + Math.floor((c.int ?? 0) * perInt);
    const dtype = eff.damageType ?? 'magical';
    for (const uid of [...targetUids]) {
      if (s.result) break;
      const t = byUid(s, uid);
      if (!t || !t.alive) continue;
      // 以 flat 作为攻击力，mult=1，走 calcDamage 吃到法术增伤与法抗减免
      const fakeC: Combatant = { ...c, stats: { ...c.stats, atk: flat } };
      applyDamage(s, t, calcDamage(fakeC, t, 1, dtype), dtype, c, eff.target === 'enemyAll');
    }
  } else if (eff.consumeAllEnergy && eff.energyStrMul !== undefined) {
    // 凯隐蓝裂舍影：伤害 = energyStrMul×(力量+消耗能量) + energyAtkMul×攻击力（法术伤害）
    const strMul = eff.energyStrMul;
    const atkMul = eff.energyAtkMul ?? 0;
    const flat = Math.floor(strMul * ((c.str ?? 0) + consumedEnergy) + atkMul * c.stats.atk);
    const dtype = eff.damageType ?? 'magical';
    addLog(s, { t: 'info', text: `【裂舍影】消耗 ${consumedEnergy} 能量，造成 ${flat} 点${dtype === 'magical' ? '法术' : dtype}伤害` });
    for (const uid of [...targetUids]) {
      if (s.result) break;
      const t = byUid(s, uid);
      if (!t || !t.alive) continue;
      const fakeC: Combatant = { ...c, stats: { ...c.stats, atk: flat } };
      applyDamage(s, t, calcDamage(fakeC, t, 1, dtype), dtype, c, eff.target === 'enemyAll');
    }
  }
  // ===== 爱弥斯：飞至启明之时——满同步率清空，对敌方全体造成(上限×倍率)×20%攻击力法伤，再获1点同步率 =====
  if (eff.eimisUltimateCapMul !== undefined) {
    const cap = eimisImplosionCap(c) + (s.allies.reduce((sum, a) => sum + (a.aceImplosionCapBonus ?? 0), 0));
    const capMul = eff.eimisUltimateCapMul ?? 2;
    const dmgPctPerStack = (c.skills.find((sk) => sk.eimisImplosionDmgPctPerStack)?.eimisImplosionDmgPctPerStack) ?? 12;
    const mult = (cap * capMul * dmgPctPerStack) / 100;
    const clearedSync = c.eimisSyncRate ?? 0;
    // 清空同步率（法穿也随之清除）
    if (clearedSync > 0) {
      const shape = c.skills.find((sk) => sk.eimisMresPenPerSync);
      const penPer = shape?.eimisMresPenPerSync ?? 0;
      if (penPer > 0) c.ignoreMresFlat = Math.max(0, (c.ignoreMresFlat ?? 0) - clearedSync * penPer);
    }
    c.eimisSyncRate = 0;
    for (const uid of [...targetUids]) {
      if (s.result) break;
      const t = byUid(s, uid);
      if (t?.alive) {
        damageOne(s, c, uid, mult, 'magical', { isAoe: true });
      }
    }
    // 获得1点同步率
    gainEimisSync(s, c, 1);
    addLog(s, { t: 'info', text: `【飞至启明之时】${c.name} 清空同步率，对敌方全体造成 ${Math.round(mult * 100)}% 攻击力法术伤害` });
    checkResult(s);
  } else if (eff.variants && eff.variants.length) {
    // ===== 里恩：不可预测的变化无常——三种释放方式（随机六维驱动） =====
    const variant = eff.variants.find((v) => v.id === variantId) ?? eff.variants[0];
    const six = randomSix(c, mathRng);
    if (variant.damageType === 'magical') {
      // 冻血缠绕：单体 (base+随机六维×per)% 法伤，其余敌方溅射 ×splashMul
      const mult = ((variant.randSixMulBase ?? 0) + six * (variant.randSixMulPer ?? 1)) / 100;
      const t = targetUids[0] ? byUid(s, targetUids[0]) : undefined;
      if (t?.alive && !s.result) damageOne(s, c, t.uid, mult, 'magical');
      if (variant.splashMul && mult > 0 && !s.result) {
        for (const e of opponentsOf(s, c)) {
          if (s.result) break;
          if (!e.alive || e.uid === t?.uid) continue;
          damageOne(s, c, e.uid, mult * variant.splashMul, 'magical', { isAoe: true });
        }
      }
      addLog(s, { t: 'info', text: `【${c.name}】冻血缠绕：随机六维 ${six}，单体 ${Math.round(mult * 100)}% 法伤${variant.splashMul ? `，溅射 ${Math.round(mult * variant.splashMul * 100)}%` : ''}` });
      checkResult(s);
    } else if (variant.damageType === 'physical') {
      // 无声贯穿：单体 (base+随机六维×per)% 物伤，无视 (随机六维×ignoreMul) 防御
      const mult = ((variant.randSixMulBase ?? 0) + six * (variant.randSixMulPer ?? 1)) / 100;
      const t = targetUids[0] ? byUid(s, targetUids[0]) : undefined;
      if (t?.alive && !s.result) {
        const ignore = Math.floor(six * (variant.randSixIgnoreDefMul ?? 0));
        if (ignore > 0) {
          const orig = t.stats.def;
          t.stats.def = Math.max(0, t.stats.def - ignore);
          damageOne(s, c, t.uid, mult, 'physical');
          t.stats.def = orig;
        } else {
          damageOne(s, c, t.uid, mult, 'physical');
        }
        addLog(s, { t: 'info', text: `【${c.name}】无声贯穿：随机六维 ${six}，${Math.round(mult * 100)}% 物伤，无视 ${ignore} 防御` });
        checkResult(s);
      }
    } else {
      // 落叶哭泣：单体 真伤（trueDmgMul×攻击力）+ 恢复自身随机六维 HP
      const mult = variant.trueDmgMul ?? 1;
      const t = targetUids[0] ? byUid(s, targetUids[0]) : undefined;
      if (t?.alive && !s.result) damageOne(s, c, t.uid, mult, 'true');
      if (variant.healRandomSix && !s.result && c.hp < c.maxHp) {
        const heal = Math.min(c.maxHp - c.hp, six);
        if (heal > 0) {
          c.hp += heal;
          addLog(s, { t: 'heal', targetUid: c.uid, amount: heal });
        }
      }
      addLog(s, { t: 'info', text: `【${c.name}】落叶哭泣：${Math.round(mult * 100)}% 真伤${variant.healRandomSix ? `，恢复 ${six} HP` : ''}` });
      checkResult(s);
    }
  } else if (eff.damageType && (eff.multiplier || (eff.intMulBase !== undefined && eff.intMulPerInt !== undefined) || eff.strMulBase !== undefined || eff.spdMulBase !== undefined || eff.agiMulBase !== undefined)) {
    const hits = eff.hits ?? 1;
    const extraFlat = eff.damageBonusFromShieldPct ? Math.floor(c.shield * eff.damageBonusFromShieldPct) : undefined;
    // 提喻：伤害倍率 = (基础 + 智力×系数) / 100
    let mult = eff.multiplier ?? 0;
    if (eff.intMulBase !== undefined && eff.intMulPerInt !== undefined && c.int) {
      mult = (eff.intMulBase + c.int * eff.intMulPerInt) / 100;
    }
    // 豪火球之术 / 凯隐蓝狂镰：倍率 = (strMulBase + 力量×strMulPer) / 100（strMulPer 缺省时为1）
    if (eff.strMulBase !== undefined) {
      const per = eff.strMulPer ?? 1;
      mult = (eff.strMulBase + (c.str ?? 0) * per) / 100;
    }
    // 天锁爆葬 / 凯隐红裂舍影：倍率 = (spdMulBase + 当前速度×spdMulPer) / 100（spdMulPer 缺省时为10）
    if (eff.spdMulBase !== undefined) {
      const spd = c.roll ?? effSpd(c).max;
      const per = eff.spdMulPer ?? 10;
      mult = (eff.spdMulBase + spd * per) / 100;
    }
    // 凯隐红狂镰：倍率 = (agiMulBase + 敏捷×agiMulPer) / 100
    if (eff.agiMulBase !== undefined && eff.agiMulPer !== undefined) {
      mult = (eff.agiMulBase + (c.agi ?? 0) * eff.agiMulPer) / 100;
    }
    // 虚化增强：额外伤害倍率
    if (enhance && eff.enhanceMulBonus) mult += eff.enhanceMulBonus;
    // 奥古斯塔强化：贯星长枪额外倍率 + 纯粹武力按战势层数提升
    if (augustaEnhanced) {
      if (eff.augustaEnhanceMulBonus) mult += eff.augustaEnhanceMulBonus;
      if (eff.augustaEnhanceMulPerStack) mult += (c.momentum ?? 0) * eff.augustaEnhanceMulPerStack;
    }
    // 纯粹武力：技能级无视防御（叠加被动无视防御）
    const origIgnoreDef = c.ignoreDefPct ?? 0;
    if (eff.ignoreDefPct) c.ignoreDefPct = origIgnoreDef + eff.ignoreDefPct;
    if (eff.target === 'enemyOne' || eff.target === 'allyOne') {
      if (eff.randomTargetPerHit) {
        // 女妖之笔：每段随机选目标，连续命中同一目标则倍率+sameTargetMulBonus
        let lastUid: string | undefined;
        let curMult = mult;
        for (let i = 0; i < hits; i++) {
          const pool = alive(opponentsOf(s, c));
          if (pool.length === 0 || s.result) break;
          const t = pool[Math.floor(Math.random() * pool.length)];
          if (t.uid === lastUid) {
            curMult += eff.sameTargetMulBonus ?? 0;
          } else {
            curMult = mult;
          }
          lastUid = t.uid;
          damageOne(s, c, t.uid, curMult, eff.damageType, { extraFlat, executeRefundMp: eff.executeRefundMp });
        }
      } else {
        for (let i = 0; i < hits; i++) {
          const t = targetUids[0] ? byUid(s, targetUids[0]) : undefined;
          if (!t || !t.alive || s.result) break;
          // 贯星长枪：目标HP≤50%时，50%增伤与强壮/物理增伤同乘区加法叠加
          const extraPhysAmp = (eff.lowHpBonusMulPct && t.hp <= t.maxHp * 0.5) ? eff.lowHpBonusMulPct : 0;
          // 爪击：对带哈气目标额外提升（层数×20%）伤害——增伤区（与遗物/被动增伤同区叠加，非倍率）
          const huffAmp = eff.id === 'sk_claw' && t
            ? (t.buffs.find((b) => b.id === 'huff')?.stacks ?? 0) * 0.2
            : 0;
          damageOne(s, c, t.uid, mult, eff.damageType, { extraFlat, executeRefundMp: eff.executeRefundMp, extraPhysAmp, skillAmp: huffAmp });
        }
      }
    } else {
      for (const uid of [...targetUids]) {
        if (s.result) break;
        const t = byUid(s, uid);
        // 鼠鼠：免疫群体技能
        if (t?.crisis?.supportHealer?.aoeImmune) {
          addLog(s, { t: 'info', text: `【${t.name}】免疫群体技能伤害` });
          continue;
        }
        const extraPhysAmp = (eff.lowHpBonusMulPct && t && t.hp <= t.maxHp * 0.5) ? eff.lowHpBonusMulPct : 0;
        damageOne(s, c, uid, mult, eff.damageType, { extraFlat, executeRefundMp: eff.executeRefundMp, extraPhysAmp, isAoe: true });
      }
    }
    c.ignoreDefPct = origIgnoreDef;
  } else if (eff.trueDmgBase !== undefined) {
    // 神威•放逐：真实伤害 = 基础 + 双方BUFF(层数+强度)之和 × 系数
    const perBuff = eff.trueDmgPerBuff ?? 0;
    const targetForBuff = targetUids[0] ? byUid(s, targetUids[0]) : undefined;
    const sumBuff = (buffs: { stacks: number; intensity: number }[]) =>
      buffs.reduce((acc, b) => acc + b.stacks + b.intensity, 0);
    const buffTotal = sumBuff(c.buffs) + (targetForBuff ? sumBuff(targetForBuff.buffs) : 0);
    const trueDmg = eff.trueDmgBase + buffTotal * perBuff;
    for (const uid of [...targetUids]) {
      if (s.result) break;
      const t = byUid(s, uid);
      if (!t || !t.alive) continue;
      damageFlat(s, t.uid, trueDmg, 'true', c);
    }
  }

  // 自动吸附：嘲讽——本回合替指定友方承受伤害
  if (eff.target === 'allyOne' && targetUids[0] && targetUids[0] !== c.uid) {
    c.tauntForUid = targetUids[0];
  }

  // 技能命中后施加 BUFF
  if (eff.applyBuffs?.length) {
    for (const sb of eff.applyBuffs) {
      const recipients = sb.target === 'self' ? [c] : targetUids.map((uid) => byUid(s, uid));
      for (const r of recipients) {
        if (!r || !r.alive) continue;
        const b = addBuff(r, sb.id, sb.stacks, sb.intensity, c.uid, 'max', c);
        addLog(s, { t: 'buff', uid: r.uid, buffId: sb.id, stacks: b.stacks, intensity: b.intensity, applied: true });
        // 凋亡：叠加后若达到3层立即引爆（仅对敌方目标检测）
        if (sb.target === 'enemy') tryTriggerApoptosis(s, r);
      }
    }
  }

  // 爪击2/3级：附加 攻击力×trueDmgAtkMul 的真实伤害
  if (eff.trueDmgAtkMul && eff.trueDmgAtkMul > 0) {
    const trueDmg = Math.floor(effAtk(c) * eff.trueDmgAtkMul);
    if (trueDmg > 0) {
      for (const uid of [...targetUids]) {
        const t = byUid(s, uid);
        if (!t || !t.alive) continue;
        damageFlat(s, t.uid, trueDmg, 'true', c);
      }
    }
  }
  // 王牌单位：固定真实伤害（魔虚罗 除魔之刃）
  if (eff.aceTrueDmgFlat && eff.aceTrueDmgFlat > 0) {
    for (const uid of [...targetUids]) {
      const t = byUid(s, uid);
      if (!t || !t.alive) continue;
      damageFlat(s, t.uid, eff.aceTrueDmgFlat, 'true', c);
    }
  }
  // 王牌单位：目标最大生命值百分比真实伤害（方源 永别了我的兄弟）
  if (eff.aceMaxHpTrueDmgPct && eff.aceMaxHpTrueDmgPct > 0) {
    for (const uid of [...targetUids]) {
      const t = byUid(s, uid);
      if (!t || !t.alive) continue;
      const trueDmg = Math.floor(t.maxHp * eff.aceMaxHpTrueDmgPct);
      if (trueDmg > 0) damageFlat(s, t.uid, trueDmg, 'true', c);
    }
  }

  // 虚化增强命中后施加 BUFF
  if (enhance && eff.enhanceApplyBuffs?.length) {
    for (const sb of eff.enhanceApplyBuffs) {
      for (const uid of targetUids) {
        const r = byUid(s, uid);
        if (!r || !r.alive) continue;
        const b = addBuff(r, sb.id, sb.stacks, sb.intensity, c.uid, 'max', c);
        addLog(s, { t: 'buff', uid: r.uid, buffId: sb.id, stacks: b.stacks, intensity: b.intensity, applied: true });
      }
    }
  }

  // 神威•放逐：斩杀判定
  if (eff.kamuiExecute && targetUids[0]) {
    const t = byUid(s, targetUids[0]);
    if (t.alive && t.hp > 0) {
      const threshold = t.maxHp * (eff.kamuiExecuteHpPct ?? 0.1);
      const canExecute = t.hp < threshold;
      const hasMp = c.mp >= (eff.kamuiExecuteMpCost ?? 0);
      const hasKamui = (c.kamuiUses ?? 0) >= (eff.kamuiExecuteKamuiCost ?? 1);
      if (canExecute && hasMp && hasKamui) {
        c.mp = Math.max(0, c.mp - (eff.kamuiExecuteMpCost ?? 0));
        c.kamuiUses = Math.max(0, (c.kamuiUses ?? 0) - (eff.kamuiExecuteKamuiCost ?? 1));
        t.hp = 0;
        t.alive = false;
        addLog(s, { t: 'death', uid: t.uid, name: t.name });
        transferImplosionFromDead(s, t);
        addLog(s, { t: 'info', text: `【神威•放逐】${c.name} 将 ${t.name} 放逐至时空间隙！` });
        addLog(s, { t: 'vfx', uid: t.uid, kind: 'masked-execute' });
        handleDeath(s, t);
        syncInvincibleWhileAllies(s);
      }
    }
  }

  // 永恒狩猎：狩猎标记
  if (eff.markPct && targetUids[0]) {
    const t = byUid(s, targetUids[0]);
    if (t.alive) {
      let b = t.buffs.find((x) => x.id === 'huntMark');
      if (b) { b.stacks = 1; b.intensity = eff.markPct; b.ownerUid = c.uid; }
      else { b = { id: 'huntMark', stacks: 1, intensity: eff.markPct, ownerUid: c.uid }; t.buffs.push(b); }
      addLog(s, { t: 'buff', uid: t.uid, buffId: 'huntMark', stacks: b.stacks, intensity: b.intensity, applied: true });
    }
  }

  // 温感追踪震撼弹：施加破甲；若目标存在寒冷，消耗一半寒冷层数并造成法术伤害
  if (eff.applyArmorBreak && targetUids[0]) {
    const t = byUid(s, targetUids[0]);
    if (t.alive) {
      // 先施加破甲，使后续伤害能吃到破甲的减伤效果
      const ab = addBuff(t, 'armorBreak', eff.applyArmorBreak.stacks, eff.applyArmorBreak.intensity, c.uid, 'max', c);
      addLog(s, { t: 'buff', uid: t.uid, buffId: 'armorBreak', stacks: ab.stacks, intensity: ab.intensity, applied: true });
      if (eff.consumeHalfChillIntMul) {
        const chill = t.buffs.find((b) => b.id === 'chill');
        if (chill && chill.stacks > 0) {
          // 消耗一半寒冷层数（向下取整，至少1层）
          const consumed = Math.max(1, Math.floor(chill.stacks / 2));
          chill.stacks -= consumed;
          if (chill.stacks <= 0) {
            t.buffs = t.buffs.filter((b) => b.id !== 'chill');
          }
          addLog(s, { t: 'info', text: `【温感追踪震撼弹】消耗了 ${t.name} 的${consumed}层寒冷` });
          // 冷凝榴弹：累计消耗的寒冷层数
          t.condensConsumedChill = (t.condensConsumedChill ?? 0) + consumed;
          const cg = findCondensGrenade(s);
          if (cg) checkCondensThresholds(s, t, cg);
          const baseDmg = Math.floor(consumed * (c.int ?? 0) * eff.consumeHalfChillIntMul);
          if (baseDmg > 0 && t.alive) {
            // 用 calcDamage 结算，使伤害吃到破甲等减伤/增伤效果（法抗仍按正常法术伤害结算）
            const fakeC: Combatant = { ...c, stats: { ...c.stats, atk: baseDmg } };
            applyDamage(s, t, calcDamage(fakeC, t, 1, 'magical'), 'magical');
          }
        }
      }
    }
  }

  // 冷凝榴弹：激活状态（普攻附加寒冷，用技时消耗寒冷造成伤害）
  if (eff.condensGrenade) {
    c.condensGrenadeActive = {
      turnsLeft: eff.condensGrenade.turns,
      chillPerHit: eff.condensGrenade.chillPerHit,
      keepOne: eff.condensGrenade.keepOne,
    };
    addLog(s, { t: 'info', text: `${c.name} 激活冷凝榴弹：接下来 ${eff.condensGrenade.turns >= 999 ? '所有' : eff.condensGrenade.turns} 回合普攻附加${eff.condensGrenade.chillPerHit}层寒冷` });
  }

  // 延异视阈：使目标凋亡强度+X
  if (eff.apoptosisIntensityUp && targetUids.length) {
    for (const uid of targetUids) {
      const t = byUid(s, uid);
      if (!t || !t.alive) continue;
      const existing = t.buffs.find((b) => b.id === 'apoptosis');
      if (existing) {
        existing.intensity += eff.apoptosisIntensityUp;
        addLog(s, { t: 'buff', uid: t.uid, buffId: 'apoptosis', stacks: existing.stacks, intensity: existing.intensity, applied: true });
        // 强度提升后检测引爆
        tryTriggerApoptosis(s, t);
      }
    }
  }

  // ===== 凯隐：切换形态（掠影步）=====
  if (eff.switchForm) {
    const wasFirst = !c.kaynFirstSwitch;
    c.kaynFirstSwitch = true;
    // 红形态切换：消耗所有护盾，并按消耗的护盾量恢复HP
    if (c.form === 'red') {
      const consumed = c.shield;
      c.shield = 0;
      if (consumed > 0 && eff.healFromShieldPct) {
        const heal = Math.min(Math.floor(consumed * eff.healFromShieldPct), c.maxHp - c.hp);
        if (heal > 0) { c.hp += heal; addLog(s, { t: 'heal', targetUid: c.uid, amount: heal }); }
      }
    }
    // 蓝形态切换：消耗次数盾
    if (c.form === 'blue' && eff.consumeShieldStacks) {
      c.shieldStacks = Math.max(0, (c.shieldStacks ?? 0) - eff.consumeShieldStacks);
    }
    // 首次切换加成
    if (wasFirst) {
      if (eff.firstSwitchMp) {
        const gain = Math.min(eff.firstSwitchMp, c.maxMp - c.mp);
        if (gain > 0) { c.mp += gain; addLog(s, { t: 'info', text: `${c.name}首次切换形态，恢复 ${gain} MP` }); }
      }
      if (eff.firstSwitchAgi) {
        c.agi = (c.agi ?? 0) + eff.firstSwitchAgi;
        addLog(s, { t: 'info', text: `${c.name}首次切换形态，敏捷永久 +${eff.firstSwitchAgi}` });
      }
      if (eff.firstSwitchStr) {
        c.str = (c.str ?? 0) + eff.firstSwitchStr;
        addLog(s, { t: 'info', text: `${c.name}首次切换形态，力量永久 +${eff.firstSwitchStr}` });
      }
    }
    // 切换形态
    c.form = c.form === 'red' ? 'blue' : 'red';
    addLog(s, { t: 'info', text: `${c.name}切换至${c.form === 'red' ? '红' : '蓝'}形态` });
    addLog(s, { t: 'vfx', uid: c.uid, kind: c.form === 'red' ? 'kayn-form-red' : 'kayn-form-blue' });
    // 蓝形态掠影步：回合末给自己施加迅捷
    if (eff.swiftTurnEnd) {
      c.pendingSwift = { intensity: eff.swiftTurnEnd.intensity, stacks: eff.swiftTurnEnd.stacks };
    }
  }

  // ===== 爱弥斯：共赴长航——切换人/机甲形态（主动）=====
  if (eff.eimisHumanChaGain !== undefined) {
    doEimisFormSwitch(s, c, false);
  }

  // ===== 凯隐：每次释放技能获得能量，溢出按比例转护盾 =====
  if (c.kaynEnergyPerSkill && (sk.id === 'sk_kayn_scythe' || sk.id === 'sk_kayn_realm' || sk.id === 'sk_kayn_step')) {
    const before = c.energy ?? 0;
    const after = before + c.kaynEnergyPerSkill;
    const max = c.energyMax ?? 100;
    if (after > max) {
      c.energy = max;
      const overflow = after - max;
      const shieldGain = Math.floor(overflow * (c.energyOverflowRatio ?? 1));
      if (shieldGain > 0) {
        const g = gainShield(s, c, shieldGain);
        if (g > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: g });
      }
    } else {
      c.energy = after;
    }
  }

  // ===== 新约能天使 · 开火成瘾症 =====
  if (eff.fireAddictionShieldAgiMul !== undefined) {
    const shieldAmt = Math.floor((c.agi ?? 0) * eff.fireAddictionShieldAgiMul);
    const gain = gainShield(s, c, shieldAmt);
    if (gain > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: gain });
    // 判断是否有其他友方存活单位
    const allies = (c.side === 'ally' ? s.allies : s.enemies).filter((a) => a.alive && a.uid !== c.uid);
    let extraAmmo = eff.fireAddictionExtraAmmo ?? 5;
    if (allies.length > 0) {
      // 给速度最低的友方等值护盾
      const lowest = allies.reduce((m, a) => (effSpd(a).max < effSpd(m).max ? a : m), allies[0]);
      const ag = gainShield(s, lowest, shieldAmt);
      if (ag > 0) addLog(s, { t: 'shield', targetUid: lowest.uid, amount: ag });
      extraAmmo = eff.fireAddictionAllyExtraAmmo ?? 10;
      addLog(s, { t: 'info', text: `【开火成瘾症】${lowest.name} 获得 ${shieldAmt} 护盾，开火成瘾额外消耗提升为 ${extraAmmo}` });
    }
    // 施加开火成瘾（强度=额外弹药消耗）
    const b = addBuff(c, 'fireAddiction', 99, extraAmmo);
    addLog(s, { t: 'buff', uid: c.uid, buffId: 'fireAddiction', stacks: b.stacks, intensity: b.intensity, applied: true });
  }

  // ===== 新约能天使 · 使命必达：获得弹药 + 友方额外回合 =====
  if (eff.missionAmmoGain !== undefined) {
    c.ammo = (c.ammo ?? 0) + eff.missionAmmoGain;
    addLog(s, { t: 'info', text: `【使命必达】${c.name} 获得 ${eff.missionAmmoGain} 发弹药（当前 ${c.ammo} 发）` });
    // 使命必达目标为 allyOne，targetUid 为选中的友方
    if (targetUid) {
      const ally = byUid(s, targetUid);
      if (ally && ally.alive && ally.side === c.side) {
        // 插入到当前行动者之后，获得一个额外回合
        const curIdx = s.order.indexOf(c.uid);
        const insertAt = curIdx >= 0 ? curIdx + 1 : s.order.length;
        s.order.splice(insertAt, 0, ally.uid);
        addLog(s, { t: 'info', text: `【使命必达】${ally.name} 获得一个额外回合` });
      }
    }
  }

  // ===== 奥古斯塔：技能后战势处理 =====
  if (c.momentumMax !== undefined) {
    const isEnhanced = augustaEnhanced;
    if (isEnhanced) {
      consumeMomentumForEnhance(s, c, !!eff.augustaEnhanceConsumeAll);
    } else {
      gainMomentum(s, c);
    }
  }

  // 拳经三问：技能结算后累积全能增伤（供后续技能使用）
  if (c.skillDmgStack && c.skillDmgStack.stacks < c.skillDmgStack.cap) {
    c.skillDmgStack.stacks = Math.min(c.skillDmgStack.cap, c.skillDmgStack.stacks + c.skillDmgStack.pct);
    addLog(s, { t: 'info', text: `【拳经三问】${c.name} 使用技能后全能增伤+${Math.round(c.skillDmgStack.pct * 100)}%（当前${Math.round(c.skillDmgStack.stacks * 100)}%，上限${Math.round(c.skillDmgStack.cap * 100)}%）` });
  }
}

function useItem(s: BattleState, c: Combatant, item: Item, targetUid: string): boolean {
  const t = byUid(s, targetUid);
  if (!t.alive || t.side !== c.side) return false;
  // 药水局内共享：从任意存活友方背包中消耗一件
  const owner = alive(s.allies).find((a) => {
    const g = a.bag.find((bg) => bg.itemId === item.id);
    return g && g.count > 0;
  });
  if (!owner) return false;
  if (!item.usable) return false;
  const group = owner.bag.find((g) => g.itemId === item.id)!;
  group.count -= 1;
  if (group.count <= 0) owner.bag = owner.bag.filter((g) => g !== group);
  addLog(s, { t: 'action', actorUid: c.uid, kind: 'item', label: item.name, targetUids: [t.uid] });

  const u = item.usable;
  if (u.hp) {
    let heal = u.hp;
    if (t.side === 'ally' && t.healAmp) heal = Math.floor(heal * (1 + t.healAmp));
    const gain = Math.min(heal, t.maxHp - t.hp);
    t.hp += gain;
    recalcHpLossBonuses(t);
    addLog(s, { t: 'heal', targetUid: t.uid, amount: gain });
  }
  if (u.mp) {
    const gain = Math.min(u.mp, t.maxMp - t.mp);
    t.mp += gain;
    addLog(s, { t: 'heal', targetUid: t.uid, amount: gain });
  }
  if (u.shield) {
    const gain = gainShield(s, t, u.shield);
    if (gain > 0) addLog(s, { t: 'shield', targetUid: t.uid, amount: gain });
  }
  return true;
}

// ---------- 合法行动（UI 菜单的唯一依据） ----------
export interface LegalSkill { skill: Skill; targetUids: string[] | null; disabled: boolean; reason?: string; costText?: string }
export interface LegalItem { item: Item; count: number; targetUids: string[] }
export interface LegalInfo {
  canAttack: boolean;
  attackAll: boolean; // 普攻群攻被动：UI 无需选目标
  skills: LegalSkill[];
  items: LegalItem[];
}
const EMPTY_LEGAL: LegalInfo = { canAttack: false, attackAll: false, skills: [], items: [] };

export function getLegalActions(s: BattleState, items: Map<string, Item>): LegalInfo {
  if (s.result) return EMPTY_LEGAL;
  const c = currentActor(s);
  if (c.side !== 'ally' || !c.alive) return EMPTY_LEGAL;

  // 不可选中的无敌单位（融合暗精灵僵尸等）从目标池中排除
  const enemyUids = alive(s.enemies).filter((u) => !isUntargetableInvincible(u)).map((u) => u.uid);
  const allyUids = alive(s.allies).filter((u) => !isUntargetableInvincible(u)).map((u) => u.uid);
  // 嘲讽：敌方存在嘲讽单位时，我方单体技能目标只能选择嘲讽单位
  const tauntUids = enemyUids.filter((uid) => !!byUid(s, uid).taunt);
  const singleTargetUids = tauntUids.length > 0 ? tauntUids : enemyUids;

  const skills: LegalSkill[] = c.skills
    .filter((sk) => sk.kind === 'active') // 反应式技能由受击弹窗触发，不进行动菜单
    .map((sk) => {
    // 凯隐双形态：取当前形态的实际消耗
    const eff: Skill = sk.formEffects && c.form ? ({ ...sk, ...sk.formEffects[c.form] } as Skill) : sk;
    const costs: string[] = [];
    if (eff.hpCost) costs.push(`血${eff.hpCost}`);
    if (eff.mpCost) costs.push(`魔${eff.mpCost}`);
    if (eff.energyCost) costs.push(`能${eff.energyCost}`);
    const costText = costs.length ? costs.join(' ') : '—';
    if (c.mp < (eff.mpCost ?? 0)) return { skill: sk, targetUids: null, disabled: true, reason: '魔力不足', costText };
    if (eff.energyCost && (c.energy ?? 0) < eff.energyCost) return { skill: sk, targetUids: null, disabled: true, reason: '能量不足', costText };
    if (eff.hpCost && c.hp <= eff.hpCost) return { skill: sk, targetUids: null, disabled: true, reason: '生命不足', costText };
    // 王牌单位：每场战斗仅一次（句点夫 工艺粉碎弹）
    if (eff.aceOncePerBattle && c.aceOncePerBattleUsed?.[sk.id]) return { skill: sk, targetUids: null, disabled: true, reason: '本场已使用', costText };
    if (eff.gatesRequired && (c.eightGates ?? 0) < eff.gatesRequired) return { skill: sk, targetUids: null, disabled: true, reason: `需八门遁甲${eff.gatesRequired}层`, costText };
    // 爱弥斯：飞至启明之时需满同步率
    if (eff.eimisUltimateCapMul !== undefined && (c.eimisSyncRate ?? 0) < (c.eimisSyncMax ?? 4)) {
      return { skill: sk, targetUids: null, disabled: true, reason: `需同步率${c.eimisSyncMax ?? 4}`, costText };
    }
    // 里恩：Furioso-Replica 需代行-赫尔墨斯满层且本场未使用
    if (eff.reinFurioso) {
      if (c.reinFuriosoUsed) return { skill: sk, targetUids: null, disabled: true, reason: '本场已使用', costText };
      if ((c.reinOracle?.stacks ?? 0) < (eff.reinFurioso.requireStacks ?? 12)) {
        return { skill: sk, targetUids: null, disabled: true, reason: `需代行${eff.reinFurioso.requireStacks ?? 12}层`, costText };
      }
    }
    if (eff.target === 'self') return { skill: sk, targetUids: null, disabled: false, costText };
    if (eff.target === 'enemyAll') {
      return enemyUids.length
        ? { skill: sk, targetUids: enemyUids, disabled: false, costText }
        : { skill: sk, targetUids: [], disabled: true, reason: '没有目标', costText };
    }
    if (eff.target === 'allyOne') {
      // 自动吸附：选友方（含自己，但通常选队友）
      return allyUids.length
        ? { skill: sk, targetUids: allyUids, disabled: false, costText }
        : { skill: sk, targetUids: [], disabled: true, reason: '没有目标', costText };
    }
    return singleTargetUids.length
      ? { skill: sk, targetUids: singleTargetUids, disabled: false, costText }
      : { skill: sk, targetUids: [], disabled: true, reason: '没有目标', costText };
  });

  // 药水道具局内共享：聚合所有存活友方的背包
  const legalItems: LegalItem[] = [];
  const sharedBag = new Map<string, number>();
  for (const a of alive(s.allies)) {
    for (const g of a.bag) {
      if (g.count <= 0) continue;
      sharedBag.set(g.itemId, (sharedBag.get(g.itemId) ?? 0) + g.count);
    }
  }
  for (const [itemId, count] of sharedBag) {
    const item = items.get(itemId);
    if (item && item.slot === 'consumable' && item.usable) {
      legalItems.push({ item, count, targetUids: allyUids });
    }
  }

  // 剑锤遗物：普攻需消耗10MP，MP不足时普攻不可用（与 basicAttack 拦截一致）
  const canBasic = enemyUids.length > 0 && !(c.swordHammerMpExtra && c.mp < c.swordHammerMpExtra);
  return { canAttack: canBasic, attackAll: !!c.passives.basicAttackAll, skills, items: legalItems };
}

// ---------- 玩家行动 ----------
export function playerAct(
  s: BattleState,
  action: PlayerAction,
  items: Map<string, Item>,
): { state: BattleState; events: LogEntry[] } {
  if (s.result) return { state: s, events: [] };
  const ns = structuredClone(s);
  const c = currentActor(ns);
  if (c.side !== 'ally' || !c.alive) return { state: s, events: [] };
  const start = ns.log.length;

  // 新约能天使：行动前消耗弹药（不足则全部消耗），并检查开火成瘾是否解除
  if (c.ammoPreActionCost !== undefined && c.ammo !== undefined) {
    const cost = c.ammoPreActionCost;
    const before = c.ammo;
    if (before < cost) {
      const fa = c.buffs.find((b) => b.id === 'fireAddiction');
      if (fa) {
        c.buffs = c.buffs.filter((b) => b.id !== 'fireAddiction');
        addLog(ns, { t: 'info', text: `【开火成瘾】${c.name} 弹药不足（${before} < ${cost}），开火成瘾解除` });
      }
    }
    if (before > 0) {
      const actual = consumeAmmo(ns, c, Math.min(cost, before));
      addLog(ns, { t: 'info', text: `【铳弹协约】${c.name} 行动前消耗 ${actual} 发弹药（剩余 ${c.ammo}），下次攻击倍率+${Math.round((c.ammoNextMulBonus ?? 0) * 100)}%` });
    }
  }

  // 行动前消耗（含火力电台）可能已击杀敌方：先判定胜负，避免电台清场后仍卡在选目标
  checkResult(ns);
  if (ns.result) return { state: ns, events: ns.log.slice(start) };

  let ok = false;

  if (action.type === 'attack') {
    let t = byUid(ns, action.targetUid);
    // 行动前火力电台可能击杀了原目标：自动改选任一存活敌方
    if ((!t || !t.alive) && t?.side === 'enemy') {
      t = alive(ns.enemies)[0];
    }
    // 嘲讽：敌方有嘲讽单位时，强制改选嘲讽单位
    const taunter = alive(ns.enemies).find((u) => u.alive && u.taunt);
    if (taunter) t = taunter;
    if (t && t.alive && t.side === 'enemy') {
      basicAttack(ns, c, t.uid);
      ok = true;
    }
  } else if (action.type === 'skill') {
    const sk = c.skills.find((x) => x.id === action.skillId);
    if (sk) {
      // 凯隐双形态：合并当前形态的实际消耗与目标（红形态耗HP不耗MP，蓝形态目标为enemyAll）
      const eff: Skill = sk.formEffects && c.form
        ? ({ ...sk, ...sk.formEffects[c.form] } as Skill)
        : sk;
      const enhance = !!action.enhance;
      const mpCost = (eff.mpCost ?? 0) + (enhance ? (eff.enhanceMpCost ?? 0) : 0);
      const hpCost = eff.hpCost ?? 0;
      const kamuiCost = enhance ? (eff.enhanceKamuiCost ?? 0) : 0;
      const gatesReq = eff.gatesRequired ?? 0;
      const gatesOk = gatesReq === 0 || (c.eightGates ?? 0) >= gatesReq;
      if (c.mp >= mpCost && c.hp > hpCost && (kamuiCost === 0 || (c.kamuiUses ?? 0) >= kamuiCost) && gatesOk) {
        if (eff.target === 'self') {
          castSkill(ns, c, sk, undefined, enhance, false, action.variantId);
          ok = true;
        } else if (eff.target === 'enemyAll') {
          if (alive(ns.enemies).length > 0) {
            castSkill(ns, c, sk, undefined, enhance, false, action.variantId);
            ok = true;
          }
        } else if (eff.target === 'allyOne') {
          const t = action.targetUid ? byUid(ns, action.targetUid) : undefined;
          if (t && t.alive && t.side === 'ally') {
            castSkill(ns, c, sk, t.uid, enhance, false, action.variantId);
            ok = true;
          }
        } else {
          let t = action.targetUid ? byUid(ns, action.targetUid) : undefined;
          if (t && !t.alive && t.side === 'enemy') t = alive(ns.enemies)[0];
          // 嘲讽：敌方有嘲讽单位时，强制改选嘲讽单位
          const taunter = alive(ns.enemies).find((u) => u.alive && u.taunt);
          if (taunter) t = taunter;
          if (t && t.alive && t.side === 'enemy') {
            castSkill(ns, c, sk, t.uid, enhance, false, action.variantId);
            ok = true;
          }
        }
      }
    }
  } else {
    const item = items.get(action.itemId);
    const t = byUid(ns, action.targetUid);
    if (item) ok = useItem(ns, c, item, t.uid);
  }

  if (!ok) return { state: s, events: [] };
  // 里恩：行动后代行层数结算（使用带标变体/选中带标目标→层数；均不满足→业）
  if (isRein(c)) {
    applyReinOracleAction(ns, c, action);
    // 行动后达到 3/6/9/12 层立即获得解放（覆盖式）；12层觉醒心-命运（不再等回合末）
    applyReinLiberationCheck(ns, c);
  }
  const usedSkill = action.type === 'skill';
  postAllyAction(ns, c, usedSkill);
  checkResult(ns);
  return { state: ns, events: ns.log.slice(start) };
}

// 我方单位行动后结算（根源之种回血、液体化肥、黑色郁金香等）
function postAllyAction(s: BattleState, c: Combatant, usedSkill: boolean): void {
  if (!c.alive) return;
  // 根源之种：行动后恢复X%最大生命
  if (c.postActionHealPct && c.postActionHealPct > 0 && c.hp < c.maxHp) {
    let heal = Math.ceil(c.maxHp * c.postActionHealPct);
    if (c.healAmp) heal = Math.floor(heal * (1 + c.healAmp));
    heal = Math.min(heal, c.maxHp - c.hp);
    if (heal > 0) {
      c.hp += heal;
      addLog(s, { t: 'heal', targetUid: c.uid, amount: heal });
    }
  }
  // 血腥武器：行动后恢复自身N点HP
  if (c.weaponHealOnAction && c.weaponHealOnAction > 0 && c.hp < c.maxHp) {
    let heal = c.weaponHealOnAction;
    if (c.healAmp) heal = Math.floor(heal * (1 + c.healAmp));
    heal = Math.min(heal, c.maxHp - c.hp);
    if (heal > 0) {
      c.hp += heal;
      addLog(s, { t: 'heal', targetUid: c.uid, amount: heal });
    }
  }
  // 液体化肥：每次行动后失去X HP，获得Y护盾
  if (c.actionHpToShield) {
    const hpLoss = Math.min(c.actionHpToShield.hpLoss, c.hp - 1);
    if (hpLoss > 0) {
      c.hp -= hpLoss;
      addLog(s, { t: 'damage', targetUid: c.uid, amount: hpLoss, type: 'true', killed: false });
    }
    const gain = gainShield(s, c, c.actionHpToShield.shieldGain);
    if (gain > 0) addLog(s, { t: 'shield', targetUid: c.uid, amount: gain });
  }
  // 黑色郁金香：不用技能则攻击+X%（上限）；用技能则加成归零
  // 层数直接计入 atkPctBonus（effAtk 中叠加），不再改写 stats.atk，避免覆盖其它攻%加成
  if (c.noSkillAtkBuff) {
    const st = c.noSkillAtkBuff;
    if (usedSkill) {
      if (st.stacks > 0) {
        st.stacks = 0;
        addLog(s, { t: 'info', text: `【黑色郁金香】${c.name} 使用技能，攻击加成归零` });
      }
    } else if (st.stacks < st.cap) {
      st.stacks = Math.min(st.cap, st.stacks + st.pct);
      addLog(s, { t: 'info', text: `【黑色郁金香】${c.name} 攻击+${Math.round(st.pct * 100)}%（累计${Math.round(st.stacks * 100)}%）` });
    }
  }
}

// 热辣可可/肾上腺素：按当前血量实时重算损血加成
function recalcHpLossBonuses(c: Combatant): void {
  if (!c.alive) return;
  if (c.hpLossAtk) {
    const lossPct = 1 - c.hp / c.maxHp;
    const tiers = Math.floor(lossPct / c.hpLossAtk.hpLossPctPer);
    const atkPct = tiers * c.hpLossAtk.atkPctPer;
    const old = c.hpLossAtkContrib ?? 0;
    c.atkPctBonus = (c.atkPctBonus ?? 0) - old + atkPct;
    c.hpLossAtkContrib = atkPct;
  }
  if (c.hpLossSpd) {
    const lossPct = 1 - c.hp / c.maxHp;
    const tiers = Math.floor(lossPct / c.hpLossSpd.hpLossPctPer);
    const spd = tiers * c.hpLossSpd.spdPer;
    if (!c.hpLossSpdBase) c.hpLossSpdBase = { min: c.stats.spdMin, max: c.stats.spdMax };
    c.stats.spdMin = c.hpLossSpdBase.min + spd;
    c.stats.spdMax = c.hpLossSpdBase.max + spd;
  }
}

// ---------- 灾厄 BOSS 行动 ----------
// 返回非 null 表示已处理完本回合行动；null 表示走通用 AI
function bossAct(
  ns: BattleState, c: Combatant, rng: Rng, start: number,
): { state: BattleState; events: LogEntry[] } | null {
  const finish = () => { postEnemyAction(ns, c); checkResult(ns); return { state: ns, events: ns.log.slice(start) }; };
  // 随机选一名我方单位（嘲讽优先：我方存在嘲讽单位时，单体伤害强制以嘲讽单位为目标）
  const randAlly = () => {
    const pool = alive(ns.allies).filter((u) => !isUntargetableInvincible(u));
    if (!pool.length) return null;
    const taunters = pool.filter((u) => u.taunt || u.aceTaunt);
    const src = taunters.length ? taunters : pool;
    return src[rng.int(0, src.length - 1)];
  };
  const spawnEnemy = (unit: Combatant, fromName: string) => {
    unit.uid = `summon_${ns.nextSummonId++}`;
    ns.enemies.push(unit);
    addLog(ns, { t: 'summon', uid: c.uid, name: fromName, targetUid: unit.uid, targetName: unit.name });
  };

  // 克苏鲁之脑：眼球
  if (c.monsterId === 'ct_027_eye') {
    const brain = ns.enemies.find((e) => e.monsterId === 'ct_027' && e.alive);
    const t = randAlly();
    if (t) {
      if (ns.replaySpecial) ns.replaySpecial = undefined;
      else {
        const kam = findKamuiReaction(ns, c, t.uid);
        if (kam) { ns.pendingReaction = kam; return finish(); }
      }
      const hpBefore = t.hp;
      damageOne(ns, c, t.uid, 1, 'physical');
      const dmg = Math.max(0, hpBefore - t.hp);
      if (brain && dmg > 0) {
        brain.maxHp += dmg;
        brain.hp = Math.min(brain.maxHp, brain.hp + dmg);
        addLog(ns, { t: 'info', text: `【${brain.name}】吸收眼球伤害，最大HP+${dmg}并恢复${dmg}HP` });
      }
    }
    return finish();
  }
  // 克苏鲁之脑本体
  if (c.monsterId === 'ct_027') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.cthulhuBrain) c.crisis.cthulhuBrain = { phase: 'invincible' };
    const eyes = ns.enemies.filter((e) => e.monsterId === 'ct_027_eye' && e.alive);
    if (c.crisis.cthulhuBrain.phase === 'invincible' && eyes.length === 0) {
      c.crisis.cthulhuBrain.phase = 'active';
      c.invincible = false;
      addLog(ns, { t: 'info', text: `【${c.name}】眼球全灭，解除无敌开始攻击` });
    }
    if (c.crisis.cthulhuBrain.phase === 'invincible') {
      addLog(ns, { t: 'info', text: `【${c.name}】处于无敌状态，等待眼球` });
      return finish();
    }
    // 攻击：100%物理 + 3次随机25%法术
    const t = randAlly();
    if (t) {
      if (ns.replaySpecial) ns.replaySpecial = undefined;
      else {
        const kam = findKamuiReaction(ns, c, t.uid);
        if (kam) { ns.pendingReaction = kam; return finish(); }
      }
      damageOne(ns, c, t.uid, 1, 'physical');
      for (let i = 0; i < 3; i++) {
        const rt = randAlly();
        if (rt && rt.alive) damageOne(ns, c, rt.uid, 0.25, 'magical');
      }
    }
    return finish();
  }

  // 腐巢意志：腐化囊（行动为召唤一只噬魂怪）
  if (c.monsterId === 'ct_042_sac') {
    const worm = makeCombatant({
      uid: '__x__', side: 'enemy', name: '噬魂怪',
      stats: { hp: 500, mp: 0, atk: 80, def: 50, mres: 50, spdMin: 2, spdMax: 6 },
      ai: 'basic', monsterId: 'ct_030', attackType: 'physical', mpDrain: 5,
    });
    spawnEnemy(worm, c.name);
    addLog(ns, { t: 'info', text: `【${c.name}】召唤了一只噬魂怪` });
    return finish();
  }
  // 腐巢意志本体
  if (c.monsterId === 'ct_042') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.rotNest) c.crisis.rotNest = { phase: 'invincible', cycleStep: 0, enraged: false };
    const rn = c.crisis.rotNest;
    const sac = ns.enemies.find((e) => e.monsterId === 'ct_042_sac' && e.alive);
    if (rn.phase === 'invincible' && !sac) {
      rn.phase = 'active';
      c.invincible = false;
      addLog(ns, { t: 'info', text: `【${c.name}】腐化囊被消灭，退出无敌` });
    }
    if (rn.phase === 'invincible') {
      addLog(ns, { t: 'info', text: `【${c.name}】处于无敌状态` });
      return finish();
    }
    // 狂暴：HP<50%
    if (!rn.enraged && c.hp / c.maxHp < 0.5) {
      rn.enraged = true;
      c.stats.spdMin += 5; c.stats.spdMax += 5;
      addLog(ns, { t: 'info', text: `【${c.name}】进入狂暴，速度+5，攻击附加法术伤害` });
    }
    // 行动：纯物理攻击（狂暴时附加法术伤害）；不再召唤噬魂怪
    const t = randAlly();
    if (t) {
      if (ns.replaySpecial) ns.replaySpecial = undefined;
      else {
        const kam = findKamuiReaction(ns, c, t.uid);
        if (kam) { ns.pendingReaction = kam; return finish(); }
      }
      damageOne(ns, c, t.uid, 1, 'physical');
      if (rn.enraged && t.alive) damageOne(ns, c, t.uid, 1, 'magical');
    }
    return finish();
  }

  // 血肉宿主
  if (c.monsterId === 'ct_041') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.fleshHost) c.crisis.fleshHost = { wormsSummoned: 0 };
    const fh = c.crisis.fleshHost;
    // 70%/40% 各召唤一次蠕虫
    const thresholds = [0.7, 0.4];
    while (fh.wormsSummoned < thresholds.length && c.hp / c.maxHp <= thresholds[fh.wormsSummoned]) {
      const worm = makeCombatant({
        uid: '__x__', side: 'enemy', name: '血肉蠕虫',
        stats: { hp: Math.floor(c.maxHp * 0.5), mp: 0, atk: c.stats.atk, def: c.stats.def, mres: c.stats.mres, spdMin: c.stats.spdMin, spdMax: c.stats.spdMax },
        ai: 'basic', monsterId: 'ct_041_worm', attackType: 'physical',
      });
      spawnEnemy(worm, c.name);
      fh.wormsSummoned++;
      addLog(ns, { t: 'info', text: `【${c.name}】召唤血肉蠕虫（第${fh.wormsSummoned}只）` });
    }
    // 本体：100%法术
    const t = randAlly();
    if (t) {
      if (specialAttackKamui(ns, c)) return finish();
      damageOne(ns, c, t.uid, 1, 'magical');
    }
    return finish();
  }
  // 血肉蠕虫
  if (c.monsterId === 'ct_041_worm') {
    const t = randAlly();
    if (t) {
      if (specialAttackKamui(ns, c)) return finish();
      const hpBefore = t.hp;
      damageOne(ns, c, t.uid, 1.2, 'physical');
      const dmg = Math.max(0, hpBefore - t.hp);
      if (dmg > 0) {
        const heal = Math.floor(dmg * 0.5);
        c.hp = Math.min(c.maxHp, c.hp + heal);
        addLog(ns, { t: 'info', text: `【${c.name}】吸血恢复${heal}HP` });
      }
    }
    return finish();
  }

  // 骷髅王头：每两回合行动一次 150%物理
  if (c.monsterId === 'ct_057_head') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.skeletron) c.crisis.skeletron = { handsDead: false, reviveCounter: 0 };
    // 仅偶数回合（2/4/6...）行动
    if (ns.turn % 2 !== 0) {
      addLog(ns, { t: 'info', text: `【${c.name}】蓄力中，本回合不行动` });
      return finish();
    }
    const t = randAlly();
    if (t) {
      if (specialAttackKamui(ns, c)) return finish();
      damageOne(ns, c, t.uid, 1.5, 'physical');
    }
    return finish();
  }

  // 肉山：双行动槽（rollOrder 展开 act1/act2 两个顺位条目），每槽执行一个随机行动。
  // 单体行动可被面具男虚化弹窗打断（接受=该行动作废并推进到下一槽；拒绝=重放承伤）；
  // 群体行动面具男自动免疫自身（其他角色照常承伤）。
  if (c.monsterId === 'ct_068') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.wallOfFlesh) c.crisis.wallOfFlesh = { atkBonus: 0, turn: 0, steps: [], stepIdx: 0, lastEvaded: -1 };
    const wf = c.crisis.wallOfFlesh!;
    // 每损失10%HP，攻击+20
    const lostTiers = Math.floor((1 - c.hp / c.maxHp) * 10);
    const expectedAtk = lostTiers * 20;
    if (expectedAtk > wf.atkBonus) {
      c.stats.atk += (expectedAtk - wf.atkBonus);
      wf.atkBonus = expectedAtk;
    }
    // 每回合初抽2个行动（turn 变化时重置）；回合内两个槽位依次执行
    if (wf.turn !== ns.turn) {
      wf.turn = ns.turn;
      const acts = [0, 1, 2, 3];
      for (let i = acts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [acts[i], acts[j]] = [acts[j], acts[i]];
      }
      wf.steps = acts.slice(0, 2);
      wf.stepIdx = 0;
      wf.lastEvaded = -1;
    }
    // 两个槽位都执行完：本槽位直接结束
    if (wf.stepIdx >= wf.steps.length) return finish();
    // 跳过上次被虚化闪避（接受）而作废的行动，推进到下一个待执行行动
    while (wf.stepIdx < wf.steps.length && wf.lastEvaded === wf.steps[wf.stepIdx]) {
      wf.lastEvaded = -1;
      wf.stepIdx++;
    }
    if (wf.stepIdx >= wf.steps.length) return finish();
    const step = wf.steps[wf.stepIdx];
    // 单体行动（1=单体物理、3=单体法术）：虚化弹窗（接受后由 resolveReaction 写回作废标记并推进；拒绝后重放承伤）
    if (step === 1 || step === 3) {
      if (specialAttackKamui(ns, c, step)) {
        return finish();
      }
    }
    // 群体行动（0=群体物理）：虚化弹窗（接受后仅面具男免疫自身，行动重放队友照常承伤）
    if (step === 0 && applySpecialAoeKamui(ns, c)) return finish();
    const allies = alive(ns.allies);
    // 执行当前行动
    if (step === 0) {
      // 对速度低于自身的全体 90%物理
      const mySpd = effSpd(c).max;
      for (const a of allies) {
        if (!a.alive || effSpd(a).max >= mySpd) continue;
        if (a.uid === ns.kamuiAoeImmunity) continue; // 面具男虚化免疫自身
        damageOne(ns, c, a.uid, 0.9, 'physical', { isAoe: true });
      }
    } else if (step === 1) {
      // 速度最低 120%物理
      let slowest = allies[0];
      for (const a of allies) if (a.alive && effSpd(a).min < effSpd(slowest).min) slowest = a;
      if (slowest && slowest.alive) damageOne(ns, c, slowest.uid, 1.2, 'physical');
    } else if (step === 2) {
      // 全体3层3强度中毒
      for (const a of allies) {
        if (!a.alive) continue;
        addBuff(a, 'poison', 3, 3, c.uid, 'max', c);
        addLog(ns, { t: 'buff', uid: a.uid, buffId: 'poison', stacks: 3, intensity: 3, applied: true });
      }
    } else {
      // 速度最快 100%法术
      let fastest = allies[0];
      for (const a of allies) if (a.alive && effSpd(a).max > effSpd(fastest).max) fastest = a;
      if (fastest && fastest.alive) damageOne(ns, c, fastest.uid, 1, 'magical');
    }
    wf.stepIdx++;
    ns.kamuiAoeImmunity = undefined; // 群体免疫标记随本槽行动结束清除
    return finish();
  }

  // 黑色瘟疫·狄瑞吉
  if (c.monsterId === 'ct_083') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.direge) c.crisis.direge = { phase: 1 };
    const dr = c.crisis.direge;
    // 虚化检查：狄瑞吉的攻击行动可被面具男虚化打断
    if (specialAttackKamui(ns, c)) return finish();
    if (dr.phase === 1) {
      const cycle = (ns.turn - 1) % 3;
      const t = randAlly();
      if (cycle === 0 && t) {
        // 两段80%物理+3瘟疫
        for (let i = 0; i < 2; i++) if (t.alive) damageOne(ns, c, t.uid, 0.8, 'physical');
        if (t.alive) { addBuff(t, 'plague', 3, 1, c.uid, 'max', c); addLog(ns, { t: 'buff', uid: t.uid, buffId: 'plague', stacks: 3, intensity: 1, applied: true }); }
      } else if (cycle === 1) {
        // 群110%物理+2瘟疫（虚化弹窗：接受后仅面具男免疫自身，队友照常承伤）
        if (applySpecialAoeKamui(ns, c)) return finish();
        for (const a of alive(ns.allies)) {
          if (a.uid === ns.kamuiAoeImmunity) continue;
          damageOne(ns, c, a.uid, 1.1, 'physical', { isAoe: true });
          addBuff(a, 'plague', 2, 1, c.uid, 'max', c);
        }
        ns.kamuiAoeImmunity = undefined;
      } else if (cycle === 2 && t) {
        // 单体100%法术+3瘟疫
        damageOne(ns, c, t.uid, 1, 'magical');
        if (t.alive) { addBuff(t, 'plague', 3, 1, c.uid, 'max', c); addLog(ns, { t: 'buff', uid: t.uid, buffId: 'plague', stacks: 3, intensity: 1, applied: true }); }
      }
    } else {
      // 二阶段：单体 敌方全体瘟疫层数×5% 攻击力物理
      const t = randAlly();
      if (t) {
        let totalPlague = 0;
        for (const a of ns.allies) totalPlague += a.buffs.find((b) => b.id === 'plague')?.stacks ?? 0;
        const mult = Math.max(0.01, totalPlague * 0.05);
        damageOne(ns, c, t.uid, mult, 'physical');
      }
    }
    return finish();
  }

  // 阿卡多：血槽机制（0/500）
  if (c.monsterId === 'ct_070') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.akado) c.crisis.akado = { bloodPool: 0, revived: false };
    const ak = c.crisis.akado;
    // 1/3/5/7/9 回合开始时：召唤一只食尸鬼（不占用本回合攻击；按回合去重，虚化重放不重复召唤）
    if ((ns.turn === 1 || ns.turn === 3 || ns.turn === 5 || ns.turn === 7 || ns.turn === 9)
        && !ns.enemies.some((e) => e.uid === `${c.uid}-g${ns.turn}`)) {
      const ghoul = makeCombatant({
        uid: `${c.uid}-g${ns.turn}`, side: 'enemy', name: '食尸鬼',
        stats: { hp: 1500, mp: 0, atk: 150, def: 70, mres: 30, spdMin: 6, spdMax: 10 },
        ai: 'basic', monsterId: 'ct_069', reviveOnce: true,
        icon: (ns.enemies.find((e) => e.monsterId === 'ct_069')?.icon) ?? '',
      });
      ns.enemies.push(ghoul);
      addLog(ns, { t: 'info', text: `【${c.name}】第${ns.turn}回合开始时，召唤了一只食尸鬼（本回合仍会攻击）` });
    }
    // 阶段强化（一次性）
    if (ak.bloodPool >= 200 && !ak.buff200) {
      c.stats.spdMin += 5; c.stats.spdMax += 5; c.stats.atk += 40;
      ak.buff200 = true;
      addLog(ns, { t: 'info', text: `【${c.name}】血槽达到200，速度+5、攻击力+40（当前攻击${c.stats.atk}）` });
    }
    if (ak.bloodPool >= 500 && !ak.buff500) {
      c.stats.atk += 100; ak.buff500 = true;
      addLog(ns, { t: 'info', text: `【${c.name}】血槽达到500，攻击力+100（当前攻击${c.stats.atk}）` });
    }
    // 攻击类型按血槽：>=400 真实、>=300 法术、否则物理
    const dmgType: DamageType = ak.bloodPool >= 400 ? 'true' : ak.bloodPool >= 300 ? 'magical' : 'physical';
    // 自身攻击提升血槽/5（动态计算：atkOverride = 当前攻击 + 血槽/5）
    const bloodAtkBonus = Math.floor(ak.bloodPool / 5);
    const atkOverride = effAtk(c) + bloodAtkBonus;
    // 目标数：>=100 时攻击两个目标（群体：虚化弹窗，接受后仅面具男免疫自身），否则单体（虚化弹窗）
    const targetCount = ak.bloodPool >= 100 ? 2 : 1;
    if (targetCount >= 2) {
      if (applySpecialAoeKamui(ns, c)) return finish();
    } else if (specialAttackKamui(ns, c)) {
      return finish();
    }
    const pool = alive(ns.allies);
    const targets: Combatant[] = [];
    if (pool.length) targets.push(pool[Math.floor(Math.random() * pool.length)]);
    if (targetCount === 2 && pool.length > 1) {
      const rest = pool.filter((a) => a.uid !== targets[0].uid);
      if (rest.length) targets.push(rest[Math.floor(Math.random() * rest.length)]);
    }
    for (const tg of targets) {
      if (!tg.alive) continue;
      if (tg.uid === ns.kamuiAoeImmunity) continue; // 面具男虚化免疫自身
      damageOne(ns, c, tg.uid, 1, dmgType, { isAoe: true, atkOverride });
    }
    ns.kamuiAoeImmunity = undefined;
    // 攻击后获得 50 血槽
    if (ak.bloodPool < 500) {
      ak.bloodPool = Math.min(500, ak.bloodPool + 50);
      addLog(ns, { t: 'info', text: `【${c.name}】攻击获得50血槽（当前${ak.bloodPool}/500）` });
    }
    return finish();
  }

  // 大鸡婶婶：攻击造成对方HP上限10%的真实伤害（注意：不走 maxHpTrueDmgPct 字段，避免 applyDamage 普攻附伤钩子重复触发）
  if (c.monsterId === 'ct_073') {
    const t = randAlly();
    if (t) {
      if (specialAttackKamui(ns, c)) return finish();
      const dmg = Math.ceil(t.maxHp * 0.1);
      damageFlat(ns, t.uid, dmg, 'true', c);
      addLog(ns, { t: 'info', text: `【${c.name}】对【${t.name}】造成 ${dmg} 点真实伤害（其HP上限10%）` });
    }
    return finish();
  }

  // Viper：行动前敌方全体中毒层数+1，攻击额外造成中毒层数×20真实伤害
  if (c.monsterId === 'ct_072') {
    for (const a of alive(ns.allies)) {
      const cur = a.buffs.find((b) => b.id === 'poison')?.intensity ?? 1;
      addBuff(a, 'poison', 1, cur, c.uid, 'max', c);
    }
    addLog(ns, { t: 'info', text: `【${c.name}】行动前敌方全体中毒层数+1` });
    const t = randAlly();
    if (t) {
      if (specialAttackKamui(ns, c)) return finish();
      damageOne(ns, c, t.uid, 1, 'physical');
      const poisonStacks = t.buffs.find((b) => b.id === 'poison')?.stacks ?? 0;
      if (poisonStacks > 0 && t.alive) {
        const extra = poisonStacks * (c.poisonStackBonusTrueDmg ?? 20);
        damageFlat(ns, t.uid, extra, 'true', c);
        addLog(ns, { t: 'info', text: `【${c.name}】额外造成 ${extra} 点真实伤害（中毒层数×20）` });
      }
    }
    return finish();
  }

  // 劳贤：红温印记（0/3），攻击+1，满时拍地板
  if (c.monsterId === 'ct_077') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.laoxian) c.crisis.laoxian = { red: 0 };
    const lx = c.crisis.laoxian;
    lx.red = Math.min(3, lx.red + 1);
    if (lx.red >= 3) {
      // 拍地板：群体100%物理 + 防御+20 法抗+10 HP恢复500（虚化弹窗：接受后仅面具男免疫自身，队友照常承伤）
      if (applySpecialAoeKamui(ns, c)) return finish(); // 弹窗打断时红温保持满，重放仍走拍地板
      lx.red = 0;
      for (const a of alive(ns.allies)) {
        if (a.uid === ns.kamuiAoeImmunity) continue;
        damageOne(ns, c, a.uid, 1, 'physical', { isAoe: true });
      }
      ns.kamuiAoeImmunity = undefined;
      c.stats.def += 20; c.stats.mres += 10;
      const heal = Math.min(500, c.maxHp - c.hp);
      if (heal > 0) { c.hp += heal; addLog(ns, { t: 'heal', targetUid: c.uid, amount: heal }); }
      addLog(ns, { t: 'info', text: `【${c.name}】红温满！劳贤拍地板：群体100%物理伤害，防御+20、法抗+10、HP恢复${heal}` });
    } else {
      const t = randAlly();
      if (t) {
        // 单体攻击：虚化弹窗
        if (specialAttackKamui(ns, c)) return finish();
        damageOne(ns, c, t.uid, 1.2, 'physical');
      }
      addLog(ns, { t: 'info', text: `【${c.name}】攻击，红温印记+1（${lx.red}/3）` });
    }
    return finish();
  }

  // 马神：攻击后速度+1，群体真实伤害多段，3/6/9/12回合眩晕重击
  if (c.monsterId === 'ct_078') {
    // 3/6/9/12 回合：单体200%物理 + 目标本回合无法行动（虚化弹窗）
    if (ns.turn % 3 === 0) {
      const t = randAlly();
      if (t) {
        if (specialAttackKamui(ns, c)) return finish();
        damageOne(ns, c, t.uid, 2, 'physical');
        if (t.alive) {
          t.statuses.stunTurns = Math.max(t.statuses.stunTurns ?? 0, 1);
          addLog(ns, { t: 'info', text: `【${t.name}】被马神眩晕，本回合无法行动` });
        }
      }
      c.stats.spdMin += 1; c.stats.spdMax += 1;
      addLog(ns, { t: 'info', text: `【${c.name}】攻击后速度+1（当前${c.stats.spdMin}-${c.stats.spdMax}）` });
      return finish();
    }
    // 群体100%真实伤害：每有一个敌方单位比自身行动慢则多攻击一次（虚化弹窗：接受后仅面具男免疫自身）
    const mySpd = effSpd(c).max;
    let slower = 0;
    for (const a of alive(ns.allies)) if (effSpd(a).max < mySpd) slower++;
    const hits = 1 + slower;
    if (applySpecialAoeKamui(ns, c)) return finish();
    for (let i = 0; i < hits; i++) {
      for (const a of alive(ns.allies)) {
        if (a.uid === ns.kamuiAoeImmunity) continue;
        damageFlat(ns, a.uid, Math.ceil(effAtk(c) * 1.0), 'true', c);
      }
      c.stats.spdMin += 1; c.stats.spdMax += 1;
    }
    ns.kamuiAoeImmunity = undefined;
    addLog(ns, { t: 'info', text: `【${c.name}】群体真实伤害×${hits}（${slower}个敌方单位比自身慢），每段后速度+1（当前${c.stats.spdMin}-${c.stats.spdMax}）` });
    return finish();
  }

  // 煌雷龙
  if (c.monsterId === 'ct_037') {
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.huanglei) c.crisis.huanglei = { burst70: false, burst40: false };
    const hl = c.crisis.huanglei;
    const hpRatio = c.hp / c.maxHp;
    // 虚化检查：煌雷龙的攻击可被面具男虚化打断
    if (specialAttackKamui(ns, c)) return finish();
    const t = randAlly();
    // HP<40% 时优先触发第二档群体150%法术（未触发过）（虚化弹窗：接受后仅面具男免疫自身）
    if (!hl.burst40 && hpRatio < 0.4) {
      if (applySpecialAoeKamui(ns, c)) return finish();
      for (const a of alive(ns.allies)) {
        if (a.uid === ns.kamuiAoeImmunity) continue;
        damageOne(ns, c, a.uid, 1.5, 'magical', { isAoe: true });
      }
      ns.kamuiAoeImmunity = undefined;
      hl.burst40 = true;
      addLog(ns, { t: 'info', text: `【${c.name}】HP低于40%，释放群体雷电` });
      return finish();
    }
    // HP<70% 时触发第一档群体150%法术（未触发过）（虚化弹窗：接受后仅面具男免疫自身）
    if (!hl.burst70 && hpRatio < 0.7) {
      if (applySpecialAoeKamui(ns, c)) return finish();
      for (const a of alive(ns.allies)) {
        if (a.uid === ns.kamuiAoeImmunity) continue;
        damageOne(ns, c, a.uid, 1.5, 'magical', { isAoe: true });
      }
      ns.kamuiAoeImmunity = undefined;
      hl.burst70 = true;
      addLog(ns, { t: 'info', text: `【${c.name}】HP低于70%，释放群体雷电` });
      return finish();
    }
    if (t) damageOne(ns, c, t.uid, 1, 'physical');
    return finish();
  }

  // 全开畸变杰克：自适应 + 每次攻击+10 + 两段80%
  if (c.monsterId === 'ct_075') {
    // 虚化检查：全开畸变杰克的攻击可被面具男虚化打断
    if (specialAttackKamui(ns, c)) return finish();
    const t = randAlly();
    if (t) {
      for (let i = 0; i < 2; i++) {
        if (!t.alive) break;
        const phys = calcDamage(c, t, 0.8, 'physical');
        const mag = calcDamage(c, t, 0.8, 'magical');
        const useType = phys >= mag ? 'physical' : 'magical';
        applyDamage(ns, t, Math.max(phys, mag), useType, c);
      }
      c.stats.atk += 10;
      addLog(ns, { t: 'info', text: `【${c.name}】攻击力+10（当前${c.stats.atk}）` });
    }
    return finish();
  }

  return null;
}

// 特殊直伤分支的虚化前置：任何可虚化的友方（面具男）满足条件时弹出虚化选择。
// 特殊 AI 分支（召唤/无敌类怪物）直接调用 damageOne 造成伤害，绕过了普通攻击路径的
// findReaction 检查点，因此攻击前必须手动接入虚化判定。
// 返回 true 表示本次行动被虚化打断（等待玩家选择）；拒绝虚化后的重放通过 ns.replaySpecial 跳过本检查。
// evadedStep：双槽单位（肉山）传入被打断的行动步，接受虚化后由 resolveReaction 写回作废标记。
function specialAttackKamui(ns: BattleState, attacker: Combatant, evadedStep?: number): boolean {
  if (ns.replaySpecial) {
    ns.replaySpecial = undefined;
    return false;
  }
  const kam = findKamuiReaction(ns, attacker, undefined);
  if (kam) {
    ns.pendingReaction = { ...kam, action: { kind: 'special', targetUid: kam.targetUid, evadedStep } };
    return true;
  }
  return false;
}

// 群体攻击的虚化前置：与 specialAttackKamui 相同，但接受后语义不同——
// 群体行动会重放（队友照常承伤），仅面具男自身免疫（kamuiAoeImmunity 标记）。
// 返回 true 表示本次群体行动被虚化弹窗打断（接受/拒绝后由 resolveReaction + 重放继续）。
function applySpecialAoeKamui(ns: BattleState, attacker: Combatant): boolean {
  if (ns.replaySpecial) {
    ns.replaySpecial = undefined;
    return false;
  }
  const kam = findKamuiReaction(ns, attacker, undefined);
  if (kam) {
    ns.pendingReaction = { ...kam, action: { kind: 'special', targetUid: kam.targetUid, aoeKamui: true } };
    return true;
  }
  return false;
}

// ===== 里恩 · 神谕代行者机制 =====
const SIX_STAT_KEYS = ['str', 'int', 'agi', 'wil', 'luk', 'cha'] as const;

// 里恩职业判定（Combatant 无 job 字段，用一技能存在性判断）
function isRein(c: Combatant): boolean {
  return c.skills.some((sk) => sk.id === 'sk_rein_variable');
}

// 随机六维：心-命运时取六维最高值
function randomSix(c: Combatant, rng: Rng = mathRng): number {
  if (c.reinHeartFate) {
    return Math.max(c.str ?? 0, c.int ?? 0, c.agi ?? 0, c.wil ?? 0, c.luk ?? 0, c.cha ?? 0);
  }
  const key = SIX_STAT_KEYS[rng.int(0, SIX_STAT_KEYS.length - 1)];
  return c[key] ?? 0;
}

// 回合开始：心-命运MP回复 + 随机指令标（技能变体 + 敌方目标，多部位随机一个、不指定无敌目标）
function applyReinTurnStart(ns: BattleState, c: Combatant, rng: Rng = mathRng): void {
  if (!c.reinOracle) return;
  const oracle = c.skills.find((sk) => sk.id === 'sk_rein_oracle')?.reinOracle;
  if (!oracle) return;
  if (c.reinHeartFate && c.mp < c.maxMp) {
    const gain = Math.min(c.maxMp, c.mp + (oracle.fateMpPerTurn ?? 10)) - c.mp;
    if (gain > 0) {
      c.mp += gain;
      addLog(ns, { t: 'info', text: `【${c.name}】心-命运：每回合恢复 ${gain} MP` });
    }
  }
  const variants = c.skills.find((sk) => sk.id === 'sk_rein_variable')?.variants;
  if (variants && variants.length > 0) {
    c.reinOracle.markedVariantId = variants[rng.int(0, variants.length - 1)].id;
  }
  const targets = alive(ns.enemies).filter((e) => !isUntargetableInvincible(e));
  if (targets.length > 0) {
    c.reinOracle.markedTargetUid = targets[rng.int(0, targets.length - 1)].uid;
  }
  const vName = variants?.find((v) => v.id === c.reinOracle?.markedVariantId)?.name ?? '无';
  const tName = c.reinOracle.markedTargetUid ? (byUid(ns, c.reinOracle.markedTargetUid)?.name ?? '无') : '无';
  addLog(ns, { t: 'info', text: `【${c.name}】神谕降下指令标：「${vName}」→ ${tName}` });
}

// 行动后：代行层数结算（使用带指令标变体+1 / 选择带指令标目标+1 / 都满足+3；均不满足→1层「业」，上限5层）
function applyReinOracleAction(ns: BattleState, c: Combatant, action: PlayerAction): void {
  if (!c.reinOracle) return;
  const oracle = c.skills.find((sk) => sk.id === 'sk_rein_oracle')?.reinOracle;
  if (!oracle) return;
  let usedMarked = false;
  let hitMarked = false;
  if (action.type === 'skill') {
    if (action.variantId) usedMarked = action.variantId === c.reinOracle.markedVariantId;
    if (action.targetUid) hitMarked = action.targetUid === c.reinOracle.markedTargetUid;
  }
  let gained = 0;
  if (usedMarked && hitMarked) gained = 3;
  else if (usedMarked || hitMarked) gained = 1;
  if (gained > 0) {
    c.reinOracle.stacks = Math.min(c.reinOracle.stacks + gained, oracle.maxStacks ?? 12);
    addLog(ns, { t: 'info', text: `【${c.name}】代行-赫尔墨斯 +${gained}（当前 ${c.reinOracle.stacks}/${oracle.maxStacks ?? 12}）` });
  } else {
    const karma = c.buffs.find((b) => b.id === 'reinKarma');
    if ((karma?.stacks ?? 0) < (oracle.karmaMax ?? 5)) {
      const nb = addBuff(c, 'reinKarma', 1, 1);
      addLog(ns, { t: 'info', text: `【${c.name}】本次行动未获得代行-赫尔墨斯，获得1层「业」（${nb.stacks}/${oracle.karmaMax ?? 5}层）` });
    }
  }
}

// 解放：覆盖式（撤销旧档→施加新档）；解放II起切换为解放立绘；解放III+全能增伤
function applyReinLiberation(ns: BattleState, c: Combatant, oracle: NonNullable<Skill['reinOracle']>, tier: 1 | 2 | 3): void {
  const cur = c.reinOracle!;
  if (cur.liberation === tier) return;
  // 撤销旧档
  if (cur.sixApplied > 0) {
    for (const k of SIX_STAT_KEYS) c[k] = Math.max(0, (c[k] ?? 0) - cur.sixApplied);
    cur.sixApplied = 0;
  }
  if (cur.atkApplied > 0) {
    c.stats.atk = Math.max(0, c.stats.atk - cur.atkApplied);
    cur.atkApplied = 0;
  }
  if (cur.ampApplied > 0) {
    c.reinLiberationAmp = Math.max(0, (c.reinLiberationAmp ?? 0) - cur.ampApplied);
    cur.ampApplied = 0;
  }
  // 施加新档
  const six = tier === 1 ? oracle.freedomISix : tier === 2 ? oracle.freedomIISix : oracle.freedomIIISix;
  for (const k of SIX_STAT_KEYS) c[k] = (c[k] ?? 0) + six;
  cur.sixApplied = six;
  let atkGain = 0;
  if (tier >= 2) {
    atkGain = Math.floor((c.charLevel ?? 1) * (oracle.freedomIIAtkPerLv ?? 1));
    c.stats.atk += atkGain;
    cur.atkApplied = atkGain;
    // 解放II起：切换为里恩解放立绘
    c.icon = JOB_IMAGES.reinLiberation;
    // 仅在解放II时播放「里恩形态切换.mp4」动画（解放III立绘不变，不再重复播放）
    if (tier === 2) addLog(ns, { t: 'vfx', uid: c.uid, kind: 'reinLibSwitch' });
  }
  if (tier >= 3) {
    c.reinLiberationAmp = oracle.freedomIIIAllAmp ?? 0;
    cur.ampApplied = oracle.freedomIIIAllAmp ?? 0;
  }
  cur.liberation = tier;
  c.buffs = c.buffs.filter((b) => b.id !== 'reinLiberation');
  addBuff(c, 'reinLiberation', 1, tier);
  const word = tier === 1 ? '无我梦中' : tier === 2 ? '阿鼻叫唤' : '支离灭裂';
  const rom = tier === 1 ? 'I' : tier === 2 ? 'II' : 'III';
  addLog(ns, { t: 'vfx', uid: c.uid, kind: `reinLib${tier}` });
  addLog(ns, { t: 'info', text: `【${c.name}】代行-赫尔墨斯 解放${rom}！——「${word}」六维+${six}${tier >= 2 ? `，攻击+${atkGain}` : ''}${tier >= 3 ? `，全能增伤+${Math.round((oracle.freedomIIIAllAmp ?? 0) * 100)}%` : ''}` });
}

// 心-命运：速度+，一技能按最高六维，每回合MP+10（BUFF记录，不飘字）
function applyReinHeartFate(ns: BattleState, c: Combatant, oracle: NonNullable<Skill['reinOracle']>): void {
  if (c.reinHeartFate) return;
  c.reinHeartFate = true;
  c.stats.spdMin = Math.max(1, c.stats.spdMin + (oracle.fateSpd ?? 3));
  c.stats.spdMax = Math.max(1, c.stats.spdMax + (oracle.fateSpd ?? 3));
  c.buffs = c.buffs.filter((b) => b.id !== 'reinHeart');
  addBuff(c, 'reinHeart', 1, 1);
  addLog(ns, { t: 'info', text: `【${c.name}】心-命运觉醒：速度+${oracle.fateSpd ?? 3}，一技能按最高六维计算，每回合MP+${oracle.fateMpPerTurn ?? 10}` });
}

// 行动后：代行层数达到 3/6/9/12 立即获得解放（覆盖式），12层同时觉醒心-命运
function applyReinLiberationCheck(ns: BattleState, c: Combatant): void {
  if (!c.reinOracle || c.reinHeartFate) return;
  const oracle = c.skills.find((sk) => sk.id === 'sk_rein_oracle')?.reinOracle;
  if (!oracle) return;
  const st = c.reinOracle.stacks;
  if (st >= 12) {
    if (c.reinOracle.liberation < 3) applyReinLiberation(ns, c, oracle, 3);
    applyReinHeartFate(ns, c, oracle);
  } else if (st >= 9 && c.reinOracle.liberation < 3) {
    applyReinLiberation(ns, c, oracle, 3);
  } else if (st >= 6 && c.reinOracle.liberation < 2) {
    applyReinLiberation(ns, c, oracle, 2);
  } else if (st >= 3 && c.reinOracle.liberation < 1) {
    applyReinLiberation(ns, c, oracle, 1);
  }
}

// 回合末：假面→伤口切换（摘面具）。解放结算已移至行动后（applyReinLiberationCheck）
function applyReinEndTurn(ns: BattleState, c: Combatant): void {
  if (!c.alive || !isRein(c)) return;
  // 假面 → 灼烧着的伤口
  const mask = c.skills.find((sk) => sk.id === 'sk_rein_mask')?.reinMask;
  if (mask && !c.buffs.some((b) => b.id === 'reinWound') && c.buffs.some((b) => b.id === 'reinMask') && c.hp < c.maxHp * mask.woundThreshold) {
    c.buffs = c.buffs.filter((b) => b.id !== 'reinMask');
    addBuff(c, 'reinWound', 1, mask.woundDmgRed);
    const spdGain = Math.floor((c.charLevel ?? 1) / 10);
    if (spdGain > 0) {
      c.stats.spdMin = Math.max(1, c.stats.spdMin + spdGain);
      c.stats.spdMax = Math.max(1, c.stats.spdMax + spdGain);
    }
    const atkGain = c.charLevel ?? 1;
    c.stats.atk += atkGain;
    addLog(ns, { t: 'vfx', uid: c.uid, kind: 'reinMaskGif' });
    addLog(ns, { t: 'info', text: `【${c.name}】假面落下——「灼烧着的伤口」：全能减伤+${Math.round(mask.woundDmgRed * 100)}%，速度+${spdGain}，攻击+${atkGain}` });
  }
}

// ---------- 敌方行动 ----------
export function enemyAct(
  s: BattleState,
  rng: Rng = mathRng,
): { state: BattleState; events: LogEntry[] } {
  if (s.result) return { state: s, events: [] };
  const ns = structuredClone(s);
  const c = currentActor(ns);
  if (c.side !== 'enemy' || !c.alive) return { state: s, events: [] };
  const start = ns.log.length;

  // 冷却以该单位行动次数计：行动开始时全部 -1
  for (const k of Object.keys(c.cooldowns)) {
    if (c.cooldowns[k] > 0) c.cooldowns[k] -= 1;
  }

  // 落雷：不攻击（回合末自爆）
  if (c.monsterId === 'luolei') {
    postEnemyAction(ns, c);
    checkResult(ns);
    return { state: ns, events: ns.log.slice(start) };
  }

  // 融合暗精灵僵尸：仍有其他友方存活时无法行动
  if (c.invincibleWhileAllies) {
    const otherAlive = ns.enemies.some((a) => a.alive && a.uid !== c.uid);
    if (otherAlive) {
      addLog(ns, { t: 'info', text: `【${c.name}】有友方存活，无法行动` });
      postEnemyAction(ns, c);
      checkResult(ns);
      return { state: ns, events: ns.log.slice(start) };
    }
  }

  // BOSS 核心：首次低于阈值触发一次狂暴
  if (c.ai === 'boss' && !c.enraged && c.hp / c.maxHp <= BOSS_ENRAGE) {
    c.enraged = true;
    c.statuses.atkModPct += 30;
    addLog(ns, { t: 'info', text: `${c.name}进入狂暴状态，攻击力提升30%！` });
  }

  // 自定义狂暴（单体BOSS）：首次低于阈值触发一次性固定数值变化
  if (c.enrage && !c.enraged && c.hp / c.maxHp <= c.enrage.hpBelow) {
    c.enraged = true;
    const e = c.enrage;
    if (e.atk) c.stats.atk = Math.max(0, c.stats.atk + e.atk);
    if (e.def) c.stats.def = Math.max(0, c.stats.def + e.def);
    if (e.spd) {
      c.stats.spdMin = Math.max(0, c.stats.spdMin + e.spd);
      c.stats.spdMax = Math.max(0, c.stats.spdMax + e.spd);
    }
    if (e.defZero) c.stats.def = 0;
    if (e.mresZero) c.stats.mres = 0;
    const parts: string[] = [];
    if (e.spd) parts.push(`速度+${e.spd}`);
    if (e.atk) parts.push(`攻击力+${e.atk}`);
    if (e.def) parts.push(`防御${e.def > 0 ? '+' : ''}${e.def}`);
    if (e.defZero) parts.push('防御归0');
    if (e.mresZero) parts.push('法抗归0');
    addLog(ns, { t: 'info', text: `${c.name}进入狂暴状态，${parts.join('，')}！` });
  }

  // 危机合约：应龙——葬花针 + 逆鳞之祸（含全开应龙）
  if (c.monsterId === 'yingLong' || c.monsterId === 'ct_079') {
    const ccTerms = ns.crisisTermIds ?? [];
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.yinglong) {
      const isFullOpen = c.monsterId === 'ct_079';
      const startNeedle = isFullOpen || ccTerms.includes('e5_needle4') ? 4 : 2;
      c.crisis.yinglong = {
        needle: startNeedle,
        needleBaseAtk: c.stats.atk,
        needleBaseDef: c.stats.def,
        needleBaseMres: c.stats.mres,
        luoleiHp: isFullOpen || ccTerms.includes('e5_luolei500') ? 500 : 300,
      };
    }
    const yl = c.crisis.yinglong!;
    // 虚化检查：应龙（含全开）的攻击可被面具男虚化打断（打断后重放重新执行本行动）
    if (specialAttackKamui(ns, c)) {
      postEnemyAction(ns, c);
      checkResult(ns);
      return { state: ns, events: ns.log.slice(start) };
    }
    // 应用葬花针属性加成（从基数重算）：攻/防 +10% 每层，法抗 +5 每层，上限 6 层
    yl.needle = Math.min(6, Math.max(0, yl.needle));
    c.stats.atk = Math.floor(yl.needleBaseAtk! * (1 + 0.1 * yl.needle));
    c.stats.def = Math.floor(yl.needleBaseDef! * (1 + 0.1 * yl.needle));
    c.stats.mres = Math.min(90, (yl.needleBaseMres ?? 0) + 5 * yl.needle);
    syncNeedleBuff(c);
    addLog(ns, { t: 'info', text: `【${c.name}】葬花针 ${yl.needle} 层：攻+${yl.needle * 10}% 防+${yl.needle * 10}% 法抗+${yl.needle * 5}` });

    // 逆鳞之祸：每 5 回合（5/10/15）多段攻击
    if (ns.turn > 0 && ns.turn % 5 === 0) {
      const hits = yl.needle;
      const aliveAllies = alive(ns.allies);
      addLog(ns, { t: 'action', actorUid: c.uid, kind: 'attack', label: '逆鳞之祸', targetUids: aliveAllies.map((u) => u.uid) });
      for (let i = 0; i < hits; i++) {
        if (ns.result) break;
        const targets = alive(ns.allies);
        if (targets.length === 0) break;
        const t = targets[rng.int(0, targets.length - 1)];
        damageOne(ns, c, t.uid, 0.8, 'physical');
      }
      addLog(ns, { t: 'info', text: `【逆鳞之祸】${hits} 段 80% 攻击力物理伤害，葬花针重置为 1 层` });
      yl.needle = 1;
      syncNeedleBuff(c);
    } else {
      // 普通攻击
      const targets = alive(ns.allies);
      if (targets.length > 0) {
        const t = targets[rng.int(0, targets.length - 1)];
        addLog(ns, { t: 'action', actorUid: c.uid, kind: 'attack', label: '普攻', targetUids: [t.uid] });
        damageOne(ns, c, t.uid, 1, c.attackType);
      }
    }
    postEnemyAction(ns, c);
    checkResult(ns);
    return { state: ns, events: ns.log.slice(start) };
  }

  // 危机合约：冥王破天——单单位双行动槽（破天 + 冥王），每回合两个顺位条目速度独立（含全开冥王破天）
  if (c.monsterId === 'mingwangPotian' || c.monsterId === 'ct_076') {
    const ccTerms = ns.crisisTermIds ?? [];
    if (!c.crisis) c.crisis = {};
    if (!c.crisis.mingwang) {
      const baseSpd = c.monsterId === 'ct_076' ? 5 : (ccTerms.includes('e4_potianSpd5') ? 5 : 1);
      c.crisis.mingwang = { potianSpd: baseSpd, potianDmgThisTurn: 0 };
    }
    const mw = c.crisis.mingwang;
    // 受击加速：每回合首次行动时结算（破天速度），避免双槽重复结算
    if (mw.lastProcessedTurn !== ns.turn) {
      mw.lastProcessedTurn = ns.turn;
      if (mw.potianDmgThisTurn >= 100) {
        const gain = Math.floor(mw.potianDmgThisTurn / 100);
        mw.potianSpd += gain;
        const spdBuff = c.buffs.find((b) => b.id === 'potianSpd');
        if (spdBuff) spdBuff.stacks = mw.potianSpd;
        else c.buffs.push({ id: 'potianSpd', stacks: mw.potianSpd, intensity: 1 });
        addLog(ns, { t: 'info', text: `【破天】受击加速，速度提升至 ${mw.potianSpd}` });
      } else if (!c.buffs.find((b) => b.id === 'potianSpd')) {
        c.buffs.push({ id: 'potianSpd', stacks: mw.potianSpd, intensity: 1 });
      }
      mw.potianDmgThisTurn = 0;
    }

    const curSlot = slotOf(ns.order[ns.cursor]);

    // 虚化检查：冥王破天（含全开）的破天/冥王攻击可被面具男虚化打断
    if (specialAttackKamui(ns, c)) {
      postEnemyAction(ns, c);
      checkResult(ns);
      return { state: ns, events: ns.log.slice(start) };
    }

    if (curSlot === 'potian') {
      // ===== 破天行动槽：对敌方单人造成 (速度*10+70)% 攻击力物理伤害 =====
      const potianAllies = alive(ns.allies);
      if (potianAllies.length > 0 && !ns.result) {
        const target = potianAllies[rng.int(0, potianAllies.length - 1)];
        const potianMul = (mw.potianSpd * 10 + 70) / 100;
        addLog(ns, { t: 'action', actorUid: c.uid, kind: 'attack', label: '破天', targetUids: [target.uid] });
        damageOne(ns, c, target.uid, potianMul, 'physical');
        addLog(ns, { t: 'info', text: `【破天】对 ${target.name} 造成 ${Math.round(potianMul * 100)}% 攻击力物理伤害` });
      }
    } else {
      // ===== 冥王行动槽：对敌方单人造成 100% 物理 + 60% 法术伤害 =====
      const mingwangAllies = alive(ns.allies);
      if (mingwangAllies.length > 0 && !ns.result) {
        const target2 = mingwangAllies[rng.int(0, mingwangAllies.length - 1)];
        addLog(ns, { t: 'action', actorUid: c.uid, kind: 'attack', label: '冥王', targetUids: [target2.uid] });
        damageOne(ns, c, target2.uid, 1.0, 'physical');
        if (target2.alive) damageOne(ns, c, target2.uid, 0.6, 'magical');
        addLog(ns, { t: 'info', text: `【冥王】对 ${target2.name} 造成 100% 物理 + 60% 法术伤害` });
      }
      // 第 4/8/12 回合冥王行动后：获得 (层数+强度)*10 护盾并消除所有 BUFF
      if ([4, 8, 12].includes(ns.turn)) {
        let shieldGain = 0;
        for (const b of c.buffs) {
          shieldGain += (b.stacks + b.intensity) * 10;
        }
        if (c.monsterId === 'ct_076' || ccTerms.includes('e4_shield20')) shieldGain = 20;
        if (shieldGain > 0) {
          c.shield += shieldGain;
          addLog(ns, { t: 'info', text: `【冥王破天】第 ${ns.turn} 回合获得 ${shieldGain} 点护盾并清除所有增益` });
          c.buffs = c.buffs.filter((b) => b.id === 'potianSpd'); // 保留破天速度永久BUFF
        }
      }
    }
    postEnemyAction(ns, c);
    checkResult(ns);
    return { state: ns, events: ns.log.slice(start) };
  }

  // 危机合约：鼠鼠——不攻击，恢复全体友方 healPct 最大生命
  if (c.crisis?.supportHealer) {
    const healPct = c.crisis.supportHealer.healPct;
    const allies = alive(ns.enemies).filter((u) => u.uid !== c.uid);
    for (const a of allies) {
      const heal = Math.floor(a.maxHp * healPct);
      a.hp = Math.min(a.maxHp, a.hp + heal);
    }
    addLog(ns, { t: 'info', text: `【${c.name}】治疗全体友方 ${Math.round(healPct * 100)}% 最大生命` });
    postEnemyAction(ns, c);
    checkResult(ns);
    return { state: ns, events: ns.log.slice(start) };
  }

  // ===== 灾厄 BOSS 行动逻辑 =====
  const bossAction = bossAct(ns, c, rng, start);
  if (bossAction) return bossAction;

  const decision = decideEnemy(ns, c, rng);

  // 反应式技能：行动命中带反应技能的我方、且减益未满层时暂停，等待玩家弹窗选择
  const reaction = findReaction(ns, c, decision);
  if (reaction) {
    ns.pendingReaction = reaction;
    return { state: ns, events: ns.log.slice(start) };
  }

  executeDecision(ns, c, decision);
  // 破碎方舟抉择暂停：跳过行动后处理，等待玩家选择
  if (ns.pendingBrokenArk) {
    return { state: ns, events: ns.log.slice(start) };
  }
  postEnemyAction(ns, c);

  checkResult(ns);
  return { state: ns, events: ns.log.slice(start) };
}

// ---------- 反应式技能（受击前哈气 / 虚化）----------
// 敌方行动已决策但未执行：若命中携带反应技能的我方，返回暂停态
// - debuff 模式（哈气）：蓝量足够且减益未满层
// - kamui 模式（虚化）：蓝量足够且本回合虚化次数剩余，且攻击者顺位在自身之后
// 特殊AI直伤分支（克苏鲁之脑/腐巢意志本体等）不走 decideEnemy，无法复用 findReaction，
// 这里单独提供仅虚化检查：命中后闪避整个行动（行动作废）。
function findKamuiReaction(
  s: BattleState,
  attacker: Combatant,
  targetUid: string | undefined,
): PendingReaction | null {
  const candidates = targetUid ? [byUid(s, targetUid)] : alive(s.allies);
  for (const t of candidates) {
    if (!t || !t.alive || t.side !== 'ally') continue;
    const rsk = t.skills.find((sk) => sk.kind === 'reaction' && sk.reaction?.mode === 'kamui');
    if (!rsk?.reaction || t.mp < rsk.mpCost) continue;
    if ((t.kamuiUses ?? 0) <= 0) continue;
    // 顺位判定需兼容双槽单位（order 条目带 #act1/#act2 后缀），用 stripSlotUid 匹配真实单位
    const atkIdx = s.order.findIndex((u) => stripSlotUid(u) === attacker.uid);
    const tgtIdx = s.order.findIndex((u) => stripSlotUid(u) === t.uid);
    if (atkIdx <= tgtIdx) continue;
    return {
      attackerUid: attacker.uid,
      targetUid: t.uid,
      skillId: rsk.id,
      action: { kind: 'special', targetUid: targetUid ?? t.uid },
    };
  }
  return null;
}

function findReaction(
  s: BattleState,
  attacker: Combatant,
  d: EnemyDecision,
): PendingReaction | null {
  const directUid = d.type === 'attack' ? d.targetUid : d.targetUid;
  const candidates = directUid ? [byUid(s, directUid)] : alive(s.allies);
  for (const t of candidates) {
    if (!t || !t.alive || t.side !== 'ally') continue;
    const rsk = t.skills.find((sk) => sk.kind === 'reaction' && !!sk.reaction);
    if (!rsk?.reaction || t.mp < rsk.mpCost) continue;
    const rx = rsk.reaction;
    if (rx.mode === 'kamui') {
      // 虚化：需要剩余次数，且攻击者顺位在自身之后（顺位判定兼容双槽后缀）
      if ((t.kamuiUses ?? 0) <= 0) continue;
      const atkIdx = s.order.findIndex((u) => stripSlotUid(u) === attacker.uid);
      const tgtIdx = s.order.findIndex((u) => stripSlotUid(u) === t.uid);
      if (atkIdx <= tgtIdx) continue;
    } else {
      // 哈气：减益未满层
      const cur = attacker.buffs.find((b) => b.id === rx.buffId)?.stacks ?? 0;
      if (cur >= (rx.maxStacks ?? 1)) continue;
    }
    return {
      attackerUid: attacker.uid,
      targetUid: t.uid,
      skillId: rsk.id,
      action: d.type === 'attack'
        ? { kind: 'attack', targetUid: d.targetUid }
        : { kind: 'skill', skillId: d.skillId, targetUid: d.targetUid },
    };
  }
  return null;
}

// 执行敌方已决策的行动（普攻 / 技能）
function executeDecision(s: BattleState, c: Combatant, d: EnemyDecision): void {
  if (d.type === 'attack') {
    basicAttack(s, c, d.targetUid);
    return;
  }
  const sk = c.skills.find((x) => x.id === d.skillId);
  if (!sk) return;
  castSkill(s, c, sk, d.targetUid);
  if (sk.cooldown) c.cooldowns[sk.id] = sk.cooldown;
}

// 敌方行动后的机制：血腥祭坛行动后回复 / 腐化祭坛减我方攻防
function postEnemyAction(s: BattleState, c: Combatant, rng: Rng = mathRng): void {
  // 恶魔祭坛·血腥 / 猩红祭坛：敌方行动后恢复最大生命百分比
  if (c.alive && c.postActionHealPct && c.postActionHealPct > 0) {
    const heal = Math.ceil(c.maxHp * c.postActionHealPct);
    if (heal > 0 && c.hp < c.maxHp) {
      const gain = Math.min(heal, c.maxHp - c.hp);
      c.hp += gain;
      addLog(s, { t: 'heal', targetUid: c.uid, amount: gain });
    }
  }
  // 腐化祭坛：随机减少我方一名存活单位5攻击或5防御
  if (c.alive && c.postActionDebuffAlly) {
    const allies = s.allies.filter((a) => a.alive);
    if (allies.length > 0) {
      const target = allies[rng.int(0, allies.length - 1)];
      const atkOrDef = rng.int(0, 1) === 0 ? 'atk' : 'def';
      if (atkOrDef === 'atk') {
        target.stats.atk = Math.max(0, target.stats.atk - 5);
        addLog(s, { t: 'info', text: `【腐化祭坛】${target.name} 攻击力 -5` });
      } else {
        target.stats.def = Math.max(0, target.stats.def - 5);
        addLog(s, { t: 'info', text: `【腐化祭坛】${target.name} 防御力 -5` });
      }
    }
  }
}

// 玩家对反应弹窗做出选择：accept=true 时耗蓝对攻击来源施加减益（钳制层数上限），
// 然后继续执行被暂停的敌方行动；accept=false 时直接继续，不耗蓝。
export function resolveReaction(
  s: BattleState,
  accept: boolean,
): { state: BattleState; events: LogEntry[] } {
  const pr = s.pendingReaction;
  if (!pr) return { state: s, events: [] };
  const ns = structuredClone(s);
  const start = ns.log.length;
  const p = ns.pendingReaction!;
  const attacker = byUid(ns, p.attackerUid);
  const target = byUid(ns, p.targetUid);
  const rsk = target.skills.find((x) => x.id === p.skillId);
  const rx = rsk?.reaction;
  if (accept && rx && attacker.alive && target.alive && target.mp >= rsk!.mpCost) {
    if (rx.mode === 'kamui') {
      // 虚化：消耗MP与次数，无效化攻击，自身获得强壮
      if ((target.kamuiUses ?? 0) > 0) {
        target.mp = Math.max(0, target.mp - rsk!.mpCost);
        target.kamuiUses = Math.max(0, (target.kamuiUses ?? 0) - 1);
        // 特殊AI直伤 + 群体攻击（aoeKamui）：接受后行动重放（队友照常承伤），仅面具男自身免疫
        if (p.action.kind === 'special' && p.action.aoeKamui) {
          ns.kamuiAoeImmunity = target.uid;
          ns.replaySpecial = true;
        } else if (p.action.kind === 'special' && p.action.evadedStep !== undefined) {
          // 特殊AI直伤 + 双槽单位（肉山）：记录被闪避的行动步，使下一行动槽跳过该行动
          const foe = byUid(ns, p.attackerUid);
          const wf = foe.crisis?.wallOfFlesh;
          if (wf) wf.lastEvaded = p.action.evadedStep;
        }
        const selfBuffId = rx.selfBuffId ?? 'strength';
        const stacks = rx.selfBuffStacks ?? 2;
        let intensity = rx.minIntensity ?? 1;
        if (rx.intensityFromSpdDiff) {
          // 强度 = 双方当前速度差值（本回合速度掷点，缺省取最大速度）
          const targetSpd = target.roll ?? effSpd(target).max;
          const attackerSpd = attacker.roll ?? effSpd(attacker).max;
          const diff = Math.abs(targetSpd - attackerSpd);
          intensity = Math.max(intensity, diff);
        }
        // 强度+1模式：叠加时强度在原有基础上+1（而非取较大值）
        const intensityMode = rx.selfBuffIntensityAddOne ? 'add' : 'max';
        const addIntensity = rx.selfBuffIntensityAddOne ? 1 : intensity;
        const b = addBuff(target, selfBuffId, stacks, addIntensity, undefined, intensityMode);
        addLog(ns, { t: 'buff', uid: target.uid, buffId: selfBuffId, stacks: b.stacks, intensity: b.intensity, applied: true });
        addLog(ns, { t: 'info', text: `【虚化】${target.name} 闪避了 ${attacker.name} 的攻击！自身强壮+${stacks}层（强度${b.intensity}）` });
        addLog(ns, { t: 'vfx', uid: target.uid, kind: 'masked-kamui' });
        ns.pendingReaction = undefined;
        checkResult(ns);
        return { state: ns, events: ns.log.slice(start) };
      }
    } else {
      // 哈气：施加减益
      const cur = attacker.buffs.find((b) => b.id === rx.buffId)?.stacks ?? 0;
      if (cur < (rx.maxStacks ?? 1)) {
        target.mp = Math.max(0, target.mp - rsk!.mpCost);
        const intensity = rx.intensity ?? 1;
        const b = addBuff(attacker, rx.buffId!, 1, intensity);
        addLog(ns, {
          t: 'buff', uid: attacker.uid, buffId: rx.buffId!,
          stacks: b.stacks, intensity: b.intensity, applied: true,
        });
      }
    }
  }
  ns.pendingReaction = undefined;
  // 特殊AI直伤分支：玩家拒绝虚化（accept=false）后行动作废，标记由调用方重新执行 enemyAct
  if (p.action.kind === 'special' && !accept) ns.replaySpecial = true;
  if (!ns.result && p.action.kind !== 'special') {
    const decision: EnemyDecision = p.action.kind === 'attack'
      ? { type: 'attack', targetUid: p.action.targetUid }
      : { type: 'skill', skillId: p.action.skillId, targetUid: p.action.targetUid };
    executeDecision(ns, attacker, decision);
    // 破碎方舟抉择暂停：跳过行动后处理，等待玩家选择
    if (!ns.pendingBrokenArk) {
      postEnemyAction(ns, attacker);
      checkResult(ns);
    }
  }
  return { state: ns, events: ns.log.slice(start) };
}

// ---------- 破碎方舟受击抉择 ----------
// 玩家选择是否消耗MP抵消伤害并获得强壮
export function resolveBrokenArk(
  s: BattleState,
  accept: boolean,
): { state: BattleState; events: LogEntry[] } {
  const pb = s.pendingBrokenArk;
  if (!pb) return { state: s, events: [] };
  const ns = structuredClone(s);
  const start = ns.log.length;
  const p = ns.pendingBrokenArk!;
  const target = byUid(ns, p.targetUid);
  const attacker = p.attackerUid ? byUid(ns, p.attackerUid) : undefined;
  const ba = target?.weaponBrokenArk;
  let finalToHp = p.toHp;
  if (accept && ba && target.alive && target.mp >= ba.mpCost) {
    target.mp -= ba.mpCost;
    finalToHp = Math.floor(p.toHp * (1 - ba.dmgRedPct));
    // 强壮强度固定为 ba.buffIntensity（不叠加），仅层数（剩余回合）累加
    const existing = target.buffs.find((b) => b.id === 'strength');
    if (existing) {
      existing.stacks += ba.buffStacks;
      existing.intensity = Math.max(existing.intensity, ba.buffIntensity);
    } else {
      addBuff(target, 'strength', ba.buffStacks, ba.buffIntensity, target.uid);
    }
    addLog(ns, { t: 'info', text: `【破碎方舟】${target.name} 消耗${ba.mpCost}MP抵消${Math.round(ba.dmgRedPct * 100)}%伤害（${p.toHp}→${finalToHp}），获得${ba.buffStacks}层强壮${ba.buffIntensity}` });
  } else if (!accept) {
    addLog(ns, { t: 'info', text: `【破碎方舟】${target?.name} 放弃抵消，承受 ${p.toHp} 点伤害` });
  }
  ns.pendingBrokenArk = undefined;
  if (target?.alive) {
    applyHpDamage(ns, target, finalToHp, p.damageType, attacker, p.blocked);
  }
  // 继续敌方行动后处理
  const enemyActor = currentActor(ns);
  if (enemyActor?.side === 'enemy' && enemyActor.alive) {
    postEnemyAction(ns, enemyActor);
  }
  checkResult(ns);
  return { state: ns, events: ns.log.slice(start) };
}

// ---------- 抢商店BOSS战：奇数回合抉择 ----------
export const ROB_SEDUCE_THRESHOLD = 60; // 勾引魅力判定阈值（魅力 + 1D50 ≥ 60）
export const ROB_SEDUCE_DAMAGE = 300; // 勾引成功造成的真实伤害

export type RobChoice =
  | { kind: 'worship' } // 膜拜：防御/法抗减半两回合
  | { kind: 'seduce'; cha: number } // 勾引：魅力判定，成功造成真实伤害
  | { kind: 'coins'; amount: number }; // 拿钱砸：本回合削减攻击力

// 处理玩家抉择：apply 效果并清 pendingChoice（仿 resolveReaction 模式，战斗暂停后由 UI 调用）
export function resolveRobChoice(
  s: BattleState,
  choice: RobChoice,
  rng: Rng = mathRng,
): { state: BattleState; events: LogEntry[] } {
  const pr = s.pendingChoice;
  if (!pr) return { state: s, events: [] };
  const ns = structuredClone(s);
  const start = ns.log.length;
  const target = ns.enemies.find((e) => e.alive && e.monsterId === 'yuanShao')
    ?? ns.enemies.find((e) => e.alive);
  if (choice.kind === 'worship') {
    if (target) {
      const b = addBuff(target, 'worship', 2, 1);
      addLog(ns, { t: 'buff', uid: target.uid, buffId: 'worship', stacks: b.stacks, intensity: b.intensity, applied: true });
      addLog(ns, { t: 'info', text: `【${target.name}】受宠若惊，防御与法抗减半两回合` });
    }
  } else if (choice.kind === 'seduce') {
    if (target) {
      const chk = statCheck(choice.cha, ROB_SEDUCE_THRESHOLD, rng);
      if (chk.pass) {
        damageFlat(ns, target.uid, ROB_SEDUCE_DAMAGE, 'true');
        addLog(ns, { t: 'info', text: `魅力判定成功（${chk.total} ≥ ${ROB_SEDUCE_THRESHOLD}），${target.name} 心花怒放，受到 ${ROB_SEDUCE_DAMAGE} 点真实伤害` });
      } else {
        addLog(ns, { t: 'info', text: `魅力判定失败（${chk.total} < ${ROB_SEDUCE_THRESHOLD}），${target.name} 不为所动` });
      }
    }
  } else {
    if (target) {
      const cut = Math.floor(choice.amount / 100);
      target.atkCut = cut;
      target.stats.atk = Math.max(0, target.stats.atk - cut);
      addLog(ns, { t: 'info', text: `砸出 ${choice.amount} 哈哈币，${target.name} 本回合攻击力-${cut}` });
    }
  }
  ns.pendingChoice = undefined;
  return { state: ns, events: ns.log.slice(start) };
}

// 处理小李八门遁甲抉择：接受则叠加1层（+1最大速度、+等级/2攻击力）
export function resolveGatesChoice(
  s: BattleState,
  accept: boolean,
): { state: BattleState; events: LogEntry[] } {
  const pr = s.pendingGatesChoice;
  if (!pr) return { state: s, events: [] };
  const ns = structuredClone(s);
  const start = ns.log.length;
  const u = byUid(ns, pr.uid);
  if (accept && u && u.eightGatesMax !== undefined && (u.eightGates ?? 0) < u.eightGatesMax) {
    u.eightGates = (u.eightGates ?? 0) + 1;
    u.stats.spdMax += 1;
    const atkGain = u.eightGatesAtkPerLayer ?? Math.floor((u.charLevel ?? 1) / 2);
    u.stats.atk += atkGain;
    addLog(ns, { t: 'info', text: `【${u.name}】开启八门遁甲第 ${u.eightGates} 门！最大速度+1，攻击力+${atkGain}` });
    // 瞬风：八门遁甲后对全体敌方叠加木叶印记
    applyLeeWindPassive(ns, u, u.uid, true);
  } else if (u) {
    addLog(ns, { t: 'info', text: `【${u.name}】选择不开启八门遁甲` });
  }
  ns.pendingGatesChoice = undefined;
  return { state: ns, events: ns.log.slice(start) };
}

// 凯隐：开局选择红/蓝形态
export function resolveKaynForm(
  s: BattleState,
  form: 'red' | 'blue',
): { state: BattleState; events: LogEntry[] } {
  const pr = s.pendingKaynForm;
  if (!pr) return { state: s, events: [] };
  const ns = structuredClone(s);
  const start = ns.log.length;
  const u = byUid(ns, pr.uid);
  if (u) {
    u.form = form;
    addLog(ns, { t: 'info', text: `【${u.name}】选择${form === 'red' ? '红' : '蓝'}形态` });
    addLog(ns, { t: 'vfx', uid: u.uid, kind: form === 'red' ? 'kayn-form-red' : 'kayn-form-blue' });
  }
  ns.pendingKaynForm = undefined;
  return { state: ns, events: ns.log.slice(start) };
}

// 爱弥斯：回合末聚爆引爆后，玩家选择是否消耗10MP切换形态
export function resolveEimisFormSwitch(
  s: BattleState,
  accept: boolean,
): { state: BattleState; events: LogEntry[] } {
  const pr = s.pendingEimisFormSwitch;
  if (!pr) return { state: s, events: [] };
  const ns = structuredClone(s);
  const start = ns.log.length;
  const u = byUid(ns, pr.uid);
  if (u && u.alive) {
    if (accept && u.mp >= 10) {
      u.mp -= 10;
      // 切换形态（回合末触发，获得同步率）
      doEimisFormSwitch(ns, u, true);
      // 给敌方全体施加 floor(等级/10) 层聚爆
      const voyage = u.skills.find((sk) => sk.eimisHumanChaGain);
      if (voyage) {
        const stacks = Math.floor((u.charLevel ?? 1) / 10);
        if (stacks > 0) {
          const enemies = alive(u.side === 'ally' ? ns.enemies : ns.allies);
          for (const e of enemies) {
            applyImplosionStacks(ns, u, e.uid, stacks);
          }
          if (enemies.length > 0) {
            addLog(ns, { t: 'info', text: `【共赴长航】${u.name} 对敌方全体施加 ${stacks} 层聚爆` });
          }
        }
      }
    } else {
      addLog(ns, { t: 'info', text: `【共赴长航】${u.name} 选择不切换形态` });
    }
    u.eimisDetonatedThisTurn = false;
  }
  ns.pendingEimisFormSwitch = undefined;
  // 进入新回合：直接推进回合号并运行回合开始流水线，避免重复结算回合末效果
  for (const ally of ns.allies) {
    if (ally.eimisSyncMax !== undefined) ally.eimisDetonatedThisTurn = false;
  }
  ns.turn += 1;
  for (const a of ns.allies) a.invincibleThisTurn = false;
  // 第一回合攻击加成（全军出击/我已做好准备）统一由 runTurnStartPipeline 在 turn===2 时还原（atkPctBonus），
  // 此处不得直接覆盖 stats.atk（firstTurnAtkBase 存的是加成百分比而非基础攻击力）。
  // 速度掷点统一在 runTurnStartPipeline 内（速度修正后）执行，此处不再单独掷点。
  ns.turnStartStep = 0;
  ns.cursor = -1;
  if (runTurnStartPipeline(ns, mathRng)) return { state: ns, events: ns.log.slice(start) };
  ns.turnStartStep = undefined;
  // 找到第一个存活单位作为当前行动者
  let cursor = 0;
  while (cursor < ns.order.length) {
    const u = byUid(ns, ns.order[cursor]);
    if (u && u.alive) break;
    cursor += 1;
  }
  ns.cursor = cursor;
  checkResult(ns);
  return { state: ns, events: ns.log.slice(start) };
}

// 危机合约应龙：触发六维判定弹窗（每回合开始调用）
function triggerYinglongCheck(ns: BattleState, yinglong: Combatant) {
  const ccTerms = ns.crisisTermIds ?? [];
  if (!yinglong.crisis) yinglong.crisis = {};
  if (!yinglong.crisis.yinglong) {
    yinglong.crisis.yinglong = {
      needle: (yinglong.monsterId === 'ct_079' || ccTerms.includes('e5_needle4')) ? 4 : 2,
      needleBaseAtk: yinglong.stats.atk,
      needleBaseDef: yinglong.stats.def,
      needleBaseMres: yinglong.stats.mres,
      luoleiHp: (yinglong.monsterId === 'ct_079' || ccTerms.includes('e5_luolei500')) ? 500 : 300,
    };
  }
  const yl = yinglong.crisis.yinglong;
  const needle = yl.needle;
  const target = 60 + needle * 5;
  const all: ('str' | 'int' | 'agi' | 'wil' | 'luk' | 'cha')[] = ['str', 'int', 'agi', 'wil', 'luk', 'cha'];
  const used = yl.usedStats ?? [];
  let available = all.filter((st) => !used.includes(st));
  if (available.length === 0) { available = all; yl.usedStats = []; }
  ns.yinglongCheck = { available, target, pending: true };
}

// 应龙：同步葬花针层数到 BUFF（用于 UI 显示）
function syncNeedleBuff(yinglong: Combatant) {
  const needle = yinglong.crisis?.yinglong?.needle ?? 0;
  const existing = yinglong.buffs.find((b) => b.id === 'needle');
  if (needle <= 0) {
    if (existing) yinglong.buffs = yinglong.buffs.filter((b) => b.id !== 'needle');
    return;
  }
  if (existing) {
    existing.stacks = needle;
  } else {
    yinglong.buffs.push({ id: 'needle', stacks: needle, intensity: 1 });
  }
}

// 危机合约应龙：解决六维判定
export function resolveYinglongCheck(
  s: BattleState,
  stat: 'str' | 'int' | 'agi' | 'wil' | 'luk' | 'cha',
  allyUid: string,
): { state: BattleState; events: LogEntry[] } {
  const yc = s.yinglongCheck;
  if (!yc || !yc.pending) return { state: s, events: [] };
  const ns = structuredClone(s);
  const start = ns.log.length;
  const yinglong = ns.enemies.find((e) => (e.monsterId === 'yingLong' || e.monsterId === 'ct_079') && e.alive);
  const ally = byUid(ns, allyUid);
  if (!yinglong || !ally) {
    ns.yinglongCheck = undefined;
    return { state: ns, events: ns.log.slice(start) };
  }
  const ccTerms = ns.crisisTermIds ?? [];
  // 兜底初始化：Battle.tsx 在开局弹窗时可能未初始化 crisis.yinglong
  if (!yinglong.crisis) yinglong.crisis = {};
  if (!yinglong.crisis.yinglong) {
    yinglong.crisis.yinglong = {
      needle: (yinglong.monsterId === 'ct_079' || ccTerms.includes('e5_needle4')) ? 4 : 2,
      needleBaseAtk: yinglong.stats.atk,
      needleBaseDef: yinglong.stats.def,
      needleBaseMres: yinglong.stats.mres,
      luoleiHp: (yinglong.monsterId === 'ct_079' || ccTerms.includes('e5_luolei500')) ? 500 : 300,
    };
  }
  const yl = yinglong.crisis.yinglong!;
  const statValue = (ally as any)[stat] ?? 0;
  const roll = mathRng.int(1, 50);
  const total = roll + statValue;
  const success = total >= yc.target;
  addLog(ns, { t: 'info', text: `【应龙判定】${ally.name} 用 ${stat} 判定：掷骰 ${roll} + ${statValue} = ${total}，目标 ${yc.target}，${success ? '成功' : '失败'}` });

  // 无论成功失败，所选维度都从可用列表移除（用过的维度无法再次选择）
  yl.usedStats = [...(yl.usedStats ?? []), stat];
  if (success) {
    yl.needle = Math.max(0, yl.needle - 1);
    damageFlat(ns, yinglong.uid, 200, 'true');
    addLog(ns, { t: 'info', text: `判定成功：应龙葬花针 -1（当前 ${yl.needle} 层），受到 200 真实伤害` });
  } else {
    yl.needle = Math.min(6, yl.needle + 1);
    summonLuolei(ns, yl.luoleiHp ?? 300);
    addLog(ns, { t: 'info', text: `判定失败：应龙葬花针 +1（当前 ${yl.needle} 层），召唤落雷` });
  }
  syncNeedleBuff(yinglong);
  ns.yinglongCheck = undefined;
  checkResult(ns);
  return { state: ns, events: ns.log.slice(start) };
}

// ---------- 回合开始前触发流水线 ----------
// 优先级：关卡机制（应龙、袁绍）> 单位机制（弹窗类八门遁甲 > 被动类挂狗BUFF等）
// 同级（被动类）按当前回合先后手（ns.order 顺序）依次触发；第一回合开始前同样触发全部效果。

// 战斗开局/再战入口：跑完整个回合开始流水线；有弹窗则暂停（cursor=-1），无弹窗则恢复正常行动
export function applyTurnStartTriggers(s: BattleState, rng: Rng = mathRng): BattleState {
  const ns = structuredClone(s);
  if (ns.result) return ns;
  syncInvincibleWhileAllies(ns);
  ns.turnStartStep = 0;
  ns.cursor = -1;
  if (runTurnStartPipeline(ns, rng)) return ns;
  ns.turnStartStep = undefined;
  ns.cursor = 0;
  return ns;
}

// 执行回合开始流水线；返回 true 表示已暂停等待玩家抉择弹窗
function runTurnStartPipeline(ns: BattleState, rng: Rng = mathRng): boolean {
  // 第一回合攻击加成（全军出击/我已做好准备，含多个叠加）在第2回合开始时统一还原
  // （所有新回合入口——开局/正常跨回合/爱弥斯切换形态——都会经过本流水线）
  if (ns.turn === 2) {
    for (const a of ns.allies) {
      if (a.firstTurnAtkBase !== undefined) {
        a.atkPctBonus = (a.atkPctBonus ?? 0) - a.firstTurnAtkBase;
        a.firstTurnAtkBase = undefined;
      }
    }
  }
  const step = ns.turnStartStep ?? 0;
  // 0 关卡机制-应龙：危机合约作战5六维判定（每回合一次）
  if (step <= 0) {
    const yinglong = ns.enemies.find((e) => (e.monsterId === 'yingLong' || e.monsterId === 'ct_079') && e.alive);
    if (yinglong && !ns.yinglongCheck?.pending && ns.yinglongCheckedTurn !== ns.turn) {
      triggerYinglongCheck(ns, yinglong);
      ns.yinglongCheckedTurn = ns.turn;
      ns.turnStartStep = 1;
      ns.cursor = -1;
      return true;
    }
  }
  // 1 关卡机制-袁绍：抢商店奇数回合开始前抉择
  if (step <= 1) {
    if (ns.choiceMode && ns.turn % 2 === 1) {
      ns.pendingChoice = { turn: ns.turn };
      ns.turnStartStep = 2;
      ns.cursor = -1;
      return true;
    }
  }
  // 2 单位机制-弹窗：凯隐开局形态选择（仅第1回合）
  if (step <= 2 && ns.turn === 1) {
    const kayn = ns.allies.find((a) => a.alive && a.form !== undefined);
    if (kayn) {
      ns.pendingKaynForm = { uid: kayn.uid };
      ns.turnStartStep = 3;
      ns.cursor = -1;
      return true;
    }
  }
  // 3 单位机制-弹窗：小李八门遁甲抉择（凯隐之后；凯隐触发时 step 跳到 3，须用 step<=3 才能被继续执行）
  if (step <= 3) {
    const gatesUser = ns.allies.find(
      (a) => a.alive && a.eightGatesMax !== undefined && (a.eightGates ?? 0) < a.eightGatesMax,
    );
    if (gatesUser) {
      ns.pendingGatesChoice = { uid: gatesUser.uid };
      ns.turnStartStep = 4;
      ns.cursor = -1;
      return true;
    }
  }
  // 4 回合开始速度修正（掷点前生效：木裂/污染躯壳受击提速、我方肾上腺素损血提速）
  applyTurnStartSpeedMods(ns);
  // 4.1 速度掷点：反映本回合有效速度（含速度修正与遗物面板加成），供被动按先后手触发
  ns.orderRolls = {};
  ns.order = rollOrder(allCombatants(ns), rng, ns.orderRolls);
  addLog(ns, { t: 'roll', turn: ns.turn });
  // 5 单位机制-被动：按当前回合先后手依次触发
  applyTurnStartPassives(ns, rng);
  ns.turnStartStep = undefined;
  return false;
}

// 回合开始速度修正：必须在速度掷点前生效，使掷点反映本回合真实有效速度。
// 原实现将这两类修正放在 applyTurnStartPassives 内（掷点之后），导致掷点使用了修正前的旧速度。
function applyTurnStartSpeedMods(ns: BattleState): void {
  for (const u of allCombatants(ns)) {
    if (!u.alive) continue;
    // 灾厄：被攻击后下回合速度+X（污染躯壳/木裂战士）——仅本回合生效，回合末还原
    if (u.spdUpPending && u.spdUpPending > 0) {
      u.stats.spdMin += u.spdUpPending;
      u.stats.spdMax += u.spdUpPending;
      u.spdUpApplied = u.spdUpPending;
      addLog(ns, { t: 'info', text: `【${u.name}】速度+${u.spdUpPending}（本回合）` });
      u.spdUpPending = 0;
    }
    // 肾上腺素：每损失X%生命速度+Y
    if (u.hpLossSpd) {
      const lossPct = 1 - u.hp / u.maxHp;
      const tiers = Math.floor(lossPct / u.hpLossSpd.hpLossPctPer);
      const spd = tiers * u.hpLossSpd.spdPer;
      if (!u.hpLossSpdBase) u.hpLossSpdBase = { min: u.stats.spdMin, max: u.stats.spdMax };
      u.stats.spdMin = u.hpLossSpdBase.min + spd;
      u.stats.spdMax = u.hpLossSpdBase.max + spd;
    }
  }
}

// 回合开始被动类效果：按当前回合顺位（先后手）逐单位触发；双行动槽单位（冥王破天）只触发一次
function applyTurnStartPassives(ns: BattleState, rng: Rng = mathRng): void {
  const seen = new Set<string>();
  const units: Combatant[] = [];
  for (const uid of ns.order) {
    const real = stripSlotUid(uid);
    if (seen.has(real)) continue;
    seen.add(real);
    const u = byUid(ns, real);
    if (u) units.push(u);
  }
  for (const u of units) {
    if (u.side === 'ally') {
      // 遗物回合初效果
      // 虚化：每回合重置虚化次数
      if (u.kamuiMaxUses !== undefined) u.kamuiUses = u.kamuiMaxUses;
      // 诸王的冠冕（2/3档）：每回合开始获得1层战势
      {
        const crown = u.skills.find((sk) => sk.id === 'sk_augusta_crown');
        const gain = crown?.augustaMomentum?.turnStartGain ?? 0;
        for (let i = 0; i < gain; i++) gainMomentum(ns, u, false);
      }
      // 里恩：登场挂假面（幂等）+ 每回合开始指令标/心命运MP回复
      {
        const maskSkill = u.skills.find((sk) => sk.id === 'sk_rein_mask');
        const mask = maskSkill?.reinMask;
        if (mask && !u.buffs.some((b) => b.id === 'reinMask' || b.id === 'reinWound')) {
          addBuff(u, 'reinMask', 1, mask.maskDmgRed);
          addLog(ns, { t: 'buff', uid: u.uid, buffId: 'reinMask', stacks: 1, intensity: mask.maskDmgRed, applied: true });
        }
        if (isRein(u)) applyReinTurnStart(ns, u, rng);
      }
      // 混沌与调和：消耗生命转化为护盾
      if (u.chaosShieldPct) {
        const pay = Math.ceil(u.maxHp * u.chaosShieldPct);
        if (u.hp > pay) {
          u.hp -= pay;
          const gain = gainShield(ns, u, pay);
          addLog(ns, { t: 'info', text: `【${u.name}】消耗 ${pay} 点生命，转化为 ${gain} 点护盾` });
        }
      }
      // 钨钢防护罩：开局由 applyRelics 发第1回合的盾；之后每 N 回合一次（第3、6、9…回合末发放，第4、7…回合开始持有）
      if (u.shieldPerTurns && ns.turn > 1 && (ns.turn - 1) % u.shieldPerTurns.every === 0) {
        const gain = gainShield(ns, u, u.shieldPerTurns.amount);
        if (gain > 0) addLog(ns, { t: 'shield', targetUid: u.uid, amount: gain });
      }
      // 卢克索的礼物：回合开始时随机对一名敌人造成 N 点真实伤害；多部位敌人则对其全部部位各造成 N 点
      if (u.turnStartEnemyDmg) {
        const targets = alive(ns.enemies);
        if (targets.length) {
          const pick = targets[rng.int(0, targets.length - 1)];
          if (pick.bossId) {
            for (const part of ns.enemies) {
              if (part.bossId === pick.bossId && part.alive) damageFlat(ns, part.uid, u.turnStartEnemyDmg, 'true');
            }
            addLog(ns, { t: 'info', text: `【${u.name}】的【卢克索的礼物】对 ${pick.name} 的全部部位各造成 ${u.turnStartEnemyDmg} 点真实伤害` });
          } else {
            damageFlat(ns, pick.uid, u.turnStartEnemyDmg, 'true');
            addLog(ns, { t: 'info', text: `【${u.name}】的【卢克索的礼物】对 ${pick.name} 造成 ${u.turnStartEnemyDmg} 点真实伤害` });
          }
        }
      }
    } else {
      // 敌方回合初效果
      // 乌鲁鲁老先生：每回合开始使敌方（我方）烧伤强度+1，层数+2
      if (u.turnStartBurn) {
        const targets = alive(ns.allies);
        for (const t of targets) {
          const b = addBuff(t, 'burn', u.turnStartBurn.stacks, u.turnStartBurn.intensity, u.uid);
          addLog(ns, { t: 'buff', uid: t.uid, buffId: 'burn', stacks: b.stacks, intensity: b.intensity, applied: true });
        }
        if (targets.length > 0) {
          addLog(ns, { t: 'info', text: `【${u.name}】使我方全体附加烧伤（强度${u.turnStartBurn.intensity}，层数${u.turnStartBurn.stacks}）` });
        }
      }
      // 夺舍红狼：上回合未被攻击则本回合攻击力+X（第一回合不误触发）
      if (ns.turn > 1 && u.atkUpIfNotHitLastTurn && !u.hitThisTurn) {
        u.stats.atk += u.atkUpIfNotHitLastTurn;
        u.atkUpActive = u.atkUpIfNotHitLastTurn;
        addLog(ns, { t: 'info', text: `【${u.name}】上回合未被攻击，本回合攻击力+${u.atkUpIfNotHitLastTurn}` });
      }
      // 灾厄：偶数回合进入守备（花岗岩巨人）
      if (u.evenTurnGuard) {
        const wasActive = u.evenTurnGuardActive;
        u.evenTurnGuardActive = ns.turn % 2 === 0;
        if (u.evenTurnGuardActive && !wasActive) {
          u.stats.def += u.evenTurnGuard.def;
          addLog(ns, { t: 'info', text: `【${u.name}】进入守备状态，防御+${u.evenTurnGuard.def}` });
        } else if (!u.evenTurnGuardActive && wasActive) {
          u.stats.def -= u.evenTurnGuard.def;
          addLog(ns, { t: 'info', text: `【${u.name}】解除守备状态` });
        }
      }
      // 灾厄：每有一个存活友方单位，防御+X法抗+Y（深池战士，回合开始判定）
      if (u.perAllyStats && u.perAllyBaseStats) {
        const aliveCount = alive(ns.enemies).length;
        const defBonus = aliveCount * u.perAllyStats.def;
        const mresBonus = aliveCount * u.perAllyStats.mres;
        u.stats.def = u.perAllyBaseStats.def + defBonus;
        u.stats.mres = Math.min(90, u.perAllyBaseStats.mres + mresBonus);
        if (defBonus > 0 || mresBonus > 0) {
          addLog(ns, { t: 'info', text: `【${u.name}】场上友方 ${aliveCount} 个，防御+${defBonus} 法抗+${mresBonus}` });
        }
      }
      // 重置本回合被攻击标记
      u.hitThisTurn = false;

      // ===== 危机合约怪物：回合初效果 =====
      const ccTerms = ns.crisisTermIds ?? [];
      // 挂狗：词条 gouStart 时战斗开始即触发；仅剩1人的即时触发改在 handleDeath 中
      if (u.crisis?.lastStandExecute) {
        const trigger = ccTerms.includes('e2_gouStart');
        if (trigger && !u.crisis.lastStandActive) {
          applyGouDogLastStand(ns, u);
        }
      }
      // 畸变杰克：1V2 时攻防法抗提升（每回合重新判定）
      if (u.crisis?.buff1v2) {
        const aliveAllies = alive(ns.allies).length;
        if (aliveAllies >= 2 && !u.crisis.buff1v2Active) {
          u.crisis.buff1v2Active = true;
          u.stats.atk += u.crisis.buff1v2.atk;
          u.stats.def += u.crisis.buff1v2.def;
          u.stats.mres = Math.min(90, u.stats.mres + u.crisis.buff1v2.mres);
          addLog(ns, { t: 'info', text: `【${u.name}】1V2 强化：攻+${u.crisis.buff1v2.atk} 防+${u.crisis.buff1v2.def} 法抗+${u.crisis.buff1v2.mres}` });
        } else if (aliveAllies < 2 && u.crisis.buff1v2Active) {
          u.crisis.buff1v2Active = false;
          u.stats.atk -= u.crisis.buff1v2.atk;
          u.stats.def -= u.crisis.buff1v2.def;
          u.stats.mres = Math.max(0, u.stats.mres - u.crisis.buff1v2.mres);
          addLog(ns, { t: 'info', text: `【${u.name}】1V2 强化解除` });
        }
        // 词条 jackAtkPerTurn：每回合攻击+10
        if (ccTerms.includes('e3_jackAtkUp')) {
          u.stats.atk += 10;
          addLog(ns, { t: 'info', text: `【${u.name}】每回合攻击+10（当前 ${u.stats.atk}）` });
        }
      }
      // ===== 灾厄 BOSS 回合初效果 =====
      // 煌雷龙：随机对一名敌方造成80%攻击力法术伤害
      if (u.monsterId === 'ct_037' && u.alive) {
        const targets = alive(ns.allies);
        if (targets.length > 0) {
          const t = targets[rng.int(0, targets.length - 1)];
          damageOne(ns, u, t.uid, 0.8, 'magical');
          addLog(ns, { t: 'info', text: `【${u.name}】雷击随机目标 ${t.name}` });
        }
      }
      // 黑色瘟疫·狄瑞吉：每回合开始敌方全体获得2层瘟疫
      if (u.monsterId === 'ct_083' && u.alive) {
        const phase = u.crisis?.direge?.phase ?? 1;
        if (phase === 1) {
          for (const a of alive(ns.allies)) {
            addBuff(a, 'plague', 2, 1, u.uid, 'max', u);
            addLog(ns, { t: 'buff', uid: a.uid, buffId: 'plague', stacks: 2, intensity: 1, applied: true });
          }
          addLog(ns, { t: 'info', text: `【${u.name}】使我方全体获得2层瘟疫` });
        } else {
          // 二阶段：意志+1D50 判定，≥80则2层瘟疫，否则5层
          for (const a of alive(ns.allies)) {
            const wil = a.wil ?? 0;
            const roll = rng.int(1, 50);
            const total = wil + roll;
            const stacks = total >= 80 ? 2 : 5;
            addBuff(a, 'plague', stacks, 1, u.uid, 'max', u);
            addLog(ns, { t: 'info', text: `【${u.name}】${a.name} 意志${wil}+掷骰${roll}=${total}，${total >= 80 ? '成功' : '失败'}，获得${stacks}层瘟疫` });
          }
        }
      }
    }
    // 奥古斯塔：全体重置受击获势计数
    u.momentumHitGainedThisTurn = 0;
  }
}

// ---------- 唯一的回合推进入口 ----------
export function advance(s: BattleState, rng: Rng = mathRng): BattleState {
  if (s.result || s.pendingBrokenArk) return s;
  const ns = structuredClone(s);
  let cursor: number;
  // 回合开始前抉择弹窗解决后（cursor=-1 且流水线未完成）：继续回合开始流水线
  if (ns.cursor === -1 && ns.turnStartStep !== undefined) {
    if (runTurnStartPipeline(ns, rng)) return ns;
    ns.turnStartStep = undefined;
    ns.cursor = 0;
    cursor = 0;
  } else {
    cursor = ns.cursor + 1;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (cursor >= ns.order.length) {
      // 回合末清除嘲讽（自动吸附仅本回合有效）
      for (const u of ns.allies) u.tauntForUid = undefined;
      // 面具男虚化：每回合末根据未使用的虚化次数获得（次数×5）MP
      for (const u of ns.allies) {
        if (!u.alive || u.kamuiMaxUses === undefined) continue;
        const leftover = u.kamuiUses ?? 0;
        if (leftover <= 0) continue;
        const gain = Math.min(u.maxMp, u.mp + leftover * 5) - u.mp;
        if (gain > 0) {
          u.mp += gain;
          addLog(ns, { t: 'info', text: `【${u.name}】虚化剩余 ${leftover} 次，恢复 ${gain} MP` });
        }
      }
      // 小李：八门遁甲回合末自伤（层数×扁平值 真实伤害，MP足够时扣MP代替）
      for (const u of ns.allies) {
        if (!u.alive) continue;
        const gates = u.eightGates ?? 0;
        if (gates <= 0) continue;
        const gatesSkill = u.skills.find((sk) => sk.gatesEndTurnDmgFlat !== undefined);
        const flat = gatesSkill?.gatesEndTurnDmgFlat ?? 10;
        const dmg = gates * flat;
        if (dmg <= 0) continue;
        if (u.mp >= dmg) {
          u.mp -= dmg;
          addLog(ns, { t: 'info', text: `【${u.name}】八门遁甲反噬：消耗 ${dmg} MP 代替真实伤害` });
        } else {
          damageFlat(ns, u.uid, dmg, 'true');
          addLog(ns, { t: 'info', text: `【${u.name}】八门遁甲反噬：受到 ${dmg} 点真实伤害` });
        }
      }
      // 凯隐蓝掠影步：回合末给自己施加迅捷
      for (const u of ns.allies) {
        if (u.pendingSwift && u.alive) {
          const b = addBuff(u, 'swift', u.pendingSwift.stacks, u.pendingSwift.intensity);
          addLog(ns, { t: 'buff', uid: u.uid, buffId: 'swift', stacks: b.stacks, intensity: b.intensity, applied: true });
        }
        u.pendingSwift = undefined;
      }
      // 新约能天使：回合末自损当前HP百分比真实伤害
      for (const u of ns.allies) {
        if (!u.alive) continue;
        const pct = u.ammoTurnEndTrueDmgPct;
        if (pct === undefined || pct <= 0) continue;
        const dmg = Math.ceil(u.hp * pct);
        damageFlat(ns, u.uid, dmg, 'true');
        addLog(ns, { t: 'info', text: `【铳弹协约】${u.name} 回合末自损 ${dmg} 点真实伤害（当前HP的 ${Math.round(pct * 100)}%）` });
      }
      // 里恩：回合末假面切换 + 代行层数解放结算（飘字与黑气特效由 UI 侧消费 vfx 日志）
      for (const u of ns.allies) {
        if (!u.alive || !isRein(u)) continue;
        applyReinEndTurn(ns, u);
      }
      // ===== 回合末：按 中毒→流血→烧伤→寒冷→再生 顺序结算 + 遗物回合末回复 + BUFF 层数衰减 =====
      // 低温附着：取存活友方中最强的低温附着参数
      let adhesionStacks = 0;
      let adhesionIntensity = 0;
      for (const a of ns.allies) {
        if (!a.alive) continue;
        if (a.chillAdhesionStacks) adhesionStacks = Math.max(adhesionStacks, a.chillAdhesionStacks);
        if (a.chillAdhesionIntensity) adhesionIntensity = Math.max(adhesionIntensity, a.chillAdhesionIntensity);
      }
      for (const u of allCombatants(ns)) {
        if (!u.alive) continue;
        // 灾厄：速度提升每回合末重置——还原本回合已应用的速度加成（待结算量保留，下回合开始应用）
        if (u.spdUpApplied && u.spdUpApplied > 0) {
          u.stats.spdMin = Math.max(1, u.stats.spdMin - u.spdUpApplied);
          u.stats.spdMax = Math.max(1, u.stats.spdMax - u.spdUpApplied);
          u.spdUpApplied = 0;
        }
        // 低温附着：若敌方携带寒冷，则其身上所有效果层数+X、强度+Y（结算前生效）
        if (u.side === 'enemy' && adhesionStacks > 0 && u.buffs.some((b) => b.id === 'chill')) {
          for (const b of u.buffs) {
            // 哈气为独立BUFF：只根据小猫自身技能叠层，不吃低温附着等其他来源的层数提升
            if (b.id === 'huff') continue;
            b.stacks += adhesionStacks;
            if (adhesionIntensity > 0) b.intensity += adhesionIntensity;
          }
        }
        // 1. 中毒：真实伤害
        const poison = buffValue(u, 'poison');
        if (poison > 0) {
          const dmg = poison * BUFF_SCALE.poison;
          damageFlat(ns, u.uid, dmg, 'true');
        }
        if (u.alive) {
          // 2. 流血：最大生命百分比法术伤害
          const bleed = buffValue(u, 'bleed');
          if (bleed > 0) {
            const dmg = Math.ceil(u.maxHp * BUFF_SCALE.bleed * bleed);
            damageFlat(ns, u.uid, dmg, 'magical');
          }
        }
        if (u.alive) {
          // 3. 烧伤：当前生命百分比真实伤害
          const burn = buffValue(u, 'burn');
          if (burn > 0) {
            const dmg = Math.ceil(u.hp * BUFF_SCALE.burn * burn);
            damageFlat(ns, u.uid, dmg, 'true');
          }
        }
        if (u.alive) {
          // 4. 寒冷：固定法术伤害
          const chill = buffValue(u, 'chill');
          if (chill > 0) {
            const dmg = chill * BUFF_SCALE.chill;
            damageFlat(ns, u.uid, dmg, 'magical');
            // 冷凝榴弹：累计寒冷伤害，触发减益阈值
            u.condensChillDmg = (u.condensChillDmg ?? 0) + dmg;
            const cg = findCondensGrenade(ns);
            if (cg) checkCondensThresholds(ns, u, cg);
          }
        }
        if (u.alive) {
          // 5. 瘟疫：永久削减最大生命上限（施加时已结算，回合末不再扣血）
        }
        // 狩猎标记：回合末受到施放者攻击力X%的物理伤害（永久，施放者死亡后不再结算）
        if (u.alive) {
          const hm = u.buffs.find((b) => b.id === 'huntMark');
          if (hm?.ownerUid) {
            const owner = byUid(ns, hm.ownerUid);
            if (owner.alive) {
              const dmg = Math.ceil(calcDamage(owner, u, hm.stacks * hm.intensity, 'physical'));
              applyDamage(ns, u, dmg, 'physical');
            }
          }
        }
        if (u.alive) {
          // 5. 再生：回合末回复固定生命
          const regen = buffValue(u, 'regen');
          if (regen > 0 && u.hp < u.maxHp) {
            let heal = regen * BUFF_SCALE.regen;
            if (u.side === 'ally' && u.healAmp) heal = Math.floor(heal * (1 + u.healAmp));
            const gain = Math.min(heal, u.maxHp - u.hp);
            u.hp += gain;
            addLog(ns, { t: 'heal', targetUid: u.uid, amount: gain });
          }
        }
        // 朱天使的戒指：每回合末恢复固定生命（BUFF 全部结算完后再生效）
        if (u.alive && u.healTurnEnd && u.hp < u.maxHp) {
          let heal = u.healTurnEnd;
          if (u.side === 'ally' && u.healAmp) heal = Math.floor(heal * (1 + u.healAmp));
          const gain = Math.min(heal, u.maxHp - u.hp);
          u.hp += gain;
          addLog(ns, { t: 'heal', targetUid: u.uid, amount: gain });
        }
        // 灾厄：每回合末恢复全体友方固定生命（滴滴怪）
        if (u.alive && u.healAllTurnEnd) {
          const allies = u.side === 'ally' ? ns.allies : ns.enemies;
          for (const a of allies) {
            if (a.alive && a.hp < a.maxHp) {
              const gain = Math.min(u.healAllTurnEnd, a.maxHp - a.hp);
              a.hp += gain;
            }
          }
          addLog(ns, { t: 'info', text: `【${u.name}】恢复全体友方 ${u.healAllTurnEnd} 点生命` });
        }
        // 灾厄：每回合末恢复全体友方 X% 最大生命（富养鳐鱼）
        if (u.alive && u.healAllTurnEndPct) {
          const allies = u.side === 'ally' ? ns.allies : ns.enemies;
          for (const a of allies) {
            if (a.alive && a.hp < a.maxHp) {
              const heal = Math.ceil(a.maxHp * u.healAllTurnEndPct);
              const gain = Math.min(heal, a.maxHp - a.hp);
              a.hp += gain;
            }
          }
          addLog(ns, { t: 'info', text: `【${u.name}】恢复全体友方 ${Math.round(u.healAllTurnEndPct * 100)}% 最大生命` });
        }
        // 灾厄：每回合末给全体友方 X 点护盾（钨钢增幅器）
        if (u.alive && u.shieldAllTurnEnd) {
          const allies = u.side === 'ally' ? ns.allies : ns.enemies;
          for (const a of allies) {
            if (a.alive) gainShield(s, a, u.shieldAllTurnEnd);
          }
          addLog(ns, { t: 'info', text: `【${u.name}】为全体友方添加 ${u.shieldAllTurnEnd} 点护盾` });
        }
        // 灾厄：被攻击后回合末仍存活则自爆（自爆源石虫）
        if (u.alive && u.selfDestructOnSurvive && u.hitThisTurn) {
          const dmg = u.hp;
          const opponents = u.side === 'ally' ? ns.enemies : ns.allies;
          for (const o of opponents) {
            if (o.alive) applyDamage(ns, o, dmg, 'magical', u);
          }
          u.hp = 0;
          u.alive = false;
          addLog(ns, { t: 'info', text: `【${u.name}】自爆，对敌方全体造成 ${dmg} 点法术伤害` });
          addLog(ns, { t: 'death', uid: u.uid, name: u.name });
        }
        // 花癫疯：回合末对全场敌方造成 X 点法术伤害
        if (u.alive && u.turnEndAoeMagic) {
          // 花癫疯：全场法伤，包含友方与自身
          const all = [...ns.enemies, ...ns.allies];
          for (const o of all) {
            if (o.alive) applyDamage(ns, o, u.turnEndAoeMagic, 'magical', u);
          }
          addLog(ns, { t: 'info', text: `【${u.name}】对全场（含友方与自身）造成 ${u.turnEndAoeMagic} 点法术伤害` });
        }
        // ===== 灾厄 BOSS 回合末效果 =====
        // 肉山：每回合末速度+2
        if (u.alive && u.monsterId === 'ct_068') {
          u.stats.spdMin += 2;
          u.stats.spdMax += 2;
          addLog(ns, { t: 'info', text: `【${u.name}】速度+2（当前 ${u.stats.spdMin}-${u.stats.spdMax}）` });
        }
        // 血肉蠕虫：失去当前HP的10%来恢复血肉宿主
        if (u.alive && u.monsterId === 'ct_041_worm') {
          const cost = Math.ceil(u.hp * 0.1);
          u.hp = Math.max(1, u.hp - cost);
          const host = ns.enemies.find((e) => e.monsterId === 'ct_041' && e.alive);
          if (host) {
            const heal = Math.min(cost, host.maxHp - host.hp);
            host.hp += heal;
            addLog(ns, { t: 'info', text: `【血肉蠕虫】消耗${cost}HP恢复血肉宿主${heal}HP` });
          }
        }
        // 骷髅王：双手被破坏后计数2回合，回合末复活
        if (u.alive && u.monsterId === 'ct_057_head' && u.crisis?.skeletron?.handsDead) {
          const sk = u.crisis.skeletron;
          sk.reviveCounter = (sk.reviveCounter ?? 0) + 1;
          if (sk.reviveCounter >= 3) {
            const hands = ns.enemies.filter((e) => e.bossId === u.bossId && e.monsterId === 'ct_057_hand');
            for (const h of hands) {
              h.alive = true;
              h.hp = h.maxHp;
            }
            sk.handsDead = false;
            sk.reviveCounter = 0;
            addLog(ns, { t: 'info', text: `【骷髅王】双手复活，伤害减免恢复90%` });
          }
        }
        // 钨钢制造者：友方不足 count 时召唤随机钨钢怪物
        if (u.alive && u.summonBelowAllies && u.summonPoolTemplates && u.summonPoolTemplates.length > 0) {
          const allies = u.side === 'ally' ? ns.allies : ns.enemies;
          const aliveAllies = allies.filter((a) => a.alive).length;
          if (aliveAllies < u.summonBelowAllies.count) {
            const tpl = u.summonPoolTemplates[Math.floor(Math.random() * u.summonPoolTemplates.length)];
            const unit = structuredClone(tpl);
            unit.uid = `summon_${ns.nextSummonId++}`;
            if (u.side === 'ally') ns.allies.push(unit); else ns.enemies.push(unit);
            addLog(ns, { t: 'summon', uid: u.uid, name: u.name, targetUid: unit.uid, targetName: unit.name });
          }
        }
        // 狂暴宿主组长PLUS：每损失X%生命，攻击+Y速度+Z
        if (u.alive && u.hpLossPerStep) {
          const lossPct = 1 - u.hp / u.maxHp;
          const tiers = Math.floor(lossPct / u.hpLossPerStep.stepPct);
          const last = u.hpLossBonusLast ?? 0;
          const delta = tiers - last;
          if (delta !== 0) {
            u.stats.atk = Math.max(0, u.stats.atk + delta * u.hpLossPerStep.atk);
            u.stats.spdMin = Math.max(0, u.stats.spdMin + delta * u.hpLossPerStep.spd);
            u.stats.spdMax = Math.max(u.stats.spdMin, u.stats.spdMax + delta * u.hpLossPerStep.spd);
            u.hpLossBonusLast = tiers;
            if (delta > 0) addLog(ns, { t: 'info', text: `【${u.name}】损失${tiers * 10}%生命，攻击+${delta * u.hpLossPerStep.atk}，速度+${delta * u.hpLossPerStep.spd}` });
          }
        }
        // 蜂王：每回合末召唤一只黄蜂
        if (u.alive && u.summonEachTurnTemplate) {
          const unit = structuredClone(u.summonEachTurnTemplate);
          unit.uid = `summon_${ns.nextSummonId++}`;
          if (u.side === 'ally') ns.allies.push(unit); else ns.enemies.push(unit);
          addLog(ns, { t: 'summon', uid: u.uid, name: u.name, targetUid: unit.uid, targetName: unit.name });
        }
        // 蜂王：HP低于阈值时吞噬一只黄蜂回血（仅一次）
        if (u.alive && u.lowHpConsumeSummon && !u.lowHpConsumeSummonUsed && u.hp / u.maxHp <= u.lowHpConsumeSummon.hpPct) {
          const allies = u.side === 'ally' ? ns.allies : ns.enemies;
          const wasp = allies.find((a) => a.alive && a.monsterId === u.lowHpConsumeSummon!.summonName);
          if (wasp) {
            wasp.alive = false;
            wasp.hp = 0;
            const heal = Math.floor(u.maxHp * u.lowHpConsumeSummon.healPct);
            u.hp = Math.min(u.maxHp, u.hp + heal);
            u.lowHpConsumeSummonUsed = true;
            addLog(ns, { t: 'death', uid: wasp.uid, name: wasp.name });
            addLog(ns, { t: 'info', text: `【${u.name}】吞噬${wasp.name}，恢复${heal}HP` });
          }
        }
        // 血浆哥布林鲨鱼：HP低于阈值时回满并加速加攻（仅一次）
        if (u.alive && u.lowHpBurst && !u.lowHpBurstUsed && u.hp / u.maxHp <= u.lowHpBurst.hpPct) {
          u.hp = u.maxHp;
          u.stats.spdMin += u.lowHpBurst.spd;
          u.stats.spdMax += u.lowHpBurst.spd;
          u.stats.atk += u.lowHpBurst.atk;
          u.lowHpBurstUsed = true;
          addLog(ns, { t: 'info', text: `【${u.name}】陷入狂暴，回满HP，速度+${u.lowHpBurst.spd}，攻击+${u.lowHpBurst.atk}` });
        }
        // 演出用香水：回合末恢复最大生命X%
        if (u.alive && u.side === 'ally' && u.healTurnEndPct && u.hp < u.maxHp) {
          let heal = Math.ceil(u.maxHp * u.healTurnEndPct);
          if (u.healAmp) heal = Math.floor(heal * (1 + u.healAmp));
          const gain = Math.min(heal, u.maxHp - u.hp);
          if (gain > 0) {
            u.hp += gain;
            addLog(ns, { t: 'heal', targetUid: u.uid, amount: gain });
          }
        }
        // 魔力花瓶：每回合末恢复X点MP
        if (u.alive && u.side === 'ally' && u.mpTurnEnd && u.mp < u.maxMp) {
          const gain = Math.min(u.mpTurnEnd, u.maxMp - u.mp);
          u.mp += gain;
        }
        // 几丁质刺刀：回合末受到最大生命X%真实伤害
        if (u.alive && u.side === 'ally' && u.chitinDotPct) {
          const dmg = Math.ceil(u.maxHp * u.chitinDotPct);
          damageFlat(ns, u.uid, dmg, 'true');
          addLog(ns, { t: 'info', text: `【几丁质刺刀】${u.name} 受到 ${dmg} 点真实伤害` });
        }
        // 凋亡引爆检测：若达到3层则引爆，造成 施加者最大MP×强度 的固定伤害，然后移除凋亡
        if (u.alive) {
          const apop = u.buffs.find((b) => b.id === 'apoptosis');
          if (apop && apop.stacks >= APOPTOSIS_TRIGGER_STACKS) {
            const owner = apop.ownerUid ? byUid(ns, apop.ownerUid) : undefined;
            const baseMp = owner?.maxMp ?? u.maxMp;
            const dmg = Math.ceil(baseMp * BUFF_SCALE.apoptosis * apop.intensity);
            damageFlat(ns, u.uid, dmg, 'true');
            u.buffs = u.buffs.filter((b) => b.id !== 'apoptosis');
            addLog(ns, { t: 'buff', uid: u.uid, buffId: 'apoptosis', stacks: 0, intensity: 0, applied: false });
          }
        }
        tickBuffsEndOfTurn(u);
        // 拿钱砸袁绍：本回合削减的攻击力在回合末恢复
        if (u.atkCut) {
          u.stats.atk += u.atkCut;
          u.atkCut = 0;
        }
        // 马神残躯能力2：每回合伤害上限计数清零
        if (u.dmgTakenThisTurn) u.dmgTakenThisTurn = 0;
        // 夺舍红狼：回合末扣除本回合临时攻击力加成
        if (u.atkUpActive) {
          u.stats.atk = Math.max(0, u.stats.atk - u.atkUpActive);
          u.atkUpActive = 0;
        }
        // 落雷：回合末自爆，对敌方全体造成剩余HP的真实伤害
        if (u.monsterId === 'luolei' && u.alive) {
          const dmg = u.hp;
          for (const a of alive(ns.allies)) {
            damageFlat(ns, a.uid, dmg, 'true', u);
          }
          addLog(ns, { t: 'info', text: `【${u.name}】自爆，对我方全体造成 ${dmg} 点真实伤害` });
          u.hp = 0;
          u.alive = false;
          transferImplosionFromDead(ns, u);
          handleDeath(ns, u);
        }
      }
      // 应龙：一楔之命——每回合结束葬花针+1
      for (const e of ns.enemies) {
        if (e.monsterId === 'yingLong' && e.crisis?.yinglong) {
          const maxNeedle = 6;
          if (e.crisis.yinglong.needle < maxNeedle) {
            e.crisis.yinglong.needle += 1;
            addLog(ns, { t: 'info', text: `【一楔之命】${e.name} 葬花针 +1（当前 ${e.crisis.yinglong.needle} 层）` });
            syncNeedleBuff(e);
          }
        }
      }
      // 狂暴宿主组长：每回合末扣除自身最大生命 X%（词条 disableBurn 时失效）
      {
        const ccTerms = ns.crisisTermIds ?? [];
        for (const e of ns.enemies) {
          if (!e.alive || !e.crisis?.selfBurnPct) continue;
          if (ccTerms.includes('e1_disable')) continue;
          const burn = Math.floor(e.maxHp * e.crisis.selfBurnPct);
          e.hp = Math.max(0, e.hp - burn);
          if (e.hp <= 0) {
            e.alive = false;
            addLog(ns, { t: 'death', uid: e.uid, name: e.name });
            transferImplosionFromDead(ns, e);
            handleDeath(ns, e);
          } else {
            addLog(ns, { t: 'info', text: `【${e.name}】反噬自身，扣除 ${burn} 点生命` });
          }
        }
      }
      // 冷凝榴弹：回合数-1，到期清除
      for (const a of ns.allies) {
        if (a.condensGrenadeActive) {
          a.condensGrenadeActive.turnsLeft -= 1;
          if (a.condensGrenadeActive.turnsLeft <= 0) {
            addLog(ns, { t: 'info', text: `${a.name} 的冷凝榴弹效果结束` });
            a.condensGrenadeActive = undefined;
          }
        }
      }
      // ===== 老板：第N回合末直接离开战场（不算击败）=====
      for (const e of ns.enemies) {
        if (!e.alive || !e.fleeOnTurn) continue;
        if (ns.turn >= e.fleeOnTurn) {
          e.alive = false;
          e.fled = true;
          addLog(ns, { t: 'info', text: `【${e.name}】在第 ${ns.turn} 回合末逃离了战场` });
        }
      }
      checkResult(ns);
      if (ns.result) break;
      // ===== 殁亡：回合末斩杀（所有伤害型BUFF结算后）=====
      for (const ally of ns.allies) {
        if (!ally.alive || !ally.executeIntMul) continue;
        executeMortChain(ns, ally);
      }
      checkResult(ns);
      if (ns.result) break;

      // ===== 爱弥斯：共赴长航被动——本回合有聚爆引爆则回合末可选择切换形态 =====
      for (const ally of ns.allies) {
        if (!ally.alive || ally.eimisSyncMax === undefined) continue;
        if (!ally.eimisDetonatedThisTurn) continue;
        const voyage = ally.skills.find((sk) => sk.eimisHumanChaGain);
        if (!voyage) continue;
        if (ally.mp < 10) continue;
        // 弹出玩家抉择：是否消耗10MP切换形态并给敌方全体施加floor(等级/10)层聚爆
        ns.pendingEimisFormSwitch = { uid: ally.uid };
        ns.cursor = cursor;
        return ns;
      }

      // ===== 王牌单位：达尼娅 泡影视阈——回合末敌方全体获得当前回合数的聚爆层数 =====
      const hasImplosionTurnEnd = ns.allies.some((a) => a.alive && a.aceImplosionTurnEnd);
      if (hasImplosionTurnEnd) {
        const turnStacks = ns.turn;
        for (const e of ns.enemies) {
          if (!e.alive) continue;
          addBuff(e, 'implosion', turnStacks, 1);
          addLog(ns, { t: 'buff', uid: e.uid, buffId: 'implosion', stacks: turnStacks, intensity: 1, applied: true });
        }
      }

      // ===== 新回合初 =====
      ns.turn += 1;
      // 岩角号：每回合开始按存活友方单位数重算攻击力加成（死亡单位不计）
      {
        const aliveCount = ns.allies.filter((a) => a.alive).length;
        for (const a of ns.allies) {
          if (a.allyCountAtkCfg) {
            a.allyCountAtkAmp = Math.min(a.allyCountAtkCfg.cap, aliveCount * a.allyCountAtkCfg.perUnit);
          }
        }
      }
      // 新回合初：重置无敌标记
      for (const a of ns.allies) a.invincibleThisTurn = false;
      // 古堡的子嗣：第N回合开始全体防御+X%，法抗+Y
      for (const a of ns.allies) {
        if (a.alive && a.turnStartBuff && ns.turn === a.turnStartBuff.turn && !a.turnStartBuffTriggered) {
          a.stats.def = Math.ceil(a.stats.def * (1 + a.turnStartBuff.defPct));
          a.stats.mres = Math.min(90, a.stats.mres + a.turnStartBuff.mres);
          a.turnStartBuffTriggered = true;
          addLog(ns, { t: 'info', text: `【古堡的子嗣】${a.name} 防御+${Math.round(a.turnStartBuff.defPct * 100)}%，法抗+${a.turnStartBuff.mres}` });
        }
        // 种植者名单：上回合未受击则获得护盾
        if (a.alive && a.noHitShield && !a.wasHitLastTurn) {
          const gain = gainShield(s, a, a.noHitShield);
          if (gain > 0) addLog(ns, { t: 'shield', targetUid: a.uid, amount: gain });
        }
        a.wasHitLastTurn = false;
        // 热辣可可：每损失X%生命攻击+Y%（按当前血量动态重算，叠加到atkPctBonus）
        if (a.alive && a.hpLossAtk) {
          const lossPct = 1 - a.hp / a.maxHp;
          const tiers = Math.floor(lossPct / a.hpLossAtk.hpLossPctPer);
          const atkPct = tiers * a.hpLossAtk.atkPctPer;
          const old = a.hpLossAtkContrib ?? 0;
          a.atkPctBonus = (a.atkPctBonus ?? 0) - old + atkPct;
          a.hpLossAtkContrib = atkPct;
        }
      }
      // 重置爱弥斯本回合聚爆引爆标记
      for (const ally of ns.allies) {
        if (ally.eimisSyncMax !== undefined) ally.eimisDetonatedThisTurn = false;
      }
      cursor = 0;
      // 回合开始前触发流水线（关卡机制应龙/袁绍 > 单位弹窗八门遁甲 > 速度修正与掷点 > 单位被动按先后手）
      ns.turnStartStep = 0;
      ns.cursor = -1;
      if (runTurnStartPipeline(ns, rng)) return ns;
      ns.turnStartStep = undefined;
      ns.cursor = 0;
      continue;
    }
    // 回合末结算（如殁亡斩杀）已分出胜负时直接返回，避免 cursor 越界
    if (ns.result) {
      ns.cursor = 0;
      return ns;
    }
    const u = byUid(ns, ns.order[cursor]);
    if (!u.alive) {
      cursor += 1;
      continue;
    }
    if (u.statuses.stunTurns > 0) {
      u.statuses.stunTurns -= 1;
      addLog(ns, { t: 'stun', uid: u.uid, name: u.name });
      cursor += 1;
      continue;
    }
    // DONK 魔王：累计消耗MP达到阈值时，每回合获得强壮
    if (u.side === 'ally' && u.donkTotalMpConsumed !== undefined) {
      applyDemonStrength(ns, u);
    }
    // DONK 世一步：回合开始MP为0时停止行动，恢复MP并获得攻击力、回血
    if (u.side === 'ally' && u.donkTotalMpConsumed !== undefined && u.mp <= 0) {
      const shiyi = u.skills.find((sk) => sk.shiyiMpCost);
      if (shiyi) {
        const restorePct = shiyi.shiyiMpRestorePct ?? 0.5;
        const atkBonusPct = shiyi.shiyiAtkBonusPct ?? 0.5;
        const atkCap = shiyi.shiyiAtkCap ?? 50;
        const restore = Math.floor(u.maxMp * restorePct);
        u.mp = restore;
        const atkGain = Math.min(atkCap, Math.floor((u.donkTotalMpConsumed ?? 0) * atkBonusPct));
        if (atkGain > 0) u.stats.atk += atkGain;
        // 恢复 当前速度×4 HP
        const curSpd = u.roll ?? effSpd(u).max;
        const hpRestore = curSpd * 4;
        if (hpRestore > 0) u.hp = Math.min(u.maxHp, u.hp + hpRestore);
        addLog(ns, { t: 'info', text: `【世一步】${u.name} MP耗尽，停止行动，恢复 ${restore} MP，攻击力+${atkGain}，HP+${hpRestore}` });
        cursor += 1;
        continue;
      }
    }
    // 王牌单位蓄力技能：回合开始时释放（煌雷龙 蓄能炮）
    if (u.side === 'ally' && u.aceChargeSkill) {
      u.aceChargeSkill.turnsLeft -= 1;
      if (u.aceChargeSkill.turnsLeft <= 0) {
        const sk = u.skills.find((x) => x.id === u.aceChargeSkill!.skillId);
        if (sk) {
          addLog(ns, { t: 'info', text: `【${u.name}】蓄力完成，释放「${sk.name}」` });
          castSkill(ns, u, sk, undefined, false, true);
        }
        u.aceChargeSkill = undefined;
      }
      cursor += 1;
      continue;
    }
    break;
  }

  ns.cursor = cursor;
  checkResult(ns);
  return ns;
}
