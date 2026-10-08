import type { BattleState, Character, Item, MapNode, MonsterUnit, StageDef } from '../types';

// ===== 联机房间服务共享协议（Socket.IO 消息与视图类型）=====

// 房主上传的数据包：联机以房主图鉴/关卡/物品为权威（服务器无该数据时用内置数据）
export interface DataPack {
  monsters: MonsterUnit[];
  stages: StageDef[];
  items: Item[];
}

// 房间玩家信息（广播用；char 只保留展示字段，避免反复传全量存档）
export interface PlayerView {
  playerId: string;
  name: string;
  charId?: string;
  charName?: string;
  charJob?: string;
  online: boolean;
  isHost: boolean;
}

// 投票状态（移动 / 事件 / 掉落分配共用）
export type VoteKind = 'move' | 'event' | 'loot' | 'other' | 'shopRob';

export interface VoteOption {
  id: string;
  label: string;
  desc?: string;
}

export interface VoteView {
  voteId: string;
  kind: VoteKind;
  title: string;
  desc?: string;
  options: VoteOption[];
  submissions: Record<string, string>; // playerId -> optionId
  waiting: string[]; // 尚未提交的玩家（按玩家名）
  deadlineAt?: number; // 只剩一人未提交时启动 30s 倒计时
}

// 副本视图（广播 run 的核心结构）
export interface RunView {
  dungeonId: string;
  dungeonName: string;
  act: number | 'sub';
  actLabel: string;
  nodes: MapNode[];
  edges: { from: string; to: string; torch?: boolean }[];
  openedEdges?: string[]; // 已点亮火把线的 key
  cols: number;
  rows: number;
  currentNodeId: string | null;
  available: string[]; // 可进入的下一个节点 id
  cleared: string[];
  nodeStates: Record<string, { kind: string; used?: boolean }>;
  hpMp: Record<string, { hp: number; mp: number }>;
  coins: number;
  torches: number;
  relics: string[]; // 队伍共享遗物（生命/魔力水晶等）
  perRelics: Record<string, string[]>; // 各角色独享遗物
  perItems: Record<string, string[]>; // 各角色联机获得藏品
  perMaterials: Record<string, { itemId: string; count: number }[]>; // 各角色联机材料
  bindings: Record<string, string>; // playerId -> charId
  phase: 'map' | 'event' | 'battle' | 'loot' | 'result';
  logs: string[]; // 房间日志（最近若干条）
}

// 战斗单位视图
export interface UnitView {
  uid: string;
  name: string;
  isAlly: boolean;
  icon?: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  atk: number;
  def: number;
  mres: number;
  alive: boolean;
  roll?: number;
  buffs: { name: string; stacks?: number }[];
  shield?: number;
}

// 弹窗（定向展示：ownerPlayerId 的玩家可作答，其余等待）
export type PopupKind = 'kayn' | 'gates' | 'yinglong' | 'yuanShao';

export interface PopupView {
  kind: PopupKind;
  title: string;
  desc: string;
  options: { id: string; label: string }[];
  ownerPlayerId: string;
}

// 合法行动视图（对齐单人版 getLegalActions：被动已过滤、自动目标已预计算）
export interface LegalSkillView {
  id: string;
  name: string;
  mpCost: number;
  targetUids: string[] | null; // null = 无需选目标（self / enemyAll / 自动吸附）
  disabled: boolean;
  reason?: string;
  costText?: string;
  desc?: string;
  enhance?: { mpCost: number; kamuiCost: number; mulBonus: number }; // 虚化增强
}
export interface LegalItemView {
  itemId: string;
  name: string;
  count: number;
  targetUids: string[];
}
export interface LegalView {
  canAttack: boolean;
  attackAll: boolean; // 普攻群攻被动：无需选目标
  skills: LegalSkillView[];
  items: LegalItemView[];
}

