import type {
  EventDef, EventOption, EventReward, Item, Rng, RunState, SaveData,
} from '../types';
import { RELICS, RELIC_MAP } from '../data/relics';
import { JOB_DEFS } from '../data/jobs';
import { ACE_UNIT_MAP } from '../data/aceUnits';
import { pickPoolItem, openChestRelic } from './drops';
import { applyPickRewards, dungeonLevelOf, expandGrantRelics, grantChestItems, plagueLetterHpDown, stackTorchBless } from './run';
import { buildAllyCombatant } from './unit';

// 六维判定：六维 + 1D50 ≥ 阈值 即成功（与幸运掉落同风格）
export function statCheck(statValue: number, threshold: number, rng: Rng): {
  roll: number;
  total: number;
  pass: boolean;
} {
  const roll = rng.int(1, 50);
  return { roll, total: statValue + roll, pass: statValue + roll >= threshold };
}

// 出现条件判定（常规刷新=always）
export function eventConditionMet(cond: EventDef['cond'], run: RunState): boolean {
  switch (cond.type) {
    case 'always': return true;
    case 'torchGte': return (run.torches ?? 0) >= cond.count;
    case 'coinGte': return (run.coins ?? 0) >= cond.count;
    case 'relic': return (run.relics ?? []).includes(cond.relicId);
  }
}

// 当前副本+层数+条件过滤后的可抽取事件
// 每层不重复：已在本层触发过的事件不再进入抽取池
export function eligibleEvents(
  events: EventDef[],
  dungeonId: string,
  floor: number,
  run: RunState,
): EventDef[] {
  const seen = new Set(run.seenEventsByFloor?.[floor] ?? []);
  const own = events.filter(
    (e) => e.dungeon === dungeonId && e.floors.includes(floor) && eventConditionMet(e.cond, run) && !seen.has(e.id),
  );
  return own;
}

// 从事件池随机抽一个（无可用事件返回 null）
// 优先抽取本层未触发过的事件；若全部触发过则允许重复
export function rollEvent(
  events: EventDef[],
  dungeonId: string,
  floor: number,
  run: RunState,
  rng: Rng,
): EventDef | null {
  const seen = new Set(run.seenEventsByFloor?.[floor] ?? []);
  let pool = events.filter(
    (e) => e.dungeon === dungeonId && e.floors.includes(floor) && eventConditionMet(e.cond, run) && !seen.has(e.id),
  );
  if (pool.length === 0) {
    pool = events.filter(
      (e) => e.dungeon === dungeonId && e.floors.includes(floor) && eventConditionMet(e.cond, run),
    );
  }
  if (pool.length === 0) return null;
  return pool[rng.int(0, pool.length - 1)];
}

// 标记本层已触发过的事件（用于每层不重复刷新）
export function markEventSeen(run: RunState, floor: number, eventId: string): RunState {
  const next = structuredClone(run);
  const seen = { ...(next.seenEventsByFloor ?? {}) };
  const list = seen[floor] ?? [];
  if (!list.includes(eventId)) seen[floor] = [...list, eventId];
  next.seenEventsByFloor = seen;
  return next;
}

// 选项代价是否可承受
export function canAfford(option: EventOption, run: RunState): boolean {
  if (option.cost?.torch && (run.torches ?? 0) < option.cost.torch) return false;
  if (option.cost?.coins && (run.coins ?? 0) < option.cost.coins) return false;
  return true;
}

export interface EventResult {
  save: SaveData;
  run: RunState;
  texts: string[]; // 结果说明（逐条展示在结果面板）
  battleStageId?: string; // 触发战斗的关卡 id（battle / battleRandom）
  battleUrgent?: boolean;
  stay?: boolean; // 结算后停留在事件中（多步事件）
  recruitRarity?: 'rare' | 'epic'; // 结算后打开王牌招募候选
}

