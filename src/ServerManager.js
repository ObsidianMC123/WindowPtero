// src/ServerManager.js
// Quản NHIỀU GameServer: load/save servers.json, thêm/sửa/xoá, tra cứu theo id.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import GameServer from './GameServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'servers.json');
// Thư mục volume: mọi server mới nằm trong <panel>/volumes/<id>/ (tương đối, chạy được cả trên VPS)
const VOLUMES_DIR = path.join(__dirname, '..', 'volumes');

export default class ServerManager {
  constructor() {
    this.servers = new Map(); // id -> GameServer
    this._load();
  }

  _load() {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]', 'utf8');
      return;
    }
    let arr = [];
    try {
      arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('[ServerManager] servers.json hỏng, dùng rỗng:', e.message);
      arr = [];
    }
    for (const cfg of arr) {
      this.servers.set(cfg.id, new GameServer(cfg));
    }
  }

  _save() {
    const arr = [...this.servers.values()].map((s) => s.cfg);
    fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), 'utf8');
  }

  list() {
    return [...this.servers.values()].map((s) => s.snapshot());
  }

  get(id) {
    return this.servers.get(id);
  }

  // Thêm server mới: TỰ TẠO thư mục volumes/<id>/ (không cần path có sẵn)
  add(input) {
    const id = crypto.randomBytes(6).toString('hex');
    const dir = path.join(VOLUMES_DIR, id);
    const cfg = {
      id,
      name: (input.name || 'Server mới').trim(),
      path: dir,
      jarName: (input.jarName || 'paper.jar').trim(),
      javaPath: (input.javaPath || '').trim(),
      minRam: (input.minRam || '2G').trim(),
      maxRam: (input.maxRam || '4G').trim(),
      flags: (input.flags || '').trim(),
      autoRestart: !!input.autoRestart,
    };
    if (!cfg.name) throw new Error('Thiếu tên server');
    // Tạo thư mục volume rỗng cho server này
    fs.mkdirSync(dir, { recursive: true });

    const gs = new GameServer(cfg);
    this.servers.set(id, gs);
    this._save();
    return gs;
  }

  // Sửa cấu hình (không cho sửa khi đang chạy để tránh lệch state)
  update(id, input) {
    const gs = this.servers.get(id);
    if (!gs) throw new Error('Không tìm thấy server');
    if (gs.state !== 'STOPPED') throw new Error('Phải STOP server trước khi sửa cấu hình');

    const c = gs.cfg;
    // KHÔNG cho đổi 'path' nữa - path bị khoá vào volume của server
    for (const k of ['name', 'jarName', 'javaPath', 'minRam', 'maxRam', 'flags']) {
      if (input[k] !== undefined) c[k] = String(input[k]).trim();
    }
    if (input.autoRestart !== undefined) c.autoRestart = !!input.autoRestart;
    this._save();
    return gs;
  }

  remove(id) {
    const gs = this.servers.get(id);
    if (!gs) throw new Error('Không tìm thấy server');
    if (gs.state !== 'STOPPED') throw new Error('Phải STOP server trước khi xoá');
    this.servers.delete(id);
    this._save();
  }
}
