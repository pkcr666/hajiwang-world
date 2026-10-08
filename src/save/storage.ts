import type { Character, Equip, EventDef, ExtraStats, Item, MonsterUnit, Party, RunState, SaveData, StageDef } from '../types';
import { EXTRA_KEYS } from '../types';
import { EXTRA_MIN, EXTRA_MAX, LEVEL_BASE, START_EXTRA } from '../engine/stats';
import { canUpgradeSkill, SKILL_MAX_LEVEL, skillLevelOf, skillPointsEarned } from '../engine/skills';
import { SKILL_MAP } from '../data/skills';
import { splitCoins } from '../engine/party';
import { DEFAULT_MONSTERS, MONSTER_SEED_VERSION } from '../data/monsters';
import { DEFAULT_STAGES, STAGE_SEED_VERSION } from '../data/stages';
import { JOB_DEFS } from '../data/jobs';
import { ITEMS } from '../data/items';

// 新手村教学完成的成长奖励：
// - 正常通关：+10级（仅一次，到20级）
// - 携带终局联系通关：再+10级（仅一次，到30级）
// 技能点与六维点均按等级折算：每10级+1技能点、+10六维点
export const TUTORIAL_DUNGEON_ID = 'starterVillage';
export const TUTORIAL_LEVEL = 20;
export const TUTORIAL_SKILL_POINT_BONUS = 0;
export const TUTORIAL_FREE_POINTS = 60;
// 自由属性点可把单维突破初始上限（40 → 100）
export const FREE_EXTRA_MAX = EXTRA_MAX + TUTORIAL_FREE_POINTS;
// 自由属性点总获取上限：6 项从 10 加到 100 共需 6×90=540 点
export const FREE_EXTRA_POINTS_CAP = 6 * (FREE_EXTRA_MAX - EXTRA_MIN);

// 六维点按等级折算：每升10级给10点（10级=0，20级=10，30级=20…），上限 540
export const freeExtraPointsEarned = (level: number): number =>
  Math.min(FREE_EXTRA_POINTS_CAP, Math.max(0, Math.floor((level - LEVEL_BASE) / 10) * 10));

const KEY = 'hajiwang_save_v1';
const API = '/api/save';

// 内置怪物播种：图鉴的唯一事实源是存档，首次加载或名单版本升级时整体重置为内置名单
const seedMonsters = (): MonsterUnit[] =>
  DEFAULT_MONSTERS.map((m) => ({ ...structuredClone(m), custom: true }));

// 内置关卡播种：关卡库同理，版本升级时整体重置为内置名单（数据源在代码里，不会再丢）
const seedStages = (): StageDef[] => DEFAULT_STAGES.map((s) => structuredClone(s));

// 合并种子怪物的特殊机制字段到自定义怪物：
// 防止游戏自动存档把 localStorage 中旧怪物数据写回 save.json 时丢失新机制字段。
// 仅补全缺失/undefined 的字段，不覆盖用户已设置的值。
const SEED_MECHANIC_FIELDS: (keyof MonsterUnit)[] = [
  'atkUpIfNotHitLastTurn', 'debuffOnHit', 'fleeOnTurn', 'bonusDropOnKill',
  'turnStartBurn', 'healTurnEnd', 'dmgCapPerTurn', 'icon', 'crisis',
  // ===== 普攻/伤害相关 =====
  'attackType', 'aoeBasicAttack', 'multiHit', 'multiHitMul', 'multiHitRandom',
  'basicAttackDefMul', 'spdTrueDmgMul', 'spdBasedDmg', 'ignoreDefPct',
  'poisonStackAtkMul', 'bleedStackDmgAmp', 'aoeSplashPct', 'doublePoisonOnHit',
  'consumePlagueOnHit', 'dmgToMaxHp', 'lifestealMissingHp', 'lifestealPct', 'lifestealAllPct',
  'mpDrain', 'poisonOnHit', 'plagueOnHit', 'plagueStackBonusTrueDmg', 'plagueStackBonusMagicDmg',
  'basicAttackBuffs', 'attackGroupPoison', 'hitTurnPattern',
  // ===== 防御/受击相关 =====
  'defUpOnHit', 'defDownOnHit', 'spdUpOnHit', 'evenTurnGuard',
  'initialShield', 'initialShieldStacks', 'shieldDmgAmpPct', 'shieldAllTurnEnd',
  'counterTrueDmg', 'maxHpTrueDmgPct', 'dmgCapPerTurn',
  // ===== 召唤/回合末/死亡触发 =====
  'summon', 'summonBelowAllies', 'summonEachTurn', 'lowHpConsumeSummon',
  'turnEndAoeMagic', 'healAllTurnEnd', 'healAllTurnEndPct',
  'hpLossPerStep', 'lowHpBurst', 'perAllyStats', 'onAllyDeath',
  'onDeathHealAllyPct', 'onDeathBuffAlly', 'reviveOnce', 'selfDestructOnSurvive',
  'startHpPct', 'invincibleWhileAllies',
  // ===== AI/行为 =====
  'aiPriority', 'lockTarget', 'atkMulScaling', 'turnCycleAttack',
  'spdUpOnHitCap', 'bindAtkBoost', 'taunt', 'defLoseOnHitCha', 'dmgToDefOnDeal', 'aoeTrueDmgOnHit',
  'invincible', 'aoeReductionPct', 'basicAttackMul', 'spdBasedDmgPct',
  'enrage',
];
function mergeMonsterSeedFields(monsters: MonsterUnit[]): MonsterUnit[] {
  const seedMap = new Map(DEFAULT_MONSTERS.map((m) => [m.id, m]));
  return monsters.map((m) => {
    const seed = seedMap.get(m.id);
    if (!seed) return m;
    const out: MonsterUnit = { ...m };
    for (const f of SEED_MECHANIC_FIELDS) {
      if (out[f] === undefined && seed[f] !== undefined) {
        (out as unknown as Record<string, unknown>)[f] = structuredClone(seed[f]);
      }
    }
    return out;
  });
}

