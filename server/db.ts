/**
 * SQLite 数据库层 — 账号/角色持久化
 *
 * 表结构：
 *   accounts:   id, username, password_hash, security_hash, token, created_at
 *   characters: id, account_id, name, element, world_data(JSON), created_at
 *
 * 安全密码=改密时的二级验证；token=登录态UUID。
 */

import Database from 'better-sqlite3';
import path from 'path';

// 项目根目录：process.cwd() = E:/My2ddemo/game（npm run dev:server 的启动目录）
const DB_PATH = path.resolve(process.cwd(), 'data.db');
const db = new Database(DB_PATH);

// 开 WAL 模式 + 外键
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ——— 建表（幂等）———
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    security_hash TEXT NOT NULL,
    token         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS characters (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    INTEGER NOT NULL REFERENCES accounts(id),
    name          TEXT NOT NULL,
    element       TEXT NOT NULL,
    world_data    TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, name)
  );
`);

// ============= 账号操作 =============

export interface AccountRow {
  id: number;
  username: string;
  password_hash: string;
  security_hash: string;
  token: string | null;
  created_at: string;
}

/** 注册新账号。返回 account id，失败抛异常。 */
export function createAccount(username: string, passwordHash: string, securityHash: string): number {
  const stmt = db.prepare('INSERT INTO accounts (username, password_hash, security_hash) VALUES (?, ?, ?)');
  const result = stmt.run(username, passwordHash, securityHash);
  return Number(result.lastInsertRowid);
}

/** 按用户名查找账号。 */
export function findAccount(username: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM accounts WHERE username = ?').get(username) as AccountRow | undefined;
}

/** 按 token 查找账号。 */
export function findAccountByToken(token: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM accounts WHERE token = ?').get(token) as AccountRow | undefined;
}

/** 登录：更新 token。 */
export function setAccountToken(id: number, token: string): void {
  db.prepare('UPDATE accounts SET token = ? WHERE id = ?').run(token, id);
}

/** 登出：清除 token。 */
export function clearAccountToken(id: number): void {
  db.prepare('UPDATE accounts SET token = NULL WHERE id = ?').run(id);
}

/** 修改密码（需安全密码验证）。 */
export function changePassword(id: number, newPasswordHash: string): void {
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(newPasswordHash, id);
}

// ============= 角色操作 =============

export interface CharacterRow {
  id: number;
  account_id: number;
  name: string;
  element: string;
  world_data: string;  // JSON
  created_at: string;
}

/** 创建角色（同一账号下角色名不可重复）。 */
export function createCharacter(accountId: number, name: string, element: string): CharacterRow {
  const stmt = db.prepare('INSERT INTO characters (account_id, name, element) VALUES (?, ?, ?)');
  const result = stmt.run(accountId, name, element);
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(result.lastInsertRowid)) as CharacterRow;
}

/** 获取某账号下所有角色。 */
export function getCharacters(accountId: number): CharacterRow[] {
  return db.prepare('SELECT * FROM characters WHERE account_id = ? ORDER BY created_at').all(accountId) as CharacterRow[];
}

/** 按 id 取角色。 */
export function getCharacter(charId: number): CharacterRow | undefined {
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(charId) as CharacterRow | undefined;
}

/** 保存角色世界数据（JSON 序列化）。 */
export function saveCharacterWorld(charId: number, worldData: string): void {
  db.prepare('UPDATE characters SET world_data = ? WHERE id = ?').run(worldData, charId);
}

export default db;
