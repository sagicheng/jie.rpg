/**
 * 角色查询 REST 路由（非实时元系统，走 /api/character）。
 * 提供「按角色名搜索」能力，支撑客户端私聊按名定向（whisper v2）。
 * 鉴权范式与好友/公会系统同构：token + charId 校验角色归属当前账号。
 */
import { Router, Request, Response } from 'express';
import {
  findAccountByToken, getCharacter, getCharactersByNameLike,
} from '../../core/db';

function ok(data: any, res: Response) { res.json({ ok: true, ...data }); }
function fail(msg: string, res: Response, code = 400) { res.status(code).json({ ok: false, msg }); }

/** 鉴权：token + charId（与公会/好友系统同构）。 */
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

/** 按角色名模糊搜索（私聊定向用）。返回最多 10 个匹配 {charId, name}。 */
router.post('/search', (req, res) => {
  const auth = authChar(req, res); if (!auth) return;
  const kw = typeof req.body.keyword === 'string' ? req.body.keyword.trim() : '';
  if (!kw) return fail('请输入搜索关键字', res);
  if (kw.length > 12) return fail('关键字过长', res);
  const results = getCharactersByNameLike(kw, 10).map((c) => ({ charId: c.charId, name: c.name }));
  ok({ results }, res);
});

export default router;
