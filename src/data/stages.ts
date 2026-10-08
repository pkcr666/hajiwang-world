import type { DropEntry, LuckyDrop, RarityWeights, StageDef } from '../types';
// 数据源：stages.json（关卡库编辑后由 dev server 写回，构建时随 JS 打包）
import stagesJson from './stages.json';

// 内置关卡名单：首次进入/版本更新时播种到存档，关卡库内可直接修改或删除。
// 数据源为 stages.json：dev 模式下编辑会写回该文件，构建时打包进产物。
export const STAGE_SEED_VERSION = 9;

export const STAGE_POOL_WEIGHTS: RarityWeights = { uncommon: 40, fine: 30, rare: 20, epic: 10 };

export const stageDropPool = (): DropEntry[] => [
  { id: 'd_item_pool', kind: 'item', source: 'pool', rarityWeights: STAGE_POOL_WEIGHTS, weight: 100 },
];

// 幸运掉落：普通=判定60；紧急/BOSS=判定60 + 判定1
export const stageLuckyPool = (extra: boolean): LuckyDrop[] => {
  const list: LuckyDrop[] = [
    { id: 'l_relic_60', kind: 'relic', source: 'pool', rarityWeights: STAGE_POOL_WEIGHTS, threshold: 60 },
  ];
  if (extra) {
    list.push({ id: 'l_relic_1', kind: 'relic', source: 'pool', rarityWeights: STAGE_POOL_WEIGHTS, threshold: 1 });
  }
  return list;
};

export const DEFAULT_STAGES: StageDef[] = stagesJson as StageDef[];
