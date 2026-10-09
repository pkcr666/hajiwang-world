// 联机房间服务入口：Socket.IO + HTTP 静态托管 dist
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';
import { RoomManager } from './room';
import { C2S, S2C } from '../src/net/proto';
import type { BattleActMsg, BattleResolveMsg, LobbyCreateMsg, LobbyJoinMsg, VoteSubmitMsg } from '../src/net/proto';

const PORT = Number(process.env.PORT ?? 3001);
const DIST = path.join(import.meta.dirname, '..', 'dist');

// 全局错误观测：socket handler / 投票回调 / 定时器中的未捕获异常写入日志文件，
// 用于定位"卡在正在随机…/无响应"类问题（进程不退出，保持房间服务可用）
process.on('uncaughtException', (e) => {
  try { fs.appendFileSync(path.join(import.meta.dirname, '..', 'server-error.log'), `${new Date().toISOString()} UNCAUGHT ${String(e?.stack ?? e)}\n`); } catch { /* noop */ }
  console.log('[uncaught]', e);
});
process.on('unhandledRejection', (e) => {
  try { fs.appendFileSync(path.join(import.meta.dirname, '..', 'server-error.log'), `${new Date().toISOString()} REJECT ${String((e as Error)?.stack ?? e)}\n`); } catch { /* noop */ }
  console.log('[reject]', e);
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const httpServer = http.createServer((req, res) => {
  // 联机服务器只做静态托管（v1：默认首页；静态资源走相对路径）
  let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '/index.html') {
    urlPath = '/index.html';
  }
  let file = path.join(DIST, urlPath);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  const ext = path.extname(file).toLowerCase();
  // 构建产物带内容 hash：强缓存（浏览器二次打开直接命中缓存）；index.html 不缓存（保证引用最新 hash）
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] ?? 'application/octet-stream' };
  if (urlPath.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});

const io = new Server(httpServer, {
  // 远程联机：放开跨域（客户端可连接任意部署地址）；开发态仍兼容 5173/4173
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 8 * 1024 * 1024,
});

const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  socket.on(C2S.lobbyCreate, (msg: LobbyCreateMsg) => {
    if (!msg?.char?.id || !msg.name) { socket.emit(S2C.err, { text: '参数不完整' }); return; }
    rooms.create(socket, String(msg.name).slice(0, 12), msg.char, msg.dataPack ?? { monsters: [], stages: [], items: [] }, msg.dungeonId);
  });

  socket.on(C2S.lobbyJoin, (msg: LobbyJoinMsg) => {
    if (!msg?.char?.id || !msg.name || !msg.roomId) { socket.emit(S2C.err, { text: '参数不完整' }); return; }
    const r = rooms.join(socket, msg.roomId, String(msg.name).slice(0, 12), msg.char, msg.dataPack ?? { monsters: [], stages: [], items: [] }, msg.dungeonId);
    if ('err' in r) socket.emit(S2C.err, { text: r.err });
  });

  socket.on(C2S.lobbyLeave, () => {
    rooms.leave(socket);
  });

  socket.on(C2S.lobbyPickChar, (msg: { char: never }) => {
    // v1：加入时角色已锁定；换角色预留接口
    void msg;
  });

  socket.on(C2S.lobbyStart, () => {
    const r = rooms.startRun(socket);
    if (r && !r.ok) socket.emit(S2C.err, { text: r.err });
  });

  socket.on(C2S.voteSubmit, (msg: VoteSubmitMsg) => {
    rooms.submitVote(socket, msg?.choiceId);
  });

  socket.on(C2S.battleAct, (msg: BattleActMsg) => {
    rooms.battleAct(socket, msg?.action as never);
  });

  socket.on(C2S.battleResolve, (msg: BattleResolveMsg) => {
    rooms.battleResolve(socket, msg as never);
  });

  socket.on(C2S.shopBuy, (msg: { slotId: string }) => {
    rooms.shopBuy(socket, msg ?? { slotId: '' });
  });

  socket.on(C2S.shopRefresh, () => {
    rooms.shopRefresh(socket);
  });

  socket.on(C2S.shopHaggle, () => {
    rooms.shopHaggle(socket);
  });

  socket.on(C2S.shopSell, (msg: { itemId: string; potion?: boolean }) => {
    rooms.shopSell(socket, msg ?? { itemId: '', potion: false });
  });

  socket.on(C2S.shopRobRequest, () => {
    rooms.shopRobRequest(socket);
  });

  socket.on(C2S.tradePick, (msg: { itemId: string }) => {
    rooms.tradePick(socket, msg ?? { itemId: '' });
  });

  socket.on(C2S.recruitPick, (msg: { candidateId: string }) => {
    rooms.recruitPick(socket, msg ?? { candidateId: '' });
  });

  socket.on(C2S.nodeDone, () => {
    rooms.nodeDone(socket);
  });

  socket.on(C2S.bagOpen, () => {
    rooms.bagOpen(socket);
  });

  socket.on(C2S.bagEquip, (msg: { itemId: string }) => {
    rooms.bagEquip(socket, msg ?? { itemId: '' });
  });

  socket.on(C2S.bagUnequip, (msg: { slot: string }) => {
    rooms.bagUnequip(socket, msg ?? { slot: '' });
  });

  socket.on(C2S.runSync, () => {
    rooms.runSync(socket);
  });

  socket.on(C2S.ping, (d) => {
    socket.emit(S2C.pong, d ?? {});
  });

  socket.on('disconnect', () => {
    rooms.onDisconnect(socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[online] 联机房间服务已启动：http://localhost:${PORT}`);
});
