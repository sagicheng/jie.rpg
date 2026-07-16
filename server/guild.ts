/**
 * 公会 REST API（Express Router）— 非实时元系统，走 /api/guild
 *
 * 所有接口鉴权：token（账号登录态）+ charId（操作的角色，须属于该 token 账号）。
 * 权限分级：leader(会长) > elder(长老) > member(成员)。
 *
 * POST /api/guild/create        — 创建公会（角色须无公会）
 * POST /api/guild/info          — 我的公会信息 / 指定公会公开信息
 * POST /api/guild/list          — 公会浏览列表
 * POST /api/guild/apply         — 申请加入
 * POST /api/guild/handle-apply  — 审批申请（会长/长老）
 * POST /api/guild/leave         — 退出公会（会长须先转让或解散）
 * POST /api/guild/kick          — 踢人（会长/长老，不可踢同级或上级）
 * POST /api/guild/set-rank      — 设置长老/成员（会长）
 * POST /api/guild/transfer      — 转让会长（会长）
 * POST /api/guild/disband       — 解散公会（会长）
 * POST /api/guild/set-notice    — 修改公告（会长/长老）
 */

import { Router, type Request, type Response } from 'express';
import {
  createGuild, getGuild, getGuildByName, getMemberGuild, getGuildMembers, getGuildMemberCount,
  getGuildApplications, getApplication, listGuilds, addMember, removeMember,
  setMemberRank, setGuildLeader, updateGuildNotice, addApplication, removeApplication,
  removeApplicationsForChar, disbandGuild, getCharacter, findAccountByToken,
  guildExpCap, getGuildSkills, getGuildSkillLevel, setGuildSkillLevel, addGuildContribution,
  getMemberContribution,
} from './db';
import { getGuildSkillDef, guildSkillCost } from './guildSkills';

const router = Router();

/** JSON 响应辅助 */
function ok(data: any, res: Response) { res.json({ ok: true, ...data }); }
function fail(msg: string, res: Response, code = 400) { res.status(code).json({ ok: false, msg }); }

/** 公会名规则 */
const GUILD_NAME_MIN = 2, GUILD_NAME_MAX = 12, NOTICE_MAX = 200, APPLY_MSG_MAX = 200;

/** 权限权重 */
function rankValue(rank: string): number {
  return rank === 'leader' ? 3 : rank === 'elder' ? 2 : 1;
}

/**
 * 鉴权：解析 token → 账号，并校验 charId 属于该账号。
 * 返回 { acc, char } 或向 res 写错误并返回 null。
 */
function authChar(req: Request, res: Response): { accountId: number; charId: number } | null {
  const token = req.body.token || req.headers['x-token'] as string;
  const charId = Number(req.body.charId);
  if (!token) return fail('未登录', res, 401), null;
  if (!charId || !Number.isInteger(charId)) return fail('缺少合法 charId', res), null;
  const acc = findAccountByToken(token);
  if (!acc) return fail('登录已过期，请重新登录', res, 401), null;
  const char = getCharacter(charId);
  if (!char) return fail('角色不存在', res), null;
  if (char.account_id !== acc.id) return fail('该角色不属于当前账号', res, 403), null;
  return { accountId: acc.id, charId };
}

/** 取角色在某公会的 rank（不在公会返回 null）。 */
function rankOf(guildId: number | null, charId: number): string | null {
  if (guildId === null) return null;
  const m = getGuildMembers(guildId).find(x => x.charId === charId);
  return m ? m.rank : null;
}

// ───────────── 创建公会 ─────────────
router.post('/create', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const notice = typeof req.body.notice === 'string' ? req.body.notice.trim().slice(0, NOTICE_MAX) : '';
  if (!name) return fail('公会名不能为空', res);
  if (name.length < GUILD_NAME_MIN || name.length > GUILD_NAME_MAX) return fail(`公会名长度 ${GUILD_NAME_MIN}-${GUILD_NAME_MAX} 字符`, res);
  if (getMemberGuild(auth.charId) !== null) return fail('你已加入一个公会', res);
  if (getGuildByName(name)) return fail('公会名已被占用', res);
  try {
    const gid = createGuild(name, auth.charId);
    if (notice) updateGuildNotice(gid, notice);
    ok({ guildId: gid }, res);
  } catch (e: any) {
    if (e.message === 'ALREADY_IN_GUILD') return fail('你已加入一个公会', res);
    return fail('创建公会失败', res, 500);
  }
});

