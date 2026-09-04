// src/routes/files.js - File Manager REST API, mount tại /api/servers/:id/files
// Mọi path đi qua safeResolve() -> khoá trong server.path. Cần đăng nhập (requireAuth ở server.js).
//
// Upload: ghi TRỰC TIẾP ra đĩa theo kiểu streaming (diskStorage) dưới tên tạm *.wpart
// rồi rename sang tên thật. Không nhét file vào RAM => upload file GB không làm sập panel.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { safeResolve, listDir, isTextFile, MAX_EDIT_BYTES } from '../fileutil.js';

// Giới hạn upload (đổi được qua env)
const MAX_UPLOAD_BYTES = Number(process.env.WP_MAX_UPLOAD_BYTES || 2 * 1024 * 1024 * 1024); // 2GB/file
const MAX_UPLOAD_FILES = Number(process.env.WP_MAX_UPLOAD_FILES || 20);

// Đuôi file mà Windows/JVM hay lock hoặc dễ hỏng nếu ghi đè lúc server đang chạy
const LOCK_RISK = /\.(jar|db|dat|dat_old|mca|mcr|lock)$/i;

const uploadMw = multer({
  storage: multer.diskStorage({
    // Ghi thẳng vào thư mục đích (đã được prepareUpload xác thực)
    destination(req, file, cb) {
      if (!req.wpUploadDir) return cb(new Error('Thư mục đích chưa xác định'));
      cb(null, req.wpUploadDir);
    },
    // Tên tạm: không phá file thật nếu upload dở dang / bị huỷ
    filename(req, file, cb) {
      const base = path.basename(String(file.originalname || 'upload.bin'));
      cb(null, `.${base}.${crypto.randomBytes(4).toString('hex')}.wpart`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
});

export default function filesRouter(mgr) {
  const r = express.Router({ mergeParams: true });

  // Lấy server hoặc 404
  function getServer(req, res) {
    const gs = mgr.get(req.params.id);
    if (!gs) {
      res.status(404).json({ error: 'Không tìm thấy server' });
      return null;
    }
    return gs;
  }

  // Middleware: gắn req.gs
  function attachServer(req, res, next) {
    const gs = getServer(req, res);
    if (!gs) return;
    req.gs = gs;
    next();
  }

  // Middleware: xác thực thư mục đích TRƯỚC khi multer bắt đầu ghi
  function prepareUpload(req, res, next) {
    try {
      const relDir = req.query.path || '';
      const absDir = safeResolve(req.gs.cfg.path, relDir);
      if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
        return res.status(400).json({ error: 'Thư mục đích không tồn tại' });
      }
      req.wpUploadDir = absDir;
      req.wpRelDir = String(relDir).replace(/\\/g, '/');
      next();
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }

  // GET /list?path=... -> liệt kê thư mục
  r.get('/list', (req, res) => {
    const gs = getServer(req, res);
    if (!gs) return;
    try {
      const rel = req.query.path || '';
      res.json({ path: rel, entries: listDir(gs.cfg.path, rel) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // GET /read?path=... -> nội dung file text
  r.get('/read', (req, res) => {
    const gs = getServer(req, res);
    if (!gs) return;
    try {
      const rel = req.query.path || '';
      const abs = safeResolve(gs.cfg.path, rel);
      const st = fs.statSync(abs);
      if (st.isDirectory()) return res.status(400).json({ error: 'Đây là thư mục' });
      if (!isTextFile(abs)) return res.status(415).json({ error: 'File không phải dạng text, hãy tải về' });
      if (st.size > MAX_EDIT_BYTES) return res.status(413).json({ error: 'File quá lớn để mở (>1MB), hãy tải về' });
      res.json({ path: rel, content: fs.readFileSync(abs, 'utf8'), size: st.size });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // PUT /write { path, content } -> ghi file text (atomic: ghi tạm rồi rename)
  r.put('/write', (req, res) => {
    const gs = getServer(req, res);
    if (!gs) return;
    try {
      const rel = req.body?.path || '';
      const content = String(req.body?.content ?? '');
      const abs = safeResolve(gs.cfg.path, rel);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        return res.status(400).json({ error: 'Đây là thư mục' });
      }
      if (!isTextFile(abs)) return res.status(415).json({ error: 'Chỉ cho ghi file dạng text' });
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.${crypto.randomBytes(4).toString('hex')}.wpart`;
      fs.writeFileSync(tmp, content, 'utf8');
      fs.rmSync(abs, { force: true });
      fs.renameSync(tmp, abs);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // GET /download?path=... -> tải file về
  r.get('/download', (req, res) => {
    const gs = getServer(req, res);
    if (!gs) return;
    try {
      const rel = req.query.path || '';
      const abs = safeResolve(gs.cfg.path, rel);
      const st = fs.statSync(abs);
      if (st.isDirectory()) return res.status(400).json({ error: 'Không tải được thư mục' });
      res.download(abs, path.basename(abs));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // POST /upload?path=<dir>&overwrite=0|1 (multipart, field "file")
  r.post('/upload', attachServer, prepareUpload, (req, res) => {
    uploadMw.array('file', MAX_UPLOAD_FILES)(req, res, (err) => {
      const files = req.files || [];
      // Dọn mọi file tạm khi có lỗi / bị từ chối
      const cleanup = () => {
        for (const f of files) { try { fs.rmSync(f.path, { force: true }); } catch {} }
      };

      if (err) {
        cleanup();
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `File vượt giới hạn ${Math.floor(MAX_UPLOAD_BYTES / 1048576)}MB` });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(413).json({ error: `Tối đa ${MAX_UPLOAD_FILES} file mỗi lần upload` });
        }
        return res.status(400).json({ error: err.message });
      }
      if (!files.length) return res.status(400).json({ error: 'Không có file nào được gửi' });

      const overwrite = req.query.overwrite === '1';
      const running = req.gs.state !== 'STOPPED';

      try {
        // Lập kế hoạch trước cho TẤT CẢ file -> không ghi nửa vời rồi mới báo lỗi
        const plan = files.map((f) => {
          const name = path.basename(String(f.originalname || f.filename));
          const dest = safeResolve(req.gs.cfg.path, path.posix.join(req.wpRelDir, name));
          return { tmp: f.path, name, dest, exists: fs.existsSync(dest) };
        });

        // 1) Trùng tên -> 409, để client hỏi "ghi đè?" thay vì âm thầm mất file cũ
        const conflicts = plan.filter((p) => p.exists && !overwrite).map((p) => p.name);
        if (conflicts.length) {
          cleanup();
          return res.status(409).json({
            error: `Đã tồn tại: ${conflicts.join(', ')}`,
            conflicts,
            hint: 'Gửi lại với overwrite=1 để ghi đè',
          });
        }

        // 2) Ghi đè file đang bị JVM lock trên Windows -> chặn sớm với thông báo rõ
        const locked = plan.filter((p) => p.exists && running && LOCK_RISK.test(p.name)).map((p) => p.name);
        if (locked.length) {
          cleanup();
          return res.status(409).json({
            error: `Phải STOP server trước khi ghi đè: ${locked.join(', ')} (Windows đang lock file)`,
          });
        }

        // 3) Chốt: rename tên tạm -> tên thật
        const saved = [];
        for (const p of plan) {
          if (p.exists) fs.rmSync(p.dest, { force: true });
          fs.renameSync(p.tmp, p.dest);
          saved.push(p.name);
        }
        res.json({ ok: true, saved });
      } catch (e) {
        cleanup();
        res.status(400).json({ error: e.message });
      }
    });
  });

  // POST /mkdir { path } -> tạo thư mục mới
  r.post('/mkdir', (req, res) => {
    const gs = getServer(req, res);
    if (!gs) return;
    try {
      const abs = safeResolve(gs.cfg.path, req.body?.path || '');
      fs.mkdirSync(abs, { recursive: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // POST /rename { from, to } -> đổi tên / di chuyển trong phạm vi server
  r.post('/rename', (req, res) => {
    const gs = getServer(req, res);
    if (!gs) return;
    try {
      const from = safeResolve(gs.cfg.path, req.body?.from || '');
      const to = safeResolve(gs.cfg.path, req.body?.to || '');
      if (!fs.existsSync(from)) return res.status(404).json({ error: 'Không tìm thấy nguồn' });
      if (fs.existsSync(to)) return res.status(409).json({ error: 'Tên đích đã tồn tại' });
      fs.renameSync(from, to);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // DELETE /delete { path } -> xoá file/folder. Chặn khi server đang chạy.
  r.delete('/delete', (req, res) => {
    const gs = getServer(req, res);
    if (!gs) return;
    try {
      if (gs.state !== 'STOPPED') {
        return res.status(409).json({ error: 'Phải STOP server trước khi xoá file' });
      }
      const abs = safeResolve(gs.cfg.path, req.body?.path || '');
      if (abs === safeResolve(gs.cfg.path, '')) {
        return res.status(400).json({ error: 'Không thể xoá thư mục gốc server' });
      }
      if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Không tồn tại' });
      fs.rmSync(abs, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  return r;
}
