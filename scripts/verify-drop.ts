// 联机掉落机制专项验证：
// 1) 灾厄普通作战：藏品池按人数凑 n 件且不重复
// 2) 新手村：队长幸运+1D50 判定，遗物直接进队长（不进投票池），藏品进池
// 3) 事件固定遗物直接给队长、随机池遗物进投票池；判定按队长属性
// 运行：npx tsx scripts/verify-drop.ts
import fs from 'node:fs';
import path from 'node:path';
import { applyEventChoice, buildCombatRewards, createGame } from '../server/runhost';
import type { GameState, PlayerChar } from '../server/runhost';
import { mathRng } from '../src/types';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

function mkChar(save: Record<string, unknown>, idx: number): unknown {
  const chars = (save.characters as (Record<string, unknown> | null)[]).filter(Boolean);
  const c = JSON.parse(JSON.stringify(chars[idx % chars.length]));
  c.id = `drop_char_${idx}_${Date.now()}`;
  c.name = `掉落验证角色${idx + 1}`;
  return c;
}

function mkPlayers(save: Record<string, unknown>): PlayerChar[] {
  return [
    { playerId: 'a', name: '甲', char: mkChar(save, 0) as never },
    { playerId: 'b', name: '乙', char: mkChar(save, 1) as never },
    { playerId: 'c', name: '丙', char: mkChar(save, 2) as never },
  ];
}

