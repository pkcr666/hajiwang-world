import type { BattleState } from '../../types';
import { byUid } from '../../engine/battle';
import { slotOf } from '../../engine/order';

const SLOT_LABEL: Record<string, string> = {
  potian: '破天',
  mingwang: '冥王',
};

export function OrderBar({ state }: { state: BattleState }) {
  return (
    <div className="order-bar">
      <span className="order-label">回合{state.turn}</span>
      {state.order.map((uid, i) => {
        const u = byUid(state, uid);
        const slot = slotOf(uid);
        const slotTag = slot ? `·${SLOT_LABEL[slot]}` : '';
        const roll = state.orderRolls?.[uid] ?? u.roll;
        return (
          <span
            key={`${state.turn}-${uid}`}
            title={`本回合速度掷点 ${roll}（基础 ${u.stats.spdMin}-${u.stats.spdMax}）· 同速判定 ${u.tieBreak}`}
            className={`order-chip ${i === state.cursor ? 'order-current' : ''} ${!u.alive ? 'order-dead' : ''} ${u.side === 'ally' ? 'order-ally' : 'order-enemy'}`}
          >
            {u.name.replace(/^遗迹巨像·/, '')}{slotTag}
            <b className="order-roll">{roll}</b>
          </span>
        );
      })}
    </div>
  );
}
