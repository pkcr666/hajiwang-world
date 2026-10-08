import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AceUnit, Character, FixedDrop, Item, RunState, SaveData, StageMechanic } from './types';
import { mathRng } from './types';
import {
  deleteCharacter, firstEmptySlot, loadSave, upsertCharacter,
  abortRun, applySurvivorBags, persistRun, saveWriteTick, syncSaveFromServer,
  onSaveError,
} from './save/storage';
import { useDevice } from './hooks/useDevice';
import { Home } from './pages/Home';
import { Roster } from './pages/Roster';
import { CreateCharacter } from './pages/CreateCharacter';
import { Backpack } from './pages/Backpack';
import { Forge } from './pages/Forge';
import { Collection } from './pages/Collection';
import { Bestiary } from './pages/Bestiary';
import { Buffs } from './pages/Buffs';
import { EventLibrary } from './pages/EventLibrary';
import { BattleSetup } from './pages/BattleSetup';
import { AceLibrary } from './pages/AceLibrary';
import { Battle } from './pages/Battle';
import { Dungeons } from './pages/Dungeons';
import { PartySetup } from './pages/PartySetup';
import { CrisisSetup } from './pages/CrisisSetup';
import { RunMap } from './pages/RunMap';
import { RunEvent } from './pages/RunEvent';
import { RunMerchant } from './pages/RunMerchant';
import { RunRest } from './pages/RunRest';
import { RunTrade } from './pages/RunTrade';
import { RunSkirmish } from './pages/RunSkirmish';
import { RunRecruit } from './pages/RunRecruit';
import { RunAltar } from './pages/RunAltar';
import { RunFate } from './pages/RunFate';
import { RunLoot } from './pages/RunLoot';
import { RunPick } from './pages/RunPick';
import { RunAbort } from './pages/RunAbort';
import { RunRelicLab } from './pages/RunRelicLab';
import { Relics } from './pages/Relics';
import { Stages } from './pages/Stages';
import { Modal } from './components/Modal';
import OnlineLobby from './ui/OnlineLobby';
import OnlineRun from './ui/OnlineRun';
import OnlineBattle from './ui/OnlineBattle';
import { DUNGEONS } from './data/dungeons';
import { allItems, itemMapOf } from './data/content';
import { sumRelicSixStats } from './data/relics';
import { allEvents } from './data/events';
import { ACE_UNIT_MAP } from './data/aceUnits';
import { markEventSeen, rollEvent } from './engine/events';
import { normalizeParty, partyMembers, deployedMembers, deployedMemberIds } from './engine/party';
import {
  applyBattleHpMp, applyPickRewards, buildBattleRewards, findNode, plagueLetterHpDown, resolveNode,
  settleCrisisScore,
  type PickReward,
} from './engine/run';
import { characterLuck, collectExtraBonus, equippedIds, START_EXTRA } from './engine/stats';
import { buildAllyCombatant } from './engine/unit';
import { robMerchantShop, skirmishRewards } from './engine/nodes';
import { JOB_DEFS } from './data/jobs';
import { newId } from './save/storage';
import { crisisTermsToMechanics, adjustMonsterCountForDual } from './data/crisisContract';
import './App.css';

type RunSurvivor = { id: string; hp: number; mp: number; bag: { itemId: string; count: number }[] };

type View =
  | { p: 'home' }
  | { p: 'dungeons' }
  | { p: 'party'; dungeonId: string }
  | { p: 'crisis' }
  | { p: 'run' }
  | { p: 'runBattle'; nodeId: string; stageId?: string; rob?: boolean; battleKey: number; monsters?: { monsterId: string; count: number }[]; skirmish?: boolean; skirmishInfo?: { tier: number; snapshot: Record<string, { hp: number; mp: number }> }; skirmishMechanics?: StageMechanic[]; plaguePhase?: 'first' | 'second' }
  | { p: 'runEvent'; nodeId: string; eventId: string }
  | { p: 'runMerchant'; nodeId: string }
  | { p: 'runRest'; nodeId: string }
  | { p: 'runTrade'; nodeId: string }
  | { p: 'runFate'; nodeId: string }
  | { p: 'runSkirmish'; nodeId: string }
  | { p: 'runRecruit'; nodeId: string }
  | { p: 'runAltar'; nodeId: string }
  | { p: 'runPick'; nodeId: string; baseRun: RunState; rewards: PickReward[]; maxHp: Record<string, number>; plaguePhase?: 'first' | 'second'; skirmish?: boolean }
  | { p: 'runLoot' }
  | { p: 'runLab' }
  | { p: 'runAbort'; before: SaveData }
  | { p: 'relics' }
  | { p: 'stages' }
  | { p: 'roster' }
  | { p: 'create' }
  | { p: 'bag'; id: string }
  | { p: 'collection' }
  | { p: 'bestiary' }
  | { p: 'buffs' }
  | { p: 'eventLibrary' }
  | { p: 'setup' }
  | { p: 'forge' }
  | { p: 'aceLibrary' }
  | { p: 'onlineLobby' }
  | { p: 'onlineRun' }
  | { p: 'onlineBattle' }
  | { p: 'battle'; allies: Character[]; aceUnits?: AceUnit[]; enemyIds: string[]; mechanics?: StageMechanic[]; battleKey: number };

