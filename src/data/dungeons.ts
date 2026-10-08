import { DUNGEON_IMAGES } from '../assets/config';

export interface DungeonDef {
  id: string;
  name: string;
  stars: number; // 难度星级
  level: number; // 推荐/通关等级下限
  levelMax?: number; // 推荐/通关等级上限（缺省时与 level 相同，界面显示单值）
  maxParty: number; // 最多出战人数
  floors: [number, number]; // 总层数区间（每次进入随机）
  desc: string;
  banner: string;
  family?: 'terraria' | 'crisis'; // 副本系列
}

// 副本列表：新手村 + 灾厄泰拉 同属「泰拉系列」；灾厄泰拉为 30-40 级挑战，初始仅 1 人出战
export const DUNGEONS: DungeonDef[] = [
  {
    id: 'starterVillage',
    name: '新手村',
    stars: 1,
    level: 10,
    maxParty: 1,
    floors: [3, 3],
    desc: '推荐10级挑战。最多 1 人，共 3 层。新手入门必打，在温和的战斗里学会技能与藏品搭配。',
    banner: DUNGEON_IMAGES.starterVillage,
    family: 'terraria',
  },
  {
    id: 'preWallCalamity',
    name: '灾厄泰拉',
    stars: 4,
    level: 30,
    levelMax: 40,
    maxParty: 1,
    floors: [5, 7],
    desc: '推荐30-40级挑战。初始仅 1 人出战，共 5–7 层（每次进入随机）。灾厄降临的绝对困难挑战，请做好万全准备。',
    banner: DUNGEON_IMAGES.preWallCalamity,
    family: 'terraria',
  },
  {
    id: 'crisisContract',
    name: '危机合约',
    stars: 5,
    level: 30,
    maxParty: 2,
    floors: [8, 8],
    desc: '仅限30级且无外挂标的角色进入。最多2人，固定8节点（5战3休）。选择合约词条提升分数，挑战极限。',
    banner: DUNGEON_IMAGES.preWallCalamity,
    family: 'crisis',
  },
];