// 事件奖励结算：返回结果描述 + 应用后的 save/run
// battle（战斗奖励）通过返回值 battleStageId 传给调用方触发战斗
// owner：物品类奖励（item/randomItem/enchantedWeapon）的指定接收角色；缺省=队长
export function applyEventOption(opts: {
  save: SaveData;
  run: RunState;
  option: EventOption;
  rng: Rng;
  items: Map<string, Item>;
  leaderStatOf: (key: string) => number;
  owner?: string;
}): EventResult {
  const { save, run, option, rng, items } = opts;
  let s = save;
  let r = structuredClone(run);
  const texts: string[] = [];
  const battle: { stageId?: string; urgent?: boolean } = {};
  // 接收角色校验：传入的 owner 必须在编队内，否则回退队长
  const owner = opts.owner && r.party.memberIds.includes(opts.owner) ? opts.owner : r.party.leaderId;
  const ownerName = save.characters.find((c) => c?.id === owner)?.name ?? owner;

  // 0) 队伍各成员最大生命/魔力（heal 恢复、拾取即效遗物共用）
  const maxHpMp: Record<string, { hp: number; mp: number }> = {};
  const relicIds = r.relics ?? [];
  const stacks = r.relicStacks;
  r.party.memberIds.forEach((id, i) => {
    const c = s.characters.find((x) => x?.id === id);
    if (!c) return;
    const b = buildAllyCombatant(c, items, i, {
      relics: relicIds, relicStacks: stacks, killBook: r.killBook,
      maxHpPctDown: plagueLetterHpDown(r),
    });
    maxHpMp[id] = { hp: b.maxHp, mp: b.maxMp };
  });

  // 1) 扣代价
  if (option.cost?.torch) {
    const used = Math.min(option.cost.torch, r.torches ?? 0);
    r.torches -= used;
    if (used > 0) {
      texts.push(`消耗 ${used} 根火把`);
      r = stackTorchBless(r, used);
    }
  }
  if (option.cost?.coins) {
    const used = Math.min(option.cost.coins, r.coins ?? 0);
    r.coins -= used;
    if (used > 0) texts.push(`花费 ${used} 金币`);
  }

  // 2) 六维判定
  let rewards = option.outcome.rewards;
  if (option.outcome.stat) {
    const stat = option.outcome.stat;
    const value = opts.leaderStatOf(stat.key);
    const check = statCheck(value, stat.threshold, rng);
    const statLabel: Record<string, string> = {
      str: '力量', int: '智力', agi: '敏捷', luk: '幸运', wil: '意志', cha: '魅力',
    };
    if (check.pass) {
      texts.push(`${statLabel[stat.key]}判定 ${check.total}（${value}+${check.roll}）≥ ${stat.threshold}，判定成功！`);
    } else {
      texts.push(`${statLabel[stat.key]}判定 ${check.total}（${value}+${check.roll}）< ${stat.threshold}，判定失败`);
      rewards = option.outcome.fail ?? [];
    }
  }

  // 3) 逐条结算奖励
  for (const reward of rewards) {
    const picked = applyReward(s, r, reward, texts, items, rng, battle, maxHpMp, owner, ownerName);
    if (picked) {
      const maxHp = Object.fromEntries(
        Object.entries(maxHpMp).map(([k, v]) => [k, v.hp]),
      );
      const out = applyPickRewards(s, r, picked, maxHp, items);
      s = out.save;
      r = out.run;
      if (out.texts.length > 0) texts.push(...out.texts);
      // 谷地树实等「获得后额外获得遗物」：事件没有拾取面板，需在此展开（直接遗物的火把/回复不重复结算）
      const relicIds = picked.filter((p) => p.kind === 'relic').map((p) => p.relicId);
      if (relicIds.length > 0) {
        const pk = expandGrantRelics(r, relicIds, rng, maxHpMp, [...items.values()], dungeonLevelOf(r.dungeonId));
        r = pk.run;
        if (pk.texts.length > 0) texts.push(...pk.texts);
        if (pk.chests.length > 0) s = grantChestItems(s, r, pk.chests);
      }
    }
  }

  // 4) 多步事件：递增 eventStep
  if (option.outcome.stepInc) {
    r.eventStep = (r.eventStep ?? 0) + option.outcome.stepInc;
  }

  // 5) step 到达阈值时触发指定战斗
  if (option.outcome.battleIfStepGte && (r.eventStep ?? 0) >= option.outcome.battleIfStepGte.step) {
    const stg = findStage(s, option.outcome.battleIfStepGte.stageName, option.outcome.battleIfStepGte.urgent);
    if (stg) {
      battle.stageId = stg.id;
      battle.urgent = stg.difficulty === 'urgent';
      texts.push(`触发${stg.difficulty === 'urgent' ? '紧急' : '作战'}「${stg.name}」`);
    }
  }

  return {
    save: s, run: r, texts,
    battleStageId: battle.stageId,
    battleUrgent: battle.urgent,
    stay: option.outcome.stay,
    recruitRarity: option.outcome.recruitRarity,
  };
}