// ───────────── 公会信息 ─────────────
router.post('/info', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const charGuild = getMemberGuild(auth.charId);

  // 指定 guildId（浏览详情）：返回公开信息（含成长数据，体现公会实力）
  if (req.body.guildId) {
    const g = getGuild(Number(req.body.guildId));
    if (!g) return fail('公会不存在', res);
    return ok({
      inGuild: false,
      guild: {
        id: g.id, name: g.name, notice: g.notice, level: g.level,
        exp: g.exp, expCap: guildExpCap(g.level),
        contribution: g.contribution, skills: getGuildSkills(g.id),
        memberCount: getGuildMemberCount(g.id),
        members: getGuildMembers(g.id),
      },
    }, res);
  }

  if (charGuild === null) return ok({ inGuild: false }, res);
  const g = getGuild(charGuild)!;
  const myRank = rankOf(charGuild, auth.charId)!;
  return ok({
    inGuild: true,
    guild: {
      id: g.id, name: g.name, notice: g.notice, level: g.level, exp: g.exp,
      expCap: guildExpCap(g.level), contribution: g.contribution,
      skills: getGuildSkills(g.id),
      leaderCharId: g.leader_char_id, memberCount: getGuildMemberCount(g.id),
      members: getGuildMembers(g.id),
    },
    myRank,
    myContribution: getMemberContribution(auth.charId),
    // 仅会长/长老可见待审申请
    applications: (myRank === 'leader' || myRank === 'elder') ? getGuildApplications(charGuild) : [],
  }, res);
});

// ───────────── 公会浏览列表 ─────────────
router.post('/list', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const list = listGuilds(50).map(g => ({ id: g.id, name: g.name, level: g.level, memberCount: g.memberCount }));
  ok({ guilds: list }, res);
});

// ───────────── 申请加入 ─────────────
router.post('/apply', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const guildId = Number(req.body.guildId);
  const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, APPLY_MSG_MAX) : '';
  if (!guildId) return fail('缺少 guildId', res);
  if (getMemberGuild(auth.charId) !== null) return fail('你已加入一个公会', res);
  const g = getGuild(guildId);
  if (!g) return fail('公会不存在', res);
  // 是否已申请该公会
  const existing = getGuildApplications(guildId).some(a => a.charId === auth.charId);
  if (existing) return fail('已向该公会提交申请，请等待审批', res);
  try {
    addApplication(guildId, auth.charId, message);
    ok({}, res);
  } catch {
    return fail('申请失败', res, 500);
  }
});

// ───────────── 审批申请 ─────────────
router.post('/handle-apply', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const appId = Number(req.body.applicationId);
  const accept = req.body.accept === true || req.body.accept === 'true';
  const guildId = getMemberGuild(auth.charId);
  if (guildId === null) return fail('你不在公会中', res);
  const myRank = rankOf(guildId, auth.charId);
  if (myRank !== 'leader' && myRank !== 'elder') return fail('仅会长/长老可审批', res);

  const app = getApplication(appId);
  if (!app || app.guild_id !== guildId) return fail('申请不存在', res);

  if (!accept) {
    removeApplication(appId);
    return ok({ accepted: false }, res);
  }

  // 同意：申请人须仍无公会，且未在其他公会
  if (getMemberGuild(app.char_id) !== null) {
    removeApplication(appId);
    return fail('该玩家已加入其他公会', res);
  }
  try {
    addMember(guildId, app.char_id, 'member');
    removeApplication(appId);
    removeApplicationsForChar(app.char_id); // 清掉他在别的公会的待审
    ok({ accepted: true }, res);
  } catch {
    return fail('同意失败', res, 500);
  }
});

// ───────────── 退出公会 ─────────────
router.post('/leave', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const guildId = getMemberGuild(auth.charId);
  if (guildId === null) return fail('你不在公会中', res);
  const myRank = rankOf(guildId, auth.charId);
  if (myRank === 'leader') {
    if (getGuildMemberCount(guildId) > 1) return fail('会长为最后离开者：请先转让会长或解散公会', res);
    disbandGuild(guildId);
    return ok({ disbanded: true }, res);
  }
  removeMember(guildId, auth.charId);
  ok({}, res);
});

