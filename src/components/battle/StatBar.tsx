import { memo } from 'react';
import type { Combatant } from '../../types';
import { Sprite } from '../Sprite';
import { BUFF_LIBRARY } from '../../engine/buffs';

const REIN_MASK_GIF = `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}角色资源/摘面具.gif`;
const EIMIS_SWITCH_GIF = `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}角色资源/爱弥斯形态切换.gif`;
const EIMIS_ENTRY_GIF = `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}角色资源/爱弥斯登场.gif`;
const REIN_SWITCH_MP4 = `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}角色资源/里恩形态切换.mp4`;
const LOGOS_ENTRY_MP4 = `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}角色资源/逻各斯登场.mp4`;
const EXUSIAI_ENTRY_MP4 = `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}角色资源/能天使登场.mp4`;
// 能天使状态立绘：开火成瘾 → 开火成瘾.png；子弹0 → 能天使没子弹.gif；有子弹 → 正常立绘
const EXUSIAI_FIRE_ADDICTION_IMG = `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}角色资源/开火成瘾.png`;
const EXUSIAI_NO_AMMO_GIF = `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}角色资源/能天使没子弹.gif`;

const BUFF_COLOR: Record<string, string> = {
  swift: '#4fc3f7', bind: '#795548', strength: '#ff7043', protection: '#66bb6a',
  armorBreak: '#ab47bc', weak: '#8d6e63', regen: '#26a69a', poison: '#9ccc65',
  burn: '#e07b39', bleed: '#ef5350',
  huntMark: '#ffd54f', huff: '#8d6e63',
  needle: '#9c27b0', potianSpd: '#00bcd4', gouDog: '#ff9800',
  implosion: '#e040fb',
};

export interface FloatText {
  id: number;
  uid: string;
  text: string;
  kind: 'damage' | 'magic' | 'heal' | 'shield' | 'info';
  cls?: string; // 附加样式类（里恩解放/摘面具大字飘字）
}

