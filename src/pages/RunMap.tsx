import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MapNode, MapNodeKind, MonsterUnit, SaveData, StageDef } from '../types';
import { mathRng } from '../types';
import { enemyMapOf, itemMapOf } from '../data/content';
import { DUNGEONS } from '../data/dungeons';
import { partyEntries, deployedMemberIds } from '../engine/party';
import {
  availableNodes, currentMap, currentNodeId, enterSublayer, openTorchLink, plagueLetterHpDown, resolveNode, torchEdgeKey,
  calcCrisisRunScore, calcCrisisStageScore,
} from '../engine/run';
import { buildAceCombatant, buildAllyCombatant } from '../engine/unit';
import {
  abortRun, persistRun, updateCharacterInventory,
} from '../save/storage';
import { SUBLAYER_DEFAULT_NAME } from '../engine/mapgen';
import { COIN_NAME } from '../engine/drops';
import { CRISIS_TERMS, type CrisisTerm } from '../data/crisisContract';
import { Modal } from '../components/Modal';
import { Sprite } from '../components/Sprite';
import { JOB_IMAGES } from '../assets/config';
import { JOB_DEFS } from '../data/jobs';
import { RELIC_MAP } from '../data/relics';
import { RunBag } from './RunBag';

const COL_W = 168;
const ROW_H = 132;
const PAD_X = 64;
const PAD_Y = 56;
const NODE_W = 96;
const NODE_H = 56;

const NODE_LABEL: Record<MapNodeKind, string> = {
  combat: '作战',
  encounter: '不期而遇',
  merchant: '诡异行商',
  rest: '安全角落',
  trade: '失与得',
  visitor: '异界来客',
  boss: 'BOSS',
  fate: '命运',
  skirmish: '狭路相逢',
  recruit: '王牌招募',
  plague: '瘟疫之源',
  altar: '祭坛',
  placeholder: '异次元裂缝',
};

const ACT_TITLE: Record<string, string> = {
  1: '一层 · 泰拉初探',
  2: '二层 · 矿洞初探',
  3: '三层 · 恐惧的凝视',
  4: '四层 · 沉沦之海',
  5: '五层 · 墓园',
  6: '六层 · 痛苦之村',
  7: '七层 · 终焉之地',
  sub: '子层',
};

const PLACEHOLDER_DESC: Record<string, string> = {
  encounter: '前路有什么在等待……事件玩法将在后续版本开放，本次探索可直接通过。',
  placeholder: '异次元裂缝微微震颤，似乎连接着另一个维度……特殊商店将在后续版本开放，本次可直接通过。',
};

interface PendingNode {
  kind: 'placeholder' | 'visitor' | 'combat' | 'plague';
  node: MapNode;
}

