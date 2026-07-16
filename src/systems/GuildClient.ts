/**
 * 公会客户端——HTTP 调用 /api/guild 系列接口（非实时元系统）。
 * 与 AuthClient 同构：authPost 自动带 token。
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
  return post(`/guild${path}`, { ...body, token });
}

export const GuildClient = {
  /** 创建公会 */
  create(token: string, charId: number, name: string, notice = '') {
    return authPost('/create', token, { charId, name, notice });
  },
  /** 我的公会信息 / 指定公会公开信息（传 guildId） */
  info(token: string, charId: number, guildId?: number) {
    return authPost('/info', token, { charId, ...(guildId !== undefined ? { guildId } : {}) });
  },
  /** 公会浏览列表 */
  list(token: string, charId: number) {
    return authPost('/list', token, { charId });
  },
  /** 申请加入 */
  apply(token: string, charId: number, guildId: number, message = '') {
    return authPost('/apply', token, { charId, guildId, message });
  },
  /** 审批申请（accept: true 同意 / false 拒绝） */
  handleApply(token: string, charId: number, applicationId: number, accept: boolean) {
    return authPost('/handle-apply', token, { charId, applicationId, accept });
  },
  /** 退出公会 */
  leave(token: string, charId: number) {
    return authPost('/leave', token, { charId });
  },
  /** 踢人 */
  kick(token: string, charId: number, targetCharId: number) {
    return authPost('/kick', token, { charId, targetCharId });
  },
  /** 设置职位（'elder' | 'member'） */
  setRank(token: string, charId: number, targetCharId: number, rank: string) {
    return authPost('/set-rank', token, { charId, targetCharId, rank });
  },
  /** 转让会长 */
  transfer(token: string, charId: number, targetCharId: number) {
    return authPost('/transfer', token, { charId, targetCharId });
  },
  /** 解散公会 */
  disband(token: string, charId: number) {
    return authPost('/disband', token, { charId });
  },
  /** 修改公告 */
  setNotice(token: string, charId: number, notice: string) {
    return authPost('/set-notice', token, { charId, notice });
  },
  /** 学习/升级公会技能（消耗公会贡献池，权限 leader/elder） */
  learnSkill(token: string, charId: number, skillId: string) {
    return authPost('/learn-skill', token, { charId, skillId });
  },
};
