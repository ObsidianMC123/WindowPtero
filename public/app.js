// public/app.js - frontend logic WindowPtero (M4)
const $ = (id) => document.getElementById(id);
const api = (url, opts) => fetch('/api' + url, {
  headers: { 'content-type': 'application/json' }, ...opts,
}).then(async (r) => {
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || ('HTTP ' + r.status));
  return data;
});

// icon SVG từ sprite trong index.html (an toàn: không nhận input người dùng)
const svgIcon = (name, cls = 'ic') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

let servers = [];
let currentId = null;
let ws = null;

// ---------- Danh sách ----------
async function loadServers() {
  servers = await api('/servers');
  renderList();
  $('emptyHint').hidden = servers.length > 0;
  if (currentId && !servers.find((s) => s.id === currentId)) selectServer(null);
}

function renderList() {
  const ul = $('serverList');
  ul.innerHTML = '';
  for (const s of servers) {
    const li = document.createElement('li');
    li.className = 'server-item' + (s.id === currentId ? ' active' : '');
    li.innerHTML = `<span class="dot ${s.state}"></span><span class="nm"></span><span class="state state-${s.state}">${s.state}</span>`;
    li.querySelector('.nm').textContent = s.name;
    li.onclick = () => selectServer(s.id);
    ul.appendChild(li);
  }
}

// ---------- Drawer sidebar (mobile) ----------
// Trên điện thoại sidebar cũ chiếm 1/3 màn hình -> log chỉ còn mẩu con.
// Giờ sidebar trượt ra khi bấm nút menu, chọn server xong tự đóng.
function navClose() {
  document.body.classList.remove('nav-open');
  const bd = $('navBackdrop');
  if (bd) bd.hidden = true;
}
function navToggle() {
  const open = !document.body.classList.contains('nav-open');
  document.body.classList.toggle('nav-open', open);
  const bd = $('navBackdrop');
  if (bd) bd.hidden = !open;
}
if ($('btnMenu')) $('btnMenu').onclick = navToggle;
if ($('navBackdrop')) $('navBackdrop').onclick = navClose;
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') navClose(); });

// ---------- Chọn + console WS ----------
function selectServer(id) {
  currentId = id;
  navClose();
  if (ws) { ws.close(); ws = null; }
  renderList();
  const pane = $('detailPane');
  const ph = $('placeholderPane');
  if (!id) { pane.hidden = true; if (ph) ph.hidden = false; return; }
  pane.hidden = false;
  if (ph) ph.hidden = true;
  const s = servers.find((x) => x.id === id);
  $('dName').textContent = s.name;
  $('dPath').textContent = s.path;
  setState(s.state);
  $('console').textContent = '';
  switchTab('console');
  fmReset();
  openWS(id);
}

function setState(state) {
  const el = $('dState');
  el.textContent = state;
  el.className = 'state state-' + state;
  const running = state === 'RUNNING';
  const stopped = state === 'STOPPED';
  $('btnStart').disabled = !stopped;
  $('btnStop').disabled = !running;
  $('btnRestart').disabled = stopped;
  $('cmdInput').disabled = !running;
  // cập nhật dot trong list
  const s = servers.find((x) => x.id === currentId);
  if (s) { s.state = state; renderList(); }
}

// ---------- ANSI -> DOM ----------
// Paper/Spigot in log kèm escape màu (\x1b[38;2;R;G;Bm...). Nếu nhét thẳng vào
// textContent thì màn hình đầy ký tự rác kiểu "□[38;2;255;85;85m".
// Ở đây parse SGR thành <span style="color:..."> để log ra màu như trong CMD.
const ANSI_16 = [
  '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#cccccc',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
];
const ANSI_CUBE = [0, 95, 135, 175, 215, 255];
const MAX_CONSOLE_LINES = 2000;

