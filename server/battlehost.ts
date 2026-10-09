// 联机战斗托管：服务器权威持有 BattleState，客户端只提交指令/弹窗选择
import type { BattleState, Combatant, Item, Rng, StageDef } from '../src/types';
import { mathRng } from '../src/types';
import {
  advance, applyRelics, createBattle, currentActor, enemyAct, getLegalActions, playerAct, resolveBrokenArk,
  resolveGatesChoice, resolveKaynForm, resolveReaction, resolveRobChoice, resolveYinglongCheck,
} from '../src/engine/battle';
import { buildAceCombatant, buildAllyCombatant, buildEnemyCombatants } from '../src/engine/unit';
import { ACE_UNIT_MAP } from '../src/data/aceUnits';
import { plagueLetterHpDown } from '../src/engine/run';
import type { BattleView, PopupKind, PopupView, UnitView } from '../src/net/proto';
import type { GameState, PlayerChar } from './runhost';

export interface BattleCallbacks {
  broadcast: (view: BattleView) => void; // 每个玩家独立视图（myAllyUid 不同）
  onEnd: (result: 'win' | 'lose', survivors: { id: string; hp: number; mp: number }[]) => void;
  log: (text: string) => void;
}

export class BattleHost {
  battleId = `b_${Date.now().toString(36)}`;
  state: BattleState;
  result: 'win' | 'lose' | null = null;
  stageName: string;
  private deployed: string[]; // charId 顺序 ↔ ally_{i}
  private uidToChar: Map<string, string>;
  private aceUidOwner: Map<string, string>; // 王牌单位 uid -> 拥有者 charId
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activePopup: PopupView | null = null; // 当前待处理弹窗（viewFor 必须带上，否则客户端收不到）

  constructor(
    private game: GameState,
    private players: PlayerChar[],
    private cb: BattleCallbacks,
    private stage: StageDef,
    private rng: Rng = mathRng,
  ) {
    this.deployed = [...(game.run.party.deployedIds ?? game.run.party.memberIds)];
    this.stageName = stage.name;
    const allies: Combatant[] = this.deployed.map((cid, i) => {
      const c = game.save.characters.find((x) => x?.id === cid)!;
      return buildAllyCombatant(c, game.itemMap, i, {
        relics: [...(game.perRelics[cid] ?? [])],
        relicStacks: game.perRelicStacks[cid] ?? {},
        killBook: game.run.killBook,
        maxHpPctDown: plagueLetterHpDown(game.run),
      });
    });
    this.aceUidOwner = new Map();
    // 王牌单位：跟随其玩家出战（追加在角色之后，由该玩家操作）
    this.deployed.forEach((cid) => {
      const aceId = game.perAce[cid];
      if (!aceId) return;
      const ace = ACE_UNIT_MAP[aceId];
      if (!ace) return;
      const u = buildAceCombatant(ace, allies.length);
      u.uid = `ally_${allies.length}`;
      allies.push(u);
      this.aceUidOwner.set(u.uid, cid);
    });
    const monsterMap = game.monsterMap;
    const enemies: Combatant[] = [];
    stage.monsters.forEach((m, idx) => {
      const mu = monsterMap.get(m.monsterId);
      if (!mu) return;
      enemies.push(...buildEnemyCombatants(mu, idx, monsterMap, stage.mechanics, false));
    });
    // 新手村（终局联系）自适应难度：怪物 HP 按人数缩放（1人100% / 2人150% / 3人及以上200%）；灾厄泰拉不缩放
    if (game.run.dungeonId === 'starterVillage') {
      const hpScale = players.length >= 3 ? 2 : players.length === 2 ? 1.5 : 1;
      if (hpScale !== 1) {
        for (const e of enemies) {
          e.maxHp = Math.round(e.maxHp * hpScale);
          e.hp = e.maxHp;
        }
      }
    }
    this.state = createBattle(allies, enemies, this.rng);
    this.uidToChar = new Map();
    this.state.allies.forEach((a, i) => {
      if (i < this.deployed.length) this.uidToChar.set(a.uid, this.deployed[i] ?? '');
      else this.uidToChar.set(a.uid, this.aceUidOwner.get(a.uid) ?? '');
    });
    // 遗物逐玩家应用（联机 v2：遗物只作用于自己单位；同名遗物全局只触发一次）
    const claimed = new Set<string>();
    for (const p of players) {
      const mine: string[] = [];
      for (const rid of game.perRelics[p.char.id] ?? []) {
        if (claimed.has(rid)) continue; // 同名已被前一个玩家声明
        claimed.add(rid);
        mine.push(rid);
      }
      if (mine.length > 0) {
        this.state = applyRelics(this.state, mine, game.run.torches, game.run.coins, 0, this.unitUidsOf(p.playerId));
      }
    }
  }