const ROSTER_SIZE = 12;

function emptyRoster(): (Character | null)[] {
  return Array.from({ length: ROSTER_SIZE }, () => null);
}

const EMPTY: SaveData = {
  version: 1,
  characters: emptyRoster(),
  customItems: [],
  customMonsters: seedMonsters(),
  customStages: seedStages(),
  materials: [],
  coinsInStorage: 0,
  party: null,
  activeRun: null,
  monsterSeed: MONSTER_SEED_VERSION,
  stageSeed: STAGE_SEED_VERSION,
};

function migrateCharacter(c: Character | null): Character | null {
  if (!c) return c;
  // 旧档职业校验：job 指向已移除/非法职业时回退默认职业，防止 JOB_DEFS[c.job] 取到 undefined 导致渲染崩溃
  if (!(c.job in JOB_DEFS)) c = { ...c, job: 'cat' };
  // 旧存档角色缺少 level / relics / bag / coins / inventory 字段，补默认值；
  // 无 inventory 时把已穿戴藏品视为已拥有（迁移一次后随存档固化）
  const worn = [c.equip?.weapon, c.equip?.helmet, c.equip?.armor, c.equip?.boots, ...(c.equip?.accessory ?? [])]
    .filter((x): x is string => !!x);
  const lvl = c.level ?? LEVEL_BASE;
  const spent = Object.values(c.skillLevels ?? {}).reduce((sum, lv) => sum + Math.max(0, (lv ?? 1) - 1), 0);
  // 技能点修正：按等级折算（10级=0，20级=1…），不低于已消耗的点数（保护已升技能）
  const expected = skillPointsEarned(lvl);
  const rawSp = Number.isFinite(c.skillPoints) ? Math.max(0, Math.floor(c.skillPoints as number)) : undefined;
  const skillPoints = rawSp === undefined ? expected : Math.max(expected, Math.min(rawSp, Math.max(expected, spent)));
  // 自由属性点修正：按等级折算（10级=0，20级=10…），扣除已消耗的点数（extra 中超出 EXTRA_MAX 的部分）
  const extra = c.extra ?? START_EXTRA;
  const spentFree = EXTRA_KEYS.reduce((sum, k) => sum + Math.max(0, (extra[k] ?? EXTRA_MIN) - EXTRA_MAX), 0);
  const rawFree = Number.isFinite(c.freeExtraPoints) ? Math.max(0, Math.floor(c.freeExtraPoints as number)) : undefined;
  const freeExtraPoints = rawFree === undefined
    ? Math.max(0, freeExtraPointsEarned(lvl) - spentFree)
    : rawFree;
  return {
    ...c,
    level: lvl,
    // 缺 equip（穿戴槽）时补默认空槽，防止 equippedIds 读 undefined.weapon 崩溃（Roster/副本/背包渲染）
    equip: c.equip ?? { weapon: '', helmet: '', armor: '', boots: '', accessory: [] },
    relics: c.relics ?? [],
    inventory: Array.isArray(c.inventory) ? c.inventory : worn,
    bag: Array.isArray(c.bag) ? c.bag : [],
    storage: Array.isArray(c.storage) ? c.storage : [],
    coins: Number.isFinite(c.coins) ? Math.max(0, Math.floor(c.coins)) : 0,
    skillPoints,
    skillLevels: c.skillLevels ?? {},
    freeExtraPoints,
    // 旧存档缺 baseExtra：用 extra 钳制到 EXTRA_MAX 作为初始六维快照（自由点不影响基础属性）
    baseExtra: c.baseExtra ?? (EXTRA_KEYS.reduce((acc, k) => {
      acc[k] = Math.min(EXTRA_MAX, extra[k] ?? EXTRA_MIN);
      return acc;
    }, {} as ExtraStats)),
  };
}

let _saveCache: SaveData | null = null;

export function loadSave(): SaveData {
  if (_saveCache) return _saveCache;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return (_saveCache = structuredClone(EMPTY));
    return (_saveCache = normalizeSave(JSON.parse(raw) as Partial<SaveData>));
  } catch {
    return (_saveCache = structuredClone(EMPTY));
  }
}

