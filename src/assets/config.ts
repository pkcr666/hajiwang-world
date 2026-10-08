// 所有图片走文生图接口生成像素风占位素材，路径集中配置，正式美术到位后可整批替换。
const BASE = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image';
const img = (prompt: string, size: string) =>
  `${BASE}?prompt=${encodeURIComponent(prompt)}&image_size=${size}`;
const px = (s: string) =>
  `pixel art game sprite, ${s}, plain solid dark background, crisp pixels, full body centered`;

const BASE_URL = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

export const JOB_IMAGES: Record<string, string> = {
  cat: `${BASE_URL}cat.png?v=1`,
  // 提丰：像素风本地 PNG 资产（public/typhon.png），保留紫发/双黑角/黑白科幻服+红点缀/举灯笑脸等标志性元素
  typhon: `${BASE_URL}typhon.png?v=3`,
  kayn: `${BASE_URL}kayn.jpg?v=1`,
  logos: `${BASE_URL}角色资源/逻各斯.png?v=1`,
  dandan: `${BASE_URL}角色资源/氮氮.jpg?v=1`,
  masked: `${BASE_URL}角色资源/神秘面具男.jpg?v=1`,
  augusta: `${BASE_URL}角色资源/奥古斯塔.jpg?v=1`,
  lee: `${BASE_URL}角色资源/小李.png?v=1`,
  donk: `${BASE_URL}角色资源/DONK.png?v=1`,
  exusiai: `${BASE_URL}角色资源/能天使.jpg?v=1`,
  eimis: `${BASE_URL}角色资源/爱弥斯.jpg?v=1`,
  eimisMech: `${BASE_URL}角色资源/爱弥斯-机甲.png?v=1`,
  rein: `${BASE_URL}角色资源/里恩.png?v=1`,
  reinLiberation: `${BASE_URL}角色资源/里恩解放.png?v=1`,
};

// 王牌单位立绘（AI 生成像素风，位于 public/王牌资源/）
export const ACE_IMAGES: Record<string, string> = {
  ace_fangyuan: `${BASE_URL}王牌资源/超级方源大猩猩.png?v=1`,
  ace_judianfu: `${BASE_URL}王牌资源/句点夫.png?v=1`,
  ace_moxuluo: `${BASE_URL}王牌资源/魔虚罗.png?v=1`,
  ace_jiahao: `${BASE_URL}王牌资源/嘉豪.png?v=1`,
  ace_thunderbird: `${BASE_URL}王牌资源/雷鸟.png?v=1`,
  ace_huangleilong: `${BASE_URL}王牌资源/煌雷龙.png?v=1`,
  ace_super_warrior: `${BASE_URL}王牌资源/超级战士.png?v=1`,
  ace_daniya: `${BASE_URL}王牌资源/达尼娅.png?v=1`,
  ace_wangyuan: `${BASE_URL}王牌资源/王源.png?v=1`,
  ace_dingzhen: `${BASE_URL}王牌资源/丁真.png?v=1`,
  ace_maikou: `${BASE_URL}王牌资源/麦扣.png?v=1`,
  ace_dagou: `${BASE_URL}王牌资源/大狗.png?v=1`,
};