  // 构造完成后由房间调用：首帧广播 + 推进到等待输入
  start(): void {
    this.broadcast();
    this.tick();
  }

  private ownerOf(uid: string): string | null {
    const charId = this.uidToChar.get(uid);
    if (!charId) return null;
    const p = this.players.find((x) => x.char.id === charId);
    return p ? p.playerId : null;
  }

  // 该玩家可操作的全部单位 uid（角色 + 自己招募的王牌单位）
  private unitUidsOf(playerId: string): Set<string> {
    const p = this.players.find((x) => x.playerId === playerId);
    if (!p) return new Set();
    const set = new Set<string>();
    this.state.allies.forEach((a, i) => {
      if (i < this.deployed.length) {
        if (this.deployed[i] === p.char.id) set.add(a.uid);
      } else if (this.aceUidOwner.get(a.uid) === p.char.id) {
        set.add(a.uid);
      }
    });
    return set;
  }

  private hostId(): string {
    return this.players[0]!.playerId;
  }

  private popup(kind: PopupKind, title: string, desc: string, options: { id: string; label: string }[], ownerPlayerId: string, extra?: { reaction?: PopupView['reaction']; brokenArk?: PopupView['brokenArk'] }): void {
    const p: PopupView = { kind, title, desc, options, ownerPlayerId, ...(extra ?? {}) };
    this.activePopup = p;
    this.cb.broadcast(this.buildView(p));
  }

  private broadcast(): void {
    this.cb.broadcast(this.buildView(this.activePopup ?? undefined));
  }

  buildView(popup?: PopupView): BattleView {
    const s = this.state;
    const unit = (u: Combatant): UnitView => ({
      uid: u.uid,
      name: u.name,
      isAlly: u.side === 'ally',
      icon: u.icon,
      hp: u.hp,
      maxHp: u.maxHp,
      mp: u.mp,
      maxMp: u.maxMp,
      atk: u.stats.atk,
      def: u.stats.def,
      mres: u.stats.mres,
      alive: u.alive,
      roll: u.roll,
      buffs: (u.buffs ?? []).slice(0, 4).map((b) => ({ name: b.name ?? b.id, stacks: b.stacks })),
      shield: u.shield,
    });
    return {
      battleId: this.battleId,
      stageName: this.stageName,
      turn: s.turn,
      order: s.order,
      cursor: s.cursor,
      acterUid: s.order[s.cursor] ?? null,
      myAllyUid: null, // 每个玩家注入自己的
      myUnits: [], // 每个玩家注入自己的
      allies: s.allies.map(unit),
      enemies: s.enemies.map(unit),
      popup,
      result: s.result ?? undefined,
      logTail: s.log.slice(-6).map((l) => ('text' in l ? l.text : `[${l.t}]`)),
      full: s, // 完整状态：前端复用单人战斗 UI
    };
  }

