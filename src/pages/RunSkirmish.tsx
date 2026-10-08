import { useEffect, useState } from 'react';
import type { SaveData, StageMechanic } from '../types';
import { mathRng } from '../types';
import { rollSkirmishTiers, type SkirmishTier } from '../engine/nodes';
import { enemyMapOf } from '../data/content';

export function RunSkirmish({ save, nodeId, onBack, onBattle }: {
  save: SaveData;
  nodeId: string;
  onBack: () => void;
  onBattle: (
    nodeId: string,
    monsters: { monsterId: string; count: number }[],
    tier: number,
    snapshot: Record<string, { hp: number; mp: number }>,
    stageId: string,
    mechanics?: StageMechanic[],
  ) => void;
}) {
  const run = save.activeRun!;
  const enemyMap = enemyMapOf(save);
  const [tiers, setTiers] = useState<SkirmishTier[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const st = run.nodeStates?.[nodeId];
    if (st?.kind === 'skirmish' && st.used) {
      setDone(true);
      return;
    }
    setTiers(rollSkirmishTiers(mathRng, save.customStages));
  }, []);

  const pickTier = (t: SkirmishTier) => {
    if (!t.stageId) return; // 该档位暂无关卡，无法挑战
    const snapshot = structuredClone(run.hpMp);
    onBattle(nodeId, t.monsters, t.tier, snapshot, t.stageId, t.mechanics);
  };

  return (
    <div className="run-page">
      <div className="run-header">
        <button className="btn" onClick={onBack}>← 返回地图</button>
        <h2>狭路相逢</h2>
      </div>
      <div className="card">
        {!done ? (
          <>
            <p className="muted small">选择要挑战的档位。胜利获得奖励，失败无惩罚；无论胜负，战斗结束后 HP/MP 恢复至进入前。</p>
            <div className="skirmish-list">
              {tiers.map((t) => (
                <div key={t.tier} className="skirmish-card">
                  <div className="skirmish-name">{t.name}：{t.stageName}</div>
                  <div className="skirmish-monster">
                    怪物：{t.monsters.map((m) => `${enemyMap.get(m.monsterId)?.name ?? m.monsterId} ×${m.count}`).join('、') || '（无）'}
                  </div>
                  <button
                    className="btn primary"
                    onClick={() => pickTier(t)}
                    disabled={!t.stageId}
                  >
                    {t.stageId ? '挑战' : '暂无关卡'}
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="success">狭路相逢已结束。</p>
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
