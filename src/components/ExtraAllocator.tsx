import { useState } from 'react';
import type { ExtraStats } from '../types';
import { EXTRA_KEYS } from '../types';
import { EXTRA_LABELS } from '../ui/labels';
import { EXTRA_BUDGET, EXTRA_MAX, EXTRA_MIN } from '../engine/stats';

// 额外6维分配器：每项 10~40，总预算 60+80=140 点（初始60 + 可分配80）
// 支持点击加减与直接输入数值；非法输入标红提示，超预算自动截断
export type ExtraUpdater = ExtraStats | ((v: ExtraStats) => ExtraStats);

export function ExtraAllocator({ value, onChange }: {
  value: ExtraStats;
  onChange: (u: ExtraUpdater) => void;
}) {
  const total = EXTRA_KEYS.length * EXTRA_MIN + EXTRA_BUDGET;
  const used = EXTRA_KEYS.reduce((s, k) => s + value[k], 0);
  const left = total - used;
  // 输入框草稿：未编辑时跟随 value；编辑中保留原样以便标红
  const [draft, setDraft] = useState<Partial<Record<keyof ExtraStats, string>>>({});

  const change = (k: keyof ExtraStats, delta: number) => {
    onChange((prev) => {
      const prevUsed = EXTRA_KEYS.reduce((s, x) => s + prev[x], 0);
      const prevLeft = total - prevUsed;
      const target = Math.min(EXTRA_MAX, Math.max(EXTRA_MIN, prev[k] + delta));
      const actual = target - prev[k];
      if (delta > 0 && (prevLeft <= 0 || actual > prevLeft)) return prev;
      if (actual === 0) return prev;
      return { ...prev, [k]: prev[k] + actual };
    });
    setDraft((d) => ({ ...d, [k]: undefined }));
  };

  // 失焦/回车提交：clamp 到 [10,40]，超出剩余预算只补到剩余
  const commit = (k: keyof ExtraStats, raw: string) => {
    setDraft((d) => ({ ...d, [k]: undefined }));
    if (raw.trim() === '') return;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return;
    onChange((prev) => {
      const prevUsed = EXTRA_KEYS.reduce((s, x) => s + prev[x], 0);
      const prevLeft = total - prevUsed;
      let target = Math.min(EXTRA_MAX, Math.max(EXTRA_MIN, n));
      if (target - prev[k] > prevLeft) target = prev[k] + prevLeft;
      if (target === prev[k]) return prev;
      return { ...prev, [k]: target };
    });
  };

  const invalidOf = (k: keyof ExtraStats, raw: string): string | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || Number.isNaN(n)) return '需为整数';
    if (n < EXTRA_MIN) return `最低 ${EXTRA_MIN}`;
    if (n > EXTRA_MAX) return `最高 ${EXTRA_MAX}`;
    if (n - value[k] > left) return `剩余 ${left} 点`;
    return null;
  };

  return (
    <div className="allocator">
      <div className={`allocator-left ${left === 0 ? 'ok' : ''}`}>
        剩余点数：<b>{left}</b>（{EXTRA_MIN}~{EXTRA_MAX}/项，可直接输入）
      </div>
      <div className="allocator-hint muted small">
        初始10点不计入加成：力量+1攻/点 · 智力+1MP/点 · 幸运+2HP/点 · 意志+1防/2点 · 魅力+1法抗/2点 · 敏捷每5点一档交替+1速度（40敏=速度+3/+3）
      </div>
      {EXTRA_KEYS.map((k) => {
        const raw = draft[k] ?? String(value[k]);
        const editing = draft[k] !== undefined;
        const invalid = editing ? invalidOf(k, raw) : null;
        return (
          <div className="allocator-row" key={k}>
            <span className="allocator-name">{EXTRA_LABELS[k]}</span>
            <button className="btn-step" onClick={() => change(k, -1)}>−</button>
            <input
              className={`allocator-input ${invalid ? 'allocator-input-bad' : ''}`}
              type="number"
              min={EXTRA_MIN}
              max={EXTRA_MAX}
              step={1}
              value={raw}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              onBlur={() => commit(k, raw)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
            <button className="btn-step" onClick={() => change(k, 1)}>＋</button>
            {invalid && <span className="allocator-err">{invalid}</span>}
          </div>
        );
      })}
    </div>
  );
}