export default function App() {
  const [save, setSave] = useState(loadSave);
  const [view, setView] = useState<View>({ p: 'home' });
  // 时光之末：战斗失败后已结算的存档，等待玩家在弹窗中确认后回到副本地图
  const [failSaveInfo, setFailSaveInfo] = useState<{ s: SaveData } | null>(null);

  // 设备布局检测：手机端横屏 vs 桌面端，同步到 <html data-layout> 供全局 CSS 响应
  const layout = useDevice();
  useEffect(() => {
    document.documentElement.setAttribute('data-layout', layout);
  }, [layout]);

  // 开发环境：启动后与服务器存档（data/save.json）对齐，任何浏览器/标签页共用同一份数据；
  // 若本次会话已经改动过存档则不做回退覆盖。线上没有该接口，静默跳过。
  useEffect(() => {
    const tick = saveWriteTick();
    void syncSaveFromServer().then((s) => {
      if (s && saveWriteTick() === tick) setSave(s);
    });
  }, []);

  const goHome = () => setView({ p: 'home' });

  const createCharacter = (c: Character) => {
    const slot = firstEmptySlot(save);
    if (slot < 0) return;
    setSave(upsertCharacter(save, slot, c));
    setView({ p: 'bag', id: c.id });
  };

  // 快速创建：30级 + 钻石武器/甲/头 + 赫尔墨斯之靴 + 攻击护符 + 生命护符
  const quickCreateCharacter = (job: Character['job']) => {
    const slot = firstEmptySlot(save);
    if (slot < 0) return;
    const def = JOB_DEFS[job];
    const wt = def.allowedWeaponTypes[0] ?? 'melee';
    const weaponId = wt === 'melee' ? 'it_sword_diamond' : wt === 'ranged' ? 'it_bow_diamond' : 'it_staff_diamond';
    const extra = def.defaultExtra ?? { ...START_EXTRA };
    const c: Character = {
      id: newId('char'),
      name: `${def.name}`,
      job,
      level: 30,
      extra,
      baseExtra: { ...extra },
      freeExtraPoints: 20,
      equip: {
        weapon: weaponId,
        helmet: 'it_helmet_diamond',
        armor: 'it_armor_diamond',
        boots: 'it_boots_hermes',
        accessory: ['it_acc_atk', 'it_acc_hp'],
      },
      relics: [],
      inventory: [],
      bag: [],
      storage: [],
      coins: 0,
      createdAt: Date.now(),
    };
    setSave(upsertCharacter(save, slot, c));
    setView({ p: 'bag', id: c.id });
  };

  const removeCharacter = (slot: number) => {
    setSave(deleteCharacter(save, slot));
  };

  const startBattle = (allies: Character[], enemyIds: string[], mechanics?: StageMechanic[], aceUnits?: AceUnit[]) => {
    setView({ p: 'battle', allies, enemyIds, mechanics, aceUnits, battleKey: Date.now() });
  };

  // 副本内一场战斗结束：写回战斗内消耗的背包与继承 HP/MP；胜利进入掉落拾取，失败则团灭结算
  const finishRunBattle = (
    nodeId: string,
    result: 'win' | 'lose',
    survivors: RunSurvivor[],
    eventStageId?: string,
    rob?: boolean,
    bonusDrops?: FixedDrop[],
    skirmish?: { tier: number; snapshot: Record<string, { hp: number; mp: number }> },
    plaguePhase?: 'first' | 'second',
  ) => {
    const s0 = applySurvivorBags(save, survivors);
    const run0 = s0.activeRun;
    if (!run0) { setSave(s0); setView({ p: 'dungeons' }); return; }
    // 狭路相逢：无论胜负都恢复进入前 HP/MP；胜利获得档位奖励，失败无奖励
    if (skirmish) {
      let r = structuredClone(run0);
      r.hpMp = structuredClone(skirmish.snapshot);
      if (result !== 'win') {
        r.nodeStates = { ...r.nodeStates, [nodeId]: { kind: 'skirmish', used: true } };
        const cleared = resolveNode(r, nodeId);
        setSave(persistRun(s0, cleared));
        setView({ p: 'run' });
        return;
      }
      // 胜利：构建与正常作战一致的战利品卡片，进入拾取界面
      const rew = skirmishRewards(skirmish.tier);
      const rewards: PickReward[] = [];
      let keyIdx = 0;
      for (const st of rew.stones ?? []) {
        rewards.push({ key: `sk_m_${keyIdx++}`, kind: 'material', itemId: st.itemId, count: st.count });
      }
      if (rew.relic) rewards.push({ key: `sk_r_${keyIdx++}`, kind: 'relic', relicId: rew.relic });
      if (rew.item) rewards.push({ key: `sk_i_${keyIdx++}`, kind: 'item', itemId: rew.item });
      r.nodeStates = { ...r.nodeStates, [nodeId]: { kind: 'skirmish', used: true } };
      const members = partyMembers(r.party, s0.characters);
      const itemMap = itemMapOf(s0);
      const maxHp: Record<string, number> = {};
      members.forEach((c, i) => {
        maxHp[c.id] = buildAllyCombatant(c, itemMap, i, { relics: r.relics, relicStacks: r.relicStacks, killBook: r.killBook, maxHpPctDown: plagueLetterHpDown(r) }).maxHp;
      });
      setSave(s0);
      setView({ p: 'runPick', nodeId, baseRun: r, rewards, maxHp, skirmish: true });
      return;
    }
    if (result === 'lose') {
      const found = findNode(run0, nodeId);
      const isBoss = found?.node.kind === 'boss';
      const failSaveUsed = !!run0.failSaveUsed;
      if (run0.relics.includes('rl_time_end') && !isBoss && !failSaveUsed) {
        // 时光之末：非BOSS战失败时视为通过该节点（不获得奖励），并将全体角色恢复至40%最大生命（一次性）
        const members = partyMembers(run0.party, s0.characters);
        const itemMap = itemMapOf(s0);
        const maxHpMap: Record<string, number> = {};
        members.forEach((c, i) => {
          maxHpMap[c.id] = buildAllyCombatant(c, itemMap, i, {
            relics: run0.relics, relicStacks: run0.relicStacks, killBook: run0.killBook,
            maxHpPctDown: plagueLetterHpDown(run0),
          }).maxHp;
        });
        const revived = survivors.map((s) => ({
          ...s,
          hp: Math.max(1, Math.floor(maxHpMap[s.id] * 0.4)),
        }));
        let r = applyBattleHpMp(run0, revived);
        r.failSaveUsed = true;
        // 标记节点为已通过（无奖励）
        r = resolveNode(r, nodeId, undefined, undefined, true);
        // 先落盘并弹窗告知，玩家确认后再回到副本地图
        const nextSave = persistRun(s0, r);
        setFailSaveInfo({ s: nextSave });
        return;
      }
      // 团灭结算：先留快照供结算提示页对比「本局战果」
      const before = structuredClone(s0);
      // 危机合约：无论胜负都结算分数
      const scored = settleCrisisScore(s0, run0);
      setSave(abortRun(scored));
      setView({ p: 'runAbort', before });
      return;
    }
    const r = applyBattleHpMp(run0, survivors);
    if (rob) {
      // 抢商店胜利：标记本摊被抢（价格全0）+ 本局已抢，回货摊免费扫货（不推进节点、不给奖励）
      const r2 = robMerchantShop(r, nodeId);
      setSave(persistRun(s0, r2));
      setView({ p: 'runMerchant', nodeId });
      return;
    }
    const found = findNode(r, nodeId);
    // 战斗关卡来源：combat/boss 节点取节点 stageId；事件触发的战斗取传入的 eventStageId
    const stageId = found && (found.node.kind === 'combat' || found.node.kind === 'boss')
      ? found.node.stageId
      : eventStageId;
    const stage = stageId ? s0.customStages.find((x) => x.id === stageId) : undefined;
    // 天雷滚滚事件战后：煌雷龙加入队伍（仅胜利、未在队中时）
    if (stage?.name === '天雷滚滚' && !r.party.memberIds.includes('ace_huangleilong')) {
      r.party.memberIds.push('ace_huangleilong');
      r.aceUnits = [...(r.aceUnits ?? []), 'ace_huangleilong'];
      r.hpMp['ace_huangleilong'] = { hp: 700, mp: 100 };
      const cur = r.party.deployedIds ?? r.party.memberIds.slice(0, 3);
      if (cur.length < 3) r.party.deployedIds = [...cur, 'ace_huangleilong'];
    }
    const isCrisisStage = !!stageId && stageId.startsWith('cc_s1_');
    if (found && stage && !isCrisisStage) {
      // 杀戮尖塔式战后拾取：固定/随机/幸运掉落与火把全部产出为奖励卡片
      const members = partyMembers(r.party, s0.characters);
      const catalog = allItems(s0);
      const itemMap = itemMapOf(s0);
      const leader = members.find((c) => c.id === r.party.leaderId);
      const leaderLuck = (leader ? characterLuck(leader, itemMap) : 0) + sumRelicSixStats(r.relics).luk;
      const maxHp: Record<string, number> = {};
      members.forEach((c, i) => {
        maxHp[c.id] = buildAllyCombatant(c, itemMap, i, { relics: r.relics, relicStacks: r.relicStacks, killBook: r.killBook, maxHpPctDown: plagueLetterHpDown(r) }).maxHp;
      });
      const rewards = buildBattleRewards({
        items: catalog, run: r, node: found.node, stage, leaderLuck, rng: mathRng, bonusDrops,
      });
      setSave(s0);
      setView({ p: 'runPick', nodeId, baseRun: r, rewards, maxHp, plaguePhase });
      return;
    }
    // 关卡缺失等异常兜底 / 危机合约无掉落：直接推进节点
    const r2 = resolveNode(r, nodeId);
    let saved = persistRun(s0, r2);
    if (r2.result === 'win') saved = settleCrisisScore(saved, r2);
    setSave(saved);
    setView(r2.result === 'win' ? { p: 'runLoot' } : { p: 'run' });
  };

  // 拾取确认：藏品/消耗品按所选队员立即入包 → 推进节点（火把已作为拾取卡结算，不再重复判定）
  const confirmPick = (
    nodeId: string,
    baseRun: RunState,
    picked: PickReward[],
    maxHp: Record<string, number>,
    plaguePhase?: 'first' | 'second',
  ) => {
    const catalog = allItems(save);
    const { save: s2, run: r } = applyPickRewards(
      save, baseRun, picked, maxHp, new Map(catalog.map((i) => [i.id, i])),
    );
    let r2: RunState;
    if (plaguePhase === 'first') {
      // 瘟疫之源首战胜利：标记该节点首战已完成，正常推进节点；
      // 全局解锁瘟疫第二战，等下次进入任一瘟疫节点时触发（不重复使用同一节点）
      r2 = structuredClone(r);
      r2.nodeStates = { ...(r2.nodeStates ?? {}), [nodeId]: { kind: 'plague', phase: 'explored' } };
      r2.plaguePhase2Unlocked = true;
      r2 = resolveNode(r2, nodeId);
    } else if (plaguePhase === 'second') {
      // 瘟疫之源第二战胜利：获得痛苦之村的求救信，清除解锁标记，正常清理节点并推进
      r2 = structuredClone(r);
      if (!r2.relics.includes('rl_pain_village_letter')) r2.relics.push('rl_pain_village_letter');
      r2.nodeStates = { ...(r2.nodeStates ?? {}), [nodeId]: { kind: 'plague', phase: 'done' } };
      r2.plaguePhase2Unlocked = false;
      // 获得求救信后，下一层（及之后）的瘟疫节点不再刷新
      const curAct = typeof r2.act === 'number' ? r2.act : 0;
      for (let a = 1; a <= 7; a++) {
        if (a <= curAct) continue;
        const map = r2.acts[a as 1];
        if (!map) continue;
        const plagueIds = new Set(map.nodes.filter((n) => n.kind === 'plague').map((n) => n.id));
        if (plagueIds.size === 0) continue;
        map.nodes = map.nodes.filter((n) => !plagueIds.has(n.id));
        map.edges = map.edges.filter((e) => !plagueIds.has(e.from) && !plagueIds.has(e.to));
      }
      r2 = resolveNode(r2, nodeId);
    } else {
      r2 = resolveNode(r, nodeId);
    }
    let saved = persistRun(s2, r2);
    if (r2.result === 'win') saved = settleCrisisScore(saved, r2);
    setSave(saved);
    setView(r2.result === 'win' ? { p: 'runLoot' } : { p: 'run' });
  };

  // 点击不期而遇节点：按 当前副本+当前层数+出现条件 过滤随机抽一个事件；
  // 无可抽取事件时直接通过节点
  const startEncounter = (nodeId: string) => {
    const run = save.activeRun;
    if (!run) return;
    const floor = typeof run.act === 'number' ? run.act : 3;
    const ev = rollEvent(allEvents(save), run.dungeonId, floor, run, mathRng);
    if (!ev) {
      const r2 = resolveNode(run, nodeId);
      setSave(persistRun(save, r2));
      return;
    }
    // 标记本层已触发，避免同层重复刷出同一事件；重置多步事件计数
    const rSeen = markEventSeen(run, floor, ev.id);
    rSeen.eventStep = undefined;
    setSave(persistRun(save, rSeen));
    setView({ p: 'runEvent', nodeId, eventId: ev.id });
  };

  // 事件战斗结束 / 事件离开：清理节点回到地图
  const finishEncounter = (nodeId: string) => {
    const run = save.activeRun;
    if (!run) { setView({ p: 'run' }); return; }
    const r2 = resolveNode(run, nodeId);
    setSave(persistRun(save, r2));
    setView(r2.result === 'win' ? { p: 'runLoot' } : { p: 'run' });
  };

  if (view.p === 'home') {
    return (
      <Shell onHome={goHome} showHome={false}>
        <Home go={(p) => setView({ p })} />
      </Shell>
    );
  }

  if (view.p === 'onlineLobby') {
    return (
      <Shell onHome={goHome}>
        <OnlineLobby save={save} onBack={goHome} onRunStart={() => setView({ p: 'onlineRun' })} />
      </Shell>
    );
  }

  if (view.p === 'onlineRun') {
    return (
      <Shell onHome={goHome}>
        <OnlineRun onBattle={() => setView({ p: 'onlineBattle' })} onBack={goHome} />
      </Shell>
    );
  }

  if (view.p === 'onlineBattle') {
    return (
      <Shell onHome={goHome}>
        <OnlineBattle onMap={() => setView({ p: 'onlineRun' })} />
      </Shell>
    );
  }

  if (view.p === 'dungeons') {
    return (
      <Shell onHome={goHome}>
        <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
      </Shell>
    );
  }

  if (view.p === 'party') {
    const dungeon = DUNGEONS.find((d) => d.id === view.dungeonId) ?? DUNGEONS[0];
    return (
      <Shell onHome={goHome}>
        <PartySetup
          save={save}
          dungeon={dungeon}
          onChange={setSave}
          onBack={() => setView({ p: 'dungeons' })}
          onLaunch={() => setView({ p: 'run' })}
          onContinue={() => setView({ p: 'run' })}
        />
      </Shell>
    );
  }

  if (view.p === 'crisis') {
    return (
      <Shell onHome={goHome}>
        <CrisisSetup
          save={save}
          onChange={setSave}
          onBack={() => setView({ p: 'dungeons' })}
          onLaunch={() => setView({ p: 'run' })}
        />
      </Shell>
    );
  }

  if (view.p === 'run') {
    if (!save.activeRun) {
      return (
        <Shell onHome={goHome}>
          <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
        </Shell>
      );
    }
    return (
      <Shell onHome={goHome}>
        <RunMap
          save={save}
          onChange={setSave}
          onBattle={(nodeId) =>
            setView({ p: 'runBattle', nodeId, battleKey: Date.now() })}
          onEncounter={startEncounter}
          onMerchant={(nodeId) => setView({ p: 'runMerchant', nodeId })}
          onRest={(nodeId) => setView({ p: 'runRest', nodeId })}
          onTrade={(nodeId) => setView({ p: 'runTrade', nodeId })}
          onFate={(nodeId) => setView({ p: 'runFate', nodeId })}
          onSkirmish={(nodeId) => setView({ p: 'runSkirmish', nodeId })}
          onRecruit={(nodeId) => setView({ p: 'runRecruit', nodeId })}
          onAltar={(nodeId) => setView({ p: 'runAltar', nodeId })}
          onPlagueBattle={(nodeId, stageId, phase) =>
            setView({ p: 'runBattle', nodeId, stageId, plaguePhase: phase, battleKey: Date.now() })}
          onExit={() => setView({ p: 'dungeons' })}
          onLab={() => {
            // 标记本局使用过遗物测试界面，并永久标记所有编队成员（名册显示"外挂"角标）
            if (save.activeRun) {
              const next = structuredClone(save);
              const run = next.activeRun!;
              run.labUsed = true;
              for (const id of run.party.memberIds) {
                const c = next.characters.find((x) => x?.id === id);
                if (c) c.labUsed = true;
              }
              setSave(next);
            }
            setView({ p: 'runLab' });
          }}
        />
      </Shell>
    );
  }

  if (view.p === 'runBattle') {
    const run = save.activeRun;
    const found = run ? findNode(run, view.nodeId) : null;
    const isFight = !!found && (found.node.kind === 'combat' || found.node.kind === 'boss' || view.skirmish);
    // 抢商店BOSS战（view.rob）不走关卡，直接打袁绍；狭路相逢用 view.monsters
    const stage = view.rob || view.skirmish ? undefined : (isFight && found.node.stageId
      ? save.customStages.find((s) => s.id === found.node.stageId)
      : view.stageId
        ? save.customStages.find((s) => s.id === view.stageId)
        : undefined);
    // 节点失效（无 run / 关卡被删）→ 回地图
    if (!run || !found || (!stage && !view.rob && !view.skirmish)) {
      return (
        <Shell onHome={goHome}>
          <RunMap
            save={save}
            onChange={setSave}
            onBattle={(nodeId) =>
              setView({ p: 'runBattle', nodeId, battleKey: Date.now() })}
            onEncounter={startEncounter}
            onMerchant={(nodeId) => setView({ p: 'runMerchant', nodeId })}
            onRest={(nodeId) => setView({ p: 'runRest', nodeId })}
            onTrade={(nodeId) => setView({ p: 'runTrade', nodeId })}
            onSkirmish={(nodeId) => setView({ p: 'runSkirmish', nodeId })}
            onRecruit={(nodeId) => setView({ p: 'runRecruit', nodeId })}
            onAltar={(nodeId) => setView({ p: 'runAltar', nodeId })}
            onPlagueBattle={(nodeId, stageId, phase) =>
              setView({ p: 'runBattle', nodeId, stageId, plaguePhase: phase, battleKey: Date.now() })}
            onExit={() => setView({ p: 'dungeons' })}
          />
        </Shell>
      );
    }
    const allies = deployedMembers(run.party, save.characters);
    // 王牌单位：临时队友（仅上场名单中的；Set 去重防存档/历史双写入导致重复单位）
    const deployedSet = new Set(deployedMemberIds(run.party));
    const aceList = [...new Set(run.aceUnits ?? [])].filter((id) => deployedSet.has(id)).map((id) => ACE_UNIT_MAP[id]).filter(Boolean);
    // 危机合约：应用词条 mechanics 与双人怪物数量调整
    const isCrisis = run.dungeonId === 'crisisContract' && !!run.crisis;
    const crisisStageId = isCrisis && found.node.stageId ? found.node.stageId : null;
    const crisisMechanics = isCrisis && crisisStageId
      ? crisisTermsToMechanics(run.crisis!.termIds, crisisStageId)
      : [];
    const baseMonsters = view.rob
      ? [{ monsterId: 'yuanShao', count: 1 }]
      : view.monsters ?? stage!.monsters;
    const adjustedMonsters = isCrisis
      ? adjustMonsterCountForDual(baseMonsters, run.crisis!.mode)
      : baseMonsters;
    // 作战与 BOSS 统一从关卡怪物槽展开（BOSS 关由玩家创建）；抢商店固定打袁绍
    const enemyIds = adjustedMonsters.flatMap((m) => Array(m.count).fill(m.monsterId));
    const mergedMechanics = view.rob
      ? undefined
      : view.skirmish
        ? (view.skirmishMechanics ?? [])
        : [...(stage!.mechanics ?? []), ...crisisMechanics];
    // 抢商店勾引判定用：队长魅力（六维 + 装备加成 + 遗物六维），与货摊砍价同源
    const leaderCha = view.rob ? (() => {
      const leader = allies.find((c) => c.id === run.party.leaderId);
      if (!leader) return 0;
      const itemMap = itemMapOf(save);
      const equipped = equippedIds(leader.equip)
        .map((id) => itemMap.get(id))
        .filter((x): x is Item => !!x);
      return (leader.extra.cha ?? 0)
        + (collectExtraBonus(equipped).cha ?? 0)
        + sumRelicSixStats(run.relics ?? []).cha;
    })() : undefined;
    const proceedAfterFailSave = () => {
      if (!failSaveInfo) return;
      setSave(failSaveInfo.s);
      setFailSaveInfo(null);
      setView({ p: 'run' });
    };
    return (
      <>
        <Battle
          key={view.battleKey}
          save={save}
          allies={allies}
          aceUnits={aceList}
          enemyIds={enemyIds}
          mechanics={mergedMechanics}
          onHome={goHome}
          runMode={{
            initialHpMp: new Map(Object.entries(run.hpMp)),
            relicIds: run.relics ?? [],
            relicStacks: run.relicStacks,
            killBook: run.killBook,
            maxHpPctDown: plagueLetterHpDown(run),
            recruitUnitBonuses: run.recruitUnitBonuses,
            leaderId: run.party.leaderId,
            robChoice: view.rob ?? undefined,
            leaderCha,
            onSpendCoins: (amount) => {
              const cur = save.activeRun;
              if (!cur) return;
              setSave(persistRun(save, { ...cur, coins: Math.max(0, cur.coins - amount) }));
            },
            onSwitchLeader: (id) => {
              const cur = save.activeRun;
              if (!cur) return;
              const next = { ...cur, party: normalizeParty(id, cur.party.memberIds) };
              setSave(persistRun(save, next));
            },
            endgame: run.relics.includes('rl_endgame_link'),
            fateBossDebuffs: run.fateBossDebuffs,
            crisisTermIds: run.crisis?.termIds,
            onFinish: (result, survivors, bonusDrops) => finishRunBattle(view.nodeId, result, survivors, view.stageId, view.rob, bonusDrops, view.skirmishInfo, view.plaguePhase),
          }}
        />
        {failSaveInfo && (
          <Modal title="时光之末" onClose={proceedAfterFailSave}>
            <p className="warn">
              时光之末发动！全员复活并恢复至 40% 最大生命，本次失败视为已通过该节点，
              <b>但不获得任何奖励</b>（此效果每局仅一次）。
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={proceedAfterFailSave}>继续前行</button>
            </div>
          </Modal>
        )}
      </>
    );
  }

  if (view.p === 'runEvent') {
    if (!save.activeRun) {
      return (
        <Shell onHome={goHome}>
          <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
        </Shell>
      );
    }
    return (
      <Shell onHome={goHome}>
        <RunEvent
          save={save}
          nodeId={view.nodeId}
          eventId={view.eventId}
          onChange={setSave}
          onBack={() => finishEncounter(view.nodeId)}
          onBattle={(stageId) =>
            setView({ p: 'runBattle', nodeId: view.nodeId, stageId, battleKey: Date.now() })}
        />
      </Shell>
    );
  }

  if (view.p === 'runMerchant') {
    if (!save.activeRun) {
      return (
        <Shell onHome={goHome}>
          <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
        </Shell>
      );
    }
    return (
      <Shell onHome={goHome}>
        <RunMerchant
          save={save}
          nodeId={view.nodeId}
          onChange={setSave}
          onBack={() => setView({ p: 'run' })}
          onRob={() => setView({ p: 'runBattle', nodeId: view.nodeId, rob: true, battleKey: Date.now() })}
        />
      </Shell>
    );
  }

  if (view.p === 'runRest') {
    if (!save.activeRun) {
      return (
        <Shell onHome={goHome}>
          <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
        </Shell>
      );
    }
    return (
      <Shell onHome={goHome}>
        <RunRest save={save} nodeId={view.nodeId} onChange={setSave} onBack={() => setView({ p: 'run' })} />
      </Shell>
    );
  }

  if (view.p === 'runTrade') {
    if (!save.activeRun) {
      return (
        <Shell onHome={goHome}>
          <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
        </Shell>
      );
    }
    return (
      <Shell onHome={goHome}>
        <RunTrade save={save} nodeId={view.nodeId} onChange={setSave} onBack={() => setView({ p: 'run' })} />
      </Shell>
    );
  }

  if (view.p === 'runFate') {
    if (!save.activeRun) {
      return (
        <Shell onHome={goHome}>
          <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
        </Shell>
      );
    }
    return (
      <Shell onHome={goHome}>
        <RunFate save={save} nodeId={view.nodeId} onChange={setSave} onBack={() => setView({ p: 'run' })} />
      </Shell>
    );
  }

  if (view.p === 'runSkirmish') {
    return (
      <Shell onHome={goHome}>
        <RunSkirmish save={save} nodeId={view.nodeId} onBack={() => setView({ p: 'run' })}
          onBattle={(nodeId, monsters, tier, snapshot, stageId, mechanics) =>
            setView({ p: 'runBattle', nodeId, stageId, battleKey: Date.now(), monsters, skirmish: true, skirmishInfo: { tier, snapshot }, skirmishMechanics: mechanics })} />
      </Shell>
    );
  }

  if (view.p === 'runRecruit') {
    return (
      <Shell onHome={goHome}>
        <RunRecruit save={save} nodeId={view.nodeId} onChange={setSave} onBack={() => setView({ p: 'run' })} />
      </Shell>
    );
  }

  if (view.p === 'runAltar') {
    return (
      <Shell onHome={goHome}>
        <RunAltar save={save} nodeId={view.nodeId} onChange={setSave} onBack={() => setView({ p: 'run' })} />
      </Shell>
    );
  }

  if (view.p === 'runPick') {
    const members = partyMembers(view.baseRun.party, save.characters);
    return (
      <Shell onHome={goHome}>
        <RunPick
          save={save}
          rewards={view.rewards}
          ownedRelics={view.baseRun.relics}
          dungeonId={view.baseRun.dungeonId}
          members={members}
          leaderId={view.baseRun.party.leaderId}
          onConfirm={(picked) => confirmPick(view.nodeId, view.baseRun, picked, view.maxHp, view.plaguePhase)}
        />
      </Shell>
    );
  }

  if (view.p === 'runLoot') {
    if (!save.activeRun) {
      return (
        <Shell onHome={goHome}>
          <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
        </Shell>
      );
    }
    return (
      <Shell onHome={goHome}>
        <RunLoot
          save={save}
          onChange={setSave}
          onDone={() => setView({ p: 'dungeons' })}
        />
      </Shell>
    );
  }

  if (view.p === 'runLab') {
    if (!save.activeRun) {
      return (
        <Shell onHome={goHome}>
          <Dungeons onBack={goHome} onStart={(d) => setView(d.id === 'crisisContract' ? { p: 'crisis' } : { p: 'party', dungeonId: d.id })} />
        </Shell>
      );
    }
    return (
      <Shell onHome={goHome}>
        <RunRelicLab save={save} onChange={setSave} onBack={() => setView({ p: 'run' })} />
      </Shell>
    );
  }

  if (view.p === 'runAbort') {
    return (
      <Shell onHome={goHome}>
        <RunAbort save={save} before={view.before} onClose={() => setView({ p: 'dungeons' })} />
      </Shell>
    );
  }

  if (view.p === 'relics') {
    return (
      <Shell onHome={goHome}>
        <Relics onBack={goHome} />
      </Shell>
    );
  }

  if (view.p === 'stages') {
    return (
      <Shell onHome={goHome}>
        <Stages save={save} onChange={setSave} />
      </Shell>
    );
  }

  if (view.p === 'roster') {
    return (
      <Shell onHome={goHome}>
        <Roster
          save={save}
          onOpen={(id) => setView({ p: 'bag', id })}
          onCreate={() => setView({ p: 'create' })}
          onQuickCreate={quickCreateCharacter}
          onDelete={removeCharacter}
        />
      </Shell>
    );
  }

  if (view.p === 'create') {
    return (
      <Shell onHome={goHome}>
        <CreateCharacter
          save={save}
          onCancel={() => setView({ p: 'roster' })}
          onCreate={createCharacter}
        />
      </Shell>
    );
  }

  if (view.p === 'bag') {
    return (
      <Shell onHome={goHome}>
        <Backpack
          save={save}
          id={view.id}
          onBack={() => setView({ p: 'roster' })}
          onGoCollection={() => setView({ p: 'collection' })}
          onChange={setSave}
        />
      </Shell>
    );
  }

  if (view.p === 'collection') {
    return (
      <Shell onHome={goHome}>
        <Collection save={save} onChange={setSave} />
      </Shell>
    );
  }

  if (view.p === 'bestiary') {
    return (
      <Shell onHome={goHome}>
        <Bestiary save={save} onChange={setSave} />
      </Shell>
    );
  }

  if (view.p === 'buffs') {
    return (
      <Shell onHome={goHome}>
        <Buffs />
      </Shell>
    );
  }

  if (view.p === 'eventLibrary') {
    return (
      <Shell onHome={goHome}>
        <EventLibrary save={save} onChange={setSave} onBack={goHome} />
      </Shell>
    );
  }

  if (view.p === 'setup') {
    return (
      <Shell onHome={goHome}>
        <BattleSetup
          save={save}
          onStart={startBattle}
          onBack={goHome}
        />
      </Shell>
    );
  }

  if (view.p === 'forge') {
    return (
      <Shell onHome={goHome}>
        <Forge save={save} onBack={goHome} onChange={setSave} />
      </Shell>
    );
  }

  if (view.p === 'aceLibrary') {
    return (
      <Shell onHome={goHome}>
        <AceLibrary onBack={goHome} />
      </Shell>
    );
  }

  return (
    <Battle
      key={view.battleKey}
      save={save}
      allies={view.allies}
      aceUnits={view.aceUnits}
      enemyIds={view.enemyIds}
      mechanics={view.mechanics}
      onRematch={() => setView({ ...view, battleKey: Date.now() })}
      onSetup={() => setView({ p: 'setup' })}
      onHome={goHome}
    />
  );
}

