// src/routes/servers.js - REST API CRUD + điều khiển server (M3)
import express from 'express';

export default function serversRouter(mgr) {
  const r = express.Router();

  // Danh sách server
  r.get('/', (req, res) => {
    res.json(mgr.list());
  });

  // Chi tiết 1 server + buffer console hiện có
  r.get('/:id', (req, res) => {
    const gs = mgr.get(req.params.id);
    if (!gs) return res.status(404).json({ error: 'Không tìm thấy server' });
    res.json({ ...gs.snapshot(), cfg: gs.cfg, log: gs.logBuffer });
  });

  // Thêm server (trỏ path)
  r.post('/', (req, res) => {
    try {
      const gs = mgr.add(req.body || {});
      res.status(201).json(gs.snapshot());
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Sửa cấu hình
  r.put('/:id', (req, res) => {
    try {
      const gs = mgr.update(req.params.id, req.body || {});
      res.json(gs.snapshot());
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Xoá
  r.delete('/:id', (req, res) => {
    try {
      mgr.remove(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Điều khiển: start / stop / restart / kill
  r.post('/:id/:action', (req, res) => {
    const gs = mgr.get(req.params.id);
    if (!gs) return res.status(404).json({ error: 'Không tìm thấy server' });
    const act = req.params.action;
    try {
      switch (act) {
        case 'start':   gs.start();   break;
        case 'stop':    gs.stop();    break;
        case 'restart': gs.restart(); break;
        case 'kill':    gs.kill();    break;
        default: return res.status(400).json({ error: 'Action không hợp lệ' });
      }
      res.json({ ok: true, state: gs.state });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Gửi lệnh console qua REST (ngoài WS)
  r.post('/:id/command', (req, res) => {
    const gs = mgr.get(req.params.id);
    if (!gs) return res.status(404).json({ error: 'Không tìm thấy server' });
    try {
      gs.sendCommand(String(req.body?.command ?? ''));
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  return r;
}
