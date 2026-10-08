import type { EventDef, SaveData } from '../types';

// 事件库（不期而遇）：副本 + 层数（可多个）+ 出现条件 + 选项
// dungeon：出现副本 id；floors：出现层数；cond：常规刷新(always) 或 携带条件
// 触发战斗的事件按关卡名（stageName）在关卡库中查找（需先在关卡库创建对应关卡）
export const EVENTS: EventDef[] = [
  // ===== 一层 =====
  {
    id: 'ev_house',
    name: '造房子',
    dungeon: 'starterVillage',
    floors: [1],
    cond: { type: 'always' },
    text: '初入泰拉世界，为抵御周遭的危险，你需要搭建一处居所。',
    options: [
      {
        id: 'o_house_big',
        text: '建造大房子',
        hint: '力量判定 60，通过后获得遗物【大房子】（全体防御+10）',
        outcome: { stat: { key: 'str', threshold: 60 }, rewards: [{ kind: 'relic', relicId: 'rl_house_l' }] },
      },
      {
        id: 'o_house_small',
        text: '建造小房子',
        hint: '无需判定，获得遗物【小房子】（全体防御+5）',
        outcome: { rewards: [{ kind: 'relic', relicId: 'rl_house_s' }] },
      },
      {
        id: 'o_house_leave',
        text: '放弃建造，直接离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_river',
    name: '金银剑',
    dungeon: 'starterVillage',
    floors: [1],
    cond: { type: 'always' },
    text: '你行至一条小河边，河神自水中浮现，开口问道：“少年，你掉落的，是这柄金剑，还是这柄银剑？”',
    options: [
      {
        id: 'o_river_gold',
        text: '选择金剑',
        hint: '获得【金剑】',
        outcome: { rewards: [{ kind: 'item', itemId: 'it_sword_gold' }] },
      },
      {
        id: 'o_river_silver',
        text: '选择银剑',
        hint: '获得【银剑】',
        outcome: { rewards: [{ kind: 'item', itemId: 'it_sword_silver' }] },
      },
      {
        id: 'o_river_wood',
        text: '选择木剑',
        hint: '一无所获，河神根本没有木剑。',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_woodbox',
    name: '木箱子',
    dungeon: 'starterVillage',
    floors: [1],
    cond: { type: 'always' },
    text: '四处搜寻的途中，你发现了一只尘封的木箱子。',
    options: [
      {
        id: 'o_woodbox_item',
        text: '渴求绝世藏品',
        hint: '获得随机 10 级优秀藏品',
        outcome: { rewards: [{ kind: 'randomItem', rarity: 'uncommon', level: 10 }] },
      },
      {
        id: 'o_woodbox_relic',
        text: '求取史前遗物',
        hint: '获得随机优秀遗物',
        outcome: { rewards: [{ kind: 'randomRelic', rarity: 'uncommon' }] },
      },
    ],
  },

  // ===== 二层 =====
  {
    id: 'ev_nymph',
    name: '迷失少女（宁扶）',
    dungeon: 'starterVillage',
    floors: [2],
    cond: { type: 'always' },
    text: '矿洞幽暗的深处，你偶遇一名神色惶恐的少女，她十分畏惧，希望能够跟随你一同离开此地。',
    options: [
      {
        id: 'o_nymph_torch',
        text: '消耗 1 根火把，让她独自离去',
        hint: '触发紧急作战「迷失少女」',
        cost: { torch: 1 },
        outcome: { rewards: [{ kind: 'battle', stageName: '迷失少女', urgent: true }] },
      },
      {
        id: 'o_nymph_follow',
        text: '将她带在身边一同离开',
        hint: '触发作战「迷失少女」',
        outcome: { rewards: [{ kind: 'battle', stageName: '迷失少女' }] },
      },
      {
        id: 'o_nymph_leave',
        text: '不予理会，径直离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_stonesword',
    name: '石中剑',
    dungeon: 'starterVillage',
    floors: [2],
    cond: { type: 'always' },
    text: '你抵达一处秘境，一块巨石之中牢牢嵌着一柄神兵，这柄利器理应归属于你。',
    options: [
      {
        id: 'o_sword_int',
        text: '探寻隐藏机关',
        hint: '智力判定 60，成功获得一件可穿戴的附魔武器',
        outcome: { stat: { key: 'int', threshold: 60 }, rewards: [{ kind: 'enchantedWeapon' }] },
      },
      {
        id: 'o_sword_str',
        text: '奋力蛮力拔出',
        hint: '力量判定 60，成功获得一件可穿戴的附魔武器',
        outcome: { stat: { key: 'str', threshold: 60 }, rewards: [{ kind: 'enchantedWeapon' }] },
      },
      {
        id: 'o_sword_cha',
        text: '虔诚躬身跪拜',
        hint: '魅力判定 60，成功获得一件可穿戴的附魔武器',
        outcome: { stat: { key: 'cha', threshold: 60 }, rewards: [{ kind: 'enchantedWeapon' }] },
      },
      {
        id: 'o_sword_leave',
        text: '转身离去',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_silverbox',
    name: '白银宝箱',
    dungeon: 'starterVillage',
    floors: [2],
    cond: { type: 'always' },
    text: '探索途中，你发掘出一只银光闪闪的白银宝箱。',
    options: [
      {
        id: 'o_silverbox_item',
        text: '渴求绝世藏品',
        hint: '获得随机 10 级精良藏品',
        outcome: { rewards: [{ kind: 'randomItem', rarity: 'fine', level: 10 }] },
      },
      {
        id: 'o_silverbox_relic',
        text: '求取史前遗物',
        hint: '获得随机精良遗物',
        outcome: { rewards: [{ kind: 'randomRelic', rarity: 'fine' }] },
      },
    ],
  },
  {
    id: 'ev_lifetree',
    name: '生命之树',
    dungeon: 'starterVillage',
    floors: [2],
    cond: { type: 'always' },
    text: '一棵参天巨树伫立在眼前，树身流淌着充沛的生命力量。',
    options: [
      {
        id: 'o_tree_rest',
        text: '就地休憩',
        hint: '恢复 30% HP、30% MP',
        outcome: { rewards: [{ kind: 'heal', hpPct: 0.3, mpPct: 0.3 }] },
      },
      {
        id: 'o_tree_torch1',
        text: '点燃 1 根火把后休憩',
        hint: '恢复 60% HP、60% MP',
        cost: { torch: 1 },
        outcome: { rewards: [{ kind: 'heal', hpPct: 0.6, mpPct: 0.6 }] },
      },
      {
        id: 'o_tree_torch2',
        text: '点燃 2 根火把后休憩',
        hint: '恢复 100% HP、100% MP',
        cost: { torch: 2 },
        outcome: { rewards: [{ kind: 'heal', hpPct: 1, mpPct: 1 }] },
      },
    ],
  },
  {
    id: 'ev_pinky',
    name: '小粉（粉色史莱姆）',
    dungeon: 'starterVillage',
    floors: [2],
    cond: { type: 'always' },
    text: '你遇见一只粉色史莱姆，它并未对你发起攻击。',
    options: [
      {
        id: 'o_pinky_fight',
        text: '上前探查究竟',
        hint: '触发作战「小粉」',
        outcome: { rewards: [{ kind: 'battle', stageName: '小粉' }] },
      },
      {
        id: 'o_pinky_leave',
        text: '无视它，直接离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },

  // ===== 三层 =====
  {
    id: 'ev_goldencolony',
    name: '！？黄金？！',
    dungeon: 'starterVillage',
    floors: [3],
    cond: { type: 'always' },
    text: '矿洞最深处，一道耀眼的金色光芒在前方闪烁。',
    options: [
      {
        id: 'o_gold_probe',
        text: '上前探查',
        hint: '随机遭遇关卡：黄金狼人 / 黄金史莱姆',
        outcome: { rewards: [{ kind: 'battleRandom', stageNames: ['黄金狼人', '黄金史莱姆'] }] },
      },
      {
        id: 'o_gold_leave',
        text: '避而远之，不去靠近',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_pharaoh',
    name: '法老宫殿',
    dungeon: 'starterVillage',
    floors: [3],
    cond: { type: 'always' },
    text: '你踏入沙漠腹地，一座法老宫殿赫然出现在眼前，一股不祥的危机感萦绕在四周。',
    options: [
      {
        id: 'o_pharaoh_carpet',
        text: '径直进入宫殿',
        hint: '获得遗物【法老飞毯】',
        outcome: { rewards: [{ kind: 'relic', relicId: 'rl_pharaoh_carpet' }] },
      },
      {
        id: 'o_pharaoh_leave',
        text: '察觉危险，果断撤离',
        outcome: { rewards: [{ kind: 'none' }] },
      },
      {
        id: 'o_pharaoh_torch2',
        text: '消耗 2 根火把，谨慎探查',
        hint: '获得随机稀有藏品',
        cost: { torch: 2 },
        outcome: { rewards: [{ kind: 'randomItem', rarity: 'rare', level: 10 }] },
      },
      {
        id: 'o_pharaoh_torch3',
        text: '消耗 3 根火把，深度探查',
        hint: '获得藏品【卢克索的礼物】：传说饰品，回合开始时随机对一名敌人造成 50 点真实伤害',
        cost: { torch: 3 },
        outcome: { rewards: [{ kind: 'item', itemId: 'it_acc_luxor' }] },
      },
    ],
  },
  {
    id: 'ev_goldbox',
    name: '黄金宝箱',
    dungeon: 'starterVillage',
    floors: [3],
    cond: { type: 'always' },
    text: '历经艰险，你找到了一只华贵的黄金宝箱。',
    options: [
      {
        id: 'o_goldbox_item',
        text: '渴求绝世藏品',
        hint: '获得随机 10 级稀有藏品',
        outcome: { rewards: [{ kind: 'randomItem', rarity: 'rare', level: 10 }] },
      },
      {
        id: 'o_goldbox_relic',
        text: '求取史前遗物',
        hint: '获得随机稀有遗物',
        outcome: { rewards: [{ kind: 'randomRelic', rarity: 'rare' }] },
      },
    ],
  },
  {
    id: 'ev_squirrel',
    name: '三只松鼠',
    dungeon: 'starterVillage',
    floors: [3],
    cond: { type: 'always' },
    text: '你撞见了三只狡黠的松鼠，它们似乎愿意用遗物与你交易。',
    options: [
      {
        id: 'o_squirrel_1',
        text: '花费 1000 金币，换取 1 件遗物',
        hint: '获得 1 件随机遗物',
        cost: { coins: 1000 },
        outcome: { rewards: [{ kind: 'randomRelic' }] },
      },
      {
        id: 'o_squirrel_3',
        text: '花费 3000 金币，换取 3 件遗物',
        hint: '获得 3 件随机遗物',
        cost: { coins: 3000 },
        outcome: {
          rewards: [
            { kind: 'randomRelic' },
            { kind: 'randomRelic' },
            { kind: 'randomRelic' },
          ],
        },
      },
      {
        id: 'o_squirrel_leave',
        text: '转身离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },

  // ===== 灾厄泰拉 =====
  // 一层
  {
    id: 'ev_wugang_researcher',
    name: '钨钢研究者',
    dungeon: 'preWallCalamity',
    floors: [1],
    cond: { type: 'always' },
    text: '废墟工坊中金属撞击声不绝于耳，一位钨钢研究者正埋头摆弄泛着冷光的钨钢器械，各类成品与半成品散落工作台。你可以尝试与他交流，或是直接抽身离去。',
    options: [
      {
        id: 'o_wugang_talk',
        text: '上前与其探讨冶金技术',
        hint: '智力判定 60，成功获得随机藏品，失败触发紧急作战',
        outcome: {
          stat: { key: 'int', threshold: 60 },
          rewards: [{ kind: 'randomItem', rarity: 'rare', level: 30 }],
          fail: [{ kind: 'battle', stageName: '钨钢研究者', urgent: true }],
        },
      },
      {
        id: 'o_wugang_leave',
        text: '不做打扰，悄悄离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_four_times',
    name: '事不过四',
    dungeon: 'preWallCalamity',
    floors: [1],
    cond: { type: 'always' },
    text: '墙角蜷缩着一名乞丐，他半睁着眼，面前破碗里堆放着数量可观的哈哈币。你可以选择伸手取走碗中的钱币，也可以直接路过。重复拿取会招致灾祸。',
    options: [
      {
        id: 'o_four_take',
        text: '拿走碗里一部分钱币',
        hint: '获得1000哈哈币，可继续拿取；第4次将招致紧急作战',
        outcome: {
          rewards: [{ kind: 'coins', count: 1000 }],
          stay: true,
          stepInc: 1,
          battleIfStepGte: { step: 4, stageName: '事不过四', urgent: true },
        },
      },
      {
        id: 'o_four_leave',
        text: '就此离开此地',
        hint: '已拿取3次及以上离开会触发普通作战',
        outcome: {
          rewards: [{ kind: 'none' }],
          battleIfStepGte: { step: 3, stageName: '事不过四', urgent: false },
        },
      },
    ],
  },
  {
    id: 'ev_torch_god',
    name: '火把神的窥视',
    dungeon: 'preWallCalamity',
    floors: [1],
    cond: { type: 'always' },
    text: '周遭景物微微扭曲，跳动的火光笼罩你的周身，火把神的意志在此降临。祂准备两份礼物交由你抉择，你只能选取其中一份。',
    options: [
      {
        id: 'o_torch_god_coins',
        text: '接受财富的馈赠',
        hint: '获得 5000 哈哈币',
        outcome: { rewards: [{ kind: 'coins', count: 5000 }] },
      },
      {
        id: 'o_torch_god_torch',
        text: '接受火焰的馈赠',
        hint: '获得 2 根火把',
        outcome: { rewards: [{ kind: 'torch', count: 2 }] },
      },
    ],
  },
  {
    id: 'ev_weishu_hand',
    name: '伟叔的大手',
    dungeon: 'preWallCalamity',
    floors: [1],
    cond: { type: 'always' },
    text: '一团柔和光晕聚拢，一只巨大虚影手掌浮现在你的面前。伟叔的力量向你敞开，你可以选择其中一种形式的祝福。',
    options: [
      {
        id: 'o_weishu_relic',
        text: '求取神秘遗物祝福',
        hint: '获得一件随机遗物',
        outcome: { rewards: [{ kind: 'randomRelic' }] },
      },
      {
        id: 'o_weishu_heal',
        text: '求取生命魔力祝福',
        hint: '全队恢复 20% HP 和 MP',
        outcome: { rewards: [{ kind: 'heal', hpPct: 0.2, mpPct: 0.2 }] },
      },
    ],
  },

  // 二层
  {
    id: 'ev_fisherman',
    name: '我是钓鱼佬',
    dungeon: 'preWallCalamity',
    floors: [2],
    cond: { type: 'always' },
    text: '硫磺海滩岸散发刺鼻气息，浑浊的水面下隐约有黑影游动。岸边放着一套简陋的钓鱼工具，看样子曾有人在此垂钓。你要不要试一试运气甩下钓钩？',
    options: [
      {
        id: 'o_fish_cast',
        text: '拿起钓竿在此垂钓',
        hint: '触发紧急作战・我是钓鱼佬',
        outcome: { rewards: [{ kind: 'battle', stageName: '我是钓鱼佬', urgent: true }] },
      },
      {
        id: 'o_fish_leave',
        text: '水域太过凶险，直接离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_return_home',
    name: '重返家园',
    dungeon: 'preWallCalamity',
    floors: [2],
    cond: { type: 'always' },
    text: '一名满身风尘的流亡者站在残破的屋舍地基前，他渴望重建家园，愿意花费金钱召集帮手。你可以出资，请他召集一批冒险者供你挑选招募。',
    options: [
      {
        id: 'o_home_rare',
        text: '意思意思',
        hint: '消耗4000哈哈币，随机刷出3个稀有王牌单位供招募',
        cost: { coins: 4000 },
        outcome: { rewards: [{ kind: 'none' }], recruitRarity: 'rare' },
      },
      {
        id: 'o_home_epic',
        text: '重金寻人',
        hint: '消耗8000哈哈币，随机刷出3个史诗王牌单位供招募',
        cost: { coins: 8000 },
        outcome: { rewards: [{ kind: 'none' }], recruitRarity: 'epic' },
      },
      {
        id: 'o_home_leave',
        text: '还是算了',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_mushroom',
    name: '畸变菌菇丛',
    dungeon: 'preWallCalamity',
    floors: [2],
    cond: { type: 'always' },
    text: '遍地的畸变菌菇散发紫红色荧光，细密孢子四处飘散。菌菇的肉质看起来可以食用，但你完全无法分辨这一批究竟是滋补还是剧毒。',
    options: [
      {
        id: 'o_mushroom_eat',
        text: '吃下菌菇',
        hint: '意志判定 60，成功全队恢复20%HP/MP，失败扣除10%HP/MP',
        outcome: {
          stat: { key: 'wil', threshold: 60 },
          rewards: [{ kind: 'heal', hpPct: 0.2, mpPct: 0.2 }],
          fail: [{ kind: 'damage', hpPct: 0.1, mpPct: 0.1 }],
        },
      },
      {
        id: 'o_mushroom_leave',
        text: '不去触碰菌菇，绕道离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_storage_pit',
    name: '被遗忘的物资贮藏点',
    dungeon: 'preWallCalamity',
    floors: [2],
    cond: { type: 'always' },
    text: '地面露出一处塌陷的土坑，这是前人留下的物资贮藏点。木板全部腐朽，坑内杂物堆积，宝物与烂泥混在一起。',
    options: [
      {
        id: 'o_pit_lucky',
        text: '直接翻找贮藏坑',
        hint: '幸运判定 60，成功获得随机精良遗物，失败一无所获',
        outcome: {
          stat: { key: 'luk', threshold: 60 },
          rewards: [{ kind: 'randomRelic', rarity: 'rare' }],
          fail: [{ kind: 'none' }],
        },
      },
      {
        id: 'o_pit_agi',
        text: '仔细清理腐朽杂物再搜寻',
        hint: '敏捷判定 60，成功获得4000哈哈币，失败一无所获',
        outcome: {
          stat: { key: 'agi', threshold: 60 },
          rewards: [{ kind: 'coins', count: 4000 }],
          fail: [{ kind: 'none' }],
        },
      },
      {
        id: 'o_pit_leave',
        text: '贮藏坑风险不明，放弃搜寻离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },

  // 三层
  {
    id: 'ev_thunder_roll',
    name: '天雷滚滚',
    dungeon: 'preWallCalamity',
    floors: [3],
    cond: { type: 'always' },
    text: '乌云压满整片荒野，惊雷不断撕裂天幕，震耳的雷鸣由远及近。一头煌雷龙被风暴裹挟至此，电光在它鳞片之间噼啪跃动，狂暴的吼声回荡四野。',
    options: [
      {
        id: 'o_thunder_fight',
        text: '直面雷霆发起挑战',
        hint: '触发紧急作战・天雷滚滚，胜利后煌雷龙加入队伍',
        outcome: { rewards: [{ kind: 'battle', stageName: '天雷滚滚', urgent: true }] },
      },
      {
        id: 'o_thunder_leave',
        text: '寻地躲避，就此逃离',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_herb_merchant',
    name: '流浪的药草商人',
    dungeon: 'preWallCalamity',
    floors: [3],
    cond: { type: 'always' },
    text: '一名披着破斗篷的商人蹲在乱石路边，背包里塞满灾厄荒野采集来的奇异药草。他愿意以哈哈币向你兜售混合药剂，但这批药剂并没有经过任何安全检验。',
    options: [
      {
        id: 'o_herb_buy',
        text: '购买一筒混合药剂',
        hint: '消耗4000哈哈币，全队恢复20%HP与20%MP',
        cost: { coins: 4000 },
        outcome: { rewards: [{ kind: 'heal', hpPct: 0.2, mpPct: 0.2 }] },
      },
      {
        id: 'o_herb_leave',
        text: '手头拮据，拒绝交易离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_flesh_fissure',
    name: '血肉岩层裂隙',
    dungeon: 'preWallCalamity',
    floors: [3],
    cond: { type: 'always' },
    text: '血腥之地的岩层裂开一道狭长裂隙，温热的暗红色雾气缓缓升腾。裂隙内壁凝结着晶莹的血肉结晶，这种结晶价值不菲，但靠近就会被侵蚀。',
    options: [
      {
        id: 'o_flesh_collect',
        text: '冒险采集裂隙结晶',
        hint: '敏捷判定 60，成功获得6000哈哈币，失败全队HP-10%',
        outcome: {
          stat: { key: 'agi', threshold: 60 },
          rewards: [{ kind: 'coins', count: 6000 }],
          fail: [{ kind: 'damage', hpPct: 0.1 }],
        },
      },
      {
        id: 'o_flesh_leave',
        text: '不愿承受侵蚀，转身离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_shelter_cabinet',
    name: '避难所的遗留储藏柜',
    dungeon: 'preWallCalamity',
    floors: [3],
    cond: { type: 'always' },
    text: '一处早已废弃冒险者避难所，墙角立着上锁的大型储藏柜。柜子锁具完好，想要打开要么花费钱财撬动，要么就只能放弃。',
    options: [
      {
        id: 'o_cabinet_int',
        text: '工具撬开柜子',
        hint: '智力判定 60，成功获得随机遗物或随机藏品',
        outcome: {
          stat: { key: 'int', threshold: 60 },
          rewards: [{ kind: 'randomOne', rewards: [{ kind: 'randomRelic' }, { kind: 'randomItem', rarity: 'rare', level: 30 }] }],
          fail: [{ kind: 'none' }],
        },
      },
      {
        id: 'o_cabinet_str',
        text: '蛮力打开柜子',
        hint: '力量判定 60，成功获得随机遗物或随机藏品',
        outcome: {
          stat: { key: 'str', threshold: 60 },
          rewards: [{ kind: 'randomOne', rewards: [{ kind: 'randomRelic' }, { kind: 'randomItem', rarity: 'rare', level: 30 }] }],
          fail: [{ kind: 'none' }],
        },
      },
      {
        id: 'o_cabinet_leave',
        text: '放弃柜子离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },

  // 四层
  {
    id: 'ev_devil_waters',
    name: '魔鬼在人间',
    dungeon: 'preWallCalamity',
    floors: [4],
    cond: { type: 'always' },
    text: '浑浊漆黑的浅滩水域不断翻涌泡沫，水中隐约闪过几道畸形的鳍影。受灾厄力量扭曲变异的魔鬼鱼成群盘踞在此，水面之下危机四伏。',
    options: [
      {
        id: 'o_devil_enter',
        text: '踏入滩涂一探究竟',
        hint: '触发作战・魔鬼在人间',
        outcome: { rewards: [{ kind: 'battle', stageName: '魔鬼在人间', urgent: true }] },
      },
      {
        id: 'o_devil_leave',
        text: '远离危险水域绕道而行',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_blocked_eyes',
    name: '是什么遮住了我的眼',
    dungeon: 'preWallCalamity',
    floors: [4],
    cond: { type: 'always' },
    text: '海面骤然昏暗下来，日光被一片庞大的阴影彻底遮蔽。一头体型超乎想象的巨型乌贼浮现在近海，巨大的触手拍击海面，浪涛不断冲刷岸边。',
    options: [
      {
        id: 'o_eyes_fight',
        text: '向着海中巨影发起对峙',
        hint: '触发作战・是什么遮住了我的眼',
        outcome: { rewards: [{ kind: 'battle', stageName: '是什么遮住了我的眼', urgent: true }] },
      },
      {
        id: 'o_eyes_leave',
        text: '趁它尚未注意，迅速撤离海岸',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_giant_turtle',
    name: '荒林巨龟遗骸',
    dungeon: 'preWallCalamity',
    floors: [4],
    cond: { type: 'always' },
    text: '丛林的洼地之中躺着一头巨型古龟的遗骸，血肉早已被灾厄生灵啃食殆尽，唯独一副完整厚重的龟壳完好留存。外壳布满风化划痕，却依旧坚硬无比。',
    options: [
      {
        id: 'o_turtle_peel',
        text: '小心剥离龟壳',
        hint: '力量判定 60，成功获得遗物【巨大龟壳】，失败龟壳碎裂',
        outcome: {
          stat: { key: 'str', threshold: 60 },
          rewards: [{ kind: 'relic', relicId: 'rl_giant_turtle_shell' }],
          fail: [{ kind: 'none' }],
        },
      },
      {
        id: 'o_turtle_buy',
        text: '花费4000哈哈币，就地拆解加固',
        hint: '获得遗物【巨大龟壳】',
        cost: { coins: 4000 },
        outcome: { rewards: [{ kind: 'relic', relicId: 'rl_giant_turtle_shell' }] },
      },
      {
        id: 'o_turtle_leave',
        text: '不去触碰遗骸，绕道离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_scavenger',
    name: '迷途的拾荒者',
    dungeon: 'preWallCalamity',
    floors: [4],
    cond: { type: 'always' },
    text: '一名满身沙尘的拾荒者蜷缩在岩石背风处，他在荒野搜集到不少灾厄材料，愿意出让物资换取一笔哈哈币维持生计。',
    options: [
      {
        id: 'o_scavenger_buy',
        text: '出钱收购物资',
        hint: '消耗4000哈哈币，二选一：中级HP/MP药各2瓶 或 3个随机品质强化石',
        cost: { coins: 4000 },
        outcome: {
          rewards: [
            {
              kind: 'randomOne',
              rewards: [
                { kind: 'item', itemId: 'it_potion_hp_m' },
                { kind: 'item', itemId: 'it_potion_hp_m' },
                { kind: 'item', itemId: 'it_potion_mp_m' },
                { kind: 'item', itemId: 'it_potion_mp_m' },
              ],
            },
            ...[0, 1, 2].map(() => ({
              kind: 'randomOne' as const,
              rewards: [
                ...Array(6).fill({ kind: 'item' as const, itemId: 'it_stone_rare' }),
                ...Array(3).fill({ kind: 'item' as const, itemId: 'it_stone_epic' }),
                { kind: 'item' as const, itemId: 'it_stone_legendary' },
              ],
            })),
          ],
        },
      },
      {
        id: 'o_scavenger_leave',
        text: '不愿交易，径直走开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },

  // 五层
  {
    id: 'ev_ice_gaze',
    name: '冰原的凝望',
    dungeon: 'preWallCalamity',
    floors: [5],
    cond: { type: 'always' },
    text: '凛冽寒风呼啸而过，冻土之上站着数名身躯皲裂的木裂战士。它们沉默伫立，空洞的目光牢牢锁定了你，周身萦绕着肃杀的寒气。',
    options: [
      {
        id: 'o_ice_fight',
        text: '上前面对这群冻土守卫',
        hint: '触发紧急作战・冰原的凝望',
        outcome: { rewards: [{ kind: 'battle', stageName: '冰原的凝望', urgent: true }] },
      },
      {
        id: 'o_ice_leave',
        text: '避开它们的视线悄悄退走',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_past_recall',
    name: '往日的回想',
    dungeon: 'preWallCalamity',
    floors: [5],
    cond: { type: 'always' },
    text: '陈旧的魔力残响在此地盘旋飘荡，过去疯狂实验留下的印记依旧未曾消散。一股躁动的力量正在苏醒，你完全无法预判接下来将要面对何物。',
    options: [
      {
        id: 'o_past_burst',
        text: '放任魔力残响彻底爆发',
        hint: '随机触发紧急作战：人造物狂欢节 或 疯子在右',
        outcome: { rewards: [{ kind: 'battleRandom', stageNames: ['人造物狂欢节', '疯子在右'] }] },
      },
      {
        id: 'o_past_leave',
        text: '斩断思绪，不去触碰这份过往',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_storm_coast',
    name: '风暴过后的海岸',
    dungeon: 'preWallCalamity',
    floors: [5],
    cond: { type: 'always' },
    text: '猛烈风暴刚刚席卷海岸，大量海洋杂物被海浪推上沙滩，破碎船板、贝壳与海洋生物残骸混杂在一起，其中不乏来自沉沦之海的稀罕物件。',
    options: [
      {
        id: 'o_coast_search',
        text: '在海滩上仔细搜寻',
        hint: '敏捷判定 60，成功获得随机稀有遗物，失败一无所获',
        outcome: {
          stat: { key: 'agi', threshold: 60 },
          rewards: [{ kind: 'randomRelic', rarity: 'rare' }],
          fail: [{ kind: 'none' }],
        },
      },
      {
        id: 'o_coast_leave',
        text: '简单扫视后离开海滩',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_jiadeng_folder',
    name: '嘉登散落的档案夹',
    dungeon: 'preWallCalamity',
    floors: [5],
    cond: { type: 'always' },
    text: '一处半埋于碎石下的嘉登档案夹，外壳经受灾厄风沙侵蚀，里面封存着机械与装备的制作图纸，部分书页已经受潮损毁。',
    options: [
      {
        id: 'o_folder_int',
        text: '就地翻阅搜寻图纸',
        hint: '智力判定 60，成功获得附魔PRO图纸，失败一无所获',
        outcome: {
          stat: { key: 'int', threshold: 60 },
          rewards: [{ kind: 'item', itemId: 'it_bp_enchanted_pro' }],
          fail: [{ kind: 'none' }],
        },
      },
      {
        id: 'o_folder_luk',
        text: '小心烘干修复档案',
        hint: '幸运判定 60，成功获得附魔PRO图纸，失败一无所获',
        outcome: {
          stat: { key: 'luk', threshold: 60 },
          rewards: [{ kind: 'item', itemId: 'it_bp_enchanted_pro' }],
          fail: [{ kind: 'none' }],
        },
      },
      {
        id: 'o_folder_leave',
        text: '不去翻动这份档案，直接离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },

  // 3-5层通用
  {
    id: 'ev_whack_mole',
    name: '敲地鼠',
    dungeon: 'preWallCalamity',
    floors: [3, 4, 5],
    cond: { type: 'always' },
    text: '地面上出现数个幽深小洞，时不时有影子一闪而过。你可以投入哈哈币参与这场敲地鼠游戏，以此换取遗物。',
    options: [
      {
        id: 'o_mole_once',
        text: '花费2500哈哈币参与一次',
        hint: '获得 1 个随机遗物',
        cost: { coins: 2500 },
        outcome: { rewards: [{ kind: 'randomRelic' }] },
      },
      {
        id: 'o_mole_multi',
        text: '花费7000哈哈币开启多轮游戏',
        hint: '获得 3 个随机遗物',
        cost: { coins: 7000 },
        outcome: { rewards: [{ kind: 'randomRelic', count: 3 }] },
      },
      {
        id: 'o_mole_leave',
        text: '对此游戏毫无兴趣，直接离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_mage_play',
    name: '马哥玩耍',
    dungeon: 'preWallCalamity',
    floors: [3, 4, 5],
    cond: { type: 'always' },
    text: '一名神态捉摸不透的男子拦住了你，他想要把玩你手中的遗物。交出两件遗物，他便会随机回馈你一份酬谢，酬谢好坏全凭运气。',
    options: [
      {
        id: 'o_mage_trade',
        text: '上交随机两件遗物',
        hint: '失去2件遗物，随机获得酬谢（35%稀有藏品/25%5000币/15%10000币/10%史诗遗物/5%4件遗物/10%2火把）',
        outcome: {
          rewards: [
            { kind: 'removeRelic', count: 2 },
            {
              kind: 'randomOne',
              rewards: [
                ...Array(35).fill({ kind: 'randomItem', rarity: 'rare', level: 30 }),
                ...Array(25).fill({ kind: 'coins', count: 5000 }),
                ...Array(15).fill({ kind: 'coins', count: 10000 }),
                ...Array(10).fill({ kind: 'randomRelic', rarity: 'epic' }),
                ...Array(5).fill({ kind: 'randomRelic', count: 4 }),
                ...Array(10).fill({ kind: 'torch', count: 2 }),
              ],
            },
          ],
        },
      },
      {
        id: 'o_mage_leave',
        text: '不愿交出遗物，直接离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_fangyuan',
    name: '歹毒的方源',
    dungeon: 'preWallCalamity',
    floors: [3, 4, 5],
    cond: { type: 'always' },
    text: '一名眼神淡漠的神秘之人挡在你的前路。他可以给予你丰厚物资，但每一档馈赠，都需要全队承受一份生命损耗作为代价。',
    options: [
      {
        id: 'o_fangyuan_1',
        text: '接受第一档交易（全队HP-5%）',
        hint: '获得：3000币 或 1火把 或 全队恢复5%HP',
        outcome: {
          rewards: [
            { kind: 'damage', hpPct: 0.05 },
            { kind: 'randomOne', rewards: [{ kind: 'coins', count: 3000 }, { kind: 'torch', count: 1 }, { kind: 'heal', hpPct: 0.05, mpPct: 0 }] },
          ],
        },
      },
      {
        id: 'o_fangyuan_2',
        text: '接受第二档交易（全队HP-10%）',
        hint: '获得：4000币 或 1火把 或 全队恢复10%HP',
        outcome: {
          rewards: [
            { kind: 'damage', hpPct: 0.1 },
            { kind: 'randomOne', rewards: [{ kind: 'coins', count: 4000 }, { kind: 'torch', count: 1 }, { kind: 'heal', hpPct: 0.1, mpPct: 0 }] },
          ],
        },
      },
      {
        id: 'o_fangyuan_3',
        text: '接受第三档交易（全队HP-15%）',
        hint: '获得：6000币 或 2火把 或 全队恢复15%HP',
        outcome: {
          rewards: [
            { kind: 'damage', hpPct: 0.15 },
            { kind: 'randomOne', rewards: [{ kind: 'coins', count: 6000 }, { kind: 'torch', count: 2 }, { kind: 'heal', hpPct: 0.15, mpPct: 0 }] },
          ],
        },
      },
      {
        id: 'o_fangyuan_4',
        text: '接受第四档交易（全队HP-20%）',
        hint: '获得：7000币 或 3火把 或 全队恢复20%HP',
        outcome: {
          rewards: [
            { kind: 'damage', hpPct: 0.2 },
            { kind: 'randomOne', rewards: [{ kind: 'coins', count: 7000 }, { kind: 'torch', count: 3 }, { kind: 'heal', hpPct: 0.2, mpPct: 0 }] },
          ],
        },
      },
      {
        id: 'o_fangyuan_leave',
        text: '拒绝交易，抽身离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
  {
    id: 'ev_big_aunt',
    name: '大鸡婶婶',
    dungeon: 'preWallCalamity',
    floors: [3, 4, 5],
    cond: { type: 'always' },
    text: '一位打扮怪异的大婶站在前方，她手上握着一团跳动的火焰。消耗一根火把交给她，她会施展力量，结局好坏完全不可预测。',
    options: [
      {
        id: 'o_aunt_trade',
        text: '消耗一根火把，将火把交予大鸡婶婶',
        hint: '三选一随机：随机遗物 或 随机藏品 或 触发本层紧急作战',
        cost: { torch: 1 },
        outcome: {
          rewards: [
            {
              kind: 'randomOne',
              rewards: [
                { kind: 'randomRelic' },
                { kind: 'randomItem', rarity: 'rare', level: 30 },
                { kind: 'battleRandom', stageNames: ['天雷滚滚', '冰原的凝望', '人造物狂欢节', '疯子在右'] },
              ],
            },
          ],
        },
      },
      {
        id: 'o_aunt_leave',
        text: '不做交易，直接离开',
        outcome: { rewards: [{ kind: 'none' }] },
      },
    ],
  },
];

export const EVENT_MAP: Record<string, EventDef> = Object.fromEntries(
  EVENTS.map((e) => [e.id, e]),
);

// 合并内置事件与存档中的自定义事件（自定义事件 id 不与内置冲突，冲突时内置优先）
export function allEvents(save: Pick<SaveData, 'customEvents'>): EventDef[] {
  return [...EVENTS, ...(save.customEvents ?? [])];
}

export function eventMapOf(save: Pick<SaveData, 'customEvents'>): Record<string, EventDef> {
  const m: Record<string, EventDef> = { ...EVENT_MAP };
  for (const e of save.customEvents ?? []) m[e.id] = e;
  return m;
}