// 存档规整：缺字段补默认值；怪物/关卡名单版本过旧时用代码里的内置名单整体重置
function normalizeSave(parsed: Partial<SaveData>): SaveData {
  // 名单版本缺失/过旧，或字段损坏：用最新内置怪物名单重置图鉴（旧怪物全部删除）
  const needSeed =
    parsed.monsterSeed !== MONSTER_SEED_VERSION || !Array.isArray(parsed.customMonsters);
  // 关卡版本缺失/过旧，或字段损坏：用最新内置关卡名单重置关卡库
  const needStageSeed =
    parsed.stageSeed !== STAGE_SEED_VERSION || !Array.isArray(parsed.customStages);
  const data: SaveData = {
    version: 1,
    characters: (() => {
      if (!Array.isArray(parsed.characters)) return emptyRoster();
      const arr = parsed.characters.map(migrateCharacter);
      if (arr.length === ROSTER_SIZE) return arr;
      if (arr.length > ROSTER_SIZE) return arr.slice(0, ROSTER_SIZE);
      return [...arr, ...Array.from({ length: ROSTER_SIZE - arr.length }, () => null)];
    })(),
    customItems: Array.isArray(parsed.customItems) ? parsed.customItems : [],
    customMonsters: needSeed ? seedMonsters() : mergeMonsterSeedFields(parsed.customMonsters!),
    customStages: needStageSeed ? seedStages() : parsed.customStages!,
    customEvents: Array.isArray(parsed.customEvents) ? parsed.customEvents : [],
    itemPoolOverrides: (() => {
      const v = parsed.itemPoolOverrides;
      if (!v || typeof v !== 'object') return undefined;
      const cleaned: Record<string, boolean> = {};
      for (const [k, val] of Object.entries(v)) if (typeof val === 'boolean') cleaned[k] = val;
      return Object.keys(cleaned).length > 0 ? cleaned : undefined;
    })(),
    materials: Array.isArray(parsed.materials) ? parsed.materials : [],
    coinsInStorage: (() => { const v = Number(parsed.coinsInStorage); return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0; })(),
    party: parsed.party ?? null,
    activeRun: parsed.activeRun
      ? {
          ...parsed.activeRun,
          torches: Number.isFinite(parsed.activeRun.torches) ? parsed.activeRun.torches : 2,
          openedEdges: Array.isArray(parsed.activeRun.openedEdges) ? parsed.activeRun.openedEdges : [],
          nodeStates: parsed.activeRun.nodeStates ?? {},
          // 旧档缺层数：生命水晶按当前所在层数兜底，魔力水晶从0起
          relicStacks: parsed.activeRun.relicStacks ?? {
            rl_life_crystal: Math.min(10, Math.max(1, parsed.activeRun.act === 'sub' ? 3 : Number(parsed.activeRun.act) || 1)),
            rl_mana_crystal: 0,
          },
        }
      : null,
    monsterSeed: MONSTER_SEED_VERSION,
    stageSeed: STAGE_SEED_VERSION,
    updatedAt: parsed.updatedAt,
  };
  // 旧档迁移：误入藏品格的材料（强化石等）移到共享材料仓库，避免污染藏品穿戴列表
  const migrated = migrateInventoryMaterials(data);
  // 迁移/名单重置后立即持久化，避免每次加载重复迁移。
  // 注意不能在此调 saveSave()：saveSave 内部会再调 normalizeSave 造成无限递归。
  if (needSeed || needStageSeed) {
    saveSave(data);
  } else if (migrated) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch { /* 忽略：本地写入失败不影响本次运行 */ }
  }
  return data;
}

// 把角色 inventory 中 slot==='material' 的物品迁移到共享材料仓库（强化石等）。
// 返回是否有迁移发生。
function migrateInventoryMaterials(data: SaveData): boolean {
  const slotOf = new Map(ITEMS.map((i) => [i.id, i.slot]));
  let mats = data.materials;
  let anyChanged = false;
  for (const c of data.characters) {
    if (!c || !Array.isArray(c.inventory) || c.inventory.length === 0) continue;
    const inv: string[] = [];
    let changed = false;
    for (const id of c.inventory) {
      if (slotOf.get(id) === 'material') {
        const found = mats.find((m) => m.itemId === id);
        if (found) found.count += 1;
        else mats = [...mats, { itemId: id, count: 1 }];
        changed = true;
      } else {
        inv.push(id);
      }
    }
    if (changed) c.inventory = inv;
    anyChanged = anyChanged || changed;
  }
  if (mats !== data.materials) data.materials = mats;
  return anyChanged || mats !== data.materials;
}

// ---------- 开发环境统一数据源 ----------
// npm run dev 时由 vite 插件提供 /api/save，读写项目里的 data/save.json：
// 任何浏览器 / 标签页访问同一个 dev 地址都共用这一份存档。构建产物没有该接口，自动回退 localStorage。
// 开发环境统一数据源（仅浏览器 + Vite dev 生效；Node 服务端 import 本模块时该值为 false，避免 import.meta.env 访问报错）
const SERVER_ENABLED =
  typeof window !== 'undefined' &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

let writeTick = 0; // 存档写入计数：用于判断本次会话是否已改动过存档，避免被服务器数据回退覆盖
export const saveWriteTick = (): number => writeTick;

