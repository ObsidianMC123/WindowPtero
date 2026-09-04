// server.js - điểm vào WindowPtero (M2 + M3 + M5 auth + M6 file manager)
// Nạp .env TRƯỚC mọi module khác: ESM chạy các import theo thứ tự khai báo,
// nên dòng này phải ở trên cùng để những module đọc process.env lúc nạp
// (files.js, routes/auth.js) thấy được giá trị trong .env.
import './src/env.js';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import ServerManager from './src/ServerManager.js';
import serversRouter from './src/routes/servers.js';
import filesRouter from './src/routes/files.js';
import authRouter from './src/routes/auth.js';
import backgroundRouter from './src/routes/background.js';
import { attachWebSocket } from './src/ws.js';
import { seedAdmin, requireAuth, verifyToken, COOKIE_NAME } from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== Cấu hình qua biến môi trường (default = giữ nguyên hành vi cũ) =====
// WP_PORT        cổng panel (mặc định 2008)
// WP_HOST        địa chỉ bind. Đặt 127.0.0.1 khi chạy sau reverse proxy trên VPS.
// WP_ADMIN_USER / WP_ADMIN_PASS   tài khoản admin seed lần đầu
// WP_TRUST_PROXY số tầng proxy tin cậy (để rate-limit đọc đúng IP thật)
// WP_HTTPS=1     panel chạy sau HTTPS -> bật cookie Secure + HSTS
const PORT = Number(process.env.WP_PORT || process.env.PORT || 2008);
const HOST = process.env.WP_HOST || '0.0.0.0';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const BEHIND_HTTPS = process.env.WP_HTTPS === '1';

// Không bao giờ để mật khẩu mặc định trong source code.
// Chưa đặt WP_ADMIN_PASS -> sinh mật khẩu ngẫu nhiên cho lần seed đầu
// rồi in ra console một lần để người cài đọc được.
let ADMIN_PASS = process.env.WP_ADMIN_PASS || '';
let generatedPass = false;
if (!ADMIN_PASS) {
  const { randomBytes } = await import('node:crypto');
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  ADMIN_PASS = Array.from(randomBytes(20), (b) => alphabet[b % alphabet.length]).join('');
  generatedPass = true;
}

// Seed tài khoản admin nếu chưa có user nào trong data/auth.json
seedAdmin(ADMIN_USER, ADMIN_PASS);
if (generatedPass) {
  console.warn('[WindowPtero] Chưa đặt WP_ADMIN_PASS trong .env nên đã sinh mật khẩu ngẫu nhiên:');
  console.warn('[WindowPtero]   Tài khoản : ' + ADMIN_USER);
  console.warn('[WindowPtero]   Mật khẩu  : ' + ADMIN_PASS);
  console.warn('[WindowPtero] Mật khẩu này chỉ có tác dụng nếu data/auth.json chưa có user.');
  console.warn('[WindowPtero] Nên copy .env.example thành .env và đặt WP_ADMIN_PASS để cố định mật khẩu.');
}

const mgr = new ServerManager();
const app = express();

app.disable('x-powered-by');
if (process.env.WP_TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.WP_TRUST_PROXY) || 1);
}

// Header bảo mật cơ bản (không cần thêm dependency)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (BEHIND_HTTPS) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// Editor cho phép file text tới 1MB -> body JSON phải lớn hơn mặc định 100kb của express
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());

// Health check (không cần auth)
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Auth API (login/logout/status - không cần auth trước)
app.use('/api/auth', authRouter());

// REST API - TẤT CẢ cần đăng nhập
app.use('/api/servers', requireAuth, serversRouter(mgr));
app.use('/api/servers/:id/files', requireAuth, filesRouter(mgr));
app.use('/api/background', requireAuth, backgroundRouter());

// Trang login public
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.use('/login.css', express.static(path.join(__dirname, 'public', 'style.css')));

// Chặn truy cập panel khi chưa đăng nhập -> đẩy về /login.html
app.use((req, res, next) => {
  // Cho phép asset công khai của trang login + ảnh nền
  if (req.path === '/login.html' || req.path === '/style.css' || req.path.startsWith('/bg/')) return next();
  const s = verifyToken(req.cookies?.[COOKIE_NAME]);
  if (!s) return res.redirect('/login.html');
  next();
});

// Static frontend (chỉ tới đây khi đã đăng nhập)
app.use(express.static(path.join(__dirname, 'public')));

// Bắt lỗi cuối chuỗi: trả JSON thay vì HTML stack trace
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status === 413) return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn' });
  console.error('[WindowPtero][LỖI]', err.message);
  res.status(status).json({ error: err.message || 'Lỗi server' });
});

const httpServer = http.createServer(app);
attachWebSocket(httpServer, mgr);

httpServer.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('[WindowPtero] Panel chạy tại http://' + shown + ':' + PORT + ' (bind ' + HOST + ')');
  console.log('[WindowPtero] WS console: ws://' + shown + ':' + PORT + '/ws?id=<serverId> (cần cookie đăng nhập)');
});

export { app, mgr };
