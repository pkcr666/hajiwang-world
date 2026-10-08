import { useMemo, useState } from 'react';
import type { Character, EventOption, EventReward, ExtraKey, Item, SaveData } from '../types';
import type { RecruitCandidate } from '../engine/nodes';
import { mathRng } from '../types';
import { eventMapOf } from '../data/events';
import { itemMapOf } from '../data/content';
import { RELIC_MAP, sumRelicSixStats } from '../data/relics';
import { ACE_UNIT_MAP } from '../data/aceUnits';
import { partyMembers } from '../engine/party';
import { applyEventOption, canAfford, type EventResult } from '../engine/events';
import { collectExtraBonus, equippedIds } from '../engine/stats';
import { recruitMember, rollAceCandidatesByRarity } from '../engine/nodes';
import { persistRun } from '../save/storage';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES } from '../assets/config';
import { Sprite } from '../components/Sprite';

// 该选项是否产出需要指定接收角色的奖励（藏品/附魔武器/宝箱开出的藏品）
const yieldsItem = (o: EventOption) => {
  const needsOwner = (r: EventReward) =>
    r.kind === 'item' || r.kind === 'randomItem' || r.kind === 'enchantedWeapon' ||
    (r.kind === 'relic' && RELIC_MAP[r.relicId]?.effect.kind === 'grantItem');
  return o.outcome.rewards.some(needsOwner) || (o.outcome.fail ?? []).some(needsOwner);
};

