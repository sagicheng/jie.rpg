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

  CREATE TABLE IF NOT EXISTS guilds (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    leader_char_id  INTEGER NOT NULL,
    notice          TEXT NOT NULL DEFAULT '',
    level           INTEGER NOT NULL DEFAULT 1,
    exp             INTEGER NOT NULL DEFAULT 0,
    contribution    INTEGER NOT NULL DEFAULT 0,   -- 公会贡献池（成员活动累积，用于学公会技能）
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS guild_members (
    guild_id  INTEGER NOT NULL REFERENCES guilds(id),
    char_id   INTEGER NOT NULL,
    rank      TEXT NOT NULL DEFAULT 'member',   -- 'leader' | 'elder' | 'member'
    contribution INTEGER NOT NULL DEFAULT 0,    -- 个人累计贡献（做任务/副本累积）
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (guild_id, char_id),
    UNIQUE (char_id)                              -- 一个角色仅属一个公会
  );

  CREATE TABLE IF NOT EXISTS guild_applications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   INTEGER NOT NULL REFERENCES guilds(id),
    char_id    INTEGER NOT NULL,
    message    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (guild_id, char_id)                    -- 同一公会不可重复申请
  );

  CREATE TABLE IF NOT EXISTS guild_skills (
    guild_id INTEGER NOT NULL REFERENCES guilds(id),
    skill_id TEXT    NOT NULL,
    level    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, skill_id)
  );

  CREATE TABLE IF NOT EXISTS friends (
    char_id        INTEGER NOT NULL,
    friend_char_id INTEGER NOT NULL,
    status         TEXT NOT NULL,   -- 'pending' | 'accepted'
    role           TEXT NOT NULL,   -- 'requester' | 'receiver' | 'friend'
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (char_id, friend_char_id)
  );
`);

// 存量库迁移：为已存在的 guilds / guild_members 补贡献列（新库由上方 CREATE 直接带列，此处仅兜底）
for (const [t, c, d] of [
  ['guilds', 'contribution', 'INTEGER NOT NULL DEFAULT 0'],
  ['guild_members', 'contribution', 'INTEGER NOT NULL DEFAULT 0'],
] as const) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((r: any) => (r as any).name);
  if (!cols.includes(c)) db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`).run();
}
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

// ============= 公会系统 =============

export interface GuildRow {
  id: number;
  name: string;
  leader_char_id: number;
  notice: string;
  level: number;
  exp: number;
  contribution: number;
  created_at: string;
}

export interface GuildMemberRow {
  guild_id: number;
  char_id: number;
  rank: string;
  contribution: number;
  joined_at: string;
}

export interface GuildAppRow {
  id: number;
  guild_id: number;
  char_id: number;
  message: string;
  created_at: string;
}

/** 角色当前所属公会 id（无则 null）。 */
export function getMemberGuild(charId: number): number | null {
  const row = db.prepare('SELECT guild_id FROM guild_members WHERE char_id = ?').get(charId) as { guild_id: number } | undefined;
  return row ? row.guild_id : null;
}

export function getGuild(guildId: number): GuildRow | undefined {
  return db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId) as GuildRow | undefined;
}

export function getGuildByName(name: string): GuildRow | undefined {
  return db.prepare('SELECT * FROM guilds WHERE name = ?').get(name) as GuildRow | undefined;
}

/** 公会成员数。 */
export function getGuildMemberCount(guildId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?').get(guildId) as { n: number };
  return row.n;
}

/** 公会成员列表（含角色名/元素/贡献，按 会长>长老>入会时间 排序）。 */
export function getGuildMembers(guildId: number): Array<{ charId: number; name: string; element: string; rank: string; contribution: number }> {
  return db.prepare(`
    SELECT m.char_id AS charId, c.name AS name, c.element AS element, m.rank AS rank, m.contribution AS contribution
    FROM guild_members m JOIN characters c ON c.id = m.char_id
    WHERE m.guild_id = ?
    ORDER BY (m.rank = 'leader') DESC, (m.rank = 'elder') DESC, m.joined_at ASC
  `).all(guildId) as Array<{ charId: number; name: string; element: string; rank: string; contribution: number }>;
}

