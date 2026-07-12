/**
 * 认证 REST API（Express Router）
 *
 * POST /api/register — 注册（账号+密码+安全密码）
 * POST /api/login    — 登录（账号+密码）
 * POST /api/logout   — 登出（token）
 * POST /api/me       — 当前用户信息（token）
 * POST /api/change-password — 修改密码（token+安全密码+新密码）
 * POST /api/characters — 获取角色列表（token）
 * POST /api/character/create — 创建角色（token+名字+元素）
 */

import { Router, type Request, type Response } from 'express';
import { hashSync, compareSync } from 'bcryptjs';
import { randomUUID } from 'crypto';
import {
  createAccount, findAccount, findAccountByToken,
  setAccountToken, clearAccountToken, changePassword,
  createCharacter, getCharacters, getCharacter,
} from './db';

const router = Router();

/** bcrypt salt */
const ROUNDS = 10;

/** JSON 响应辅助 */
function ok(data: any, res: Response) { res.json({ ok: true, ...data }); }
function fail(msg: string, res: Response, code = 400) { res.status(code).json({ ok: false, msg }); }

// ───────────── 注册 ─────────────
router.post('/register', (req: Request, res: Response) => {
  const { username, password, security } = req.body;
  if (!username || !password || !security) return fail('账号、密码、安全密码不能为空', res);
  if (typeof username !== 'string' || username.length < 2 || username.length > 20) return fail('账号长度 2-20 字符', res);
  if (typeof password !== 'string' || password.length < 4 || password.length > 32) return fail('密码长度 4-32 字符', res);
  if (typeof security !== 'string' || security.length < 4 || security.length > 32) return fail('安全密码长度 4-32 字符', res);

  try {
    const id = createAccount(
      username.trim(),
      hashSync(password, ROUNDS),
      hashSync(security, ROUNDS),
    );
    const token = randomUUID();
    setAccountToken(id, token);
    ok({ token, accountId: id }, res);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return fail('账号已存在', res);
    return fail('注册失败', res, 500);
  }
});

// ───────────── 登录 ─────────────
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) return fail('账号和密码不能为空', res);

  const acc = findAccount(String(username).trim());
  if (!acc) return fail('账号或密码错误', res);
  if (!compareSync(String(password), acc.password_hash)) return fail('账号或密码错误', res);

  const token = randomUUID();
  setAccountToken(acc.id, token);
  ok({ token, accountId: acc.id }, res);
});

// ───────────── 登出 ─────────────
router.post('/logout', (req: Request, res: Response) => {
  const token = req.body.token || req.headers['x-token'] as string;
  const acc = token ? findAccountByToken(token) : undefined;
  if (acc) clearAccountToken(acc.id);
  res.json({ ok: true });
});

// ───────────── 当前用户 ─────────────
router.post('/me', (req: Request, res: Response) => {
  const token = req.body.token || req.headers['x-token'] as string;
  if (!token) return fail('未登录', res, 401);
  const acc = findAccountByToken(token);
  if (!acc) return fail('登录已过期，请重新登录', res, 401);
  ok({ accountId: acc.id, username: acc.username }, res);
});

// ───────────── 修改密码 ─────────────
router.post('/change-password', (req: Request, res: Response) => {
  const token = req.body.token || req.headers['x-token'] as string;
  const { security, newPassword } = req.body;
  if (!token) return fail('未登录', res, 401);
  if (!security || !newPassword) return fail('安全密码和新密码不能为空', res);
  if (typeof newPassword !== 'string' || newPassword.length < 4 || newPassword.length > 32) return fail('新密码长度 4-32 字符', res);

  const acc = findAccountByToken(token);
  if (!acc) return fail('登录已过期', res, 401);
  if (!compareSync(String(security), acc.security_hash)) return fail('安全密码错误', res);

  changePassword(acc.id, hashSync(String(newPassword), ROUNDS));
  ok({}, res);
});

// ───────────── 角色列表 ─────────────
router.post('/characters', (req: Request, res: Response) => {
  const token = req.body.token || req.headers['x-token'] as string;
  if (!token) return fail('未登录', res, 401);
  const acc = findAccountByToken(token);
  if (!acc) return fail('登录已过期', res, 401);
  const chars = getCharacters(acc.id).map(c => ({ id: c.id, name: c.name, element: c.element, created_at: c.created_at }));
  ok({ characters: chars }, res);
});

// ───────────── 创建角色 ─────────────
router.post('/character/create', (req: Request, res: Response) => {
  const token = req.body.token || req.headers['x-token'] as string;
  const { name, element } = req.body;
  if (!token) return fail('未登录', res, 401);
  if (!name || !element) return fail('角色名和元素不能为空', res);
  if (typeof name !== 'string' || name.length < 1 || name.length > 12) return fail('角色名长度 1-12 字符', res);

  const acc = findAccountByToken(token);
  if (!acc) return fail('登录已过期', res, 401);

  try {
    const ch = createCharacter(acc.id, String(name).trim(), String(element));
    ok({ character: { id: ch.id, name: ch.name, element: ch.element } }, res);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return fail('该账号下已有同名角色', res);
    return fail('创建角色失败', res, 500);
  }
});

export default router;
