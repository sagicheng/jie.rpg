/**
 * 好友系统 REST 路由（非实时元系统，走 /api/friend）。
 * 好友关系存 DB（friends 表），不进 PlayerWorld；变更后通过 GameRoom 的
 * onlineClients 注册表向在线目标定向推送 friendNotify（仿公会聊天跨房推送）。
 */
import { Router, Request, Response } from 'express';
import {
  findAccountByToken, getCharacter, getCharacterByName,
  getFriends, getFriendRequests, getFriendship, addFriendRequest, acceptFriend, removeFriend,
} from './db';
import { sendToCharId, getOnlineLocation } from './rooms/GameRoom';

function ok(data: any, res: Response) { res.json({ ok: true, ...data }); }
function fail(msg: string, res: Response, code = 400) { res.status(code).json({ ok: false, msg }); }

/** 鉴权：token + charId（与公会系统同构）。 */
function authChar(req: Request, res: Response): { charId: number } | null {
  const token = req.body.token || req.headers['x-token'] as string;
  const charId = Number(req.body.charId);
  if (!token) return fail('未登录', res, 401), null;
  if (!charId || !Number.isInteger(charId)) return fail('缺少合法 charId', res), null;
  const acc = findAccountByToken(token);
  if (!acc) return fail('登录已过期，请重新登录', res, 401), null;
  const ch = getCharacter(charId);
  if (!ch) return fail('角色不存在', res, 403), null;
  if (ch.account_id !== acc.id) return fail('该角色不属于当前账号', res, 403), null;
  return { charId };
}

const router = Router();

/** 添加好友（按角色名搜索，发送申请）。 */
router.post('/add', (req, res) => {
  const auth = authChar(req, res); if (!auth) return;
  const name = typeof req.body.targetName === 'string' ? req.body.targetName.trim() : '';
  if (!name) return fail('请输入角色名', res);
  if (name.length < 1 || name.length > 12) return fail('角色名长度不合法', res);
  const target = getCharacterByName(name);
  if (!target) return fail('没有找到该角色', res);
  const targetId = target.id;
  if (targetId === auth.charId) return fail('不能添加自己为好友', res);
  const existing = getFriendship(auth.charId, targetId);
  if (existing) {
    if (existing.status === 'accepted') return fail('你们已经是好友了', res);
    return fail('已存在待处理的好友申请', res);
  }
  addFriendRequest(auth.charId, targetId);
  // 实时推送申请通知给目标（若在线）——服务端专属消息，客户端无法伪造
  sendToCharId(targetId, 'friendNotify', {
    type: 'request', fromCharId: auth.charId, fromName: getCharacter(auth.charId)?.name || '',
  });
  ok({ targetId, targetName: target.name }, res);
});

/** 收到的好友申请列表。 */
router.post('/requests', (req, res) => {
  const auth = authChar(req, res); if (!auth) return;
  ok({ requests: getFriendRequests(auth.charId) }, res);
});

/** 好友列表（含在线状态 + 当前地图场景名）。 */
router.post('/list', (req, res) => {
  const auth = authChar(req, res); if (!auth) return;
  const friends = getFriends(auth.charId).map((f) => {
    const loc = getOnlineLocation(f.charId);
    return { charId: f.charId, name: f.name, online: loc !== null, location: loc || '' };
  });
  ok({ friends }, res);
});

/** 接受好友申请。 */
router.post('/accept', (req, res) => {
  const auth = authChar(req, res); if (!auth) return;
  const requesterId = Number(req.body.requesterId);
  if (!requesterId) return fail('缺少申请者 ID', res);
  const existing = getFriendship(auth.charId, requesterId);
  if (!existing || existing.status !== 'pending' || existing.role !== 'receiver') return fail('没有待处理的该申请', res);
  acceptFriend(requesterId, auth.charId);
  // 通知申请人（若在线）：已成为好友
  sendToCharId(requesterId, 'friendNotify', {
    type: 'accepted', charId: auth.charId, name: getCharacter(auth.charId)?.name || '',
  });
  ok({}, res);
});

/** 拒绝好友申请。 */
router.post('/decline', (req, res) => {
  const auth = authChar(req, res); if (!auth) return;
  const requesterId = Number(req.body.requesterId);
  if (!requesterId) return fail('缺少申请者 ID', res);
  const existing = getFriendship(auth.charId, requesterId);
  if (!existing) return fail('没有该申请', res);
  removeFriend(auth.charId, requesterId);
  sendToCharId(requesterId, 'friendNotify', {
    type: 'declined', charId: auth.charId, name: getCharacter(auth.charId)?.name || '',
  });
  ok({}, res);
});

/** 移除好友。 */
router.post('/remove', (req, res) => {
  const auth = authChar(req, res); if (!auth) return;
  const friendId = Number(req.body.friendId);
  if (!friendId) return fail('缺少好友 ID', res);
  const existing = getFriendship(auth.charId, friendId);
  if (!existing || existing.status !== 'accepted') return fail('你们不是好友', res);
  removeFriend(auth.charId, friendId);
  sendToCharId(friendId, 'friendNotify', {
    type: 'removed', charId: auth.charId, name: getCharacter(auth.charId)?.name || '',
  });
  ok({}, res);
});

export default router;
