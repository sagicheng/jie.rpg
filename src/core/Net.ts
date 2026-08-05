/**
 * 联机客户端：封装 colyseus.js 连接。
 * 服务端在 2567 端口监听（见 server/index.ts）。
 * 铁律：客户端构建图绝不 import 服务端入口，只引用本文件（纯浏览器 SDK）。
 */
import { Client, Room } from 'colyseus.js';

const SERVER_PORT = 2567;
const STORAGE_KEY = 'jie_server_url';

/** 读取玩家在上次游玩时保存的服务器地址（localStorage）。 */
function loadSavedUrl(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * 连接端点解析（优先级从高到低）：
 *   1. 玩家在游戏内保存的地址（localStorage）
 *   2. Electron 主进程通过 preload 注入的 window.__SERVER_URL__
 *   3. 开发回退：Vite dev 页面在 3000，服务端在 2567
 * 自定义地址应自带 ws:// 或 wss:// 前缀，故直接返回、不拼协议。
 */
function serverEndpoint(): string {
  if (typeof window === 'undefined') return `ws://localhost:${SERVER_PORT}`;

  const saved = loadSavedUrl();
  const injected = (window as unknown as Record<string, unknown>).__SERVER_URL__ as string | undefined;
  const custom = saved ?? injected;
  if (custom) return custom;

  const { protocol, port } = window.location;
  if (port === '3000') return `ws://localhost:${SERVER_PORT}`;
  const proto = protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}

// colyseus.js 浏览器运行时偶尔引用 global，这里无副作用补一下，避免崩。
if (typeof window !== 'undefined' && !(window as unknown as Record<string, unknown>).global) {
  (window as unknown as Record<string, unknown>).global = window;
}

let _client: Client | null = null;

/** 取得（惰性创建）全局唯一的 colyseus 客户端。 */
export function getClient(): Client {
  if (!_client) _client = new Client(serverEndpoint());
  return _client;
}

/** 重新指向端点（一般无需调用，保留以便部署/测试切换地址）。 */
export function resetClient(): void {
  _client = null;
}

/** 玩家在游戏内设置服务器地址：持久化到 localStorage 并重建连接。 */
export function setServerUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url.trim());
  } catch {
    /* 隐私模式等场景忽略写入失败 */
  }
  _client = null;
}

export type { Room };
