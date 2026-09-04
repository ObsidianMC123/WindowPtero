// src/GameServer.js
// Đại diện MỘT PaperMC server: spawn java, đọc stdout, gửi lệnh xuống stdin,
// stop bằng cách gõ "stop" rồi CHỜ process exit thật (không kill cứng => không hỏng world).
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';

// Các trạng thái vòng đời
export const STATE = {
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
};

// Giữ tối đa bao nhiêu dòng console trong bộ nhớ (để client mới vào xem lại)
const MAX_LOG_LINES = 300;

export default class GameServer extends EventEmitter {
  /**
   * @param {object} cfg cấu hình 1 server
   *   { id, name, path, jarName, javaPath, minRam, maxRam, flags, autoRestart }
   */
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.id = cfg.id;
    this.proc = null;
    this.state = STATE.STOPPED;
    this.logBuffer = [];          // ring buffer console
    this._wantRestart = false;    // đánh dấu: exit xong thì start lại
    this._manualStop = false;     // stop do user bấm (để phân biệt với crash)
  }

  // ---- helpers ----
  _setState(s) {
    this.state = s;
    this.emit('state', s);
  }

  _pushLog(line) {
    this.logBuffer.push(line);
    if (this.logBuffer.length > MAX_LOG_LINES) this.logBuffer.shift();
    this.emit('console', line);
  }

  // Trả về snapshot an toàn để gửi ra API/WS
  snapshot() {
    return {
      id: this.id,
      name: this.cfg.name,
      path: this.cfg.path,
      state: this.state,
      pid: this.proc?.pid ?? null,
    };
  }

  // Kiểm tra file jar tồn tại trước khi chạy
  _validate() {
    if (!this.cfg.path || !fs.existsSync(this.cfg.path)) {
      throw new Error(`Thư mục server không tồn tại: ${this.cfg.path}`);
    }
    const jar = path.join(this.cfg.path, this.cfg.jarName || 'paper.jar');
    if (!fs.existsSync(jar)) {
      throw new Error(`Không tìm thấy jar: ${jar} (hãy nhét paper.jar vào thư mục này)`);
    }
    return jar;
  }

  // ---- điều khiển ----
  start() {
    if (this.state !== STATE.STOPPED) {
      throw new Error(`Không thể start khi đang ở trạng thái ${this.state}`);
    }
    const jar = this._validate();
    const java = this.cfg.javaPath?.trim() || 'java';

    // Ghép args: -Xms -Xmx + flags tuỳ chọn + -jar + --nogui
    const args = [];
    if (this.cfg.minRam) args.push(`-Xms${this.cfg.minRam}`);
    if (this.cfg.maxRam) args.push(`-Xmx${this.cfg.maxRam}`);
    if (this.cfg.flags && this.cfg.flags.trim()) {
      args.push(...this.cfg.flags.trim().split(/\s+/));
    }
    args.push('-jar', this.cfg.jarName || 'paper.jar', '--nogui');

    this._manualStop = false;
    this._setState(STATE.STARTING);
    this._pushLog(`[WindowPtero] Khởi động: ${java} ${args.join(' ')}`);
    this._pushLog(`[WindowPtero] cwd: ${this.cfg.path}`);

    this.proc = spawn(java, args, {
      cwd: this.cfg.path,
      windowsHide: true,
    });

    // stdout: gom theo dòng, dò "Done" của Paper để chuyển sang RUNNING
    this.proc.stdout.on('data', (buf) => this._onData(buf));
    this.proc.stderr.on('data', (buf) => this._onData(buf));

    this.proc.on('error', (err) => {
      this._pushLog(`[WindowPtero][LỖI] Không spawn được java: ${err.message}`);
      this._setState(STATE.STOPPED);
    });

    this.proc.on('exit', (code, signal) => this._onExit(code, signal));
  }

  _onData(buf) {
    const text = buf.toString('utf8');
    for (const raw of text.split(/\r?\n/)) {
      if (raw === '') continue;
      this._pushLog(raw);
      // Paper in "Done (x.xxxs)! For help, type "help"" khi sẵn sàng
      if (this.state === STATE.STARTING && /\bDone\b.*For help/.test(raw)) {
        this._setState(STATE.RUNNING);
      }
    }
  }

  _onExit(code, signal) {
    this.proc = null;
    this._pushLog(`[WindowPtero] Tiến trình kết thúc (code=${code}, signal=${signal})`);
    this._setState(STATE.STOPPED);

    // Restart chủ động: chỉ start lại SAU khi đã exit thật (tránh bẫy "java nuốt stdin")
    if (this._wantRestart) {
      this._wantRestart = false;
      this._pushLog('[WindowPtero] Restart: khởi động lại...');
      setTimeout(() => {
        try { this.start(); } catch (e) { this._pushLog(`[WindowPtero][LỖI] ${e.message}`); }
      }, 1000);
      return;
    }

    // Auto-restart khi crash (không phải do user bấm stop)
    if (this.cfg.autoRestart && !this._manualStop) {
      this._pushLog('[WindowPtero] autoRestart bật + không phải stop tay => khởi động lại...');
      setTimeout(() => {
        try { this.start(); } catch (e) { this._pushLog(`[WindowPtero][LỖI] ${e.message}`); }
      }, 3000);
    }
  }

  // Gửi lệnh bất kỳ xuống stdin (console)
  sendCommand(cmd) {
    if (this.state !== STATE.RUNNING && this.state !== STATE.STARTING) {
      throw new Error(`Server không chạy (state=${this.state})`);
    }
    if (!this.proc?.stdin.writable) {
      throw new Error('stdin không ghi được');
    }
    this.proc.stdin.write(cmd.replace(/[\r\n]+$/, '') + '\n');
    this._pushLog(`> ${cmd}`);
  }

  // Stop MỀM: gõ "stop", để Paper tự lưu world rồi thoát. KHÔNG kill cứng.
  stop() {
    if (this.state === STATE.STOPPED) return;
    if (this.state === STATE.STOPPING) return;
    this._manualStop = true;
    this._setState(STATE.STOPPING);
    this._pushLog('[WindowPtero] Gửi lệnh "stop", chờ Paper lưu world & thoát...');
    try {
      this.proc.stdin.write('stop\n');
    } catch (e) {
      this._pushLog(`[WindowPtero][LỖI] Ghi stdin thất bại: ${e.message}`);
    }
  }

  // Restart = stop rồi CHỜ exit mới start (đặt cờ, _onExit lo phần start lại)
  restart() {
    if (this.state === STATE.STOPPED) {
      this.start();
      return;
    }
    this._wantRestart = true;
    this.stop();
  }

  // Kill cứng - CHỈ dùng khi stop mềm treo quá lâu (nút khẩn cấp)
  kill() {
    if (this.proc) {
      this._pushLog('[WindowPtero][CẢNH BÁO] KILL cứng - có thể mất dữ liệu world!');
      this.proc.kill('SIGKILL');
    }
  }
}
