import { describe, expect, it } from 'vitest';
import { itemMapOf } from '../../data/content';
import type { Equip, ExtraStats } from '../../types';
import { BASE_TEMPLATE, computeStats, validateExtra, weaponAttackType } from '../stats';

const emptySave = { customItems: [] } as Parameters<typeof itemMapOf>[0];
const itemMap = itemMapOf(emptySave);

const equip = (e: Partial<Equip>): Equip => ({
  weapon: null, helmet: null, armor: null, boots: null, accessory: [null, null], ...e,
});

const itemsOf = (e: Equip) =>
  [e.weapon, e.helmet, e.armor, e.boots, ...e.accessory]
    .filter((x): x is string => !!x)
    .map((id) => itemMap.get(id)!);

describe('computeStats', () => {
  it('战士初始装（木剑/木头盔/木甲）：HP330 / ATK60 / DEF25', () => {
    const s = computeStats(
      BASE_TEMPLATE,
      itemsOf(equip({ weapon: 'it_sword_wood', helmet: 'it_helmet_wood', armor: 'it_armor_wood' })),
    );
    expect(s).toMatchObject({ hp: 330, atk: 60, def: 25, mp: 60, mres: 0, spdMin: 2, spdMax: 5 });
  });

  it('法师初始装（木杖/木头盔/木甲）：普攻法术化，不加攻击，无魔力/法抗加成', () => {
    const items = itemsOf(equip({ weapon: 'it_staff_wood', helmet: 'it_helmet_wood', armor: 'it_armor_wood' }));
    expect(weaponAttackType(items)).toBe('magical');
    const s = computeStats(BASE_TEMPLATE, items);
    expect(s.atk).toBe(50);
    expect(s.mp).toBe(60);
    expect(s.mres).toBe(0);
  });

  it('法抗结算 clamp 到 90', () => {
    expect(computeStats({ ...BASE_TEMPLATE, mres: 95 }, []).mres).toBe(90);
  });

  it('赫尔墨斯之靴速度上下限同加；银靴只加下限', () => {
    const hermes = computeStats(BASE_TEMPLATE, [itemMap.get('it_boots_hermes')!]);
    expect(hermes.spdMin).toBe(3);
    expect(hermes.spdMax).toBe(6);
    const silver = computeStats(BASE_TEMPLATE, [itemMap.get('it_boots_silver')!]);
    expect(silver.spdMin).toBe(3);
    expect(silver.spdMax).toBe(5);
  });

  it('钻石头盔+钻石甲：HP370，防御45', () => {
    const s = computeStats(
      BASE_TEMPLATE,
      itemsOf(equip({ helmet: 'it_helmet_diamond', armor: 'it_armor_diamond' })),
    );
    expect(s.hp).toBe(370);
    expect(s.def).toBe(45);
  });

  it('等级10为基准无加成；每升10级一档 +50HP/+20MP/+10ATK/+5DEF/+1速度', () => {
    const base = computeStats(BASE_TEMPLATE, [], 10);
    expect(base).toMatchObject({ hp: 300, mp: 60, atk: 50, def: 20, spdMin: 2, spdMax: 5 });
    const lv11 = computeStats(BASE_TEMPLATE, [], 11); // 未满10级档，无加成
    expect(lv11).toMatchObject({ hp: 300, mp: 60, atk: 50, def: 20, spdMin: 2, spdMax: 5 });
    const lv20 = computeStats(BASE_TEMPLATE, [], 20); // 1档
    expect(lv20).toMatchObject({ hp: 350, mp: 80, atk: 60, def: 25, spdMin: 3, spdMax: 6 });
    const lv30 = computeStats(BASE_TEMPLATE, [], 30); // 2档
    expect(lv30).toMatchObject({ hp: 400, mp: 100, atk: 70, def: 30, spdMin: 4, spdMax: 7 });
  });

  it('低于10级不扣属性', () => {
    expect(computeStats(BASE_TEMPLATE, [], 5)).toMatchObject({ hp: 300, atk: 50, spdMin: 2 });
  });
});

