/**
 * 认证客户端——HTTP 调用 /api 注册/登录/角色管理。
 *
 * 用法：
 *   const { ok, token, msg } = await AuthClient.register('user', 'pass', 'secure');
 *   const { ok, token, msg } = await AuthClient.login('user', 'pass');
 *   const { ok, characters } = await AuthClient.getCharacters(token);
 */

const API_BASE = (typeof window !== 'undefined') ? `${window.location.protocol}//${window.location.hostname}:2567/api` : '';

async function post(path: string, body: any): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function authPost(path: string, token: string, body: any = {}): Promise<any> {
  return post(path, { ...body, token });
}

export const AuthClient = {
  /** 注册：账号 + 密码 + 安全密码 */
  register(username: string, password: string, security: string) {
    return post('/register', { username, password, security });
  },

  /** 登录 */
  login(username: string, password: string) {
    return post('/login', { username, password });
  },

  /** 登出 */
  logout(token: string) {
    return post('/logout', {}, );
  },

  /** 获取当前账号信息 */
  me(token: string) {
    return authPost('/me', token);
  },

  /** 修改密码 */
  changePassword(token: string, security: string, newPassword: string) {
    return authPost('/change-password', token, { security, newPassword });
  },

  /** 获取角色列表 */
  getCharacters(token: string) {
    return authPost('/characters', token);
  },

  /** 创建角色 */
  createCharacter(token: string, name: string, element: string) {
    return authPost('/character/create', token, { name, element });
  },
};