// 战斗视图
export interface BattleView {
  battleId: string;
  stageName: string;
  turn: number;
  order: string[];
  cursor: number;
  acterUid: string | null;
  myAllyUid: string | null; // 当前玩家绑定的角色 uid
  myUnits: string[]; // 该玩家可操作的全部单位 uid（角色 + 自己招募的王牌单位）
  mySkills?: { id: string; name: string; mpCost: number }[]; // 行动者是我时给出技能（兼容旧字段）
  myLegal?: LegalView; // 合法行动（对齐单人版：含目标/禁用/道具）
  allies: UnitView[];
  enemies: UnitView[];
  popup?: PopupView;
  result?: 'win' | 'lose';
  logTail: string[];
  full?: BattleState; // 完整服务端战斗状态：前端直接复用单人战斗 UI（OrderBar/UnitCard）渲染
}

// 事件视图
export interface EventView {
  name: string;
  text: string;
  options: { id: string; text: string; hint?: string }[];
}

// ===== 个人操作节点视图（商店 / 失与得 / 王牌招募：每玩家独立界面）=====
export interface ShopSlotView {
  id: string;
  label: string;
  sub?: string; // 类型说明（藏品/遗物/材料）
  price: number; // 实际售价（已含砍价/遗物折扣/免费/洗劫）
  price0?: number; // 原价
  rarity?: string;
  count?: number;
  kind?: 'item' | 'relic' | 'material' | 'potion';
  free?: boolean;
  sold?: boolean;
  icon?: string;
  desc?: string;
}
export interface ShopHaggleView {
  total: number; // 判定点 = 魅力 + 1D50
  roll: number; // 1D50
  discountPct: number; // 0.5 / 0.7 / 0.8 / 1 / 1.2
}
export interface TradeOfferView {
  id: string;
  label: string;
  desc: string;
}
export interface RecruitCandView {
  id: string;
  name: string;
  rarity?: string;
  icon?: string;
  hp: number;
  atk: number;
  def: number;
}
export interface PersonalView {
  kind: 'shop' | 'trade' | 'recruit';
  shop?: {
    coins: number;
    slots: ShopSlotView[];
    bought: string[];
    doneCount: number;
    total: number;
    haggle?: ShopHaggleView; // 砍价结果（每摊一次）
    robbed?: boolean; // 本摊已被洗劫（价格全 0）
    refreshCount?: number; // 已刷新次数
    torches?: number; // 共享火把（刷新消耗）
    dungeonId?: string;
    freeCount?: number; // 免费商品件数（遗物坎诺特触须）
    priceMul?: number; // 当前价格倍率（砍价+遗物折扣取最优）
    chainMul?: number; // 仅遗物折扣倍率
    nextRefreshCost?: number; // 下次刷新火把消耗（灾厄）
    refreshFreeLeft?: number; // 免费刷新剩余次数（非灾厄）
    robShopOpen?: boolean; // 新手村且本局未抢过（可发起抢商店）
    robShopDone?: boolean; // 本局已抢过（其余行商空摊）
  };
  trade?: {
    offers: TradeOfferView[];
    picked?: string;
    doneCount: number;
    total: number;
  };
  recruit?: {
    candidates: RecruitCandView[];
    picked?: string;
    doneCount: number;
    total: number;
  };
}

