/**
 * 登录 / 注册服务：封装服务器 REST 接口（Express 与 Colyseus 同端口 2567）。
 *
 * P1 自动流程：读缓存 → 校验 → 否则自动注册 dev 账号 + 自动建角色，并缓存 token/characterId。
 * 这样你打开编辑器点 Preview 就能直接连上，先验证「操作空间」，账号体系正式上线后把这里换成你的登录 UI 即可。
 *
 * 协议严格对齐 server/core/auth.ts：
 *   POST /api/register   { username, password, security }  -> { token, accountId }
 *   POST /api/login      { username, password }            -> { token, accountId }
 *   POST /api/characters { token }                         -> { characters:[{id,name,element}] }
 *   POST /api/character/create { token, name, element }    -> { character:{id,name,element} }
 */
import { sys } from 'cc';

export interface Session {
  token: string;
  characterId: number;
}

export class AuthService {
  private static host(): string {
    // 注意：Cocos Preview 运行时 location.hostname 是伪主机名 "scene"，不可用。
    // dev:server 固定在本机 2567，P1 阶段直接使用 127.0.0.1 最稳（避免 localhost 解析到 ::1）。
    // 正式部署到远程服务器时，再把这里换成真实 host（例如从 URL 参数读取）。
    return '127.0.0.1';
  }

  private static async post(path: string, body: any): Promise<any> {
    const url = `http://${this.host()}:2567/api${path}`;
    const fetchFn: any = (globalThis as any).fetch;
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch (e: any) {
      return { ok: false, msg: '网络错误：' + (e?.message || e) };
    }
  }

  /** 取得（或自动创建）一个可用的登录会话。 */
  static async ensureSession(): Promise<Session> {
    const cachedToken = sys.localStorage.getItem('jie_token') || '';
    const cachedChar = sys.localStorage.getItem('jie_charId') || '';

    if (cachedToken && cachedChar) {
      const me = await this.post('/me', { token: cachedToken });
      if (me.ok) {
        const chars = await this.post('/characters', { token: cachedToken });
        if (chars.ok && Array.isArray(chars.characters) &&
          chars.characters.some((c: any) => String(c.id) === String(cachedChar))) {
          return { token: cachedToken, characterId: Number(cachedChar) };
        }
      }
    }

    // 自动注册 dev 账号（仅 P1 联机验证用，正式账号体系上线后删除这段代码）
    const uname = 'cocos_dev_' + Math.random().toString(36).slice(2, 8);
    const pwd = 'dev1234';
    const reg = await this.post('/register', { username: uname, password: pwd, security: pwd });
    if (!reg.ok) throw new Error('注册失败：' + (reg.msg || '未知错误'));
    const token = reg.token as string;

    const chars = await this.post('/characters', { token });
    let characterId: number;
    if (chars.ok && Array.isArray(chars.characters) && chars.characters.length > 0) {
      characterId = chars.characters[0].id;
    } else {
      const elements = ['fire', 'water', 'ice', 'wind', 'light', 'dark'];
      const el = elements[Math.floor(Math.random() * elements.length)];
      const cr = await this.post('/character/create', {
        token,
        name: '测试' + Math.random().toString(36).slice(2, 5),
        element: el,
      });
      if (!cr.ok) throw new Error('创建角色失败：' + (cr.msg || '未知错误'));
      characterId = cr.character.id;
    }

    sys.localStorage.setItem('jie_token', token);
    sys.localStorage.setItem('jie_charId', String(characterId));
    return { token, characterId };
  }
}
