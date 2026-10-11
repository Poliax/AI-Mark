import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentStatus, Rubric } from '../types/contracts.js';
import { PANEL_PAGE_HTML } from './panel_page.js';

/**
 * 本地控制服务 —— 面板（注入页 & 独立页）与状态机之间的桥。
 * 只监听 127.0.0.1；供注入面板跨源调用（CORS 放开），通过 WS 推送状态。
 */

export interface AiSettingsView {
  mock: boolean;
  vision: { baseUrl: string; model: string; apiKey: string };
  grading: { baseUrl: string; model: string; apiKey: string };
}

export interface ControlServerHooks {
  getStatus(): AgentStatus & { paused_reason: string | null; last_error: string | null };
  getRubric(): Rubric;
  setRubric(r: Rubric): void;
  /** 读取 AI 设置（Key 已脱敏） */
  getAi(): AiSettingsView;
  /** 更新 AI 设置（面板提交；apiKey 为空或含脱敏符号时保持原 Key） */
  setAi(payload: unknown): void;
  /** 校准（学习教师尺度）状态 */
  getCalibration(): { enabled: boolean; sample_count: number; avg_deviation: number; min_samples: number };
  /** 重置当前评分标准的校准数据 */
  resetCalibration(): void;
  onCommand(command: string): void;
  getRecordImage(kind: 'original' | 'preprocessed', studentIndex?: number): { data: Buffer; mime: string } | null;
  listRecords(): unknown[];
  onLog(message: string): void;
}

export class ControlServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  constructor(
    private readonly hooks: ControlServerHooks,
    private readonly port: number,
    private readonly host = '127.0.0.1',
  ) {}

  get origin(): string {
    return `http://${this.host}:${this.actualPort}`;
  }

  /** 监听后的实际端口（支持 port=0 随机分配，测试用） */
  get actualPort(): number {
    const addr = this.server?.address();
    return typeof addr === 'object' && addr ? addr.port : this.port;
  }

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      this.send(ws);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, this.host, () => resolve());
    });
    return this.origin;
  }

  async close(): Promise<void> {
    for (const c of this.clients) c.close();
    this.wss?.close();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  /** 状态推送（状态机每次状态变化时调用） */
  broadcast(): void {
    for (const ws of this.clients) this.send(ws);
  }

  private send(ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const status = this.hooks.getStatus();
    ws.send(JSON.stringify({ type: 'status', status }));
  }

  private json(res: ServerResponse, code: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'OPTIONS') {
      this.json(res, 204, {});
      return;
    }
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/panel')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(PANEL_PAGE_HTML.replaceAll('__ORIGIN__', this.origin));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        this.json(res, 200, this.hooks.getStatus());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/rubric') {
        this.json(res, 200, this.hooks.getRubric());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/ai') {
        this.json(res, 200, this.hooks.getAi());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai') {
        const body = await readBody(req);
        this.hooks.setAi(body);
        this.hooks.onLog('AI 设置已更新');
        this.json(res, 200, { ok: true });
        this.broadcast();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/calibration') {
        this.json(res, 200, this.hooks.getCalibration());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/calibration/reset') {
        this.hooks.resetCalibration();
        this.hooks.onLog('校准数据已重置');
        this.json(res, 200, { ok: true });
        this.broadcast();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/rubric') {
        const body = (await readBody(req)) as Partial<Rubric>;
        const current = this.hooks.getRubric();
        const next: Rubric = {
          id: current.id,
          title: current.title,
          max_score: Number(body.max_score) || current.max_score,
          description: String(body.description ?? current.description),
          question: String(body.question ?? current.question),
        };
        if (String(body.description ?? '').trim()) {
          next.id = `teacher-${Date.now()}`;
          next.title = `教师自定义评分标准（满分 ${next.max_score}）`;
        }
        this.hooks.setRubric(next);
        this.hooks.onLog('评分标准已更新');
        this.json(res, 200, { ok: true, rubric: next });
        this.broadcast();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/command') {
        const body = (await readBody(req)) as { command?: string };
        if (!body.command) {
          this.json(res, 400, { ok: false, error: '缺少 command' });
          return;
        }
        this.hooks.onCommand(body.command);
        this.json(res, 200, { ok: true });
        this.broadcast();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/records') {
        this.json(res, 200, { records: this.hooks.listRecords() });
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/records/') && url.pathname.endsWith('/image')) {
        const seg = url.pathname.split('/').filter(Boolean); // api, records, <id>, image
        const id = seg[2];
        const kind = url.searchParams.get('type') === 'preprocessed' ? 'preprocessed' : 'original';
        const img = this.hooks.getRecordImage(kind, id ? Number(id) : undefined);
        if (!img) {
          this.json(res, 404, { ok: false, error: 'no image' });
          return;
        }
        res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'no-store' });
        res.end(img.data);
        return;
      }
      this.json(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      this.json(res, 500, { ok: false, error: (e as Error).message });
    }
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
