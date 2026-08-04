/**
 * 从 TypeScript 文件中按行号提取方法体，转换为独立的导出函数。
 * 用法：node scripts/extract_methods.mjs SRC_FILE START END FUNC_NAME >> OUTPUT.ts
 */
import { readFileSync } from 'fs';
const [src, start, end, funcName] = process.argv.slice(2);
const lines = readFileSync(src, 'utf8').split('\n');
const body = lines.slice(Number(start) - 1, Number(end)).join('\n');
// 移除方法签名行，保留方法体
const bodyStart = body.indexOf('{') + 1;
const methodBody = body.slice(bodyStart);
// 找到最后的 }
let braceCount = 0;
let lastBrace = methodBody.length - 1;
let started = false;
for (let i = 0; i < methodBody.length; i++) {
  const ch = methodBody[i];
  if (ch === '{') { braceCount++; started = true; }
  else if (ch === '}') {
    braceCount--;
    if (started && braceCount < 0) { lastBrace = i; break; }
  }
}
const content = methodBody.slice(0, lastBrace);
// 替换 this.xxx → scene.xxx（仅属性访问，不替换 this 本身）
const fixed = content.replace(/\bthis\./g, 'scene.');
console.log(`export function ${funcName}(scene: any): void {${fixed}}`);
