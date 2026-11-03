// Web app UI. All data comes from the Sheets API with the signed-in user's own Google permission; there is no server.
const CONFIG = window.HP_CONFIG;
const SHEET_API = 'https://sheets.googleapis.com/v4/spreadsheets/' + CONFIG.sheetId;
const L = window.HpLogic;
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* the app works without the cache */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to clear */ } }
};

/* ---------- Sign-in ---------- */
let token = null, tokenUntil = 0, tokenClient = null, tokenWaiters = [];
function initAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.clientId, scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: r => {
      const w = tokenWaiters; tokenWaiters = [];
      if (r.error) return w.forEach(x => x.fail(new Error('Chưa đăng nhập được: ' + r.error)));
      token = r.access_token; tokenUntil = Date.now() + (Number(r.expires_in) - 60) * 1000;
      try { sessionStorage.setItem('hp_token', JSON.stringify({ token, tokenUntil })); } catch (e) { /* sign in again after a reload */ }
      w.forEach(x => x.ok(token));
    },
    error_callback: e => { const w = tokenWaiters; tokenWaiters = []; w.forEach(x => x.fail(new Error('Chưa đăng nhập được: ' + (e.type || 'lỗi')))); }
  });
}
function getToken(interactive) {
  if (token && Date.now() < tokenUntil) return Promise.resolve(token);
  if (!interactive) { showLogin(true); return Promise.reject(new Error('Cần đăng nhập lại.')); }
  return new Promise((ok, fail) => { tokenWaiters.push({ ok, fail }); tokenClient.requestAccessToken({ prompt: '' }); });
}
async function api(path, options, attempts) {
  const t = await getToken(false);
  const o = Object.assign({}, options, { headers: Object.assign({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, (options || {}).headers) });
  let last = null;
  for (let k = 0; k < (attempts || 3); k++) {
    if (k) await new Promise(r => setTimeout(r, 4000 * k));
    try {
      const r = await fetch(SHEET_API + path, o);
      if (r.ok) return r.json();
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) { token = null; showLogin(true); throw new Error('Cần đăng nhập lại.'); }
      last = new Error((body.error && body.error.message) || ('Lỗi ' + r.status));
      if (r.status < 500 && r.status !== 429) throw last;
    } catch (e) { last = e; if (/đăng nhập/.test(e.message)) throw e; }
  }
  throw last;
}
const batchGet = (ranges, render) => api('/values:batchGet?valueRenderOption=' + (render || 'FORMATTED_VALUE') + '&' + ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&')).then(d => (d.valueRanges || []).map(x => x.values || []));
const batchWrite = data => api('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) }, 2);

/* ---------- State ---------- */
let classes = [], cur = null, curAt = 0, curFresh = false, loadSeq = 0, i = 0, step = 0, cards = {}, qrCache = {};
let view = 'home', tab = 'thu', filter = 'can', query = '', loadingAll = false, loadedCount = 0;
let noticeText = '', noticeErr = false;
const zaloItems = () => cur ? cur.items.filter(x => !x.paid) : [];
const fullName = x => x.name + (x.eng ? ' (' + x.eng + ')' : '');
const money = n => n ? L.fmt(n) + ' đ' : '';
const sentKey = () => 'hp_sent_' + cur.tab + '_' + cur.dot;
const sentSet = () => new Set(store.get(sentKey()) || []);

function summarize(data) {
  const paid = data.items.filter(x => x.paid), due = data.items.filter(x => !x.paid);
  return { paid: paid.length, total: data.items.length, got: paid.reduce((s, x) => s + (x.tienSheet || 0), 0),
    owe: due.reduce((s, x) => s + (x.amount || 0), 0), warn: due.filter(x => x.warn).length, none: due.filter(x => x.trong).length };
}

/* ---------- Reading ---------- */
async function readKho() { const [rows] = await batchGet(["'_TRO_LY_ZALO'!A:B"]); return rows; }
function khoMap(rows) { const map = {}; rows.forEach(r => { if (r[0]) map[r[0]] = r[1]; }); return map; }
async function readClass(name, kho) {
  const [parts, rows] = await Promise.all([batchGet(L.classRanges(name)), kho ? Promise.resolve(kho) : readKho()]);
  return L.buildClass(name, { top: parts[0], hist: parts[1], track: parts[2], msg: parts[3], kho: khoMap(rows) });
}
function setCurrent(data, at, fresh) {
  const keepKey = cur && cur.tab === data.tab ? (zaloItems()[i] || {}).key : null;
  cur = data; curAt = at; curFresh = fresh; cards = {};
  applyPendingToView();
  const z = zaloItems();
  i = keepKey ? Math.max(0, z.findIndex(x => x.key === keepKey)) : 0;
  render();
}
async function openClass(name) {
  const seq = ++loadSeq;
  view = 'class'; step = 0;
  store.set('hp_last_class', name); $('lop').value = name;
  const cached = store.get('hp_cls_' + name);
  if (cached) { i = 0; setCurrent(cached.data, cached.at, false); }
  else { cur = null; render(); }
  notice('Đang đọc số mới của ' + name + '…');
  try {
    const data = await readClass(name);
    if (seq !== loadSeq) return;
    const at = Date.now();
    store.set('hp_cls_' + name, { data, at });
    setCurrent(data, at, true);
    notice('');
  } catch (e) {
    if (seq === loadSeq) { notice('Chưa đọc được số mới: ' + e.message + '. File có thể đang bận, bấm ↻ để thử lại.', true); render(); }
  }
}
async function loadAll() {
  if (loadingAll) return;
  loadingAll = true; loadedCount = 0; render();
  try {
    const kho = await readKho();
    for (const name of classes) {
      try { store.set('hp_cls_' + name, { data: await readClass(name, kho), at: Date.now() }); }
      catch (e) { if (/đăng nhập/.test(e.message)) throw e; console.error(name, e.message); }
      loadedCount++;
      if (view === 'home') render();
    }
    store.set('hp_all_at', Date.now());
  } catch (e) { notice('Chưa đọc xong các lớp: ' + e.message, true); }
  loadingAll = false; if (view === 'home') render();
}

/* ---------- Paid ticks: saved in the browser first, then one batch per class ---------- */
const QKEY = 'hp_pending', FINAL_ERROR = /đổi học sinh|không còn trong live|chưa dùng sổ mới|không khớp|Không thấy cột/;
let pending = store.get(QKEY) || [], flushing = false, flushTimer = null;
function savePending() { store.set(QKEY, pending); renderNotices(); }
function applyPendingToView() {
  if (!cur) return;
  pending.filter(p => p.tab === cur.tab && p.dot === cur.dot).forEach(p => {
    const it = cur.items.find(x => x.key === p.item.key); if (!it) return;
    it.paid = p.kind === 'paid'; it.status = p.kind === 'paid' ? 'Đã nộp' : 'Chưa nộp'; it.date = p.kind === 'paid' ? p.date : ''; it.dangLuu = true;
  });
}
function queue(p) {
  pending = pending.filter(x => !(x.item.key === p.item.key && x.dot === p.dot)).concat(p);
  savePending(); applyPendingToView(); render();
  clearTimeout(flushTimer); flushTimer = setTimeout(flush, 3000);
}
async function flush() {
  if (flushing || !pending.length) return;
  flushing = true; renderNotices();
  const groups = {};
  pending.forEach(p => { (groups[p.tab] = groups[p.tab] || []).push(p); });
  for (const name of Object.keys(groups)) {
    const group = groups[name], rows = group.map(p => p.item.row);
    try {
      const want = L.freshRanges(name, rows), [values, cells] = await Promise.all([batchGet(want.values), batchGet(want.cells, 'FORMULA')]);
      const data = [], ok = [];
      group.forEach((p, k) => {
        const fresh = L.freshAt(values, cells, k);
        try {
          const up = p.kind === 'paid' ? L.planPaid(name, p.item, fresh, p.dot, p.date, p.item.amount) : L.planUnpaid(name, p.item, fresh, p.dot);
          up.forEach(x => data.push(x)); ok.push(p);
        } catch (e) { p.error = e.message; }
      });
      if (data.length) await batchWrite(data);
      const done = new Set(ok);
      pending = pending.filter(p => !done.has(p));
    } catch (e) { group.forEach(p => { p.error = e.message; }); }
  }
  flushing = false; savePending();
  if (cur && !pending.some(p => p.tab === cur.tab)) openClass(cur.tab);
  if (pending.some(p => !FINAL_ERROR.test(p.error || ''))) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 60000); }
}

