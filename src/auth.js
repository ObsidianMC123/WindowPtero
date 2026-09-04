// src/auth.js - Quản lý xác thực: tạo tài khoản admin, verify, session token.
// Lưu user trong data/auth.json (password đã bcrypt). Session giữ trong RAM.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '..', 'data', 'auth.json');

// Sessions: token -> { username, exp }
const sessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

function _readUsers() {
  if (!fs.existsSync(AUTH_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch (e) {
    console.error('[auth] auth.json hỏng, coi như chưa có user:', e.message);
    return [];
  }
}

function _writeUsers(users) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Có tài khoản nào chưa? (để front-end biết hiện "đăng nhập" hay "tạo tài khoản đầu tiên")
export function hasUser() {
  return _readUsers().length > 0;
}

// Tạo user mới (dùng cho seed admin lần đầu)
export function createUser(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!username) throw new Error('Thiếu username');
  if (password.length < 6) throw new Error('Mật khẩu tối thiểu 6 ký tự');
  const users = _readUsers();
  if (users.some((u) => u.username === username)) {
    throw new Error('Username đã tồn tại');
  }
  const hash = bcrypt.hashSync(password, 10);
  users.push({ username, hash, createdAt: Date.now() });
  _writeUsers(users);
  return { username };
}

// Seed admin nếu chưa có user nào. Trả về true nếu vừa tạo.
export function seedAdmin(username, password) {
  if (hasUser()) return false;
  createUser(username, password);
  console.log(`[auth] Đã tạo tài khoản admin mặc định: ${username}`);
  return true;
}

// Kiểm tra đăng nhập, trả về token nếu đúng
export function login(username, password) {
  const users = _readUsers();
  const u = users.find((x) => x.username === String(username || '').trim());
  if (!u) return null;
  if (!bcrypt.compareSync(String(password || ''), u.hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username: u.username, exp: Date.now() + SESSION_TTL_MS });
  return token;
}

export function logout(token) {
  sessions.delete(token);
}

// Kiểm tra token còn hợp lệ
export function verifyToken(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

// Middleware bảo vệ route: đọc cookie wp_session
export function requireAuth(req, res, next) {
  const token = req.cookies?.wp_session;
  const s = verifyToken(token);
  if (!s) return res.status(401).json({ error: 'Chưa đăng nhập' });
  req.user = s;
  next();
}

export const COOKIE_NAME = 'wp_session';
export { SESSION_TTL_MS };