/** 公会申请列表（含申请人角色名）。 */
export function getGuildApplications(guildId: number): Array<{ id: number; charId: number; name: string; message: string }> {
  return db.prepare(`
    SELECT a.id AS id, a.char_id AS charId, c.name AS name, a.message AS message
    FROM guild_applications a JOIN characters c ON c.id = a.char_id
    WHERE a.guild_id = ? ORDER BY a.created_at ASC
  `).all(guildId) as Array<{ id: number; charId: number; name: string; message: string }>;
}

export function getApplication(appId: number): GuildAppRow | undefined {
  return db.prepare('SELECT * FROM guild_applications WHERE id = ?').get(appId) as GuildAppRow | undefined;
}

/** 公会浏览列表（id/名/等级/成员数），按等级+人数降序。 */
export function listGuilds(limit = 50): Array<{ id: number; name: string; level: number; memberCount: number }> {
  return db.prepare(`
    SELECT g.id AS id, g.name AS name, g.level AS level, COUNT(m.char_id) AS memberCount
    FROM guilds g LEFT JOIN guild_members m ON m.guild_id = g.id
    GROUP BY g.id ORDER BY g.level DESC, memberCount DESC LIMIT ?
  `).all(limit) as Array<{ id: number; name: string; level: number; memberCount: number }>;
}

/** 创建公会（事务：插 guilds + 插 leader 为 member）。已在该公会/其他公会则抛错。 */
export function createGuild(name: string, leaderCharId: number): number {
  const tx = db.transaction((gname: string, lid: number) => {
    if (getMemberGuild(lid) !== null) throw new Error('ALREADY_IN_GUILD');
    const res = db.prepare('INSERT INTO guilds (name, leader_char_id) VALUES (?, ?)').run(gname, lid);
    const gid = Number(res.lastInsertRowid);
    db.prepare("INSERT INTO guild_members (guild_id, char_id, rank) VALUES (?, ?, 'leader')").run(gid, lid);
    return gid;
  });
  return tx(name, leaderCharId);
}

export function addMember(guildId: number, charId: number, rank: string = 'member'): void {
  db.prepare('INSERT OR REPLACE INTO guild_members (guild_id, char_id, rank) VALUES (?, ?, ?)').run(guildId, charId, rank);
}

export function removeMember(guildId: number, charId: number): void {
  db.prepare('DELETE FROM guild_members WHERE guild_id = ? AND char_id = ?').run(guildId, charId);
}

export function setMemberRank(guildId: number, charId: number, rank: string): void {
  db.prepare('UPDATE guild_members SET rank = ? WHERE guild_id = ? AND char_id = ?').run(rank, guildId, charId);
}

export function setGuildLeader(guildId: number, charId: number): void {
  db.prepare('UPDATE guilds SET leader_char_id = ? WHERE id = ?').run(charId, guildId);
}

export function updateGuildNotice(guildId: number, notice: string): void {
  db.prepare('UPDATE guilds SET notice = ? WHERE id = ?').run(notice, guildId);
}

export function addApplication(guildId: number, charId: number, message: string): void {
  db.prepare('INSERT INTO guild_applications (guild_id, char_id, message) VALUES (?, ?, ?)').run(guildId, charId, message);
}

export function removeApplication(appId: number): void {
  db.prepare('DELETE FROM guild_applications WHERE id = ?').run(appId);
}

/** 移除某角色在所有公会的待审申请（入会成功后清掉，避免跨公会重复）。 */
export function removeApplicationsForChar(charId: number): void {
  db.prepare('DELETE FROM guild_applications WHERE char_id = ?').run(charId);
}