// ───────────── 踢人 ─────────────
router.post('/kick', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const targetCharId = Number(req.body.targetCharId);
  const guildId = getMemberGuild(auth.charId);
  if (guildId === null) return fail('你不在公会中', res);
  const myRank = rankOf(guildId, auth.charId);
  if (myRank !== 'leader' && myRank !== 'elder') return fail('仅会长/长老可踢人', res);
  if (!targetCharId || targetCharId === auth.charId) return fail('无效目标', res);

  const targetRank = rankOf(guildId, targetCharId);
  if (!targetRank) return fail('目标不在本公会', res);
  if (rankValue(myRank) <= rankValue(targetRank)) return fail('权限不足：不可操作同级或上级', res);

  removeMember(guildId, targetCharId);
  ok({}, res);
});

// ───────────── 设置职位（长老/成员） ─────────────
router.post('/set-rank', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const targetCharId = Number(req.body.targetCharId);
  const rank = req.body.rank;
  if (rank !== 'elder' && rank !== 'member') return fail('职位非法', res);
  const guildId = getMemberGuild(auth.charId);
  if (guildId === null) return fail('你不在公会中', res);
  if (rankOf(guildId, auth.charId) !== 'leader') return fail('仅会长可设置职位', res);
  if (!rankOf(guildId, targetCharId)) return fail('目标不在本公会', res);
  if (targetCharId === getGuild(guildId)!.leader_char_id) return fail('不可修改会长职位', res);
  setMemberRank(guildId, targetCharId, rank);
  ok({}, res);
});

// ───────────── 转让会长 ─────────────
router.post('/transfer', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const targetCharId = Number(req.body.targetCharId);
  const guildId = getMemberGuild(auth.charId);
  if (guildId === null) return fail('你不在公会中', res);
  if (rankOf(guildId, auth.charId) !== 'leader') return fail('仅会长可转让', res);
  if (!rankOf(guildId, targetCharId)) return fail('目标不在本公会', res);
  if (targetCharId === auth.charId) return fail('不可转让给自己', res);
  setMemberRank(guildId, targetCharId, 'leader');
  setMemberRank(guildId, auth.charId, 'member');
  setGuildLeader(guildId, targetCharId);
  ok({}, res);
});

// ───────────── 解散公会 ─────────────
router.post('/disband', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const guildId = getMemberGuild(auth.charId);
  if (guildId === null) return fail('你不在公会中', res);
  if (rankOf(guildId, auth.charId) !== 'leader') return fail('仅会长可解散', res);
  disbandGuild(guildId);
  ok({}, res);
});

// ───────────── 修改公告 ─────────────
router.post('/set-notice', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const notice = typeof req.body.notice === 'string' ? req.body.notice.trim().slice(0, NOTICE_MAX) : '';
  const guildId = getMemberGuild(auth.charId);
  if (guildId === null) return fail('你不在公会中', res);
  const myRank = rankOf(guildId, auth.charId);
  if (myRank !== 'leader' && myRank !== 'elder') return fail('仅会长/长老可修改公告', res);
  updateGuildNotice(guildId, notice);
  ok({}, res);
});

// ───────────── 学习公会技能（会长/长老，消耗公会贡献池） ─────────────
router.post('/learn-skill', (req: Request, res: Response) => {
  const auth = authChar(req, res); if (!auth) return;
  const skillId = typeof req.body.skillId === 'string' ? req.body.skillId : '';
  const guildId = getMemberGuild(auth.charId);
  if (guildId === null) return fail('你不在公会中', res);
  const myRank = rankOf(guildId, auth.charId);
  if (myRank !== 'leader' && myRank !== 'elder') return fail('仅会长/长老可学习公会技能', res);
  const def = getGuildSkillDef(skillId);
  if (!def) return fail('未知公会技能', res);
  const cur = getGuildSkillLevel(guildId, skillId);
  if (cur >= def.maxLevel) return fail('该技能已达最高等级', res);
  const cost = guildSkillCost(def, cur);
  const g = getGuild(guildId)!;
  if (g.contribution < cost) return fail(`公会贡献池不足（需 ${cost}，现有 ${g.contribution}）`, res);
  addGuildContribution(guildId, -cost);
  setGuildSkillLevel(guildId, skillId, cur + 1);
  ok({ skillId, level: cur + 1, contribution: g.contribution - cost }, res);
});

export default router;