export const UnitCard = memo(function UnitCard({ u, active, selectable, selected, dead, floats, onClick, onInfo, small, vfxClass }: {
  u: Combatant;
  active?: boolean;
  selectable?: boolean;
  selected?: boolean;
  dead?: boolean;
  floats: FloatText[];
  onClick?: () => void;
  onInfo?: () => void;
  small?: boolean;
  vfxClass?: string;
}) {
  const hpPct = Math.max(0, (u.hp / u.maxHp) * 100);
  const mpPct = Math.max(0, (u.mp / u.maxMp) * 100);
  const energyPct = u.energyMax ? Math.max(0, ((u.energy ?? 0) / u.energyMax) * 100) : 0;
  const masking = (vfxClass ?? '').includes('vfx-reinMaskGif'); // 摘面具GIF播放期间：隐藏伤口BUFF，播完再显示
  const morphing = (vfxClass ?? '').includes('vfx-eimisFormSwitch'); // 爱弥斯形态切换动画
  const entering = (vfxClass ?? '').includes('vfx-eimisEntry'); // 爱弥斯登场动画
  const libSwitching = (vfxClass ?? '').includes('vfx-reinLibSwitch'); // 里恩解放切立绘动画
  const logosEntering = (vfxClass ?? '').includes('vfx-logosEntry'); // 逻各斯登场动画（两倍速）
  const exusiaiEntering = (vfxClass ?? '').includes('vfx-exusiaiEntry'); // 能天使登场动画
  const cls = [
    'unit-card',
    small ? 'unit-small' : '',
    active ? 'unit-active' : '',
    selectable ? 'unit-selectable' : '',
    selected ? 'unit-selected' : '',
    dead ? 'unit-dead' : '',
    u.isCore ? 'unit-core' : '',
    u.enraged ? 'unit-enraged' : '',
    vfxClass ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} onClick={selectable ? onClick : undefined}>
      <div
        className="unit-art"
      >
        {masking ? (
          <img className="unit-sprite rein-mask-gif" src={REIN_MASK_GIF} alt="摘面具" />
        ) : morphing ? (
          <img className="unit-sprite rein-mask-gif" src={EIMIS_SWITCH_GIF} alt="形态切换" />
        ) : entering ? (
          <img className="unit-sprite rein-mask-gif" src={EIMIS_ENTRY_GIF} alt="登场" />
        ) : logosEntering ? (
          <video className="unit-sprite rein-mask-gif" src={LOGOS_ENTRY_MP4} autoPlay muted playsInline onLoadedData={(e) => { e.currentTarget.playbackRate = 2; }} />
        ) : exusiaiEntering ? (
          <video className="unit-sprite rein-mask-gif" src={EXUSIAI_ENTRY_MP4} autoPlay muted playsInline />
        ) : libSwitching ? (
          <video className="unit-sprite rein-mask-gif" src={REIN_SWITCH_MP4} autoPlay muted playsInline />
        ) : (
          <Sprite
            className="unit-sprite"
            src={u.job === 'exusiai'
              ? (u.buffs.some((b) => b.id === 'fireAddiction') ? EXUSIAI_FIRE_ADDICTION_IMG
                : (u.ammo === 0 ? EXUSIAI_NO_AMMO_GIF : u.icon))
              : u.icon}
            alt={u.name}
          />
        )}
        {u.roll !== undefined && (
          <div
            className="spd-badge"
            title={`本回合速度掷点 ${u.roll}（区间 ${u.stats.spdMin}-${u.stats.spdMax}）· 同速判定 ${u.tieBreak}`}
          >
            速{u.roll}
          </div>
        )}
        {u.shield > 0 && <div className="shield-badge">盾{u.shield}</div>}
        {(u.shieldStacks ?? 0) > 0 && <div className="shield-stack-badge">次盾×{u.shieldStacks}</div>}
        {u.form && <div className={`form-badge form-${u.form}`}>{u.form === 'red' ? '红' : '蓝'}</div>}
        {u.eimisForm && <div className={`form-badge form-${u.eimisForm}`}>{u.eimisForm === 'human' ? '人' : '机甲'}</div>}
        {u.statuses.stunTurns > 0 && <div className="stun-badge">晕{u.statuses.stunTurns}</div>}
        {u.buffs?.length > 0 && (
          <div className="buff-row">
            {u.buffs.filter((b) => !(masking && b.id === 'reinWound')).map((b, i) => {
              const def = BUFF_LIBRARY[b.id];
              return (
                <span
                  key={`${b.id}-${i}`}
                  className="buff-chip"
                  style={{ background: BUFF_COLOR[b.id] ?? '#888' }}
                  title={`${def?.name ?? b.id}：${def?.desc ?? ''}（${b.stacks}层·强度${b.intensity}）`}
                >
                  {def?.name ?? b.id}{b.stacks > 1 ? `×${b.stacks}` : ''}
                </span>
              );
            })}
          </div>
        )}
        <div className="float-layer">
          {floats.map((f) => (
            <span key={f.id} className={`float float-${f.kind}${f.cls ? ` ${f.cls}` : ''}`}>{f.text}</span>
          ))}
        </div>
      </div>
      <div className="unit-body">
        <div className="unit-name-row">
          <span
            className="unit-name unit-name-link"
            title="查看属性"
            onClick={(e) => {
              e.stopPropagation();
              onInfo?.();
            }}
          >
            {u.name}
          </span>
          {u.enraged && <span className="rage-tag">狂暴</span>}
        </div>
        <Bar pct={hpPct} color="var(--hp)" text={`${Math.ceil(u.hp)}/${u.maxHp}`} />
        {u.maxMp > 0 && <Bar pct={mpPct} color="var(--mp)" text={`${Math.ceil(u.mp)}/${u.maxMp}`} thin />}
        {u.reinOracle && (() => {
          const st = u.reinOracle.stacks;
          const max = 12;
          return (
            <Bar
              pct={max > 0 ? (st / max) * 100 : 0}
              color={st >= max ? '#ffd54f' : '#7c4dff'}
              text={`代行${st}/${max}`}
              thin
              title={`代行-赫尔墨斯：使用带指令标技能+1层、选择带指令标目标+1层、都满足+3层。3/6/9/12层触发解放I/II/III（覆盖），12层觉醒心-命运。`}
            />
          );
        })()}
        {(() => {
          const ak = u.crisis?.akado;
          if (u.monsterId === 'ct_070' && ak) {
            return (
              <Bar
                pct={(ak.bloodPool / 500) * 100}
                color="#d32f2f"
                text={`血槽${ak.bloodPool}/500`}
                thin
                title="阿卡多血槽：攻击+50、任意单位死亡+50。100：攻击两个目标；200：速度+5攻击+40；300：攻击变法术伤害；400：攻击变真实伤害；500：攻击+100"
              />
            );
          }
          const lx = u.crisis?.laoxian;
          if (u.monsterId === 'ct_077' && lx) {
            return (
              <Bar
                pct={(lx.red / 3) * 100}
                color={lx.red >= 3 ? '#ff3d00' : '#ff7043'}
                text={`红温${lx.red}/3`}
                thin
                title="劳贤红温印记：攻击/受击+1，满时劳贤拍地板（群体100%物理伤害，防御+20、法抗+10、HP恢复500）"
              />
            );
          }
          return null;
        })()}
        {u.energyMax ? <Bar pct={energyPct} color="#ab47bc" text={`能${Math.ceil(u.energy ?? 0)}/${u.energyMax}`} thin /> : null}
        {u.kamuiMaxUses !== undefined && (
          <Bar
            pct={u.kamuiMaxUses > 0 ? ((u.kamuiUses ?? 0) / u.kamuiMaxUses) * 100 : 0}
            color="#f06292"
            text={`${u.kamuiUses ?? 0}/${u.kamuiMaxUses}`}
            thin
          />
        )}
        {u.momentumMax !== undefined && (
          <Bar
            pct={u.momentumMax > 0 ? ((u.momentum ?? 0) / u.momentumMax) * 100 : 0}
            color={u.momentum !== undefined && u.momentum >= 3 ? '#ffb300' : '#ff8a65'}
            text={`势${u.momentum ?? 0}/${u.momentumMax}`}
            thin
          />
        )}
        {u.eightGatesMax !== undefined && (
          <Bar
            pct={u.eightGatesMax > 0 ? ((u.eightGates ?? 0) / u.eightGatesMax) * 100 : 0}
            color="#66bb6a"
            text={`门${u.eightGates ?? 0}/${u.eightGatesMax}`}
            thin
          />
        )}
        {u.eimisSyncMax !== undefined && (() => {
          const sync = u.eimisSyncRate ?? 0;
          const max = u.eimisSyncMax ?? 4;
          const overflowPct = Math.round((u.eimisOverflowMulBonus ?? 0) * 100);
          return (
            <Bar
              pct={max > 0 ? (sync / max) * 100 : 0}
              color={sync >= max ? '#ffd54f' : '#7e57c2'}
              text={overflowPct > 0 ? `同步${sync}/${max} 溢+${overflowPct}%` : `同步${sync}/${max}`}
              thin
              title={`同步率：每点使聚爆上限+5、法穿+${(u.skills?.find((sk) => sk.eimisMresPenPerSync)?.eimisMresPenPerSync) ?? 0}；满时可释放飞至启明之时。${u.eimisNextAtkHuiMang ? '下次普攻为辉芒。' : ''}溢出加成使下次攻击倍率+${overflowPct}%`}
            />
          );
        })()}
        {u.ammo !== undefined && u.ammoMax !== undefined && (() => {
          const banked = Math.round((u.ammoNextMulBonus ?? 0) / (u.ammoMulPerBullet ?? 0.1));
          return (
            <Bar
              pct={u.ammoMax > 0 ? Math.min(100, (u.ammo / u.ammoMax) * 100) : 0}
              color="#f06292"
              text={banked > 0 ? `弹${u.ammo}/${u.ammoMax} 蓄${banked}` : `弹${u.ammo}/${u.ammoMax}`}
              thin
              title={`弹药：每发使下次攻击+${Math.round((u.ammoMulPerBullet ?? 0.1) * 100)}%；已累积 ${banked} 发待释放（下次攻击倍率+${Math.round((u.ammoNextMulBonus ?? 0) * 100)}%）`}
            />
          );
        })()}
      </div>
    </div>
  );
}, unitPropsEq);