// 存档保存失败的全局通知：UI 可订阅以显示明确错误提示
export type SaveErrorHandler = (msg: string) => void;
let saveErrorHandler: SaveErrorHandler | null = null;
export function onSaveError(h: SaveErrorHandler | null): void {
  saveErrorHandler = h;
}
function reportSaveError(msg: string): void {
  console.error('[存档]', msg);
  saveErrorHandler?.(msg);
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPush: SaveData | null = null;

// 合并推送：连续多次存档只写最后一次，避免频繁落盘
function schedulePushToServer(s: SaveData): void {
  if (!SERVER_ENABLED) return;
  pendingPush = s;
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const body = pendingPush;
    pendingPush = null;
    if (!body) return;
    const push = async () => {
      try {
        const res = await fetch(API, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) reportSaveError(`存档写入失败（HTTP ${res.status}），刷新后修改可能丢失`);
      } catch (e) {
        reportSaveError(`存档写入失败（${String(e)}），刷新后修改可能丢失`);
      }
    };
    void push();
  }, 250);
}

// 开发环境：把图鉴/关卡库编辑后的数据写回 src/data/*.json，使修改持久化到源码（构建时打包进产物）
function scheduleDataWriteback(s: SaveData): void {
  if (!SERVER_ENABLED) return;
  const push = async () => {
    try {
      await fetch('/api/monsters', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s.customMonsters),
      });
    } catch { /* 写回失败不影响游戏，仅源码不更新 */ }
    try {
      await fetch('/api/stages', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s.customStages),
      });
    } catch { /* 同上 */ }
  };
  void push();
}

// 页面关闭/刷新前把最后一次存档立即推送到服务器，避免防抖窗口内丢写入
if (typeof window !== 'undefined' && SERVER_ENABLED) {
  window.addEventListener('pagehide', () => {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    const body = pendingPush;
    pendingPush = null;
    if (!body) return;
    try {
      // 插件同时支持 POST：用 sendBeacon 保证随页面卸载发出
      navigator.sendBeacon(API, new Blob([JSON.stringify(body)], { type: 'application/json' }));
    } catch { /* 忽略 */ }
  });
}

// 启动时与服务器对齐：服务器有存档就采用（并刷新本地缓存）；服务器还没有则把本地这份播种上去。
// 采用前按 updatedAt 比较：只「取新不取旧」——防抖推送/卸载信标丢失会让服务器残留旧档，
// 若无条件覆盖会回退到商店进入前等旧状态（玩家看到的「操作回退/物品变回旧款」）。
export async function syncSaveFromServer(): Promise<SaveData | null> {
  if (!SERVER_ENABLED) return null;
  try {
    const res = await fetch(API, { headers: { 'cache-control': 'no-cache' } });
    if (res.ok) {
      const data = normalizeSave((await res.json()) as Partial<SaveData>);
      const local = loadSave();
      if (data.updatedAt != null && local.updatedAt != null && data.updatedAt <= local.updatedAt) {
        return null; // 本地不旧于服务器：不采纳，避免回退覆盖
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(data)); // 本地留一份缓存，接口不可用时仍可游玩
      } catch { /* 忽略 */ }
      return data;
    }
    if (res.status === 404) schedulePushToServer(loadSave());
  } catch { /* 忽略：接口不可用时继续用本地存档 */ }
  return null;
}

export function saveSave(s: SaveData): void {
  s.updatedAt = Date.now(); // 写入时间戳：dev 同步「取新不取旧」，防防抖/信标丢失导致旧档回退覆盖
  // 缓存规整后的副本：防止外部传入未规整对象污染缓存（缺字段导致角色名册/副本渲染崩溃）；
  // 显式带 seed 版本，避免 normalize 把自定义怪物/关卡误判为旧版而重置
  _saveCache = normalizeSave({
    ...s,
    monsterSeed: (s.monsterSeed as string | undefined) ?? MONSTER_SEED_VERSION,
    stageSeed: (s.stageSeed as string | undefined) ?? STAGE_SEED_VERSION,
  } as Partial<SaveData>);
  writeTick += 1;
  if (typeof localStorage === 'undefined') return; // Node 服务端无 localStorage：存档写回由联机托管层负责
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    reportSaveError(`本地缓存写入失败（${String(e)}）`);
  }
  schedulePushToServer(s);
}

export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function upsertCharacter(s: SaveData, slot: number, c: Character): SaveData {
  const next = structuredClone(s);
  next.characters[slot] = c;
  saveSave(next);
  return next;
}

export function deleteCharacter(s: SaveData, slot: number): SaveData {
  const next = structuredClone(s);
  next.characters[slot] = null;
  saveSave(next);
  return next;
}

// 修改指定角色的背包并持久化
export function updateCharacterBag(
  s: SaveData,
  id: string,
  bag: { itemId: string; count: number }[],
): SaveData {
  const slot = s.characters.findIndex((c) => c?.id === id);
  if (slot < 0 || !s.characters[slot]) return s;
  const next = structuredClone(s);
  next.characters[slot]!.bag = bag.map((b) => ({ ...b }));
  saveSave(next);
  return next;
}

// 向角色背包合并加入物品（同 id 叠加数量）
export function addToCharacterBag(
  s: SaveData,
  id: string,
  itemId: string,
  count: number,
): SaveData {
  if (count <= 0) return s;
  const slot = s.characters.findIndex((c) => c?.id === id);
  if (slot < 0 || !s.characters[slot]) return s;
  const next = structuredClone(s);
  const bag = next.characters[slot]!.bag;
  const found = bag.find((b) => b.itemId === itemId);
  if (found) found.count += count;
  else bag.push({ itemId, count });
  saveSave(next);
  return next;
}

