// src/env.js - nạp file .env ở gốc project vào process.env.
// Tự parse, không cần thêm dependency (dotenv) và không phụ thuộc version Node.
//
// Quy tắc: biến đã set sẵn ngoài shell được ưu tiên hơn .env,
// nên `set WP_PORT=3000 && node server.js` vẫn đè được giá trị trong .env.
//
// Cú pháp .env hỗ trợ:
//   KEY=value
//   KEY="giá trị có dấu cách"
//   # dòng comment
//   KEY=value   # comment cuối dòng
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = process.env.WP_ENV_FILE || path.join(ROOT, '.env');

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let val = line.slice(eq + 1).trim();
    const q = val[0];
    if ((q === '"' || q === "'") && val.length > 1 && val.endsWith(q)) {
      val = val.slice(1, -1);
      if (q === '"') val = val.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      // Bỏ comment cuối dòng (chỉ khi có khoảng trắng trước #,
      // để mật khẩu kiểu abc#123 không bị cắt oạn)
      const cut = val.indexOf(' #');
      if (cut >= 0) val = val.slice(0, cut).trim();
    }
    out[key] = val;
  }
  return out;
}

let loadedCount = 0;
try {
  if (fs.existsSync(ENV_PATH)) {
    const vars = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
        loadedCount++;
      }
    }
    console.log(`[WindowPtero] Đã nạp ${loadedCount} biến từ ${ENV_PATH}`);
  } else {
    console.log(`[WindowPtero] Không thấy ${ENV_PATH} -> dùng giá trị mặc định (xem .env.example)`);
  }
} catch (e) {
  console.warn('[WindowPtero] Không đọc được .env:', e.message);
}

export { ENV_PATH, loadedCount };
