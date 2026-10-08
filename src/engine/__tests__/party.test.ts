import { describe, expect, it, beforeAll } from 'vitest';
import type { Character, Party, SaveData } from '../../types';
import {
  partyMembers, poolCoins, splitCoins, validateParty,
} from '../party';
import { settleRun } from '../../save/storage';

const mkChar = (id: string, coins: number): Character => ({
  id, name: id, job: 'cat', level: 10,
  extra: { str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 50 },
  equip: { weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null] },
  relics: [], inventory: [], bag: [], storage: [], coins, createdAt: 0,
});

const c1 = mkChar('c1', 100);
const c2 = mkChar('c2', 50);
const c3 = mkChar('c3', 0);
const chars: (Character | null)[] = [c1, c2, c3];

describe('poolCoins / splitCoins', () => {
  it('币池=成员存款之和', () => {
    expect(poolCoins([c1, c2, c3])).toBe(150);
    expect(poolCoins([])).toBe(0);
  });

  it('人均平分，余数归队长', () => {
    expect(splitCoins(100, 3)).toEqual({ each: 33, leaderExtra: 1 });
    expect(splitCoins(90, 3)).toEqual({ each: 30, leaderExtra: 0 });
    expect(splitCoins(0, 2)).toEqual({ each: 0, leaderExtra: 0 });
    expect(splitCoins(-5, 2)).toEqual({ each: 0, leaderExtra: 0 });
    expect(splitCoins(10, 0)).toEqual({ each: 0, leaderExtra: 0 });
  });
});

describe('normalizeParty / partyMembers', () => {
  it('按 id 解析出存在的角色', () => {
    const p: Party = { leaderId: 'c1', memberIds: ['c1', 'ghost'] };
    expect(partyMembers(p, chars).map((m) => m.id)).toEqual(['c1']);
  });
});

describe('validateParty', () => {
  it('合法编队通过', () => {
    expect(validateParty({ leaderId: 'c1', memberIds: ['c1', 'c2'] }, chars, 2)).toBeNull();
  });
  it('队长必须在编队中', () => {
    expect(validateParty({ leaderId: 'c3', memberIds: ['c1'] }, chars, 3)).toMatch(/队长/);
  });
  it('超员/重复/空编队报错', () => {
    expect(validateParty({ leaderId: 'c1', memberIds: ['c1', 'c2'] }, chars, 1)).toMatch(/最多/);
    expect(validateParty({ leaderId: 'c1', memberIds: ['c1', 'c1'] }, chars, 3)).toMatch(/重复/);
    expect(validateParty(null, chars, 3)).toMatch(/编队/);
  });
});

// settleRun 在 node 环境无 localStorage，用内存桩替代（saveSave 内部 try/catch 也不影响返回值）
beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

const mkSave = (): SaveData => ({
  version: 1,
  characters: [structuredClone(c1), structuredClone(c2), structuredClone(c3)],
  customItems: [], customMonsters: [], customStages: [],
  materials: [{ itemId: 'it_mat_gel', count: 2 }],
  coinsInStorage: 0,
  party: null,
});

describe('settleRun 通关结算', () => {
  it('剩余90三人平分各30，材料合并进共享仓库，非队员存款不变', () => {
    const s = mkSave();
    const party: Party = { leaderId: 'c1', memberIds: ['c1', 'c2', 'c3'] };
    const next = settleRun(s, party, 90, [
      { itemId: 'it_mat_gel', count: 3 },
      { itemId: 'it_mat_iron', count: 1 },
    ]);
    expect(next.characters.map((c) => c?.coins)).toEqual([30, 30, 30]);
    expect(next.materials).toContainEqual({ itemId: 'it_mat_gel', count: 5 });
    expect(next.materials).toContainEqual({ itemId: 'it_mat_iron', count: 1 });
    // 原存档不被突变
    expect(s.characters[0]!.coins).toBe(100);
  });

  it('余数归队长：100/3 → 队长34、队员33', () => {
    const next = settleRun(mkSave(), { leaderId: 'c2', memberIds: ['c2', 'c1', 'c3'] }, 100);
    expect(next.characters.map((c) => c?.coins)).toEqual([33, 34, 33]);
  });

  it('remaining 超过币池总量时钳制到币池（150→各50）；负数钳0', () => {
    const over = settleRun(mkSave(), { leaderId: 'c1', memberIds: ['c1', 'c2', 'c3'] }, 999);
    expect(over.characters.map((c) => c?.coins)).toEqual([50, 50, 50]);
    const neg = settleRun(mkSave(), { leaderId: 'c1', memberIds: ['c1', 'c2'] }, -9);
    expect(neg.characters.map((c) => c?.coins)).toEqual([0, 0, 0]);
  });

  it('未进本成员的存款不受影响', () => {
    // c3 不在队，币池=100+50=150，全部花光剩余0：c1/c2 归0，c3 保留0（换有币角色验证）
    const s = mkSave();
    s.characters[2]!.coins = 77;
    const next = settleRun(s, { leaderId: 'c1', memberIds: ['c1', 'c2'] }, 0);
    expect(next.characters.map((c) => c?.coins)).toEqual([0, 0, 77]);
  });
});