/* ---------- Card (same drawing as the Sheet dialog) ---------- */
const MAU = '#0b5394';
const loadImg = src => new Promise((ok, fail) => { const m = new Image(); m.onload = () => ok(m); m.onerror = () => fail(new Error('Không tải được ảnh QR')); m.src = src; });
const toPng = c => new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error('png')), 'image/png'));
function loadQr(url) {
  if (!/^https:\/\/img\.vietqr\.io\//.test(url)) return Promise.reject(new Error('Link QR không hợp lệ.'));
  // The .png address redirects to .svg, and that redirect has no CORS header, so the browser must ask for .svg directly.
  if (!qrCache[url]) qrCache[url] = fetch(url.replace(/\.png\?/, '.svg?')).then(r => { if (!r.ok) throw new Error('Không tải được QR'); return r.blob(); })
    .then(b => new Promise((ok, fail) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = fail; f.readAsDataURL(b); }));
  return qrCache[url];
}
function wrap(ctx, s, maxW) {
  const out = []; let line = '';
  s.split(' ').forEach(w => { const t = line ? line + ' ' + w : w; if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t; });
  out.push(line); return out;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function veThiep(it, q) {
  const W = 1080, P = 72, LH = 46, BAND = 170;
  let lop = '';
  const lines = it.msg.split('\n').filter(l => {
    if (/^\[THÔNG BÁO/i.test(l)) return false;
    if (!lop && /^LỚP\s/i.test(l)) { lop = l.trim(); return false; }
    return true;
  });
  while (lines.length && !lines[0].trim()) lines.shift();
  const qw = 380, qh = Math.round(qw * ((q.naturalHeight || 640) / (q.naturalWidth || 540)));
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  function body(draw) {
    let y = BAND + 64;
    lines.forEach(raw => {
      let l = raw.trim();
      if (!l) { y += 20; return; }
      if (/^Học viên:/i.test(l)) {
        ctx.font = 'bold 36px Arial'; ctx.fillStyle = MAU;
        wrap(ctx, l, W - 2 * P).forEach(s => { if (draw) ctx.fillText(s, P, y); y += 50; });
        y += 8; return;
      }
      if (/^Tổng số tiền/i.test(l)) {
        ctx.font = 'bold 34px Arial';
        const ws = wrap(ctx, l, W - 2 * P - 60), bh = ws.length * 48 + 40;
        y += 6;
        if (draw) {
          ctx.fillStyle = '#fef4e5'; roundRect(ctx, P, y - 38, W - 2 * P, bh, 16); ctx.fill();
          ctx.fillStyle = '#f29900'; ctx.fillRect(P, y - 38, 8, bh);
          ctx.fillStyle = '#b05a00';
          ws.forEach((s, k) => ctx.fillText(s, P + 32, y + 10 + k * 48));
        }
        y += bh + 18; return;
      }
      const bullet = /^- /.test(l), x = bullet ? P + 34 : P;
      if (bullet) l = l.slice(2);
      const cam = /^Trân trọng/i.test(l);
      ctx.font = cam ? 'italic 30px Arial' : '30px Arial';
      wrap(ctx, l, W - x - P).forEach((s, k) => {
        if (draw) {
          if (bullet && k === 0) { ctx.fillStyle = MAU; ctx.fillText('•', P + 6, y); }
          ctx.fillStyle = cam ? '#5f6368' : '#3c4043';
          ctx.fillText(s, x, y);
        }
        y += LH;
      });
    });
    return y;
  }
  const bodyEnd = body(false), H = bodyEnd + 40 + qh + 110;
  c.width = W; c.height = H;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = MAU; ctx.fillRect(0, 0, W, BAND);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.font = 'bold 50px Arial'; ctx.fillText('THÔNG BÁO HỌC PHÍ', W / 2, 88);
  ctx.font = '30px Arial'; ctx.fillText(lop || (cur && cur.lop) || '', W / 2, 136);
  ctx.textAlign = 'left';
  body(true);
  let y = bodyEnd + 10;
  ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();
  y += 30;
  ctx.drawImage(q, (W - qw) / 2, y, qw, qh);
  ctx.textAlign = 'center'; ctx.fillStyle = '#5f6368'; ctx.font = '26px Arial';
  ctx.fillText('Quét mã để chuyển khoản – đã có sẵn số tiền và nội dung', W / 2, y + qh + 50);
  return c;
}
function thiep(it) {
  const k = it.key + '|' + it.qr + '|' + it.msg.length;
  if (!cards[k]) cards[k] = loadQr(it.qr).then(loadImg).then(q => toPng(veThiep(it, q)));
  return cards[k];
}

/* ---------- Rendering ---------- */
function el(tag, props, kids) {
  const e = document.createElement(tag);
  Object.keys(props || {}).forEach(k => {
    if (k === 'class') e.className = props[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
    else if (k in e && !k.startsWith('aria')) e[k] = props[k];
    else e.setAttribute(k, props[k]);
  });
  (kids || []).forEach(x => { if (x !== null && x !== undefined && x !== '') e.append(x); });
  return e;
}
function notice(s, err) { noticeText = s; noticeErr = !!err; renderNotices(); }
function renderNotices() {
  const box = $('notices'); box.replaceChildren();
  if (noticeText) box.append(el('div', { class: noticeErr ? 'notice err' : 'notice', role: 'status', textContent: noticeText }));
  if (pending.length) {
    const stuck = pending.filter(p => p.error);
    box.append(el('div', { class: stuck.length ? 'notice err' : 'notice warn', role: 'status',
      textContent: (flushing ? 'Đang lưu ' : 'Chờ lưu ') + pending.length + ' lần tick. Đừng đóng trang.' + (stuck.length ? ' Lỗi: ' + stuck[0].error : '') }));
  }
}
function showLogin(again) { $('login').hidden = false; $('app').hidden = true; $('loginMsg').textContent = again ? 'Phiên đăng nhập đã hết, bấm để đăng nhập lại.' : ''; }
function st(s, err) { const n = $('st'); if (n) { n.textContent = s; n.style.color = err ? 'var(--bad)' : 'var(--ok)'; } }
function render() {
  const box = $('view'); box.replaceChildren();
  $('reload').setAttribute('aria-label', view === 'home' ? 'Tải lại tất cả các lớp' : 'Tải lại số mới của lớp');
  if (view === 'home') renderHome(box); else if (view === 'moves') renderMoves(box); else renderClass(box);
  const n = moves ? moves.list.filter(m => !m.wait).length + moves.due.length : 0;
  $('btnMoves').textContent = n ? 'Biến động (' + n + ')' : 'Biến động';
  renderNotices();
}

/* ---------- Student movements: new, transfer, leaving ---------- */
let moves = null, movesLoading = false, books = [];
const KIND = { moi: 'Học sinh mới', chuyen: 'Chuyển lớp', nghi: 'Nghỉ học' };
const dayText = ms => { const d = new Date(ms), p = n => ('0' + n).slice(-2); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); };
const isoOf = ms => { const d = new Date(ms), p = n => ('0' + n).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
async function loadMoves() {
  if (movesLoading) return;
  movesLoading = true; if (view === 'moves') render();
  try {
    // The log tab appears at the first roster change, so a missing tab just means no events yet.
    const events = await batchGet(["'_BIEN_DONG_HS'!A2:I3000"]).then(x => x[0]).catch(e => { if (/Unable to parse range/.test(e.message)) return []; throw e; });
    const [news, exits, bookRows] = await batchGet([L.quote(L.NEW_TAB) + '!A3:U199', L.quote(L.EXIT_TAB) + '!A4:X400', "'DANH_MUC_SACH'!A4:A80"]);
    books = bookRows.map(r => r[0]).filter(x => x && !/^Không thu/.test(x));
    moves = {
      list: L.classifyMoves(events, news.map(r => [r[1], r[2], r[3]]), exits.map(r => [r[1], r[2], r[5], r[6], r[23]]), Date.now()),
      due: L.intakeDue(news, exits), at: Date.now()
    };
    notice('');
  } catch (e) { notice('Chưa đọc được biến động học sinh: ' + e.message, true); }
  movesLoading = false; render();
}
function renderMoves(box) {
  box.append(el('div', { class: 'page-title' }, [
    el('div', {}, [el('h1', { textContent: 'Biến động học sinh' }),
      el('div', { class: 'sub', textContent: movesLoading ? 'Đang đọc…' : moves ? 'Số mới lúc ' + new Date(moves.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '' })]),
    el('button', { textContent: 'Tải lại', disabled: movesLoading, onclick: loadMoves })]));
  if (!moves) { box.append(el('div', { class: 'empty', textContent: 'Đang đọc…' })); return; }
  const ready = moves.list.filter(m => !m.wait), waiting = moves.list.filter(m => m.wait);
  box.append(el('h2', { class: 'section', textContent: 'Cần duyệt (' + ready.length + ')' }));
  box.append(ready.length ? el('div', { class: 'fee-list' }, ready.map(moveRow)) : el('div', { class: 'empty small', textContent: 'Không có thay đổi nào cần duyệt.' }));
  if (waiting.length) {
    box.append(el('h2', { class: 'section', textContent: 'Đang đợi 24 giờ (' + waiting.length + ')' }),
      el('p', { class: 'sub', style: 'margin-bottom:8px', textContent: 'Đã mất khỏi danh sách lớp. Nếu trong 24 giờ các em xuất hiện ở lớp khác, app sẽ tính là chuyển lớp.' }),
      el('div', { class: 'fee-list' }, waiting.map(moveRow)));
  }
  box.append(el('h2', { class: 'section', textContent: 'Cần thu (' + moves.due.length + ')' }));
  box.append(moves.due.length ? el('div', { class: 'fee-list' }, moves.due.map(dueRow)) : el('div', { class: 'empty small', textContent: 'Không có khoản nào đang chờ thu.' }));
}
function moveRow(m) {
  const route = m.kind === 'chuyen' ? m.from + ' → ' + m.to : m.kind === 'moi' ? 'Vào ' + m.to : 'Rời ' + m.from;
  const notes = [];
  if (m.unsure) notes.push('Tên tiếng Anh ở hai lớp khác nhau (' + (m.eng || 'trống') + ' / ' + (m.engTo || 'trống') + '). Kiểm tra có đúng một em không.');
  if (m.targets) notes.push('Có em cùng tên mới vào ' + m.targets.join(', ') + '. Nếu là chuyển lớp, bạn nhập tay trong Sheet.');
  return el('div', { class: 'row card' }, [
    el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: fullName(m) }), el('span', { class: 'chip idle', textContent: KIND[m.kind] })]),
    el('div', { class: 'sub', style: 'margin-top:4px', textContent: route + ' · ghi nhận ' + dayText(m.at) }),
    notes.length ? el('div', { class: 'warn-line' }, [notes.join(' ')]) : '',
    m.wait ? el('div', { class: 'sub', style: 'margin-top:4px', textContent: 'Còn khoảng ' + Math.ceil(m.waitMs / 3600000) + ' giờ nữa.' })
      : el('div', { class: 'r2' }, [el('div', { class: 'fill' }), el('button', { class: 'quiet', textContent: 'Bỏ qua', onclick: () => boQuaMove(m) }), el('button', { class: 'primary', textContent: 'Duyệt', onclick: () => moDuyet(m) })])]);
}
function dueRow(it) {
  const d = el('input', { type: 'date', value: localDate(), max: localDate(), 'aria-label': 'Ngày nộp của ' + it.name });
  return el('div', { class: 'row card' }, [
    el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: fullName(it) }), el('span', { class: 'amt', textContent: it.problem ? 'Cần kiểm tra' : money(it.amount) })]),
    el('div', { class: 'sub', style: 'margin-top:4px', textContent: KIND[it.kind] + ' · ' + it.cls }),
    it.problem ? el('div', { class: 'warn-line' }, ['Sheet chưa tính được số tiền (tab ' + it.tab + ', dòng ' + it.row + '): ' + (it.reason || 'bạn mở Sheet kiểm tra.')])
      : el('div', { class: 'r2' }, [el('button', { textContent: 'Xem thiệp', disabled: !it.qr, onclick: () => moThiep(it) }), el('div', { class: 'fill' }), d, el('button', { class: 'tick', textContent: 'Đã nộp', onclick: () => tickDue(it, d.value) })])]);
}
function moThiep(it) {
  const img = $('thiepAnh'); img.removeAttribute('src');
  $('thiepTen').textContent = fullName(it); $('thiepSt').textContent = '';
  $('thiepDlg').dataset.key = it.key; $('thiepDlg').showModal();
  thiep(it).then(b => { img.src = URL.createObjectURL(b); }).catch(e => { $('thiepSt').textContent = 'Không tạo được thiệp: ' + e.message; });
}
async function copyThiep() {
  const it = moves && moves.due.find(x => x.key === $('thiepDlg').dataset.key); if (!it) return;
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': thiep(it) })]); $('thiepSt').textContent = 'Đã copy thiệp, sang Zalo dán rồi gửi.'; }
  catch (e) { $('thiepSt').textContent = 'Không copy được: nhấn giữ hoặc chuột phải vào ảnh để sao chép.'; }
}
async function tickDue(it, iso) {
  if (!iso) return notice('Hãy chọn ngày nộp.', true);
  const [y, m, d] = iso.split('-'), tab = L.quote(it.tab), nameCol = it.tab === L.NEW_TAB ? 'C' : 'B';
  notice('Đang lưu ' + it.name + '…');
  try {
    const [[names], [status]] = await Promise.all([batchGet([tab + '!' + nameCol + it.row]), batchGet([tab + '!' + it.statusCol + it.row], 'FORMULA')]);
    if (L.clean((names[0] || [])[0]) !== L.clean(it.name)) throw new Error('Dòng ' + it.row + ' đã đổi học sinh, hãy tải lại.');
    const data = [{ range: tab + '!' + it.dateCol + it.row, values: [[d + '/' + m + '/' + y]] }];
    if (!/^=/.test(String((status[0] || [])[0] || ''))) data.push({ range: tab + '!' + it.statusCol + it.row, values: [['Đã nộp']] });
    await batchWrite(data);
    await loadMoves();
    notice('Đã lưu ' + it.name + '.');
  } catch (e) { notice('Không lưu được: ' + e.message, true); }
}
function moDuyet(m) {
  const cls = m.kind === 'nghi' ? m.from : m.to;
  $('dvTen').textContent = KIND[m.kind] + ': ' + fullName(m);
  $('dvRoute').textContent = m.kind === 'chuyen' ? m.from + ' → ' + m.to : cls;
  $('dvDateLabel').textContent = m.kind === 'moi' ? 'Ngày vào lớp' : m.kind === 'chuyen' ? 'Ngày chuyển' : 'Ngày nghỉ';
  $('dvDate').value = isoOf(m.at); $('dvDate').max = '';
  $('dvAcc').textContent = m.kind === 'nghi' ? 'Thu vào tài khoản: ' + L.EXIT_ACCOUNT : '';
  $('dvErr').textContent = '';
  $('dvLuu').hidden = false; $('dvKhongThu').hidden = true; $('dvLuu').textContent = 'Thêm vào danh sách thu';
  $('dvStatus').textContent = ''; dvHist = null;
  if (m.kind === 'nghi') {
    $('dvStatus').textContent = 'Đang xem em đã đóng đợt đó chưa…';
    batchGet([L.quote(m.from) + '!J18:N36']).then(([h]) => { if ($('duyet').dataset.id === m.id) { dvHist = h; capNhatNghi(m); } })
      .catch(() => { dvHist = []; capNhatNghi(m); });
  }
  $('dvDate').onchange = () => { if (m.kind === 'nghi' && dvHist) capNhatNghi(m); };
  const options = [el('option', { value: '', textContent: '(Không chọn)' })].concat(books.map(b => el('option', { value: b, textContent: b })));
  const wrap = $('dvBooks'); wrap.replaceChildren();
  for (let k = 0; k < 5; k++) wrap.append(el('select', { 'aria-label': 'Sách ' + (k + 1) }, options.map(o => o.cloneNode(true))));
  $('duyet').dataset.id = m.id; $('duyet').showModal();
}
let dvHist = null;
const isoToText = iso => { const [y, m, d] = String(iso).split('-'); return iso ? d + '/' + m + '/' + y : ''; };
/** Shows what the leaving date means for this student, and which action comes first. */
function capNhatNghi(m) {
  const r = L.leaveStatus(dvHist, m.blocks, isoToText($('dvDate').value)), dot = r.dot ? 'Đợt ' + r.dot : 'đợt này';
  const lich = r.noSchedule ? ' Lịch đợt này chưa có trong lớp nên Sheet sẽ báo cần kiểm tra, chưa ra số tiền.' : '';
  $('dvKhongThu').hidden = false; $('dvLuu').hidden = false; $('dvLuu').className = ''; $('dvKhongThu').className = '';
  if (r.state === 'da-dong') {
    $('dvStatus').textContent = 'Ngày này thuộc ' + dot + ', em đã đóng. Không thu gì thêm.';
    $('dvKhongThu').className = 'primary'; $('dvLuu').textContent = 'Vẫn tính tiền';
  } else if (r.state === 'chua-dong') {
    $('dvStatus').textContent = 'Ngày này thuộc ' + dot + ', em chưa đóng. Thu theo số buổi đã học.' + lich;
    $('dvLuu').className = 'primary'; $('dvLuu').textContent = 'Thêm vào danh sách thu';
  } else {
    $('dvStatus').textContent = 'Chưa rõ em đã đóng ' + dot + ' chưa (không có dữ liệu). Bạn kiểm tra rồi chọn.' + lich;
    $('dvLuu').textContent = 'Chưa đóng, tính tiền';
  }
}
async function khongThuMove() {
  const m = moves.list.find(x => x.id === $('duyet').dataset.id); if (!m) return;
  $('dvErr').textContent = 'Đang lưu…';
  try {
    await batchWrite(m.rows.map(r => ({ range: "'_BIEN_DONG_HS'!H" + r, values: [['khong-thu']] })));
    $('duyet').close(); notice('Đã ghi nhận ' + m.name + ' nghỉ, không thu thêm.'); await loadMoves();
  } catch (e) { $('dvErr').textContent = 'Không lưu được: ' + e.message; }
}
async function luuDuyet() {
  const m = moves.list.find(x => x.id === $('duyet').dataset.id); if (!m) return;
  const iso = $('dvDate').value;
  if (!iso) { $('dvErr').textContent = 'Hãy chọn ngày.'; return; }
  const [y, mo, d] = iso.split('-'), bookList = [...$('dvBooks').querySelectorAll('select')].map(s => s.value).filter(Boolean);
  const input = L.moveInputs(m, { date: d + '/' + mo + '/' + y, books: bookList });
  $('dvErr').textContent = 'Đang lưu…'; $('dvLuu').disabled = true;
  try {
    await ghiDongMoi(input);
    $('duyet').close();
    notice('Đã thêm ' + m.name + ' vào tab ' + input.tab + '. Số tiền sẽ hiện ở mục Cần thu sau khi Sheet tính xong.');
    await loadMoves();
  } catch (e) { $('dvErr').textContent = 'Không lưu được: ' + e.message; }
  $('dvLuu').disabled = false;
}
/** Adds a row below the last used one and copies the formula columns from the row above, the way a person fills the tab down. */
async function ghiDongMoi(input) {
  const tab = L.quote(input.tab), meta = await api('?fields=sheets.properties(sheetId%2Ctitle)');
  const sheetId = (meta.sheets.find(s => s.properties.title === input.tab) || { properties: {} }).properties.sheetId;
  if (sheetId === undefined) throw new Error('Không thấy tab ' + input.tab);
  const nameRange = input.nameCol + input.firstDataRow + ':' + input.nameCol + '1000';
  const [names] = await batchGet([tab + '!' + nameRange]);
  let lastIdx = -1; names.forEach((r, k) => { if (r[0]) lastIdx = k; });
  if (lastIdx < 0) throw new Error('Tab ' + input.tab + ' chưa có dòng mẫu.');
  const source = input.firstDataRow + lastIdx, target = source + 1;
  const [rowFormulas] = await batchGet([tab + '!A' + source + ':X' + source], 'FORMULA');
  const requests = [];
  (rowFormulas[0] || []).forEach((v, c) => {
    if (!/^=/.test(String(v)) || input.cells[L.colA1(c + 1)] !== undefined) return;
    requests.push({ copyPaste: { source: { sheetId, startRowIndex: source - 1, endRowIndex: source, startColumnIndex: c, endColumnIndex: c + 1 },
      destination: { sheetId, startRowIndex: target - 1, endRowIndex: target, startColumnIndex: c, endColumnIndex: c + 1 }, pasteType: 'PASTE_FORMULA' } });
  });
  if (requests.length) await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) }, 2);
  await batchWrite(Object.keys(input.cells).filter(c => input.cells[c] !== '').map(c => ({ range: tab + '!' + c + target, values: [[input.cells[c]]] })));
}
async function boQuaMove(m) {
  if (!confirm('Bỏ qua ' + fullName(m) + '? App sẽ không nhắc lại thay đổi này.')) return;
  try { await batchWrite(m.rows.map(r => ({ range: "'_BIEN_DONG_HS'!H" + r, values: [['bo-qua']] }))); await loadMoves(); }
  catch (e) { notice('Không lưu được: ' + e.message, true); }
}
function stat(value, label, alert) { return el('div', { class: alert ? 'stat card alert' : 'stat card' }, [el('b', { textContent: value }), el('span', { textContent: label })]); }

