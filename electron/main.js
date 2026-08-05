/**
 * Electron 主进程（CommonJS）。
 * 客户端资源由 vite build 产出在 dist/，随包内置；本进程只负责开窗并加载，
 * 联机通过 window.__SERVER_URL__ 把服务器地址注入渲染进程（见 src/core/Net.ts）。
 *
 * 地址解析优先级：
 *   1. userData/server.json     玩家/运维可写覆盖（部署后改这里最稳）
 *   2. extraResources/server.json  打包时预设的云主机地址（electron-builder 复制）
 *   3. 项目根 server.json        开发期
 *   4. 回退 ws://localhost:2567
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_SERVER_URL = 'ws://localhost:2567';

function resolveServerUrl() {
  const candidates = [
    path.join(app.getPath('userData'), 'server.json'),
    path.join(process.resourcesPath, 'server.json'),
    path.join(app.getAppPath(), 'server.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (raw && raw.url) return raw.url;
    } catch {
      /* 文件不存在或 JSON 损坏，尝试下一个 */
    }
  }
  return DEFAULT_SERVER_URL;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#0E1020',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const serverUrl = resolveServerUrl();
  win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));

  // 页面加载完成后注入服务器地址；Net.ts 的 getClient 是惰性调用，必晚于此。
  win.once('did-finish-load', () => {
    win.webContents.executeJavaScript(`window.__SERVER_URL__ = ${JSON.stringify(serverUrl)};`);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