// 单条奖励 → PickReward 列表（coin/torch/item/relic 走 applyPickRewards 统一入包）
// owner：物品类奖励指定接收角色；ownerName：反馈文案中的角色名
function applyReward(
  save: SaveData,
  run: RunState,
  reward: EventReward,
  texts: string[],
  items: Map<string, Item>,
  rng: Rng,
  battle: { stageId?: string; urgent?: boolean },
  maxHpMp: Record<string, { hp: number; mp: number }>,
  owner: string,
  ownerName: string,
): import('./run').PickReward[] | null {
  const relicName = (id: string) => RELICS.find((x) => x.id === id)?.name ?? id;
  const itemName = (id: string) => items.get(id)?.name ?? id;
  // 宝箱遗物（木/银/黄金/钻石宝箱）：开箱抽一件藏品，作为 item 卡放入接收角色背包
  const chestCards = (relicId: string): import('./run').PickReward[] => {
    const def = RELIC_MAP[relicId];
    if (def?.effect.kind !== 'grantItem') return [];
    const it = openChestRelic(
      [...items.values()], def.effect.rarity, dungeonLevelOf(run.dungeonId), rng,
    );
    if (!it) {
      texts.push(`开启【${def.name}】，却没有找到合适的藏品`);
      return [];
    }
    texts.push(`开启【${def.name}】获得藏品【${itemName(it.id)}】，已放入【${ownerName}】的背包`);
    return [{ key: `e_${run.createdAt}_${texts.length}_chest`, kind: 'item', itemId: it.id, owner }];
  };
  switch (reward.kind) {
    case 'relic': {
      texts.push(`获得遗物【${relicName(reward.relicId)}】`);
      return [
        { key: `e_${run.createdAt}_${texts.length}`, kind: 'relic', relicId: reward.relicId },
        ...chestCards(reward.relicId),
      ];
    }
    case 'item':
      texts.push(`获得藏品【${itemName(reward.itemId)}】，已放入【${ownerName}】的背包`);
      return [{ key: `e_${run.createdAt}_${texts.length}`, kind: 'item', itemId: reward.itemId, owner }];
    case 'randomItem': {
      const cands = pickPoolItem([...items.values()], reward.rarity, reward.level);
      const count = reward.count ?? 1;
      const out: import('./run').PickReward[] = [];
      for (let i = 0; i < count; i++) {
        if (cands.length === 0) break;
        const item = cands[rng.int(0, cands.length - 1)];
        texts.push(`获得藏品【${item.name}】，已放入【${ownerName}】的背包`);
        out.push({ key: `e_${run.createdAt}_${texts.length}`, kind: 'item', itemId: item.id, owner });
      }
      if (out.length === 0) { texts.push('没有可获得的藏品'); return null; }
      return out;
    }
    case 'randomRelic': {
      const count = reward.count ?? 1;
      const out: import('./run').PickReward[] = [];
      const owned = new Set(run.relics ?? []);
      for (let i = 0; i < count; i++) {
        const pool = RELICS.filter((x) => x.inPool !== false && !owned.has(x.id) &&
          (reward.rarity === undefined || x.rarity === reward.rarity));
        const relic = pool.length > 0 ? pool[rng.int(0, pool.length - 1)] : undefined;
        if (!relic) break;
        owned.add(relic.id);
        texts.push(`获得遗物【${relic.name}】`);
        out.push({ key: `e_${run.createdAt}_${texts.length}`, kind: 'relic', relicId: relic.id });
        out.push(...chestCards(relic.id));
      }
      if (out.length === 0) { texts.push('没有可获得的遗物'); return null; }
      return out;
    }
    case 'enchantedWeapon': {
      const job = JOB_DEFS[save.characters.find((c) => c?.id === owner)?.job ?? 'cat'];
      const allowed = job.allowedWeaponTypes;
      const cands = [...items.values()].filter(
        (i) => i.slot === 'weapon' && i.id.includes('enchanted') && allowed.includes(i.weaponType!),
      );
      const item = cands.length > 0 ? cands[rng.int(0, cands.length - 1)] : undefined;
      if (!item) { texts.push('没有合适的附魔武器'); return null; }
      texts.push(`获得附魔武器【${item.name}】，已放入【${ownerName}】的背包`);
      return [{ key: `e_${run.createdAt}_${texts.length}`, kind: 'item', itemId: item.id, owner }];
    }
    case 'torch':
      run.torches += reward.count;
      texts.push(`获得 ${reward.count} 根火把`);
      return null;
    case 'coins':
      texts.push(`获得 ${reward.count} 金币`);
      return [{ key: `e_${run.createdAt}_${texts.length}`, kind: 'coin', count: reward.count }];
    case 'heal': {
      for (const [id, cur] of Object.entries(run.hpMp)) {
        const max = maxHpMp[id];
        if (!max) continue;
        cur.hp = Math.min(max.hp, cur.hp + Math.ceil(max.hp * reward.hpPct));
        cur.mp = Math.min(max.mp, cur.mp + Math.ceil(max.mp * reward.mpPct));
      }
      texts.push(`全队恢复 ${Math.round(reward.hpPct * 100)}% HP、${Math.round(reward.mpPct * 100)}% MP`);
      return null;
    }
    case 'battle':
    case 'battleRandom': {
      const name = reward.kind === 'battle'
        ? reward.stageName
        : reward.stageNames[rng.int(0, reward.stageNames.length - 1)];
      const urgent = reward.kind === 'battle' ? reward.urgent : undefined;
      const stage = findStage(save, name, urgent);
      if (!stage) { texts.push(`找不到关卡「${name}」`); return null; }
      texts.push(`触发${stage.difficulty === 'urgent' ? '紧急' : '作战'}「${stage.name}」`);
      battle.stageId = stage.id;
      battle.urgent = stage.difficulty === 'urgent';
      return null;
    }
    case 'none':
      return null;
    case 'damage': {
      for (const [id, cur] of Object.entries(run.hpMp)) {
        const max = maxHpMp[id];
        if (!max) continue;
        cur.hp = Math.max(1, cur.hp - Math.ceil(max.hp * reward.hpPct));
        if (reward.mpPct) cur.mp = Math.max(0, cur.mp - Math.ceil(max.mp * reward.mpPct));
      }
      texts.push(`全队扣除 ${Math.round(reward.hpPct * 100)}% HP${reward.mpPct ? `、${Math.round(reward.mpPct * 100)}% MP` : ''}`);
      return null;
    }
    case 'randomOne': {
      if (reward.rewards.length === 0) return null;
      const pick = reward.rewards[rng.int(0, reward.rewards.length - 1)];
      return applyReward(save, run, pick, texts, items, rng, battle, maxHpMp, owner, ownerName);
    }
    case 'removeRelic': {
      const owned = run.relics ?? [];
      // 仅随机池遗物可被事件上交；关键遗物（inPool:false，如求救信/迷藏/终焉之钥等）与 rl_endgame_link 不受影响
      const removable = owned.filter((id) => id !== 'rl_endgame_link' && RELIC_MAP[id]?.inPool !== false);
      const count = Math.min(reward.count, removable.length);
      for (let i = 0; i < count; i++) {
        const idx = rng.int(0, removable.length - 1);
        const rid = removable.splice(idx, 1)[0]!;
        const pos = run.relics.indexOf(rid);
        if (pos >= 0) run.relics.splice(pos, 1);
        texts.push(`失去遗物【${relicName(rid)}】`);
      }
      return null;
    }
    case 'recruitAce': {
      run.party.memberIds.push(reward.aceId);
      run.aceUnits = [...(run.aceUnits ?? []), reward.aceId];
      const ace = ACE_UNIT_MAP[reward.aceId];
      run.hpMp[reward.aceId] = { hp: ace?.stats.hp ?? 100, mp: ace?.stats.mp ?? 0 };
      // 上场未满3人时自动排入上场名单
      const cur = run.party.deployedIds ?? run.party.memberIds.slice(0, 3);
      if (cur.length < 3) run.party.deployedIds = [...cur, reward.aceId];
      texts.push(`王牌单位【${ace?.name ?? reward.aceId}】加入队伍！`);
      return null;
    }
  }
}

// 按关卡名查找关卡（关卡库已建；urgent 缺省=任意难度）
export function findStage(
  save: SaveData,
  name: string,
  urgent?: boolean,
): { id: string; name: string; difficulty: string } | null {
  const matches = save.customStages.filter((s) => s.name === name);
  if (urgent === undefined) {
    const st = matches[0];
    return st ? { id: st.id, name: st.name, difficulty: st.difficulty } : null;
  }
  const wanted = matches.find((s) => (urgent ? s.difficulty === 'urgent' : s.difficulty !== 'urgent'));
  if (wanted) return { id: wanted.id, name: wanted.name, difficulty: wanted.difficulty };
  const st = matches[0];
  return st ? { id: st.id, name: st.name, difficulty: st.difficulty } : null;
}