function renderHome(box) {
  const rows = classes.map(name => { const c = store.get('hp_cls_' + name); return { name, data: c && c.data }; });
  const known = rows.filter(r => r.data).map(r => ({ name: r.name, data: r.data, s: summarize(r.data) }));
  const owe = known.reduce((a, r) => a + r.s.owe, 0), left = known.reduce((a, r) => a + r.s.total - r.s.paid, 0), flagged = known.reduce((a, r) => a + r.s.warn, 0);
  const at = store.get('hp_all_at');
  box.append(
    el('div', { class: 'page-title' }, [
      el('div', {}, [el('h1', { textContent: 'Tổng quan các lớp' }),
        el('div', { class: 'sub', textContent: loadingAll ? 'Đang đọc ' + loadedCount + ' / ' + classes.length + ' lớp…' : at ? 'Cập nhật lúc ' + new Date(at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : 'Chưa đọc đủ các lớp' })]),
      el('button', { textContent: loadingAll ? 'Đang cập nhật…' : 'Cập nhật tất cả', disabled: loadingAll, onclick: loadAll })]),
    el('div', { class: 'stats' }, [stat(L.fmt(owe) + ' đ', 'Còn phải thu đợt này'), stat(String(left), 'Học sinh chưa nộp'), stat(String(flagged), 'Số tiền cần xem lại', flagged > 0)]));
  const q = el('input', { class: 'search', type: 'search', value: query, placeholder: 'Tìm lớp, ví dụ KIDS 31', 'aria-label': 'Tìm lớp',
    oninput: e => { query = e.target.value; const g = $('grid'); if (g) fillGrid(g, rows); } });
  const grid = el('div', { class: 'classes', id: 'grid' });
  box.append(q, grid);
  fillGrid(grid, rows);
}
function fillGrid(grid, rows) {
  const t = query.trim().toLowerCase();
  grid.replaceChildren(...rows.filter(r => !t || r.name.toLowerCase().includes(t)).map(r => {
    const s = r.data ? summarize(r.data) : null;
    const kids = [el('div', { class: 'top' }, [el('b', { textContent: r.name }), el('small', { textContent: r.data ? 'Đợt ' + r.data.dot : 'Chưa đọc' })])];
    if (s) {
      kids.push(el('div', { class: 'track', role: 'img', 'aria-label': 'Đã nộp ' + s.paid + ' trên ' + s.total }, [el('i', { style: 'width:' + (s.total ? Math.round(s.paid / s.total * 100) : 0) + '%' })]));
      const low = [el('span', {}, ['Đã nộp ', el('strong', { textContent: s.paid + '/' + s.total })]), el('span', {}, ['Còn ', el('strong', { textContent: money(s.owe) || '0 đ' })])];
      if (s.warn) low.push(el('span', { class: 'flag', textContent: s.warn + ' em cần xem lại số tiền' }));
      kids.push(el('div', { class: 'low' }, low));
    }
    return el('button', { class: 'class', onclick: () => openClass(r.name) }, kids);
  }));
}
function renderClass(box) {
  if (!cur) { box.append(el('div', { class: 'empty', textContent: 'Đang tải lớp…' })); return; }
  const s = summarize(cur);
  const meta = ['Đợt ' + cur.dot, cur.dueDate ? 'hạn thu ' + cur.dueDate : '', cur.dueState].filter(Boolean).join(' · ');
  const when = curFresh ? 'Số mới lúc ' + new Date(curAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : 'Số lúc ' + new Date(curAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) + ', chưa đối chiếu xong. Đợi xong rồi mới gửi thiệp.';
  box.append(
    el('div', { class: 'class-head card' }, [
      el('div', { class: 'page-title', style: 'margin:0' }, [el('h1', { textContent: cur.tab }), el('span', { class: 'sub', textContent: meta })]),
      el('div', { class: 'track', role: 'img', 'aria-label': 'Đã nộp ' + s.paid + ' trên ' + s.total }, [el('i', { style: 'width:' + (s.total ? Math.round(s.paid / s.total * 100) : 0) + '%' })]),
      el('div', { class: 'nums' }, [el('span', {}, ['Đã nộp ', el('strong', { textContent: s.paid + '/' + s.total })]), el('span', {}, ['Đã thu ', el('strong', { textContent: money(s.got) || '0 đ' })]), el('span', {}, ['Còn phải thu ', el('strong', { textContent: money(s.owe) || '0 đ' })])]),
      el('div', { class: curFresh ? 'sub' : 'hint', style: 'margin-top:6px', textContent: when })]),
    el('div', { class: 'seg' }, [
      el('button', { textContent: 'Thu tiền', 'aria-pressed': String(tab === 'thu'), onclick: () => { tab = 'thu'; render(); } }),
      el('button', { textContent: 'Gửi Zalo', 'aria-pressed': String(tab === 'zalo'), onclick: () => { tab = 'zalo'; render(); } })]));
  if (tab === 'zalo') renderZalo(box); else renderThu(box);
}

function renderThu(box) {
  const groups = { can: cur.items.filter(x => !x.paid), da: cur.items.filter(x => x.paid), xem: cur.items.filter(x => !x.paid && (x.warn || x.trong)) };
  const chip = (id, label) => el('button', { textContent: label + ' ' + groups[id].length, 'aria-pressed': String(filter === id), onclick: () => { filter = id; render(); } });
  box.append(el('div', { class: 'filters' }, [chip('can', 'Chưa nộp'), chip('xem', 'Cần xem lại'), chip('da', 'Đã nộp')]));
  const list = groups[filter];
  if (!list.length) { box.append(el('div', { class: 'empty', textContent: filter === 'can' ? 'Lớp này đã nộp đủ đợt ' + cur.dot + '.' : filter === 'da' ? 'Chưa có em nào nộp đợt ' + cur.dot + '.' : 'Không có em nào cần xem lại.' })); return; }
  box.append(el('div', { class: 'fee-list' }, list.map(feeRow)));
}
function feeRow(it) {
  const d = el('input', { type: 'date', value: localDate(), max: localDate(), 'aria-label': 'Ngày nộp của ' + it.name });
  const r2 = it.paid
    ? [el('span', { class: 'chip ok', textContent: 'Đã nộp ' + it.date + (it.dangLuu ? ' · đang lưu' : '') }), el('div', { class: 'fill' }), el('button', { class: 'quiet', textContent: 'Bỏ tick', onclick: () => boTick(it) })]
    : [el('span', { class: /chưa thu ngay/i.test(it.status) ? 'chip idle' : 'chip', textContent: it.status || 'Chưa nộp' }), el('div', { class: 'fill' }), d, el('button', { class: 'tick', textContent: 'Đã nộp', onclick: () => tick(it, d.value) })];
  return el('div', { class: 'row card' }, [
    el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: fullName(it) }), el('span', { class: 'amt', textContent: money(it.amount) || 'Chưa có số' })]),
    el('div', { class: 'r2' }, r2),
    it.warn ? el('div', { class: 'warn-line' }, [it.warn, el('button', { class: 'quiet', textContent: 'Xem và sửa', onclick: () => moSua(it) })]) : '',
    !it.warn && it.trong ? el('div', { class: 'warn-line' }, ['Chưa có tin hoặc số tiền đợt này.', el('button', { class: 'quiet', textContent: 'Nhập', onclick: () => moSua(it) })]) : '']);
}
function localDate() { const d = new Date(), p = n => ('0' + n).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function tick(it, iso) {
  if (!iso) return notice('Hãy chọn ngày nộp.', true);
  if (!it.amount && !confirm(fullName(it) + ' chưa có số tiền đợt này. Vẫn tick đã nộp?')) return;
  const [y, m, d] = iso.split('-');
  queue({ kind: 'paid', tab: cur.tab, dot: cur.dot, date: d + '/' + m + '/' + y, item: { key: it.key, row: it.row, name: it.name, eng: it.eng, amount: it.amount } });
}
function boTick(it) {
  if (!confirm('Bỏ tick đã nộp của ' + fullName(it) + '? Ngày nộp sẽ bị xoá.')) return;
  queue({ kind: 'unpaid', tab: cur.tab, dot: cur.dot, item: { key: it.key, row: it.row, name: it.name, eng: it.eng, amount: it.amount } });
}

function renderZalo(box) {
  const items = zaloItems();
  if (!items.length) { box.append(el('div', { class: 'empty', textContent: 'Lớp này đã nộp đủ đợt ' + cur.dot + ', không cần nhắc nữa.' })); return; }
  i = Math.min(i, items.length - 1);
  const it = items[i], sent = sentSet();
  const pick = k => { i = k; step = 0; render(); };
  const people = el('div', { class: 'people card', role: 'list' }, items.map((x, k) => el('button', { 'data-key': x.key, 'aria-current': String(k === i), onclick: () => pick(k) }, [
    el('span', { class: 'n', textContent: (k + 1) + '. ' + fullName(x) }),
    x.trong ? el('span', { class: 'm none', textContent: 'chưa có tin' }) : x.warn ? el('span', { class: 'm warn', textContent: 'xem lại' }) : sent.has(x.key) ? el('span', { class: 'm done', textContent: 'đã copy' }) : ''])));
  const sel = el('select', { id: 'chon', 'aria-label': 'Chọn học sinh', onchange: e => pick(+e.target.value) },
    items.map((x, k) => el('option', { value: String(k), textContent: (k + 1) + '. ' + fullName(x) + (x.trong ? ' – chưa có tin' : x.warn ? ' – xem lại' : sent.has(x.key) ? ' – đã copy' : '') })));
  sel.value = String(i);
  const img = el('img', { id: 'card', alt: 'Thiệp học phí của ' + it.name });
  const done = items.filter(x => sent.has(x.key)).length;
  box.append(el('div', { class: 'zalo' }, [people, el('div', { class: 'stage' }, [
    sel,
    el('div', { class: 'who' }, [el('b', { textContent: fullName(it) }), it.rieng ? el('span', { class: 'tag', textContent: 'đã sửa riêng' }) : '', el('button', { class: 'quiet', textContent: 'Sửa riêng', onclick: () => moSua(it) })]),
    it.warn ? el('div', { class: 'warn-line', style: 'margin:0 0 8px' }, [it.warn]) : '',
    el('button', { class: 'one primary', id: 'one', textContent: oneLabel(it), onclick: oneClick }),
    it.qr ? el('div', { class: 'pv' }, [img]) : '',
    el('div', { class: 'nav', style: 'margin-top:8px' }, [
      el('button', { textContent: '← Em trước', disabled: i === 0, onclick: () => go(-1) }),
      el('button', { textContent: 'Copy lại', disabled: !it.qr, onclick: copyCard }),
      el('button', { textContent: 'Em sau →', disabled: i === items.length - 1, onclick: () => go(1) })]),
    el('div', { id: 'st', class: 'st', role: 'status' }),
    el('div', { class: 'count', textContent: 'Em ' + (i + 1) + ' / ' + items.length + ' · đã copy ' + done + ' thiệp trên máy này' })])]));
  if (it.trong) return st('Em này chưa có tin hoặc số tiền đợt này, bấm nút để tự nhập.', true);
  if (!it.qr) return st('Em này chưa có link QR.', true);
  thiep(it).then(b => { if (zaloItems()[i] === it) img.src = URL.createObjectURL(b); }).catch(e => st('Không tạo được thiệp: ' + e.message, true));
  const j = nextIdx(); if (j >= 0 && items[j].qr) thiep(items[j]).catch(() => {});
}
function oneLabel(it) { return it.trong ? 'Nhập tin và số tiền cho em này' : step === 0 ? 'Copy thiệp' : (nextIdx() < 0 ? 'Đã hết danh sách' : 'Sang em tiếp và copy thiệp'); }
function nextIdx() { const z = zaloItems(); for (let j = i + 1; j < z.length; j++) if (!z[j].trong) return j; return -1; }
function go(d) { const z = zaloItems(); i = Math.min(z.length - 1, Math.max(0, i + d)); step = 0; render(); }
function markSent(it) {
  const s = sentSet(); s.add(it.key); store.set(sentKey(), [...s]);
  document.querySelectorAll('.people button').forEach(b => { if (b.dataset.key === it.key && !b.querySelector('.m')) b.append(el('span', { class: 'm done', textContent: 'đã copy' })); });
}
async function copyCard() {
  const it = zaloItems()[i]; if (!it || !it.qr) return st('Em này chưa có link QR.', true);
  const blob = thiep(it);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    step = 1; const b = $('one'); if (b) b.textContent = oneLabel(it);
    markSent(it); st('Đã copy thiệp, sang Zalo dán rồi gửi.');
  } catch (e) {
    try {
      const f = new File([await blob], fullName(it) + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); step = 1; markSent(it); return st('Đã mở chia sẻ thiệp.'); }
    } catch (e2) { /* falls through to the hint */ }
    st('Không copy được: nhấn giữ hoặc chuột phải vào ảnh để sao chép.', true);
  }
}
function oneClick() {
  const it = zaloItems()[i];
  if (it.trong) return moSua(it);
  if (step === 0) return copyCard();
  const j = nextIdx();
  if (j < 0) return st('Đã gửi hết danh sách lớp này.');
  i = j; step = 0; render(); copyCard();
}

