import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGES } from '../../data/stages';
import { DEFAULT_MONSTERS } from '../../data/monsters';
import { DROP_POOL_RARITIES } from '../../types';
import { dropsWeightTotal, rarityWeightsTotal } from '../drops';

const monsterIds = new Set(DEFAULT_MONSTERS.map((m) => m.id));
// 灾厄泰拉为占位关卡，掉落/难度规则与新手村不同，严格校验时排除
const strictStages = DEFAULT_STAGES.filter((s) => s.dungeon !== 'preWallCalamity');

describe('内置关卡种子数据', () => {
  it('每关怪物引用存在、总数 1~5 只', () => {
    for (const s of DEFAULT_STAGES) {
      const total = s.monsters.reduce((n, m) => n + m.count, 0);
      expect(total, s.name).toBeGreaterThanOrEqual(1);
      expect(total, s.name).toBeLessThanOrEqual(5);
      s.monsters.forEach((m) => expect(monsterIds.has(m.monsterId), `${s.name}/${m.monsterId}`).toBe(true));
    }
  });

  it('统一掉落：藏品随机池权重合计100、稀有度分布 40/30/20/10', () => {
    for (const s of strictStages) {
      if (s.drops.length === 0) continue; // 特殊关（如夺舍）无随机掉落
      expect(dropsWeightTotal(s), s.name).toBe(100);
      const d = s.drops[0]!;
      expect(d.kind).toBe('item');
      expect(d.source).toBe('pool');
      expect(d.rarity).toBeUndefined();
      expect(rarityWeightsTotal(d.rarityWeights)).toBe(100);
      expect(d.rarityWeights?.uncommon).toBe(40);
      expect(d.rarityWeights?.fine).toBe(30);
      expect(d.rarityWeights?.rare).toBe(20);
      expect(d.rarityWeights?.epic).toBe(10);
      expect(d.rarityWeights?.legendary ?? 0).toBe(0);
      expect(DROP_POOL_RARITIES.every((r) => (d.rarityWeights?.[r] ?? 0) >= 0)).toBe(true);
    }
  });

  it('统一幸运：普通=判定60遗物；紧急/BOSS=再加判定1遗物；分布同藏品池', () => {
    for (const s of strictStages) {
      if (s.luckyDrops.length === 0) continue; // 特殊关（如夺舍）无幸运掉落
      if (s.id.startsWith('cc_s1_')) continue; // 危机合约关卡规则不同
      expect(s.luckyDrops[0]?.threshold, s.name).toBe(60);
      expect(s.luckyDrops[0]?.kind).toBe('relic');
      expect(rarityWeightsTotal(s.luckyDrops[0]?.rarityWeights)).toBe(100);
      if (s.difficulty === 'normal') {
        expect(s.luckyDrops).toHaveLength(1);
      } else {
        expect(s.luckyDrops).toHaveLength(2);
        expect(s.luckyDrops[1]?.threshold).toBe(1);
        expect(s.luckyDrops[1]?.kind).toBe('relic');
      }
    }
  });

  it('统一固定掉落：仅哈哈币且数量>0（危机合约/特殊关跳过）', () => {
    for (const s of strictStages) {
      if (s.id.startsWith('cc_s1_')) continue; // 危机合约关卡规则不同
      if (s.fixedDrops?.some((f) => f.kind !== 'coin')) continue; // 特殊关（如夺舍）含材料固定掉落
      expect(s.fixedDrops, s.name).toHaveLength(1);
      expect(s.fixedDrops![0]!.kind).toBe('coin');
      expect(s.fixedDrops![0]!.count).toBeGreaterThan(0);
    }
  });

  it('紧急关必须挂在同名的普通关上（pairStageId 存在且指向普通难度）', () => {
    for (const s of strictStages.filter((x) => x.difficulty === 'urgent')) {
      expect(s.pairStageId, s.name).toBeTruthy();
      const pair = DEFAULT_STAGES.find((x) => x.id === s.pairStageId)!;
      expect(pair.difficulty).toBe('normal');
      expect(pair.name).toBe(s.name);
    }
  });
});
