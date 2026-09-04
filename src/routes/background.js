// background.js - upload/xoá ảnh nền panel (image/gif/mp4). Cần đăng nhập (requireAuth ở server.js).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// public/bg nằm ở gốc project: src/routes -> ../../public/bg
const BG_DIR = path.join(__dirname, '..', '..', 'public', 'bg');
const META_FILE = path.join(BG_DIR, 'meta.json');

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4',
]);
const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'video/mp4': '.mp4',
};

function ensureDir() {
  if (!fs.existsSync(BG_DIR)) fs.mkdirSync(BG_DIR, { recursive: true });
}
function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); }
  catch { return { file: null, type: null }; }
}
function writeMeta(m) {
  ensureDir();
  fs.writeFileSync(META_FILE, JSON.stringify(m, null, 2));
}
// Xoá mọi file nền cũ (giữ lại meta.json)
function clearOldFiles() {
  ensureDir();
  for (const f of fs.readdirSync(BG_DIR)) {
    if (f === 'meta.json') continue;
    try { fs.unlinkSync(path.join(BG_DIR, f)); } catch {}
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error('Định dạng không hỗ trợ (chỉ ảnh, GIF, MP4).'));
  },
});

export default function backgroundRouter() {
  const r = express.Router();

  // GET /api/background -> thông tin nền hiện tại
  r.get('/', (req, res) => {
    const m = readMeta();
    if (!m.file) return res.json({ url: null, type: null });
    res.json({ url: `/bg/${m.file}`, type: m.type });
  });

  // POST /api/background (multipart, field "bg") -> lưu nền mới
  r.post('/', (req, res) => {
    upload.single('bg')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Thiếu file.' });
      const ext = EXT[req.file.mimetype] || '.bin';
      const name = `bg-${Date.now()}${ext}`;
      try {
        clearOldFiles();
        fs.writeFileSync(path.join(BG_DIR, name), req.file.buffer);
        const kind = req.file.mimetype === 'video/mp4' ? 'video' : 'image';
        writeMeta({ file: name, type: kind });
        res.json({ url: `/bg/${name}`, type: kind });
      } catch (e) {
        res.status(500).json({ error: 'Lưu nền thất bại: ' + e.message });
      }
    });
  });

  // DELETE /api/background -> xoá nền, về mặc định
  r.delete('/', (req, res) => {
    try {
      clearOldFiles();
      writeMeta({ file: null, type: null });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return r;
}