// 战斗结束后把各成员战斗内剩余的背包（消耗品消耗）写回存档角色
export function applySurvivorBags(
  s: SaveData,
  survivors: { id: string; bag: { itemId: string; count: number }[] }[],
): SaveData {
  const next = structuredClone(s);
  let changed = false;
  for (const sv of survivors) {
    const slot = next.characters.findIndex((c) => c?.id === sv.id);
    if (slot < 0 || !next.characters[slot]) continue;
    next.characters[slot]!.bag = sv.bag.map((b) => ({ ...b }));
    changed = true;
  }
  if (changed) saveSave(next);
  return next;
}

// 修改指定角色的已拥有藏品清单并持久化（每件占一个背包格）
export function updateCharacterInventory(
  s: SaveData,
  id: string,
  inventory: string[],
): SaveData {
  const slot = s.characters.findIndex((c) => c?.id === id);
  if (slot < 0 || !s.characters[slot]) return s;
  const next = structuredClone(s);
  next.characters[slot]!.inventory = [...inventory];
  saveSave(next);
  return next;
}

export function firstEmptySlot(s: SaveData): number {
  return s.characters.findIndex((c) => c === null);
}

export function addCustomItem(s: SaveData, item: Omit<Item, 'id' | 'custom'>): SaveData {
  const next = structuredClone(s);
  next.customItems.push({ ...item, id: newId('custom_item'), custom: true });
  saveSave(next);
  return next;
}

export function removeCustomItem(s: SaveData, id: string): SaveData {
  const next = structuredClone(s);
  next.customItems = next.customItems.filter((i) => i.id !== id);
  // 同步清理该藏品的随机池覆盖
  if (next.itemPoolOverrides?.[id] !== undefined) {
    next.itemPoolOverrides = { ...next.itemPoolOverrides };
    delete next.itemPoolOverrides[id];
    if (Object.keys(next.itemPoolOverrides).length === 0) next.itemPoolOverrides = undefined;
  }
  saveSave(next);
  return next;
}

// 覆盖已有自定义藏品（保留 id）
export function updateCustomItem(
  s: SaveData,
  id: string,
  patch: Partial<Omit<Item, 'id' | 'custom'>>,
): SaveData {
  if (!s.customItems.some((i) => i.id === id)) return s;
  const next = structuredClone(s);
  next.customItems = next.customItems.map((i) =>
    i.id === id ? { ...i, ...structuredClone(patch) } : i,
  );
  saveSave(next);
  return next;
}

// 设置藏品是否进入随机池：自定义藏品直接改 inPool；内置藏品写入 itemPoolOverrides
export function setItemInPool(s: SaveData, id: string, inPool: boolean): SaveData {
  const custom = s.customItems.find((i) => i.id === id);
  const next = structuredClone(s);
  if (custom) {
    next.customItems = next.customItems.map((i) =>
      i.id === id ? { ...i, inPool } : i,
    );
  } else {
    const overrides = { ...(next.itemPoolOverrides ?? {}) };
    // 只在与默认值（true）不同时记录覆盖，减少存档体积
    if (inPool) delete overrides[id];
    else overrides[id] = false;
    next.itemPoolOverrides = Object.keys(overrides).length > 0 ? overrides : undefined;
  }
  saveSave(next);
  return next;
}

export function addCustomMonster(s: SaveData, m: Omit<MonsterUnit, 'id' | 'custom'>): SaveData {
  const next = structuredClone(s);
  next.customMonsters.push({ ...m, id: newId('custom_monster'), custom: true });
  saveSave(next);
  scheduleDataWriteback(next);
  return next;
}

// 覆盖已有怪物（保留 id），图鉴内直接改数值时使用
export function updateCustomMonster(
  s: SaveData,
  id: string,
  patch: Omit<MonsterUnit, 'id' | 'custom'>,
): SaveData {
  if (!s.customMonsters.some((m) => m.id === id)) return s;
  const next = structuredClone(s);
  // 保留编辑器不覆盖的机制字段（elite/basicAttackBuffs/summon/enrage）
  next.customMonsters = next.customMonsters.map((m) =>
    m.id === id ? { ...m, ...structuredClone(patch), id, custom: true } : m,
  );
  saveSave(next);
  scheduleDataWriteback(next);
  return next;
}

export function removeCustomMonster(s: SaveData, id: string): SaveData {
  const next = structuredClone(s);
  next.customMonsters = next.customMonsters.filter((m) => m.id !== id);
  saveSave(next);
  scheduleDataWriteback(next);
  return next;
}

// ===== 关卡 =====
export function addCustomStage(s: SaveData, st: Omit<StageDef, 'id' | 'custom'>): SaveData {
  const next = structuredClone(s);
  next.customStages.push({ ...st, id: newId('custom_stage'), custom: true });
  saveSave(next);
  scheduleDataWriteback(next);
  return next;
}

export function updateCustomStage(
  s: SaveData,
  id: string,
  patch: Omit<StageDef, 'id' | 'custom'>,
): SaveData {
  if (!s.customStages.some((st) => st.id === id)) return s;
  const next = structuredClone(s);
  next.customStages = next.customStages.map((st) =>
    st.id === id ? { ...structuredClone(patch), id, custom: true } : st,
  );
  saveSave(next);
  scheduleDataWriteback(next);
  return next;
}