// 战斗广播每回合全量重建对象，但大多数单位数值未变：按关键字段浅比，避免无效重渲染
function unitPropsEq(a: { u: Combatant; active?: boolean; selectable?: boolean; selected?: boolean; dead?: boolean; floats: FloatText[]; small?: boolean; vfxClass?: string; onClick?: () => void; onInfo?: () => void }, b: { u: Combatant; active?: boolean; selectable?: boolean; selected?: boolean; dead?: boolean; floats: FloatText[]; small?: boolean; vfxClass?: string; onClick?: () => void; onInfo?: () => void }): boolean {
  const u = a.u, v = b.u;
  return a.active === b.active && a.selectable === b.selectable && a.selected === b.selected && a.dead === b.dead && a.small === b.small && a.vfxClass === b.vfxClass && a.onClick === b.onClick && a.onInfo === b.onInfo &&
    a.floats.length === b.floats.length &&
    u.uid === v.uid && u.alive === v.alive && u.hp === v.hp && u.maxHp === v.maxHp && u.mp === v.mp && u.maxMp === v.maxMp &&
    u.shield === v.shield && (u.shieldStacks ?? 0) === (v.shieldStacks ?? 0) &&
    u.roll === v.roll && u.enraged === v.enraged && u.isCore === v.isCore &&
    u.stats.atk === v.stats.atk && u.stats.def === v.stats.def && u.stats.mres === v.stats.mres &&
    u.statuses.stunTurns === v.statuses.stunTurns &&
    (u.buffs ?? []).length === (v.buffs ?? []).length &&
    (u.kamuiUses ?? 0) === (v.kamuiUses ?? 0) && (u.momentum ?? 0) === (v.momentum ?? 0) &&
    (u.eightGates ?? 0) === (v.eightGates ?? 0) && (u.ammo ?? 0) === (v.ammo ?? 0) &&
    (u.eimisSyncRate ?? 0) === (v.eimisSyncRate ?? 0) && u.form === v.form && u.eimisForm === v.eimisForm &&
    (u.reinOracle?.stacks ?? 0) === (v.reinOracle?.stacks ?? 0) && (u.reinHeartFate ?? false) === (v.reinHeartFate ?? false) &&
    (u.crisis?.akado?.bloodPool ?? 0) === (v.crisis?.akado?.bloodPool ?? 0) &&
    (u.crisis?.laoxian?.red ?? 0) === (v.crisis?.laoxian?.red ?? 0);
}

function Bar({ pct, color, text, thin, title }: { pct: number; color: string; text: string; thin?: boolean; title?: string }) {
  return (
    <div className={`bar ${thin ? 'bar-thin' : ''}`} title={title}>
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      <span className="bar-text">{text}</span>
    </div>
  );
}
