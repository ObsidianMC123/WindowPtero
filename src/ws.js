// src/ws.js - WebSocket console hub (M2)
// Client kết nối ws://host/ws?id=<serverId>
//  - BẮT BUỘC đã đăng nhập (verify cookie wp_session ngay ở bước upgrade)
//  - nhận ngay buffer console cũ (replay)
//  - nhận state hiện tại
//  - stream console live + đổi state
//  - gửi {type:'command', data:'...'} để đẩy xuống stdin
import { WebSocketServer } from 'ws';
import { verifyToken, COOKIE_NAME } from './auth.js';

// Bước upgrade KHÔNG đi qua cookie-parser nên phải tự đọc header Cookie
function readCookie(header, name) {
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const raw = part.slice(i + 1).trim();
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return null;
}

function reject(socket, code, text) {
  try {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {}
  socket.destroy();
}

export function attachWebSocket(httpServer, mgr) {
  const wss = new WebSocketServer({ noServer: true });

  // Nâng cấp HTTP -> WS chỉ cho path /ws, và chỉ khi đã đăng nhập
  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return reject(socket, 400, 'Bad Request'); }

    if (url.pathname !== '/ws') return reject(socket, 404, 'Not Found');

    // ---- XÁC THỰC: không có session hợp lệ thì cắt ngay ----
    const session = verifyToken(readCookie(req.headers.cookie, COOKIE_NAME));
    if (!session) return reject(socket, 401, 'Unauthorized');

    const id = url.searchParams.get('id');
    const gs = mgr.get(id);
    if (!gs) return reject(socket, 404, 'Not Found');

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, gs, session);
    });
  });

  wss.on('connection', (ws, req, gs, session) => {
    const send = (obj) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    };

    // 1) gửi state + replay buffer console cũ
    send({ type: 'state', data: gs.state });
    send({ type: 'history', data: gs.logBuffer });

    // 2) đăng ký listener stream live
    const onConsole = (line) => send({ type: 'console', data: line });
    const onState = (s) => send({ type: 'state', data: s });
    gs.on('console', onConsole);
    gs.on('state', onState);

    // 3) nhận lệnh từ client
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'ping') { send({ type: 'pong' }); return; }
      if (msg.type === 'command' && typeof msg.data === 'string') {
        // Chặn payload rác: 1 lệnh console không thể dài cả MB
        if (msg.data.length > 2000) {
          send({ type: 'error', data: 'Lệnh quá dài (>2000 ký tự)' });
          return;
        }
        try { gs.sendCommand(msg.data); }
        catch (e) { send({ type: 'error', data: e.message }); }
      }
    });

    // 4) heartbeat: dọn connection chết (mất mạng, tắt máy đột ngột)
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // 5) dọn listener khi đóng (tránh leak)
    const cleanup = () => {
      gs.off('console', onConsole);
      gs.off('state', onState);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  // Ping toàn bộ client mỗi 30s, ai không phản hồi thì cắt
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);
  if (hb.unref) hb.unref();
  wss.on('close', () => clearInterval(hb));

  return wss;
}
