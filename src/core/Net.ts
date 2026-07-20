/**
 * 联机客户端：封装 colyseus.js 连接。
 * 服务端在 2567 端口监听（见 server/index.ts）。
 * 铁律：客户端构建图绝不 import 服务端入口，只引用本文件（纯浏览器 SDK）。
 */
import { Client, Room } from 'colyseus.js';

const SERVER_PORT = 2567;

/** 浏览器内连接端点：跟随当前页面 host，端口固定 2567（与 dev:server 一致）。 */
function serverEndpoint(): string {
  const host = (typeof window !== 'undefined' && window.location?.hostname) || 'localhost';
  return `ws://${host}:${SERVER_PORT}`;
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

export type { Room };