// 不期而遇事件页：左侧事件文本，右侧选项；判定结果在下方结果面板展示。
// 选择触发战斗的选项后立即进入战斗（cost 与奖励已落盘）。
// 物品类奖励的选项先弹出角色选择，确认接收者后物品入该角色背包。
export function RunEvent({ save, eventId, onChange, onBack, onBattle }: {
  save: SaveData;
  nodeId: string;
  eventId: string;
  onChange: (s: SaveData) => void;
  onBack: () => void;
  onBattle: (stageId: string) => void;
}) {
  const run = save.activeRun!;
  const event = eventMapOf(save)[eventId];
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const members = useMemo(() => partyMembers(run.party, save.characters), [run.party, save.characters]);
  const leader = members.find((c) => c.id === run.party.leaderId);
  const [result, setResult] = useState<EventResult | null>(null);
  // 等待玩家指定物品奖励接收角色的选项
  const [pendingPick, setPendingPick] = useState<EventOption | null>(null);
  // 重返家园：王牌招募候选
  const [recruitCandidates, setRecruitCandidates] = useState<RecruitCandidate[] | null>(null);

  // 六维判定基准值：角色六维 + 装备 extraBonus + 遗物六维（与安全角落的意志判定同源）
  const leaderStatOf = (key: string): number => {
    if (!leader) return 0;
    const k = key as ExtraKey;
    const equipped = equippedIds(leader.equip)
      .map((id) => itemMap.get(id))
      .filter((x): x is Item => !!x);
    return (leader.extra[k] ?? 0)
      + (collectExtraBonus(equipped)[k] ?? 0)
      + sumRelicSixStats(run.relics ?? [])[k];
  };

  const applyOption = (option: EventOption, owner?: string) => {
    if (!canAfford(option, run)) return;
    const res = applyEventOption({ save, run, option, rng: mathRng, items: itemMap, leaderStatOf, owner });
    onChange(persistRun(res.save, res.run));
    setPendingPick(null);
    if (res.battleStageId) {
      onBattle(res.battleStageId);
    } else if (res.recruitRarity) {
      // 重返家园：抽取指定稀有度王牌候选
      const cands = rollAceCandidatesByRarity(res.run, res.recruitRarity, 3, mathRng);
      setRecruitCandidates(cands);
    } else if (res.stay) {
      // 多步事件（事不过四）：停留事件，展示结果后返回选项
      setResult(res);
    } else {
      setResult(res);
    }
  };

  // 选择王牌候选并加入队伍
  const pickAce = (cand: RecruitCandidate) => {
    if (!recruitCandidates) return;
    const r2 = recruitMember(run, cand);
    onChange(persistRun(save, r2));
    setRecruitCandidates(null);
    onBack();
  };

  // 点击选项：含物品奖励 → 先选接收角色；否则直接结算
  const handleOption = (o: EventOption) => {
    if (yieldsItem(o)) setPendingPick(o);
    else applyOption(o);
  };

  const pickOwner = (c: Character) => {
    if (pendingPick) applyOption(pendingPick, c.id);
  };

  // 事件库缺失兜底：直接通过节点
  if (!event) {
    return (
      <div className="page">
        <div className="page-head">
          <h2>不期而遇</h2>
        </div>
        <div className="card">
          <p>这个事件暂时没有内容（事件库已更新），直接离开本节点。</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={onBack}>离开</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>不期而遇
          <span className="slot-level">事件 · {event.name}</span>
        </h2>
        <div className="page-head-actions">
          <button className="btn" onClick={onBack}>离开节点</button>
        </div>
      </div>

      <div className="card event-wrap">
        <div className="event-text">
          <h3 className="event-title">{event.name}</h3>
          <p className="event-story">{event.text}</p>
          <div className="event-meta muted small">
            {leader && (
              <span className="event-leader">
                <Sprite className="head-job-icon" src={JOB_IMAGES[leader.job]} alt={JOB_DEFS[leader.job].name} />
                {leader.name} · {JOB_DEFS[leader.job].name}
              </span>
            )}
            <span>火把 🔥 {run.torches}</span>
            <span>金币 💰 {run.coins}</span>
          </div>
        </div>

        <div className="event-options">
          {recruitCandidates ? (
            <div className="event-pick">
              <h4>王牌单位招募</h4>
              <p className="muted small">选择一名王牌单位加入你的队伍</p>
              <div className="event-pick-list">
                {recruitCandidates.map((c) => {
                  const ace = ACE_UNIT_MAP[c.id];
                  return (
                    <button key={c.id} className="event-pick-item" onClick={() => pickAce(c)}>
                      <span>{c.name}</span>
                      <span className="muted small">
                        {c.rarity === 'epic' ? '史诗' : '稀有'} · HP {c.stats.hp} ATK {c.stats.atk} DEF {c.stats.def}
                      </span>
                      {ace && ace.skills[0] && <span className="muted small">{ace.skills[0].name}</span>}
                    </button>
                  );
                })}
                {recruitCandidates.length === 0 && <p className="muted">没有可招募的王牌单位</p>}
              </div>
              <button className="btn" onClick={() => { setRecruitCandidates(null); onBack(); }}>放弃招募</button>
            </div>
          ) : pendingPick ? (
            <div className="event-pick">
              <h4>选择接收奖励的角色</h4>
              <p className="muted small">奖励藏品将放入所选角色的背包</p>
              <div className="event-pick-list">
                {members.map((c) => (
                  <button key={c.id} className="event-pick-item" onClick={() => pickOwner(c)}>
                    <Sprite className="head-job-icon" src={JOB_IMAGES[c.job]} alt={JOB_DEFS[c.job].name} />
                    <span>{c.name}</span>
                    <span className="muted small">{JOB_DEFS[c.job].name}</span>
                  </button>
                ))}
              </div>
              <button className="btn" onClick={() => setPendingPick(null)}>返回</button>
            </div>
          ) : result === null ? (
            event.options.map((o) => {
              const afford = canAfford(o, run);
              const cost = o.cost?.torch ? `🔥×${o.cost.torch}` : o.cost?.coins ? `💰×${o.cost.coins}` : null;
              return (
                <button
                  key={o.id}
                  className={`event-option ${afford ? '' : 'is-miss'}`}
                  disabled={!afford}
                  onClick={() => handleOption(o)}
                >
                  <span className="event-option-text">{o.text}</span>
                  {cost && <span className="event-option-cost">{cost}</span>}
                  {o.hint && <span className="event-option-hint">{o.hint}</span>}
                  {!afford && <span className="event-option-miss">资源不足</span>}
                </button>
              );
            })
          ) : (
            <div className="event-result">
              <h4>事件结果</h4>
              <ul className="event-result-list">
                {result.texts.map((t, i) => <li key={i}>{t}</li>)}
                {result.texts.length === 0 && <li className="muted">什么都没有发生……</li>}
              </ul>
              {result.stay ? (
                <button className="btn primary" onClick={() => setResult(null)}>继续</button>
              ) : (
                <button className="btn primary" onClick={onBack}>继续前行</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