export function removeCustomStage(s: SaveData, id: string): SaveData {
  const next = structuredClone(s);
  next.customStages = next.customStages.filter((st) => st.id !== id);
  saveSave(next);
  scheduleDataWriteback(next);
  return next;
}

// ===== 自定义事件（不期而遇）=====
// 新增/更新自定义事件（id 缺省自动生成）。内置事件不可修改。
export function upsertCustomEvent(s: SaveData, ev: EventDef): SaveData {
  const next = structuredClone(s);
  const list = next.customEvents ?? [];
  const idx = list.findIndex((e) => e.id === ev.id);
  if (idx >= 0) list[idx] = ev;
  else list.push(ev);
  next.customEvents = list;
  saveSave(next);
  return next;
}

export function removeCustomEvent(s: SaveData, id: string): SaveData {
  const next = structuredClone(s);
  next.customEvents = (next.customEvents ?? []).filter((e) => e.id !== id);
  saveSave(next);
  return next;
}

// ===== 装备 / 编队 / 共享仓库 =====

// 更换角色穿戴藏品（整体覆盖 equip）
export function updateCharacterEquip(s: SaveData, id: string, equip: Equip): SaveData {
  const slot = s.characters.findIndex((c) => c?.id === id);
  if (slot < 0 || !s.characters[slot]) return s;
  const next = structuredClone(s);
  next.characters[slot]!.equip = structuredClone(equip);
  saveSave(next);
  return next;
}

// 记住上次编队
export function saveParty(s: SaveData, party: Party | null): SaveData {
  const next = structuredClone(s);
  next.party = party ? structuredClone(party) : null;
  saveSave(next);
  return next;
}

// 材料入共享仓库（同 id 合并数量）
export function addMaterials(
  s: SaveData,
  groups: { itemId: string; count: number }[],
): SaveData {
  const next = structuredClone(s);
  next.materials = next.materials.map((g) => ({ ...g }));
  for (const g of groups) {
    if (g.count <= 0) continue;
    const found = next.materials.find((m) => m.itemId === g.itemId);
    if (found) found.count += g.count;
    else next.materials.push({ itemId: g.itemId, count: g.count });
  }
  saveSave(next);
  return next;
}

// ===== 角色独享仓库（藏品+消耗品）=====

const STORAGE_CAPACITY = 500;

// 把角色背包中的一件藏品移入其仓库
export function moveInventoryToStorage(
  s: SaveData,
  characterId: string,
  itemId: string,
): SaveData | null {
  const slot = s.characters.findIndex((c) => c?.id === characterId);
  if (slot < 0 || !s.characters[slot]) return null;
  const inv = [...(s.characters[slot]!.inventory ?? [])];
  const idx = inv.indexOf(itemId);
  if (idx < 0) return null;
  inv.splice(idx, 1);
  const next = structuredClone(s);
  const c = next.characters[slot]!;
  c.inventory = inv;
  c.storage = (c.storage ?? []).map((g) => ({ ...g }));
  const found = c.storage.find((g) => g.itemId === itemId);
  if (found) found.count += 1;
  else {
    if (c.storage.length >= STORAGE_CAPACITY) return null;
    c.storage.push({ itemId, count: 1 });
  }
  saveSave(next);
  return next;
}

// 从角色仓库取出一件藏品到背包
export function withdrawStorageToInventory(
  s: SaveData,
  characterId: string,
  itemId: string,
): SaveData | null {
  const slot = s.characters.findIndex((c) => c?.id === characterId);
  if (slot < 0 || !s.characters[slot]) return null;
  const next = structuredClone(s);
  const c = next.characters[slot]!;
  c.storage = (c.storage ?? []).map((g) => ({ ...g }));
  const found = c.storage.find((g) => g.itemId === itemId);
  if (!found || found.count <= 0) return null;
  found.count -= 1;
  c.storage = c.storage.filter((g) => g.count > 0);
  c.inventory = [...(c.inventory ?? []), itemId];
  saveSave(next);
  return next;
}

// ===== 副本探索（run）=====

// 开始/更新一次进行中的探索；开始时同时记住编队，并把成员携币汇入共享池（身上清零，结算时发还）
export function beginRun(s: SaveData, run: RunState): SaveData {
  const next = structuredClone(s);
  next.party = structuredClone(run.party);
  next.coinsInStorage = Math.max(0, Math.floor(next.coinsInStorage ?? 0));
  // 记录进本时刻各成员的背包/药品快照：撤离/团灭时恢复，用于清除本局获得的藏品与药品
  const snapshot: NonNullable<RunState['entrySnapshot']> = { inventory: {}, bag: {}, coins: {} };
  for (const id of run.party.memberIds) {
    const c = next.characters.find((x) => x?.id === id);
    if (c) {
      snapshot.inventory[id] = [...(c.inventory ?? [])];
      snapshot.bag[id] = (c.bag ?? []).map((b) => ({ ...b }));
      snapshot.coins![id] = Math.max(0, Math.floor(c.coins ?? 0));
    }
    const slot = next.characters.findIndex((x) => x?.id === id);
    if (slot >= 0 && next.characters[slot]) next.characters[slot]!.coins = 0;
  }
  next.activeRun = structuredClone({ ...run, entrySnapshot: snapshot });
  saveSave(next);
  return next;
}

export function persistRun(s: SaveData, run: RunState): SaveData {
  const next = structuredClone(s);
  next.activeRun = structuredClone(run);
  saveSave(next);
  return next;
}