function ansi256(n) {
  n = Number(n) || 0;
  if (n < 16) return ANSI_16[n];
  if (n < 232) {
    const i = n - 16;
    return `rgb(${ANSI_CUBE[Math.floor(i / 36) % 6]},${ANSI_CUBE[Math.floor(i / 6) % 6]},${ANSI_CUBE[i % 6]})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}

// Dựng 1 dòng console thành <div class="ln"> có màu
function ansiLine(raw) {
  const div = document.createElement('div');
  div.className = 'ln';

  // Bỏ các escape không phải màu (di chuyển con trỏ, xoá dòng, set title...)
  const text = String(raw == null ? '' : raw)
    .replace(/\r/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ABCDEFGHJKSTfhilnpsu]/g, '')
    .replace(/\x1b[=>()][0-9A-Za-z]?/g, '');

  let st = { fg: null, bg: null, bold: false, italic: false, underline: false };

  const push = (chunk) => {
    const s = chunk.replace(/\x1b/g, '');
    if (!s) return;
    if (!st.fg && !st.bg && !st.bold && !st.italic && !st.underline) {
      div.appendChild(document.createTextNode(s));
      return;
    }
    const sp = document.createElement('span');
    if (st.fg) sp.style.color = st.fg;
    if (st.bg) sp.style.backgroundColor = st.bg;
    const cls = [st.bold && 'b', st.italic && 'em', st.underline && 'u'].filter(Boolean);
    if (cls.length) sp.className = cls.join(' ');
    sp.textContent = s;
    div.appendChild(sp);
  };

  const apply = (codeStr) => {
    const codes = (codeStr === '' ? '0' : codeStr).split(';').map((x) => (x === '' ? 0 : Number(x)));
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) st = { fg: null, bg: null, bold: false, italic: false, underline: false };
      else if (c === 1) st.bold = true;
      else if (c === 3) st.italic = true;
      else if (c === 4) st.underline = true;
      else if (c === 22) st.bold = false;
      else if (c === 23) st.italic = false;
      else if (c === 24) st.underline = false;
      else if (c === 39) st.fg = null;
      else if (c === 49) st.bg = null;
      else if (c >= 30 && c <= 37) st.fg = ANSI_16[c - 30];
      else if (c >= 90 && c <= 97) st.fg = ANSI_16[c - 90 + 8];
      else if (c >= 40 && c <= 47) st.bg = ANSI_16[c - 40];
      else if (c >= 100 && c <= 107) st.bg = ANSI_16[c - 100 + 8];
      else if (c === 38 || c === 48) {
        const mode = codes[i + 1];
        let color = null;
        if (mode === 5) { color = ansi256(codes[i + 2]); i += 2; }
        else if (mode === 2) {
          color = `rgb(${codes[i + 2] | 0},${codes[i + 3] | 0},${codes[i + 4] | 0})`;
          i += 4;
        }
        if (color) { if (c === 38) st.fg = color; else st.bg = color; }
      }
    }
  };

  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index));
    apply(m[1]);
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return div;
}

function appendConsole(lines) {
  const c = $('console');
  const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
  const arr = Array.isArray(lines) ? lines : [lines];
  const frag = document.createDocumentFragment();
  for (const item of arr) {
    const parts = String(item == null ? '' : item).split('\n');
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
    for (const p of parts) frag.appendChild(ansiLine(p));
  }
  c.appendChild(frag);
  // Giữ DOM gọn: log chạy cả ngày không làm treo tab
  while (c.childElementCount > MAX_CONSOLE_LINES) c.removeChild(c.firstElementChild);
  if (atBottom) c.scrollTop = c.scrollHeight;
}

function openWS(id) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?id=${id}`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'history') { if (msg.data.length) appendConsole(msg.data); }
    else if (msg.type === 'console') appendConsole(msg.data);
    else if (msg.type === 'state') setState(msg.data);
    else if (msg.type === 'error') appendConsole('⚠ ' + msg.data);
  };
  ws.onclose = () => { /* im lặng, sẽ mở lại khi chọn server */ };
}

// ---------- Điều khiển ----------
async function ctrl(action) {
  if (!currentId) return;
  try { await api(`/servers/${currentId}/${action}`, { method: 'POST' }); }
  catch (e) { alert('Lỗi ' + action + ': ' + e.message); }
}
$('btnStart').onclick = () => ctrl('start');
$('btnStop').onclick = () => ctrl('stop');
$('btnRestart').onclick = () => ctrl('restart');