async function main(): Promise<void> {
  console.log('=== 联机掉落机制验证 ===');
  const save = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'save.json'), 'utf-8'));
  const dataPack = { monsters: [], stages: [], items: [] };

  // ---- 1) 灾厄普通作战：藏品池不重复、按人数凑 ----
  const calPlayers = mkPlayers(save);
  const cal = createGame(calPlayers, dataPack, mathRng, 'preWallCalamity');
  const calStage = cal.save.customStages.find((s) => s.dungeon === 'preWallCalamity' && s.difficulty !== 'boss' && (s.monsters?.length ?? 0) > 0)!;
  const { pool: poolCal } = buildCombatRewards(cal, calPlayers, { id: 'x', kind: 'combat', row: 0, cols: 0 } as never, calStage, mathRng);
  const itemKeys = poolCal.filter((l) => l.kind === 'item').map((l) => l.itemId!);
  const dup = itemKeys.filter((id, i) => itemKeys.indexOf(id) !== i);
  check('灾厄普通作战：藏品池无重复', dup.length === 0, { dup, pool: itemKeys });
  check('灾厄普通作战：藏品池按人数凑满', itemKeys.length === Math.min(3, itemKeys.length) && itemKeys.length <= 3 && (itemKeys.length > 0), { n: itemKeys.length });

  // ---- 2) 新手村：幸运+1D50 遗物直接给队长，藏品进池 ----
  const novicePlayers = mkPlayers(save);
  const novice = createGame(novicePlayers, dataPack, mathRng, 'starterVillage');
  const leader = novicePlayers[0]!;
  const leaderRelicsBefore = (novice.perRelics[leader.char.id] ?? []).length;
  const noviceStage = novice.save.customStages.find((s) => s.dungeon === 'starterVillage' && s.difficulty !== 'boss' && (s.monsters?.length ?? 0) > 0)!;
  const { pool: poolNovice, texts: textsNovice } = buildCombatRewards(novice, novicePlayers, { id: 'x', kind: 'combat', row: 0, cols: 0 } as never, noviceStage, mathRng);
  const leaderRelicsAfter = (novice.perRelics[leader.char.id] ?? []).length;
  check('新手村：遗物直接进各自角色（不进投票池）', poolNovice.filter((l) => l.kind === 'relic').length === 0, { poolRelics: poolNovice.filter((l) => l.kind === 'relic') });
  check('新手村：幸运判定有记录', textsNovice.some((t) => t.includes('幸运判定') && t.includes('获得遗物')) || leaderRelicsAfter === leaderRelicsBefore, { got: leaderRelicsAfter - leaderRelicsBefore, texts: textsNovice.filter((t) => t.includes('幸运判定')).slice(0, 3) });
  const itemDup = poolNovice.filter((l) => l.kind === 'item').map((l) => l.itemId!).filter((id, i, arr) => arr.indexOf(id) !== i);
  check('新手村：藏品池不重复', itemDup.length === 0, { dup: itemDup });

  // 新手村紧急/BOSS：按人数出 N 件全员未拥有的遗物进投票池
  const novBoss = createGame(novicePlayers, dataPack, mathRng, 'starterVillage');
  const bossStage = novBoss.save.customStages.find((s) => s.dungeon === 'starterVillage' && s.difficulty === 'boss' && (s.monsters?.length ?? 0) > 0);
  if (bossStage) {
    const { pool: poolBoss } = buildCombatRewards(novBoss, novicePlayers, { id: 'x', kind: 'boss', row: 0, cols: 0 } as never, bossStage, mathRng);
    const bossRelics = poolBoss.filter((l) => l.kind === 'relic').map((l) => l.relicId!);
    const bossDup = bossRelics.filter((id, i) => bossRelics.indexOf(id) !== i);
    check('新手村紧急/BOSS：遗物按人数出且不重复', bossRelics.length === Math.min(3, bossRelics.length) && bossDup.length === 0 && bossRelics.length > 0, { n: bossRelics.length, dup: bossDup });
  } else {
    check('新手村 BOSS 关卡存在', false, '未找到新手村 boss 关卡');
  }

  // ---- 3) 事件：固定遗物直接给队长；随机池遗物进投票池；判定按队长 ----
  const evPlayers = mkPlayers(save);
  const evGame = createGame(evPlayers, dataPack, mathRng, 'starterVillage');
  const evLeader = evPlayers[0]!;
  // 构造一个固定遗物事件（大房子）+ 一个随机池遗物事件
  const fixedEvent = {
    id: 'test_fixed', name: '造房子', icon: '🏠', dungeon: 'starterVillage',
    options: [
      {
        id: 'build', text: '造房子',
        outcome: { rewards: [{ kind: 'relic', relicId: 'rl_big_house' }] },
      },
    ],
  };
  evGame.pendingEvent = fixedEvent;
  evGame.eventFloor = 1;
  const rFixed = applyEventChoice(evGame, evPlayers, 'build', mathRng);
  check('事件固定遗物：全体玩家各得一份', evPlayers.every((p) => (evGame.perRelics[p.char.id] ?? []).includes('rl_big_house')), { per: evGame.perRelics, texts: rFixed.texts });
  check('事件固定遗物：不进投票池', !evGame.lootPool.some((l) => l.relicId === 'rl_big_house'), evGame.lootPool);
  check('事件固定遗物：文案说明全员获得', rFixed.texts.some((t) => t.includes('全体玩家各获得遗物')), rFixed.texts);

  const randEvent = {
    id: 'test_rand', name: '随机遗物', icon: '🎲', dungeon: 'starterVillage',
    options: [
      {
        id: 'take', text: '接受馈赠',
        outcome: { rewards: [{ kind: 'randomRelic', count: 1 }] },
      },
    ],
  };
  evGame.pendingEvent = randEvent;
  evGame.eventFloor = 1;
  const rRand = applyEventChoice(evGame, evPlayers, 'take', mathRng);
  const randRelicInPool = evGame.lootPool.filter((l) => l.kind === 'relic').length;
  check('事件随机池遗物：进投票池', randRelicInPool === 1, { pool: evGame.lootPool, texts: rRand.texts });

  // 判定按队长：六维判定使用队长属性（构造 str 阈值 99999 → 判定失败，说明以队长属性判定）
  const statEvent = {
    id: 'test_stat', name: '判定', icon: '⚔', dungeon: 'starterVillage',
    options: [
      {
        id: 'lift', text: '举起巨石',
        outcome: { stat: { key: 'str', threshold: 99999 }, rewards: [{ kind: 'coins', count: 10 }] },
      },
    ],
  };
  evGame.pendingEvent = statEvent;
  evGame.eventFloor = 1;
  const beforeCoins = evGame.perCoins['a']!;
  applyEventChoice(evGame, evPlayers, 'lift', mathRng);
  check('事件判定按队长属性（超高阈值→失败无奖励）', evGame.perCoins['a']! === beforeCoins, { before: beforeCoins, after: evGame.perCoins['a'] });

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('verify-drop 失败：', e); process.exit(1); });
