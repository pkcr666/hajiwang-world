import { useEffect, useState } from 'react';
import type { Character, SaveData } from '../types';
import { mathRng } from '../types';
import { rollRecruitCandidates, recruitMember, type RecruitCandidate } from '../engine/nodes';
import { resolveNode } from '../engine/run';
import { persistRun } from '../save/storage';
import { partyEntries } from '../engine/party';

// 候选立绘：图片缺失/加载失败时显示首字徽章
function RecruitPortrait({ cand }: { cand: RecruitCandidate }) {
  const [broken, setBroken] = useState(false);
  const color = cand.rarity === 'epic' ? 'var(--rarity-epic)' : cand.rarity === 'rare' ? 'var(--rarity-rare)' : 'var(--text)';
  if (cand.icon && !broken) {
    return (
      <div className="recruit-portrait">
        <img src={cand.icon} alt={cand.name} className="recruit-portrait-img" onError={() => setBroken(true)} />
      </div>
    );
  }
  return (
    <div className="recruit-portrait">
      <div className="recruit-portrait-fallback" style={{ color, borderColor: color }}>{cand.name.charAt(0)}</div>
    </div>
  );
}

export function RunRecruit({ save, nodeId, onChange, onBack }: {
  save: SaveData;
  nodeId: string;
  onChange: (s: SaveData) => void;
  onBack: () => void;
}) {
  const run = save.activeRun!;
  const [cands, setCands] = useState<RecruitCandidate[]>([]);
  const [refreshCount, setRefreshCount] = useState(0);
  const [freeUsed, setFreeUsed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const hasExtraRefresh = run.relics?.includes('rl_companion');
  const freeRefreshes = 1 + (hasExtraRefresh ? 1 : 0);
  // 王牌招募刷新：前 freeRefreshes 次免费，之后按哈哈币 3000/5000/7000 递增（第n次付费刷新）
  const refreshCoinsCost = (paidNth: number) => {
    if (paidNth <= 0) return 0;
    return Math.min(7000, 3000 + (paidNth - 1) * 2000); // 3000, 5000, 7000
  };
  // 第 refreshCount+1 次刷新对应的已付费次数
  const paidNth = (n: number) => Math.max(0, n - (freeRefreshes - 1));

  const doRefresh = (free: boolean) => {
    if (!free) {
      const cost = refreshCoinsCost(paidNth(refreshCount + 1));
      if (run.coins < cost) { setMsg(`哈哈币不足，需要 ${cost} 哈哈币。`); return; }
    }
    const next = structuredClone(run);
    if (!free) next.coins -= refreshCoinsCost(paidNth(refreshCount + 1));
    const chars = save.characters.filter((c): c is Character => !!c);
    const newCands = rollRecruitCandidates(next, chars, mathRng);
    setCands(newCands);
    setRefreshCount(refreshCount + 1);
    setFreeUsed(refreshCount + 1 >= freeRefreshes);
    onChange(persistRun(save, next));
  };

  useEffect(() => {
    const st = run.nodeStates?.[nodeId];
    if (st?.kind === 'recruit' && st.picked) {
      setDone(true);
      return;
    }
    // 首次进入免费刷新
    const chars = save.characters.filter((c): c is Character => !!c);
    const newCands = rollRecruitCandidates(run, chars, mathRng);
    setCands(newCands);
  }, []);

  const pick = (cand: RecruitCandidate) => {
    const nextRun = recruitMember(run, cand);
    nextRun.nodeStates = { ...nextRun.nodeStates, [nodeId]: { kind: 'recruit', refreshed: true, refreshCount, picked: cand.id } };
    const cleared = resolveNode(nextRun, nodeId);
    onChange(persistRun(save, cleared));
    setDone(true);
    setMsg(`已招募 ${cand.name}！`);
  };

  // 返回地图视为完成该节点（不招募）
  const leave = () => {
    const next = structuredClone(run);
    next.nodeStates = { ...next.nodeStates, [nodeId]: { kind: 'recruit', refreshed: true, refreshCount } };
    const cleared = resolveNode(next, nodeId);
    onChange(persistRun(save, cleared));
    onBack();
  };

  return (
    <div className="run-page">
      <div className="run-header">
        <button className="btn" onClick={leave}>← 返回地图</button>
        <h2>王牌招募</h2>
      </div>
      <div className="card">
        <p className="muted small">当前队伍：{partyEntries(run.party, save.characters).map((e) => e.name).join('、') || '空'}（共{run.party.memberIds.length}人，上场{Math.min(3, run.party.memberIds.length)}/3）· 哈哈币 🪙 {run.coins}</p>
        {!done ? (
          <>
            <div className="recruit-list">
              {cands.map((c) => {
                const color = c.rarity === 'epic' ? 'var(--rarity-epic)' : c.rarity === 'rare' ? 'var(--rarity-rare)' : 'var(--text)';
                return (
                  <div key={c.id} className="card recruit-card" style={{ borderColor: color }}>
                    <RecruitPortrait cand={c} />
                    <div className="recruit-info">
                      <div className="recruit-name">{c.name}{c.type === 'ace' && <span className="tag" style={{ color }}>{c.rarity === 'epic' ? '史诗' : '稀有'}</span>}</div>
                      <div className="recruit-stats">HP {c.stats.hp} · 攻 {c.stats.atk} · 防 {c.stats.def}</div>
                      <button className="btn primary" onClick={() => pick(c)}>招募</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="run-actions">
              {!freeUsed ? (
                <button className="btn" onClick={() => doRefresh(true)}>免费刷新</button>
              ) : (
                <button className="btn" disabled={run.coins < refreshCoinsCost(paidNth(refreshCount + 1))} onClick={() => doRefresh(false)}>
                  刷新（🪙×{refreshCoinsCost(paidNth(refreshCount + 1))}）
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="success">{msg}</p>
        )}
      </div>
      {done && (
        <div className="run-actions">
          <button className="btn primary" onClick={onBack}>继续探索</button>
        </div>
      )}
    </div>
  );
}