/** 解散公会：删成员 + 申请 + 公会本体。 */
export function disbandGuild(guildId: number): void {
  const tx = db.transaction((gid: number) => {
    db.prepare('DELETE FROM guild_members WHERE guild_id = ?').run(gid);
    db.prepare('DELETE FROM guild_applications WHERE guild_id = ?').run(gid);
    db.prepare('DELETE FROM guilds WHERE id = ?').run(gid);
  });
  tx(guildId);
}

// ============= 公会成长（v2：等级/经验/贡献/技能） =============

/** 公会升到下一级所需经验（level→level+1）。简单递增：1000*当前级。 */
export function guildExpCap(level: number): number {
  return 1000 * level;
}
const GUILD_MAX_LEVEL = 20;

/** 给公会加经验并自动升级（封顶 GUILD_MAX_LEVEL）。返回是否升级及新等级。 */
export function addGuildExp(guildId: number, amount: number): { leveledUp: boolean; newLevel: number } {
  const g = getGuild(guildId);
  if (!g) return { leveledUp: false, newLevel: 1 };
  let level = g.level;
  let exp = g.exp + Math.max(0, Math.floor(amount));
  let leveledUp = false;
  while (level < GUILD_MAX_LEVEL && exp >= guildExpCap(level)) {
    exp -= guildExpCap(level);
    level++;
    leveledUp = true;
  }
  if (level >= GUILD_MAX_LEVEL) exp = 0;
  db.prepare('UPDATE guilds SET level = ?, exp = ? WHERE id = ?').run(level, exp, guildId);
  return { leveledUp, newLevel: level };
}

/** 公会贡献池增减（学技能消耗传负，活动累积传正）。下限 0。 */
export function addGuildContribution(guildId: number, amount: number): void {
  db.prepare('UPDATE guilds SET contribution = MAX(0, contribution + ?) WHERE id = ?').run(amount, guildId);
}

/** 给某成员个人贡献 +amount（仅当该角色在公会内）。 */
export function addMemberContribution(charId: number, amount: number): void {
  const gid = getMemberGuild(charId);
  if (gid === null) return;
  db.prepare('UPDATE guild_members SET contribution = MAX(0, contribution + ?) WHERE guild_id = ? AND char_id = ?')
    .run(amount, gid, charId);
}

/** 取某成员个人累计贡献（不在公会返回 0）。 */
export function getMemberContribution(charId: number): number {
  const gid = getMemberGuild(charId);
  if (gid === null) return 0;
  const row = db.prepare('SELECT contribution FROM guild_members WHERE guild_id = ? AND char_id = ?').get(gid, charId) as { contribution: number } | undefined;
  return row ? row.contribution : 0;
}

/** 公会全部技能等级 → { skillId: level }。 */
export function getGuildSkills(guildId: number): Record<string, number> {
  const rows = db.prepare('SELECT skill_id, level FROM guild_skills WHERE guild_id = ?').all(guildId) as Array<{ skill_id: string; level: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.skill_id] = r.level;
  return out;
}

export function getGuildSkillLevel(guildId: number, skillId: string): number {
  const row = db.prepare('SELECT level FROM guild_skills WHERE guild_id = ? AND skill_id = ?').get(guildId, skillId) as { level: number } | undefined;
  return row ? row.level : 0;
}

export function setGuildSkillLevel(guildId: number, skillId: string, level: number): void {
  db.prepare(`INSERT INTO guild_skills (guild_id, skill_id, level) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, skill_id) DO UPDATE SET level = excluded.level`).run(guildId, skillId, level);
}

// ============= 好友系统 =============

export interface FriendRow {
  char_id: number;
  friend_char_id: number;
  status: string;   // 'pending' | 'accepted'
  role: string;     // 'requester' | 'receiver' | 'friend'
  created_at: string;
}

/** 按角色名精确查找（用于按名添加好友）。 */
export function getCharacterByName(name: string): CharacterRow | undefined {
  return db.prepare('SELECT * FROM characters WHERE name = ?').get(name) as CharacterRow | undefined;
}

