import type { SaveData } from '../types';
import { JOB_DEFS } from '../data/jobs';
import { JOB_IMAGES } from '../assets/config';
import { partyMembers } from '../engine/party';
import { COIN_NAME } from '../engine/drops';
import { calcCrisisRunScore } from '../engine/run';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';

// 团灭/失败结算提示：与 abortRun 同口径——本局获得的币/藏品/药品被清除，材料进共享仓库
export function RunAbort({ save, before, onClose }: {
  save: SaveData; // 结算后
  before: SaveData; // 结算前快照（含 activeRun）
  onClose: () => void;
}) {
  const run = before.activeRun;
  // 空数据兜底：activeRun / party 缺失（旧档或已结算）时也不渲染空白页，给出可退出的提示卡片
  if (!run || !run.party) {
    return (
      <Modal title="本次探索已结束" onClose={onClose}>
        <p className="muted small">
          本局数据暂不可用（可能已结算），队伍已回到主界面。
        </p>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>返回主界面</button>
        </div>
      </Modal>
    );
  }
  const members = partyMembers(run.party, before.characters);
  const coinBack = (id: string) => {
    const a = save.characters.find((c) => c?.id === id)?.coins ?? 0;
    const b = before.characters.find((c) => c?.id === id)?.coins ?? 0;
    return a - b;
  };
  const itemBack = (id: string) => {
    const a = save.characters.find((c) => c?.id === id)?.inventory?.length ?? 0;
    const b = before.characters.find((c) => c?.id === id)?.inventory?.length ?? 0;
    return a - b;
  };
  const matGain = () => {
    const total = (g: { count: number }[]) => g.reduce((s, x) => s + x.count, 0);
    return total(save.materials ?? []) - total(before.materials ?? []);
  };
  const isCrisis = run.dungeonId === 'crisisContract' && !!run.crisis;
  const crisisScore = isCrisis ? calcCrisisRunScore(run) : 0;

  return (
    <Modal title="本次探索结束 · 战果已清除" onClose={onClose}>
      {isCrisis && (
        <div className="crisis-score-card">
          <div className="crisis-score-label">危机合约 S1 得分</div>
          <div className="crisis-score-value">{crisisScore}</div>
          <div className="muted small">（按已通关关卡计算，已记入队员最高分）</div>
        </div>
      )}
      <p className="muted small">
        队伍在本次探索中失利（或主动撤离），探索立即结束。<b>本局获得的哈哈币、藏品与药品已全部清除</b>，
        角色回到进本前的状态；途中材料仍进入共享仓库。遗物仅本次副本生效，已随之消失。
      </p>
      <div className="abort-list">
        {members.map((m) => (
          <div className="abort-row" key={m.id}>
            <Sprite className="head-job-icon" src={JOB_IMAGES[m.job]} alt={m.name} />
            <b>{m.name}</b>
            <span className="muted small">{JOB_DEFS[m.job].name}</span>
            <span className="abort-gain">
              {coinBack(m.id) > 0 ? `+${coinBack(m.id)} ${COIN_NAME}` : `${coinBack(m.id)} ${COIN_NAME}`}
            </span>
            <span className="abort-gain">藏品 {itemBack(m.id)} 件</span>
          </div>
        ))}
        <p className="abort-mats">途中材料 +{matGain()} 组 → 已进入共享仓库</p>
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>知道了</button>
      </div>
    </Modal>
  );
}
