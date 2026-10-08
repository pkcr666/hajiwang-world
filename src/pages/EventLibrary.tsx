import { useMemo, useState } from 'react';
import type {
  EventCondition, EventDef, EventOption, EventReward, EventStatKey, Rarity, SaveData,
} from '../types';
import { DUNGEONS } from '../data/dungeons';
import { EVENTS } from '../data/events';
import { allItems } from '../data/content';
import { RELIC_MAP } from '../data/relics';
import { removeCustomEvent, upsertCustomEvent } from '../save/storage';
import { RARITY_LABELS } from '../ui/labels';

// 奖励类型清单（与 EventReward 的 kind 联合一致）
const REWARD_KINDS: EventReward['kind'][] = [
  'relic', 'item', 'randomItem', 'randomRelic', 'enchantedWeapon',
  'torch', 'heal', 'damage', 'coins', 'battle', 'battleRandom',
  'randomOne', 'removeRelic', 'recruitAce', 'none',
];
const REWARD_KIND_LABELS: Record<EventReward['kind'], string> = {
  relic: '指定遗物', item: '指定藏品', randomItem: '随机藏品', randomRelic: '随机遗物',
  enchantedWeapon: '附魔武器', torch: '火把', heal: '恢复', damage: '扣血',
  coins: '哈哈币', battle: '指定战斗', battleRandom: '随机战斗',
  randomOne: '随机选一', removeRelic: '移除遗物', recruitAce: '招募王牌', none: '无',
};

const STAT_KEYS: EventStatKey[] = ['str', 'int', 'agi', 'luk', 'wil', 'cha'];
const STAT_KEY_LABELS: Record<EventStatKey, string> = {
  str: '力量', int: '智力', agi: '敏捷', luk: '幸运', wil: '意志', cha: '魅力',
};
const RARITIES: Rarity[] = ['common', 'uncommon', 'fine', 'rare', 'epic', 'legendary'];

