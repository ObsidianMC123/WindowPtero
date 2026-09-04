// src/fileutil.js - LÕI BẢO MẬT của File Manager.
// Mọi thao tác file PHẢI đi qua safeResolve() để khoá cứng trong thư mục gốc server,
// chống path traversal (../), chống symlink trỏ ra ngoài.
import fs from 'node:fs';
import path from 'node:path';

// Ngưỡng: file text mở trên editor tối đa 1MB. To hơn chỉ cho tải về.
export const MAX_EDIT_BYTES = 1024 * 1024;

// Đuôi được coi là "text mở đọc/sửa được". Ngoài list này -> chỉ download.
const TEXT_EXTS = new Set([
  '.txt', '.log', '.json', '.yml', '.yaml', '.properties', '.conf', '.cfg',
  '.ini', '.toml', '.md', '.sh', '.bat', '.js', '.ts', '.css', '.html',
  '.xml', '.env', '.gitignore', '.mcmeta', '.csv', '',
]);

export function isTextFile(name) {
  const ext = path.extname(name).toLowerCase();
  return TEXT_EXTS.has(ext);
}

/**
 * Khoá 1 đường dẫn tương đối vào bên trong rootDir.
 * @param {string} rootDir thư mục gốc của server (đã tin cậy)
 * @param {string} relPath đường dẫn con do client gửi (KHÔNG tin cậy)
 * @returns {string} đường dẫn tuyệt đối AN TOÀN nằm trong rootDir
 * @throws nếu thoát ra ngoài rootDir
 */
export function safeResolve(rootDir, relPath = '') {
  if (!rootDir) throw new Error('Thiếu thư mục gốc server');
  // Chuẩn hoá root. realpath để loại symlink ở phần gốc.
  let root;
  try {
    root = fs.realpathSync(rootDir);
  } catch {
    root = path.resolve(rootDir);
  }

  // Bỏ ký tự nguy hiểm, ép về POSIX-ish rồi join
  const clean = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, ''); // bỏ / đầu để không thành absolute

  const target = path.resolve(root, clean);

  // Chặn traversal: target phải nằm TRONG root (hoặc bằng root)
  const rel = path.relative(root, target);
  const isInside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!isInside) {
    throw new Error('Đường dẫn không hợp lệ (thoát ra ngoài thư mục server)');
  }

  // Nếu target đã tồn tại, realpath nó và kiểm tra lại (chống symlink trỏ ra ngoài)
  if (fs.existsSync(target)) {
    let realTarget;
    try {
      realTarget = fs.realpathSync(target);
    } catch {
      realTarget = target;
    }
    const relReal = path.relative(root, realTarget);
    const realInside = relReal === '' || (!relReal.startsWith('..') && !path.isAbsolute(relReal));
    if (!realInside) {
      throw new Error('Đường dẫn không hợp lệ (symlink thoát ra ngoài)');
    }
    return realTarget;
  }

  return target;
}

// Liệt kê 1 thư mục -> mảng entry an toàn
export function listDir(rootDir, relPath = '') {
  const abs = safeResolve(rootDir, relPath);
  const st = fs.statSync(abs);
  if (!st.isDirectory()) throw new Error('Không phải thư mục');
  const names = fs.readdirSync(abs);
  const entries = names.map((name) => {
    const full = path.join(abs, name);
    let s;
    try {
      s = fs.statSync(full);
    } catch {
      return { name, type: 'unknown', size: 0, mtime: 0 };
    }
    const isDir = s.isDirectory();
    return {
      name,
      type: isDir ? 'dir' : 'file',
      size: isDir ? 0 : s.size,
      mtime: s.mtimeMs,
      editable: !isDir && isTextFile(name) && s.size <= MAX_EDIT_BYTES,
    };
  });
  // Thư mục lên trước, rồi theo tên
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}
