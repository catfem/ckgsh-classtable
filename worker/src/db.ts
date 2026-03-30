import { hashPassword, verifyPassword } from "./auth";

export interface User {
  id: string;
  email: string;
  password_hash: string | null;
  created_at: string;
}

export interface Subscription {
  id: number;
  user_id: string;
  type: string;
  code: string;
  label: string;
  term: string;
  enabled: number;
  created_at: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

export async function createUser(
  db: D1Database,
  email: string,
  password?: string
): Promise<User> {
  const id = generateId();
  const hash = password ? await hashPassword(password) : null;
  await db
    .prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)")
    .bind(id, email.toLowerCase(), hash)
    .run();
  return { id, email: email.toLowerCase(), password_hash: hash, created_at: new Date().toISOString() };
}

export async function getUserByEmail(
  db: D1Database,
  email: string
): Promise<User | null> {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<User>();
}

export async function getUserById(
  db: D1Database,
  id: string
): Promise<User | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
}

// verifyPassword is re-exported from auth.ts
export { verifyPassword } from "./auth";

// Magic links
export async function createMagicLink(
  db: D1Database,
  email: string
): Promise<string> {
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await db
    .prepare(
      "INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)"
    )
    .bind(token, email.toLowerCase(), expires)
    .run();
  return token;
}

export async function verifyMagicLink(
  db: D1Database,
  token: string
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT * FROM magic_links WHERE token = ? AND used = 0 AND expires_at > datetime('now')"
    )
    .bind(token)
    .first<{ token: string; email: string; expires_at: string; used: number }>();
  if (!row) return null;
  await db
    .prepare("UPDATE magic_links SET used = 1 WHERE token = ?")
    .bind(token)
    .run();
  return row.email;
}

// Subscriptions
export async function getSubscriptions(
  db: D1Database,
  userId: string
): Promise<Subscription[]> {
  const result = await db
    .prepare("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<Subscription>();
  return result.results;
}

export async function addSubscription(
  db: D1Database,
  userId: string,
  type: string,
  code: string,
  label: string,
  term: string
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO subscriptions (user_id, type, code, label, term) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(userId, type, code, label, term)
    .run();
}

export async function deleteSubscription(
  db: D1Database,
  id: number,
  userId: string
): Promise<void> {
  await db
    .prepare("DELETE FROM subscriptions WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
}

export async function toggleSubscription(
  db: D1Database,
  id: number,
  userId: string,
  enabled: number
): Promise<void> {
  await db
    .prepare("UPDATE subscriptions SET enabled = ? WHERE id = ? AND user_id = ?")
    .bind(enabled, id, userId)
    .run();
}

// Get all active subscriptions (for cron)
export async function getAllActiveSubscriptions(
  db: D1Database
): Promise<(Subscription & { email: string })[]> {
  const result = await db
    .prepare(
      `SELECT s.*, u.email FROM subscriptions s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.enabled = 1`
    )
    .all<Subscription & { email: string }>();
  return result.results;
}
