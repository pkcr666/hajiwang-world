import { describe, expect, it } from 'vitest';
import type { Rng } from '../../types';
import { makeCombatant } from '../damage';
import { rollOrder } from '../order';

// 按队列依次返回固定值，忽略入参边界
class SeqRng implements Rng {
  constructor(private q: number[]) {}
  int(): number {
    const v = this.q.shift();
    if (v === undefined) throw new Error('SeqRng 队列耗尽');
    return v;
  }
}

const mk = (uid: string, spdMin: number, spdMax: number, alive = true) =>
  makeCombatant({
    uid, name: uid,
    stats: { hp: 50, mp: 0, atk: 10, def: 0, mres: 0, spdMin, spdMax },
    alive,
  });

describe('rollOrder', () => {
  it('速度点高者优先', () => {
    const fast = mk('fast', 2, 5);
    const slow = mk('slow', 1, 1);
    // fast: roll5/tie1，slow: roll1/tie1，其余为最终随机
    const order = rollOrder([fast, slow], new SeqRng([5, 1, 1, 1, 10, 1]));
    expect(order).toEqual(['fast', 'slow']);
    expect(fast.roll).toBe(5);
  });

  it('速度点相同时，1-1000 同速判定值高者优先', () => {
    const a = mk('a', 3, 3);
    const b = mk('b', 3, 3);
    // 顺序按入参：a roll3 tie900，b roll3 tie100
    const order = rollOrder([a, b], new SeqRng([3, 900, 3, 100, 5, 6]));
    expect(order).toEqual(['a', 'b']);
  });

  it('同速判定低者也可凭高判定抢到先手（反向）', () => {
    const a = mk('a', 3, 3);
    const b = mk('b', 3, 3);
    const order = rollOrder([a, b], new SeqRng([3, 100, 3, 900, 5, 6]));
    expect(order).toEqual(['b', 'a']);
  });

  it('死亡单位不进入顺位', () => {
    const dead = mk('dead', 9, 9, false);
    const live = mk('live', 1, 1);
    const order = rollOrder([dead, live], new SeqRng([1, 1, 2, 3]));
    expect(order).toEqual(['live']);
  });
});
