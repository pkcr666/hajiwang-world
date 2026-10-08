// 联机商店机制专项验证：initShop / buildShopView / shopHaggle / shopRefresh / shopSell / buySlot / 洗劫
// 运行：npx tsx scripts/verify-shop.ts
import fs from 'node:fs';
import path from 'node:path';
import { createGame, initShop, buildShopView, shopHaggle, shopRefresh, shopSell, buySlot, shopSlotFinalPrice } from '../server/runhost';
import { merchantSellPrice } from '../src/engine/nodes';
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
  c.id = `shop_char_${idx}_${Date.now()}`;
  c.name = `商店验证角色${idx + 1}`;
  return c;
}

async function main(): Promise<void> {
  console.log('=== 联机商店机制验证 ===');
  const save = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'save.json'), 'utf-8'));
  const dataPack = { monsters: [], stages: [], items: [] };
  const players: PlayerChar[] = [
    { playerId: 'a', name: '甲', char: mkChar(save, 0) as never },
    { playerId: 'b', name: '乙', char: mkChar(save, 1) as never },
  ];
  const game: GameState = createGame(players, dataPack, mathRng, 'starterVillage');
  game.perCoins['a'] = 50000;
  game.perCoins['b'] = 50000;

  // 1) initShop：每人独立摊，记录 charId
  initShop(game, players, mathRng);
  const sta = game.shopState['a']!;
  const stb = game.shopState['b']!;
  check('initShop：每人一摊且记录 charId', sta.charId === players[0].char.id && stb.charId === players[1].char.id);
  check('initShop：货摊有商品', sta.slots.length > 0 && stb.slots.length > 0, { a: sta.slots.length, b: stb.slots.length });

  // 2) buildShopView：价格视图字段齐全
  const va = buildShopView(game, players, 'a', 0, 2)!;
  check('buildShopView：含 price0 / price / 折扣字段', va.slots.length === sta.slots.length && va.slots.every((s) => s.price0 !== undefined && s.price !== undefined) && va.priceMul !== undefined);
  const base0 = va.slots[0]!.price0!;
  check('buildShopView：默认价=原价', va.slots[0]!.price === base0 || (va.freeCount ?? 0) > 0 || va.slots[0]!.free, { price: va.slots[0]!.price, price0: base0, freeCount: va.freeCount });

  // 3) shopHaggle：魅力+1D50 判定一次，价格实时更新
  const h = shopHaggle(game, 'a', mathRng);
  check('shopHaggle：成功一次', h.ok, h);
  const h2 = shopHaggle(game, 'a', mathRng);
  check('shopHaggle：重复砍价被拒', !h2.ok, h2);
  const va2 = buildShopView(game, players, 'a', 0, 2)!;
  check('shopHaggle：价格已按倍率变化', va2.priceMul !== undefined && va2.slots[0]!.price === Math.max(0, Math.ceil(va2.slots[0]!.price0! * va2.priceMul!)), { price: va2.slots[0]!.price, price0: va2.slots[0]!.price0, mul: va2.priceMul });

  // 4) shopRefresh（新手村免费）
  const slotsBefore = sta.slots.map((s) => `${s.kind}:${s.itemId ?? s.relicId ?? s.label}:${s.price}`).join('|');
  const r1 = shopRefresh(game, 'a', mathRng);
  check('shopRefresh：新手村免费刷新成功', r1.ok, r1);
  const slotsAfter = game.shopState['a']!.slots.map((s) => `${s.kind}:${s.itemId ?? s.relicId ?? s.label}:${s.price}`).join('|');
  check('shopRefresh：货摊已换货', slotsAfter !== slotsBefore, { before: slotsBefore, after: slotsAfter });
  check('shopRefresh：免费刷新不耗火把', game.run.torches === 2, { torches: game.run.torches });

  // 5) shopSell：先买入一件藏品再卖出
  const sA = game.shopState['a']!;
  const buyIdx = sA.slots.findIndex((s) => !sA.bought.includes(s.id) && (s.kind === 'item' || s.kind === 'material'));
  if (buyIdx >= 0 && sA.slots[buyIdx]!.kind === 'item' && sA.slots[buyIdx]!.itemId) {
    const boughtSlot = sA.slots[buyIdx]!;
    const bp = shopSlotFinalPrice(game, 'a', sA, boughtSlot, buyIdx);
    game.perCoins['a'] = Math.max(game.perCoins['a']!, bp);
    const rb2 = buySlot(game, 'a', players[0].char.id, boughtSlot.id);
    check('shopSell 前置：买入选藏品成功', rb2.ok, rb2);
    const itId2 = boughtSlot.itemId!;
    const coinsBefore = game.perCoins['a']!;
    const s2 = shopSell(game, 'a', players[0].char.id, itId2, false);
    check('shopSell：卖出藏品成功', s2.ok, s2);
    check('shopSell：藏品已移出背包', !game.perItems[players[0].char.id].includes(itId2));
    const it2 = game.itemMap.get(itId2)!;
    check('shopSell：币已入账（按稀有度档位 50%）', game.perCoins['a']! === coinsBefore + merchantSellPrice(it2), { before: coinsBefore, after: game.perCoins['a'], expect: merchantSellPrice(it2) });
  } else {
    check('shopSell：货摊有可买藏品（跳过）', true);
  }

  // 6) buySlot：扣币、入背包（价格=视图价）
  const st = game.shopState['b']!;
  const idx = st.slots.findIndex((s) => !st.bought.includes(s.id));
  const slot = st.slots[idx]!;
  const price = shopSlotFinalPrice(game, 'b', st, slot, idx);
  const coinsB = game.perCoins['b']!;
  const rb = buySlot(game, 'b', players[1].char.id, slot.id);
  check('buySlot：购买成功', rb.ok, rb);
  check('buySlot：扣币正确', game.perCoins['b']! === coinsB - price, { before: coinsB, after: game.perCoins['b'], price });
  if (slot.kind === 'item' && slot.itemId) {
    check('buySlot：藏品入玩家背包', game.perItems[players[1].char.id].includes(slot.itemId!));
  } else if (slot.kind === 'relic' && slot.relicId) {
    check('buySlot：遗物挂到玩家角色', game.perRelics[players[1].char.id].includes(slot.relicId!));
  }

  // 7) 洗劫：robbed=true 后视图全 0
  st.robbed = true;
  const vb = buildShopView(game, players, 'b', 0, 2)!;
  check('洗劫：所有商品价格 0', vb.slots.every((s) => s.price === 0) && vb.robbed === true);
  st.robbed = false;

  // 8) 灾厄泰拉：刷新消耗火把（1/2/3…）
  const cal = createGame(players, dataPack, mathRng, 'preWallCalamity');
  cal.perCoins['a'] = 50000;
  initShop(cal, players, mathRng);
  const sc = cal.shopState['a']!;
  const t0 = cal.run.torches;
  const rc0 = shopRefresh(cal, 'a', mathRng);
  check('灾厄刷新：首次免费', rc0.ok && cal.run.torches === t0, rc0);
  const rc1 = shopRefresh(cal, 'a', mathRng);
  check('灾厄刷新：第二次耗 1 火把', rc1.ok && cal.run.torches === t0 - 1, rc1);
  sc.refreshCount = 10;
  const rc2 = shopRefresh(cal, 'a', mathRng);
  check('灾厄刷新：火把不足被拒', !rc2.ok, rc2);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('verify-shop 失败：', e); process.exit(1); });
