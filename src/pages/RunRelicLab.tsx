import { useMemo, useState } from 'react';
import type { Rarity, Relic, RelicEffect, SaveData } from '../types';
import { mathRng } from '../types';
import { inPoolRelics, isUnimplemented, RELIC_MAP } from '../data/relics';
import { allItems } from '../data/content';
import { RARITY_COLORS, RARITY_LABELS } from '../ui/labels';
import { persistRun } from '../save/storage';
import { Sprite } from '../components/Sprite';
import { applyRelicPickupEffects, dungeonLevelOf, grantChestItems } from '../engine/run';
import { openChestRelic } from '../engine/drops';

// ===== 本地持久化：测试方案 + 操作日志（localStorage，全程 try/catch 防崩溃）=====
const PRESET_KEY = 'hajiwang_relic_lab_presets';
const LOG_KEY = 'hajiwang_relic_lab_log';
const MAX_LOG = 100;

// 一次性效果遗物（如时光之末）没有叠层概念：测试室写入的层数会与真实「已使用」状态混淆，
// 排除它们不写入 relicStacks（防误判已使用导致效果无法触发）
const stackable = (r: Relic | undefined): boolean => !!r && r.effect.kind !== 'failSave';

interface Preset {
  name: string;
  relics: string[];
  relicStacks?: Record<string, number>;
  savedAt: number;
}

const loadPresets = (): Preset[] => {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') as Preset[]; } catch { return []; }
};
const savePresets = (p: Preset[]) => {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch { /* 存储不可用时静默降级 */ }
};
const loadLog = (): string[] => {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as string[]; } catch { return []; }
};
const pushLog = (msg: string) => {
  try {
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const cur = loadLog();
    cur.push(`[${t}] ${msg}`);
    localStorage.setItem(LOG_KEY, JSON.stringify(cur.slice(-MAX_LOG)));
  } catch { /* ignore */ }
};
const clearLog = () => {
  try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ }
};

// 遗物效果分类（用于「属性」筛选）
type EffectCat = '特殊' | '数值' | '局内' | '机制';
const effectCat = (e: RelicEffect): EffectCat => {
  switch (e.kind) {
    case 'lifeCrystal': case 'manaCrystal': case 'corruptAltar': case 'bloodAltar':
      return '特殊';
    case 'unimplemented':
      return '机制';
    case 'condAtkPct': case 'spdDmgAmp': case 'lowSpdDmgAmp': case 'atkPerHit':
    case 'trueDmgOnHit': case 'firstHitDouble': case 'killBook':
      return '局内';
    default:
      return '数值';
  }
};

const CAT_LABELS: Record<EffectCat, string> = { 特殊: '特殊', 数值: '数值', 局内: '局内', 机制: '机制' };