$('btnDelete').onclick = async () => {
  if (!currentId) return;
  const s = servers.find((x) => x.id === currentId);
  if (!confirm(`Xoá server "${s?.name}" khỏi panel? (không xoá file trên đĩa)`)) return;
  try { await api(`/servers/${currentId}`, { method: 'DELETE' }); selectServer(null); await loadServers(); }
  catch (e) { alert('Không xoá được: ' + e.message); }
};

// ---------- Gửi lệnh ----------
$('cmdForm').onsubmit = (e) => {
  e.preventDefault();
  const inp = $('cmdInput');
  const cmd = inp.value.trim();
  if (!cmd || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'command', data: cmd }));
  inp.value = '';
};

// ---------- Modal add/edit ----------
function openModal(srv) {
  $('formErr').textContent = '';
  $('modalTitle').textContent = srv ? 'Sửa server' : 'Thêm server';
  $('fId').value = srv?.id || '';
  $('fName').value = srv?.name || '';
  $('fJar').value = srv?.jarName || 'paper.jar';
  $('fJava').value = srv?.javaPath || '';
  $('fMin').value = srv?.minRam || '2G';
  $('fMax').value = srv?.maxRam || '4G';
  $('fFlags').value = srv?.flags || '';
  $('fAuto').checked = !!srv?.autoRestart;
  $('modal').hidden = false;
}
$('btnAdd').onclick = () => openModal(null);
$('btnEdit').onclick = async () => {
  const full = await api('/servers/' + currentId);
  openModal({ id: currentId, ...full.cfg });
};
$('btnCancel').onclick = () => { $('modal').hidden = true; };

$('srvForm').onsubmit = async (e) => {
  e.preventDefault();
  const id = $('fId').value;
  const body = {
    name: $('fName').value.trim(),
    jarName: $('fJar').value.trim() || 'paper.jar',
    javaPath: $('fJava').value.trim() || undefined,
    minRam: $('fMin').value.trim(),
    maxRam: $('fMax').value.trim(),
    flags: $('fFlags').value.trim() || undefined,
    autoRestart: $('fAuto').checked,
  };
  try {
    if (id) await api('/servers/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/servers', { method: 'POST', body: JSON.stringify(body) });
    $('modal').hidden = true;
    await loadServers();
  } catch (err) { $('formErr').textContent = err.message; }
};

// ---------- Poll nhẹ để cập nhật list khi không mở server ----------
setInterval(() => { if (!ws || ws.readyState !== WebSocket.OPEN) loadServers().catch(() => {}); }, 5000);

loadServers().catch((e) => { $('emptyHint').textContent = 'Lỗi tải: ' + e.message; $('emptyHint').hidden = false; });

// ==================== Đăng xuất ====================
$('btnLogout').onclick = async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  location.href = '/login.html';
};

// ==================== Tabs ====================
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  $('tab-console').hidden = name !== 'console';
  $('tab-files').hidden = name !== 'files';
  if (name === 'files' && currentId) fmLoad(fmPath);
}
document.querySelectorAll('.tab-btn').forEach((b) => {
  b.onclick = () => switchTab(b.dataset.tab);
});

// ==================== File Manager ====================
let fmPath = '';           // thư mục hiện tại (tương đối gốc server)
let fmCM = null;           // CodeMirror instance
let fmEditingPath = null;  // file đang mở editor

function fmReset() {
  fmPath = '';
  $('fmEditor').hidden = true;
  $('fmErr').textContent = '';
  $('fmList').innerHTML = '';
}

function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('vi-VN');
}

async function fmLoad(rel) {
  if (!currentId) return;
  fmPath = rel || '';
  $('fmErr').textContent = '';
  try {
    const data = await api(`/servers/${currentId}/files/list?path=${encodeURIComponent(fmPath)}`);
    renderCrumbs();
    renderFmList(data.entries);
  } catch (e) {
    $('fmErr').textContent = e.message;
  }
}

