import { useMemo, useState } from 'react';
import type { BaseStats, DamageType, MonsterUnit, SaveData, Skill } from '../types';
import { isBoss } from '../types';
import { allEnemies } from '../data/content';
import { addCustomMonster, removeCustomMonster, updateCustomMonster } from '../save/storage';
import { BUFF_LIBRARY } from '../engine/buffs';
import { Sprite } from '../components/Sprite';
import { Modal } from '../components/Modal';
import { spdText } from '../ui/labels';

const isBossLike = (m: MonsterUnit) => isBoss(m) || m.boss === true;

export function Bestiary({ save, onChange }: {
  save: SaveData;
  onChange: (s: SaveData) => void;
}) {
  const enemies = useMemo(() => allEnemies(save), [save]);
  const [detail, setDetail] = useState<MonsterUnit | null>(null);
  const [editing, setEditing] = useState<MonsterUnit | null>(null); // null=未打开；非null怪物=编辑
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MonsterUnit | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <h2>怪物图鉴（{enemies.length}）</h2>
        <button className="btn primary" onClick={() => setCreating(true)}>+ 新增怪物</button>
      </div>

      {enemies.length === 0 && (
        <div className="card bag-empty">图鉴已空，点右上角「新增怪物」添加。</div>
      )}

      <div className="monster-grid">
        {enemies.map((m) => (
          <div key={m.id} className="card monster-card clickable" onClick={() => setDetail(m)}>
            <Sprite className="monster-icon" src={m.icon} alt={m.name} />
            <div className="monster-name">
              {m.name}
              {m.elite && <span className="elite-tag">精英</span>}
              {isBossLike(m) && <span className="boss-tag">BOSS</span>}
            </div>
            <div className="monster-line">HP {m.stats.hp} · 攻 {m.stats.atk}</div>
            <div className="monster-line">防 {m.stats.def} · 抗 {m.stats.mres}% · 速 {spdText(m.stats.spdMin, m.stats.spdMax)}</div>
            <div className="card-actions">
              <button className="btn-mini" onClick={(e) => { e.stopPropagation(); setEditing(m); }}>改</button>
              <button className="btn-danger btn-mini" onClick={(e) => { e.stopPropagation(); setDeleting(m); }}>删</button>
            </div>
          </div>
        ))}
      </div>

      {detail && (
        <MonsterDetail
          monster={detail}
          monsterName={(id) => enemies.find((m) => m.id === id)?.name ?? id}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditing(detail); setDetail(null); }}
        />
      )}
      {(creating || editing) && (
        <MonsterEditor
          initial={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSave={(data) => {
            if (editing) onChange(updateCustomMonster(save, editing.id, data));
            else onChange(addCustomMonster(save, data));
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <Modal title="删除怪物" onClose={() => setDeleting(null)}>
          <p>删除怪物「{deleting.name}」？删除后对战测试中也无法再选择它。</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleting(null)}>取消</button>
            <button className="btn-danger" onClick={() => { onChange(removeCustomMonster(save, deleting.id)); setDeleting(null); }}>
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MonsterDetail({ monster, monsterName, onClose, onEdit }: {
  monster: MonsterUnit;
  monsterName: (id: string) => string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const boss = isBoss(monster) ? monster : null;
  return (
    <Modal title={monster.name} onClose={onClose} wide>
      <div className="detail-flex">
        <Sprite className="monster-portrait" src={monster.icon} alt={monster.name} />
        <div>
          <p className="muted">{monster.desc}</p>
          <StatTable stats={boss ? boss.parts[0].stats : monster.stats} />
          <h4>技能</h4>
          {monster.skills.length === 0 && boss === null && !monster.basicAttackBuffs?.length && !monster.summon && !monster.enrage && (
            <div className="muted">仅普通攻击</div>
          )}
          {monster.skills.map((sk) => <SkillLine key={sk.id} sk={sk} />)}
          {monster.basicAttackBuffs?.map((b) => (
            <div key={b.id} className="skill-line">
              <b>普攻附加</b>
              <span className="muted">：{BUFF_LIBRARY[b.id]?.name ?? b.id} {b.stacks}层·强度{b.intensity}</span>
            </div>
          ))}
          {monster.summon && (
            <div className="skill-line">
              <b>召唤</b>
              <span className="muted">：受击后生命低于
                {monster.summon.thresholds.map((t) => `${Math.round(t * 100)}%`).join('、')}
                时各召唤一只{monsterName(monster.summon.monsterId)}
                {monster.summon.selfSpdUp ? `，每次召唤自身速度+${monster.summon.selfSpdUp}` : ''}</span>
            </div>
          )}
          {monster.enrage && (
            <div className="skill-line">
              <b>狂暴</b>
              <span className="muted">：生命低于{Math.round(monster.enrage.hpBelow * 100)}%时，
                {[
                  monster.enrage.spd ? `速度+${monster.enrage.spd}` : '',
                  monster.enrage.atk ? `攻击+${monster.enrage.atk}` : '',
                  monster.enrage.def ? `防御${monster.enrage.def > 0 ? '+' : ''}${monster.enrage.def}` : '',
                ].filter(Boolean).join('，')}</span>
            </div>
          )}
        </div>
      </div>

      {boss && (
        <div className="boss-parts">
          <h4>多部位（编成占1格，进场3个独立血条）</h4>
          <table className="parts-table">
            <thead>
              <tr><th>部位</th><th>HP</th><th>攻击</th><th>防御</th><th>法抗</th><th>速度</th><th>行动</th><th>被毁效果</th></tr>
            </thead>
            <tbody>
              {boss.parts.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}{p.id === 'core' ? '（毁则BOSS死亡）' : ''}</td>
                  <td>{p.stats.hp}</td>
                  <td>{p.stats.atk}</td>
                  <td>{p.stats.def}</td>
                  <td>{p.stats.mres}%</td>
                  <td>{spdText(p.stats.spdMin, p.stats.spdMax)}</td>
                  <td>{p.skills.map((sk) => sk.name).join('、')}</td>
                  <td>{p.onBreak === 'coreAtkDown30' ? '核心攻击-30%' : p.onBreak === 'coreDefDown50' ? '核心防御-50%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">双臂皆毁时核心眩晕1回合；核心首次低于50%生命触发狂暴（攻击+30%，一次）。</p>
        </div>
      )}

      <div className="modal-actions">
        <button className="btn primary" onClick={onEdit}>编辑数值</button>
        <button className="btn" onClick={onClose}>关闭</button>
      </div>
    </Modal>
  );
}

function StatTable({ stats }: { stats: BaseStats }) {
  return (
    <div className="stat-grid">
      <span>生命 <b>{stats.hp}</b></span>
      <span>攻击 <b>{stats.atk}</b></span>
      <span>防御 <b>{stats.def}</b></span>
      <span>法抗 <b>{stats.mres}%</b></span>
      <span>速度 <b>{spdText(stats.spdMin, stats.spdMax)}</b></span>
    </div>
  );
}

function SkillLine({ sk }: { sk: Skill }) {
  return (
    <div className="skill-line">
      <b>{sk.name}</b>
      <span className="muted">（{sk.damageType === 'magical' ? '法术' : '物理'}·
        {sk.target === 'enemyAll' ? '群体' : '单体'}
        {sk.evenTurnOnly ? '·仅偶数回合' : ''}
        {sk.cooldown ? `·冷却${sk.cooldown}` : ''}）{sk.desc}</span>
    </div>
  );
}

function MonsterEditor({ initial, onClose, onSave }: {
  initial?: MonsterUnit;
  onClose: () => void;
  onSave: (m: Omit<MonsterUnit, 'id' | 'custom'>) => void;
}) {
  const firstSkill = initial?.skills[0];
  const [name, setName] = useState(initial?.name ?? '');
  const [desc, setDesc] = useState(initial?.desc ?? '');
  const [hp, setHp] = useState(initial?.stats.hp ?? 100);
  const [atk, setAtk] = useState(initial?.stats.atk ?? 25);
  const [def, setDef] = useState(initial?.stats.def ?? 5);
  const [mres, setMres] = useState(initial?.stats.mres ?? 0);
  const [spdMin, setSpdMin] = useState(initial?.stats.spdMin ?? 2);
  const [spdMax, setSpdMax] = useState(initial?.stats.spdMax ?? 5);
  const [ai, setAi] = useState<'basic' | 'caster'>(
    initial && initial.ai !== 'boss' ? initial.ai : 'basic',
  );
  const [bossFlag, setBossFlag] = useState(initial?.boss ?? false);
  const [useSkill, setUseSkill] = useState(!!firstSkill);
  const [skName, setSkName] = useState(firstSkill?.name ?? '');
  const [dmgType, setDmgType] = useState<DamageType>(firstSkill?.damageType ?? 'physical');
  const [targetAll, setTargetAll] = useState(firstSkill?.target === 'enemyAll');
  const [mult, setMult] = useState(Math.round((firstSkill?.multiplier ?? 1.2) * 100));
  const [cd, setCd] = useState(firstSkill?.cooldown ?? 2);
  const [iconPath, setIconPath] = useState(initial?.icon ?? '');

  const spdOk = spdMin >= 0 && spdMax <= 99 && spdMin <= spdMax;
  const valid = name.trim().length > 0 && hp > 0 && spdOk && mres <= 90 &&
    (!useSkill || skName.trim().length > 0);

  const save = () => {
    if (!valid) return;
    let skills: Skill[] = [];
    if (useSkill) {
      const descText = `${mult}%${dmgType === 'magical' ? '法术' : '物理'}${targetAll ? '群体' : '单体'}伤害，冷却${Math.max(1, cd)}次行动。`;
      // 编辑已有技能时保留原技能上的附加字段（如 applyBuffs 中毒）
      skills = [firstSkill
        ? { ...firstSkill, name: skName.trim(), target: targetAll ? 'enemyAll' : 'enemyOne',
            damageType: dmgType, multiplier: mult / 100, cooldown: Math.max(1, cd), desc: descText }
        : {
            id: `custom_sk_${Date.now().toString(36)}`,
            name: skName.trim(), kind: 'active' as const, mpCost: 0,
            target: targetAll ? 'enemyAll' as const : 'enemyOne' as const,
            damageType: dmgType, multiplier: mult / 100, cooldown: Math.max(1, cd), desc: descText,
          }];
    }
    onSave({
      name: name.trim(),
      icon: iconPath.trim() || undefined,
      desc: desc.trim() || (ai === 'caster' ? '自定义施法者。' : '自定义怪物。'),
      stats: { hp, mp: 0, atk, def, mres: Math.min(90, Math.max(0, mres)), spdMin, spdMax },
      skills,
      ai,
      boss: bossFlag || undefined,
    });
  };

  return (
    <Modal title={initial ? `编辑怪物 · ${initial.name}` : '新增怪物'} onClose={onClose} wide>
      <div className="form-grid">
        <label>名称<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={10} /></label>
        <label>AI
          <select className="input" value={ai} onChange={(e) => setAi(e.target.value as 'basic' | 'caster')}>
            <option value="basic">basic（只会普攻）</option>
            <option value="caster">caster（冷却好就放技能）</option>
          </select>
        </label>
        <label className="radio-line" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={bossFlag} onChange={(e) => setBossFlag(e.target.checked)} /> 标记为BOSS
        </label>
        <label>生命<input className="input" type="number" min={1} value={hp} onChange={(e) => setHp(Number(e.target.value))} /></label>
        <label>攻击<input className="input" type="number" value={atk} onChange={(e) => setAtk(Number(e.target.value))} /></label>
        <label>防御<input className="input" type="number" min={0} value={def} onChange={(e) => setDef(Number(e.target.value))} /></label>
        <label>法抗%(0~90)<input className="input" type="number" min={0} max={90} value={mres} onChange={(e) => setMres(Number(e.target.value))} /></label>
        <label>速度下限(0~99)<input className="input" type="number" min={0} max={99} value={spdMin} onChange={(e) => setSpdMin(Number(e.target.value))} /></label>
        <label>速度上限(0~99)<input className="input" type="number" min={0} max={99} value={spdMax} onChange={(e) => setSpdMax(Number(e.target.value))} /></label>
        <label className="form-wide">描述
          <input className="input" value={desc} maxLength={60} placeholder="图鉴展示的怪物介绍"
            onChange={(e) => setDesc(e.target.value)} />
        </label>
        <label className="form-wide">图片路径或URL（留空用默认头像）
          <input className="input" value={iconPath} placeholder="/img/monsters/xxx.png 或 https://…"
            onChange={(e) => setIconPath(e.target.value)} />
        </label>
      </div>
      {!spdOk && <p className="warn">速度需满足 0 ≤ 下限 ≤ 上限 ≤ 99</p>}

      <h4>特殊技能（可选，仅1个）</h4>
      <label className="radio-line">
        <input type="checkbox" checked={useSkill} onChange={(e) => setUseSkill(e.target.checked)} /> 配置技能
      </label>
      {useSkill && (
        <div className="form-grid">
          <label>技能名<input className="input" value={skName} onChange={(e) => setSkName(e.target.value)} maxLength={10} /></label>
          <label>类型
            <select className="input" value={dmgType} onChange={(e) => setDmgType(e.target.value as DamageType)}>
              <option value="physical">物理</option>
              <option value="magical">法术</option>
            </select>
          </label>
          <label>目标
            <select className="input" value={targetAll ? 'all' : 'one'} onChange={(e) => setTargetAll(e.target.value === 'all')}>
              <option value="one">单体</option>
              <option value="all">群体</option>
            </select>
          </label>
          <label>倍率%<input className="input" type="number" value={mult} onChange={(e) => setMult(Number(e.target.value))} /></label>
          <label>冷却(行动次数)<input className="input" type="number" min={1} value={cd} onChange={(e) => setCd(Number(e.target.value))} /></label>
          {firstSkill?.applyBuffs && firstSkill.applyBuffs.length > 0 && (
            <label className="form-wide muted">该技能附带的特殊效果（如中毒BUFF）会在保存时保留。</label>
          )}
        </div>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!valid} onClick={save}>保存</button>
      </div>
    </Modal>
  );
}
