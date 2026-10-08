import { useState } from 'react';
import type { SaveData } from '../types';
import { resolveAltar, type AltarChoice } from '../engine/nodes';
import { resolveNode } from '../engine/run';
import { persistRun } from '../save/storage';
import { Modal } from '../components/Modal';

const ALTAR_OPTIONS: { choice: AltarChoice; title: string; desc: string }[] = [
  { choice: 'crimson', title: '猩红祭坛', desc: '获得史诗遗物：敌方每次行动恢复自身5%最大生命值。' },
  { choice: 'corruption', title: '腐化祭坛', desc: '获得史诗遗物：敌方每次行动随机减少我方单位5攻击或5防御。' },
  { choice: 'both', title: '我都要', desc: '同时获得猩红祭坛与腐化祭坛。' },
  { choice: 'leave', title: '跑路了兄弟', desc: '放弃，不获得任何遗物。' },
];

export function RunAltar({ save, nodeId, onChange, onBack }: {
  save: SaveData;
  nodeId: string;
  onChange: (s: SaveData) => void;
  onBack: () => void;
}) {
  const run = save.activeRun!;
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const choose = (choice: AltarChoice) => {
    const nextRun = resolveAltar(run, nodeId, choice);
    const cleared = resolveNode(nextRun, nodeId);
    const next = persistRun(save, cleared);
    onChange(next);
    setDone(true);
    setMsg(choice === 'leave' ? '你选择了离开，未获得任何遗物。' : '祭坛之力已注入你的旅程。');
  };

  return (
    <div className="run-page">
      <div className="run-header">
        <button className="btn" onClick={onBack}>← 返回地图</button>
        <h2>命运所指 · 祭坛</h2>
      </div>
      <div className="card">
        <p>一座古老的祭坛矗立在你面前，散发着诡异的气息。你可以选择触碰它……</p>
        {!done ? (
          <div className="altar-options">
            {ALTAR_OPTIONS.map((o) => (
              <button key={o.choice} className="btn altar-option" onClick={() => choose(o.choice)}>
                <div className="altar-title">{o.title}</div>
                <div className="altar-desc">{o.desc}</div>
              </button>
            ))}
          </div>
        ) : (
          <p className="success">{msg}</p>
        )}
      </div>
      {done && (
        <div className="run-actions">
          <button className="btn primary" onClick={onBack}>继续探索</button>
        </div>
      )}
      {msg && !done && <Modal title="提示" onClose={() => setMsg(null)}><p>{msg}</p></Modal>}
    </div>
  );
}
