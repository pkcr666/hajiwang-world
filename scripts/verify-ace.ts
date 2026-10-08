// 嘉豪被动「狮身人面像」上限验证：受击防御+10/法抗+5，上限 +20 防御 / 10 法抗（2 次受击到顶）
// 运行：npx tsx scripts/verify-ace.ts
import { ACE_UNITS } from '../src/data/aceUnits';
import { buildAceCombatant } from '../src/engine/unit';
import { makeCombatant } from '../src/engine/damage';
import { advance, createBattle, currentActor, enemyAct, playerAct } from '../src/engine/battle';
import { mathRng } from '../src/types';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`); }
}

const aceDef = ACE_UNITS.find((a) => a.id === 'ace_jiahao');
check('嘉豪定义存在', !!aceDef);
if (!aceDef) process.exit(1);

const passive = aceDef.skills.find((s) => s.kind === 'passive' && s.taunt);
check('嘉豪被动含嘲讽（单体伤害优先自身）', !!passive);
check('嘉豪被动配置上限 defCap=2/mresCap=2', passive?.defUpOnHit?.defCap === 2 && passive?.defUpOnHit?.mresCap === 2, passive?.defUpOnHit);

const jia = buildAceCombatant(aceDef, 0);
const foe = makeCombatant({
  uid: 'foe', side: 'enemy', name: '试炼小怪',
  stats: { hp: 10000, mp: 0, atk: 100, def: 0, mres: 0, spdMin: 1, spdMax: 1 },
  ai: 'basic', attackType: 'physical',
});
const baseDef = jia.stats.def; // 70
const baseMres = jia.stats.mres; // 40
const NO_ITEMS = new Map();
let s = createBattle([jia], [foe], mathRng);
let hits = 0;
for (let t = 0; t < 80 && s.result === null && hits < 6; t++) {
  s = advance(s, mathRng); // 推进到当前行动者
  if (s.result) break;
  const cur = currentActor(s);
  if (!cur.alive) continue;
  if (cur.side === 'enemy') {
    const beforeHp = s.allies[0].hp;
    s = enemyAct(s, mathRng).state;
    if (s.allies[0].hp < beforeHp) hits += 1; // 受击（掉血）计数
  } else {
    s = playerAct(s, { type: 'attack', targetUid: 'foe' }, NO_ITEMS).state;
  }
}
const finalJia = s.allies[0];
check('嘉豪至少受击 5 次（敌方单体能连续攻击）', hits >= 5, { hits, result: s.result, hp: finalJia.hp, foeHp: s.enemies[0].hp });
check('受击 2 次后防御到顶 +20', finalJia.stats.def === baseDef + 20, { def: finalJia.stats.def, base: baseDef, hits });
check('受击 2 次后法抗到顶 +10', finalJia.stats.mres === baseMres + 10, { mres: finalJia.stats.mres, base: baseMres, hits });
check('上限后不再叠加（受击>2 次防御仍 +20）', finalJia.stats.def <= baseDef + 20 && finalJia.stats.mres <= baseMres + 10, { def: finalJia.stats.def, mres: finalJia.stats.mres, hits });

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
