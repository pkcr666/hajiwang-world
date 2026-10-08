import { useEffect, useMemo, useState } from 'react';
import type { HaggleResult, Item, MerchantSlot, RunState, SaveData } from '../types';
import { mathRng } from '../types';
import { allItems, itemMapOf } from '../data/content';
import { DUNGEONS } from '../data/dungeons';
import { RELICS, RELIC_MAP, isUnimplemented, sumRelicSixStats } from '../data/relics';
import { partyMembers } from '../engine/party';
import { applyRelicPickupEffects, gainRunRelics, grantChestItems, maxHpMpOf, resolveNode, syncHpMpOnMaxUp } from '../engine/run';
import {
  ensureMerchantShop, haggleLabel, haggleRoll, merchantSellPrice, potionSellPrice,
  rollMerchantShop, shopFreeCount, shopFreeSlotIndices, shopPriceMul,
} from '../engine/nodes';
import { collectExtraBonus, equippedIds } from '../engine/stats';
import { persistRun } from '../save/storage';
import { COIN_NAME, openChestRelic } from '../engine/drops';
import { itemIcon } from '../assets/config';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES, MONSTER_IMAGES } from '../assets/config';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';
import { RARITY_COLORS, RARITY_LABELS, SLOT_LABELS } from '../ui/labels';
import { RunBag } from './RunBag';

