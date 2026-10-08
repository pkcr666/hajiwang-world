import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AceUnit, BattleState, Character, Combatant, LogEntry, MonsterUnit, PlayerAction, RecruitBonus, SaveData, StageMechanic,
} from '../types';
import { enemyMapOf, itemMapOf } from '../data/content';
import {
  advance, applyRelics, applyTurnStartTriggers, createBattle, currentActor, enemyAct, getLegalActions,
  playerAct, resolveReaction, resolveBrokenArk, resolveRobChoice, resolveGatesChoice, resolveKaynForm, resolveEimisFormSwitch, resolveYinglongCheck, type LegalItem, type LegalSkill, type RobChoice,
} from '../engine/battle';
import { mathRng, type FixedDrop } from '../types';
import { buildAceCombatant, buildAllyCombatant, buildEnemyCombatants } from '../engine/unit';
import { BUFF_LIBRARY, addBuff, computeDamageMods, effDefBuffed, effSpd } from '../engine/buffs';
import { effAtk } from '../engine/damage';
import { OrderBar } from '../components/battle/OrderBar';
import { UnitCard, type FloatText } from '../components/battle/StatBar';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';
import { spdText } from '../ui/labels';

type Pending =
  | { kind: 'attack' }
  | { kind: 'skill'; ls: LegalSkill; enhance?: boolean; variantId?: string } // variantId：里恩一技能三种释放方式
  | { kind: 'item'; li: LegalItem };

const STEP_MS = 700;

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const REIN_MARK_ICON = `${BASE}角色资源/指令标.webp`;

export interface RunBattleMode {
  // 副本探索模式：跨战斗继承的生命/魔力（缺省按满血处理）
  initialHpMp: Map<string, { hp: number; mp: number }>;
  // 本次副本途中获得的遗物（面板类直接算进局外面板，动态类开局生效；不带出副本）
  relicIds?: string[];
  relicStacks?: Record<string, number>; // 层数遗物当前层数
  killBook?: number; // 杀人书层数（局外攻击+X%/层）
  maxHpPctDown?: number; // 痛苦之村求救信：最大生命削减比例
  recruitUnitBonuses?: Record<string, RecruitBonus>; // 招募单位加成（按单位id）
  leaderId?: string; // 当前队长（顶部队长栏高亮；幸运掉落按队长幸运判定）
  onSwitchLeader?: (id: string) => void; // 战斗中实时切换队长
  robChoice?: boolean; // 抢商店BOSS战：奇数回合开始前需玩家抉择
  leaderCha?: number; // 队长魅力（勾引袁绍判定用）
  onSpendCoins?: (amount: number) => void; // 拿钱砸袁绍：扣减币池
  endgame?: boolean; // 终局联系：全副本敌人强化
  fateBossDebuffs?: { // 命运所指对马神残躯的削弱
    atkCut?: number; defCut?: number; hpCut?: number;
    spdFixed?: boolean; noRegen?: boolean; noDmgCap?: boolean;
  };
  crisisTermIds?: string[]; // 危机合约选中词条（flag 类效果判定用）
  onFinish: (
    result: 'win' | 'lose',
    survivors: { id: string; hp: number; mp: number; bag: { itemId: string; count: number }[] }[],
    bonusDrops?: FixedDrop[],
  ) => void;
}

