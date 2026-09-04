// src/routes/auth.js - REST cho đăng nhập/đăng xuất/trạng thái.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, hasUser, COOKIE_NAME, SESSION_TTL_MS } from '../auth.js';

// Giới hạn brute-force: 10 lần thử / 15 phút / IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Thử đăng nhập quá nhiều lần, chờ 15 phút.' },
});

// Options cookie session. secure chỉ bật khi panel chạy sau HTTPS (WP_HTTPS=1),
// vì bật secure trên HTTP thuần sẽ làm trình duyệt bỏ cookie -> không đăng nhập được.
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.WP_HTTPS === '1',
  maxAge: SESSION_TTL_MS,
};

export default function authRouter() {
  const r = express.Router();

  // Trạng thái: đã có user chưa, đang đăng nhập chưa
  r.get('/status', (req, res) => {
    res.json({ hasUser: hasUser(), authed: !!req.user });
  });

  // Đăng nhập
  r.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    const token = login(username, password);
    if (!token) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.json({ ok: true, username });
  });

  // Đăng xuất
  r.post('/logout', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) logout(token);
    // clearCookie phải cùng options, nếu không trình duyệt sẽ không xoá đúng cookie
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: undefined });
    res.json({ ok: true });
  });

  return r;
}
