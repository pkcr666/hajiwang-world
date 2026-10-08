import type { MonsterUnit } from '../types';
// 数据源：monsters.json（图鉴编辑后由 dev server 写回，构建时随 JS 打包）
import monstersJson from './monsters.json';

// 内置怪物名单：首次进入/版本更新时播种到存档，图鉴内可直接修改或删除。
// 数据源为 monsters.json：dev 模式下图鉴编辑会写回该文件，构建时打包进产物。
export const MONSTER_SEED_VERSION = 16;

export const DEFAULT_MONSTERS: MonsterUnit[] = monstersJson as MonsterUnit[];