export function RunMap({ save, onChange, onBattle, onEncounter, onExit, onLoot, onLab, onMerchant, onRest, onTrade, onFate, onSkirmish, onRecruit, onAltar, onPlagueBattle }: {
  save: SaveData;
  onChange: (s: SaveData) => void;
  onBattle: (nodeId: string) => void;
  onEncounter?: (nodeId: string) => void;
  onExit: () => void;
  onLoot?: () => void;
  onLab?: () => void;
  onMerchant?: (nodeId: string) => void;
  onRest?: (nodeId: string) => void;
  onTrade?: (nodeId: string) => void;
  onFate?: (nodeId: string) => void;
  onSkirmish?: (nodeId: string) => void;
  onRecruit?: (nodeId: string) => void;
  onAltar?: (nodeId: string) => void;
  onPlagueBattle?: (nodeId: string, stageId: string, phase: 'first' | 'second') => void;
}) {
  const run = save.activeRun!;
  const stages = save.customStages;
  const itemMap = useMemo(() => itemMapOf(save), [save]);
  const monsterMap = useMemo(() => enemyMapOf(save), [save]);
  const members = useMemo(() => partyEntries(run.party, save.characters), [run.party, save.characters]);
  const deployedSet = useMemo(() => new Set(deployedMemberIds(run.party)), [run.party]);

  const map = currentMap(run);
  const reachable = useMemo(
    () => new Set(availableNodes(run).map((n) => n.id)),
    [run],
  );
  const currentId = currentNodeId(run);

  const [pending, setPending] = useState<PendingNode | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [mapScale, setMapScale] = useState(1);
  // 危机合约「得偿所愿」：首次进入时自选一件 10 级藏品（isCrisis 在下方定义，此处直接判断）
  const [wishOpen, setWishOpen] = useState(
    run.dungeonId === 'crisisContract' && !!run.crisis && !run.crisis!.wishGranted && run.cleared.length === 0,
  );

  const wrapRef = useRef<HTMLDivElement>(null);

  const width = map.cols * COL_W + PAD_X * 2 - (COL_W - NODE_W);
  const height = map.rows * ROW_H + PAD_Y * 2 - (ROW_H - NODE_H);
  const xOf = (n: MapNode) => PAD_X + n.col * COL_W;
  const yOf = (n: MapNode) => PAD_Y + n.row * ROW_H;
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));

  // 手机端：按容器宽度等比缩放整张地图，确保横屏内完整可见
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth;
      if (cw <= 0) return;
      const scale = Math.min(1, cw / width);
      setMapScale(scale);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  // 火把线点击热区（渲染为 HTML 按钮，避免 SVG pointer-events 继承问题）
  const torchSpots = map.edges.flatMap((e) => {
    if (!e.torch) return [];
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) return [];
    const key = torchEdgeKey(e.from, e.to);
    const lit = run.openedEdges.includes(key);
    const halfCleared = run.cleared.includes(e.from) !== run.cleared.includes(e.to);
    const clickable = !lit && halfCleared && run.torches >= 1;
    return [{
      key, e, lit, clickable,
      x: xOf(a) + NODE_W / 2,
      y: (yOf(a) + yOf(b)) / 2 + NODE_H / 2,
    }];
  });

  const commit = (next: typeof run) => {
    if (next.result === 'win') {
      onChange(persistRun(save, next));
      onLoot?.();
      return;
    }
    onChange(persistRun(save, next));
  };

  const passPlaceholder = (node: MapNode) => {
    commit(resolveNode(run, node.id));
    setPending(null);
  };

  const clickNode = (node: MapNode) => {
    // 瘟疫之源：已获求救信后直接通过；已探索节点可再次进入触发第二战
    if (node.kind === 'plague') {
      if (run.relics.includes('rl_pain_village_letter')) {
        passPlaceholder(node);
        return;
      }
      if (reachable.has(node.id) || node.id === currentId) {
        setPending({ kind: 'plague', node });
        return;
      }
      return;
    }
    if (!reachable.has(node.id)) return;
    if (node.kind === 'combat' || node.kind === 'boss') {
      setPending({ kind: 'combat', node });
      return;
    }
    if (node.kind === 'encounter') { onEncounter?.(node.id); return; }
    if (node.kind === 'merchant') { onMerchant?.(node.id); return; }
    if (node.kind === 'rest') { onRest?.(node.id); return; }
    if (node.kind === 'trade') { onTrade?.(node.id); return; }
    if (node.kind === 'fate') { onFate?.(node.id); return; }
    if (node.kind === 'skirmish') { onSkirmish?.(node.id); return; }
    if (node.kind === 'recruit') { onRecruit?.(node.id); return; }
    if (node.kind === 'altar') { onAltar?.(node.id); return; }
    if (node.kind === 'visitor') {
      setPending({ kind: 'visitor', node });
      return;
    }
    setPending({ kind: 'placeholder', node });
  };

  const enterSub = (node: MapNode) => {
    if (run.torches < 1) return;
    onChange(persistRun(save, enterSublayer(run, node.id, node.note ?? SUBLAYER_DEFAULT_NAME, stages, mathRng)));
    setPending(null);
  };
  const leaveVisitor = (node: MapNode) => {
    commit(resolveNode(run, node.id));
    setPending(null);
  };

  // 瘟疫之源首战：消耗1火把，随机遭遇当层紧急作战
  const explorePlague = (node: MapNode) => {
    if (run.torches < 1) return;
    const floor = typeof run.act === 'number' ? run.act : 1;
    const urgentStages = stages.filter(
      (s) => s.dungeon === run.dungeonId && s.floor === floor && s.difficulty === 'urgent' && s.appear === 'regular',
    );
    const stage = urgentStages[mathRng.int(0, urgentStages.length - 1)];
    if (!stage) return;
    const next = structuredClone(run);
    next.torches -= 1;
    onChange(persistRun(save, next));
    setPending(null);
    onPlagueBattle?.(node.id, stage.id, 'first');
  };

  // 瘟疫之源离开：通过该节点但不完成对应阶段（不触发战斗、不改变阶段解锁状态）
  const leavePlague = (node: MapNode) => {
    commit(resolveNode(run, node.id));
    setPending(null);
  };

  // 点亮一条火把线：消耗1火把，两端互通
  const lightTorch = (from: string, to: string) => {
    onChange(persistRun(save, openTorchLink(run, from, to)));
  };

  const dungeon = DUNGEONS.find((d) => d.id === run.dungeonId);
  const subTitle = map.act === 'sub' ? `子层 · ${run.sublayerName ?? SUBLAYER_DEFAULT_NAME}` : ACT_TITLE[map.act];
  const isCrisis = run.dungeonId === 'crisisContract' && !!run.crisis;
  const pageTitle = isCrisis ? '危机合约S1' : `${dungeon?.name ?? '副本'} · ${subTitle}`;

  // 危机合约：当前得分 + 下一关得分 + 已选词条
  const crisisScoreInfo = useMemo(() => {
    if (!isCrisis || !run.crisis) return null;
    const currentScore = calcCrisisRunScore(run);
    // 找下一个未通关的作战关卡
    const nextCombat = map.nodes
      .filter((n) => (n.kind === 'combat' || n.kind === 'boss') && n.stageId && !run.cleared.includes(n.id))
      .sort((a, b) => a.col - b.col || a.row - b.row)[0];
    const nextScore = nextCombat?.stageId
      ? calcCrisisStageScore(nextCombat.stageId, run.crisis.termIds)
      : 0;
    const nextName = nextCombat?.stageId ?? null;
    const selectedTerms = run.crisis.termIds
      .map((id) => CRISIS_TERMS.find((t) => t.id === id))
      .filter((t): t is CrisisTerm => !!t);
    return { currentScore, nextScore, nextStageId: nextName, selectedTerms };
  }, [isCrisis, run, map.nodes]);
  const memberMax = (id: string, i: number) => {
    const e = members.find((m) => m.id === id);
    if (!e) return { hp: 0, mp: 0 };
    if (e.kind === 'ace') {
      const ab = buildAceCombatant(e.data, i);
      return { hp: ab.maxHp, mp: ab.maxMp };
    }
    const cb = buildAllyCombatant(e.data, itemMap, i, { relics: run.relics, relicStacks: run.relicStacks, killBook: run.killBook, maxHpPctDown: plagueLetterHpDown(run) });
    return { hp: cb.maxHp, mp: cb.maxMp };
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>{pageTitle}</h2>
        <div className="page-head-actions">
          {!isCrisis && onLab && <button className="btn" onClick={onLab}>🧪 遗物测试</button>}
          <button className="btn btn-danger" onClick={() => setConfirmAbandon(true)}>撤离</button>
        </div>
      </div>

      {!isCrisis && (
        <div className="run-status card">
          <div className="run-party">
            {members.map((e, i) => {
              const cur = run.hpMp[e.id] ?? { hp: 0, mp: 0 };
              const max = memberMax(e.id, i);
              const isAce = e.kind === 'ace';
              const ace = isAce ? e.data : null;
              return (
                <div key={e.id} className="run-member">
                  <div className="run-member-avatar">
                    {isAce ? (
                      <span className="head-job-icon ace-avatar" style={{ color: ace?.rarity === 'epic' ? '#c084fc' : '#67e8f9' }}>★</span>
                    ) : (
                      <Sprite className="head-job-icon" src={JOB_IMAGES[e.data.job]} alt={JOB_DEFS[e.data.job].name} />
                    )}
                    {run.labUsed && <span className="hack-badge">外挂</span>}
                  </div>
                  <b>{e.name}{e.id === run.party.leaderId && <span className="party-badge">队长</span>}{deployedSet.has(e.id) ? <span className="party-badge" style={{ background: '#4ade80', color: '#064e3b' }}>上场</span> : <span className="muted small" style={{ fontSize: '0.7em' }}>替补</span>}{isAce && <span className="tag" style={{ color: ace?.rarity === 'epic' ? '#c084fc' : '#67e8f9', fontSize: '0.7em' }}>{ace?.rarity === 'epic' ? '王牌' : '王牌'}</span>}</b>
                  <span className="muted small">
                    HP {Math.min(cur.hp, max.hp)}/{max.hp} · MP {cur.mp}/{max.mp}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="run-purse">
            共享币池 💰 {run.coins} {COIN_NAME} · 火把 🔥 {run.torches}
            <button className="btn-mini btn runbag-open" onClick={() => setBagOpen(true)}>🎒 队伍背包</button>
          </div>
        </div>
      )}

      {crisisScoreInfo && (
        <div className="crisis-score-bar card">
          <span className="crisis-score-current">当前得分：<b>{crisisScoreInfo.currentScore}</b></span>
          {crisisScoreInfo.nextStageId ? (
            <span className="crisis-score-next">下一关可得：<b>+{crisisScoreInfo.nextScore}</b></span>
          ) : (
            <span className="crisis-score-next muted">所有关卡已通关</span>
          )}
          <button className="btn-mini btn runbag-open" onClick={() => setBagOpen(true)}>🎒 队伍背包</button>
          <div className="crisis-terms-row">
            <span className="muted small">已选词条：</span>
            {crisisScoreInfo.selectedTerms.length === 0 ? (
              <span className="muted small">无</span>
            ) : (
              crisisScoreInfo.selectedTerms.map((t) => (
                <span key={t.id} className="term-chip" title={t.desc}>
                  {t.name} <span className="term-chip-score">+{t.score}</span>
                </span>
              ))
            )}
          </div>
        </div>
      )}

      <div
        className="map-wrap card"
        ref={wrapRef}
        style={{ ['--map-scale' as string]: mapScale }}
      >
        <div
          className="map-scale-wrap"
          style={{ height: height * mapScale }}
        >
          <div className="map-canvas" style={{ width, height }}>
          <svg className="map-lines" width={width} height={height}>
            {map.edges.map((e) => {
              const a = nodeById.get(e.from);
              const b = nodeById.get(e.to);
              if (!a || !b) return null;
              const opened = run.cleared.includes(a.id);
              // 火把线：同列上下相邻节点之间的竖线
              if (e.torch) {
                const key = torchEdgeKey(e.from, e.to);
                const lit = run.openedEdges.includes(key);
                // 可点亮：未点亮 + 恰好一端已清理 + 有火把
                const halfCleared = run.cleared.includes(e.from) !== run.cleared.includes(e.to);
                const clickable = !lit && halfCleared && run.torches >= 1;
                const x = xOf(a) + NODE_W / 2;
                return (
                  <line
                    key={`torch_${key}`}
                    x1={x} y1={yOf(a) + NODE_H / 2}
                    x2={x} y2={yOf(b) + NODE_H / 2}
                    className={`map-edge map-edge-torch ${lit ? 'on' : clickable ? 'ready' : ''}`}
                  />
                );
              }
              return (
                <line
                  key={`${e.from}>${e.to}`}
                  x1={xOf(a) + NODE_W / 2}
                  y1={yOf(a) + NODE_H / 2}
                  x2={xOf(b) + NODE_W / 2}
                  y2={yOf(b) + NODE_H / 2}
                  className={opened ? 'map-edge on' : 'map-edge'}
                />
              );
            })}
          </svg>

          {map.nodes.map((n) => {
            const cleared = run.cleared.includes(n.id);
            const open = reachable.has(n.id);
            const cls = [
              'map-node',
              `map-node-${n.kind}`,
              n.urgent ? 'is-urgent' : '',
              cleared ? 'is-cleared' : open ? 'is-open' : 'is-locked',
              n.id === currentId ? 'is-current' : '',
            ].filter(Boolean).join(' ');
            const title = n.kind === 'boss'
              ? (bossStageName(stages, monsterMap, n.stageId) ?? 'BOSS')
              : n.kind === 'visitor'
                ? (n.note ?? NODE_LABEL.visitor)
                : NODE_LABEL[n.kind];
            return (
              <button
                key={n.id}
                className={cls}
                style={{ left: xOf(n), top: yOf(n), width: NODE_W, height: NODE_H }}
                disabled={!open && !(n.kind === 'plague' && n.id === currentId && !run.relics.includes('rl_pain_village_letter'))}
                onClick={() => clickNode(n)}
                title={title}
              >
                <span className="map-node-tag">
                  {n.kind === 'combat' ? (n.urgent ? '紧急' : '作战') : title}
                </span>
                {n.hidden && <span className="map-node-hidden-star" title="迷藏：完成后获得遗物">★</span>}
                {cleared && <span className="map-node-done">✓</span>}
              </button>
            );
          })}

          {torchSpots.map((s) => (
            <button
              key={`torchbtn_${s.key}`}
              type="button"
              className={`torch-hit ${s.lit ? 'on' : s.clickable ? 'ready' : ''}`}
              style={{ left: s.x - 13, top: s.y - 13 }}
              disabled={!s.clickable}
              title={s.lit ? '火把线已点亮' : s.clickable ? '消耗1根火把点亮此路' : '需先清理一端且持有火把'}
              onClick={() => lightTorch(s.e.from, s.e.to)}
            >
              🔥
            </button>
          ))}
        </div>
        </div>
      </div>

      {!isCrisis && (
        <p className="muted small map-hint">
          框选的节点是当前所在地：只能从它往前或上下移动，不能回头。🔥 火把线需消耗 1 根火把点亮后方可上下通行；
          作战胜利按 普通25%/紧急50%/BOSS100% 掉落火把。生命与魔力跨战斗继承，战斗结束后 BUFF/DEBUFF 自动清空。
        </p>
      )}

      {pending?.kind === 'placeholder' && (
        <Modal title={NODE_LABEL[pending.node.kind]} onClose={() => setPending(null)}>
          <p>{PLACEHOLDER_DESC[pending.node.kind]}</p>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => passPlaceholder(pending.node)}>通过</button>
          </div>
        </Modal>
      )}

      {run.hiddenRelicGain && (() => {
        const relic = RELIC_MAP[run.hiddenRelicGain];
        const close = () => {
          const next = structuredClone(run);
          delete next.hiddenRelicGain;
          onChange(persistRun(save, next));
        };
        return (
          <Modal title="迷藏 · 发现遗物" onClose={close}>
            <p>你在隐藏的角落里发现了一件遗物：</p>
            {relic ? (
              <div className="relic-row">
                <b className="relic-name" style={{ color: 'inherit' }}>{relic.name}</b>
                <span className="relic-desc">{relic.desc}</span>
              </div>
            ) : (
              <p>{run.hiddenRelicGain}</p>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={close}>收下</button>
            </div>
          </Modal>
        );
      })()}

      {pending?.kind === 'visitor' && (
        <Modal title={`异界来客 · ${pending.node.note ?? ''}`} onClose={() => setPending(null)}>
          <p>一个穿着异乡装束的菜鸟冒险者拦住了你的去路，他说知道一条通往「{pending.node.note ?? SUBLAYER_DEFAULT_NAME}」子层的近路。</p>
          <p className="muted small">
            子层为单线 5 连节点：紧急作战 → 失与得 → 诡异行商 → BOSS → 安全的角落。全部完成后回到当前地图。
          </p>
          <p className="muted small">进入子层需消耗 1 根火把（当前 🔥 {run.torches}）。</p>
          <div className="modal-actions">
            <button className="btn primary" disabled={run.torches < 1} onClick={() => enterSub(pending.node)}>
              进入子层（🔥×1）
            </button>
            <button className="btn" onClick={() => leaveVisitor(pending.node)}>离开</button>
          </div>
          {run.torches < 1 && <p className="warn">火把不足，无法进入子层。</p>}
        </Modal>
      )}

      {pending?.kind === 'plague' && (() => {
        // 第二战由全局标记决定：首战胜利后解锁，下次进入任一瘟疫节点时触发
        const phase2 = !!run.plaguePhase2Unlocked;
        return (
          <Modal title="瘟疫之源" onClose={() => setPending(null)}>
            {!phase2 ? (
              <>
                <p>空气中弥漫着刺鼻的瘟疫气息，一团扭曲的脓水正在蠕动。你隐约听见深处传来求救声……</p>
                <p className="muted small">消耗 1 根火把深入探索，将遭遇一场当层紧急作战。也可直接离开通过该节点（不进入战斗）。</p>
                <p className="muted small">当前 🔥 {run.torches}。</p>
                <div className="modal-actions">
                  <button className="btn primary" disabled={run.torches < 1} onClick={() => explorePlague(pending.node)}>
                    消耗火把探索（🔥×1）
                  </button>
                  <button className="btn" onClick={() => leavePlague(pending.node)}>离开（通过节点）</button>
                </div>
                {run.torches < 1 && <p className="warn">火把不足，无法探索。</p>}
              </>
            ) : (
              <>
                <p>脓水深处传来嘶哑的哀求：「救救我……杀了我……」一个被瘟疫寄生的身影向你扑来。</p>
                <p className="muted small">战胜后可获得遗物「痛苦之村的求救信」（史诗级：解锁第6层，每走一个节点最大生命-2%）。也可直接离开通过该节点。</p>
                <div className="modal-actions">
                  <button className="btn primary" onClick={() => {
                    const stage = stages.find((s) => s.name === '救救我，杀了我');
                    if (stage) onPlagueBattle?.(pending.node.id, stage.id, 'second');
                    setPending(null);
                  }}>应战</button>
                  <button className="btn" onClick={() => leavePlague(pending.node)}>离开（通过节点）</button>
                </div>
              </>
            )}
          </Modal>
        );
      })()}

      {pending?.kind === 'combat' && (
        <StageInfoModal
          save={save}
          node={pending.node}
          onClose={() => setPending(null)}
          onFight={() => {
            const n = pending.node;
            setPending(null);
            onBattle(n.id);
          }}
        />
      )}

      {bagOpen && (
        <RunBag save={save} run={run} onChange={onChange} onClose={() => setBagOpen(false)} />
      )}

      {confirmAbandon && (
        <Modal title="撤离副本" onClose={() => setConfirmAbandon(false)}>
          <p>确认撤离？本次探索立即结束，<b>背包内的藏品、药水、材料与哈哈币将全部清除</b>，已穿戴藏品与个人仓库保留。</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmAbandon(false)}>继续探索</button>
            <button
              className="btn btn-danger"
              onClick={() => { onChange(abortRun(save)); onExit(); }}
            >
              确认撤离
            </button>
          </div>
        </Modal>
      )}

      {/* 危机合约「得偿所愿」：自选一件 10 级藏品 */}
      {wishOpen && (
        <Modal title="得偿所愿" onClose={() => {
          // 允许跳过：直接标记已领取，不选择任何藏品
          const next = persistRun(save, {
            ...run,
            crisis: { ...run.crisis!, wishGranted: true },
          });
          onChange(next);
          setWishOpen(false);
        }} wide>
          <p className="muted small" style={{ marginTop: 0 }}>
            危机合约首战在即，你可自选一件 <b>10 级藏品</b>放入队长藏品栏（可在背包界面穿戴）。也可关闭弹窗直接放弃。
          </p>
          <div className="relic-grid" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {Array.from(itemMap.values())
              .filter((it) => ['weapon', 'helmet', 'armor', 'boots', 'accessory'].includes(it.slot) && (it.level ?? 0) === 10)
              .map((it) => (
                <button
                  key={it.id}
                  className="relic-card clickable"
                  style={{ textAlign: 'left' }}
                  onClick={() => {
                    const leaderId = run.party.leaderId;
                    const leader = save.characters.find((c) => c?.id === leaderId);
                    let s2 = save;
                    if (leader) {
                      // 放入队长藏品栏（inventory），而非战斗道具栏（bag），由玩家自行穿戴
                      const inv = [...(leader.inventory ?? []), it.id];
                      s2 = updateCharacterInventory(s2, leaderId, inv);
                    }
                    // 标记已领取，持久化到 run（在角色更新基础上叠加）
                    const next = persistRun(s2, {
                      ...run,
                      crisis: { ...run.crisis!, wishGranted: true },
                    });
                    onChange(next);
                    setWishOpen(false);
                  }}
                >
                  <div className="relic-name">{it.name} <span className={`rarity-${it.rarity}`}>[{it.rarity}]</span></div>
                  <div className="relic-desc muted small">{it.desc}</div>
                </button>
              ))}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => {
              const next = persistRun(save, {
                ...run,
                crisis: { ...run.crisis!, wishGranted: true },
              });
              onChange(next);
              setWishOpen(false);
            }}>跳过（不选择）</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function monsterName(m: Map<string, MonsterUnit>, id?: string): string | null {
  if (!id) return null;
  return m.get(id)?.name ?? id;
}

// BOSS 节点标题：从关卡取首只怪的名字（BOSS 关由玩家创建）
function bossStageName(
  stages: { id: string; name: string; monsters: { monsterId: string; count: number }[] }[],
  monsterMap: Map<string, MonsterUnit>,
  stageId?: string,
): string | null {
  const st = stageId ? stages.find((s) => s.id === stageId) : undefined;
  const first = st?.monsters[0]?.monsterId;
  if (!first) return null;
  return `${monsterName(monsterMap, first) ?? first}`;
}

// 提取怪物的特殊能力描述列表（无则返回空数组）
function monsterSpecialAbilities(m: MonsterUnit): string[] {
  const out: string[] = [];
  if (m.boss) out.push('BOSS');
  if (m.elite) out.push('精英');
  for (const sk of m.skills ?? []) {
    const d = sk.desc ?? sk.name;
    if (d) out.push(d);
  }
  if (m.summon) out.push(`召唤：血量跌破 ${m.summon.thresholds.map((t) => `${Math.round(t * 100)}%`).join('/')} 时召唤 ${m.summon.monsterId}`);
  if (m.enrage) out.push(`狂暴（血量≤${Math.round((m.enrage.hpBelow ?? 0.5) * 100)}%）`);
  if (m.healTurnEnd) out.push(`每回合末恢复 ${m.healTurnEnd} 生命`);
  if (m.dmgCapPerTurn) out.push(`每回合受到伤害上限 ${m.dmgCapPerTurn}`);
  if (m.atkUpIfNotHitLastTurn) out.push(`上回合未被攻击则攻击力+${m.atkUpIfNotHitLastTurn}`);
  if (m.debuffOnHit) out.push(`每被攻击一次攻防法抗-${m.debuffOnHit.atk}/${m.debuffOnHit.def}/${m.debuffOnHit.mres}（最多${m.debuffOnHit.maxTimes}次）`);
  if (m.fleeOnTurn) out.push(`第 ${m.fleeOnTurn} 回合末逃离战场`);
  if (m.turnStartBurn) out.push(`每回合开始使敌方烧伤（强度${m.turnStartBurn.intensity}，${m.turnStartBurn.stacks}层）`);
  if ((m.basicAttackBuffs ?? []).length > 0) out.push('普攻命中附加 BUFF');
  return out;
}

function StageInfoModal({ save, node, onClose, onFight }: {
  save: SaveData;
  node: MapNode;
  onClose: () => void;
  onFight: () => void;
}) {
  const stage: StageDef | undefined = node.stageId
    ? save.customStages.find((s) => s.id === node.stageId)
    : undefined;
  const monsterMap = enemyMapOf(save);
  const diffLabel = node.kind === 'boss' ? 'BOSS' : (node.urgent ? '紧急作战' : '作战');
  const title = stage ? `${diffLabel} · ${stage.name}` : diffLabel;

  return (
    <Modal title={title} onClose={onClose} wide>
      {stage?.desc && <p className="muted small">{stage.desc}</p>}
      {stage && stage.monsters.length > 0 ? (
        <div className="stage-monsters">
          {stage.monsters.map((sm, idx) => {
            const mu = monsterMap.get(sm.monsterId);
            if (!mu) return null;
            const st = mu.stats;
            const abilities = monsterSpecialAbilities(mu);
            return (
              <div key={`${sm.monsterId}-${idx}`} className="stage-monster card">
                <div className="stage-monster-head">
                  <b>{mu.name}</b>
                  {sm.count > 1 && <span className="muted small">×{sm.count}</span>}
                </div>
                <div className="stage-monster-stats muted small">
                  HP {st.hp} · MP {st.mp} · 攻 {st.atk} · 防 {st.def} · 法抗 {st.mres}% · 速度 {st.spdMin}-{st.spdMax}
                </div>
                <div className="stage-monster-abilities">
                  <span className="muted small">特殊能力：</span>
                  {abilities.length === 0 ? (
                    <span className="muted small">无</span>
                  ) : (
                    <ul className="ability-list">
                      {abilities.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted small">未找到关卡数据。</p>
      )}
      {stage && stage.mechanics.length > 0 && (
        <div className="stage-mechanics">
          <b>关卡机制：</b>
          <ul className="ability-list">
            {stage.mechanics.map((me) => (
              <li key={me.id}>{me.desc}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>返回</button>
        <button className="btn primary" onClick={onFight}>进入战斗</button>
      </div>
    </Modal>
  );
}