describe('extraStatBonus（初始加点六维换算，初始10点不计）', () => {
  const e = (v: Partial<ExtraStats>): ExtraStats => ({
    str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 10, ...v,
  });

  it('全部初始10点 → 无任何加成', () => {
    const s = computeStats(BASE_TEMPLATE, [], 10, e({}));
    expect(s).toMatchObject({ hp: 300, mp: 60, atk: 50, def: 20, mres: 0, spdMin: 2, spdMax: 5 });
  });

  it('力量1点=+1攻、智力1点=+1MP（10→40 = +30）', () => {
    const s = computeStats(BASE_TEMPLATE, [], 10, e({ str: 40, int: 40 }));
    expect(s.atk).toBe(80);
    expect(s.mp).toBe(90);
  });

  it('幸运1点=+2HP（10→40 = +60）', () => {
    const s = computeStats(BASE_TEMPLATE, [], 10, e({ luk: 40 }));
    expect(s.hp).toBe(360);
  });

  it('意志/魅力 2点=+1防/法抗（向下取整，10→40 = +15）', () => {
    const s = computeStats(BASE_TEMPLATE, [], 10, e({ wil: 40, cha: 40 }));
    expect(s.def).toBe(35);
    expect(s.mres).toBe(15);
  });

  it('法抗换算后仍 clamp 到 90', () => {
    const s = computeStats({ ...BASE_TEMPLATE, mres: 85 }, [], 10, e({ cha: 40 }));
    expect(s.mres).toBe(90);
  });

  it('敏捷每5点一档交替提升 min/max：15敏=min+1、20敏=+1/+1、40敏=+3/+3', () => {
    expect(computeStats(BASE_TEMPLATE, [], 10, e({ agi: 15 }))).toMatchObject({ spdMin: 3, spdMax: 5 });
    expect(computeStats(BASE_TEMPLATE, [], 10, e({ agi: 20 }))).toMatchObject({ spdMin: 3, spdMax: 6 });
    expect(computeStats(BASE_TEMPLATE, [], 10, e({ agi: 25 }))).toMatchObject({ spdMin: 4, spdMax: 6 });
    expect(computeStats(BASE_TEMPLATE, [], 10, e({ agi: 30 }))).toMatchObject({ spdMin: 4, spdMax: 7 });
    expect(computeStats(BASE_TEMPLATE, [], 10, e({ agi: 40 }))).toMatchObject({ spdMin: 5, spdMax: 8 });
  });

  it('敏捷不足一档（13敏）不提升速度', () => {
    expect(computeStats(BASE_TEMPLATE, [], 10, e({ agi: 13 }))).toMatchObject({ spdMin: 2, spdMax: 5 });
  });

  it('装备/遗物六维加成不参与换算（仅角色初始加点）', () => {
    // computeStats 的 extra 参数只接收角色自身加点；装备 extraBonus 不传入即不换算
    const s = computeStats(BASE_TEMPLATE, [], 10, e({ str: 40 }));
    expect(s.atk).toBe(80); // 仅 (40-10)×1
  });
});

describe('validateExtra', () => {
  const base: ExtraStats = { str: 10, int: 10, agi: 10, luk: 10, cha: 10, wil: 10 };
  it('合法分配：总和140且每项10~40', () => {
    // 四项各+20，恰好用完80点预算：30*4 + 10*2 = 140
    expect(validateExtra({ ...base, str: 30, int: 30, agi: 30, luk: 30 })).toBe(true);
    // 单项拉满到40，其余补足到140
    expect(validateExtra({ ...base, str: 40, int: 40, agi: 20, luk: 20, cha: 10, wil: 10 })).toBe(true);
  });
  it('只有初始60点不合法', () => {
    expect(validateExtra(base)).toBe(false);
  });
  it('单项超过40不合法', () => {
    expect(validateExtra({ ...base, str: 41, int: 19, agi: 20, luk: 20 })).toBe(false);
  });
  it('总和错误不合法', () => {
    expect(validateExtra({ ...base, str: 20 })).toBe(false); // 总和70
  });
});