  viewFor(playerId: string): BattleView {
    const v = this.buildView(this.activePopup ?? undefined);
    v.myAllyUid = null;
    v.myUnits = [];
    const p = this.players.find((x) => x.playerId === playerId);
    if (p) {
      const idx = this.deployed.indexOf(p.char.id);
      if (idx >= 0) v.myAllyUid = `ally_${idx}`;
      v.myUnits = [...this.unitUidsOf(playerId)];
      const actor = this.state.order[this.state.cursor]
        ? this.state.allies.find((a) => a.uid === this.state.order[this.state.cursor])
        : null;
      if (actor && actor.side === 'ally' && v.myUnits.includes(actor.uid)) {
        v.mySkills = (actor.skills ?? []).map((sk) => ({ id: sk.id, name: sk.name, mpCost: sk.mpCost }));
        // 合法行动（对齐单人版 getLegalActions）：过滤被动、预计算自动目标、禁用原因
        const legal = getLegalActions(this.state, this.game.itemMap);
        v.myLegal = {
          canAttack: legal.canAttack,
          attackAll: legal.attackAll,
          skills: legal.skills.map((ls) => ({
            id: ls.skill.id,
            name: ls.skill.name,
            mpCost: ls.skill.mpCost ?? 0,
            targetUids: ls.targetUids ?? null,
            disabled: ls.disabled,
            reason: ls.reason,
            costText: ls.costText,
            desc: ls.skill.desc,
            enhance: ls.skill.enhanceMpCost
              ? {
                  mpCost: ls.skill.enhanceMpCost ?? 0,
                  kamuiCost: ls.skill.enhanceKamuiCost ?? 0,
                  mulBonus: ls.skill.enhanceMulBonus ?? 0,
                }
              : undefined,
          })),
          items: legal.items.map((li) => ({
            itemId: li.item.id,
            name: li.item.name,
            count: li.count,
            targetUids: li.targetUids,
          })),
        };
      }
    }
    return v;
  }

