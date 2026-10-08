import { useEffect, useMemo, useState } from 'react';
import type { Character, Item, SaveData } from '../types';
import { mathRng } from '../types';
import { itemIcon } from '../assets/config';
import { allItems } from '../data/content';
import { resolveNode } from '../engine/run';
import {
  advanceFateStep, getFateChecked, getFateStep, leaderSixStats, resolveFateOption,
  type FateOptionAction, type PotionSelection,
} from '../engine/nodes';
import { persistRun } from '../save/storage';
import { Modal } from '../components/Modal';
import { Sprite } from '../components/Sprite';

const FATE_OPTIONS = [
  { title: '马哥的力量之源', desc: '力量判定60，成功则削弱马神残躯80点攻击力', stat: '力量' as const },
  { title: '马哥的钢铁之躯', desc: '意志判定60，成功则削弱马神残躯100点防御力', stat: '意志' as const },
  { title: '马哥的生命之源', desc: '魅力判定60，成功则削弱马神残躯1000点生命上限', stat: '魅力' as const },
  { title: '马哥跑的真快', desc: '敏捷判定60，成功则将马神残躯速度固定为5-5', stat: '敏捷' as const },
  { title: '生生不息', desc: '上交3瓶任意药水，使马神残躯失去回血能力', stat: null },
  { title: '马哥的大刚', desc: '上交3个遗物或10000哈哈币，使马神残躯失去伤害上限', stat: null },
];

// 药水（consumable）选择条目
interface PotionItem {
  charId: string;
  charName: string;
  itemId: string;
  item: Item;
  count: number;
}

