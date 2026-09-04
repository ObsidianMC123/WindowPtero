<h1 align="center">WindowPtero</h1>

<p align="center">
  Panel quản lý server Minecraft (PaperMC) chạy trực tiếp trên <b>Windows</b>.<br>
  Không Docker, không Wings, không cần Linux — tải về, <code>npm start</code>, xong.
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-%E2%89%A5%2018-5FA04E?logo=nodedotjs&logoColor=white">
  <img alt="Platform" src="https://img.shields.io/badge/Windows-Server%20%7C%2011%20%7C%2010-0078D4?logo=windows&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue">
</p>

---

## Panel này làm được gì

- **Quản lý nhiều server** trong một trang: Start / Stop / Restart, trạng thái sống theo thời gian thực (`STOPPED` / `STARTING` / `RUNNING` / `STOPPING`).
- **Console trực tiếp qua WebSocket** — xem log chạy và gõ lệnh như ngồi trước máy. Log giữ **màu ANSI 24-bit** của Paper/Spigot thay vì phun ra ký tự rác.
- **File manager** đầy đủ: duyệt thư mục, tạo / đổi tên / xoá, tải xuống, và **editor có syntax highlight** (CodeMirror) cho `server.properties`, YAML, JSON.
- **Upload streaming tới 2 GB/file** có thanh tiến trình thật, ghi ra file tạm rồi mới đổi tên nên upload dở không phá file cũ; trùng tên thì hỏi trước khi ghi đè.
- **Chạy được trên điện thoại**: sidebar thành drawer, log wrap đúng, ô nhập lệnh ghăm đáy màn hình.
- **Đăng nhập bằng session cookie** (bcrypt + rate limit), WebSocket cũng **bắt buộc đăng nhập** ngay từ bước upgrade.
- **Tùy biến nền** panel bằng ảnh hoặc video của riêng bạn.
- **Một script deploy** cho VPS Windows: tự cài Node, Java, mở firewall, tạo link HTTPS, tự bật lại khi reboot.

## Yêu cầu

| Thứ | Phiên bản |
|---|---|
| Windows | 10 / 11 / Server 2019+ |
| Node.js | 18 trở lên |
| Java | 21 trở lên (cho Paper đời mới) |

## Cài nhanh trên máy của bạn

```bash
git clone https://github.com/ObsidianMC123/WindowPtero.git
cd WindowPtero
npm install

copy .env.example .env      # rồi sửa WP_ADMIN_PASS trong .env
npm start
```

Mở http://localhost:2008 và đăng nhập.

Nếu bỏ qua bước tạo `.env`, panel sẽ **sinh mật khẩu ngẫu nhiên và in ra console** lúc chạy lần đầu — không có mật khẩu mặc định nào nằm trong source.

## Cài trên VPS Windows (một script)

Bấm phải `deploy\Chay-de-cai-dat.bat` → **Run as administrator**. Script tự:

1. Cài Node.js LTS nếu máy chưa có
2. Cài Temurin JRE 21 riêng cho panel nếu chưa có Java
3. Copy panel vào `C:\WindowPtero` và cài thư viện (không ghi đè `data\`, `volumes\`)
4. Sinh mật khẩu admin ngẫu nhiên vào `.env`
5. Tạo link HTTPS qua Cloudflare (không cần mở port, không cần domain) và/hoặc mở cổng 2008 trên firewall
6. Đặt Scheduled Task để panel tự chạy lại khi VPS reboot hoặc khi panel crash

Cuối cùng script in ra link + tài khoản + mật khẩu và lưu vào `_THONG-TIN-TRUY-CAP.txt`.
Gỡ sạch bằng `deploy\uninstall.ps1` (mặc định giữ lại world).

Chi tiết xem `deploy/DOC-TRUOC-KHI-CHAY.txt`.

## Biến môi trường

Tất cả đều tùy chọn, để trong file `.env` ở gốc project.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `WP_PORT` | `2008` | Cổng panel |
| `WP_HOST` | `0.0.0.0` | Địa chỉ bind. Đặt `127.0.0.1` khi chạy sau reverse proxy |
| `WP_ADMIN_USER` | `admin` | Tài khoản seed lần đầu |
| `WP_ADMIN_PASS` | *(sinh ngẫu nhiên)* | Mật khẩu seed lần đầu |
| `WP_HTTPS` | `0` | `1` khi chạy sau HTTPS → bật cookie `Secure` + HSTS |
| `WP_TRUST_PROXY` | *(tắt)* | Số tầng proxy tin cậy để rate limit đọc đúng IP |
| `WP_MAX_UPLOAD_BYTES` | `2147483648` | Giới hạn mỗi file upload |
| `WP_MAX_UPLOAD_FILES` | `20` | Số file mỗi lần upload |
| `WP_ACCESS` | `both` | `port` / `tunnel` / `both` — chỉ script deploy đọc |

Biến set sẵn ngoài shell luôn ưu tiên hơn `.env`.

## Lưu ý bảo mật

Panel có file editor và cho sửa tham số khởi động server, nghĩa là **ai đăng nhập được panel thì chạy được lệnh trên máy đó**. Vì vậy:

- Đặt mật khẩu mạnh trong `.env`, đừng dùng lại mật khẩu ở nơi khác.
- Muốn mở ra internet thì nên đứng sau HTTPS (Cloudflare Tunnel, nginx, Caddy) và đặt `WP_HTTPS=1`.
- Chạy HTTP thuần chỉ an toàn trong LAN, `localhost`, hoặc qua VPN riêng như Tailscale.
- `data/`, `volumes/` và `.env` đã nằm trong `.gitignore` — đừng bỏ ra.

## Cấu trúc

```
server.js              điểm vào Express + HTTP server
src/
  env.js               nạp .env (không cần dotenv)
  auth.js              bcrypt, session, cookie
  ws.js                WebSocket console (xác thực ngay lúc upgrade)
  ServerManager.js     quản lý danh sách server
  GameServer.js        spawn java, bắt log, gửi lệnh vào stdin
  fileutil.js          chống path traversal
  routes/              servers | files | auth | background
public/                giao diện (HTML + CSS + JS thuần, không framework)
deploy/                script cài đặt & gỡ cho Windows Server
```

## Roadmap

- [ ] Toast thay cho `alert()` / `confirm()`
- [ ] Self-host CodeMirror để chạy được khi không có mạng
- [ ] Badge RAM / uptime cho từng server
- [ ] Đổi mật khẩu ngay trong panel
- [ ] Tự tải jar Paper theo phiên bản
- [ ] Backup / restore world theo lịch

## License

MIT — xem [LICENSE](LICENSE).

---

<sub><b>English:</b> WindowPtero is a self-hosted Minecraft (PaperMC) server panel that runs natively on Windows — no Docker, no Wings, no Linux required. Live WebSocket console with full ANSI colour support, file manager with syntax-highlighting editor, streaming uploads up to 2 GB, mobile-friendly UI, cookie-based auth, and a one-click deploy script for Windows Server. See the sections above for setup; configuration lives in <code>.env</code>.</sub>