/** 我的好友列表（已接受，含对方角色名）。 */
export function getFriends(charId: number): Array<{ charId: number; name: string }> {
  return db.prepare(`
    SELECT f.friend_char_id AS charId, c.name AS name
    FROM friends f JOIN characters c ON c.id = f.friend_char_id
    WHERE f.char_id = ? AND f.status = 'accepted'
  `).all(charId) as Array<{ charId: number; name: string }>;
}

/** 收到的好友申请（role='receiver'）。 */
export function getFriendRequests(charId: number): Array<{ charId: number; name: string }> {
  return db.prepare(`
    SELECT f.friend_char_id AS charId, c.name AS name
    FROM friends f JOIN characters c ON c.id = f.friend_char_id
    WHERE f.char_id = ? AND f.status = 'pending' AND f.role = 'receiver'
  `).all(charId) as Array<{ charId: number; name: string }>;
}

/** 任意关系行（pending 或 accepted，任一方向），用于去重/存在性判断。 */
export function getFriendship(charId: number, otherId: number): FriendRow | undefined {
  return db.prepare('SELECT * FROM friends WHERE (char_id = ? AND friend_char_id = ?) OR (char_id = ? AND friend_char_id = ?)')
    .get(charId, otherId, otherId, charId) as FriendRow | undefined;
}

/** 发送好友申请：双向镜像两行（requester / receiver）。 */
export function addFriendRequest(requesterId: number, receiverId: number): void {
  const tx = db.transaction((a: number, b: number) => {
    db.prepare("INSERT INTO friends (char_id, friend_char_id, status, role) VALUES (?, ?, 'pending', 'requester')").run(a, b);
    db.prepare("INSERT INTO friends (char_id, friend_char_id, status, role) VALUES (?, ?, 'pending', 'receiver')").run(b, a);
  });
  tx(requesterId, receiverId);
}

/** 接受申请：双向置为 accepted / friend。 */
export function acceptFriend(requesterId: number, receiverId: number): void {
  db.prepare("UPDATE friends SET status = 'accepted', role = 'friend' WHERE (char_id = ? AND friend_char_id = ?) OR (char_id = ? AND friend_char_id = ?)")
    .run(requesterId, receiverId, receiverId, requesterId);
}

/** 删除好友关系（拒绝 / 移除）：双向删除。 */
export function removeFriend(charId: number, friendId: number): void {
  db.prepare('DELETE FROM friends WHERE (char_id = ? AND friend_char_id = ?) OR (char_id = ? AND friend_char_id = ?)')
    .run(charId, friendId, friendId, charId);
}