// 通关：金币按人数平分给各成员、材料一人一份进各成员独有仓库、藏品进各自仓库
export function completeRun(s: SaveData): SaveData {
  const run = s.activeRun;
  if (!run) return s;
  const next = structuredClone(s);
  const memberIds = run.party.memberIds;
  const memberCount = memberIds.length;
  // 1) 通关获得的哈哈币按人数平分给各成员（余数归队长），直接进入个人币
  const totalCoins = Math.max(0, Math.floor(run.coins));
  const each = memberCount > 0 ? Math.floor(totalCoins / memberCount) : 0;
  const leaderExtra = totalCoins - each * memberCount;
  for (const id of memberIds) {
    const slot = next.characters.findIndex((c) => c?.id === id);
    if (slot < 0 || !next.characters[slot]) continue;
    const c = next.characters[slot]!;
    // 恢复进本前的个人币，再加上本局通关所得的平分份额
    const origCoins = run.entrySnapshot?.coins?.[id] ?? 0;
    c.coins = Math.max(0, Math.floor(origCoins + each + (id === run.party.leaderId ? leaderExtra : 0)));
    // 2) 材料一人一份进入各成员独有仓库
    c.storage = (c.storage ?? []).map((g) => ({ ...g }));
    for (const m of run.pendingMaterials ?? []) {
      if (m.count <= 0) continue;
      const found = c.storage.find((g) => g.itemId === m.itemId);
      if (found) found.count += m.count;
      else c.storage.push({ itemId: m.itemId, count: m.count });
    }
    // 3) 成员背包内的藏品通关后默认回到各自仓库
    for (const itemId of c.inventory ?? []) {
      const found = c.storage.find((g) => g.itemId === itemId);
      if (found) found.count += 1;
      else c.storage.push({ itemId, count: 1 });
    }
    c.inventory = [];
  }
  // 途中获得但未分配的藏品进队长仓库
  const leader = next.characters.find((c) => c?.id === run.party.leaderId);
  if (leader) {
    leader.storage = (leader.storage ?? []).map((g) => ({ ...g }));
    for (const it of run.pendingItems ?? []) {
      const found = leader.storage.find((g) => g.itemId === it.itemId);
      if (found) found.count += it.count;
      else leader.storage.push({ itemId: it.itemId, count: it.count });
    }
  }
  next.activeRun = null;
  applyTutorialIfAny(next, run);
  saveSave(next);
  return next;
}

// 通关并分配途中藏品：assignments 按角色把物品加入其背包格，然后走 completeRun 结算（藏品最终进仓库）
export function completeRunWithLoot(
  s: SaveData,
  assignments: { characterId: string; itemIds: string[] }[],
): SaveData {
  const run = s.activeRun;
  if (!run) return s;
  const next = structuredClone(s);
  for (const a of assignments) {
    if (a.itemIds.length === 0) continue;
    const slot = next.characters.findIndex((c) => c?.id === a.characterId);
    if (slot < 0 || !next.characters[slot]) continue;
    next.characters[slot]!.inventory = [
      ...(next.characters[slot]!.inventory ?? []),
      ...a.itemIds,
    ];
  }
  // 复用 completeRun：币/材料结算 + 背包藏品入仓库
  return completeRun(next);
}

// ===== 成长系统：技能点 / 自由属性点 / 新手村奖励 =====

// 升级专属技能：消耗 1 技能点，技能等级 +1（上限 3 级）；未解锁/无技能点/非专属均拒绝
export function upgradeSkill(s: SaveData, characterId: string, skillId: string): SaveData {
  const slot = s.characters.findIndex((c) => c?.id === characterId);
  if (slot < 0 || !s.characters[slot]) return s;
  const sk = SKILL_MAP[skillId];
  if (!sk?.exclusive || !canUpgradeSkill(s.characters[slot]!, sk)) return s;
  const next = structuredClone(s);
  const c = next.characters[slot]!;
  c.skillLevels = {
    ...(c.skillLevels ?? {}),
    [skillId]: Math.min(SKILL_MAX_LEVEL, skillLevelOf(c, skillId) + 1),
  };
  saveSave(next);
  return next;
}

// 消耗 1 自由属性点加到指定六维（单维上限 100 = 40 + 60，超出40的部分不换算基础属性）
export function spendFreePoint(s: SaveData, characterId: string, key: keyof ExtraStats): SaveData {
  const slot = s.characters.findIndex((c) => c?.id === characterId);
  if (slot < 0 || !s.characters[slot]) return s;
  const c = s.characters[slot]!;
  if ((c.freeExtraPoints ?? 0) <= 0 || (c.extra?.[key] ?? EXTRA_MIN) >= FREE_EXTRA_MAX) return s;
  const next = structuredClone(s);
  const cc = next.characters[slot]!;
  cc.extra = { ...(cc.extra ?? START_EXTRA), [key]: (cc.extra?.[key] ?? EXTRA_MIN) + 1 };
  cc.freeExtraPoints = (cc.freeExtraPoints ?? 0) - 1;
  saveSave(next);
  return next;
}