/* ---------- Per-student message and amount ---------- */
function moSua(it) {
  const dlg = $('sua');
  $('suaTen').textContent = fullName(it);
  $('edMsg').value = it.manual || it.msg || it.nhap || '';
  $('edAmt').value = it.soTien || '';
  $('edErr').textContent = '';
  $('edHint').textContent = it.tienAuto && it.tienSheet && it.tienAuto !== it.tienSheet ? 'Số tự tính trong tin: ' + money(it.tienAuto) + '. Số trong bảng: ' + money(it.tienSheet) + '.' : '';
  dlg.dataset.key = it.key;
  dlg.showModal();
}
async function ghiRieng(msg, amt) {
  const it = cur.items.find(x => x.key === $('sua').dataset.key); if (!it) return;
  if (msg.trim() === String(it.auto || '').trim()) msg = '';
  $('edErr').textContent = 'Đang lưu…';
  try {
    const name = cur.tab, dot = cur.dot, want = L.freshRanges(name, [it.row]);
    const [values, cells, kho] = await Promise.all([batchGet(want.values), batchGet(want.cells, 'FORMULA'), readKho()]);
    const plan = L.planOverride(name, it, L.freshAt(values, cells, 0), dot, msg, amt, kho), data = plan.updates.slice();
    if (plan.store && plan.store.row > 0) data.push({ range: "'_TRO_LY_ZALO'!A" + plan.store.row + ':B' + plan.store.row, values: [[plan.store.key, plan.store.value]] });
    if (plan.store && plan.store.row < 0) data.push({ range: "'_TRO_LY_ZALO'!A" + (kho.length + 1) + ':B' + (kho.length + 1), values: [[plan.store.key, plan.store.value]] });
    if (data.length) await batchWrite(data);
    $('sua').close();
    await openClass(name);
    st('Đã lưu, thiệp đã cập nhật.');
  } catch (e) { $('edErr').textContent = 'Không lưu được: ' + e.message; }
}

