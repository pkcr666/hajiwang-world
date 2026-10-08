import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const API_PATH = '/api/save';

// 开发环境统一数据源插件：为 /api/save 提供 GET/PUT，读写项目里的 data/save.json。
// 这样任何浏览器 / 标签页访问同一个 dev 地址都共用同一份存档（构建产物不含该接口，前端自动回退 localStorage）。
function saveFilePlugin(): Plugin {
  const file = path.resolve(process.cwd(), 'data/save.json');
  return {
    name: 'hajiwang-save-file',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(API_PATH, (req, res) => {
        if (req.method === 'GET') {
          try {
            const raw = fs.readFileSync(file, 'utf8');
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(raw);
          } catch {
            res.statusCode = 404; // 还没有存档：前端会把本地这份播种上来
            res.end('{}');
          }
          return;
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk: string) => { body += chunk; });
          req.on('end', () => {
            // 先校验 JSON，避免把文件写坏
            try {
              JSON.parse(body);
            } catch {
              res.statusCode = 400;
              res.end('invalid json');
              return;
            }
            // 写盘：Windows 上若文件正被 IDE/杀软占用会短暂报 EPERM/EBUSY，重试一次
            let lastErr: unknown = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, body);
                res.statusCode = 204;
                res.end();
                return;
              } catch (e) {
                lastErr = e;
                if (attempt === 0) {
                  const until = Date.now() + 120;
                  while (Date.now() < until) { /* 短暂等待后重试，规避瞬时文件锁 */ }
                }
              }
            }
            res.statusCode = 500;
            res.end(`write failed: ${String(lastErr)}`);
          });
          return;
        }
        res.statusCode = 405;
        res.end();
      });
    },
  };
}

// 开发环境：图鉴/关卡库编辑后写回 src/data/*.json，使修改持久化到源码（构建时打包进产物）
function dataWritebackPlugin(): Plugin {
  const monstersFile = path.resolve(process.cwd(), 'src/data/monsters.json');
  const stagesFile = path.resolve(process.cwd(), 'src/data/stages.json');
  const handlePut = (file: string, req: any, res: any) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body);
      } catch {
        res.statusCode = 400;
        res.end('invalid json');
        return;
      }
      try {
        fs.writeFileSync(file, body, 'utf8');
        res.statusCode = 204;
        res.end();
      } catch (e) {
        res.statusCode = 500;
        res.end(`write failed: ${String(e)}`);
      }
    });
  };
  return {
    name: 'hajiwang-data-writeback',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/monsters', (req, res) => {
        if (req.method === 'PUT' || req.method === 'POST') return handlePut(monstersFile, req, res);
        res.statusCode = 405;
        res.end();
      });
      server.middlewares.use('/api/stages', (req, res) => {
        if (req.method === 'PUT' || req.method === 'POST') return handlePut(stagesFile, req, res);
        res.statusCode = 405;
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveFilePlugin(), dataWritebackPlugin()],
  base: './', // 相对路径，打包后可直接用 file:// 双击打开 index.html
  build: {
    // 拆 vendor 分包：react 与 socket.io 单独成块，并行加载 + 内容 hash 长缓存（改业务代码不重新下载 vendor）
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          socketio: ['socket.io-client'],
        },
      },
    },
  },
});