function renderCrumbs() {
  const parts = fmPath ? fmPath.split('/').filter(Boolean) : [];
  const el = $('fmCrumbs');
  el.innerHTML = '';
  const root = document.createElement('a');
  root.innerHTML = svgIcon('home', 'ic ic-sm') + ' /';
  root.href = '#';
  root.onclick = (e) => { e.preventDefault(); fmLoad(''); };
  el.appendChild(root);
  let acc = '';
  parts.forEach((p) => {
    acc += (acc ? '/' : '') + p;
    const cur = acc;
    const sep = document.createTextNode(' / ');
    el.appendChild(sep);
    const a = document.createElement('a');
    a.textContent = p; a.href = '#';
    a.onclick = (e) => { e.preventDefault(); fmLoad(cur); };
    el.appendChild(a);
  });
}

function renderFmList(entries) {
  const tb = $('fmList');
  tb.innerHTML = '';
  if (!entries.length) {
    tb.innerHTML = '<tr><td colspan="4" class="fm-empty">(thư mục trống)</td></tr>';
    return;
  }
  for (const e of entries) {
    const tr = document.createElement('tr');
    const icName = e.type === 'dir' ? 'folder' : (e.editable ? 'file' : 'package');
    const nameCell = document.createElement('td');
    nameCell.className = 'fm-name';
    nameCell.innerHTML = svgIcon(icName, e.type === 'dir' ? 'ic ic-dir' : 'ic');
    const nameText = document.createElement('span');
    nameText.textContent = e.name;
    nameCell.appendChild(nameText);
    if (e.type === 'dir') {
      nameCell.classList.add('link');
      nameCell.onclick = () => fmLoad(fmPath ? fmPath + '/' + e.name : e.name);
    } else if (e.editable) {
      nameCell.classList.add('link');
      nameCell.onclick = () => fmOpenFile(e.name);
    }
    const sizeCell = document.createElement('td');
    sizeCell.textContent = e.type === 'dir' ? '—' : fmt(e.size);
    const timeCell = document.createElement('td');
    timeCell.textContent = fmtTime(e.mtime);
    const actCell = document.createElement('td');
    actCell.className = 'fm-row-actions';

    if (e.type === 'file') {
      const dl = document.createElement('button');
      dl.className = 'btn btn-sm btn-icon'; dl.innerHTML = svgIcon('download', 'ic ic-sm');
      dl.title = 'Tải về';
      dl.onclick = () => {
        const p = fmPath ? fmPath + '/' + e.name : e.name;
        window.open(`/api/servers/${currentId}/files/download?path=${encodeURIComponent(p)}`, '_blank');
      };
      actCell.appendChild(dl);
    }
    const rn = document.createElement('button');
    rn.className = 'btn btn-sm btn-icon'; rn.innerHTML = svgIcon('pencil', 'ic ic-sm'); rn.title = 'Đổi tên';
    rn.onclick = () => fmRename(e.name);
    actCell.appendChild(rn);

    const del = document.createElement('button');
    del.className = 'btn btn-sm btn-icon btn-danger'; del.innerHTML = svgIcon('trash', 'ic ic-sm'); del.title = 'Xoá';
    del.onclick = () => fmDelete(e.name);
    actCell.appendChild(del);

    tr.append(nameCell, sizeCell, timeCell, actCell);
    tb.appendChild(tr);
  }
}

async function fmOpenFile(name) {
  const p = fmPath ? fmPath + '/' + name : name;
  try {
    const data = await api(`/servers/${currentId}/files/read?path=${encodeURIComponent(p)}`);
    fmEditingPath = p;
    $('fmEditName').textContent = p;
    $('fmEditor').hidden = false;
    if (!fmCM) {
      fmCM = CodeMirror.fromTextArea($('fmEditArea'), {
        lineNumbers: true, theme: 'default',
      });
      fmCM.setSize('100%', 360);
    }
    // Chọn mode theo đuôi
    const ext = name.split('.').pop().toLowerCase();
    let mode = 'text/plain';
    if (['yml', 'yaml'].includes(ext)) mode = 'yaml';
    else if (['js', 'json'].includes(ext)) mode = 'javascript';
    else if (['properties', 'conf', 'ini', 'cfg'].includes(ext)) mode = 'properties';
    fmCM.setOption('mode', mode);
    fmCM.setValue(data.content);
    fmCM.refresh();
  } catch (e) {
    $('fmErr').textContent = e.message;
  }
}