export function Battle({ save, allies, aceUnits, enemyIds, mechanics, onRematch, onSetup, onHome, runMode }: {
  save: SaveData;
  allies: Character[];
  aceUnits?: AceUnit[];
  enemyIds: string[];
  mechanics?: StageMechanic[]; // 关卡「额外属性」（副本探索作战传入；对战测试无）
  onRematch?: () => void;
  onSetup?: () => void;
  onHome?: () => void;
  runMode?: RunBattleMode;
}) {
  const itemsMap = useMemo(() => itemMapOf(save), [save]);
  const enemyDefs = useMemo(() => enemyMapOf(save), [save]);

  const initial = useMemo(() => {
    const relicIds = [
      ...allies.flatMap((c) => c.relics ?? []),
      ...(runMode?.relicIds ?? []),
    ];
    const a2 = allies.map((c, i) => {
      const u = buildAllyCombatant(c, itemsMap, i, { relics: relicIds, relicStacks: runMode?.relicStacks, killBook: runMode?.killBook, maxHpPctDown: runMode?.maxHpPctDown });
      // 危机合约：禁用药水（即使角色背包里有，也不允许在战斗中使用）
      if (runMode?.crisisTermIds) {
        u.bag = u.bag.filter((b) => b.itemId !== 'it_potion_hp_s' && b.itemId !== 'it_potion_mp_s');
      }
      const saved = runMode?.initialHpMp.get(c.id);
      if (saved) {
        u.hp = Math.max(0, Math.min(u.maxHp, Math.floor(saved.hp)));
        u.mp = Math.max(0, Math.min(u.maxMp, Math.floor(saved.mp)));
      }
      // 招募单位加成（疗养礼品卡/指中狼/老妈的鼓励）
      const rBonus = runMode?.recruitUnitBonuses?.[c.id];
      if (rBonus) {
        if (rBonus.spd) { u.stats.spdMin += rBonus.spd; u.stats.spdMax += rBonus.spd; }
        if (rBonus.atkPct) u.stats.atk = Math.ceil(u.stats.atk * (1 + rBonus.atkPct));
        if (rBonus.dmgPct) { const rm = (u.relicMods ??= {}); rm.allDmgAmp = (rm.allDmgAmp ?? 0) + rBonus.dmgPct; }
        if (rBonus.noSkill) u.skills = u.skills.filter((sk) => sk.kind !== 'active');
      }
      return u;
    });
    // 王牌单位作为临时队友加入（Set 去重防重复单位）
    const aAce = [...new Set(aceUnits ?? [])].map((ace, i) => {
      const u = buildAceCombatant(ace, a2.length + i);
      const saved = runMode?.initialHpMp.get(ace.id);
      if (saved) {
        u.hp = Math.max(0, Math.min(u.maxHp, Math.floor(saved.hp)));
        u.mp = Math.max(0, Math.min(u.maxMp, Math.floor(saved.mp)));
      }
      return u;
    });
    const aAll = [...a2, ...aAce];
    const e = enemyIds.flatMap((id, i) => {
      const def: MonsterUnit | undefined = enemyDefs.get(id);
      if (!def) return [];
      const units = buildEnemyCombatants(def, i, enemyDefs, mechanics, runMode?.endgame);
      // 命运所指削弱：仅对马神残躯生效
      const db = runMode?.fateBossDebuffs;
      if (db && (def.id === 'horseGodRemnant' || def.id === 'horseGod')) {
        for (const u of units) {
          if (db.atkCut) u.stats.atk = Math.max(0, u.stats.atk - db.atkCut);
          if (db.defCut) u.stats.def = Math.max(0, u.stats.def - db.defCut);
          if (db.hpCut) { u.maxHp = Math.max(1, u.maxHp - db.hpCut); u.hp = Math.min(u.hp, u.maxHp); }
          if (db.spdFixed) { u.stats.spdMin = 5; u.stats.spdMax = 5; }
          if (db.noRegen) u.healTurnEnd = 0;
          if (db.noDmgCap) u.dmgCapPerTurn = undefined;
        }
      }
      return units;
    });
    const b = applyRelics(createBattle(aAll, e, mathRng), relicIds, save.activeRun?.torches ?? 0, save.activeRun?.coins ?? 0, save.activeRun?.threeBattleCurseCount ?? 0);
    if (runMode?.crisisTermIds) b.crisisTermIds = runMode.crisisTermIds;
    if (runMode?.robChoice) b.choiceMode = true;
    // 回合开始前触发流水线（关卡机制应龙/袁绍 > 单位弹窗八门遁甲 > 单位被动按先后手）：
    // 第一回合开始前即触发全部回合开始效果（挂狗BUFF等），有弹窗则暂停等待玩家抉择
    return applyTurnStartTriggers(b);
    // 仅在挂载时构建（再战通过 key 重挂载）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [battle, setBattle] = useState(initial);
  const [pending, setPending] = useState<Pending | null>(null);
  const [infoUid, setInfoUid] = useState<string | null>(null);
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [vfxMap, setVfxMap] = useState<Record<string, string>>({});
  const [vfxBlocking, setVfxBlocking] = useState(false); // 长动画播放中：暂停双方行动推进
  const floatId = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const [robCoinsAsk, setRobCoinsAsk] = useState(false); // 拿钱砸袁绍：金额输入弹窗
  const [coinInput, setCoinInput] = useState('');
  const [pendingEnhance, setPendingEnhance] = useState<{ skillId: string; targetUid?: string } | null>(null); // 虚化增强弹窗
  const [ylSelStat, setYlSelStat] = useState<'str' | 'int' | 'agi' | 'wil' | 'luk' | 'cha' | null>(null); // 应龙判定选的维度

  const actor = currentActor(battle);
  const isPlayerTurn = !battle.result && actor.side === 'ally';
  const legal = useMemo(() => getLegalActions(battle, itemsMap), [battle, itemsMap]);
  const menu = isPlayerTurn ? legal : null;
  // 奥古斯塔：战势≥阈值时技能自动强化（UI上标记强化）
  const augustaEnhanced = actor.momentumMax !== undefined && (actor.momentum ?? 0) >= 3;

  // 飘字
  const pushFloats = (events: LogEntry[]) => {
    const made: FloatText[] = [];
    for (const ev of events) {
      if (ev.t === 'damage') {
        if (ev.amount > 0) {
          made.push({ id: ++floatId.current, uid: ev.targetUid, text: `-${Math.round(ev.amount)}`, kind: ev.type === 'magical' ? 'magic' : 'damage' });
        }
        if (ev.blocked && ev.blocked > 0) {
          made.push({ id: ++floatId.current, uid: ev.targetUid, text: `盾-${ev.blocked}`, kind: 'shield' });
        }
      } else if (ev.t === 'heal') {
        made.push({ id: ++floatId.current, uid: ev.targetUid, text: `+${ev.amount}`, kind: 'heal' });
      } else if (ev.t === 'shield') {
        made.push({ id: ++floatId.current, uid: ev.targetUid, text: `盾+${ev.amount}`, kind: 'shield' });
      } else if (ev.t === 'stun') {
        made.push({ id: ++floatId.current, uid: ev.uid, text: '眩晕', kind: 'info' });
      } else if (ev.t === 'break') {
        made.push({ id: ++floatId.current, uid: ev.uid, text: '部位损毁', kind: 'info' });
      } else if (ev.t === 'survive') {
        made.push({ id: ++floatId.current, uid: ev.uid, text: '幸存!', kind: 'heal' });
      }
    }
    if (!made.length) return;
    setFloats((old) => [...old, ...made]);
    const ids = new Set(made.map((m) => m.id));
    setTimeout(() => setFloats((old) => old.filter((f) => !ids.has(f.id))), 1000);
  };

  // 视觉特效：检测 vfx 日志，给对应单位临时挂载动画类；里恩解放/摘面具额外飘字
  const REIN_LIB_WORDS: Record<string, string> = { reinLib1: '无我梦中', reinLib2: '阿鼻叫唤', reinLib3: '支离灭裂' };
  // 长动画（替换立绘）播放期间：暂停双方行动推进，播完再继续
  const BLOCKING_VFX = new Set(['eimisEntry', 'eimisFormSwitch', 'reinMaskGif', 'reinLibSwitch', 'logosEntry', 'exusiaiEntry']);
  const pushVfx = (events: LogEntry[]) => {
    const vfxEvents = events.filter((e): e is Extract<LogEntry, { t: 'vfx' }> => e.t === 'vfx');
    if (!vfxEvents.length) return;
    const updates: Record<string, string> = {};
    const made: FloatText[] = [];
    let libDuration = 1100;
    for (const e of vfxEvents) {
      // 摘面具 gif 优先：同帧有解放等其它 vfx 时不被覆盖（否则 GIF 一闪而逝）
      if (e.kind === 'reinMaskGif') updates[e.uid] = 'reinMaskGif';
      else if (!updates[e.uid]) updates[e.uid] = e.kind;
      if (REIN_LIB_WORDS[e.kind]) {
        made.push({ id: ++floatId.current, uid: e.uid, text: REIN_LIB_WORDS[e.kind], kind: 'info', cls: 'float-reinlib' });
        libDuration = 2600;
      } else if (e.kind === 'reinMaskGif') {
        // 摘面具：仅播放GIF，不显示飘字
        libDuration = 2500;
      } else if (e.kind === 'eimisFormSwitch') {
        // 爱弥斯形态切换：播放avif动画
        libDuration = 2500;
      } else if (e.kind === 'eimisEntry') {
        // 爱弥斯登场动画
        libDuration = 2500;
      } else if (e.kind === 'logosEntry') {
        // 逻各斯登场动画：两倍速播放，持续5秒
        libDuration = 5000;
      } else if (e.kind === 'exusiaiEntry') {
        // 能天使登场动画：持续5.3秒
        libDuration = 5300;
      } else if (e.kind === 'reinLibSwitch') {
        // 里恩解放：切换立绘前播放形态切换动画
        libDuration = 2500;
      }
    }
    if (made.length) {
      setFloats((old) => [...old, ...made]);
      const ids = new Set(made.map((m) => m.id));
      setTimeout(() => setFloats((old) => old.filter((f) => !ids.has(f.id))), 2600);
    }
    // 长动画播放期间锁住战斗推进
    if (vfxEvents.some((e) => BLOCKING_VFX.has(e.kind))) setVfxBlocking(true);
    setVfxMap((old) => ({ ...old, ...updates }));
    setTimeout(() => {
      setVfxMap((old) => {
        const next = { ...old };
        for (const e of vfxEvents) {
          if (next[e.uid] === e.kind) delete next[e.uid];
        }
        return next;
      });
      if (vfxEvents.some((e) => BLOCKING_VFX.has(e.kind))) setVfxBlocking(false);
    }, libDuration);
  };
  const vfxClassFor = (uid: string, u?: Combatant) => {
    let cls = vfxMap[uid] ? `vfx-${vfxMap[uid]}` : '';
    if (u) {
      // 里恩：解放III 黑气特效 / 心-命运 金光特效（稳定状态）
      if (u.reinOracle?.liberation === 3) cls += ' rein-lib3';
      if (u.reinHeartFate) cls += ' rein-heart';
      // 指令标目标标记（仅当行动者为里恩且目标被标记时）
      if (actor.reinOracle?.markedTargetUid === u.uid) cls += ' rein-marked-target';
    }
    return cls || undefined;
  };

  // 执行回合推进，并捕获 advance 内部新增的日志事件（含殁亡斩杀/凋亡引爆等回合末VFX）
  const runAdvance = (state: BattleState) => {
    const beforeLen = state.log.length;
    const next = advance(state, mathRng);
    const events = next.log.slice(beforeLen);
    return { state: next, events };
  };

  // 首次进入战斗：回放初始日志中的 vfx（如爱弥斯登场动画）
  useEffect(() => {
    pushVfx(battle.log);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 回合驱动：仅依赖 cursor / turn / result，避免敌方行动后重复触发
  useEffect(() => {
    if (vfxBlocking) return; // 长动画（登场/形态切换/摘面具/解放切换）播放中：暂停推进
    if (battle.result) return;
    if (battle.pendingChoice) return; // 抢商店抉择暂停：等待玩家选择
    if (battle.pendingGatesChoice) return; // 小李八门遁甲抉择暂停：等待玩家选择
    if (battle.pendingKaynForm) return; // 凯隐形态抉择暂停：等待玩家选择
    if (battle.pendingEimisFormSwitch) return; // 爱弥斯共赴长航抉择暂停
    if (battle.pendingBrokenArk) return; // 破碎方舟受击抉择暂停
    if (battle.yinglongCheck?.pending) return; // 应龙六维判定暂停
    const cur = currentActor(battle);
    if (cur.side === 'ally') {
      setPending(null);
      return;
    }
    const t1 = setTimeout(() => {
      const r = enemyAct(battle, mathRng);
      pushFloats(r.events);
      pushVfx(r.events);
      setBattle(r.state);
      // 反应式技能弹窗：暂停自动推进，等玩家选择后由 onChooseReaction 继续
      // 破碎方舟抉择弹窗：同样暂停自动推进
      if (!r.state.pendingReaction && !r.state.pendingBrokenArk) {
        setTimeout(() => {
          const ar = runAdvance(r.state);
          pushFloats(ar.events);
          pushVfx(ar.events);
          setBattle(ar.state);
        }, STEP_MS);
      }
    }, 600);
    return () => clearTimeout(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.turn, battle.cursor, battle.result, vfxBlocking]);

  // 日志自动滚动
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [battle.log.length]);

  const commit = (action: PlayerAction) => {
    const r = playerAct(battle, action, itemsMap);
    if (!r.events.length) return;
    pushFloats(r.events);
    pushVfx(r.events);
    setPending(null);
    setBattle(r.state);
    setTimeout(() => {
      const ar = runAdvance(r.state);
      pushFloats(ar.events);
      pushVfx(ar.events);
      setBattle(ar.state);
    }, STEP_MS);
  };

  // 释放技能：enhance=true 时直接虚化增强释放，否则普通释放；variantId 为里恩一技能三式
  const castSkill = (skillId: string, targetUid?: string, enhance = false, variantId?: string) => {
    commit({ type: 'skill', skillId, targetUid, enhance, variantId });
  };

  // 虚化增强弹窗选择（保留兼容，但技能栏已改为直接按钮）
  const onChooseEnhance = (enhance: boolean) => {
    if (!pendingEnhance) return;
    const { skillId, targetUid } = pendingEnhance;
    setPendingEnhance(null);
    commit({ type: 'skill', skillId, targetUid, enhance });
  };
  // 受击前反应弹窗选择：确认=耗蓝施加减益并继续敌方行动，取消=不耗蓝直接继续
  const onChooseReaction = (accept: boolean) => {
    const r = resolveReaction(battle, accept);
    if (r.state === battle) return;
    pushFloats(r.events);
    pushVfx(r.events);
    setBattle(r.state);
    if (r.state.replaySpecial) {
      // 特殊AI直伤：拒绝虚化后重新执行该行动（enemyAct 会跳过反应检查）
      setTimeout(() => {
        const er = enemyAct(r.state, mathRng);
        pushFloats(er.events);
        pushVfx(er.events);
        setBattle(er.state);
        if (!er.state.result && !er.state.pendingReaction && !er.state.pendingBrokenArk) {
          setTimeout(() => {
            const ar = runAdvance(er.state);
            pushFloats(ar.events);
            pushVfx(ar.events);
            setBattle(ar.state);
          }, STEP_MS);
        }
      }, STEP_MS);
      return;
    }
    if (!r.state.result && !r.state.pendingReaction && !r.state.pendingBrokenArk) {
      setTimeout(() => {
        const ar = runAdvance(r.state);
        pushFloats(ar.events);
        pushVfx(ar.events);
        setBattle(ar.state);
      }, STEP_MS);
    }
  };

  // 破碎方舟受击抉择：确认=耗蓝抵消伤害并获得强壮，取消=承受全额伤害
  const onChooseBrokenArk = (accept: boolean) => {
    const r = resolveBrokenArk(battle, accept);
    if (r.state === battle) return;
    pushFloats(r.events);
    pushVfx(r.events);
    setBattle(r.state);
    if (!r.state.result && !r.state.pendingBrokenArk) {
      setTimeout(() => {
        const ar = runAdvance(r.state);
        pushFloats(ar.events);
        pushVfx(ar.events);
        setBattle(ar.state);
      }, STEP_MS);
    }
  };

  // 小李八门遁甲抉择：是否叠加1层
  const onChooseGates = (accept: boolean) => {
    const r = resolveGatesChoice(battle, accept);
    if (r.state === battle) return;
    pushFloats(r.events);
    pushVfx(r.events);
    setBattle(r.state);
    if (!r.state.result && !r.state.pendingGatesChoice) {
      setTimeout(() => {
        const ar = runAdvance(r.state);
        pushFloats(ar.events);
        pushVfx(ar.events);
        setBattle(ar.state);
      }, STEP_MS);
    }
  };

  // 凯隐开局形态抉择：红/蓝
  const onChooseKaynForm = (form: 'red' | 'blue') => {
    const r = resolveKaynForm(battle, form);
    if (r.state === battle) return;
    pushFloats(r.events);
    pushVfx(r.events);
    setBattle(r.state);
    if (!r.state.result && !r.state.pendingKaynForm && !r.state.pendingEimisFormSwitch && !r.state.pendingGatesChoice) {
      setTimeout(() => {
        const ar = runAdvance(r.state);
        pushFloats(ar.events);
        pushVfx(ar.events);
        setBattle(ar.state);
      }, STEP_MS);
    }
  };

  // 爱弥斯：共赴长航——回合末聚爆引爆后选择是否切换形态
  const onChooseEimisSwitch = (accept: boolean) => {
    const r = resolveEimisFormSwitch(battle, accept);
    if (r.state === battle) return;
    pushFloats(r.events);
    pushVfx(r.events);
    setBattle(r.state);
    // resolveEimisFormSwitch 已直接推进到新回合首位行动者，无需再 runAdvance
  };

  // 应龙六维判定：选择维度与角色后结算
  const onResolveYinglong = (stat: 'str' | 'int' | 'agi' | 'wil' | 'luk' | 'cha', allyUid: string) => {
    const r = resolveYinglongCheck(battle, stat, allyUid);
    setYlSelStat(null);
    if (r.state === battle) return;
    pushFloats(r.events);
    pushVfx(r.events);
    setBattle(r.state);
    if (!r.state.result && !r.state.yinglongCheck?.pending) {
      setTimeout(() => {
        const ar = runAdvance(r.state);
        pushFloats(ar.events);
        pushVfx(ar.events);
        setBattle(ar.state);
      }, STEP_MS);
    }
  };

  // 抢商店抉择：应用效果并继续战斗（拿钱砸先扣币池再结算减攻）
  const doRobChoice = (choice: RobChoice) => {
    let actualChoice = choice;
    if (choice.kind === 'coins') {
      const amount = Math.floor(Number(coinInput));
      if (!Number.isFinite(amount) || amount <= 0) return;
      const coins = save.activeRun?.coins ?? 0;
      if (amount > coins) return; // 不能超过现有币池
      runMode?.onSpendCoins?.(amount);
      actualChoice = { kind: 'coins', amount };
    }
    const r = resolveRobChoice(battle, actualChoice, mathRng);
    if (r.state === battle) return;
    pushFloats(r.events);
    pushVfx(r.events);
    setBattle(r.state);
    setRobCoinsAsk(false);
    setCoinInput('');
    if (!r.state.result && !r.state.pendingChoice && !r.state.pendingGatesChoice) {
      setTimeout(() => {
        const ar = runAdvance(r.state);
        pushFloats(ar.events);
        pushVfx(ar.events);
        setBattle(ar.state);
      }, STEP_MS);
    }
  };

  const floatsOf = (uid: string) => floats.filter((f) => f.uid === uid);

  const targetUids = pending
    ? pending.kind === 'item'
      ? pending.li.targetUids
      : pending.kind === 'skill'
        ? (pending.ls.targetUids ?? [])
        : battle.enemies.filter((u) => u.alive).map((u) => u.uid)
    : [];
  const isTarget = (uid: string) => targetUids.includes(uid);

  // BOSS 部位分组
  const enemyGroups: { bossId?: string; units: typeof battle.enemies }[] = [];
  for (const u of battle.enemies) {
    if (u.bossId) {
      let g = enemyGroups.find((x) => x.bossId === u.bossId);
      if (!g) {
        g = { bossId: u.bossId, units: [] };
        enemyGroups.push(g);
      }
      g.units.push(u);
    } else {
      enemyGroups.push({ units: [u] });
    }
  }

  // BOSS 血条列表：多部位 BOSS 取核心部位；单体 BOSS 取对应怪物标记为 boss 的单位
  const bossEntries: { uid: string; name: string; hp: number; maxHp: number; multi: boolean; tag?: string }[] = [];
  for (const g of enemyGroups) {
    if (g.bossId) {
      const core = g.units.find((u) => u.isCore) ?? g.units[0];
      if (core) {
        bossEntries.push({
          uid: core.uid,
          name: core.name.split('·')[0],
          hp: Math.max(0, Math.ceil(core.hp)),
          maxHp: core.maxHp,
          multi: g.units.length > 1,
        });
      }
    } else {
      const u = g.units[0];
      const def = u.monsterId ? enemyDefs.get(u.monsterId) : undefined;
      if (def?.boss) {
        bossEntries.push({
          uid: u.uid,
          name: u.name,
          hp: Math.max(0, Math.ceil(u.hp)),
          maxHp: u.maxHp,
          multi: false,
          tag: (u.monsterId === 'yingLong' || u.monsterId === 'ct_079') ? `葬花针 ${u.crisis?.yinglong?.needle ?? '??'}` : undefined,
        });
      }
    }
  }

  return (
    <div className="battle-page">
      <OrderBar state={battle} />

      <div className="battle-field">
        {bossEntries.length > 0 && (
          <div className="boss-hp-bar-area">
            {bossEntries.map((b, idx) => {
              const pct = b.maxHp > 0 ? Math.max(0, (b.hp / b.maxHp) * 100) : 0;
              return (
                <div key={b.uid} className={`boss-hp-bar ${b.multi ? 'boss-hp-multi' : ''}`} style={{ animationDelay: `${idx * 60}ms` }}>
                  <div className="boss-hp-name">
                    <span className="boss-hp-crown">♛</span>
                    {b.name}
                    {b.tag && <span className="boss-hp-tag">{b.tag}</span>}
                    {b.multi && <span className="boss-hp-tag">多部位</span>}
                  </div>
                  <div className="boss-hp-track">
                    <div className="boss-hp-fill" style={{ width: `${pct}%` }} />
                    <span className="boss-hp-text">{b.hp} / {b.maxHp}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="battle-side battle-allies">
          {battle.allies.map((u) => (
            <UnitCard
              key={u.uid}
              u={u}
              active={isPlayerTurn && actor.uid === u.uid}
              dead={!u.alive}
              floats={floatsOf(u.uid)}
              vfxClass={vfxClassFor(u.uid, u)}
              onInfo={() => setInfoUid(u.uid)}
              selectable={!!pending && (pending.kind === 'item' || pending.kind === 'skill') && isTarget(u.uid)}
              onClick={() => {
                if (pending?.kind === 'item') {
                  commit({ type: 'item', itemId: pending.li.item.id, targetUid: u.uid });
                } else if (pending?.kind === 'skill') {
                  castSkill(pending.ls.skill.id, u.uid, pending.enhance, pending.variantId);
                }
              }}
            />
          ))}
        </div>

        <div className="vs-mark">VS</div>

        <div className="battle-side battle-enemies">
          {enemyGroups.map((g) =>
            g.bossId ? (
              <div className="boss-group" key={g.bossId}>
                <Sprite className="boss-img" src={g.units[0].icon} alt={g.units[0].name} />
                <div className="boss-parts-col">
                  {g.units.map((u) => (
                    <UnitCard
                      key={u.uid}
                      u={u}
                      small
                      active={!battle.result && actor.uid === u.uid}
                      dead={!u.alive}
                      floats={floatsOf(u.uid)}
                      vfxClass={vfxClassFor(u.uid, u)}
                      onInfo={() => setInfoUid(u.uid)}
                      selectable={!!pending && pending.kind !== 'item' && isTarget(u.uid)}
                      onClick={() => {
                        if (!pending || pending.kind === 'item') return;
                        if (pending.kind === 'attack') commit({ type: 'attack', targetUid: u.uid });
                        else castSkill(pending.ls.skill.id, u.uid, pending.enhance, pending.variantId);
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <UnitCard
                key={g.units[0].uid}
                u={g.units[0]}
                active={!battle.result && actor.uid === g.units[0].uid}
                dead={!g.units[0].alive}
                floats={floatsOf(g.units[0].uid)}
                vfxClass={vfxClassFor(g.units[0].uid, g.units[0])}
                onInfo={() => setInfoUid(g.units[0].uid)}
                selectable={!!pending && pending.kind !== 'item' && isTarget(g.units[0].uid)}
                onClick={() => {
                  const u = g.units[0];
                  if (!pending || pending.kind === 'item') return;
                  if (pending.kind === 'attack') commit({ type: 'attack', targetUid: u.uid });
                  else commit({ type: 'skill', skillId: pending.ls.skill.id, targetUid: u.uid, enhance: pending.enhance, variantId: pending.variantId });
                }}
              />
            ),
          )}
        </div>
      </div>

      <div className="battle-bottom">
        <div className="log-panel" ref={logRef}>
          {battle.log.map((e) => <div key={e.id} className="log-line">{logText(e, battle)}</div>)}
        </div>

        <div className="action-panel">
          {battle.result ? (
            <div className="result-tip">{battle.result === 'win' ? '战斗胜利' : '战斗失败'}</div>
          ) : isPlayerTurn ? (
            pending ? (
              <>
                <div className="target-tip">
                  {pending.kind === 'item' ? '选择一名我方单位' : '选择目标'}
                </div>
                <button className="btn" onClick={() => setPending(null)}>返回</button>
              </>
            ) : (
              <>
                <div className="actor-tip">轮到【{actor.name}】行动</div>
                <div className="action-btns">
                  <button
                    className={`btn${augustaEnhanced ? ' augusta-enhanced-skill' : ''}`}
                    disabled={!menu?.canAttack}
                    title={menu?.attackAll ? '普攻对敌方全体生效' : undefined}
                    onClick={() => {
                      if (menu?.attackAll) {
                        const first = battle.enemies.find((u) => u.alive);
                        if (first) commit({ type: 'attack', targetUid: first.uid });
                      } else {
                        setPending({ kind: 'attack' });
                      }
                    }}
                  >
                    {augustaEnhanced ? '强化普攻' : '普攻'}{menu?.attackAll ? <span className="btn-sub">群攻</span> : null}
                  </button>
                  {menu?.skills.map((ls: LegalSkill) => {
                    const sk = ls.skill;
                    const enhanceMpCost = sk.enhanceMpCost ?? 0;
                    const hasEnhance = enhanceMpCost > 0;
                    const enhanceKamuiCost = sk.enhanceKamuiCost ?? 0;
                    const baseMp = sk.mpCost ?? 0;
                    const enhanceMpOk = actor.mp >= baseMp + enhanceMpCost;
                    const enhanceKamuiOk = (actor.kamuiUses ?? 0) >= enhanceKamuiCost;
                    const enhanceDisabled = ls.disabled || !enhanceMpOk || !enhanceKamuiOk;
                    const enhanceReason = !enhanceMpOk
                      ? `需${baseMp + enhanceMpCost}MP`
                      : !enhanceKamuiOk
                        ? `需${enhanceKamuiCost}次虚化`
                        : ls.reason;
                    const fireSkill = (enhance: boolean) => {
                      if (enhance && enhanceDisabled) return;
                      if (sk.target === 'self' || sk.target === 'enemyAll') {
                        castSkill(sk.id, undefined, enhance);
                      } else {
                        setPending({ kind: 'skill', ls, enhance });
                      }
                    };
                    return (
                      <div key={sk.id} className="skill-row">
                        {sk.variants && sk.variants.length > 0 ? (
                          // 里恩：一技能三种释放方式（独立按钮，带指令标的变体高亮）
                          <div className="skill-row rein-variant-row">
                            {sk.variants.map((v) => {
                              const marked = actor.reinOracle?.markedVariantId === v.id;
                              return (
                                <button
                                  key={v.id}
                                  className={`btn skill-btn rein-variant-btn${marked ? ' rein-marked-variant' : ''}`}
                                  disabled={ls.disabled}
                                  title={`${v.name}：${v.desc}`}
                                  onClick={() => setPending({ kind: 'skill', ls, variantId: v.id })}
                                >
                                  {v.name}
                                  <span className={`btn-sub${marked ? ' rein-mark-icon' : ''}`}>
                                    {marked
                                      ? <img className="rein-mark-img" src={REIN_MARK_ICON} alt="指令标" />
                                      : (ls.disabled ? ls.reason : (ls.costText ?? '—'))}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <button
                            className={`btn skill-btn${augustaEnhanced ? ' augusta-enhanced-skill' : ''}`}
                            disabled={ls.disabled}
                            title={sk.desc}
                            onClick={() => fireSkill(false)}
                          >
                            {augustaEnhanced ? `强化·${sk.name}` : sk.name}
                            <span className="btn-sub">
                              {ls.disabled ? ls.reason : (ls.costText ?? '—')}
                            </span>
                          </button>
                        )}
                        {!sk.variants && hasEnhance && (
                          <button
                            className="btn skill-btn enhance-btn"
                            disabled={enhanceDisabled}
                            title={`${sk.name} · 虚化增强\n额外消耗 ${enhanceMpCost}MP 与 ${enhanceKamuiCost}次虚化，倍率+${Math.round((sk.enhanceMulBonus ?? 0) * 100)}%${sk.enhanceApplyBuffs?.length ? '，附加效果' : ''}`}
                            onClick={() => fireSkill(true)}
                          >
                            虚化增强
                            <span className="btn-sub">
                              {enhanceDisabled ? enhanceReason : `+${enhanceMpCost}MP ${enhanceKamuiCost}虚化`}
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {menu?.items.map((li: LegalItem) => (
                    <button
                      key={li.item.id}
                      className="btn item-btn"
                      onClick={() => setPending({ kind: 'item', li })}
                    >
                      {li.item.name}<span className="btn-sub">×{li.count}</span>
                    </button>
                  ))}
                </div>
              </>
            )
          ) : (
            <div className="actor-tip">【{actor.name}】行动中…</div>
          )}
        </div>
      </div>

      {battle.result && (
        <div className="modal-mask">
          <div className="modal result-modal">
            <h2 className={battle.result === 'win' ? 'win-text' : 'lose-text'}>
              {battle.result === 'win' ? '胜 利' : '败 北'}
            </h2>
            <div className="modal-actions">
              {runMode ? (
                battle.result === 'win' ? (
                  <button
                    className="btn primary"
                    onClick={() => runMode.onFinish('win', [
                      ...allies.map((c, i) => {
                        const u = battle.allies.find((x) => x.uid === `ally_${i}`);
                        return {
                          id: c.id, hp: u?.hp ?? 0, mp: u?.mp ?? 0,
                          bag: u?.bag.map((b) => ({ ...b })) ?? [],
                        };
                      }),
                      ...(aceUnits ?? []).map((ace, i) => {
                        const u = battle.allies.find((x) => x.uid === `ace_${allies.length + i}`);
                        return {
                          id: ace.id, hp: u?.hp ?? 0, mp: u?.mp ?? 0,
                          bag: u?.bag.map((b) => ({ ...b })) ?? [],
                        };
                      }),
                    ], battle.bonusDrops)}
                  >
                    继续探索
                  </button>
                ) : (
                  <button
                    className="btn btn-danger"
                    onClick={() => runMode.onFinish('lose', [
                      ...allies.map((c, i) => {
                        const u = battle.allies.find((x) => x.uid === `ally_${i}`);
                        return {
                          id: c.id, hp: u?.hp ?? 0, mp: u?.mp ?? 0,
                          bag: u?.bag.map((b) => ({ ...b })) ?? [],
                        };
                      }),
                      ...(aceUnits ?? []).map((ace, i) => {
                        const u = battle.allies.find((x) => x.uid === `ace_${allies.length + i}`);
                        return {
                          id: ace.id, hp: u?.hp ?? 0, mp: u?.mp ?? 0,
                          bag: u?.bag.map((b) => ({ ...b })) ?? [],
                        };
                      }),
                    ])}
                  >
                    团灭结算
                  </button>
                )
              ) : (
                <>
                  <button className="btn primary" onClick={onRematch}>再战一场</button>
                  <button className="btn" onClick={onSetup}>改阵容</button>
                  <button className="btn" onClick={onHome}>回主界面</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {infoUid && (() => {
        const u = [...battle.allies, ...battle.enemies].find((x) => x.uid === infoUid);
        if (!u) return null;
        const base = u.baseSnapshot;
        const bStats = base?.stats;
        const curAtk = effAtk(u);
        const curDef = effDefBuffed(u);
        const curMres = u.stats.mres;
        const curSpd = effSpd(u);
        const mods = computeDamageMods(u);
        const relicMods = u.relicMods ?? {};
        const d = (cur: number, baseVal?: number) => {
          if (baseVal === undefined || cur === baseVal) return null;
          const diff = cur - baseVal;
          return diff > 0
            ? <i className="bp-relic-delta" style={{ color: '#2e7d32' }}>+{diff}</i>
            : <i className="bp-relic-delta" style={{ color: '#c62828' }}>{diff}</i>;
        };
        const dpct = (cur: number, baseVal?: number) => {
          if (baseVal === undefined || cur === baseVal) return null;
          const diff = Math.round((cur - baseVal) * 100);
          return diff > 0
            ? <i className="bp-relic-delta" style={{ color: '#2e7d32' }}>+{diff}%</i>
            : <i className="bp-relic-delta" style={{ color: '#c62828' }}>{diff}%</i>;
        };
        const six: [string, number | undefined, number | undefined][] = [
          ['力量', u.str, base?.str],
          ['智力', u.int, base?.int],
          ['敏捷', u.agi, base?.agi],
          ['幸运', u.luk, base?.luk],
          ['魅力', u.cha, base?.cha],
          ['意志', u.wil, base?.wil],
        ];
        const modRows: [string, number, number | undefined][] = [
          ['全能增伤', mods.allDmgAmp, relicMods.allDmgAmp],
          ['真实增伤', mods.trueDmgAmp, relicMods.trueDmgAmp],
          ['物理增伤', mods.physDmgAmp, relicMods.physDmgAmp],
          ['法术增伤', mods.magicDmgAmp, relicMods.magicDmgAmp],
          ['全能减伤', mods.allDmgRed, relicMods.allDmgRed],
          ['真实减伤', mods.trueDmgRed, relicMods.trueDmgRed],
          ['物理减伤', mods.physDmgRed, relicMods.physDmgRed],
          ['法术减伤', mods.magicDmgRed, relicMods.magicDmgRed],
        ];
        return (
          <Modal title={u.name} onClose={() => setInfoUid(null)}>
            <div className="unit-info-flex">
              <Sprite className="unit-info-portrait" src={u.icon} alt={u.name} />
              <div className="unit-info-roll">
                本回合速度掷点：<b>{u.roll}</b>
                <span className="muted small">（基础 {spdText(u.stats.spdMin, u.stats.spdMax)}，同速判定 {u.tieBreak}）</span>
              </div>
            </div>
            <h4>基础属性<span className="muted small">（局外面板含遗物，绿+红-为局内变化）</span></h4>
            <div className="stat-grid unit-info-grid">
              <span>生命 <b>{u.maxHp}</b>{d(u.maxHp, bStats?.hp)}</span>
              <span>魔力 <b>{u.maxMp}</b>{d(u.maxMp, bStats?.mp)}</span>
              <span>攻击 <b>{curAtk}</b>{d(curAtk, bStats?.atk)}</span>
              <span>防御 <b>{curDef}</b>{d(curDef, bStats?.def)}</span>
              <span>法抗 <b>{curMres}%</b>{d(curMres, bStats?.mres)}</span>
              <span>速度 <b>{spdText(curSpd.min, curSpd.max)}</b>{d(curSpd.max, bStats?.spdMax)}</span>
            </div>
            <h4>额外6维</h4>
            <div className="stat-grid unit-info-grid">
              {six.map(([label, cur, bv]) => (
                <span key={label}>{label} <b>{cur ?? 0}</b>{d(cur ?? 0, bv)}</span>
              ))}
            </div>
            <h4>增伤 / 减伤</h4>
            <div className="stat-grid unit-info-grid bp-mod-grid">
              {modRows.map(([label, cur, bv]) => (
                <span key={label}>{label} <b>{Math.round(cur * 100)}%</b>{dpct(cur, bv)}</span>
              ))}
            </div>
            {u.buffs.length > 0 && (
              <>
                <h4>当前 BUFF</h4>
                <div className="unit-info-buffs">
                  {u.buffs.map((b, i) => {
                    const def = BUFF_LIBRARY[b.id];
                    return (
                      <span key={i} className="buff-tag" title={def?.desc ?? b.id}>
                        {def?.name ?? b.id} ×{b.stacks}
                        {b.intensity > 1 ? `(强度${b.intensity})` : ''}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setInfoUid(null)}>关闭</button>
            </div>
          </Modal>
        );
      })()}

      {battle.pendingReaction && (() => {
        const pr = battle.pendingReaction!;
        const attacker = [...battle.allies, ...battle.enemies].find((x) => x.uid === pr.attackerUid);
        const target = battle.allies.find((x) => x.uid === pr.targetUid);
        const rsk = target?.skills.find((x) => x.id === pr.skillId);
        if (!attacker || !target || !rsk?.reaction) return null;
        const rx = rsk.reaction;
        if (rx.mode === 'kamui') {
          return (
            <Modal title={`${rsk.name}？`} onClose={() => onChooseReaction(false)}>
              <p>【{attacker.name}】即将攻击【{target.name}】，是否使用「{rsk.name}」闪避？</p>
              <p className="muted small">
                消耗 {rsk.mpCost} MP 与 1 次虚化次数（剩余 {target.kamuiUses ?? 0} 次），
                无效本次攻击并获得强壮增益。
              </p>
              <div className="modal-actions">
                <button className="btn primary" onClick={() => onChooseReaction(true)}>虚化！</button>
                <button className="btn" onClick={() => onChooseReaction(false)}>不闪避</button>
              </div>
            </Modal>
          );
        }
        const cur = attacker.buffs.find((b) => b.id === rx.buffId)?.stacks ?? 0;
        const canStack = cur < (rx.maxStacks ?? 1);
        // 当前攻防（含已有哈气层）与模拟哈气叠加 1 层后的攻防
        const atkNow = effAtk(attacker);
        const defNow = effDefBuffed(attacker);
        const sim = structuredClone(attacker);
        addBuff(sim, rx.buffId!, 1, rx.intensity ?? 1);
        const atkAfter = effAtk(sim);
        const defAfter = effDefBuffed(sim);
        return (
          <Modal title={`${rsk.name}？`} onClose={() => onChooseReaction(false)}>
            <p>【{attacker.name}】即将攻击【{target.name}】，是否使用「{rsk.name}」？</p>
            <p className="muted small">
              消耗 {rsk.mpCost} MP：{attacker.name} 攻击、防御各-5%/层并减强度值
              （当前 {cur} 层 · 上限 {rx.maxStacks} 层）
            </p>
            <div className="huff-stats">
              <div className="huff-row">
                <span>当前攻击力</span>
                <b>{atkNow}</b>
                <span className="huff-arrow">→</span>
                <b className={canStack ? 'huff-after' : 'huff-same'}>{atkAfter}</b>
              </div>
              <div className="huff-row">
                <span>当前防御力</span>
                <b>{defNow}</b>
                <span className="huff-arrow">→</span>
                <b className={canStack ? 'huff-after' : 'huff-same'}>{defAfter}</b>
              </div>
              {!canStack && (
                <p className="muted small">已达 {rx.maxStacks} 层上限，本次哈气不会进一步削弱。</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => onChooseReaction(true)}>
                {rsk.name}！
              </button>
              <button className="btn" onClick={() => onChooseReaction(false)}>
                不{rsk.name}
              </button>
            </div>
          </Modal>
        );
      })()}

      {battle.pendingBrokenArk && (() => {
        const pb = battle.pendingBrokenArk!;
        const target = battle.allies.find((x) => x.uid === pb.targetUid);
        const ba = target?.weaponBrokenArk;
        if (!target || !ba) return null;
        const reduced = Math.floor(pb.toHp * (1 - ba.dmgRedPct));
        return (
          <Modal title="破碎方舟" onClose={() => onChooseBrokenArk(false)}>
            <p>【{target.name}】即将受到 <b>{pb.toHp}</b> 点伤害，是否启动「破碎方舟」？</p>
            <p className="muted small">
              消耗 {ba.mpCost} MP（当前 {target.mp}/{target.maxMp}）：抵消 {Math.round(ba.dmgRedPct * 100)}% 伤害
              （{pb.toHp} → {reduced}），并获得 {ba.buffStacks} 层强壮（强度 {ba.buffIntensity}，+{ba.buffIntensity * 10}% 增伤）。
            </p>
            <p className="muted small">
              强壮强度固定为 {ba.buffIntensity}，多次触发仅累加回合数，不会继续上涨。
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => onChooseBrokenArk(true)}>启动方舟！</button>
              <button className="btn" onClick={() => onChooseBrokenArk(false)}>硬抗</button>
            </div>
          </Modal>
        );
      })()}

      {pendingEnhance && (() => {
        const sk = actor.skills.find((x) => x.id === pendingEnhance.skillId);
        if (!sk) return null;
        const extraMp = sk.enhanceMpCost ?? 0;
        const extraKamui = sk.enhanceKamuiCost ?? 1;
        const kamuiEnough = (actor.kamuiUses ?? 0) >= extraKamui;
        return (
          <Modal title={`${sk.name} · 虚化增强`} onClose={() => onChooseEnhance(false)}>
            <p>是否消耗额外资源进行虚化增强？</p>
            <p className="muted small">
              增强：额外消耗 {extraMp} MP 与 {extraKamui} 次虚化次数（剩余 {actor.kamuiUses ?? 0} 次），伤害倍率 +{Math.round((sk.enhanceMulBonus ?? 0) * 100)}%
              {sk.enhanceApplyBuffs?.length ? `，并附加${sk.enhanceApplyBuffs.map((b) => `${b.stacks}层${b.intensity}强度${b.id === 'burn' ? '烧伤' : b.id === 'bind' ? '束缚' : b.id}`).join('、')}` : ''}
            </p>
            {!kamuiEnough && <p className="muted small" style={{ color: 'var(--danger)' }}>虚化次数不足，无法增强（虚化技能需20级解锁）</p>}
            <div className="modal-actions">
              <button className="btn primary" disabled={!kamuiEnough} onClick={() => onChooseEnhance(true)}>虚化增强！</button>
              <button className="btn" onClick={() => onChooseEnhance(false)}>普通释放</button>
            </div>
          </Modal>
        );
      })()}

      {battle.pendingChoice && (() => {
        const boss = battle.enemies.find((e) => e.alive && e.monsterId === 'yuanShao')
          ?? battle.enemies.find((e) => e.alive);
        const bossName = boss?.name ?? '袁绍';
        const coins = save.activeRun?.coins ?? 0;
        return (
          <Modal title={`第 ${battle.pendingChoice.turn} 回合 · 抉择`} onClose={() => {}}>
            <p>【{bossName}】守在货摊前，气势汹汹——如何应对？</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => doRobChoice({ kind: 'worship' })}>
                膜拜{bossName}（防御/法抗减半两回合）
              </button>
              <button className="btn" onClick={() => doRobChoice({ kind: 'seduce', cha: runMode?.leaderCha ?? 0 })}>
                勾引{bossName}（魅力 {runMode?.leaderCha ?? 0} + 1D50 ≥ 60，成功 300 真伤）
              </button>
              <button className="btn" onClick={() => setRobCoinsAsk(true)}>
                拿钱砸死（本回合减攻）
              </button>
            </div>
            <p className="muted small">拿钱砸：每 100 哈哈币削减 {bossName} 本回合 1 点攻击力，币池余额 {coins}。</p>
          </Modal>
        );
      })()}

      {robCoinsAsk && (
        <Modal title="拿钱砸死袁绍" onClose={() => setRobCoinsAsk(false)}>
          <p className="muted small">
            每 100 哈哈币削减袁绍本回合 1 点攻击力，当前币池 {save.activeRun?.coins ?? 0}。
          </p>
          <input
            className="text-input"
            type="number"
            min={1}
            value={coinInput}
            onChange={(e) => setCoinInput(e.target.value)}
            placeholder="输入砸出的哈哈币数量"
          />
          <div className="modal-actions">
            <button className="btn primary" onClick={() => doRobChoice({ kind: 'coins', amount: 0 })}>
              确认砸出
            </button>
            <button className="btn" onClick={() => setRobCoinsAsk(false)}>取消</button>
          </div>
        </Modal>
      )}

      {battle.yinglongCheck?.pending && (() => {
        const yc = battle.yinglongCheck!;
        const statLabels: Record<string, string> = { str: '力量', int: '智力', agi: '敏捷', wil: '意志', luk: '幸运', cha: '魅力' };
        const aliveAllies = battle.allies.filter((a) => a.alive);
        return (
          <Modal title="应龙 · 六维判定" onClose={() => {}}>
            <p>判定目标：<b>{yc.target}</b>（掷骰 1-50 + 所选维度 ≥ {yc.target}）</p>
            <p className="muted small">当前葬花针层数：{(yc.target - 60) / 5} 层。成功：葬花针 -1，应龙受 200 真实伤害；失败：葬花针 +1，召唤落雷。</p>
            {!ylSelStat && (
              <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
                {yc.available.map((st) => (
                  <button key={st} className="btn primary" onClick={() => {
                    setYlSelStat(st);
                    if (aliveAllies.length === 1) onResolveYinglong(st, aliveAllies[0].uid);
                  }}>{statLabels[st]}</button>
                ))}
              </div>
            )}
            {ylSelStat && aliveAllies.length > 1 && (
              <div>
                <p>选择执行判定的角色（{statLabels[ylSelStat]}）：</p>
                <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
                  {aliveAllies.map((a) => (
                    <button key={a.uid} className="btn primary" onClick={() => onResolveYinglong(ylSelStat, a.uid)}>
                      {a.name}（{statLabels[ylSelStat]} {(a as any)[ylSelStat] ?? 0}）
                    </button>
                  ))}
                  <button className="btn" onClick={() => setYlSelStat(null)}>返回</button>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}
      {!battle.pendingChoice && battle.pendingKaynForm && (() => {
        const u = battle.allies.find((a) => a.uid === battle.pendingKaynForm!.uid);
        if (!u) return null;
        return (
          <Modal title="暗裔魔镰 · 形态选择" onClose={() => {}}>
            <p>【{u.name}】开局选择战斗形态：</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => onChooseKaynForm('red')}>红形态（近战吸血）</button>
              <button className="btn" onClick={() => onChooseKaynForm('blue')}>蓝形态（法术群攻）</button>
            </div>
          </Modal>
        );
      })()}
      {!battle.pendingChoice && battle.pendingEimisFormSwitch && (() => {
        const u = battle.allies.find((a) => a.uid === battle.pendingEimisFormSwitch!.uid);
        if (!u) return null;
        const stacks = Math.floor((u.charLevel ?? 1) / 10);
        return (
          <Modal title="共赴长航 · 形态切换" onClose={() => {}}>
            <p>【{u.name}】本回合有敌方聚爆引爆，是否消耗 10 MP 切换形态？</p>
            <p className="muted small">切换后获得 1 点同步率，当前形态（{u.eimisForm === 'human' ? '人' : '机甲'}）的加成将永久保留，并对敌方全体施加 {stacks} 层聚爆。</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => onChooseEimisSwitch(true)}>切换形态（-10MP）</button>
              <button className="btn" onClick={() => onChooseEimisSwitch(false)}>暂不切换</button>
            </div>
          </Modal>
        );
      })()}
      {!battle.pendingChoice && battle.pendingGatesChoice && (() => {
        const u = battle.allies.find((a) => a.uid === battle.pendingGatesChoice!.uid);
        if (!u) return null;
        const cur = u.eightGates ?? 0;
        const max = u.eightGatesMax ?? 4;
        const atkPer = u.eightGatesAtkPerLayer ?? Math.floor((u.charLevel ?? 1) / 2);
        return (
          <Modal title="八门遁甲 · 抉择" onClose={() => {}}>
            <p>【{u.name}】当前八门遁甲 {cur}/{max} 层。</p>
            <p className="muted small">叠加 1 层：最大速度 +1，攻击力 +{atkPer}。回合末将受到 {(cur + 1) * 10} 点真实伤害（可用 MP 代替）。</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => onChooseGates(true)}>开启八门遁甲（+1层）</button>
              <button className="btn" onClick={() => onChooseGates(false)}>暂不开启</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

function logText(e: LogEntry, s: { allies: { uid: string; name: string }[]; enemies: { uid: string; name: string }[] }): string {
  const nameOf = (uid: string) => [...s.allies, ...s.enemies].find((u) => u.uid === uid)?.name ?? uid;
  switch (e.t) {
    case 'info': return e.text;
    case 'roll': return `— 第 ${e.turn} 回合 · 顺位已掷定 —`;
    case 'stun': return `【${e.name}】被眩晕，跳过行动`;
    case 'survive': return `【${e.name}】在致命一击下幸存，保留 1 点生命！`;
    case 'death': return `【${e.name}】倒下了`;
    case 'break': return `【${e.partName}】被摧毁！`;
    case 'summon': return `【${e.name}】召唤了【${e.targetName}】！`;
    case 'action': {
      const targets = e.targetUids.map(nameOf).join('、');
      return `【${nameOf(e.actorUid)}】${e.kind === 'attack' ? '普攻' : e.label}${targets ? ` → ${targets}` : ''}`;
    }
    case 'damage': {
      const typeLabel = e.type === 'magical' ? '法术' : e.type === 'true' ? '真实' : e.type === 'fixed' ? '固定' : '物理';
      const shieldTxt = e.blocked ? `（护盾抵消 ${e.blocked}）` : '';
      const dmgTxt = e.amount > 0 ? `受到 ${Math.round(e.amount)} 点${typeLabel}伤害` : e.blocked ? '伤害被护盾完全抵消' : `受到 0 点${typeLabel}伤害`;
      return `　${nameOf(e.targetUid)} ${dmgTxt}${shieldTxt}${e.killed ? '（击破）' : ''}`;
    }
    case 'heal':
      return `　${nameOf(e.targetUid)} 回复 ${e.amount} 点`;
    case 'shield':
      return `　${nameOf(e.targetUid)} 获得 ${e.amount} 点护盾`;
    case 'buff': {
      const b = BUFF_LIBRARY[e.buffId];
      return `　【${nameOf(e.uid)}】获得 ${b?.name ?? e.buffId}（${e.stacks}层·强度${e.intensity}）`;
    }
    default:
      return '';
  }
}
