import { useState } from 'react';
import type { BuffId } from '../types';
import { BUFF_LIBRARY, BUFF_SCALE, MULTIPLICATIVE_BUFFS } from '../engine/buffs';
import { Modal } from '../components/Modal';

// 展示顺序
const BUFF_ORDER: BuffId[] = [
  'poison', 'bleed', 'burn', 'chill', 'regen',
  'bind', 'swift',
  'strength', 'weak', 'protection', 'armorBreak',
  'apoptosis',
  'huff', 'huntMark', 'agiStrength', 'worship', 'konohaMark', 'fireAddiction', 'implosion', 'plague',
  'reinMask', 'reinWound', 'reinKarma', 'reinLiberation', 'reinHeart',
];

// 每种 BUFF 的结算时机说明
const WHEN: Record<BuffId, string> = {
  poison: '每回合末受到真实伤害（中毒→流血→烧伤→寒冷→再生 顺序结算）',
  bleed: '每回合末受到最大生命百分比的法术伤害（中毒→流血→烧伤→寒冷→再生 顺序结算）',
  burn: '每回合末受到当前生命百分比的真实伤害（中毒→流血→烧伤→寒冷→再生 顺序结算）',
  chill: '每回合末受到法术伤害（中毒→流血→烧伤→寒冷→再生 顺序结算）',
  regen: '每回合末回复生命（中毒→流血→烧伤→寒冷→再生 顺序结算）',
  bind: '影响每回合速度掷点区间（层数为剩余回合数）',
  swift: '影响每回合速度掷点区间（层数为剩余回合数）',
  strength: '计算自身造成的伤害时生效（层数为剩余回合数）',
  weak: '计算自身造成的伤害时生效（层数为剩余回合数）',
  protection: '计算自身受到的伤害时生效（层数为剩余回合数）',
  armorBreak: '计算自身受到的伤害时生效：削减全能减伤，可减为负转为增伤（层数为剩余回合数）',
  apoptosis: '达到3层时立即引爆，造成 最大MP×强度 的固定真实伤害，之后移除',
  huff: '战斗内永久持续（不随回合衰减）；计算攻击与防御时生效（受击前反应技能施加，攻防扁平削减）',
  huntMark: '永久持续（不随回合衰减）；回合末受到施放者攻击力对应强度的物理伤害',
  agiStrength: '计算自身速度时生效：每层强度+1速度',
  worship: '计算自身受到的伤害时生效：防御与法抗减半（袁绍抉择，两回合）',
  konohaMark: '永久持续（不随回合衰减）；里莲华的伤害因子，层数越高物理伤害越高',
  fireAddiction: '持续到弹药不足为止；每次攻击额外消耗 强度 值的弹药，弹药不足行动前消耗时自动解除',
  needle: '永久持续（不随回合衰减）；葬花针层数，每层使应龙攻击+10%、防御+10%、法抗+5',
  potianSpd: '永久持续（不随回合衰减）；冥王破天的当前破天速度，受击每累计100伤害+1',
  gouDog: '永久持续（不随回合衰减）；挂狗背水一战已触发，速度提升且攻击无视防御',
  implosion: '永久持续（不随回合衰减）；达到爱弥斯聚爆层数上限时立即引爆，造成层数×20%攻击力的法术伤害，之后层数清零',
  plague: '永久持续（不随回合衰减）；每层削减2%最大生命上限，可叠加',
  reinMask: '永久持续（不随回合衰减）；遮盖伤口的假面：全能减伤（强度=减伤百分比小数）',
  reinWound: '永久持续（不随回合衰减）；灼烧着的伤口：全能减伤（强度=减伤百分比小数），速度+等级/10、攻击+等级',
  reinKarma: '永久持续（不随回合衰减）；业：每层防御-10%（乘算）、法抗-5，上限5层',
  reinLiberation: '永久持续（不随回合衰减）；解放档位（覆盖式，强度=1/2/3），额外六维/攻击/全能增伤',
  reinHeart: '永久持续（不随回合衰减）；心-命运：速度+、一技能按最高六维、每回合MP恢复',
};

// 把系数换算成可读文案
function scaleText(id: BuffId): string {
  const v = BUFF_SCALE[id];
  switch (id) {
    case 'swift': case 'bind': case 'agiStrength': return `${v} 点速度`;
    case 'strength': case 'weak':
      return `强度${Math.round(v * 100)}%增伤`;
    case 'protection': case 'armorBreak':
      return `强度${Math.round(v * 100)}%减伤`;
    case 'regen': case 'poison': return `${v} 点`;
    case 'burn': return `${Math.round(v * 100)}% 当前生命`;
    case 'bleed': return `${Math.round(v * 100)}% 最大生命`;
    case 'chill': return `${v} 点法术伤害`;
    case 'apoptosis': return `${Math.round(v * 100)}% 最大MP × 强度`;
    case 'huff': return `${v} 点攻击、${v} 点防御`;
    case 'huntMark': return `${Math.round(v * 100)}% 施放者攻击力`;
    case 'worship': return '防御与法抗减半';
    case 'konohaMark': return `${v} 层印记`;
    case 'implosion': return `${v} 层聚爆`;
    default: return `${v}`;
  }
}

export function Buffs() {
  const [detail, setDetail] = useState<BuffId | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <h2>BUFF 库（{BUFF_ORDER.length}）</h2>
      </div>
      <p className="muted small">
        乘算类（中毒/流血/烧伤/寒冷/再生）：效果 = 层数 × 强度 × 基础数值；
        非乘算类：效果 = 强度 × 基础数值（层数仅为剩余回合数）；
        永久 BUFF（哈气/狩猎标记）：不随回合衰减。
      </p>

      <div className="buff-grid">
        {BUFF_ORDER.map((id) => {
          const b = BUFF_LIBRARY[id];
          const isMult = MULTIPLICATIVE_BUFFS.has(id);
          return (
            <div
              key={id}
              className={`card buff-card ${b.positive ? 'buff-good' : 'buff-bad'}`}
              onClick={() => setDetail(id)}
            >
              <div className="buff-name">
                {b.name}
                <span className={`buff-sign ${b.positive ? 'good' : 'bad'}`}>
                  {b.positive ? '增益' : '减益'}
                </span>
              </div>
              <div className="buff-scale muted">
                {isMult ? '每层每强度' : '每强度'}：{scaleText(id)}
              </div>
              <div className="buff-desc">{b.desc}</div>
            </div>
          );
        })}
      </div>

      {detail && (() => {
        const b = BUFF_LIBRARY[detail];
        const isMult = MULTIPLICATIVE_BUFFS.has(detail);
        return (
          <Modal title={`BUFF · ${b.name}`} onClose={() => setDetail(null)}>
            <p>
              <span className={`buff-sign ${b.positive ? 'good' : 'bad'}`}>
                {b.positive ? '增益' : '减益'}
              </span>
            </p>
            <div className="stat-grid">
              <span>效果 <b>{b.desc}</b></span>
              <span>数值 <b>{isMult ? '每层每强度' : '每强度'} {scaleText(detail)}</b></span>
              <span>结算 <b>{WHEN[detail]}</b></span>
            </div>
            {isMult ? (
              <p className="muted small">
                示例：3 层强度 2 的「{b.name}」，实际效果 = 3 × 2 = 6 份基础数值。
              </p>
            ) : detail === 'apoptosis' ? null : (
              <p className="muted small">
                非乘算类：强度决定效果大小，层数为剩余回合数。
                示例：强度 2 的「{b.name}」，效果 = 2 份基础数值，持续 N 回合。
              </p>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setDetail(null)}>关闭</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