$('fmSave').onclick = async () => {
  if (!fmEditingPath) return;
  try {
    await api(`/servers/${currentId}/files/write`, {
      method: 'PUT',
      body: JSON.stringify({ path: fmEditingPath, content: fmCM.getValue() }),
    });
    $('fmErr').textContent = '';
    $('fmErr').style.color = '#72BC8F';
    $('fmErr').textContent = '✓ Đã lưu ' + fmEditingPath;
    setTimeout(() => { $('fmErr').textContent = ''; $('fmErr').style.color = ''; }, 2500);
  } catch (e) {
    $('fmErr').style.color = '';
    $('fmErr').textContent = e.message;
  }
};
$('fmCloseEdit').onclick = () => { $('fmEditor').hidden = true; fmEditingPath = null; };

$('fmUp').onclick = () => {
  if (!fmPath) return;
  const parts = fmPath.split('/').filter(Boolean);
  parts.pop();
  fmLoad(parts.join('/'));
};
$('fmRefresh').onclick = () => fmLoad(fmPath);

$('fmNewFolder').onclick = async () => {
  const name = prompt('Tên thư mục mới:');
  if (!name) return;
  const p = fmPath ? fmPath + '/' + name : name;
  try {
    await api(`/servers/${currentId}/files/mkdir`, { method: 'POST', body: JSON.stringify({ path: p }) });
    fmLoad(fmPath);
  } catch (e) { $('fmErr').textContent = e.message; }
};

async function fmRename(name) {
  const to = prompt('Đổi tên "' + name + '" thành:', name);
  if (!to || to === name) return;
  const from = fmPath ? fmPath + '/' + name : name;
  const dest = fmPath ? fmPath + '/' + to : to;
  try {
    await api(`/servers/${currentId}/files/rename`, { method: 'POST', body: JSON.stringify({ from, to: dest }) });
    fmLoad(fmPath);
  } catch (e) { $('fmErr').textContent = e.message; }
}

async function fmDelete(name) {
  if (!confirm('Xoá "' + name + '"? Không khôi phục được.')) return;
  const p = fmPath ? fmPath + '/' + name : name;
  try {
    await api(`/servers/${currentId}/files/delete`, { method: 'DELETE', body: JSON.stringify({ path: p }) });
    fmLoad(fmPath);
  } catch (e) { $('fmErr').textContent = e.message; }
}

// ==================== Upload ====================
// Dùng XMLHttpRequest thay fetch vì fetch không báo tiến độ upload.
// Trước đây file 500MB cũng chỉ "treo im" rồi xong -> nhìn như instant.
let fmXhr = null;

function fmProgressShow(on) {
  const box = $('fmProgress');
  if (box) box.dataset.on = on ? '1' : '0';
  if (!on) {
    const fill = $('fmProgressFill');
    if (fill) fill.style.width = '0%';
  }
}