// ============= 拍卖行系统（建表，幂等） =============
// 一口价挂单（竞价为二期）。auctions 冻结物品用 item_data(JSON) 存全量 WorldItem；冗余 item_name/quality 便于名称模糊搜 + 品质筛选。
db.exec(`
  CREATE TABLE IF NOT EXISTS auctions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_char_id  INTEGER NOT NULL,
    seller_name     TEXT NOT NULL,
    item_name       TEXT NOT NULL,
    item_data       TEXT NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 1,
    price           INTEGER NOT NULL,
    category        TEXT NOT NULL,
    quality         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auction_favorites (
    char_id    INTEGER NOT NULL,
    auction_id INTEGER NOT NULL,
    PRIMARY KEY (char_id, auction_id)
  );

  CREATE TABLE IF NOT EXISTS auction_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    auction_id      INTEGER NOT NULL,
    seller_char_id  INTEGER NOT NULL,
    buyer_char_id   INTEGER,
    item_name       TEXT NOT NULL,
    price           INTEGER NOT NULL,
    kind            TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ============= 拍卖行系统查询 =============
export interface AuctionRow {
  id: number; seller_char_id: number; seller_name: string; item_name: string;
  item_data: string; quantity: number; price: number; category: string; quality: string | null;
  created_at: string; expires_at: string;
}

export interface AuctionFilter {
  category?: string; quality?: string; name?: string;
  minPrice?: number; maxPrice?: number;
  sort?: 'price_asc' | 'price_desc' | 'recent';
}

/** 浏览挂单（一口价）。支持 类型/品质/名称模糊/价格区间/排序 过滤。 */
export function listAuctions(f: AuctionFilter = {}): AuctionRow[] {
  const where: string[] = [];
  const args: any[] = [];
  if (f.category) { where.push('category = ?'); args.push(f.category); }
  if (f.quality) { where.push('quality = ?'); args.push(f.quality); }
  if (f.name) { where.push('item_name LIKE ?'); args.push(`%${f.name}%`); }
  if (typeof f.minPrice === 'number') { where.push('price >= ?'); args.push(f.minPrice); }
  if (typeof f.maxPrice === 'number') { where.push('price <= ?'); args.push(f.maxPrice); }
  const order = f.sort === 'price_desc' ? 'price DESC' : f.sort === 'recent' ? 'created_at DESC' : 'price ASC';
  const sql = `SELECT * FROM auctions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  return db.prepare(sql).all(...args) as AuctionRow[];
}

export function getAuction(id: number): AuctionRow | undefined {
  return db.prepare('SELECT * FROM auctions WHERE id = ?').get(id) as AuctionRow | undefined;
}

/** 我的在售挂单。 */
export function myAuctions(charId: number): AuctionRow[] {
  return db.prepare('SELECT * FROM auctions WHERE seller_char_id = ? ORDER BY created_at DESC').all(charId) as AuctionRow[];
}

export function deleteAuction(id: number): void {
  db.prepare('DELETE FROM auctions WHERE id = ?').run(id);
}

/** 清理过期挂单：返回已过期的挂单（物品由调用方退回卖家背包）。 */
export function expiredAuctions(): AuctionRow[] {
  return db.prepare("SELECT * FROM auctions WHERE expires_at < datetime('now')").all() as AuctionRow[];
}

// ——— 收藏 ———
export function addFavorite(charId: number, auctionId: number): void {
  db.prepare('INSERT OR IGNORE INTO auction_favorites (char_id, auction_id) VALUES (?, ?)').run(charId, auctionId);
}
export function removeFavorite(charId: number, auctionId: number): void {
  db.prepare('DELETE FROM auction_favorites WHERE char_id = ? AND auction_id = ?').run(charId, auctionId);
}
export function isFavorited(charId: number, auctionId: number): boolean {
  return !!db.prepare('SELECT 1 FROM auction_favorites WHERE char_id = ? AND auction_id = ?').get(charId, auctionId);
}
export function getFavorites(charId: number): number[] {
  return (db.prepare('SELECT auction_id FROM auction_favorites WHERE char_id = ?').all(charId) as Array<{ auction_id: number }>).map(r => r.auction_id);
}

// ——— 历史 ———
export interface AuctionHistoryRow {
  id: number; auction_id: number; seller_char_id: number; buyer_char_id: number | null;
  item_name: string; price: number; kind: string; created_at: string;
}
export function insertHistory(h: {
  auction_id: number; seller_char_id: number; buyer_char_id: number | null;
  item_name: string; price: number; kind: string;
}): void {
  db.prepare('INSERT INTO auction_history (auction_id, seller_char_id, buyer_char_id, item_name, price, kind) VALUES (?, ?, ?, ?, ?, ?)')
    .run(h.auction_id, h.seller_char_id, h.buyer_char_id, h.item_name, h.price, h.kind);
}
export function getHistory(charId: number): AuctionHistoryRow[] {
  return db.prepare('SELECT * FROM auction_history WHERE seller_char_id = ? OR buyer_char_id = ? ORDER BY created_at DESC').all(charId, charId) as AuctionHistoryRow[];
}

export default db;