function Shell({ children, onHome, showHome = true }: {
  children: ReactNode;
  onHome: () => void;
  showHome?: boolean;
}) {
  const layout = useDevice();
  const isMobile = layout === 'mobile';
  const [zoom, setZoom] = useState<number>(() => {
    // 手机端不使用缩放变换，固定 100%，避免 transform 导致的主框偏移
    if (isMobile) return 1;
    try {
      const v = localStorage.getItem('appZoom');
      return v ? Math.max(0.5, Math.min(1.5, Number(v))) : 1;
    } catch {
      return 1;
    }
  });
  const [showZoom, setShowZoom] = useState(false);
  const zoomTimer = useRef<number | null>(null);
  const applyZoom = (z: number) => {
    setZoom(z);
    try { localStorage.setItem('appZoom', String(z)); } catch { /* ignore */ }
  };
  // 缩放样式：桌面端用 transform scale 整体缩放；手机端禁用缩放，靠 CSS 自适应
  const zoomStyle: React.CSSProperties = isMobile
    ? {}
    : {
        transform: `scale(${zoom})`,
        transformOrigin: 'top left',
        width: `${100 / zoom}%`,
      };
  return (
    <div className="shell">
      <SaveErrorToast />
      <header className="topbar">
        <span className="topbar-title" onClick={onHome}>哈基汪世界</span>
        <div className="topbar-actions">
          {showHome && <button className="btn-mini btn" onClick={onHome}>主界面</button>}
          {!isMobile && (
            <button
              className="btn-mini btn"
              onClick={() => {
                setShowZoom((v) => !v);
                if (zoomTimer.current) window.clearTimeout(zoomTimer.current);
                zoomTimer.current = window.setTimeout(() => setShowZoom(false), 6000);
              }}
              title="屏幕缩放"
            >🔍 {Math.round(zoom * 100)}%</button>
          )}
        </div>
      </header>
      {showZoom && (
        <div className="zoom-panel card">
          <div className="zoom-presets">
            {[0.7, 0.85, 1, 1.15, 1.3].map((z) => (
              <button
                key={z}
                className={`btn-mini btn ${Math.abs(zoom - z) < 0.01 ? 'primary' : ''}`}
                onClick={() => applyZoom(z)}
              >{Math.round(z * 100)}%</button>
            ))}
          </div>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="zoom-slider"
          />
          <span className="muted small">当前 {Math.round(zoom * 100)}% · 拖动调整以适配屏幕</span>
        </div>
      )}
      <main className="content" style={zoomStyle}>{children}</main>
    </div>
  );
}

// 存档写入失败提示（自订阅 storage.onSaveError，全局仅此一处渲染即可）
function SaveErrorToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    onSaveError(setMsg);
    return () => onSaveError(null);
  }, []);
  if (!msg) return null;
  return (
    <div className="save-error-banner" role="alert">
      <span>{msg}</span>
      <button className="btn-mini btn" onClick={() => setMsg(null)}>知道了</button>
    </div>
  );
}
