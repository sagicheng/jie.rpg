/**
 * 好友客户端——HTTP 调用 /api/friend 系列接口（非实时元系统）。
 * 与 GuildClient 同构：authPost 自动带 token。
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
  return post(`/friend${path}`, { ...body, token });
}

export const FriendClient = {
  /** 按角色名发送好友申请 */
  add(token: string, charId: number, targetName: string) {
    return authPost('/add', token, { charId, targetName });
  },
  /** 收到的好友申请 */
  requests(token: string, charId: number) {
    return authPost('/requests', token, { charId });
  },
  /** 好友列表（含在线状态 + 当前地图） */
  list(token: string, charId: number) {
    return authPost('/list', token, { charId });
  },
  /** 接受好友申请 */
  accept(token: string, charId: number, requesterId: number) {
    return authPost('/accept', token, { charId, requesterId });
  },
  /** 拒绝好友申请 */
  decline(token: string, charId: number, requesterId: number) {
    return authPost('/decline', token, { charId, requesterId });
  },
  /** 移除好友 */
  remove(token: string, charId: number, friendId: number) {
    return authPost('/remove', token, { charId, friendId });
  },
};
