import { useMemo, useState } from 'react';
import type { Item, SaveData } from '../types';
import { allItems } from '../data/content';
import { RELICS } from '../data/relics';
import { partyMembers, splitCoins } from '../engine/party';
import { completeRunWithLoot, freeExtraPointsEarned, TUTORIAL_DUNGEON_ID } from '../save/storage';
import { skillPointsEarned } from '../engine/skills';
import { COIN_NAME } from '../engine/drops';
import { calcCrisisRunScore } from '../engine/run';
import { itemIcon } from '../assets/config';
import { RARITY_COLORS, RARITY_LABELS, SLOT_LABELS } from '../ui/labels';
import { Sprite } from '../components/Sprite';

const INV_CAP = 30;

export function RunLoot({ save, onChange, onDone }: {
  save: SaveData;
  onChange: (s: SaveData) => void;
  onDone: () => void;
}) {
  const run = save.activeRun!;
  const members = useMemo(() => partyMembers(run.party, save.characters), [run.party, save.characters]);
  const itemMap = useMemo(() => new Map(allItems(save).map((i) => [i.id, i])), [save]);

  // 展平为逐件实例（每件一次分配）
  const instances = useMemo(() => {
    const out: { key: string; itemId: string }[] = [];
    for (const p of run.pendingItems ?? []) {
      for (let i = 0; i < p.count; i++) out.push({ key: `${p.itemId}#${i}`, itemId: p.itemId });
    }
    return out;
  }, [run.pendingItems]);

  // 分配表：instanceKey → 角色 id 或 null（丢弃）
  const [assign, setAssign] = useState<Record<string, string>>({});

  const capUsed = (charId: string) =>
    members.find((m) => m.id === charId)?.inventory?.length ?? 0 +
    Object.values(assign).filter((id) => id === charId).length;

  const { each, leaderExtra } = splitCoins(run.coins, members.length);
  const materials = run.pendingMaterials ?? [];
  const relics = run.relics ?? [];

  const confirm = () => {
    const byChar = new Map<string, string[]>();
    for (const inst of instances) {
      const cid = assign[inst.key];
      if (!cid) continue;
      const list = byChar.get(cid) ?? [];
      list.push(inst.itemId);
      byChar.set(cid, list);
    }
    onChange(completeRunWithLoot(
      save,
      [...byChar.entries()].map(([characterId, itemIds]) => ({ characterId, itemIds })),
    ));
    onDone();
  };

  const itemOf = (id: string): Item | undefined => itemMap.get(id);

  return (
    <div className="page">
      <div className="page-head">
        <h2>通关结算 · 战利品分配</h2>
      </div>

      <div className="run-loot card">
        {run.dungeonId === 'crisisContract' && run.crisis && (() => {
          const score = calcCrisisRunScore(run);
          return (
            <div className="crisis-score-card">
              <div className="crisis-score-label">危机合约 S1 通关得分</div>
              <div className="crisis-score-value">{score}</div>
              <div className="muted small">（已记入队员最高分）</div>
            </div>
          );
        })()}
        {run.dungeonId === TUTORIAL_DUNGEON_ID && (() => {
          const endgame = run.relics.includes('rl_endgame_link');
          const oldLevel = members[0]?.level ?? 10;
          let targetLevel = oldLevel;
          if (targetLevel < 20) targetLevel = Math.min(20, targetLevel + 10);
          if (endgame && targetLevel < 30) targetLevel = Math.min(30, targetLevel + 10);
          const freePts = freeExtraPointsEarned(targetLevel);
          const skillPts = skillPointsEarned(targetLevel);
          return (
            <div className="tutorial-reward card">
              新手村教学完成！参与队员等级 <b>Lv.{oldLevel} → Lv.{targetLevel}</b>
              {endgame && <span className="muted">（携带「终局联系」额外+10级）</span>}，
              共获得 <b>{freePts}</b> 自由属性点、<b>{skillPts}</b> 技能点（可在背包中分配）。
              {endgame && <div className="muted small">过了马神，才有未来！</div>}
            </div>
          );
        })()}

        <h3>哈哈币</h3>
        <p className="muted">
          共享币池 <b>{run.coins}</b> {COIN_NAME} 人均平分：每人 <b>{each}</b>，余数 <b>{leaderExtra}</b> 归队长。
        </p>

        <h3>材料（自动进入共享仓库）</h3>
        {materials.length === 0 ? (
          <p className="muted">本次探索未获得材料。</p>
        ) : (
          <div className="loot-list">
            {materials.map((m) => {
              const it = itemOf(m.itemId);
              return (
                <div className="loot-row" key={m.itemId}>
                  {it && <Sprite className="item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />}
                  <span>{it?.name ?? m.itemId} ×{m.count}</span>
                </div>
              );
            })}
          </div>
        )}

        <h3>遗物（仅本次副本生效，不带出）</h3>
        {relics.length === 0 ? (
          <p className="muted">本次探索未获得遗物。</p>
        ) : (
          <div className="loot-list">
            {relics.map((rid) => {
              const r = RELICS.find((x) => x.id === rid);
              return (
                <div className="loot-row" key={rid}>
                  {r && <Sprite className="item-icon" src={itemIcon('material', r.icon)} alt={r.name} />}
                  <span>{r?.name ?? rid}</span>
                  <span className="muted small">{r?.desc}</span>
                </div>
              );
            })}
          </div>
        )}

        <h3>藏品 / 消耗品（分配给队员，未分配则丢弃）</h3>
        {instances.length === 0 ? (
          <p className="muted">本次探索未获得藏品。</p>
        ) : (
          <div className="loot-list">
            {instances.map((inst) => {
              const it = itemOf(inst.itemId);
              return (
                <div className="loot-row" key={inst.key}>
                  {it && <Sprite className="item-icon" src={itemIcon(it.slot, it.icon)} alt={it.name} />}
                  <span style={{ color: it ? RARITY_COLORS[it.rarity] : undefined }}>
                    {it?.name ?? inst.itemId}
                  </span>
                  {it && (
                    <span className="muted small">
                      {RARITY_LABELS[it.rarity]} · {SLOT_LABELS[it.slot]}
                    </span>
                  )}
                  <select
                    className="input loot-assign"
                    value={assign[inst.key] ?? ''}
                    onChange={(e) =>
                      setAssign((old) => ({ ...old, [inst.key]: e.target.value }))}
                  >
                    <option value="">丢弃</option>
                    {members.map((m) => {
                      const left = INV_CAP - capUsed(m.id);
                      return (
                        <option key={m.id} value={m.id} disabled={left <= 0}>
                          {m.name}（剩{left}格）{m.id === run.party.leaderId ? '·队长' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              );
            })}
          </div>
        )}

        <p className="muted small">
          每位队员背包上限 {INV_CAP} 格。确认后副本结束，未分配物品丢弃。
        </p>
        <div className="modal-actions">
          <button className="btn primary" onClick={confirm}>确认结算</button>
        </div>
      </div>
    </div>
  );
}