export const MONSTER_IMAGES: Record<string, string> = {
  // 一层 · 泰拉初探
  slime: img(px('a cute round green slime blob monster with big eyes'), 'square_hd'),
  zombie: img(px('a classic pixel art zombie with torn gray clothes and green skin, arms reaching forward'), 'square_hd'),
  eyeball: img(px('a floating demonic eyeball monster with teeth on its iris and small wings, staring forward'), 'square_hd'),
  piranha: img(px('an aggressive red piranha fish with sharp teeth, side view'), 'square_hd'),
  // 二层 · 矿洞初探
  caveBat: img(px('a brown cave bat with spread wings and glowing eyes'), 'square_hd'),
  caveSkeleton: img(px('a mining skeleton wearing miner helmet with lit candle, holding a pickaxe'), 'square_hd'),
  worm: img(px('a giant segmented cave worm burrower with multiple body segments and big teeth'), 'square_hd'),
  doctorBones: img(px('a skeleton archaeologist wearing a jungle pith helmet and safari suit, eerie smile'), 'square_hd'),
  shark: img(px('a fierce great white shark with open jaws, side view'), 'square_hd'),
  nymph: img(px('a sinister disheveled nymph girl with torn dark clothes and glowing eyes, hidden monster'), 'square_hd'),
  pinky: img(px('a tiny round bright pink slime blob with small smile, cute but tough'), 'square_hd'),
  kingSlime: img(px('a giant blue slime king wearing a golden crown, a ninja trapped inside its body'), 'square_hd'),
  // 三层 · 恐惧的凝视
  mosquito: img(px('a giant pixel art mosquito with long proboscis, translucent wings and red eyes, biting'), 'square_hd'),
  spider: img(px('a hairy black cave spider with red eyes and eight legs'), 'square_hd'),
  poisonSpider: img(px('a venomous green spider with dripping poison fangs and purple markings'), 'square_hd'),
  harpy: img(px('a harpy monster woman with feathered wings, talons and feather hair, swooping'), 'square_hd'),
  iceSlime: img(px('a blue icy slime blob with ice crystals and frost aura'), 'square_hd'),
  jungleSlime: img(px('a green jungle slime blob with leaves and vines on its body'), 'square_hd'),
  bigSlime: img(px('a very large dark purple corrupted slime blob with menacing eyes'), 'square_hd'),
  werewolf: img(px('a ferocious gray werewolf standing upright with claws and fangs, full moon vibe'), 'square_hd'),
  goldenWerewolf: img(px('a majestic golden-furred werewolf standing upright with glowing claws, elite monster'), 'square_hd'),
  goldenSlime: img(px('a shiny golden slime blob monster with sparkles and big eyes, rare elite'), 'square_hd'),
  antlion: img(px('an antlion larva insect monster with giant mandibles emerging from sand'), 'square_hd'),
  antlionFlyer: img(px('a flying adult antlion dragonfly-like insect with four transparent wings and big jaws'), 'square_hd'),
  eyeOfCthulhu: img(px('a giant demonic eyeball boss with iris pupil and toothy mouth, iris chain tendrils, menacing'), 'square_hd'),
  // 子层 · 瑟银的菜鸟
  littleThunderbird: img(px('a small cute blue thunder bird chick crackling with tiny lightning sparks'), 'square_hd'),
  thunderbird: img(px('a majestic thunder bird boss with blue feathers, crackling lightning around its wings'), 'square_hd'),
  // 新手村 · 抢商店BOSS（袁绍：使用本地角色资源图片）
  yuanShao: '角色资源/袁绍.jpg',
};

export const DUNGEON_IMAGES: Record<string, string> = {
  starterVillage: img(
    px('a cozy pixel art fantasy starter village with small wooden houses, green hills, morning sunshine, rpg dungeon select banner'),
    'landscape_16_9',
  ),
  preWallTerraria: img(
    px('a dangerous pre-hardmode fantasy wilderness, dark forest caves with slimes and zombies lurking, torch light, rpg dungeon select banner'),
    'landscape_16_9',
  ),
  preWallCalamity: img(
    px('an apocalyptic cursed pre-hardmode land, purple toxic sky, glowing evil ore and shadow monsters, dramatic dark rpg dungeon select banner'),
    'landscape_16_9',
  ),
};

export const SLOT_IMAGES: Record<string, string> = {
  weapon: img(px('a generic iron sword weapon game icon'), 'square'),
  helmet: img(px('a generic metal helmet armor game icon'), 'square'),
  armor: img(px('a generic metal chest armor game icon'), 'square'),
  boots: img(px('a pair of leather boots game icon'), 'square'),
  accessory: img(px('a golden ring with gem amulet accessory game icon'), 'square'),
  consumable: img(px('a red potion bottle game item icon'), 'square'),
  material: img(px('a generic gray ore stone material game icon'), 'square'),
};

export const itemIcon = (slot: string, custom?: string) =>
  custom ?? SLOT_IMAGES[slot] ?? SLOT_IMAGES.material;
