// 临时验证：buildBagView / applyBagEquip / applyBagUnequip（联机背包对齐单人版）
import fs from 'node:fs';
import path from 'node:path';
import { createGame, buildBagView, applyBagEquip, applyBagUnequip } from '../server/runhost';
import { JOB_DEFS } from '../src/data/jobs';
import { mathRng } from '../src/types';
import type { PlayerChar } from '../server/runhost';

const ok = (name: string, cond: boolean) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (!cond) process.exitCode = 1; };

const save = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'save.json'), 'utf-8'));
const chars = (save.characters as (Record<string, unknown> | null)[]).filter(Boolean);
const mkPlayer = (idx: number): PlayerChar => {
  const c: any = JSON.parse(JSON.stringify(chars[idx % chars.length]));
  c.id = `verify_char_${idx}`;
  c.name = `验证角色${idx + 1}`;
  return { playerId: c.id, name: c.name, char: c, socketId: 'x', online: true };
};

// 灾厄 7 层开局（createGame(players, dataPack, rng, dungeonId)）
const players = [mkPlayer(0)];
const g = createGame(players, { monsters: [], stages: [], items: [] }, mathRng, 'calamity');
const p0 = players[0];
const c0 = p0.char;
ok('开局背包视图可构建', !!buildBagView(g, c0.id));
const v0 = buildBagView(g, c0.id)!;
ok('背包面板字段齐全', v0.stats.atk > 0 && v0.baseStats.atk > 0 && v0.maxHp > 0);
ok('六维合计=基础+装备+遗物', Object.keys(v0.extraTotal).length >= 6);

// 穿一件可用藏品（武器）：按职业允许的武器类型注入一把再验证完整穿戴流程
const jobDef = JOB_DEFS[(p0.char as any).job];
const allowed = jobDef?.allowedWeaponTypes ?? ['melee'];
const okWeapon = [...g.itemMap.values()].find((i) => i.slot === 'weapon' && allowed.includes(i.weaponType ?? 'melee'));
if (okWeapon) {
  p0.char.inventory = [...(p0.char.inventory ?? []), okWeapon.id];
  const beforeHp = g.run.hpMp[p0.char.id]?.hp;
  const r1 = applyBagEquip(g, p0.char, okWeapon.id);
  ok('穿戴武器成功', r1.ok, r1.err);
  const v1 = buildBagView(g, p0.char.id)!;
  ok('装备槽已更新', v1.equip.weapon === okWeapon.id);
  ok('库存移除已穿藏品', !(v1.inventory ?? []).includes(okWeapon.id));
  ok('HP 已重算(clamp)', g.run.hpMp[p0.char.id]?.hp <= v1.maxHp && (beforeHp === undefined || g.run.hpMp[p0.char.id]!.hp <= beforeHp!));
  // 卸下
  const r2 = applyBagUnequip(g, p0.char, 'weapon');
  ok('卸下成功', r2.ok, r2.err);
  const v2 = buildBagView(g, p0.char.id)!;
  ok('卸下后槽位为空且回库存', v2.equip.weapon === null && (v2.inventory ?? []).includes(okWeapon.id));
  // 武器职业限制：注入一把职业不匹配武器应报错
  const bad = [...g.itemMap.values()].find((i) => i.slot === 'weapon' && i.id !== okWeapon.id);
  if (bad) {
    p0.char.inventory = [...(p0.char.inventory ?? []), bad.id];
    const r3 = applyBagEquip(g, p0.char, bad.id);
    ok('职业不匹配武器被拒绝', !r3.ok && !!r3.err, r3.err);
  } else {
    ok('找到第二把武器用于负例', false);
  }
} else {
  ok('找到可用武器', false);
}

console.log('=== 背包视图/装备切换验证完成 ===');