export function RunFate({ save, nodeId, onChange, onBack }: {
  save: SaveData;
  nodeId: string;
  onChange: (s: SaveData) => void;
  onBack: () => void;
}) {
  const run = save.activeRun!;
  const characters = save.characters;
  const [msg, setMsg] = useState<string | null>(null);
  const [potionModal, setPotionModal] = useState(false);
  const [potionSel, setPotionSel] = useState<PotionSelection[]>([]);

  // 初始化 fate 节点状态
  useEffect(() => {
    const st = run.nodeStates?.[nodeId];
    if (!st || st.kind !== 'fate') {
      const next = structuredClone(run);
      next.nodeStates = { ...next.nodeStates, [nodeId]: { kind: 'fate', step: 0, used: false, checked: false } };
      onChange(persistRun(save, next));
    }
  }, [nodeId]);

  const step = getFateStep(run, nodeId);
  const checked = getFateChecked(run, nodeId);
  const done = step >= 6;
  const charList = characters.filter((c): c is Character => c !== null);
  const stats = useMemo(() => leaderSixStats(run, charList), [run, charList]);

  // 全队药水列表（仅 consumable 槽位；仅限当前副本编队成员）
  const potionList = useMemo<PotionItem[]>(() => {
    const itemMap = new Map(allItems(save).map((i) => [i.id, i]));
    const partyIds = new Set(run.party.memberIds);
    const out: PotionItem[] = [];
    for (const c of charList) {
      if (!partyIds.has(c.id)) continue;
      for (const g of c.bag) {
        const item = itemMap.get(g.itemId);
        if (item && item.slot === 'consumable' && g.count > 0) {
          out.push({ charId: c.id, charName: c.name, itemId: g.itemId, item, count: g.count });
        }
      }
    }
    return out;
  }, [charList, save, run.party.memberIds]);

  const handle = (action: FateOptionAction, selections?: PotionSelection[]) => {
    const rng = mathRng;
    const res = resolveFateOption(run, nodeId, step, action, rng, charList, selections);
    setMsg(res.message);
    if (res.success) {
      let r2 = advanceFateStep(res.run, nodeId);
      onChange(persistRun(save, r2));
    } else {
      onChange(persistRun(save, res.run));
    }
  };

  const togglePotion = (p: PotionItem, delta: number) => {
    setPotionSel((prev) => {
      const cur = prev.filter((s) => s.charId === p.charId && s.itemId === p.itemId).length;
      const nextCount = Math.max(0, Math.min(p.count, cur + delta));
      // 总数上限 3
      const others = prev.filter((s) => !(s.charId === p.charId && s.itemId === p.itemId));
      if (others.length + nextCount > 3) return prev;
      const next = [...others];
      for (let i = 0; i < nextCount; i++) next.push({ charId: p.charId, itemId: p.itemId });
      return next;
    });
  };

  const selectedCountOf = (p: PotionItem) =>
    potionSel.filter((s) => s.charId === p.charId && s.itemId === p.itemId).length;

  const confirmPotions = () => {
    if (potionSel.length !== 3) return;
    setPotionModal(false);
    handle('payPotions', potionSel);
    setPotionSel([]);
  };

  const skipFromPotion = () => {
    setPotionModal(false);
    setPotionSel([]);
    handle('skip');
  };

  const leave = () => {
    onChange(persistRun(save, resolveNode(run, nodeId)));
    onBack();
  };

  if (done) {
    return (
      <div className="page">
        <div className="page-head">
          <h2>命运所指</h2>
          <div className="page-head-actions">
            <button className="btn primary" onClick={leave}>前往BOSS</button>
          </div>
        </div>
        <div className="card">命运的抉择已全部完成，马神残躯的弱点已被你一一洞悉。前往击败它吧！</div>
      </div>
    );
  }

  const opt = FATE_OPTIONS[step];
  const statVal = opt.stat === '力量' ? stats.str : opt.stat === '意志' ? stats.wil
    : opt.stat === '魅力' ? stats.cha : opt.stat === '敏捷' ? stats.agi : 0;

  return (
    <div className="page">
      <div className="page-head">
        <h2>命运所指（{step + 1}/6）</h2>
      </div>
      <div className="card">
        <h3>{opt.title}</h3>
        <p>{opt.desc}</p>
        {opt.stat && <p className="muted small">当前队长{opt.stat}：{statVal}</p>}
      </div>

      <div className="fate-actions">
        {opt.stat ? (
          <>
            <button className="btn primary" onClick={() => handle('check')} disabled={checked}>
              {checked ? `${opt.stat}判定已使用` : `进行${opt.stat}判定（≥60成功）`}
            </button>
            <button className="btn" onClick={() => handle('payRelics')}>上交3个随机池遗物</button>
            <button className="btn" onClick={() => handle('payCoins')}>花费10000哈哈币</button>
          </>
        ) : step === 4 ? (
          <button className="btn primary" onClick={() => setPotionModal(true)}>上交3瓶药水</button>
        ) : (
          <>
            <button className="btn primary" onClick={() => handle('payRelics')}>上交3个遗物</button>
            <button className="btn" onClick={() => handle('payCoins')}>花费10000哈哈币</button>
          </>
        )}
        <button className="btn" onClick={() => handle('skip')}>跳过·不削弱</button>
      </div>

      {msg && (
        <div className={`card ${msg.includes('成功') || msg.includes('失去') ? 'buff-good' : 'buff-bad'}`}>
          {msg}
        </div>
      )}

      {msg && (
        <Modal title="命运回响" onClose={() => setMsg(null)}>
          <p>{msg}</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setMsg(null)}>继续</button>
          </div>
        </Modal>
      )}

      {potionModal && (
        <Modal title="选择3瓶药水上交" onClose={() => { setPotionModal(false); setPotionSel([]); }}>
          {potionList.length === 0 ? (
            <p>全队没有药水。</p>
          ) : (
            <div className="stash-list">
              {potionList.map((p, i) => {
                const cnt = selectedCountOf(p);
                const maxable = potionSel.length - cnt < 3;
                return (
                  <div
                    key={`${p.charId}-${p.itemId}-${i}`}
                    className={`stash-chip potion-chip ${cnt > 0 ? 'card-selected' : ''}`}
                  >
                    <Sprite className="stash-icon" src={itemIcon(p.item.slot, p.item.icon)} alt={p.item.name} />
                    <div className="stash-info">
                      <div>{p.item.name} <span className="muted small">×{p.count}（{p.charName}）</span></div>
                    </div>
                    <div className="potion-qty">
                      <button
                        className="btn qty-btn"
                        disabled={cnt <= 0}
                        onClick={() => togglePotion(p, -1)}
                      >−</button>
                      <span className="qty-num">{cnt}</span>
                      <button
                        className="btn qty-btn"
                        disabled={cnt >= p.count || !maxable}
                        onClick={() => togglePotion(p, 1)}
                      >+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="muted small">已选 {potionSel.length}/3</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => { setPotionModal(false); setPotionSel([]); }}>取消</button>
            <button className="btn" onClick={skipFromPotion}>跳过·不削弱</button>
            <button className="btn primary" disabled={potionSel.length !== 3} onClick={confirmPotions}>
              确认上交
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
