// 联机大厅：创建/加入房间、选择副本与角色、服务器地址配置、玩家列表、房主开始
import { useEffect, useMemo, useState } from 'react';
import type { Character, SaveData } from '../types';
import { C2S, S2C } from '../net/proto';
import type { PlayerView } from '../net/proto';
import { online, onlineUrlOf, setOnlineUrl } from '../net/online';

interface RoomViewMsg {
  roomId?: string;
  hostId?: string;
  phase?: 'lobby' | 'run' | 'done';
  players?: PlayerView[];
  myPlayerId?: string;
  action?: string;
}

interface Props {
  save: SaveData;
  onBack: () => void;
  onRunStart: () => void;
}

// 联机可选副本：新手村（终局联系，怪物 HP 自适应人数） / 灾厄泰拉（固定难度）
export const ONLINE_DUNGEONS = [
  { id: 'starterVillage', name: '新手村（终局联系）', desc: '自适应难度：怪物 HP 1人100% / 2人150% / 3人以上200%' },
  { id: 'preWallCalamity', name: '灾厄泰拉', desc: '固定难度，怪物数值不随人数变化' },
] as const;

export default function OnlineLobby({ save, onBack, onRunStart }: Props) {
  const chars = useMemo(() => save.characters.filter((c): c is Character => !!c), [save]);
  const [name, setName] = useState('');
  const [charId, setCharId] = useState(chars[0]?.id ?? '');
  const [dungeonId, setDungeonId] = useState<string>('preWallCalamity');
  const [serverUrl, setServerUrl] = useState(onlineUrlOf());
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const applyServerUrl = () => {
    setOnlineUrl(serverUrl);
    online.disconnect();
    online.connect(onlineUrlOf()).then(
      () => setConnected(true),
      () => setToast(`无法连接联机服务（${serverUrl}）——请确认服务端已启动且该地址可访问`),
    );
  };

  useEffect(() => {
    online.disconnect();
    online.connect().then(
      () => setConnected(true),
      () => setToast(`无法连接联机服务（${onlineUrlOf()}）——请先运行 npm run server`),
    );
    const off1 = online.on(S2C.roomUpdate, (d) => {
      const m = d as RoomViewMsg;
      // 先赋值 myPlayerId，再判房主身份（避免时序错位导致房主看不到开始按钮）
      if (m.myPlayerId) online.myPlayerId = m.myPlayerId;
      if (m.action === 'created' || m.action === 'joined') online.myPlayerId = m.myPlayerId ?? online.myPlayerId;
      if (m.roomId) online.roomId = m.roomId;
      if (m.players) setPlayers(m.players);
      if (m.hostId) setIsHost(m.hostId === online.myPlayerId);
    });
    const off2 = online.on(S2C.err, (d) => setToast((d as { text: string }).text ?? '操作失败'));
    const off3 = online.on(S2C.runState, () => {
      setToast('');
      onRunStart();
    });
    return () => { off1(); off2(); off3(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dataPack = useMemo(() => ({
    monsters: (save as unknown as { customMonsters?: unknown[] }).customMonsters ?? [],
    stages: (save as unknown as { customStages?: unknown[] }).customStages ?? [],
    items: (save as unknown as { customItems?: unknown[] }).customItems ?? [],
  }), [save]);

  const char = chars.find((c) => c.id === charId) ?? chars[0];

  const create = () => {
    if (!name.trim() || !char) { setToast('请填写昵称并选择角色'); return; }
    setBusy(true);
    online.emit(C2S.lobbyCreate, { name: name.trim(), char, dataPack, dungeonId });
    setTimeout(() => setBusy(false), 800);
  };

  const join = () => {
    if (!name.trim() || !char) { setToast('请填写昵称并选择角色'); return; }
    if (!roomCode.trim()) { setToast('请输入房间号'); return; }
    setBusy(true);
    online.emit(C2S.lobbyJoin, { roomId: roomCode.trim().toUpperCase(), name: name.trim(), char, dataPack, dungeonId });
    setTimeout(() => setBusy(false), 800);
  };

  const start = () => {
    if (!isHost) return;
    online.emit(C2S.lobbyStart, {});
  };

  const style: Record<string, React.CSSProperties> = {
    wrap: { minHeight: '100vh', background: 'radial-gradient(1200px 600px at 20% 0%, #1d2b53 0%, #0b1020 55%, #060a14 100%)', color: '#e8ecf5', fontFamily: 'inherit', padding: 24 },
    card: { background: 'rgba(20,28,54,.82)', border: '1px solid rgba(140,165,255,.25)', borderRadius: 14, padding: 20, maxWidth: 560, margin: '0 auto 16px', boxShadow: '0 8px 32px rgba(0,0,0,.35)' },
    h1: { margin: '0 0 4px', fontSize: 22, letterSpacing: 2 },
    sub: { color: '#8fa0c8', fontSize: 13, marginBottom: 18 },
    row: { display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' },
    input: { flex: 1, minWidth: 160, background: '#0d1326', border: '1px solid #2c3a68', color: '#e8ecf5', borderRadius: 8, padding: '9px 12px', fontSize: 14, outline: 'none' },
    sel: { flex: 1, minWidth: 180, background: '#0d1326', border: '1px solid #2c3a68', color: '#e8ecf5', borderRadius: 8, padding: '9px 8px', fontSize: 14, outline: 'none' },
    btn: { background: 'linear-gradient(135deg,#3d5afe,#6a4cff)', border: 'none', color: '#fff', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer', fontWeight: 600 },
    btnGhost: { background: 'rgba(255,255,255,.06)', border: '1px solid #3a4a7c', color: '#c8d2ea', borderRadius: 8, padding: '10px 14px', fontSize: 13, cursor: 'pointer' },
    btnPrimary: { background: 'linear-gradient(135deg,#ff6b3d,#ff2e63)', border: 'none', color: '#fff', borderRadius: 8, padding: '12px 20px', fontSize: 15, cursor: 'pointer', fontWeight: 700, width: '100%' },
    player: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(255,255,255,.05)', borderRadius: 8, marginBottom: 8 },
    dot: { width: 8, height: 8, borderRadius: 4, background: '#3ddc84' },
    dotOff: { width: 8, height: 8, borderRadius: 4, background: '#5a6a8c' },
    tag: { fontSize: 11, color: '#ffc46b', border: '1px solid #ffc46b55', borderRadius: 6, padding: '1px 6px' },
    toast: { color: '#ff8f6b', fontSize: 13, marginTop: 8 },
  };

  return (
    <div style={style.wrap}>
      <div style={style.card}>
        <h1 style={style.h1}>哈基汪世界 · 联机探险</h1>
        <div style={style.sub}>服务器权威 + 全员投票推进；战斗由每位玩家操作自己的角色（Beta）</div>
        <div style={style.row}>
          <input style={style.input} placeholder="你的昵称" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {/* 副本选择 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#8fa0c8', fontSize: 12, marginBottom: 6 }}>选择副本（房主创建时生效）：</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {ONLINE_DUNGEONS.map((d) => (
              <div key={d.id} onClick={() => setDungeonId(d.id)}
                style={{ flex: 1, border: dungeonId === d.id ? '1px solid #ffc46b' : '1px solid #2c3a68', background: dungeonId === d.id ? 'rgba(255,196,107,.08)' : '#0d1326', borderRadius: 10, padding: '8px 10px', cursor: 'pointer' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: dungeonId === d.id ? '#ffc46b' : '#e8ecf5' }}>{d.name}</div>
                <div style={{ fontSize: 11, color: '#8fa0c8', marginTop: 2 }}>{d.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={style.row}>
          <select style={style.sel} value={charId} onChange={(e) => setCharId(e.target.value)}>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name}（Lv.{c.level}{c.job ? ` · ${c.job}` : ''}）</option>)}
          </select>
          <button style={style.btnGhost} onClick={onBack}>返回</button>
        </div>
        {/* 服务器地址（远程联机用） */}
        <div style={style.row}>
          <input style={style.input} placeholder="联机服务器地址" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
          <button style={style.btnGhost} onClick={applyServerUrl}>连接</button>
        </div>
        {!connected && <div style={style.toast}>正在连接联机服务…</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button style={{ ...style.btn, flex: 1 }} disabled={busy || !connected} onClick={create}>创建房间（房主）</button>
          <input style={{ ...style.input, flex: 1 }} placeholder="输入房间号加入" value={roomCode} onChange={(e) => setRoomCode(e.target.value)} />
          <button style={{ ...style.btnGhost }} disabled={busy || !connected} onClick={join}>加入</button>
        </div>
        {toast && <div style={style.toast}>{toast}</div>}
      </div>

      {online.roomId && (
        <div style={style.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <span style={{ color: '#8fa0c8', fontSize: 13 }}>房间号：</span>
              <b style={{ letterSpacing: 3, color: '#ffc46b' }}>{online.roomId}</b>
            </div>
            <span style={{ fontSize: 12, color: players.length >= 2 ? '#3ddc84' : '#8fa0c8' }}>
              {players.length} / 4 人 {isHost ? '（你是房主）' : ''}
            </span>
          </div>
          {players.map((p) => (
            <div key={p.playerId} style={style.player}>
              <span style={p.online ? style.dot : style.dotOff} />
              <span style={{ flex: 1 }}>{p.name} {p.charName ? `· ${p.charName} Lv.${p.charJob ?? ''}` : '（未选择角色）'}</span>
              {p.isHost && <span style={style.tag}>房主</span>}
              {!p.online && <span style={{ color: '#8fa0c8', fontSize: 12 }}>离线</span>}
            </div>
          ))}
          {isHost && (
            <button style={{ ...style.btnPrimary, marginTop: 10 }} disabled={players.length < 2}
              onClick={start}>
              {players.length < 2 ? `还需 ${2 - players.length} 名玩家` : `开始探险（${ONLINE_DUNGEONS.find((d) => d.id === dungeonId)?.name ?? '灾厄泰拉'}）`}
            </button>
          )}
          {!isHost && <div style={{ color: '#8fa0c8', fontSize: 13, textAlign: 'center', marginTop: 8 }}>等待房主开始…</div>}
        </div>
      )}
    </div>
  );
}
