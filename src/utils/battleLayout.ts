// 战斗布局设置：正常版 / 精简版（持久化到 localStorage）
export type BattleLayoutMode = 'normal' | 'lite';
export const BATTLE_LAYOUT_KEY = 'haji_battleLayout';

export function getBattleLayout(): BattleLayoutMode {
  try {
    return localStorage.getItem(BATTLE_LAYOUT_KEY) === 'lite' ? 'lite' : 'normal';
  } catch {
    return 'normal';
  }
}

export function setBattleLayout(m: BattleLayoutMode) {
  try { localStorage.setItem(BATTLE_LAYOUT_KEY, m); } catch { /* ignore */ }
}
