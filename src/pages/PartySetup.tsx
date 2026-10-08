import { useMemo, useState } from 'react';
import type { DungeonDef } from '../data/dungeons';
import { floorText } from './Dungeons';
import type { Character, Party, SaveData } from '../types';
import { mathRng } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES, itemIcon } from '../assets/config';
import { itemMapOf } from '../data/content';
import { RELICS } from '../data/relics';
import { normalizeParty, partyMembers, validateParty } from '../engine/party';
import { MAP_DUNGEON, runBlockers } from '../engine/mapgen';
import { INITIAL_RUN_RELICS, startRun, startCalamityRun } from '../engine/run';
import { buildAllyCombatant } from '../engine/unit';
import { abortRun, addToCharacterBag, beginRun, saveParty } from '../save/storage';
import { COIN_NAME } from '../engine/drops';
import { Sprite } from '../components/Sprite';
import { RARITY_COLORS } from '../ui/labels';

export function PartySetup({ save, dungeon, onChange, onBack, onLaunch, onContinue }: {
  save: SaveData;
  dungeon: DungeonDef;
  onChange: (s: SaveData) => void;
  onBack: () => void;
  onLaunch: () => void;
  onContinue: () => void;
}) {
  const roster = useMemo(
    () => save.characters.filter((c): c is Character => !!c && !c.test),
    [save.characters],
  );
  // 上次编队仍合法（人没删、人数不超上限）则回填，否则以首个角色为初始队长
  const initial = (): Party => {
    const p = save.party;
    if (p && !validateParty(p, save.characters, dungeon.maxParty)) return structuredClone(p);
    return roster[0] ? { leaderId: roster[0].id, memberIds: [roster[0].id] } : { leaderId: '', memberIds: [] };
  };
  const [party, setParty] = useState<Party>(initial);
  const [savedHint, setSavedHint] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [starterRelic, setStarterRelic] = useState<string | undefined>(undefined);

  // 新手村初始携带遗物：20级队长可携带「终局联系」带入副本
  const endgameRelic = useMemo(() => RELICS.find((r) => r.id === 'rl_endgame_link'), []);

  const members = partyMembers(party, save.characters);
  const memberSet = new Set(party.memberIds);
  // 每次副本挑战携带0哈哈币进入；成员随身币在进本时存入仓库
  const pooled = 0;
  const stageCount = save.customStages.filter((s) => s.dungeon === dungeon.id).length;

  const isLeader = (id: string) => id === party.leaderId;
  const full = party.memberIds.length >= dungeon.maxParty;
  // 灾厄泰拉仅限 30 级及以上角色游玩
  const levelLocked = (c: Character) => dungeon.id === 'preWallCalamity' && c.level < 30;

  const clearHints = () => {
    setSavedHint(false);
    setLaunchError(null);
    setHint(null);
  };

  const toggle = (id: string) => {
    clearHints();
    const ch = save.characters.find((x) => x?.id === id);
    if (ch && levelLocked(ch)) {
      setHint(`灾厄泰拉仅限 30 级及以上角色游玩（${ch.name} 当前 Lv.${ch.level}）。`);
      return;
    }
    if (memberSet.has(id)) {
      const rest = party.memberIds.filter((x) => x !== id);
      // 移出队长时由编队内下一位自动接任；编队被清空则等待重新选人
      if (party.leaderId !== id) setParty({ ...party, memberIds: rest });
      else setParty(rest.length ? normalizeParty(rest[0], rest) : { leaderId: '', memberIds: [] });
      return;
    }
    if (full) {
      setHint(`队伍已满（最多 ${dungeon.maxParty} 人），先移出一名成员再加入。`);
      return;
    }
    setParty(
      party.memberIds.length
        ? { ...party, memberIds: [...party.memberIds, id] }
        : normalizeParty(id, [id]),
    );
  };

  // 设为队长：已在编队内则直接改派；未入队则拉进编队并接任队长（队伍满时提示先移出）
  const makeLeader = (id: string) => {
    clearHints();
    const ch = save.characters.find((x) => x?.id === id);
    if (ch && levelLocked(ch)) {
      setHint(`灾厄泰拉仅限 30 级及以上角色游玩（${ch.name} 当前 Lv.${ch.level}）。`);
      return;
    }
    if (memberSet.has(id)) {
      setParty(normalizeParty(id, party.memberIds));
      return;
    }
    if (full) {
      setHint(`队伍已满（最多 ${dungeon.maxParty} 人），先移出一名成员再把他设为队长。`);
      return;
    }
    setParty(normalizeParty(id, [...party.memberIds, id]));
  };
  const error = validateParty(party, save.characters, dungeon.maxParty);

  const persist = () => {
    onChange(saveParty(save, party));
    setSavedHint(true);
  };

  // 开始探索：生成三层地图并进入 run（生命/魔力以满血开图，之后跨战斗继承）
  const launch = () => {
    if (error) return;
    if (dungeon.id === 'preWallCalamity') {
      const membersNow = partyMembers(party, save.characters);
      const low = membersNow.filter((m) => m.level < 30);
      if (low.length) {
        setLaunchError(`灾厄泰拉仅限 30 级及以上角色游玩：${low.map((m) => `${m.name}(Lv.${m.level})`).join('、')} 未达标。`);
        return;
      }
    }
    const blockers = runBlockers(save.customStages);
    if (blockers.length) {
      setSavedHint(false);
      setLaunchError(`关卡库还缺：${blockers.join('、')}。BOSS 关需亲自创建；子层需含 BOSS 关与普通/紧急关。`);
      return;
    }
    const members = partyMembers(party, save.characters);
    const itemsMap = itemMapOf(save);
    const initialHpMp: Record<string, { hp: number; mp: number }> = {};
    members.forEach((c, i) => {
      // 开局遗物为生命水晶(1层)+魔力水晶(0层)，与 startRun 初始化一致
      const u = buildAllyCombatant(c, itemsMap, i, {
        relics: INITIAL_RUN_RELICS,
        relicStacks: { rl_life_crystal: 1, rl_mana_crystal: 0 },
      });
      initialHpMp[c.id] = { hp: u.maxHp, mp: u.maxMp };
    });
    const isCalamity = dungeon.id === 'preWallCalamity';
    const startFn = isCalamity ? startCalamityRun : startRun;
    const run = startFn({
      party, stages: save.customStages, rng: mathRng,
      initialHpMp, pooledCoins: pooled,
    });
    // 20级队长携带的初始遗物（终局联系等非随机池遗物）
    if (starterRelic) {
      run.relics = [starterRelic, ...run.relics];
      run.starterRelic = starterRelic;
    }
    // 先记录进本快照再发放初始补给：初始补给计入本局，
    // 主动撤离/战斗失败恢复快照时随之清空，不回退到进本前
    let s = beginRun(save, run);
    const hpPotion = isCalamity ? 'it_potion_hp_m' : 'it_potion_hp_s';
    const mpPotion = isCalamity ? 'it_potion_mp_m' : 'it_potion_mp_s';
    const potionCount = isCalamity ? 3 : 2;
    for (const c of members) {
      s = addToCharacterBag(s, c.id, hpPotion, potionCount);
      s = addToCharacterBag(s, c.id, mpPotion, potionCount);
    }
    onChange(s);
    onLaunch();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>编队出战 · {dungeon.name}
          <span className="slot-level">最多 {dungeon.maxParty} 人 · {floorText(dungeon.floors)}</span>
        </h2>
        <button className="btn" onClick={onBack}>返回副本</button>
      </div>

      {save.activeRun && (
        <div className="card run-resume">
          <b>有一次未完成的探索</b>
          <span className="muted small">
            {save.activeRun.act === 'sub' ? '子层·瑟银的菜鸟' : `第 ${save.activeRun.act} 层`} ·
            已清理 {save.activeRun.cleared.length} 个节点 · 共享币池 💰{save.activeRun.coins}
          </span>
          <div className="modal-actions">
            <button className="btn primary" onClick={onContinue}>继续探索</button>
            <button
              className="btn btn-danger"
              onClick={() => onChange(abortRun(save))}
            >
              放弃进度
            </button>
          </div>
        </div>
      )}

      <div className="party-layout">
        <div className="card">
          <h3>队员名单（点击加入/移出）</h3>
          {roster.length === 0 && <div className="muted">还没有角色，请先去角色名册创建。</div>}
          <div className="party-roster">
            {roster.map((c) => {
              const inParty = memberSet.has(c.id);
              const leader = isLeader(c.id);
              const locked = levelLocked(c);
              return (
                <div key={c.id}
                  className={`party-card ${inParty ? 'card-selected' : ''} ${leader ? 'party-leader' : ''} ${locked ? 'party-card-locked' : ''}`}
                  onClick={() => toggle(c.id)}>
                  <Sprite className="head-job-icon" src={JOB_IMAGES[c.job]} alt={JOB_DEFS[c.job].name} />
                  <div className="party-card-main">
                    <b>{c.name}</b>
                    <span className="muted small">{JOB_DEFS[c.job].name} · Lv.{c.level} · 💰{c.coins}</span>
                  </div>
                  {locked && <span className="party-lock-tag">Lv.30 解锁</span>}
                  {leader && <span className="party-badge">队长</span>}
                  {!leader && (
                    <button className="btn-mini" onClick={(e) => { e.stopPropagation(); makeLeader(c.id); }}>
                      设为队长
                    </button>
                  )}
                  {inParty && (
                    <button className="btn-mini btn-danger" onClick={(e) => { e.stopPropagation(); toggle(c.id); }}>
                      移出
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {hint && <p className="warn">{hint}</p>}
          <p className="muted small">
            换队长点「设为队长」（未入队的成员会直接入队并接任队长）；队长也可「移出」，移出后由编队内下一位自动接任。
            通关后共享币池的哈哈币按人数平分给各成员（余数归队长），材料一人一份进入各成员独有仓库。
          </p>
        </div>

        <div className="card">
          <h3>当前编队（{party.memberIds.length}/{dungeon.maxParty}）</h3>
          <ol className="party-order">
            {members.map((m, i) => (
              <li key={m.id}>
                <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={JOB_DEFS[m.job].name} />
                <b>{m.name}</b>
                <span className="muted small">
                  {JOB_DEFS[m.job].name} · Lv.{m.level}
                  {isLeader(m.id) ? ' · 队长' : ` · ${i + 1}号位`} · 随身 💰{m.coins}
                </span>
              </li>
            ))}
          </ol>

          <div className="party-purse">
            进本共享币池：<b>💰 {pooled} {COIN_NAME}</b>
            <span className="muted small">（每次副本携带0哈哈币进入；成员随身币将存入仓库）</span>
          </div>

          {/* 20级队长可携带「终局联系」带入副本（仅新手村） */}
          {endgameRelic && dungeon.id === MAP_DUNGEON && (members.find((m) => isLeader(m.id))?.level ?? 0) >= 20 && (
            <div>
              <h3>携带遗物（队长 Lv.20 解锁）</h3>
              <div className="stash-list">
                <button
                  className={`stash-chip ${!starterRelic ? 'card-selected' : ''}`}
                  onClick={() => setStarterRelic(undefined)}
                >不携带</button>
                <button
                  className={`stash-chip ${starterRelic === endgameRelic.id ? 'card-selected' : ''}`}
                  style={{ borderColor: RARITY_COLORS[endgameRelic.rarity] }}
                  onClick={() => setStarterRelic(endgameRelic.id)}
                  title={endgameRelic.desc}
                >
                  <Sprite className="stash-icon" src={itemIcon('material', endgameRelic.icon)} alt={endgameRelic.name} />
                  {endgameRelic.name}
                </button>
              </div>
              {starterRelic === endgameRelic.id && (
                <p className="muted small">{endgameRelic.desc}</p>
              )}
            </div>
          )}

          <h3>副本关卡</h3>
          <div className="muted small">该副本已配置 {stageCount} 个关卡（在关卡库创建）。</div>

          {error && <p className="warn">{error}</p>}
          {launchError && <p className="warn">{launchError}</p>}
          {savedHint && !error && !launchError && <p className="muted small">编队已保存。</p>}
          <div className="modal-actions">
            <button className="btn" onClick={persist} disabled={!!error}>保存编队</button>
            {(dungeon.id === MAP_DUNGEON || dungeon.id === 'preWallCalamity') ? (
              <button className="btn primary" onClick={launch} disabled={!!error}>
                开始探索
              </button>
            ) : (
              <button className="btn primary" disabled title="该副本将在后续版本开放">
                开始探索（即将推出）
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