  // 推进战斗直到需要玩家输入（我方行动 / 弹窗）或战斗结束
  private tick(guard = 0): void {
    if (guard > 400) {
      this.cb.log('战斗推进异常：超过推进上限，自动结束');
      this.state = { ...this.state, result: 'lose' };
      this.finish();
      return;
    }
    const s = this.state;
    if (s.result) { this.finish(); return; }
    // 回合开始流水线弹窗：应龙（房主）/ 袁绍（房主）/ 凯隐（角色主）/ 小李八门（角色主）
    if (s.pendingChoice) {
      this.popup('yuanShao', '抢商店抉择', '袁绍出现！本回合开始前，房主决定如何应对：', [
        { id: 'worship', label: '讨好（防御法抗减半2回合）' },
        { id: 'seduce', label: '魅惑（魅力判定，成功造成真实伤害）' },
        { id: 'bribe', label: '砸币（按队长魅力削减其攻击）' },
      ], this.hostId());
      return;
    }
    if (s.pendingKaynForm) {
      const owner = this.ownerOf(s.pendingKaynForm.uid) ?? this.hostId();
      this.popup('kayn', '凯隐形态选择', '凯隐需要选择开局形态：', [
        { id: 'red', label: '红凯（吸血爆发）' },
        { id: 'blue', label: '蓝凯（灵活控场）' },
      ], owner);
      return;
    }
    if (s.pendingGatesChoice) {
      const owner = this.ownerOf(s.pendingGatesChoice.uid) ?? this.hostId();
      this.popup('gates', '八门遁甲抉择', '是否开启八门遁甲？（最大速度+1、攻击+层数/2）', [
        { id: 'yes', label: '开启' },
        { id: 'no', label: '不开' },
      ], owner);
      return;
    }
    if (s.yinglongCheck?.pending) {
      const opts = (s.yinglongCheck.available ?? ['str', 'int', 'agi', 'wil', 'luk', 'cha']).map((st) => ({
        id: st,
        label: ({ str: '力量', int: '智力', agi: '敏捷', wil: '意志', luk: '幸运', cha: '魅力' } as Record<string, string>)[st] ?? st,
      }));
      this.popup('yinglong', '应龙六维判定', `选择判定属性（目标值 ${s.yinglongCheck.target}）：`, opts, this.hostId());
      return;
    }
    // 反应式弹窗（虚化/哈气/破碎方舟）：发给被攻击单位的主人选择
    if (s.pendingReaction) {
      const pr = s.pendingReaction;
      const owner = this.ownerOf(pr.targetUid) ?? this.hostId();
      this.popup('reaction', '反应式抉择', '我方单位即将受到攻击，是否使用反应式技能应对？', [
        { id: 'yes', label: '使用' },
        { id: 'no', label: '不使用' },
      ], owner, {
        reaction: { attackerUid: pr.attackerUid, targetUid: pr.targetUid, skillId: pr.skillId, action: pr.action.kind },
      });
      return;
    }
    if (s.pendingBrokenArk) {
      const pb = s.pendingBrokenArk;
      const owner = this.ownerOf(pb.targetUid) ?? this.hostId();
      this.popup('brokenArk', '破碎方舟', '我方单位即将受到伤害，是否启动破碎方舟抵消？', [
        { id: 'yes', label: '启动方舟' },
        { id: 'no', label: '硬抗' },
      ], owner, {
        brokenArk: { targetUid: pb.targetUid, attackerUid: pb.attackerUid, toHp: pb.toHp },
      });
      return;
    }
    const actor = s.order[s.cursor] ? (s.allies.find((a) => a.uid === s.order[s.cursor]) ?? s.enemies.find((e) => e.uid === s.order[s.cursor])) : null;
    if (actor && actor.side === 'ally') {
      // 等待绑定该角色的玩家行动
      this.broadcast();
      return;
    }
    // 敌方行动：执行敌方动作（可能触发反应/破碎方舟弹窗），再推进光标
    const r = enemyAct(s, this.rng);
    this.state = r.state;
    if (this.state.result) { this.finish(); return; }
    if (this.state.pendingReaction || this.state.pendingBrokenArk) {
      this.tick(guard + 1); // 弹出反应式/破碎方舟抉择，等玩家选择
      return;
    }
    const next = advance(this.state, this.rng);
    this.state = next;
    this.tick(guard + 1);
  }

  // 玩家提交行动：必须是当前行动者且属于该玩家
  onAct(playerId: string, action: { type: 'attack'; targetUid: string } | { type: 'skill'; skillId: string; targetUid?: string; enhance?: boolean } | { type: 'item'; itemId: string; targetUid: string }): { ok: boolean; err?: string } {
    if (this.result) return { ok: false, err: '战斗已结束' };
    const s = this.state;
    if (s.pendingChoice || s.pendingKaynForm || s.pendingGatesChoice || s.yinglongCheck?.pending || s.pendingReaction || s.pendingBrokenArk) {
      return { ok: false, err: '请先处理弹窗选择' };
    }
    const actor = currentActor(s);
    if (!actor || actor.side !== 'ally' || !actor.alive) return { ok: false, err: '当前行动者不是我方角色' };
    const owner = this.ownerOf(actor.uid);
    if (owner !== playerId) return { ok: false, err: '当前行动的不是你的角色' };
    const res = playerAct(s, action, this.game.itemMap);
    this.state = res.state;
    if (this.state.result) { this.finish(); return; }
    // 行动完成必须推进行动指针（playerAct 不推进 cursor，缺这一步会一直卡在同一单位行动）
    this.state = advance(this.state, this.rng);
    this.tick();
    return { ok: true };
  }