const newId = () => `ce_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function blankEvent(): EventDef {
  return {
    id: newId(),
    name: '新事件',
    dungeon: DUNGEONS[0].id,
    floors: [1],
    cond: { type: 'always' },
    text: '事件描述文本…',
    options: [{
      id: `o_${Date.now().toString(36)}`,
      text: '选项一',
      outcome: { rewards: [{ kind: 'none' }] },
    }],
  };
}

// 奖励参数编辑子组件
function RewardEditor({ reward, items, stages, onChange }: {
  reward: EventReward;
  items: { id: string; name: string }[];
  stages: string[];
  onChange: (r: EventReward) => void;
}) {
  const set = (patch: Partial<EventReward>) => onChange({ ...reward, ...patch } as EventReward);
  return (
    <div className="reward-row">
      <select value={reward.kind} onChange={(e) => {
        const kind = e.target.value as EventReward['kind'];
        const base = { kind } as any;
        if (kind === 'relic') base.relicId = '';
        if (kind === 'item') base.itemId = '';
        if (kind === 'randomItem') { base.rarity = 'common'; base.level = 1; }
        if (kind === 'torch') base.count = 1;
        if (kind === 'heal') { base.hpPct = 0; base.mpPct = 0; }
        if (kind === 'coins') base.count = 10;
        if (kind === 'battle') base.stageName = '';
        if (kind === 'battleRandom') base.stageNames = [];
        onChange(base as EventReward);
      }}>
        {REWARD_KINDS.map((k) => <option key={k} value={k}>{REWARD_KIND_LABELS[k]}</option>)}
      </select>
      {reward.kind === 'relic' && (
        <select value={(reward as any).relicId ?? ''} onChange={(e) => set({ relicId: e.target.value })}>
          <option value="">— 选择遗物 —</option>
          {Object.values(RELIC_MAP).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      {reward.kind === 'item' && (
        <select value={(reward as any).itemId ?? ''} onChange={(e) => set({ itemId: e.target.value })}>
          <option value="">— 选择藏品 —</option>
          {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
        </select>
      )}
      {reward.kind === 'randomItem' && (
        <>
          <select value={(reward as any).rarity ?? 'common'} onChange={(e) => set({ rarity: e.target.value as Rarity })}>
            {RARITIES.map((r) => <option key={r} value={r}>{RARITY_LABELS[r]}</option>)}
          </select>
          <input type="number" min={1} value={(reward as any).level ?? 1}
            onChange={(e) => set({ level: Math.max(1, +e.target.value) })} placeholder="等级" />
        </>
      )}
      {reward.kind === 'torch' && (
        <input type="number" min={1} value={(reward as any).count ?? 1}
          onChange={(e) => set({ count: Math.max(1, +e.target.value) })} placeholder="数量" />
      )}
      {reward.kind === 'heal' && (
        <>
          <input type="number" min={0} max={100} value={(reward as any).hpPct ?? 0}
            onChange={(e) => set({ hpPct: +e.target.value })} placeholder="HP%" />
          <input type="number" min={0} max={100} value={(reward as any).mpPct ?? 0}
            onChange={(e) => set({ mpPct: +e.target.value })} placeholder="MP%" />
        </>
      )}
      {reward.kind === 'coins' && (
        <input type="number" min={0} value={(reward as any).count ?? 0}
          onChange={(e) => set({ count: Math.max(0, +e.target.value) })} placeholder="数量" />
      )}
      {reward.kind === 'battle' && (
        <select value={(reward as any).stageName ?? ''} onChange={(e) => set({ stageName: e.target.value })}>
          <option value="">— 选择关卡 —</option>
          {stages.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
    </div>
  );
}

export function EventLibrary({ save, onChange, onBack }: {
  save: SaveData;
  onChange: (s: SaveData) => void;
  onBack: () => void;
}) {
  const items = useMemo(() => allItems(save), [save]);
  const stages = useMemo(() => (save.customStages ?? []).map((s) => s.name), [save]);
  const builtinIds = useMemo(() => new Set<string>(), []); // 内置事件 id 集合（下方填充）

  const [draft, setDraft] = useState<EventDef | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 合并内置 + 自定义事件，内置标记只读
  const allEvents = useMemo(() => {
    EVENTS.forEach((e) => builtinIds.add(e.id));
    return [...EVENTS, ...(save.customEvents ?? [])];
  }, [save, builtinIds]);

  const isBuiltin = (id: string) => builtinIds.has(id);

  const startEdit = (ev: EventDef) => {
    // 内置事件：只读展示（不允许修改/保存）；自定义事件：可编辑
    setDraft(structuredClone(ev));
    setEditingId(ev.id);
  };

  const startNew = () => {
    const ev = blankEvent();
    setDraft(ev);
    setEditingId('__new__');
  };

  const cancel = () => { setDraft(null); setEditingId(null); };

  const saveDraft = () => {
    if (!draft) return;
    // 简单校验
    if (!draft.name.trim() || !draft.text.trim() || draft.options.length === 0) {
      alert('请填写事件名称、文本，并至少保留一个选项');
      return;
    }
    onChange(upsertCustomEvent(save, draft));
    cancel();
  };

  const remove = (id: string) => {
    if (isBuiltin(id)) return;
    if (!confirm('确定删除该自定义事件？')) return;
    onChange(removeCustomEvent(save, id));
    if (editingId === id) cancel();
  };

  // 修改草稿辅助
  const setEv = (patch: Partial<EventDef>) => setDraft((d) => d ? { ...d, ...patch } : d);

  const setOption = (idx: number, patch: Partial<EventOption>) =>
    setDraft((d) => {
      if (!d) return d;
      const opts = d.options.map((o, i) => i === idx ? { ...o, ...patch } : o);
      return { ...d, options: opts };
    });

  const addOption = () => setDraft((d) => {
    if (!d) return d;
    return { ...d, options: [...d.options, {
      id: `o_${Date.now().toString(36)}`,
      text: '新选项', outcome: { rewards: [{ kind: 'none' }] },
    }] };
  });

  const removeOption = (idx: number) => setDraft((d) => {
    if (!d) return d;
    return { ...d, options: d.options.filter((_, i) => i !== idx) };
  });

  const setRewards = (optIdx: number, key: 'rewards' | 'fail', rewards: EventReward[]) =>
    setDraft((d) => {
      if (!d) return d;
      const opts = d.options.map((o, i) =>
        i === optIdx ? { ...o, outcome: { ...o.outcome, [key]: rewards } } : o);
      return { ...d, options: opts };
    });

  return (
    <div className="page">
      <div className="page-head">
        <h2>事件库 · 不期而遇管理</h2>
        <div>
          <button className="btn-primary" onClick={startNew}>＋ 新建事件</button>
          <button className="btn" onClick={onBack}>返回</button>
        </div>
      </div>

      <div className="event-library">
        {/* 左侧事件列表 */}
        <div className="event-list">
          <div className="muted small" style={{ marginBottom: 8 }}>
            内置事件只读 · 自定义事件可编辑/删除
          </div>
          {allEvents.map((ev) => (
            <div key={ev.id} className={`event-item ${editingId === ev.id ? 'active' : ''} ${isBuiltin(ev.id) ? 'builtin' : ''}`}
              onClick={() => startEdit(ev)}>
              <span className="event-item-name">{ev.name}</span>
              <span className="event-item-meta">
                {isBuiltin(ev.id) ? '内置' : '自定义'} · {DUNGEONS.find((d) => d.id === ev.dungeon)?.name ?? ev.dungeon} · {ev.floors.join(',')}层
              </span>
              {!isBuiltin(ev.id) && (
                <button className="btn-mini" onClick={(e) => { e.stopPropagation(); remove(ev.id); }}>删除</button>
              )}
            </div>
          ))}
        </div>

        {/* 右侧编辑面板 */}
        <div className="event-editor">
          {!draft ? (
            <div className="muted center" style={{ padding: 40 }}>
              点击左侧事件编辑，或点「新建事件」
            </div>
          ) : (
            <div className="event-form">
              <div className="form-row">
                <label>事件名称</label>
                <input value={draft.name} onChange={(e) => setEv({ name: e.target.value })} />
              </div>
              <div className="form-row">
                <label>出现副本</label>
                <select value={draft.dungeon} onChange={(e) => setEv({ dungeon: e.target.value })}>
                  {DUNGEONS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>出现层数（逗号分隔）</label>
                <input value={draft.floors.join(',')}
                  onChange={(e) => setEv({
                    floors: e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0),
                  })} />
              </div>
              <div className="form-row">
                <label>出现条件</label>
                <select value={draft.cond.type}
                  onChange={(e) => {
                    const t = e.target.value as EventCondition['type'];
                    if (t === 'always') setEv({ cond: { type: 'always' } });
                    else if (t === 'torchGte') setEv({ cond: { type: 'torchGte', count: 1 } });
                    else if (t === 'relic') setEv({ cond: { type: 'relic', relicId: '' } });
                    else if (t === 'coinGte') setEv({ cond: { type: 'coinGte', count: 0 } });
                  }}>
                  <option value="always">常规刷新</option>
                  <option value="torchGte">携带火把≥N</option>
                  <option value="relic">持有指定遗物</option>
                  <option value="coinGte">金币≥N</option>
                </select>
                {draft.cond.type === 'torchGte' && (
                  <input type="number" min={1} value={draft.cond.count}
                    onChange={(e) => setEv({ cond: { type: 'torchGte', count: +e.target.value } })} />
                )}
                {draft.cond.type === 'relic' && (
                  <select value={draft.cond.relicId}
                    onChange={(e) => setEv({ cond: { type: 'relic', relicId: e.target.value } })}>
                    <option value="">— 选择遗物 —</option>
                    {Object.values(RELIC_MAP).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
                {draft.cond.type === 'coinGte' && (
                  <input type="number" min={0} value={draft.cond.count}
                    onChange={(e) => setEv({ cond: { type: 'coinGte', count: +e.target.value } })} />
                )}
              </div>
              <div className="form-row col">
                <label>事件文本</label>
                <textarea value={draft.text} rows={4} onChange={(e) => setEv({ text: e.target.value })} />
              </div>

              <h4>选项（{draft.options.length}）</h4>
              {draft.options.map((opt, idx) => (
                <div key={opt.id} className="option-block">
                  <div className="form-row">
                    <label>选项文本</label>
                    <input value={opt.text} onChange={(e) => setOption(idx, { text: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label>提示文字</label>
                    <input value={opt.hint ?? ''} onChange={(e) => setOption(idx, { hint: e.target.value })} placeholder="可选" />
                  </div>
                  <div className="form-row">
                    <label>消耗火把</label>
                    <input type="number" min={0} value={opt.cost?.torch ?? 0}
                      onChange={(e) => setOption(idx, { cost: { ...opt.cost, torch: +e.target.value } })} />
                    <label>消耗金币</label>
                    <input type="number" min={0} value={opt.cost?.coins ?? 0}
                      onChange={(e) => setOption(idx, { cost: { ...opt.cost, coins: +e.target.value } })} />
                  </div>
                  <div className="form-row">
                    <label>判定属性</label>
                    <select value={opt.outcome.stat?.key ?? ''}
                      onChange={(e) => {
                        if (!e.target.value) {
                          const { stat, ...rest } = opt.outcome;
                          setOption(idx, { outcome: rest as any });
                        } else {
                          setOption(idx, { outcome: { ...opt.outcome, stat: { key: e.target.value as EventStatKey, threshold: opt.outcome.stat?.threshold ?? 50 } } });
                        }
                      }}>
                      <option value="">无判定</option>
                      {STAT_KEYS.map((k) => <option key={k} value={k}>{STAT_KEY_LABELS[k]}</option>)}
                    </select>
                    {opt.outcome.stat && (
                      <input type="number" value={opt.outcome.stat.threshold}
                        onChange={(e) => setOption(idx, { outcome: { ...opt.outcome, stat: { ...opt.outcome.stat!, threshold: +e.target.value } } })} />
                    )}
                  </div>

                  <div className="rewards-block">
                    <div className="rewards-label">成功奖励</div>
                    {opt.outcome.rewards.map((r, ri) => (
                      <div key={ri} className="reward-line">
                        <RewardEditor reward={r} items={items} stages={stages} onChange={(nr) => {
                          const rs = [...opt.outcome.rewards]; rs[ri] = nr; setRewards(idx, 'rewards', rs);
                        }} />
                        <button className="btn-mini" onClick={() => {
                          const rs = opt.outcome.rewards.filter((_, i) => i !== ri); setRewards(idx, 'rewards', rs);
                        }}>移除</button>
                      </div>
                    ))}
                    <button className="btn-mini" onClick={() => setRewards(idx, 'rewards', [...opt.outcome.rewards, { kind: 'none' }])}>＋ 奖励</button>
                  </div>

                  {opt.outcome.stat && (
                    <div className="rewards-block">
                      <div className="rewards-label">失败奖励</div>
                      {(opt.outcome.fail ?? []).map((r, ri) => (
                        <div key={ri} className="reward-line">
                          <RewardEditor reward={r} items={items} stages={stages} onChange={(nr) => {
                            const rs = [...(opt.outcome.fail ?? [])]; rs[ri] = nr; setRewards(idx, 'fail', rs);
                          }} />
                          <button className="btn-mini" onClick={() => {
                            const rs = (opt.outcome.fail ?? []).filter((_, i) => i !== ri); setRewards(idx, 'fail', rs);
                          }}>移除</button>
                        </div>
                      ))}
                      <button className="btn-mini" onClick={() => setRewards(idx, 'fail', [...(opt.outcome.fail ?? []), { kind: 'none' }])}>＋ 失败奖励</button>
                    </div>
                  )}

                  <button className="btn-mini danger" onClick={() => removeOption(idx)}>删除此选项</button>
                </div>
              ))}
              <button className="btn" onClick={addOption}>＋ 新增选项</button>

              <div className="form-actions">
                {isBuiltin(draft.id) ? (
                  <span className="muted">内置事件（只读，不可修改）</span>
                ) : (
                  <button className="btn-primary" onClick={saveDraft}>保存</button>
                )}
                <button className="btn" onClick={cancel}>取消</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