export function RunRelicLab({ save, onChange, onBack }: {
  save: SaveData;
  onChange: (s: SaveData) => void;
  onBack: () => void;
}) {
  const run = save.activeRun;
  const owned = useMemo(() => new Set(run?.relics ?? []), [run]);
  const stacks = run?.relicStacks ?? {};
  const [kw, setKw] = useState('');
  const [rarity, setRarity] = useState<'all' | Rarity>('all');
  const [origin, setOrigin] = useState<'all' | '通用' | '泰拉'>('all');
  const [cat, setCat] = useState<'all' | EffectCat>('all');
  const [onlyAvail, setOnlyAvail] = useState(false); // R4：只看还能获取的随机池
  const [showUnimpl, setShowUnimpl] = useState(false);
  const [addLayer, setAddLayer] = useState(1);
  const [presetName, setPresetName] = useState('');
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [log, setLog] = useState<string[]>(loadLog);

  if (!run) {
    return (
      <div className="page">
        <div className="page-head"><h2>🧪 遗物测试</h2></div>
        <p className="muted">当前没有进行中的副本，无法使用遗物测试工具。</p>
        <div className="modal-actions"><button className="btn" onClick={onBack}>返回</button></div>
      </div>
    );
  }

  const commit = (s: SaveData, next: typeof run) => {
    onChange(persistRun(s, next));
  };

  const pool = inPoolRelics();
  const unimplCount = pool.filter(isUnimplemented).length;
  const availCount = pool.filter((r) => !owned.has(r.id) && !isUnimplemented(r)).length;

  // 遗物库筛选
  const filtered = pool.filter((r) => {
    if (kw && !r.name.includes(kw.trim()) && !r.id.includes(kw.trim())) return false;
    if (rarity !== 'all' && r.rarity !== rarity) return false;
    if (origin !== 'all' && r.origin !== origin) return false;
    if (cat !== 'all' && effectCat(r.effect) !== cat) return false;
    if (onlyAvail && (owned.has(r.id) || isUnimplemented(r))) return false;
    if (!showUnimpl && isUnimplemented(r)) return false;
    return true;
  });

  const addOne = (r: Relic, layer: number) => {
    let s = structuredClone(save);
    let next = structuredClone(run);
    if (!next.relics.includes(r.id)) next.relics.push(r.id);
    if (layer >= 1 && stackable(r)) {
      next.relicStacks ??= {};
      next.relicStacks[r.id] = Math.max(1, Math.min(99, layer));
    }
    const lvl = dungeonLevelOf(next.dungeonId);
    // 拾取即效：火把 / 回复 / 谷地树实等额外遗物
    const pk = applyRelicPickupEffects(next, [r.id], mathRng);
    next = pk.run;
    const logs: string[] = [];
    if (pk.chests.length > 0) {
      s = grantChestItems(s, next, pk.chests);
      logs.push(`谷地树实开箱藏品已放入队长背包`);
    }
    // 宝箱（grantItem）：开箱给队长
    const eff = RELIC_MAP[r.id]?.effect;
    if (eff?.kind === 'grantItem') {
      const it = openChestRelic(allItems(s), eff.rarity, lvl, mathRng);
      const leader = s.characters.find((c) => c?.id === next.party.leaderId);
      if (it && leader) {
        if (it.slot === 'material') {
          const found = s.materials.find((m) => m.itemId === it.id);
          if (found) found.count += 1;
          else s.materials.push({ itemId: it.id, count: 1 });
        } else {
          leader.inventory = [...(leader.inventory ?? []), it.id];
        }
        logs.push(`开箱获得「${it.name}」，已放入${it.slot === 'material' ? '共享材料仓库' : '队长背包'}`);
      }
    }
    commit(s, next);
    pushLog(`添加遗物「${r.name}」层数${layer >= 1 ? layer : '—'}${[...pk.texts, ...logs].length ? '；' + [...pk.texts, ...logs].join('；') : ''}`);
    setLog(loadLog());
  };

  const addBatch = (list: Relic[]) => {
    const fresh = list.filter((r) => !owned.has(r.id));
    if (!fresh.length) return;
    let s = structuredClone(save);
    let next = structuredClone(run);
    next.relicStacks ??= {};
    const lvl = dungeonLevelOf(next.dungeonId);
    const logs: string[] = [];
    for (const r of fresh) {
      if (!next.relics.includes(r.id)) next.relics.push(r.id);
      if (addLayer >= 1 && stackable(r)) {
        next.relicStacks = { ...(next.relicStacks ?? {}), [r.id]: Math.max(1, Math.min(99, addLayer)) };
      }
      const pk = applyRelicPickupEffects(next, [r.id], mathRng);
      next = pk.run;
      if (pk.chests.length > 0) s = grantChestItems(s, next, pk.chests);
      if (pk.texts.length > 0) logs.push(`${r.name}：${pk.texts.join('、')}`);
      const eff = RELIC_MAP[r.id]?.effect;
      if (eff?.kind === 'grantItem') {
        const it = openChestRelic(allItems(s), eff.rarity, lvl, mathRng);
        const leader = s.characters.find((c) => c?.id === next.party.leaderId);
        if (it && leader) {
          if (it.slot === 'material') {
            const found = s.materials.find((m) => m.itemId === it.id);
            if (found) found.count += 1;
            else s.materials.push({ itemId: it.id, count: 1 });
          } else {
            leader.inventory = [...(leader.inventory ?? []), it.id];
          }
          logs.push(`${r.name}开箱获得「${it.name}」（${it.slot === 'material' ? '已放入共享材料仓库' : '已放入队长背包'}）`);
        }
      }
    }
    commit(s, next);
    pushLog(`批量添加 ${fresh.length} 件遗物（层数${addLayer >= 1 ? addLayer : '—'}）${logs.length ? '；' + logs.join('；') : ''}`);
    setLog(loadLog());
  };

  const removeOne = (id: string) => {
    const next = structuredClone(run);
    next.relics = next.relics.filter((x) => x !== id);
    if (next.relicStacks) delete next.relicStacks[id];
    commit(save, next);
    pushLog(`移除遗物「${RELIC_MAP[id]?.name ?? id}」`);
    setLog(loadLog());
  };

  const clearAll = () => {
    const next = structuredClone(run);
    next.relics = [];
    next.relicStacks = {};
    commit(save, next);
    pushLog('清空全部遗物');
    setLog(loadLog());
  };

  const setLayer = (id: string, val: number) => {
    const next = structuredClone(run);
    next.relicStacks ??= {};
    if (val >= 1 && stackable(RELIC_MAP[id])) next.relicStacks[id] = Math.max(1, Math.min(99, val));
    else delete next.relicStacks[id];
    commit(save, next);
    pushLog(`调整「${RELIC_MAP[id]?.name ?? id}」层数→${val}`);
    setLog(loadLog());
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const p: Preset = { name, relics: [...run.relics], relicStacks: { ...run.relicStacks }, savedAt: Date.now() };
    const next = [...presets.filter((x) => x.name !== name), p];
    savePresets(next);
    setPresets(next);
    pushLog(`保存方案「${name}」（${run.relics.length} 件遗物）`);
    setLog(loadLog());
  };

  const loadPreset = (p: Preset) => {
    const next = structuredClone(run);
    next.relics = [...p.relics];
    next.relicStacks = { ...(p.relicStacks ?? {}) };
    commit(save, next);
    pushLog(`加载方案「${p.name}」`);
    setLog(loadLog());
  };

  const deletePreset = (name: string) => {
    const next = presets.filter((x) => x.name !== name);
    savePresets(next);
    setPresets(next);
    pushLog(`删除方案「${name}」`);
    setLog(loadLog());
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>🧪 遗物测试
          <span className="slot-level">副本内即时生效（下一场战斗按当前配置结算）· 操作仅作用于本次副本</span>
        </h2>
        <div className="page-head-actions">
          <button className="btn" onClick={onBack}>返回地图</button>
        </div>
      </div>

      <div className="relic-lab">
        {/* 列1：当前副本遗物 */}
        <div className="card relic-lab-col">
          <h3>当前副本遗物（{run.relics.length}）</h3>
          {run.relics.length === 0 && <p className="muted small">尚未获得遗物。</p>}
          <div className="relic-lab-owned">
            {run.relics.map((id) => {
              const r = RELIC_MAP[id];
              if (!r) return null;
              const layer = stacks[id] ?? 1;
              return (
                <div key={id} className="relic-lab-item">
                  <Sprite className="relic-lab-icon" src={r.icon} alt={r.name} />
                  <div className="relic-lab-item-body">
                    <div className="relic-lab-item-top">
                      <b style={{ color: RARITY_COLORS[r.rarity] }}>{r.name}</b>
                      <span className="muted small">{RARITY_LABELS[r.rarity]}{r.origin ? ` · ${r.origin}` : ''}</span>
                    </div>
                    <div className="relic-lab-item-ctrl">
                      <label className="muted small">层数</label>
                      <input
                        type="number" min={0} max={99} value={layer}
                        className="input narrow"
                        onChange={(e) => setLayer(id, Math.floor(Number(e.target.value) || 0))}
                      />
                      <button className="btn-mini btn" onClick={() => removeOne(id)}>移除</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {run.relics.length > 0 && (
            <button className="btn btn-danger btn-block" onClick={clearAll}>清空全部遗物</button>
          )}
        </div>

        {/* 列2：遗物库（筛选 + 添加 + 随机池查看） */}
        <div className="card relic-lab-col">
          <h3>遗物库
            <span className="muted small">随机池 {pool.length} · 未实装 {unimplCount} · 可获取 {availCount}</span>
          </h3>
          <div className="relic-lab-filters">
            <input
              className="input" placeholder="按名称搜索…" value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
            <select className="input" value={rarity} onChange={(e) => setRarity(e.target.value as 'all' | Rarity)}>
              <option value="all">全部稀有度</option>
              {Object.entries(RARITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input" value={origin} onChange={(e) => setOrigin(e.target.value as 'all' | '通用' | '泰拉')}>
              <option value="all">全部出处</option>
              <option value="通用">通用</option>
              <option value="泰拉">泰拉</option>
            </select>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value as 'all' | EffectCat)}>
              <option value="all">全部属性</option>
              {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="relic-lab-toggle">
              <input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} />
              只看可获取
            </label>
            <label className="relic-lab-toggle">
              <input type="checkbox" checked={showUnimpl} onChange={(e) => setShowUnimpl(e.target.checked)} />
              显示未实装
            </label>
          </div>

          <div className="relic-lab-addbar">
            <label className="muted small">添加层数</label>
            <input
              type="number" min={1} max={99} value={addLayer}
              className="input narrow"
              onChange={(e) => setAddLayer(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
            <button className="btn-mini btn" onClick={() => addBatch(filtered)} disabled={!filtered.length}>
              一键添加筛选结果（{filtered.length}）
            </button>
          </div>

          <div className="relic-lab-lib">
            {filtered.map((r) => {
              const has = owned.has(r.id);
              return (
                <div key={r.id} className={`relic-lab-item${has ? ' owned' : ''}`}>
                  <Sprite className="relic-lab-icon" src={r.icon} alt={r.name} />
                  <div className="relic-lab-item-body">
                    <div className="relic-lab-item-top">
                      <b style={{ color: RARITY_COLORS[r.rarity] }}>{r.name}</b>
                      <span className="muted small">
                        {RARITY_LABELS[r.rarity]}{r.origin ? ` · ${r.origin}` : ''}{isUnimplemented(r) ? ' · 未实装' : ''}
                      </span>
                    </div>
                    <p className="muted small relic-lab-desc">{r.desc}</p>
                    <div className="relic-lab-item-ctrl">
                      <button className="btn-mini btn" disabled={has} onClick={() => addOne(r, addLayer)}>
                        {has ? '已拥有' : '添加'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="muted small">没有匹配的遗物。</p>}
          </div>
        </div>

        {/* 列3：方案保存/加载 + 操作日志 */}
        <div className="card relic-lab-col">
          <h3>测试方案</h3>
          <div className="relic-lab-savebar">
            <input
              className="input" placeholder="方案名称…" value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button className="btn-mini btn" onClick={savePreset} disabled={!presetName.trim()}>保存当前配置</button>
          </div>
          {presets.length === 0 && <p className="muted small">尚无保存的方案。</p>}
          {presets.map((p) => (
            <div key={p.name} className="relic-lab-preset">
              <b>{p.name}</b>
              <span className="muted small">{p.relics.length} 件遗物 · {new Date(p.savedAt).toLocaleString('zh-CN')}</span>
              <div className="relic-lab-preset-actions">
                <button className="btn-mini btn" onClick={() => loadPreset(p)}>加载</button>
                <button className="btn-mini btn btn-danger" onClick={() => deletePreset(p.name)}>删除</button>
              </div>
            </div>
          ))}

          <h3 className="relic-lab-log-title">操作日志</h3>
          <div className="relic-lab-log">
            {[...log].reverse().map((l, i) => <div key={i} className="muted small">{l}</div>)}
            {log.length === 0 && <p className="muted small">暂无操作记录。</p>}
          </div>
          <button className="btn-mini btn" onClick={() => { clearLog(); setLog([]); }}>清空日志</button>
        </div>
      </div>
    </div>
  );
}