  // 弹窗选择：校验 owner
  onResolve(playerId: string, msg: { kind: PopupKind; form?: 'red' | 'blue'; accept?: boolean; stat?: string; allyUid?: string; optionId?: string }): { ok: boolean; err?: string } {
    if (this.result) return { ok: false, err: '战斗已结束' };
    const s = this.state;
    const owner = s.pendingChoice ? this.hostId()
      : s.pendingKaynForm ? (this.ownerOf(s.pendingKaynForm.uid) ?? this.hostId())
      : s.pendingGatesChoice ? (this.ownerOf(s.pendingGatesChoice.uid) ?? this.hostId())
      : s.yinglongCheck?.pending ? this.hostId()
      : s.pendingReaction ? (this.ownerOf(s.pendingReaction.targetUid) ?? this.hostId())
      : s.pendingBrokenArk ? (this.ownerOf(s.pendingBrokenArk.targetUid) ?? this.hostId())
      : null;
    if (owner !== playerId) return { ok: false, err: '该弹窗不属于你' };
    let afterReaction = false; // 反应/破碎方舟：需在结算后推进光标
    let replaySpecial = false; // 拒绝虚化（特殊AI直伤/群体）：需重放敌方行动
    if (s.pendingChoice && msg.kind === 'yuanShao') {
      const leader = this.players[0]!.char;
      const cha = (leader.extra?.cha ?? 0);
      const choice = msg.optionId === 'worship'
        ? { kind: 'worship' as const }
        : msg.optionId === 'seduce'
          ? { kind: 'seduce' as const, cha }
          : { kind: 'bribe' as const, amount: Math.min(this.game.run.coins, 1000) };
      this.state = resolveRobChoice(s, choice, this.rng).state;
    } else if (s.pendingKaynForm && msg.kind === 'kayn') {
      this.state = resolveKaynForm(s, msg.form ?? 'red').state;
    } else if (s.pendingGatesChoice && msg.kind === 'gates') {
      this.state = resolveGatesChoice(s, msg.accept === true).state;
    } else if (s.yinglongCheck?.pending && msg.kind === 'yinglong') {
      const ally = s.allies.find((a) => a.alive);
      const allyUid = msg.allyUid ?? ally?.uid ?? s.order[s.cursor] ?? '';
      this.state = resolveYinglongCheck(s, (msg.stat ?? 'str') as 'str', allyUid).state;
    } else if (s.pendingReaction && msg.kind === 'reaction') {
      const rr = resolveReaction(s, msg.accept === true);
      this.state = rr.state;
      afterReaction = true;
      replaySpecial = !!rr.state.replaySpecial;
    } else if (s.pendingBrokenArk && msg.kind === 'brokenArk') {
      this.state = resolveBrokenArk(s, msg.accept === true).state;
      afterReaction = true;
    } else {
      return { ok: false, err: '弹窗状态不一致' };
    }
    this.activePopup = null; // 弹窗已处理，后续广播不再携带
    if (afterReaction) {
      // 反应/破碎方舟结算后：继续推进敌方回合
      if (this.state.result) { this.finish(); return { ok: true }; }
      if (this.state.pendingReaction || this.state.pendingBrokenArk) {
        this.tick(); // 连续触发反应/方舟抉择
        return { ok: true };
      }
      if (replaySpecial) {
        // 拒绝虚化（特殊AI直伤/群体）：重新执行该行动（enemyAct 会跳过反应检查）
        const er = enemyAct(this.state, this.rng);
        this.state = er.state;
        if (this.state.result) { this.finish(); return { ok: true }; }
        if (this.state.pendingReaction || this.state.pendingBrokenArk) { this.tick(); return { ok: true }; }
      }
      this.state = advance(this.state, this.rng);
      this.tick();
      return { ok: true };
    }
    this.tick();
    return { ok: true };
  }

  private finish(): void {
    const s = this.state;
    if (this.result) return;
    this.result = s.result ?? 'lose';
    const survivors = this.deployed.map((cid, i) => {
      const a = this.state.allies[i];
      return { id: cid, hp: a?.hp ?? 0, mp: a?.mp ?? 0 };
    });
    this.clearTimer();
    this.cb.onEnd(this.result, survivors);
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  destroy(): void {
    this.clearTimer();
  }
}