export function RunMerchant({ save, nodeId, onChange, onBack, onRob }: {
  save: SaveData;
  nodeId: string;
  onChange: (s: SaveData) => void;
  onBack: () => void;
  onRob?: () => void; // 抢商店：进入BOSS战（袁绍）
}) {
  const run = save.activeRun!;
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const items = useMemo(() => allItems(save), [save]);
  const members = useMemo(() => partyMembers(run.party, save.characters), [run.party, save.characters]);
  const level = DUNGEONS.find((d) => d.id === run.dungeonId)?.level ?? 10;
  const isTerraria = DUNGEONS.find((d) => d.id === run.dungeonId)?.family === 'terraria';

  const st = run.nodeStates?.[nodeId];
  const shop = st && st.kind === 'merchant' ? st.shop : undefined;
  const refreshCount = st?.kind === 'merchant' ? (st.refreshCount ?? 0) : 0;
  const haggle = st?.kind === 'merchant' ? st.haggle : undefined;
  const robbed = st?.kind === 'merchant' ? !!st.robbed : false; // 本摊已被抢（价格全0）
  const robbedShop = !!run.robbedShop; // 本局已抢过商店（其余行商节点空摊）
  const isStarter = run.dungeonId === 'starterVillage'; // 仅新手村开放抢商店
  const isCalamity = run.dungeonId === 'preWallCalamity';
  const hasExtraRefresh = run.relics?.includes('rl_companion');
  const freeRefreshes = 1 + (hasExtraRefresh ? 1 : 0);
  // 灾厄泰拉刷新火把消耗：前 freeRefreshes 次免费，之后第N次消耗(N-freeRefreshes)根火把
  const nextRefreshTorchCost = isCalamity ? Math.max(0, refreshCount - (freeRefreshes - 1)) : 0;
  const canRefresh = isCalamity ? run.torches >= nextRefreshTorchCost : refreshCount < freeRefreshes;

  // 首次进入生成货摊（生成后随 run 持久化，刷新/离开不会丢）
  useEffect(() => {
    if (robbedShop && !robbed) return; // 本局已抢过：其余行商节点不再生成货摊
    if (!shop) onChange(ensureMerchantShop(save, nodeId, mathRng));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [ownerAsk, setOwnerAsk] = useState<number | null>(null); // 待选归属的藏品/药水槽下标
  const [chestAsk, setChestAsk] = useState<{ index: number; itemId: string } | null>(null); // 宝箱已开出、待选接收队员
  const [haggleMsg, setHaggleMsg] = useState<HaggleResult | null>(null); // 本次砍价判定结果（弹窗展示）
  const [robAsk, setRobAsk] = useState(false); // 抢商店确认弹窗
  const [buyMsg, setBuyMsg] = useState<string | null>(null); // 遗物拾取即效反馈（火把/回复/额外遗物）
  const [bagOpen, setBagOpen] = useState(false);

  // 离开货摊：清理节点状态并返回地图（空摊/加载态也需可用）
  const leave = () => {
    onChange(persistRun(save, resolveNode(run, nodeId)));
    onBack();
  };

  // 砍价基准：队长魅力（六维 + 装备加成 + 遗物六维），与事件六维判定同源
  const leader = members.find((m) => m.id === run.party.leaderId);
  const leaderCha = useMemo(() => {
    if (!leader) return 0;
    const equipped = equippedIds(leader.equip)
      .map((id) => itemMap.get(id))
      .filter((x): x is Item => !!x);
    return (leader.extra.cha ?? 0)
      + (collectExtraBonus(equipped).cha ?? 0)
      + sumRelicSixStats(run.relics ?? []).cha;
  }, [leader, itemMap, run.relics]);

  if (robbedShop && !robbed) {
    // 本局已抢过商店：其余诡异行商节点空摊，什么都不会有
    return (
      <div className="page">
        <div className="page-head">
          <h2>诡异行商</h2>
          <div className="page-head-actions">
            <button className="btn" onClick={leave}>离开货摊</button>
          </div>
        </div>
        <div className="card muted">行商见你凶神恶煞，早已卷铺盖跑路，货摊空空如也。</div>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="page">
        <div className="page-head">
          <h2>诡异行商</h2>
          <div className="page-head-actions">
            <button className="btn" onClick={leave}>离开货摊</button>
          </div>
        </div>
        <div className="card muted">行商正在支起货摊……</div>
      </div>
    );
  }

  const coins = run.coins;
  const bought = shop.slots.filter((s) => s.sold).length;
  // 商店价格：遗物折扣（锈蚀的铁链等「商店售价-X%」，购买后即时生效）与砍价取最优、不叠加
  const priceMul = shopPriceMul(run.relics ?? [], haggle);
  const chainMul = shopPriceMul(run.relics ?? [], undefined); // 仅遗物折扣（不含砍价）
  const freeCount = shopFreeCount(run.relics ?? []);
  // 免费商品：从全部槽位中确定性随机选取 freeCount 个（基于槽位 id 哈希，跨渲染稳定）
  const freeSlotIndices = shopFreeSlotIndices(shop.slots, freeCount);
  const priceOf = (slot: MerchantSlot, index: number) => {
    if (robbed) return 0;
    if (freeSlotIndices.has(index)) return 0;
    return Math.max(0, Math.ceil(slot.price * priceMul));
  };

  // 把一次购买写回：扣币 → 归属入包/入遗物 → 标记已售
  // chestItemId：宝箱遗物开出的藏品 id（由开箱弹窗选定接收队员后传入）
  const buy = (index: number, memberId?: string, chestItemId?: string) => {
    const slot = shop.slots[index];
    if (!slot || slot.sold) return;
    const price = priceOf(slot, index);
    if (coins < price) return;
    let s = structuredClone(save);
    let r = structuredClone(run);
    r.coins -= price;
    if (slot.kind === 'relic') {
      const before = maxHpMpOf(s, r, itemMap);
      r.relics = gainRunRelics(r, [slot.id]).relics;
      // 拾取即效：火把 / 回复 / 谷地树实等额外遗物（宝箱走 chestItemId 单独结算）
      const pk = applyRelicPickupEffects(r, [slot.id], mathRng, before);
      r = pk.run;
      // 谷地树实递归开出的宝箱：藏品写入队长背包
      if (pk.chests.length > 0) s = grantChestItems(s, r, pk.chests);
      if (pk.texts.length > 0) setBuyMsg(pk.texts.join('；'));
      r.hpMp = syncHpMpOnMaxUp(r.hpMp, before, maxHpMpOf(s, r, itemMap));
      if (chestItemId && memberId) {
        const c = s.characters.find((x) => x?.id === memberId);
        if (c) c.inventory = [...(c.inventory ?? []), chestItemId];
      }
    } else if (memberId) {
      const c = s.characters.find((x) => x?.id === memberId);
      if (!c) return;
      if (slot.kind === 'potion') {
        const bag = [...(c.bag ?? [])];
        const found = bag.find((b) => b.itemId === slot.id);
        if (found) found.count += 1;
        else bag.push({ itemId: slot.id, count: 1 });
        c.bag = bag;
      } else {
        const it = itemMap.get(slot.id);
        if (it?.slot === 'material') {
          // 材料（强化石等）进共享材料仓库
          const found = s.materials.find((m) => m.itemId === slot.id);
          if (found) found.count += 1;
          else s.materials.push({ itemId: slot.id, count: 1 });
        } else {
          c.inventory = [...(c.inventory ?? []), slot.id];
        }
      }
    } else return;
    const st2 = r.nodeStates?.[nodeId];
    if (st2 && st2.kind === 'merchant') {
      r.nodeStates = {
        ...(r.nodeStates ?? {}),
        [nodeId]: {
          ...st2,
          shop: { slots: st2.shop.slots.map((s2, i) => (i === index ? { ...s2, sold: true } : s2)) },
        },
      };
    }
    onChange(persistRun(s, r));
    setOwnerAsk(null);
  };

  // 刷新：灾厄泰拉消耗火把（第1次免费，之后1/2/3...递增），其他副本仅1次免费
  const refresh = () => {
    if (!canRefresh) return;
    const torchCost = isCalamity ? nextRefreshTorchCost : 0;
    if (isCalamity && run.torches < torchCost) return;
    const shop2 = rollMerchantShop({
      items, relics: RELICS, owned: new Set(run.relics ?? []), rng: mathRng, level,
      runRelics: run.relics ?? [],
      endgame: run.relics.includes('rl_endgame_link'),
      dungeonId: run.dungeonId,
    });
    const newCount = refreshCount + 1;
    const r: RunState = {
      ...run,
      torches: run.torches - torchCost,
      nodeStates: {
        ...(run.nodeStates ?? {}),
        [nodeId]: { kind: 'merchant' as const, shop: shop2, refreshed: true, refreshCount: newCount, haggle },
      },
    };
    onChange(persistRun(save, r));
  };

  // 魅力砍价：队长魅力 + 1D50 判定一次，结果写入节点状态（每个货摊仅一次）
  const doHaggle = () => {
    const st0 = run.nodeStates?.[nodeId];
    if (!st0 || st0.kind !== 'merchant' || st0.haggle) return;
    const res = haggleRoll(leaderCha, mathRng);
    const r: RunState = {
      ...run,
      nodeStates: { ...(run.nodeStates ?? {}), [nodeId]: { ...st0, haggle: res } },
    };
    setHaggleMsg(res);
    onChange(persistRun(save, r));
  };

  // 出售：藏品（未穿戴）或药水，按品质购买价50%回笼共享币池
  const sell = (memberId: string, itemId: string, potion: boolean) => {
    const s = structuredClone(save);
    const r = structuredClone(run);
    const c = s.characters.find((x) => x?.id === memberId);
    const it = itemMap.get(itemId);
    if (!c || !it) return;
    const price = potion ? potionSellPrice() : merchantSellPrice(it);
    if (potion) {
      const bag = [...(c.bag ?? [])];
      const idx = bag.findIndex((b) => b.itemId === itemId);
      if (idx < 0) return;
      if (bag[idx]!.count > 1) bag[idx] = { ...bag[idx]!, count: bag[idx]!.count - 1 };
      else bag.splice(idx, 1);
      c.bag = bag;
    } else {
      const inv = [...(c.inventory ?? [])];
      const idx = inv.indexOf(itemId);
      if (idx < 0) return;
      inv.splice(idx, 1);
      c.inventory = inv;
    }
    r.coins += price;
    onChange(persistRun(s, r));
  };

  const sellables = members.map((m) => {
    const equip = (m.inventory ?? [])
      .map((id) => itemMap.get(id))
      .filter((it): it is Item => !!it && it.slot !== 'consumable' && it.slot !== 'material');
    const potions = (m.bag ?? [])
      .map((b) => ({ ...b, item: itemMap.get(b.itemId) }))
      .filter((x): x is { itemId: string; count: number; item: Item } => !!x.item);
    return { m, equip, potions };
  });
  const sellableCount = sellables.reduce((n, x) => n + x.equip.length + x.potions.length, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h2>诡异行商
          <span className="slot-level">货摊商品 · 价格与刷新仅本次副本有效</span>
        </h2>
        <div className="page-head-actions">
          <span className="coin-pill">共享币池 💰 {coins} {COIN_NAME}</span>
          <button className="btn" onClick={() => setBagOpen(true)}>🎒 打开背包</button>
          <button className="btn" onClick={leave}>离开货摊</button>
        </div>
      </div>

      <div className="merchant-layout">
        <aside className="card merchant-panel">
          <Sprite className="merchant-portrait" src={MONSTER_IMAGES.yuanShao} alt="袁绍" />
          <b className="merchant-name">袁绍</b>
          <p className="muted small merchant-quote">「看上的就拿，铜板结账——这摊子只在你这一趟里出。」</p>
          <div className="merchant-buttons">
            <button
              className="btn"
              disabled={robbed || robbedShop || !isStarter}
              onClick={() => setRobAsk(true)}
              title={robbedShop ? '本局已抢过商店' : robbed ? '本摊已被洗劫' : '进入BOSS战：袁绍'}
            >
              抢商店
            </button>
            <button
              className={`btn ${haggle ? '' : 'primary'}`}
              disabled={!!haggle || robbed}
              onClick={doHaggle}
              title={haggle ? '本摊已砍过价' : robbed ? '货摊已被洗劫' : `以队长魅力 ${leaderCha} + 1D50 判定砍价`}
            >
              {haggle ? `已砍价 · ${haggleLabel(haggle.discountPct)}` : '魅力判定砍价'}
            </button>
            <button
              className={`btn ${canRefresh && !robbed ? 'primary' : ''}`}
              disabled={!canRefresh || robbed}
              onClick={refresh}
              title={robbed ? '货摊已被洗劫' : isCalamity ? `刷新货摊（消耗 ${nextRefreshTorchCost} 火把）` : `免费刷新（${freeRefreshes}次）`}
            >
              {isCalamity
                ? (nextRefreshTorchCost === 0 ? '免费刷新' : `刷新（🔥×${nextRefreshTorchCost}）`)
                : (refreshCount < freeRefreshes ? `免费刷新（${freeRefreshes - refreshCount}次）` : '免费刷新已用')}
            </button>
          </div>
          {robbed && (
            <p className="merchant-haggle muted small">💰 货摊已被洗劫，商品一律免费！</p>
          )}
          {haggle && (
            <p className="merchant-haggle muted small">
              🎲 砍价判定 {haggle.total}（魅力 {leaderCha} + 1D50[{haggle.roll}]）→ {haggleLabel(haggle.discountPct)}
            </p>
          )}
          {chainMul < 1 && (
            <p className="merchant-haggle muted small">
              ⛓ 商店遗物折扣生效：本摊价格实时享 {(1 - chainMul) * 100}% 优惠（与砍价取最优、不叠加）
            </p>
          )}
          {freeCount > 0 && (
            <p className="merchant-haggle muted small">
              🐙 商店免费商品生效：随机 {freeCount} 件商品免费（获得坎诺特触须后即时生效）
            </p>
          )}
          {isTerraria && (
            <div className="merchant-torch">
              <span className="merchant-torch-label">🔥 火把</span>
              <b className="merchant-torch-count">{run.torches}</b>
              <span className="muted small">根 · 点亮上下通路 / 进入子层消耗 1 根</span>
            </div>
          )}
          <p className="muted small">出售价格 = 购买价格 × 50%。买下的藏品直接入所选队员背包，遗物挂到本局。</p>
        </aside>

        <div className="card merchant-shop">
          <h3>货摊商品（已售 {bought} / {shop.slots.length}）</h3>
          <div className="shop-grid">
            {shop.slots.map((slot, i) => {
              const rl = slot.kind === 'relic' ? RELIC_MAP[slot.id] : undefined;
              const it = slot.kind === 'relic' ? undefined : itemMap.get(slot.id);
              const color = slot.kind === 'relic'
                ? (rl ? RARITY_COLORS[rl.rarity] : undefined)
                : (it ? RARITY_COLORS[it.rarity] : undefined);
              const name = slot.kind === 'relic' ? rl?.name ?? slot.id : it?.name ?? slot.id;
              const sub = slot.kind === 'relic'
                ? (rl ? `${RARITY_LABELS[rl.rarity]} · 遗物${isUnimplemented(rl) ? ' · 未实装' : ''}` : '遗物')
                : (it ? `${RARITY_LABELS[it.rarity]} · ${SLOT_LABELS[it.slot]}` : '');
              const desc = slot.kind === 'relic' ? rl?.desc : it?.desc;
              const src = slot.kind === 'relic'
                ? rl?.icon
                : (it ? itemIcon(it.slot, it.icon) : undefined);
              const price = priceOf(slot, i);
              return (
                <div key={`${slot.kind}_${slot.id}_${i}`} className={`shop-card ${slot.sold ? 'sold' : ''}`}>
                  <span className="pick-icon">
                    {slot.kind === 'relic' && (src
                      ? <Sprite className="pick-img" src={src} alt={name} />
                      : <span className="pick-emoji">📿</span>)}
                    {slot.kind !== 'relic' && (src
                      ? <Sprite className="pick-img" src={src} alt={name} />
                      : <span className="pick-emoji">📦</span>)}
                  </span>
                  <span className="pick-name" style={color ? { color } : undefined}>{name}</span>
                  <span className="pick-sub">{sub}</span>
                  {desc && <span className="pick-desc">{desc}</span>}
                  <span className="shop-price">
                    💰 {price}
                    {price !== slot.price && <s className="shop-price-old"> {slot.price}</s>}
                  </span>
                  {slot.sold ? (
                    <span className="shop-sold-tag">已售出</span>
                  ) : (
                    <button
                      className="btn-mini"
                      disabled={coins < price}
                      onClick={() => {
                        if (slot.kind === 'relic') {
                          // 宝箱：先开箱，再让玩家指定接收开出的藏品的队员
                          const eff = RELIC_MAP[slot.id]?.effect;
                          if (eff?.kind === 'grantItem') {
                            const it = openChestRelic(items, eff.rarity, level, mathRng);
                            if (it) { setChestAsk({ index: i, itemId: it.id }); return; }
                          }
                          buy(i);
                        } else setOwnerAsk(i);
                      }}
                      title={coins < price ? `还差 ${price - coins} ${COIN_NAME}` : '购买'}
                    >
                      {coins < price ? `差 ${price - coins}` : '购买'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card merchant-sell">
        <h3>出售背包藏品 / 药水{sellableCount === 0 && <span className="muted small">（暂无可以出售的物品）</span>}</h3>
        {sellables.map(({ m, equip, potions }) => (
          <div key={m.id} className="sell-group">
            <div className="sell-member">
              <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={JOB_DEFS[m.job].name} />
              <b>{m.name}</b>
              <span className="muted small">{JOB_DEFS[m.job].name}</span>
            </div>
            <div className="sell-list">
              {equip.length === 0 && potions.length === 0 && (
                <span className="muted small">背包空空如也。</span>
              )}
              {equip.map((it, i) => (
                <span key={`${m.id}_e_${it.id}_${i}`} className="sell-row">
                  <Sprite className="sell-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />
                  <span className="sell-name" style={{ color: RARITY_COLORS[it.rarity] }}>{it.name}</span>
                  <span className="muted small">{RARITY_LABELS[it.rarity]} · {SLOT_LABELS[it.slot]}</span>
                  <b className="sell-price">💰 {merchantSellPrice(it)}</b>
                  <button className="btn-mini" onClick={() => sell(m.id, it.id, false)}>出售</button>
                </span>
              ))}
              {potions.map((b) => (
                <span key={`${m.id}_p_${b.itemId}`} className="sell-row">
                  <Sprite className="sell-icon" src={itemIcon(b.item.slot, b.item.icon)} alt={b.item.name} />
                  <span className="sell-name" style={{ color: RARITY_COLORS[b.item.rarity] }}>{b.item.name} ×{b.count}</span>
                  <span className="muted small">药水</span>
                  <b className="sell-price">💰 {potionSellPrice() * b.count}</b>
                  <button className="btn-mini" onClick={() => sell(m.id, b.itemId, true)}>出售</button>
                </span>
              ))}
            </div>
          </div>
        ))}
        <p className="muted small">藏品出售后从该队员背包移走；药水按瓶出售（每瓶 {potionSellPrice()} {COIN_NAME}）。</p>
      </div>

      {haggleMsg && (
        <Modal title="魅力砍价" onClose={() => setHaggleMsg(null)}>
          <p className="haggle-roll">
            🎲 判定点数 {haggleMsg.total}＝魅力 {leaderCha}＋1D50[{haggleMsg.roll}]
          </p>
          <p className="haggle-outcome">
            {haggleMsg.discountPct < 1
              ? `砍价成功！本摊所有商品一律${haggleLabel(haggleMsg.discountPct)}优惠。`
              : haggleMsg.discountPct > 1
                ? `行商被你激怒了，本摊所有商品涨价至 120%！`
                : `行商不为所动，价格维持原价。`}
          </p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setHaggleMsg(null)}>知道了</button>
          </div>
        </Modal>
      )}

      {buyMsg && (
        <Modal title="拾取即效" onClose={() => setBuyMsg(null)}>
          <p>{buyMsg}</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setBuyMsg(null)}>知道了</button>
          </div>
        </Modal>
      )}

      {chestAsk && (() => {
        const slot = shop.slots[chestAsk.index];
        const it = itemMap.get(chestAsk.itemId);
        return (
          <Modal title="宝箱开启" onClose={() => setChestAsk(null)}>
            <p className="muted small">
              你打开了「{slot ? RELIC_MAP[slot.id]?.name : ''}」，获得藏品
              <b>「{it?.name ?? chestAsk.itemId}」</b>。选择接收它的队员：
            </p>
            <div className="runbag-targets">
              {members.map((m) => (
                <button key={m.id} className="btn runbag-target"
                  onClick={() => { buy(chestAsk.index, m.id, chestAsk.itemId); setChestAsk(null); }}>
                  <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={JOB_DEFS[m.job].name} />
                  {m.name}
                  <span className="btn-sub">
                    {JOB_DEFS[m.job].name} · 背包 {(m.inventory ?? []).length} 格
                    {m.id === run.party.leaderId ? ' · 队长' : ''}
                  </span>
                </button>
              ))}
            </div>
          </Modal>
        );
      })()}
      {ownerAsk !== null && (() => {
        const slot = shop.slots[ownerAsk];
        const it = slot ? itemMap.get(slot.id) : undefined;
        return (
          <Modal title="买给谁？" onClose={() => setOwnerAsk(null)}>
            <p className="muted small">
              「{slot && (slot.kind === 'relic' ? RELIC_MAP[slot.id]?.name : it?.name)}」将立即放入所选队员的
              {slot?.kind === 'potion' ? '携带道具（药水瓶）' : '藏品背包格'}，并从共享币池扣除 {slot ? priceOf(slot, ownerAsk) : 0} {COIN_NAME}。
            </p>
            <div className="runbag-targets">
              {members.map((m) => (
                <button key={m.id} className="btn runbag-target" onClick={() => buy(ownerAsk, m.id)}>
                  <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={JOB_DEFS[m.job].name} />
                  {m.name}
                  <span className="btn-sub">
                    {JOB_DEFS[m.job].name} · 背包 {(m.inventory ?? []).length} 格
                    {m.id === run.party.leaderId ? ' · 队长' : ''}
                  </span>
                </button>
              ))}
            </div>
          </Modal>
        );
      })()}
      {robAsk && (
        <Modal title="抢商店" onClose={() => setRobAsk(false)}>
          <p className="warn">
            要抢夺商店吗？将进入 <b>BOSS 战（袁绍）</b>。击败后本摊商品全部变为 0 元，
            但本局其余诡异行商节点将不再进货。
          </p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => { setRobAsk(false); onRob?.(); }}>
              抢！
            </button>
            <button className="btn" onClick={() => setRobAsk(false)}>再想想</button>
          </div>
        </Modal>
      )}
      {bagOpen && (
        <RunBag save={save} run={run} onChange={onChange} onClose={() => setBagOpen(false)} />
      )}
    </div>
  );
}
