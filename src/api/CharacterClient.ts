/**
 * 角色查询客户端——HTTP 调用 /api/character 系列接口（非实时元系统）。
 * 与 FriendClient / GuildClient 同构：authPost 自动带 token。
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
  return post(`/character${path}`, { ...body, token });
}

export const CharacterClient = {
  /** 按角色名模糊搜索（私聊定向用），返回 { ok, results: [{charId, name}] } */
  search(token: string, charId: number, keyword: string) {
    return authPost('/search', token, { charId, keyword });
  },
};