// 重置技能点：所有专属技能等级回到 1 级，已消耗的技能点全部返还（skillPoints 字段为总获得点数，无需改动）
export function resetSkillPoints(s: SaveData, characterId: string): SaveData {
  const slot = s.characters.findIndex((c) => c?.id === characterId);
  if (slot < 0 || !s.characters[slot]) return s;
  const next = structuredClone(s);
  const c = next.characters[slot]!;
  c.skillLevels = {};
  saveSave(next);
  return next;
}

// 重置额外 6 维加点：extra 回到 baseExtra 快照，已消耗的自由属性点全部返还
export function resetFreePoints(s: SaveData, characterId: string): SaveData {
  const slot = s.characters.findIndex((c) => c?.id === characterId);
  if (slot < 0 || !s.characters[slot]) return s;
  const next = structuredClone(s);
  const c = next.characters[slot]!;
  const base = c.baseExtra ?? START_EXTRA;
  c.extra = { ...base };
  c.freeExtraPoints = freeExtraPointsEarned(c.level ?? LEVEL_BASE);
  saveSave(next);
  return next;
}

// 新手村教学完成成长：
// - 正常通关：+10级（只触发一次，通过等级<20判断，最多到20）
// - 携带终局联系通关：再+10级（只触发一次，通过等级<30判断，最多到30）
// 技能点与六维点均按最终等级折算
export function applyTutorialRewards(c: Character, endgameLink = false): Character {
  const oldLevel = c.level ?? LEVEL_BASE;
  let level = oldLevel;
  // 正常通关奖励：+10级（仅当等级<20时触发，保证只领一次）
  if (level < 20) level = Math.min(20, level + 10);
  // 携带终局联系奖励：再+10级（仅当等级<30时触发，保证只领一次）
  if (endgameLink && level < 30) level = Math.min(30, level + 10);
  const base = skillPointsEarned(level);
  // 已消耗六维点 = 旧等级应得点数 - 旧剩余点数
  const spentExtra = freeExtraPointsEarned(oldLevel) - (c.freeExtraPoints ?? 0);
  return {
    ...c,
    level,
    // 技能点按等级折算+教程奖励，不再保留旧值（修正历史错误值）
    skillPoints: base + TUTORIAL_SKILL_POINT_BONUS,
    freeExtraPoints: Math.max(0, freeExtraPointsEarned(level) - spentExtra),
  };
}

// 通关时若为新手村副本：对参与成员发放教程成长奖励
function applyTutorialIfAny(s: SaveData, run: RunState): void {
  if (run.dungeonId !== TUTORIAL_DUNGEON_ID) return;
  const endgameLink = run.relics.includes('rl_endgame_link');
  for (const id of run.party.memberIds) {
    const slot = s.characters.findIndex((c) => c?.id === id);
    if (slot >= 0 && s.characters[slot]) {
      s.characters[slot] = applyTutorialRewards(s.characters[slot]!, endgameLink);
    }
  }
}

// 团灭/撤离：
// - 清空背包藏品、药水（不带出副本）
// - 恢复进本前的个人哈哈币（不获得本局币）
// - 保留已穿戴藏品、个人仓库、遗物
export function abortRun(s: SaveData): SaveData {
  const run = s.activeRun;
  if (!run) return s;
  const next = structuredClone(s);
  for (const id of run.party.memberIds) {
    const c = next.characters.find((x) => x?.id === id);
    if (!c) continue;
    c.inventory = [];
    c.bag = [];
    // 归还进本前的随身币，本局所得不带出
    const origCoins = run.entrySnapshot?.coins?.[id] ?? 0;
    c.coins = Math.max(0, Math.floor(origCoins));
  }
  next.activeRun = null;
  saveSave(next);
  return next;
}

/**
 * 副本结算：
 * - 剩余哈哈币按人数平分给成员（余数归队长）
 * - 通关材料一人一份进共享仓库（materialDrops × 成员数）
 * remainingCoins 钳制到非负。
 */
export function settleRun(
  s: SaveData,
  party: Party,
  remainingCoins: number,
  materialDrops: { itemId: string; count: number }[] = [],
  _poolTotal?: number,
): SaveData {
  const members = party.memberIds
    .map((id) => s.characters.find((c) => c?.id === id))
    .filter((c): c is Character => !!c);
  if (members.length === 0) return s;
  const next = structuredClone(s);
  // 币池：显式传入则用之，否则取成员当前币之和（用于直接调用 settleRun 的场景）
  const pool = _poolTotal ?? members.reduce((sum, m) => sum + (m.coins ?? 0), 0);
  // 剩余哈哈币钳制到币池总量后按人数平分给成员（余数归队长）
  const remain = Math.max(0, Math.min(pool, Math.floor(remainingCoins)));
  const { each, leaderExtra } = splitCoins(remain, members.length);
  for (const m of members) {
    const slot = next.characters.findIndex((c) => c?.id === m.id);
    if (slot >= 0 && next.characters[slot]) {
      next.characters[slot]!.coins = each + (m.id === party.leaderId ? leaderExtra : 0);
    }
  }
  // 材料进入共享仓库（全队共用一份）
  next.materials = next.materials.map((g) => ({ ...g }));
  for (const d of materialDrops) {
    if (d.count <= 0) continue;
    const found = next.materials.find((g) => g.itemId === d.itemId);
    if (found) found.count += d.count;
    else next.materials.push({ itemId: d.itemId, count: d.count });
  }
  saveSave(next);
  return next;
}