// ===== 个人背包视图（对齐单人 RunBag：属性面板 + 穿戴 + 切换藏品，服务端权威）=====
export interface BagItemBrief {
  id: string;
  name: string;
  slot: string;
  rarity: string;
  desc: string;
  level?: number;
  weaponType?: string;
  icon?: string;
  extraBonus?: Record<string, number>; // 六维加成（穿戴时计入）
  usable?: boolean; // 消耗品可在地图使用
  bonus?: string[]; // 效果描述行（对齐单人版 bonusLines）
}
export interface BagView {
  charId: string;
  name: string;
  job: string;
  jobTier?: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  equip: Record<string, string | null>; // weapon/helmet/armor/boots/acc1/acc2
  inventory: string[]; // 角色局外背包藏品（未穿戴）
  perItems: string[]; // 联机获得藏品（未穿戴）
  bag: { itemId: string; count: number }[]; // 角色携带道具（消耗品）
  extra: Record<string, number>; // 基础六维
  extraEquip: Record<string, number>; // 穿戴藏品六维加成
  sixRelic: Record<string, number>; // 遗物六维加成
  extraTotal: Record<string, number>; // 六维合计（基础+装备+遗物）
  stats: { hp: number; mp: number; atk: number; def: number; mres: number; spdMin: number; spdMax: number }; // 局外面板（含遗物加成）
  baseStats: { hp: number; mp: number; atk: number; def: number; mres: number; spdMin: number; spdMax: number }; // 原始面板（仅穿戴藏品）
  relicIds: string[];
  relicStacks: Record<string, number>;
  plagueLetterStacks: number; // 瘟疫信层数（最大生命-百分比）
  relicMods: { physAmp: number; magicAmp: number; allRed: number }; // 遗物增伤/减伤
  itemDmgAmp: { phys: number; magic: number }; // 藏品增伤
  materials: { itemId: string; count: number }[];
  items: Record<string, BagItemBrief>; // 涉及物品简表（装备+背包+联机藏品+道具）
}

// 结算视图
export interface ResultView {
  win: boolean;
  reason: string;
  perPlayer: { playerId: string; name: string; coins: number; items: string[]; itemIds: string[]; relics: string[]; materials: { itemId: string; count: number }[] }[];
}

// ===== 客户端 -> 服务器 消息 =====
export interface LobbyCreateMsg { name: string; char: Character; dataPack: DataPack; dungeonId?: string; }
export interface LobbyJoinMsg { roomId: string; name: string; char: Character; dataPack: DataPack; dungeonId?: string; }
export interface LobbyPickCharMsg { char: Character; }
export interface VoteSubmitMsg { choiceId: string; }
export interface BattleActMsg {
  action:
    | { type: 'attack'; targetUid: string }
    | { type: 'skill'; skillId: string; targetUid?: string; enhance?: boolean }
    | { type: 'item'; itemId: string; targetUid: string };
}
export interface BattleResolveMsg {
  kind: PopupKind;
  // kayn: form='red'|'blue'；gates: accept=boolean；yinglong: stat + allyUid；yuanShao: optionId
  form?: 'red' | 'blue';
  accept?: boolean;
  stat?: string;
  allyUid?: string;
  optionId?: string;
}

// ===== 服务器 -> 客户端 消息名 =====
export const C2S = {
  lobbyCreate: 'lobby:create',
  lobbyJoin: 'lobby:join',
  lobbyLeave: 'lobby:leave',
  lobbyPickChar: 'lobby:pickChar',
  lobbyStart: 'lobby:start',
  voteSubmit: 'vote:submit',
  battleAct: 'battle:act',
  battleResolve: 'battle:resolve',
  shopBuy: 'shop:buy',
  shopRefresh: 'shop:refresh',
  shopHaggle: 'shop:haggle',
  shopSell: 'shop:sell',
  shopRobRequest: 'shop:rob-request',
  tradePick: 'trade:pick',
  recruitPick: 'recruit:pick',
  nodeDone: 'node:done',
  bagOpen: 'bag:open',
  bagEquip: 'bag:equip',
  bagUnequip: 'bag:unequip',
  runSync: 'run:sync', // 切视图后主动请求当前副本状态（防错过初始广播）
  battleSync: 'battle:sync', // 请求当前战斗视图
  ping: 'ping',
} as const;

export const S2C = {
  roomUpdate: 'room:update',
  runState: 'run:state',
  voteStart: 'vote:start',
  voteUpdate: 'vote:update',
  voteResult: 'vote:result',
  eventView: 'event:view',
  personalView: 'personal:view',
  battleView: 'battle:view',
  bagView: 'bag:view',
  toast: 'toast',
  result: 'run:result',
  err: 'err',
} as const;