/* ---------- Start ---------- */
async function afterLogin() {
  $('login').hidden = true; $('app').hidden = false;
  const cached = store.get('hp_classes'); if (cached) fillClasses(cached);
  view = 'home'; render();
  try {
    const [rows] = await batchGet(["'DANH_SACH_LOP'!A2:E45"]);
    // Rows with no tracker link (T1, TV2) have no class tab yet.
    const list = rows.filter(r => r[0] && r[4]).map(r => r[0]).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
    store.set('hp_classes', list); fillClasses(list);
    if (view === 'home') { render(); if (!store.get('hp_all_at') || Date.now() - store.get('hp_all_at') > 1800000) loadAll(); }
  } catch (e) { notice('Chưa đọc được danh sách lớp: ' + e.message, true); }
  if (pending.length) flush();
  loadMoves();
}
function fillClasses(list) {
  classes = list; const s = $('lop'), v = s.value;
  s.replaceChildren(el('option', { value: '', textContent: 'Chọn lớp…' }), ...list.map(n => el('option', { value: n, textContent: n })));
  s.value = v;
}
window.addEventListener('load', () => {
  $('btnLogin').addEventListener('click', () => getToken(true).then(afterLogin).catch(e => { $('loginMsg').textContent = e.message; }));
  $('home').addEventListener('click', () => { view = 'home'; $('lop').value = ''; notice(''); render(); });
  $('lop').addEventListener('change', e => { if (e.target.value) { filter = 'can'; openClass(e.target.value); } });
  $('reload').addEventListener('click', () => { if (view === 'home') loadAll(); else if (view === 'moves') loadMoves(); else if (cur) openClass(cur.tab); });
  $('btnMoves').addEventListener('click', () => { view = 'moves'; $('lop').value = ''; notice(''); render(); loadMoves(); });
  $('dvLuu').addEventListener('click', luuDuyet);
  $('dvKhongThu').addEventListener('click', khongThuMove);
  $('dvHuy').addEventListener('click', () => $('duyet').close());
  $('thiepCopy').addEventListener('click', copyThiep);
  $('thiepDong').addEventListener('click', () => $('thiepDlg').close());
  $('btnOut').addEventListener('click', () => {
    if (pending.length && !confirm('Còn ' + pending.length + ' lần tick chưa lưu sẽ bị bỏ. Vẫn đăng xuất?')) return;
    if (token) google.accounts.oauth2.revoke(token, () => {});
    token = null; pending = [];
    try { sessionStorage.removeItem('hp_token'); } catch (e) { /* nothing to clear */ }
    Object.keys(localStorage).filter(k => k.startsWith('hp_')).forEach(k => store.del(k));
    showLogin(false);
  });
  $('edLuu').addEventListener('click', () => ghiRieng($('edMsg').value, $('edAmt').value));
  $('edBo').addEventListener('click', () => ghiRieng('', ''));
  $('edHuy').addEventListener('click', () => $('sua').close());
  const wait = setInterval(() => { if (window.google && google.accounts) {
    clearInterval(wait); initAuth(); $('btnLogin').disabled = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem('hp_token'));
      if (saved && Date.now() < saved.tokenUntil) { token = saved.token; tokenUntil = saved.tokenUntil; afterLogin(); }
    } catch (e) { /* the sign-in button is still there */ }
  } }, 100);
  window.addEventListener('beforeunload', e => { if (pending.length) e.preventDefault(); });
});
