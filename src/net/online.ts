// 联机客户端单例：连接房间服务、事件订阅分发
import { io, type Socket } from 'socket.io-client';
import { S2C } from './proto';

type Handler = (payload: unknown) => void;

// 服务器地址可配置：默认本机联机；远程联机时在联机大厅填写公网地址（存 localStorage）
export const ONLINE_DEFAULT_URL = 'http://localhost:3001';
export const onlineUrlOf = (): string => {
  const saved = localStorage.getItem('hakiw_online_url');
  if (saved) return saved;
  // 页面是从联机服务器（3001 静态托管）打开的：默认连同源地址，远程玩家无需手动配置
  const { protocol, hostname, port } = window.location;
  if (!hostname) return ONLINE_DEFAULT_URL;
  // 本机/开发端口：连本地 3001
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    return ONLINE_DEFAULT_URL;
  }
  // 远程场景（ngrok 公网 / 局域网 IP）：同源。
  // 注意 https 默认 443 / http 默认 80 时 location.port 为空字符串，此时不带端口拼地址
  if (port && !['5173', '4173', '8080'].includes(port)) {
    return `${protocol}//${hostname}:${port}`;
  }
  if (!port && (protocol === 'https:' || protocol === 'http:')) {
    return `${protocol}//${hostname}`;
  }
  return ONLINE_DEFAULT_URL;
};
export const setOnlineUrl = (url: string): void => {
  const clean = url.trim().replace(/\/+$/, '');
  localStorage.setItem('hakiw_online_url', clean || ONLINE_DEFAULT_URL);
};

class OnlineClient {
  socket: Socket | null = null;
  connected = false;
  myPlayerId = '';
  roomId = '';
  private handlers = new Map<string, Set<Handler>>();

  connect(url?: string): Promise<void> {
    if (this.socket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = io(url ?? onlineUrlOf(), { transports: ['websocket'], reconnection: true, reconnectionDelay: 1000 });
      this.socket = s;
      s.on('connect', () => {
        this.connected = true;
        resolve();
      });
      s.on('connect_error', (e: Error) => {
        if (!this.connected) reject(e);
      });
      for (const ev of Object.values(S2C)) {
        s.on(ev, (payload: unknown) => {
          const set = this.handlers.get(ev);
          if (!set) return;
          for (const cb of [...set]) {
            try { cb(payload); } catch (e) { console.error('[online] handler error', ev, e); }
          }
        });
      }
    });
  }

  on(event: string, cb: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(cb);
    this.handlers.set(event, set);
    return () => {
      set.delete(cb);
    };
  }

  emit(event: string, payload: unknown): void {
    this.socket?.emit(event, payload);
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.connected = false;
    this.handlers.clear();
  }
}

export const online = new OnlineClient();