function fmUpload(files, overwrite = false) {
  if (!files || !files.length || !currentId) return;
  const list = Array.from(files);
  const fd = new FormData();
  for (const f of list) fd.append('file', f);
  const total = list.reduce((a, f) => a + f.size, 0);

  const fill = $('fmProgressFill');
  const txt = $('fmProgressTxt');
  $('fmErr').textContent = '';
  fmProgressShow(true);
  if (fill) fill.style.width = '0%';
  if (txt) txt.textContent = `Đang tải ${list.length} file (${fmt(total)})...`;

  const xhr = new XMLHttpRequest();
  fmXhr = xhr;
  const q = `?path=${encodeURIComponent(fmPath)}${overwrite ? '&overwrite=1' : ''}`;
  xhr.open('POST', `/api/servers/${currentId}/files/upload${q}`);

  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = (e.loaded / e.total) * 100;
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    if (txt) txt.textContent = `${fmt(e.loaded)} / ${fmt(e.total)} (${pct.toFixed(0)}%)`;
  };

  xhr.onload = () => {
    fmXhr = null;
    let data = null;
    try { data = JSON.parse(xhr.responseText); } catch {}

    // 409 = trùng tên -> hỏi trước khi ghi đè (server không âm thầm đè nữa)
    if (xhr.status === 409 && data && data.conflicts && data.conflicts.length) {
      fmProgressShow(false);
      if (confirm(`Đã có file: ${data.conflicts.join(', ')}\nGhi đè luôn?`)) {
        fmUpload(list, true);
        return;
      }
      $('fmUploadInput').value = '';
      return;
    }

    if (xhr.status < 200 || xhr.status >= 300) {
      fmProgressShow(false);
      $('fmErr').textContent = (data && data.error) || ('HTTP ' + xhr.status);
      $('fmUploadInput').value = '';
      return;
    }

    if (fill) fill.style.width = '100%';
    if (txt) txt.textContent = 'Xong: ' + ((data && data.saved) || []).join(', ');
    setTimeout(() => fmProgressShow(false), 1500);
    $('fmUploadInput').value = '';
    fmLoad(fmPath);
  };

  xhr.onerror = () => {
    fmXhr = null;
    fmProgressShow(false);
    $('fmErr').textContent = 'Mất kết nối khi upload.';
    $('fmUploadInput').value = '';
  };
  xhr.onabort = () => {
    fmXhr = null;
    fmProgressShow(false);
    $('fmErr').textContent = 'Đã huỷ upload.';
    $('fmUploadInput').value = '';
  };

  xhr.send(fd);
}

$('fmUploadBtn').onclick = () => $('fmUploadInput').click();
$('fmUploadInput').onchange = () => fmUpload($('fmUploadInput').files);
if ($('fmUploadCancel')) $('fmUploadCancel').onclick = () => { if (fmXhr) fmXhr.abort(); };

// ==================== Custom Background ====================
function applyBg(url, type) {
  const layer = $('bgLayer'), video = $('bgVideo'), overlay = $('bgOverlay');
  if (!url) {
    document.body.classList.remove('has-bg');
    layer.hidden = true; layer.style.backgroundImage = '';
    video.hidden = true; video.removeAttribute('src'); video.load();
    overlay.hidden = true;
    return;
  }
  document.body.classList.add('has-bg');
  overlay.hidden = false;
  if (type === 'video') {
    layer.hidden = true; layer.style.backgroundImage = '';
    video.hidden = false; video.src = url; video.play().catch(() => {});
  } else {
    video.hidden = true; video.removeAttribute('src');
    layer.hidden = false; layer.style.backgroundImage = `url("${url}")`;
  }
}

async function loadBg() {
  try {
    const info = await api('/background');
    // thêm cache-bust để reload thấy nền mới
    applyBg(info.url ? info.url + '?t=' + Date.now() : null, info.type);
  } catch { /* im lặng nếu chưa đăng nhập */ }
}

const bgModal = $('bgModal');
$('btnBg').onclick = () => { $('bgErr').textContent = ''; bgModal.hidden = false; };
$('bgCancel').onclick = () => { bgModal.hidden = true; };
bgModal.onclick = (e) => { if (e.target === bgModal) bgModal.hidden = true; };

$('bgUpload').onclick = async () => {
  const f = $('bgFile').files[0];
  if (!f) { $('bgErr').textContent = 'Chưa chọn file.'; return; }
  if (f.size > 100 * 1024 * 1024) { $('bgErr').textContent = 'File quá 100MB.'; return; }
  const fd = new FormData();
  fd.append('bg', f);
  $('bgUpload').disabled = true; $('bgErr').textContent = 'Đang tải lên...';
  try {
    const res = await fetch('/api/background', { method: 'POST', body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || ('HTTP ' + res.status));
    applyBg(data.url + '?t=' + Date.now(), data.type);
    $('bgFile').value = '';
    bgModal.hidden = true;
  } catch (e) {
    $('bgErr').textContent = e.message;
  } finally {
    $('bgUpload').disabled = false;
  }
};

$('bgRemove').onclick = async () => {
  $('bgRemove').disabled = true;
  try {
    await api('/background', { method: 'DELETE' });
    applyBg(null);
    $('bgFile').value = '';
    bgModal.hidden = true;
  } catch (e) { $('bgErr').textContent = e.message; }
  finally { $('bgRemove').disabled = false; }
};

loadBg();
