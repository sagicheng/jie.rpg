/**
 * 释放 2567 端口上的旧服务端进程（Windows: netstat+taskkill / *nix: lsof）。
 * 在 `npm run dev:server` 启动 tsc+node 之前自动执行，
 * 这样改了服务端代码后只需重新 `npm run dev`，旧进程会被自动清理，不必手动 netstat/taskkill。
 * 无依赖、纯 Node 内置模块；任何错误都吞掉（最坏情况：端口没被清，node 启动报 EADDRINUSE，不影响其它）。
 */
const { execSync } = require('child_process');
const PORT = Number(process.env.PORT) || 2567;

function killWindows() {
  let out = '';
  try {
    out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' });
  } catch (_) { /* netstat 无匹配时返回非零，正常 */ }
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (line.includes('LISTENING')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
  }
  if (pids.size === 0) { console.log(`[kill-server] 端口 ${PORT} 空闲，无需清理`); return; }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log(`[kill-server] 已杀掉占用 ${PORT} 的旧进程 PID=${pid}`);
    } catch (_) { /* 可能已自行退出 */ }
  }
}

function killUnix() {
  try {
    execSync(`lsof -ti:${PORT} | xargs -r kill -9`, { stdio: 'ignore' });
    console.log(`[kill-server] 已清理 ${PORT} 上的旧进程`);
  } catch (_) { /* 无占用 */ }
}

try {
  if (process.platform === 'win32') killWindows();
  else killUnix();
} catch (_) { /* 全吞 */ }
