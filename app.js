// Web app UI. All data comes from the Sheets API, through the personal-link gateway (or the Google sign-in kept as a spare); there is no server.
const CONFIG = window.HP_CONFIG;
const SHEET_API = 'https://sheets.googleapis.com/v4/spreadsheets/' + CONFIG.sheetId;
const SCHEDULE_API = 'https://sheets.googleapis.com/v4/spreadsheets/' + CONFIG.scheduleId;
const LOG_API = 'https://sheets.googleapis.com/v4/spreadsheets/' + CONFIG.logId;
const TUTOR_API = 'https://sheets.googleapis.com/v4/spreadsheets/' + CONFIG.tutorId;
const L = window.HpLogic;
const $ = id => document.getElementById(id);
// Saved data lives in IndexedDB: localStorage is shared with every other page on this github.io address, and those pages fill its 5 MB.
// Reads come from a copy in memory, loaded once by openStore, so the rest of the app can stay synchronous.
const saved = new Map();
let db = null;
const dbWrite = fn => { if (!db) return; try { fn(db.transaction('kv', 'readwrite').objectStore('kv')); } catch (e) { /* the app works without the cache */ } };
const store = {
  get(k) { try { return saved.has(k) ? JSON.parse(saved.get(k)) : null; } catch (e) { return null; } },
  set(k, v) { const s = JSON.stringify(v); saved.set(k, s); dbWrite(os => os.put(s, k)); },
  del(k) { saved.delete(k); dbWrite(os => os.delete(k)); },
  clear() { [...saved.keys()].forEach(k => store.del(k)); }
};
function openStore() {
  return new Promise(done => {
    try {
      const req = indexedDB.open('hocphi', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => done();
      req.onsuccess = () => {
        db = req.result;
        const os = db.transaction('kv').objectStore('kv'), all = os.getAll(), keys = os.getAllKeys();
        keys.onsuccess = () => { keys.result.forEach((k, n) => saved.set(k, all.result[n])); done(); };
        keys.onerror = () => done();
      };
    } catch (e) { done(); }
  }).then(() => {
    // Move what older versions left in localStorage, including ticks not yet sent.
    try {
      Object.keys(localStorage).filter(k => k.startsWith('hp_')).forEach(k => {
        if (!saved.has(k)) { saved.set(k, localStorage.getItem(k)); dbWrite(os => os.put(localStorage.getItem(k), k)); }
        if (db) localStorage.removeItem(k);
      });
    } catch (e) { /* nothing to move */ }
  });
}

/* ---------- Sign-in ---------- */
let linkKey = '', linkRole = '';
/** A call to the gateway. Its only trust is the key from the person's link; a key that was removed gets auth:false. */
async function cong(body) {
  const r = await fetch(CONFIG.congUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ k: linkKey }, body)) });
  if (!r.ok) throw new Error('Không nối được cổng (' + r.status + ').');
  const d = await r.json();
  if (d.auth === false) { linkGone(); throw new Error('Link này đã bị gỡ.'); }
  if (d.error) throw new Error(d.error);
  return d;
}
function linkGone() {
  linkKey = ''; linkRole = ''; store.clear();
  showLogin(false); $('loginMsg').textContent = 'Link này đã bị gỡ hoặc không đúng. Xin link mới từ cô Trang.';
}
let token = null, tokenUntil = 0, tokenClient = null, tokenWaiters = [], renewing = false, sessionLost = false;
const RENEW_BEFORE = 15 * 60000;
function initAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.clientId, scope: 'https://www.googleapis.com/auth/spreadsheets email',
    callback: r => {
      const w = tokenWaiters; tokenWaiters = []; renewing = false;
      if (r.error) return w.forEach(x => x.fail(new Error('Chưa đăng nhập được: ' + r.error)));
      token = r.access_token; tokenUntil = Date.now() + (Number(r.expires_in) - 60) * 1000;
      try { sessionStorage.setItem('hp_token', JSON.stringify({ token, tokenUntil })); } catch (e) { /* sign in again after a reload */ }
      w.forEach(x => x.ok(token));
      if (sessionLost) { sessionLost = false; notice(''); if (pending.length) flush(); flushSent(); }
    },
    error_callback: e => { const w = tokenWaiters; tokenWaiters = []; renewing = false; w.forEach(x => x.fail(new Error('Chưa đăng nhập được: ' + (e.type || 'lỗi')))); }
  });
}
function getToken(interactive) {
  if (token && Date.now() < tokenUntil) return Promise.resolve(token);
  if (!interactive) { showLogin(true); return Promise.reject(new Error('Cần đăng nhập lại.')); }
  return new Promise((ok, fail) => { tokenWaiters.push({ ok, fail }); askToken(); });
}
// The remembered address spares the account chooser when several Google accounts are signed in.
function askToken() { const hint = store.get('hp_email'); tokenClient.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: '' }); }
/**
 * Google's token lasts one hour and this page has no server to extend it. A click may open Google's popup, which closes
 * itself, so a person at work is renewed before the hour is up and never lands on the sign-in page.
 */
function renewOnClick(e) {
  const left = tokenUntil - Date.now(), on = e.target && e.target.closest ? e.target : document.body;
  if (linkKey || !tokenClient || renewing || $('app').hidden || left > RENEW_BEFORE || on.closest('#btnOut')) return;
  // Copying a card needs this page to keep focus, so that click leaves it to the next one unless time is already up.
  if (left > 0 && on.closest('#one, #thiepCopy, #thiepChu, .copy')) return;
  renewing = true; askToken();
}
async function api(path, options, attempts) {
  const t = linkKey ? '' : await getToken(false);
  const o = Object.assign({}, options, { headers: Object.assign({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, (options || {}).headers) });
  let last = null;
  for (let k = 0; k < (attempts || 3); k++) {
    if (k) await new Promise(r => setTimeout(r, 4000 * k));
    try {
      const url = path.startsWith('https:') ? path : SHEET_API + path;
      const r = linkKey ? await cong({ op: 'api', url, method: o.method || 'GET', body: o.body }).then(d => new Response(d.body, { status: d.status })) : await fetch(url, o);
      if (r.ok) return r.json();
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) { token = null; showLogin(true); throw new Error('Cần đăng nhập lại.'); }
      last = new Error((body.error && body.error.message) || ('Lỗi ' + r.status));
      if (r.status < 500 && r.status !== 429) throw last;
    } catch (e) { last = e; if (/đăng nhập|bị gỡ/.test(e.message)) throw e; }
  }
  throw last;
}
const batchGetAt = (base, ranges, render) => api(base + '/values:batchGet?valueRenderOption=' + (render || 'FORMATTED_VALUE') + '&' + ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&')).then(d => (d.valueRanges || []).map(x => x.values || []));
const batchGet = (ranges, render) => batchGetAt('', ranges, render);
const batchWrite = data => api('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) }, 2);

/* ---------- State ---------- */
let classes = [], cur = null, curAt = 0, curFresh = false, loadSeq = 0, i = 0, step = 0, cards = {}, qrCache = {};
let view = 'home', tab = 'thu', filter = 'can', query = '', loadingAll = false, loadedCount = 0, loadTotal = 0;
const picked = {}; // dates chosen but not yet ticked, so a quiet refresh cannot reset them to today
let noticeText = '', noticeErr = false;
let roiMap = {};
const daRoi = x => { const p = String(x.key || '').split('|'); return roiMap[p[1] + '|' + L.clean(x.name)] || null; };
const canThu = x => !x.paid && !L.deferred(x) && !L.free(x) && !daRoi(x);
const daThu = x => x.paid && !L.free(x);
const zaloItems = () => cur ? cur.items.filter(canThu) : [];
const fullName = x => x.name + (x.eng ? ' (' + x.eng + ')' : '');
const money = n => n ? L.fmt(n) + ' đ' : '';

// A blank status with no date means not paid or not recorded yet (owner, 04/11/2026), so it must not read as "Chưa nộp".
const chuaGhi = x => canThu(x) && !x.trong && !x.date && !String(x.status || '').trim();
function summarize(data) {
  const paid = data.items.filter(daThu), due = data.items.filter(canThu), blank = due.filter(chuaGhi);
  return { paid: paid.length, total: paid.length + due.length, got: paid.reduce((s, x) => s + (x.tienSheet || 0), 0),
    owe: due.reduce((s, x) => s + (x.amount || 0), 0), warn: due.filter(x => x.warn).length, none: due.filter(x => x.trong).length,
    blank: blank.length, blankOwe: blank.reduce((s, x) => s + (x.amount || 0), 0) };
}

/* ---------- Reading ---------- */
const FRESH_MS = 300000, GROUP = 6;
let khoMemo = null;
async function readKho(force) {
  if (!force && khoMemo && Date.now() - khoMemo.at < FRESH_MS) return khoMemo.rows;
  const [rows] = await batchGet(["'_TRO_LY_ZALO'!A:B"]);
  khoMemo = { rows, at: Date.now() };
  return rows;
}
function khoMap(rows) { const map = {}; rows.forEach(r => { if (r[0]) map[r[0]] = r[1]; }); return map; }
const buildFrom = (name, parts, rows) => L.buildClass(name, { top: parts[0], hist: parts[1], track: parts[2], msg: parts[3], lessons: parts[4], kho: khoMap(rows) });
const RANGES_PER_CLASS = L.classRanges('').length;
async function readClass(name) {
  const [parts, rows] = await Promise.all([batchGet(L.classRanges(name)), readKho()]);
  return buildFrom(name, parts, rows);
}
function warmCurrent() { if (cur && cur.items.length && (token || linkKey)) warmUp(cur.tab, cur.items.map(x => x.row)); }
function setCurrent(data, at, fresh) {
  const keepKey = cur && cur.tab === data.tab ? (zaloItems()[i] || {}).key : null;
  cur = data; curAt = at; curFresh = fresh; cards = {};
  applyPendingToView();
  const z = zaloItems();
  i = keepKey ? Math.max(0, z.findIndex(x => x.key === keepKey)) : 0;
  render();
}
// The saved copy shows at once, so a click never waits on the Sheet; a copy older than FRESH_MS is replaced quietly when the read returns.
const cuCu = c => c.data.items.length > 0 && !('disc' in c.data.items[0]);
/** Light on every screen unless someone picks dark on this device. */
function applyTheme(choice) {
  const dark = choice === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const b = $('btnTheme'); if (b) b.textContent = dark ? 'Nền sáng' : 'Nền tối';
}
async function openClass(name, force) {
  const seq = ++loadSeq;
  view = 'class'; step = 0;
  store.set('hp_last_class', name); $('lop').value = name;
  const cached = store.get('hp_cls_' + name), fresh = !!cached && !cached.dirty && !!cached.data.history && !cuCu(cached) && Date.now() - cached.at < FRESH_MS;
  if (cached) { i = 0; setCurrent(cached.data, cached.at, fresh); }
  else { cur = null; render(); notice('Đang đọc ' + name + ' lần đầu…'); }
  if (cached) warmCurrent();
  if (!fresh || force) { await refreshClass(name, seq); warmCurrent(); }
}
async function refreshClass(name, seq) {
  try {
    const data = await readClass(name), at = Date.now();
    store.set('hp_cls_' + name, { data, at });
    if (seq !== loadSeq) return;
    setCurrent(data, at, true);
    if (/^Đang đọc|^Chưa đọc được số mới/.test(noticeText)) notice('');
  } catch (e) {
    if (seq === loadSeq) { notice('Chưa đọc được số mới: ' + e.message + '. File có thể đang bận, bấm ↻ để thử lại.', true); render(); }
  }
}
/** Reads many classes in one request per group, so 35 classes take a few requests rather than 35. */
async function readGroup(names, kho) {
  try {
    const parts = await batchGet(names.reduce((a, n) => a.concat(L.classRanges(n)), []));
    names.forEach((name, k) => {
      try { store.set('hp_cls_' + name, { data: buildFrom(name, parts.slice(k * RANGES_PER_CLASS, (k + 1) * RANGES_PER_CLASS), kho), at: Date.now() }); }
      catch (e) { console.error(name, e.message); }
    });
  } catch (e) {
    if (/đăng nhập/.test(e.message)) throw e;
    // One bad tab fails the whole request, so read this group one class at a time.
    for (const name of names) {
      try { store.set('hp_cls_' + name, { data: await readClass(name), at: Date.now() }); }
      catch (e2) { if (/đăng nhập/.test(e2.message)) throw e2; console.error(name, e2.message); }
    }
  }
}
const homeBusy = () => document.activeElement && document.activeElement.classList.contains('search');
/** auto: only what is missing or old, classes due for collection first. */
async function loadAll(auto) {
  if (loadingAll) return;
  const rank = n => { const x = cal && cal.list.find(c => c.tab === n); return x && /den|qua/.test(x.group) ? 0 : x && x.group === 'sap' ? 1 : 2; };
  const old = n => { const c = store.get('hp_cls_' + n); return !c || c.dirty || !c.data.history || cuCu(c) || Date.now() - c.at > 1800000; };
  const names = (auto ? classes.filter(old) : classes.slice()).sort((a, b) => rank(a) - rank(b));
  if (!names.length) return;
  loadingAll = true; loadedCount = 0; loadTotal = names.length; if (!homeBusy()) render();
  try {
    const kho = await readKho();
    for (let k = 0; k < names.length; k += GROUP) {
      const part = names.slice(k, k + GROUP);
      await readGroup(part, kho);
      loadedCount += part.length;
      if ((view === 'home' || view === 'lop') && !homeBusy()) render();
    }
    store.set('hp_all_at', Date.now());
  } catch (e) { notice('Chưa đọc xong các lớp: ' + e.message, true); }
  loadingAll = false; if ((view === 'home' || view === 'lop') && !homeBusy()) render();
}

/* ---------- Paid ticks: saved in the browser first, then one batch per class ---------- */
/**
 * Every write makes the whole file recalculate, and a read then waits about a minute while a write takes a second or two.
 * So the checks a tick needs are read ahead, when the class opens and again after each save, and a tick only writes.
 */
const WARM_MS = 5 * 60000;
const warm = {};
function warmUp(name, rows) {
  const w = warm[name] = warm[name] || { written: {} };
  if (w.busy) { w.again = rows; return w.busy; }
  const at = Date.now(), want = L.freshRanges(name, rows);
  w.busy = Promise.all([batchGet(want.values), batchGet(want.cells, 'FORMULA')]).then(([values, cells]) => {
    w.at = at; w.rows = rows; w.values = values; w.cells = cells;
    // What this read started after is in it; only later writes still count as unseen.
    Object.keys(w.written).forEach(k => { if (w.written[k] <= at) delete w.written[k]; });
    checkWritten(name);
  }).catch(e => { console.error(e.message); }).then(() => {
    w.busy = null;
    if (w.again) { const r = w.again; w.again = null; warmUp(name, r); }
  });
  return w.busy;
}
/** Answers for one save: the read-ahead when it is recent and covers these rows, otherwise a fresh read as before. */
async function freshFor(name, group) {
  const w = warm[name], usable = w && w.values && Date.now() - w.at < WARM_MS
    && group.every(p => w.rows.includes(p.item.row) && !w.written[p.item.row + '|' + p.dot]);
  if (usable) return p => L.freshAt(w.values, w.cells, w.rows.indexOf(p.item.row));
  const rows = group.map(p => p.item.row), want = L.freshRanges(name, rows), [values, cells] = await Promise.all([batchGet(want.values), batchGet(want.cells, 'FORMULA')]);
  return (p, k) => L.freshAt(values, cells, k);
}
function noteWritten(name, ok) {
  const w = warm[name] = warm[name] || { written: {} }, now = Date.now();
  w.check = (w.check || []).concat(ok.map(p => p.item));
  ok.forEach(p => { w.written[p.item.row + '|' + p.dot] = now; });
  if (w.rows) warmUp(name, w.rows);
}
/** The first read after a save confirms each row still held that student when it was written; a roster sync could have moved one. */
function checkWritten(name) {
  const w = warm[name], items = (w && w.check) || [];
  if (!w) return;
  w.check = [];
  items.forEach(it => {
    const k = w.rows.indexOf(it.row);
    try { if (k >= 0) L.locate(name, it, L.freshAt(w.values, w.cells, k)); }
    catch (e) { notice('Kiểm tra lại dấu đã nộp của ' + it.name + ' lớp ' + name + ': ' + e.message, true); }
  });
}
const QKEY = 'hp_pending', FINAL_ERROR = /đổi học sinh|không còn trong live|chưa dùng sổ mới|không khớp|Không thấy cột/;
let pending = store.get(QKEY) || [], flushing = false, flushTimer = null, refreshTimer = null;
/** A saved tick shows in the class's saved copy straight away; dirty means the next open still checks the Sheet. */
function patchCache(p) {
  const c = store.get('hp_cls_' + p.tab);
  if (!c) return;
  const it = String(c.data.dot) === String(p.dot) ? c.data.items.find(x => x.key === p.item.key) : null;
  if (it) { it.paid = p.kind === 'paid'; it.status = it.paid ? 'Đã nộp' : 'Chưa nộp'; it.date = it.paid ? p.date : ''; if (it.paid && (!it.tienSheet || it.stale)) { it.tienSheet = p.item.amount || 0; it.stale = false; } }
  if (p.gopOf && String(c.data.dot) === String(p.gopOf)) { const x = c.data.items.find(y => y.key === p.item.key); if (x) applyPrev(x, p); }
  c.dirty = true;
  store.set('hp_cls_' + p.tab, c);
}
function savePending() { store.set(QKEY, pending); renderNotices(); }
/** A tick or undo on the previous đợt, shown at once: the message formula catches up after the Sheet recalculates. */
function applyPrev(x, p) {
  if (x.prev) { x.prev.paid = p.kind === 'paid'; x.prev.status = x.prev.paid ? 'Đã nộp' : p.item.restore || ''; x.prev.date = x.prev.paid ? p.date : ''; }
  if (p.kind === 'paid') L.dropGop(x); else L.addGop(x, p.dot, p.item.amount, !p.item.restore);
}
function applyPendingToView() {
  if (!cur) return;
  pending.filter(p => p.tab === cur.tab && p.gopOf === cur.dot).forEach(p => { const it = cur.items.find(x => x.key === p.item.key); if (it) { applyPrev(it, p); if (it.prev) it.prev.luu = true; } });
  pending.filter(p => p.tab === cur.tab && p.dot === cur.dot).forEach(p => {
    const it = cur.items.find(x => x.key === p.item.key); if (!it) return;
    it.paid = p.kind === 'paid'; it.status = p.kind === 'paid' ? 'Đã nộp' : 'Chưa nộp'; it.date = p.kind === 'paid' ? p.date : ''; it.dangLuu = true;
  });
}
function queue(p) {
  pending = pending.filter(x => !(x.item.key === p.item.key && x.dot === p.dot)).concat(p);
  savePending(); applyPendingToView(); render();
  clearTimeout(flushTimer); flushTimer = setTimeout(flush, 800);
}
async function flush() {
  if (flushing || !pending.length) return;
  flushing = true; renderNotices();
  const groups = {};
  pending.forEach(p => { (groups[p.tab] = groups[p.tab] || []).push(p); });
  for (const name of Object.keys(groups)) {
    const group = groups[name], rows = group.map(p => p.item.row);
    try {
      const read = await freshFor(name, group), data = [], ok = [];
      group.forEach((p, k) => {
        const fresh = read(p, k);
        try {
          const up = p.kind === 'paid' ? L.planPaid(name, p.item, fresh, p.dot, p.date, p.item.amount) : L.planUnpaid(name, p.item, fresh, p.dot);
          up.forEach(x => data.push(x)); ok.push(p);
        } catch (e) { p.error = e.message; }
      });
      if (data.length) await batchWrite(data);
      noteWritten(name, ok);
      const done = new Set(ok);
      ok.forEach(patchCache);
      pending = pending.filter(p => !done.has(p));
    } catch (e) { group.forEach(p => { p.error = e.message; }); }
  }
  flushing = false; savePending();
  if (cur && groups[cur.tab] && !pending.some(p => p.tab === cur.tab)) {
    cur.items.forEach(x => { x.dangLuu = false; if (x.prev) x.prev.luu = false; });
    if (view === 'class') render();
    // The tick already shows, so check it against the Sheet later and without blocking anything.
    const name = cur.tab;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (view === 'class' && cur && cur.tab === name && !pending.length) refreshClass(name, ++loadSeq); }, 45000);
  }
  // Ticks made during this save go straight away; only a failed one waits.
  clearTimeout(flushTimer);
  if (pending.some(p => !p.error)) flushTimer = setTimeout(flush, 0);
  else if (pending.some(p => !FINAL_ERROR.test(p.error))) flushTimer = setTimeout(flush, 60000);
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
/* ---------- People with a link: only the owner sees this page, and the gateway checks it too ---------- */
let nguoi = null, nguoiMoi = null, nguoiErr = '';
async function loadNguoi() {
  try { nguoi = (await cong({ op: 'nguoi' })).people; nguoiErr = ''; } catch (e) { nguoiErr = e.message; }
  if (view === 'nguoi') render();
}
function renderNguoi(box) {
  const ten = el('input', { placeholder: 'Tên người dùng, ví dụ Sơn', 'aria-label': 'Tên người dùng', maxlength: '40' }), msg = el('span', { class: 'sub', role: 'status', textContent: nguoiErr });
  const them = async () => {
    if (!ten.value.trim()) { msg.textContent = 'Hãy nhập tên.'; return; }
    msg.textContent = 'Đang tạo…';
    try { const d = await cong({ op: 'them', name: ten.value }); nguoiMoi = { name: d.name, link: location.origin + location.pathname + '#k=' + d.key }; await loadNguoi(); render(); }
    catch (e) { msg.textContent = 'Không tạo được: ' + e.message; }
  };
  const xoa = async p => {
    if (!confirm('Xoá ' + p.name + '? Link của ' + p.name + ' sẽ hết hiệu lực ngay.\nNếu người này còn quyền trên file Sheet thì nhớ gỡ cả ở đó.')) return;
    try { await cong({ op: 'xoa', id: p.id }); nguoiMoi = null; await loadNguoi(); notice('Đã xoá ' + p.name + ', link đó không vào được nữa.'); }
    catch (e) { notice('Không xoá được: ' + e.message, true); }
  };
  box.append(el('div', { class: 'page-title' }, [el('div', {}, [el('h1', { textContent: 'Người dùng' }), el('div', { class: 'sub', textContent: 'Mỗi người một link riêng, không cần đăng nhập. Xoá người là link đó hết hiệu lực.' })])]));
  if (nguoiMoi) {
    const copy = el('button', { class: 'act', textContent: 'Copy link', onclick: async () => { try { await navigator.clipboard.writeText(nguoiMoi.link); copy.textContent = 'Đã copy'; } catch (e) { copy.textContent = 'Không copy được, bôi đen để copy'; } } });
    box.append(el('div', { class: 'card panel' }, [el('h2', { class: 'panel-title', textContent: 'Link của ' + nguoiMoi.name }),
      el('div', { class: 'sub', textContent: 'Link chỉ hiện lần này. Gửi riêng cho ' + nguoiMoi.name + ', đừng dán vào nhóm. Ai có link là xem và sửa được học phí.' }),
      el('div', { style: 'word-break:break-all;margin:8px 0;user-select:all', textContent: nguoiMoi.link }), copy]));
  }
  box.append(el('div', { class: 'card panel' }, [el('h2', { class: 'panel-title', textContent: 'Thêm người' }), el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center' }, [ten, el('button', { class: 'act', textContent: 'Tạo link', onclick: them }), msg])]),
    el('div', { class: 'card panel' }, [el('h2', { class: 'panel-title', textContent: 'Đang có link' }),
      !nguoi ? el('div', { class: 'sub', textContent: 'Đang đọc…' }) : !nguoi.length ? el('div', { class: 'sub', textContent: 'Chưa cấp link cho ai.' })
        : el('div', { class: 'fee-list' }, nguoi.map(p => el('div', { class: 'row card' }, [el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: p.name }), el('span', { class: 'sub', textContent: 'Cấp ngày ' + p.at })]), el('div', { class: 'r2' }, [el('div', { class: 'fill' }), el('button', { class: 'quiet', textContent: 'Xoá', onclick: () => xoa(p) })])])))]));
}
function renderNotices() {
  const box = $('notices'); box.replaceChildren();
  if (noticeText) box.append(el('div', { class: noticeErr ? 'notice err' : 'notice', role: 'status', textContent: noticeText }));
  if (pending.length) {
    const stuck = pending.filter(p => p.error);
    box.append(el('div', { class: stuck.length ? 'notice err' : 'notice warn', role: 'status',
      textContent: (flushing ? 'Đang lưu ' : 'Chờ lưu ') + pending.length + ' lần tick. Đừng đóng trang.' + (stuck.length ? ' Lỗi: ' + stuck[0].error : '') }));
  }
  if (sentErr) box.append(el('div', { class: 'notice warn', role: 'status', textContent: sentErr }));
  const nhac = nhacHomNay();
  if (nhac) box.append(nhac);
}
/** On every page, on the days a reminder falls due. "Để sau" hides it until tomorrow; the list on Tổng quan stays. */
function nhacHomNay() {
  if ($('app').hidden || !(sentAt || sentRows.length)) return null;
  const today = L.dayNow(new Date());
  if (store.get('hp_nhac_an') === today) return null;
  const rows = nhacLaiRows().map(c => ({ tab: c.data.tab, list: c.list.filter(r => r.onCycle) })).filter(c => c.list.length);
  const unticked = chuaDanhDau().filter(r => r.left);
  if (!rows.length && !unticked.length) return null;
  const all = rows.reduce((n, c) => n + c.list.length, 0), blank = rows.reduce((n, c) => n + c.list.filter(r => r.blank).length, 0);
  const parts = [];
  if (unticked.length) parts.push(unticked.reduce((n, r) => n + r.left.length, 0) + ' em chưa tick đã gửi Zalo');
  if (rows.length) parts.push(all + ' em đến lượt nhắc (' + (all - blank) + ' chưa nộp, ' + blank + ' chưa ghi)');
  const toList = () => { const go = () => { const t = $(unticked.length ? 'nhacGui' : 'nhacLai'); if (t) t.scrollIntoView({ behavior: 'smooth' }); }; if (view === 'home') go(); else { goTo('home'); setTimeout(go, 50); } };
  return el('div', { class: 'notice warn top-note', role: 'status', id: 'nhacHomNay' }, [
    el('span', {}, [el('b', { textContent: 'Hôm nay: ' }), parts.join(' · ')]),
    el('span', { class: 'top-acts' }, [el('button', { class: 'quiet', textContent: 'Xem danh sách', onclick: toList }),
      el('button', { class: 'quiet', textContent: 'Để sau', onclick: () => { store.set('hp_nhac_an', today); renderNotices(); } })])]);
}
function showLogin(again) {
  // Mid-work the page stays up: the next click renews the sign-in, and unsaved ticks wait in their queue.
  if (again && !$('app').hidden) {
    token = null; tokenUntil = 0; sessionLost = true;
    return notice('Phiên Google vừa hết giờ. Bấm vào bất cứ chỗ nào để nối lại, các dấu tick chưa lưu vẫn được giữ.', true);
  }
  const hint = store.get('hp_email');
  $('btnLogin').textContent = hint ? 'Tiếp tục với ' + hint : 'Đăng nhập Google';
  $('login').hidden = false; $('app').hidden = true; $('loginMsg').textContent = again ? 'Phiên đăng nhập đã hết, bấm để đăng nhập lại.' : '';
}
function st(s, err) { const n = $('st'); if (n) { n.textContent = s; n.style.color = err ? 'var(--bad)' : 'var(--ok)'; } }
function render() {
  const box = $('view'); box.replaceChildren();
  [['navHome', 'home'], ['btnCal', 'cal'], ['navLop', 'lop'], ['navTutor', 'tutor'], ['btnMoves', 'moves'], ['navNguoi', 'nguoi']].forEach(([id, v]) => $(id).setAttribute('aria-current', String(view === v || (v === 'lop' && view === 'class'))));
  if (view === 'tutor') renderTutor(box); else if (view === 'nguoi') renderNguoi(box); else if (view === 'home') renderHome(box); else if (view === 'lop') renderLop(box); else if (view === 'moves') renderMoves(box); else if (view === 'cal') renderCal(box); else renderClass(box);
  const n = moves ? moves.list.filter(m => !m.wait).length + moves.due.length : 0;
  $('btnMoves').textContent = n ? 'Biến động (' + n + ')' : 'Biến động';
  const tutorLeft = tutorViec().left.length;
  $('navTutor').textContent = tutorLeft ? 'Tutor (' + tutorLeft + ')' : 'Tutor';
  const dueNow = cal ? cal.list.filter(x => (x.group === 'den' || x.group === 'qua') && !daGuiHet(x)).length : 0;
  $('btnCal').textContent = dueNow ? 'Lịch thu (' + dueNow + ')' : 'Lịch thu';
  renderNotices();
}

/* ---------- Who sent what on Zalo: a separate small file, so a tick never makes the tuition file recalculate ---------- */
let who = '', sentRows = [], sentIdx = {}, sentQueue = [], sentAt = 0, sentBusy = false, sentErr = '', ackMap = {}, ackDue = {};
const personName = mail => (/^mstrang/.test(mail) ? 'Cô Trang' : /^im\.son/.test(mail) ? 'Sơn' : String(mail).split('@')[0]);
const sentOf = (tabName, dot, key) => { const c = sentIdx[tabName + '|' + dot]; return c ? c[key] || c['*'] || null : null; };
const sentText = s => (s.lan ? 'Đã nhắc lại lần ' + s.lan + ' ' : 'Đã gửi ') + s.at + (s.by ? ' · ' + s.by : '');
function restoreSent() { roiMap = store.get('hp_roi') || {}; sentQueue = store.get('hp_sentq') || []; sentRows = (store.get('hp_sentlog') || []).concat(sentQueue); sentIdx = L.sentIndex(sentRows); ackMap = store.get('hp_ack') || {}; ackDue = store.get('hp_ackdue') || {}; }
async function loadWho() {
  if (linkKey) {
    try { const me = await cong({ op: 'ai' }); who = me.name; linkRole = me.role; $('navNguoi').hidden = linkRole !== 'chu'; } catch (e) { console.error(e.message); }
    return;
  }
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
    if (r.ok) { const u = await r.json(); if (u.email) { who = personName(u.email); store.set('hp_email', u.email); } }
  } catch (e) { /* marks are still saved, only without a name */ }
}
async function loadSent(force) {
  if (!force && Date.now() - sentAt < 60000) return;
  try {
    const [rows] = await batchGetAt(LOG_API, ['NhatKy!A2:H20000']);
    store.set('hp_sentlog', rows);
    sentRows = rows.concat(sentQueue); sentIdx = L.sentIndex(sentRows); sentAt = Date.now(); sentErr = '';
    if (view === 'cal' || view === 'home' || view === 'moves' || (view === 'class' && tab !== 'zalo')) render();
  } catch (e) { sentErr = /permission|caller does not have/i.test(e.message) ? 'Tài khoản này chưa được chia sẻ file Nhật ký gửi Zalo, nên chưa lưu được ai đã gửi.' : 'Chưa đọc được nhật ký gửi: ' + e.message; renderNotices(); }
}
async function loadAck() {
  try {
    const [rows] = await batchGet(["'XÁC NHẬN ĐÃ GỬI'!A4:G800"]), map = {}, due = {};
    rows.forEach(r => { if (r[6]) { map[r[6]] = (r[6] in map ? map[r[6]] : true) && /^true$/i.test(String(r[3])); due[r[6]] = r[2]; } });
    ackMap = map; ackDue = due; store.set('hp_ack', map); store.set('hp_ackdue', due);
    if (view === 'home' || view === 'cal') render();
  } catch (e) { console.error(e.message); }
}
function nowShort() { const d = new Date(), p = n => ('0' + n).slice(-2); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
function logSent(tabName, dot, list, action) {
  const at = nowShort(), rows = list.map(x => [at, tabName, String(dot), x.name, x.eng || '', x.key, action, who]);
  sentRows = sentRows.concat(rows); sentIdx = L.sentIndex(sentRows);
  sentQueue = sentQueue.concat(rows); store.set('hp_sentq', sentQueue);
  flushSent();
}
async function flushSent() {
  if (sentBusy || !sentQueue.length) return;
  sentBusy = true;
  const batch = sentQueue.slice();
  try {
    await api(LOG_API + '/values/NhatKy!A:H:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: batch }) }, 2);
    sentQueue = sentQueue.slice(batch.length); store.set('hp_sentq', sentQueue); sentErr = '';
    sentBusy = false; if (sentQueue.length) flushSent();
  } catch (e) {
    sentBusy = false;
    sentErr = (/permission|caller does not have/i.test(e.message) ? 'Tài khoản này chưa được chia sẻ file Nhật ký gửi Zalo. ' : 'Mạng hoặc file đang bận. ') + 'Dấu đã gửi đang giữ trên máy này và sẽ tự lưu lại.';
    setTimeout(flushSent, 30000);
  }
  renderNotices();
}
function markStudent(it, on) {
  if (!cur || L.free(it)) return;
  logSent(cur.tab, cur.dot, [it], on ? 'da-gui' : 'bo');
  render();
}
/** Whole-class tick: also the box the reminder email reads in XÁC NHẬN ĐÃ GỬI, so the email stops asking about this đợt. */
async function markClass(tabName, dot, due, on) {
  const key = L.ackKey(tabName, dot), sheet = "'XÁC NHẬN ĐÃ GỬI'!";
  ackMap[key] = on; store.set('hp_ack', ackMap);
  logSent(tabName, dot, [{ name: '(cả lớp)', eng: '', key: '*' }], on ? 'da-gui' : 'bo');
  render();
  try {
    const [rows] = await batchGet([sheet + 'A4:G800']), hits = [];
    rows.forEach((r, k) => { if (r[6] === key) hits.push(k + 4); });
    const row = rows.length + 4;
    const data = hits.length ? hits.map(n => ({ range: sheet + 'D' + n, values: [[on]] }))
      : on ? [{ range: sheet + 'A' + row + ':G' + row, values: [[tabName, Number(dot), due || '', on, '=IF(D' + row + ';"Đã gửi — dừng nhắc thông báo";"Chưa xác nhận đã gửi")', '', key]] }] : [];
    if (data.length) await batchWrite(data);
  } catch (e) {
    ackMap[key] = !on; store.set('hp_ack', ackMap);
    logSent(tabName, dot, [{ name: '(cả lớp)', eng: '', key: '*' }], on ? 'bo' : 'da-gui');
    notice('Chưa lưu được dấu cả lớp: ' + e.message, true); render();
  }
}

/* ---------- Collection calendar: from TỔNG HỢP, checked against the Schedule ---------- */
let cal = store.get('hp_cal'), calLoading = false, sched = store.get('hp_sched'), schedLoading = false;
async function loadCal(force) {
  if (calLoading || (!force && cal && Date.now() - cal.at < 600000)) return;
  calLoading = true; if (view === 'cal') render();
  try {
    const [rows, synced] = await batchGet(["'TỔNG HỢP'!A3:K60", "'NGHI_LE'!I8"]);
    cal = { list: L.calendar(rows), synced: String(((synced || [])[0] || [])[0] || ''), at: Date.now() };
    store.set('hp_cal', cal);
  } catch (e) { notice('Chưa đọc được lịch thu: ' + e.message, true); }
  calLoading = false; if (view === 'cal' || ((view === 'home' || view === 'lop') && !homeBusy())) render();
}
async function loadSchedule(force) {
  if (schedLoading || !cal || (!force && sched && !sched.error && Date.now() - sched.at < 1800000)) return;
  schedLoading = true; if (view === 'cal') render();
  try {
    const tabs = cal.list.map(x => x.tab);
    const lessonRows = await batchGet(tabs.map(t => L.quote(t) + '!AK20:AK39')), lessons = {};
    tabs.forEach((t, k) => { lessons[t] = lessonRows[k].map(r => L.dayOf(r[0])).filter(n => !isNaN(n)); });
    const first = Math.min(...tabs.map(t => lessons[t].length ? Math.min(...lessons[t]) : Infinity));
    const meta = await api(SCHEDULE_API + '?fields=sheets.properties.title');
    const weeks = meta.sheets.map(s => s.properties.title).map(title => {
      const m = title.match(/^(\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})$/);
      return m ? { title, from: L.dayOf(m[1]), to: L.dayOf(m[2]) } : null;
    }).filter(w => w && w.to >= first);
    const byClass = {};
    for (let k = 0; k < weeks.length; k += 5) {
      const part = weeks.slice(k, k + 5);
      // The header row moved from 39 to 58 on the 19.10 tab, so each column is read from above both.
      const got = await batchGetAt(SCHEDULE_API, part.reduce((a, w) => a.concat(['A30:G60', 'A30:A320', 'D30:D320', 'M30:M320'].map(r => L.quote(w.title) + '!' + r)), []));
      part.forEach((w, n) => {
        const [toggles, a, d, m] = got.slice(n * 4, n * 4 + 4);
        L.weekSessions(a, d, m, toggles).filter(s => s.day >= w.from && s.day <= w.to).forEach(s => { (byClass[s.cls] = byClass[s.cls] || []).push(s); });
      });
    }
    const gaps = {}, days = {}, offs = {}, sessions = {};
    tabs.forEach(t => {
      sessions[t] = (byClass[L.classKey(t)] || []).map(s => ({ day: s.day, off: s.off }));
      const first = lessons[t].length ? Math.min(...lessons[t]) : Infinity;
      // A day with a second session still running is not a day off, as in scheduleGaps.
      const all = byClass[L.classKey(t)] || [], running = new Set(all.filter(s => !s.off).map(s => s.day));
      offs[t] = [...new Set(all.filter(s => s.off && s.day >= first && !running.has(s.day)).map(s => s.day))].sort((a, b) => a - b);
      const g = L.scheduleGaps(lessons[t], byClass[L.classKey(t)], weeks);
      if (!g.length) return;
      gaps[t] = g;
      const from = Math.min(...lessons[t]), to = Math.max(...weeks.map(w => w.to));
      days[t] = { file: L.weekdays(lessons[t]), schedule: L.weekdays((byClass[L.classKey(t)] || []).filter(s => !s.off && s.day >= from && s.day <= to).map(s => s.day)) };
    });
    sched = { gaps, days, offs, sessions, weeks: weeks.length, last: weeks.length ? Math.max(...weeks.map(w => w.to)) : 0, at: Date.now() };
    store.set('hp_sched', sched);
  } catch (e) {
    sched = { error: /permission|caller does not have/i.test(e.message) ? 'Tài khoản này chưa có quyền xem file Schedule.' : 'Chưa đọc được Schedule: ' + e.message };
  }
  schedLoading = false; if (view === 'cal') render();
}
function openCal() { goTo('cal'); loadCal().then(() => loadSchedule()); }
function dueText(x) {
  const d = L.dayOf(x.due) - L.dayNow(new Date());
  return x.due + (d === 0 ? ' (hôm nay)' : d > 0 ? ' (còn ' + d + ' ngày)' : ' (đã qua ' + -d + ' ngày)');
}
const GAP_TEXT = {
  nghi: 'Schedule nghỉ. Sáng mai file học phí tự dời buổi này',
  thieu: 'file học phí tính một buổi, nhưng Schedule không có lớp này',
  them: 'Schedule có học, nhưng file học phí không tính buổi này'
};
const gapsToShow = x => (sched && sched.gaps && sched.gaps[x.tab]) || [];
function calRow(x) {
  const c = store.get('hp_cls_' + x.tab), s = c && String(c.data.dot) === x.dot ? summarize(c.data) : null, gaps = gapsToShow(x);
  const chipClass = x.group === 'den' || x.group === 'qua' ? 'chip' : x.group === 'sap' ? 'chip warn-soft' : 'chip idle';
  const prev = Number(x.dot) - 1, kids = [
    el('div', { class: 'top' }, [el('b', { textContent: x.tab }), el('span', { class: chipClass, textContent: x.state })]),
    el('dl', { class: 'kv' }, [
      el('dt', { textContent: 'Thu đợt ' + x.dot }), el('dd', {}, [el('strong', { textContent: dueText(x) })]),
      x.start && x.end ? el('dt', { textContent: 'Đợt ' + prev + ' học' }) : '', x.start && x.end ? el('dd', { textContent: x.start + ' đến ' + x.end }) : '',
      el('dt', { textContent: 'Số tiền' }), el('dd', { textContent: L.fmt(x.total) + ' đ' + (x.book ? ' · ' + x.book : '') }),
      s ? el('dt', { textContent: 'Đã nộp' }) : '', s ? el('dd', { textContent: s.paid + '/' + s.total + ' em' }) : ''])];
  const unpaid = c && String(c.data.dot) === x.dot ? c.data.items.filter(canThu) : [];
  const gone = unpaid.filter(y => sentOf(x.tab, x.dot, y.key)).length;
  if (gone && !ackMap[L.ackKey(x.tab, x.dot)]) kids.push(el('div', { class: 'cal-line sent', textContent: 'Đã gửi ' + gone + '/' + unpaid.length + ' em chưa nộp' }));
  // Many differences mean the class's weekdays are wrong rather than single sessions.
  const days = sched && sched.days && sched.days[x.tab];
  if (gaps.length > 3 && days && days.file !== days.schedule) kids.push(el('div', { class: 'warn-line', textContent: 'Lệch thứ học: file học phí tính ' + days.file + ', Schedule học ' + days.schedule + '. Ngày cuối đợt và hạn thu ở trên có thể sai.' }));
  else gaps.forEach(g => kids.push(el('div', { class: 'warn-line', textContent: L.dayText(g.day) + ': ' + GAP_TEXT[g.type] })));
  const go = t => () => { tab = t; filter = 'can'; openClass(x.tab); if (t === 'dot') { loadBooks(); loadSchedule(); } if (t === 'zalo') loadSent(); };
  return el('div', { class: 'class cal-row' }, kids.concat([
    x.group === 'chua' ? '' : el('label', { class: 'ack' }, [
      el('input', { type: 'checkbox', checked: !!ackMap[L.ackKey(x.tab, x.dot)], onchange: e => markClass(x.tab, x.dot, x.due, e.target.checked) }),
      'Đã gửi tin thu đợt ' + x.dot]),
    el('div', { class: 'card-actions' }, [
      el('button', { class: 'act', textContent: 'Thu tiền', onclick: go('thu') }),
      el('button', { class: 'act', textContent: 'Gửi Zalo', onclick: go('zalo') }),
      el('button', { class: 'act', textContent: x.book ? 'Đổi sách' : 'Chọn sách', onclick: go('dot') })])]));
}
function renderCal(box) {
  box.append(el('div', { class: 'page-title' }, [
    el('div', {}, [el('h1', { textContent: 'Lịch thu các lớp' }),
      el('div', { class: 'sub', textContent: calLoading && !cal ? 'Đang đọc…' : cal ? 'Số lúc ' + new Date(cal.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '' })])]));
  if (!cal) { box.append(el('div', { class: 'empty', textContent: calLoading ? 'Đang đọc, xin đợi…' : 'Chưa đọc được. Bấm ↻ để thử lại.' })); return; }
  const lines = [];
  if (schedLoading) lines.push(el('div', { class: 'notice', textContent: 'Đang đối chiếu với Schedule…' }));
  if (sched && sched.error) lines.push(el('div', { class: 'notice warn', textContent: sched.error }));
  else if (sched && sched.at) {
    const n = cal.list.filter(x => gapsToShow(x).length).length, lastDay = sched.last ? L.dayText(sched.last) : '';
    lines.push(el('div', { class: n ? 'notice warn' : 'notice', textContent: (n ? n + ' lớp có buổi lệch với Schedule, xem ở từng lớp bên dưới.' : 'Các buổi của đợt đang học khớp với Schedule.') + ' Schedule mới có tuần đến ' + lastDay + ', các buổi sau đó vẫn là dự kiến nên hạn thu có thể còn đổi.' }));
  }
  if (cal.synced) lines.push(el('div', { class: /LỖI|đầy/.test(cal.synced) ? 'notice warn' : 'notice', textContent: 'Ngày nghỉ lấy từ Schedule mỗi sáng. Lần đọc cuối ' + cal.synced }));
  if (lines.length) box.append(el('div', { class: 'notices' }, lines));
  const waiting = x => x.group === 'chua' || !daGuiHet(x);
  [['den', 'Đến hạn thu'], ['qua', 'Đã qua ngày cuối đợt'], ['sap', 'Sắp thu'], ['chua', 'Chưa đến']].forEach(([id, title]) => {
    const list = cal.list.filter(x => x.group === id && waiting(x));
    if (list.length) box.append(el('h2', { class: 'section', textContent: title + ' (' + list.length + ')' }), el('div', { class: 'classes' }, list.map(calRow)));
  });
  const sentList = cal.list.filter(x => !waiting(x));
  if (sentList.length) box.append(el('h2', { class: 'section', textContent: 'Đã gửi tin (' + sentList.length + ')' }), el('div', { class: 'classes' }, sentList.map(calRow)));
}

/* ---------- Student movements: new, transfer, leaving ---------- */
let moves = null, movesLoading = false;
const KIND = { moi: 'Học sinh mới', chuyen: 'Chuyển lớp', nghi: 'Nghỉ học' };
const dayText = ms => { const d = new Date(ms), p = n => ('0' + n).slice(-2); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); };
const isoOf = ms => { const d = new Date(ms), p = n => ('0' + n).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
async function loadMoves() {
  if (movesLoading) return;
  movesLoading = true; if (view === 'moves') render();
  try {
    // The log tab appears at the first roster change, so a missing tab just means no events yet.
    const events = await batchGet(["'_BIEN_DONG_HS'!A2:I3000"]).then(x => x[0]).catch(e => { if (/Unable to parse range/.test(e.message)) return []; throw e; });
    const [news, exits, bookRows] = await batchGet([L.quote(L.NEW_TAB) + '!A3:U199', L.quote(L.EXIT_TAB) + '!A4:X400', "'DANH_MUC_SACH'!A4:B80"]);
    bookList = readBookList(bookRows);
    roiMap = L.recentExits(exits, L.dayNow(new Date())); store.set('hp_roi', roiMap);
    moves = {
      exits, news,
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
      el('div', { class: 'sub', textContent: movesLoading ? 'Đang đọc, file có thể đang bận nên có thể mất vài phút…' : moves ? 'Số mới lúc ' + new Date(moves.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '' })]),
    el('button', { textContent: 'Tải lại', disabled: movesLoading, onclick: loadMoves })]));
  if (!moves) { box.append(el('div', { class: 'empty', textContent: movesLoading ? 'Đang đọc, xin đợi…' : 'Chưa đọc được. Bấm Tải lại để thử lại.' })); return; }
  box.append(el('div', { class: 'card panel add-move' }, [el('div', {}, [el('b', { textContent: 'Có em mới, em nghỉ hoặc chuyển lớp?' }),
    el('div', { class: 'sub', textContent: 'Thêm trực tiếp ở đây, không cần chờ Theo dõi toàn diện. Khi toàn diện cập nhật sau, app biết là cùng một việc và không hỏi lại.' })]),
    el('div', { class: 'add-btns' }, [el('button', { class: 'primary', textContent: 'Thêm học sinh mới', onclick: moThemMoi }), el('button', { textContent: 'Thêm nghỉ / chuyển lớp', onclick: moThem })])]));
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
/* ---------- A leaver the Sheet cannot price yet: the bill from the Schedule, seen and confirmed before anything is written ---------- */
let tinh = null;
async function moTinh(it) {
  tinh = { key: it.key, busy: 'Đang đọc lịch và dòng của em này…' }; render();
  try {
    if (!sched || !sched.sessions) await loadSchedule();
    const tabQ = L.quote(it.tab), [[row], [acc]] = await Promise.all([batchGet([tabQ + '!A' + it.row + ':X' + it.row]), batchGet(["'DANH_MUC_SACH'!E3:I6"])]);
    const [[cellF]] = await batchGet([tabQ + '!E' + it.row], 'FORMULA');
    const r = row[0] || [];
    if (L.clean(r[1]) !== L.clean(it.name)) throw new Error('Dòng ' + it.row + ' đã đổi học sinh, hãy tải lại.');
    if (/CẦN KIỂM TRA/.test(String(r[21]))) throw new Error('Tiền sách đang lỗi: ' + r[21]);
    const data = await readClass(it.cls), before = data.history.find(h => Number(h.dot) === Number(data.nextDot) - 1), prevEnd = L.dayOf(before && before.to ? before.to : data.prevEnd);
    const list = !isNaN(prevEnd) && sched && sched.sessions && sched.last ? L.scheduleLessons(prevEnd, data.lessons.length || Number(data.sessions) || 20, sched.sessions[it.cls], sched.last, data.lessons) : data.lessons.map(day => ({ day, known: false }));
    const dot = Number(data.nextDot) - 1, me = data.items.find(x => L.clean(x.name) === L.clean(it.name));
    // The owner's rule: a student who already paid the đợt they left in owes nothing for it.
    const paid = me && (String(data.dot) === String(dot) ? me.paid : me.prev && me.prev.dot === String(dot) && me.prev.paid);
    const accountRow = (acc || []).find(a => a[0] === r[22]);
    tinh = { key: it.key, dot, list, paid, input: { days: list.map(x => x.day), date: L.dayOf(r[7]), join: L.dayOf(r[3]) || 0, fee: L.digits(data.fee), sessions: Number(data.sessions) || list.length,
      bookFee: L.digits(r[21]), bookList: r[20] || '', discCell: ((cellF || [])[0]), name: it.name, eng: it.eng, cls: it.cls, account: accountRow ? accountRow[4] : r[22], dot } };
  } catch (e) { tinh = { key: it.key, error: e.message }; }
  render();
}
function tinhPanel(it) {
  const t = tinh, shut = el('button', { class: 'quiet', textContent: 'Đóng', onclick: () => { tinh = null; render(); } });
  if (t.busy) return el('div', { class: 'sub', style: 'margin-top:6px', textContent: t.busy });
  if (t.error) return el('div', { class: 'warn-line' }, [t.error, shut]);
  const bill = L.leaveBill(t.input), msg = el('span', { class: 'sub', role: 'status' });
  const used = el('input', { type: 'number', min: '0', max: String(t.input.sessions), value: String(t.input.used === undefined ? (bill.used === undefined ? '' : bill.used) : t.input.used), 'aria-label': 'Số buổi', style: 'width:80px', onchange: e => { t.input.used = e.target.value; render(); } });
  const kids = [el('h3', { class: 'panel-title', style: 'margin-top:10px', textContent: 'Tính theo Schedule, đợt ' + t.dot })];
  if (t.paid) kids.push(el('div', { class: 'warn-line', textContent: 'Bảng ghi em này đã đóng đợt ' + t.dot + ': đúng ra không thu học phí đợt này. Xem lại trước khi ghi.' }));
  {
    kids.push(el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0' }, [el('label', { style: 'margin:0', textContent: 'Số buổi đã học' }), used, bill.used !== undefined && bill.used !== bill.counted ? el('span', { class: 'sub', textContent: 'Schedule đếm được ' + bill.counted + ' buổi' }) : '']));
    if (bill.error) kids.push(el('div', { class: 'warn-line', textContent: bill.error }));
    else kids.push(
      el('dl', { class: 'kv' }, [
        el('dt', { textContent: 'Học phí' }), el('dd', { textContent: bill.used + ' buổi × ' + L.fmt(Math.round(bill.per)) + ' đ = ' + L.fmt(bill.tuition) + ' đ' }),
        bill.book ? el('dt', { textContent: 'Sách' }) : '', bill.book ? el('dd', { textContent: L.fmt(bill.book) + ' đ' }) : '',
        bill.off ? el('dt', { textContent: 'Giảm' }) : '', bill.off ? el('dd', { textContent: L.fmt(bill.off) + ' đ' }) : '',
        el('dt', { textContent: 'Tổng' }), el('dd', {}, [el('strong', { textContent: L.fmt(bill.total) + ' đ' })])]),
      el('details', { class: 'hist' }, [el('summary', { textContent: 'Xem tin nhắn sẽ gửi' }), el('pre', { class: 'detail', textContent: bill.msg })]));
  }
  kids.push(el('div', { class: 'r2' }, [msg, el('div', { class: 'fill' }), shut, bill.error ? '' : el('button', { class: 'primary', textContent: 'Ghi số này', onclick: () => ghiTinh(it, bill, msg) })]));
  return el('div', {}, kids);
}
async function ghiTinh(it, bill, msg) {
  if (!confirm('Ghi ' + fullName(it) + ': ' + bill.used + ' buổi, tổng ' + L.fmt(bill.total) + ' đ vào dòng ' + it.row + ' tab ' + it.tab + '?')) return;
  msg.textContent = 'Đang lưu…';
  const q = L.quote(it.tab), dot = tinh.dot;
  try {
    const [[name]] = await batchGet([q + '!B' + it.row]);
    if (L.clean((name || [])[0]) !== L.clean(it.name)) throw new Error('Dòng ' + it.row + ' đã đổi học sinh, hãy tải lại.');
    await batchWrite([['I', 'Đợt ' + dot], ['N', bill.used], ['O', bill.tuition], ['M', bill.msg]].map(([c, v]) => ({ range: q + '!' + c + it.row, values: [[v]] })));
    tinh = null; await loadMoves();
    notice('Đã ghi ' + it.name + ': ' + L.fmt(bill.total) + ' đ. Dòng này giờ là số ghi tay, Sheet không tự đổi nữa.');
  } catch (e) { msg.textContent = 'Không lưu được: ' + e.message; }
}
function dueRow(it) {
  const d = el('input', { type: 'date', value: localDate(), max: localDate(), 'aria-label': 'Ngày nộp của ' + it.name });
  return el('div', { class: 'row card' }, [
    el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: fullName(it) }), el('span', { class: 'amt', textContent: it.problem ? 'Cần kiểm tra' : money(it.amount) })]),
    el('div', { class: 'sub', style: 'margin-top:4px', textContent: KIND[it.kind] + ' · ' + it.cls }),
    it.problem ? el('div', { class: 'warn-line' }, ['Sheet chưa tính được số tiền (tab ' + it.tab + ', dòng ' + it.row + '): ' + (it.reason || 'bạn mở Sheet kiểm tra.'),
      it.kind === 'nghi' && !(tinh && tinh.key === it.key) ? el('button', { class: 'quiet', textContent: 'Tính theo Schedule', onclick: () => moTinh(it) }) : '']) : '',
    it.problem && tinh && tinh.key === it.key ? tinhPanel(it) : '',
    it.problem ? ''
      : el('div', { class: 'r2' }, [el('button', { textContent: 'Xem thiệp', disabled: !it.qr, onclick: () => moThiep(it) }),
        el('label', { class: 'ack', style: 'margin:0' }, [el('input', { type: 'checkbox', checked: !!dueMark(it), onchange: e => { logSent(dueCls(it), DUE_DOT, [it], e.target.checked ? 'da-gui' : 'bo'); render(); } }), dueMark(it) ? sentText(dueMark(it)) : 'Đã gửi tin']),
        el('div', { class: 'fill' }), d, el('button', { class: 'tick', textContent: 'Đã nộp', onclick: () => tickDue(it, d.value) })])]);
}
function moThiep(it) {
  const img = $('thiepAnh'); img.removeAttribute('src');
  $('thiepTen').textContent = fullName(it); $('thiepSt').textContent = '';
  $('thiepDlg').dataset.key = it.key; $('thiepDlg').showModal();
  thiep(it).then(b => { img.src = URL.createObjectURL(b); }).catch(e => { $('thiepSt').textContent = 'Không tạo được thiệp: ' + e.message; });
}
const thiepDangMo = () => { const key = $('thiepDlg').dataset.key; return (moves && moves.due.find(x => x.key === key)) || (tutor && !tutor.error && tutorMonthItems(key.split('|')[1] || '').find(x => x.key === key)); };
async function copyChuThiep() {
  const it = thiepDangMo(); if (!it) return;
  try { await navigator.clipboard.writeText(it.msg + (it.qr ? '\n\nMã QR chuyển khoản: ' + it.qr : '')); $('thiepSt').textContent = 'Đã copy chữ, sang Zalo dán rồi gửi.'; }
  catch (e) { $('thiepSt').textContent = 'Không copy được chữ.'; }
}
async function copyThiep() {
  const it = thiepDangMo(); if (!it) return;
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
/** A new student the roster does not have yet: class, names, then the approval dialog's date, books and discount. */
function moThemMoi() {
  const m = { manual: true, id: 'tay', kind: 'moi', name: '', eng: '', from: '', to: '', row: 0, at: Date.now(), blocks: null, rows: [] };
  const lop = el('select', { id: 'dvDen', 'aria-label': 'Lớp', onchange: e => { m.to = e.target.value; veDuyet(m); } }, [el('option', { value: '', textContent: 'Chọn lớp' })].concat(classes.map(n => el('option', { value: n, textContent: n }))));
  const ten = el('input', { id: 'dvTenTay', placeholder: 'Họ tên tiếng Việt', 'aria-label': 'Họ tên', oninput: e => { m.name = e.target.value.trim().replace(/\s+/g, ' ').normalize('NFC').toUpperCase(); veDuyet(m); } });
  const eng = el('input', { id: 'dvEngTay', placeholder: 'Tên tiếng Anh (nếu có)', 'aria-label': 'Tên tiếng Anh', oninput: e => { m.eng = e.target.value.trim(); veDuyet(m); } });
  $('dvChon').replaceChildren(el('label', { textContent: 'Lớp' }), lop, el('label', { textContent: 'Học sinh' }), ten, eng);
  $('dvChon').hidden = false;
  moDuyet(m);
}
/** The Sheet works out the bill after the row is written, so the card opens once the row is ready. */
async function moThiepMoi(m) {
  const wait = ms => new Promise(ok => setTimeout(ok, ms));
  for (let k = 0; k < 5; k++) {
    if (k) await wait(15000);
    await loadMoves();
    const it = moves && moves.due.find(x => x.tab === L.NEW_TAB && x.cls === m.to && L.clean(x.name) === L.clean(m.name));
    if (it && it.problem) return notice('Đã thêm ' + m.name + ' nhưng Sheet chưa tính được tiền: ' + (it.reason || 'bạn xem ở mục Cần thu.'), true);
    if (it && it.qr) { notice('Đã thêm ' + m.name + '. Khi kịp, nhớ cập nhật Theo dõi toàn diện.'); if (view === 'moves') moThiep(it); return; }
  }
  notice('Đã thêm ' + m.name + '. Sheet chưa tính xong tiền, đợi 1–2 phút rồi bấm Tải lại, thiệp sẽ ở mục Cần thu. Khi kịp, nhớ cập nhật Theo dõi toàn diện.');
}
/** A leaver or transfer chosen by hand: the same dialog as an approval, with the student picked here. */
function moThem() {
  const m = { manual: true, id: 'tay', kind: 'nghi', name: '', eng: '', from: '', to: '', row: 0, at: Date.now(), blocks: null, rows: [] };
  const other = () => el('option', { value: '', textContent: 'Chọn lớp' });
  const lop = (id, label, on) => { const sel = el('select', { id, 'aria-label': label, onchange: e => on(e.target.value) }, [other()].concat(classes.map(n => el('option', { value: n, textContent: n })))); return sel; };
  const hs = el('select', { id: 'dvHs', 'aria-label': 'Học sinh', disabled: true, onchange: () => chonHs() }, [el('option', { value: '', textContent: 'Chọn lớp trước' })]);
  const ten = el('input', { id: 'dvTenTay', placeholder: 'Họ tên', 'aria-label': 'Họ tên', hidden: true, oninput: e => { const had = !!m.name; m.name = e.target.value.trim(); if (had !== !!m.name) veDuyet(m); else if (m.name) $('dvTen').textContent = KIND[m.kind] + ': ' + fullName(m); } });
  const eng = el('input', { id: 'dvEngTay', placeholder: 'Tên tiếng Anh', 'aria-label': 'Tên tiếng Anh', hidden: true, oninput: e => { m.eng = e.target.value.trim(); } });
  let items = [];
  const chonHs = () => {
    const v = hs.value, khac = v === 'khac', it = !khac && v !== '' ? items[Number(v)] : null;
    ten.hidden = eng.hidden = !khac;
    m.name = it ? it.name : khac ? ten.value.trim() : ''; m.eng = it ? String(it.eng || '') : khac ? eng.value.trim() : ''; m.row = it ? it.row : 0;
    veDuyet(m);
  };
  const tuLop = lop('dvTu', 'Lớp đang học', async name => {
    m.from = name; m.name = ''; m.eng = ''; m.row = 0; items = []; ten.hidden = eng.hidden = true;
    hs.replaceChildren(el('option', { value: '', textContent: name ? 'Đang đọc danh sách…' : 'Chọn lớp trước' })); hs.disabled = true; veDuyet(m);
    if (!name) return;
    const c = store.get('hp_cls_' + name);
    try { items = c ? c.data.items : (await readClass(name)).items; } catch (e) { items = []; }
    if (m.from !== name) return;
    hs.replaceChildren(el('option', { value: '', textContent: 'Chọn học sinh' }), ...items.map((x, k) => el('option', { value: String(k), textContent: fullName(x) })), el('option', { value: 'khac', textContent: 'Em chưa có tên trong danh sách…' }));
    hs.disabled = false;
  });
  const denLop = lop('dvDen', 'Chuyển đến lớp', name => { m.to = name; veDuyet(m); });
  const denWrap = el('div', { hidden: true }, [el('label', { textContent: 'Chuyển đến lớp' }), denLop]);
  const loai = el('select', { id: 'dvLoai', 'aria-label': 'Việc', onchange: e => { m.kind = e.target.value; denWrap.hidden = m.kind !== 'chuyen'; veDuyet(m); } },
    [el('option', { value: 'nghi', textContent: 'Nghỉ học' }), el('option', { value: 'chuyen', textContent: 'Chuyển lớp' })]);
  $('dvChon').replaceChildren(el('label', { textContent: 'Việc' }), loai, el('label', { textContent: 'Lớp đang học' }), tuLop, el('label', { textContent: 'Học sinh' }), hs, ten, eng, denWrap);
  $('dvChon').hidden = false;
  moDuyet(m);
}
function moDuyet(m) {
  if (!m.manual) { $('dvChon').hidden = true; $('dvChon').replaceChildren(); }
  dvMove = m; dvHist = null; dvBookList = ['']; veSachDuyet(m);
  $('dvDate').value = isoOf(m.at); $('dvDate').max = '';
  $('dvDate').onchange = () => { if (m.kind === 'nghi' && dvHist) capNhatNghi(m); };
  $('duyet').dataset.id = m.id; dvSeen = '';
  veDuyet(m);
  $('duyet').showModal();
}
/** Everything in the dialog that follows from who and where, drawn again whenever a hand-picked move changes. */
function veDuyet(m) {
  const cls = m.kind === 'nghi' ? m.from : m.to, moiTay = m.manual && m.kind === 'moi', ready = moiTay ? !!m.name && !!m.to : !!m.name && !!m.from && (m.kind !== 'chuyen' || !!m.to) || !m.manual;
  $('dvTen').textContent = m.manual ? (m.name ? KIND[m.kind] + ': ' + fullName(m) : moiTay ? 'Thêm học sinh mới' : 'Thêm nghỉ hoặc chuyển lớp') : KIND[m.kind] + ': ' + fullName(m);
  $('dvRoute').textContent = !ready ? '' : m.kind === 'chuyen' ? m.from + ' → ' + m.to : cls;
  $('dvDateLabel').textContent = m.kind === 'moi' ? 'Ngày vào lớp' : m.kind === 'chuyen' ? 'Ngày chuyển' : 'Ngày nghỉ';
  $('dvAcc').textContent = m.kind === 'nghi' ? 'Thu vào tài khoản: ' + L.EXIT_ACCOUNT : '';
  $('dvErr').textContent = '';
  $('dvLuu').hidden = false; $('dvLuu').disabled = false; $('dvLuu').className = 'primary'; $('dvKhongThu').hidden = true; $('dvLuu').textContent = moiTay ? 'Thêm và tạo tin nhắn' : 'Thêm vào danh sách thu';
  $('dvStatus').textContent = m.manual && !ready ? (moiTay ? 'Chọn lớp, nhập họ tên rồi điền ngày.' : 'Chọn đủ ở trên rồi điền ngày.') : ''; dvHist = null;
  if (m.kind === 'nghi' && ready) {
    $('dvStatus').textContent = 'Đang xem em đã đóng đợt đó chưa…';
    $('dvLuu').disabled = true;
    const q = L.quote(m.from), who = m.name + '|' + m.from + '|' + m.kind, wanted = [q + '!J18:N36'].concat(m.manual && m.row ? [q + '!F382:BM382', q + '!F' + m.row + ':BM' + m.row] : []);
    batchGet(wanted).then(got => {
      if ($('duyet').dataset.id !== m.id || m.name + '|' + m.from + '|' + m.kind !== who) return;
      if (m.manual) m.blocks = m.row ? L.blocksOf(got[1], got[2]) : null;
      dvHist = got[0]; capNhatNghi(m);
    }).catch(() => { dvHist = []; capNhatNghi(m); });
  }
  // Preselect what the student already has in the class they come from or go to.
  // A typed new student has nothing to preselect, and each keystroke must not wipe a discount already chosen.
  const seen = moiTay ? 'moi' : m.from + '|' + m.to + '|' + m.name;
  if (seen !== dvSeen) {
    dvSeen = seen;
    const c = store.get('hp_cls_' + (m.from || m.to)), had = c && c.data.items.find(x => x.name === m.name && String(x.eng || '') === String(m.eng || ''));
    dvDisc = discPicker(had ? had.disc : ''); $('dvDisc').replaceChildren(dvDisc.node);
  }
}
let dvHist = null, dvBookList = [''], dvDisc = null, dvMove = null, dvSeen = '';
/** Books are optional for every kind of move: one box, "+ Thêm sách" up to the 5 columns the tabs have. */
function veSachDuyet(m) {
  const list = bookList || [], price = name => (list.find(b => b.name === name) || { price: 0 }).price;
  const sum = dvBookList.reduce((a, n) => a + price(n), 0), wrap = $('dvBooks');
  wrap.replaceChildren(...dvBookList.map((value, k) => el('select', { 'aria-label': 'Sách ' + (k + 1), onchange: e => { dvBookList[k] = e.target.value; veSachDuyet(m); } },
    [el('option', { value: '', textContent: k === 0 ? 'Không có sách' : '(trống)' })].concat(list.map(b => el('option', { value: b.name, textContent: b.name + (b.price ? ' · ' + L.fmt(b.price) + ' đ' : ''), selected: b.name === value }))))));
  if (dvBookList.length < 5) wrap.append(el('button', { class: 'act', type: 'button', textContent: '+ Thêm sách', onclick: () => { dvBookList.push(''); veSachDuyet(m); } }));
  if (sum) wrap.append(el('div', { class: 'sub', textContent: 'Tiền sách ' + L.fmt(sum) + ' đ' }));
  if (m.kind === 'nghi' && dvHist) capNhatNghi(m);
}
const isoToText = iso => { const [y, m, d] = String(iso).split('-'); return iso ? d + '/' + m + '/' + y : ''; };
/** Shows what the leaving date means for this student, and which action comes first. */
function capNhatNghi(m) {
  const r = L.leaveStatus(dvHist, m.blocks, isoToText($('dvDate').value)), dot = r.dot ? 'Đợt ' + r.dot : 'đợt này';
  const lich = r.noSchedule ? ' Lịch đợt này chưa có trong lớp nên Sheet sẽ báo cần kiểm tra. Sau khi thêm, vào mục Cần thu bấm "Tính theo Schedule".' : '';
  const coSach = dvBookList.some(Boolean);
  $('dvKhongThu').hidden = false; $('dvLuu').hidden = false; $('dvLuu').disabled = false; $('dvLuu').className = ''; $('dvKhongThu').className = '';
  $('dvKhongThu').textContent = coSach ? 'Đã đóng, chỉ thu tiền sách' : 'Đã đóng, không thu';
  if (r.state === 'da-dong') {
    $('dvStatus').textContent = 'Ngày này thuộc ' + dot + ', em đã đóng học phí.' + (coSach ? ' Chỉ thu tiền sách đã chọn.' : ' Không thu gì thêm.');
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
  const m = dvMove; if (!m) return;
  // A hand-picked leaver has no roster event to mark, so a row with no tuition records that nothing is owed.
  if (m.manual || dvBookList.some(Boolean)) return luuDuyet(true);
  $('dvErr').textContent = 'Đang lưu…';
  try {
    await batchWrite(m.rows.map(r => ({ range: "'_BIEN_DONG_HS'!H" + r, values: [['khong-thu']] })));
    $('duyet').close(); await loadMoves(); notice('Đã ghi nhận ' + m.name + ' nghỉ, không thu thêm.');
  } catch (e) { $('dvErr').textContent = 'Không lưu được: ' + e.message; }
}
async function luuDuyet(onlyBooks) {
  const m = dvMove; if (!m) return;
  const iso = $('dvDate').value, moiTay = m.manual && m.kind === 'moi';
  if (moiTay) {
    if (!m.to || !m.name) { $('dvErr').textContent = 'Hãy chọn lớp và nhập họ tên.'; return; }
    const had = (moves.news || []).find(r => r && r[1] === m.to && L.clean(r[2]) === L.clean(m.name));
    if (had && !confirm(fullName(m) + ' đã có dòng học sinh mới ở ' + m.to + (had[4] ? ' ngày ' + had[4] : '') + '. Vẫn thêm dòng mới?')) return;
    const c = store.get('hp_cls_' + m.to), inClass = c && c.data.items.find(x => L.clean(x.name) === L.clean(m.name));
    if (!had && inClass && !confirm(fullName(inClass) + ' đã có trong danh sách ' + m.to + '. Vẫn thêm là học sinh mới?')) return;
  } else if (m.manual) {
    if (!m.from || !m.name) { $('dvErr').textContent = 'Hãy chọn lớp và học sinh.'; return; }
    if (m.kind === 'chuyen' && (!m.to || m.to === m.from)) { $('dvErr').textContent = 'Hãy chọn lớp chuyển đến, khác lớp đang học.'; return; }
    const same = (moves.exits || []).find(r => r && L.clean(r[1]) === L.clean(m.name) && String(r[23] || '') === m.from && String(r[5] || '') === (m.kind === 'chuyen' ? 'Chuyển lớp' : 'Nghỉ học'));
    if (same && !confirm(fullName(m) + ' đã có dòng ' + same[5] + ' từ ' + m.from + (same[7] ? ' ngày ' + same[7] : '') + '. Vẫn thêm dòng mới?')) return;
  }
  if (!iso) { $('dvErr').textContent = 'Hãy chọn ngày.'; return; }
  const [y, mo, d] = iso.split('-');
  let disc;
  try { disc = dvDisc ? dvDisc.read() : ''; } catch (e) { $('dvErr').textContent = e.message; return; }
  const input = L.moveInputs(m, { date: d + '/' + mo + '/' + y, books: dvBookList.filter(Boolean), onlyBooks: onlyBooks === true, disc });
  $('dvErr').textContent = 'Đang lưu…'; $('dvLuu').disabled = true;
  try {
    await ghiDongMoi(input);
    $('duyet').close();
    if (moiTay && !L.free({ disc })) {
      notice('Đã ghi ' + m.name + ', đang chờ Sheet tính tiền để tạo thiệp…');
      $('dvLuu').disabled = false;
      return moThiepMoi(m);
    }
    await loadMoves();
    notice('Đã thêm ' + m.name + ' vào tab ' + input.tab + '. Nếu chưa thấy số tiền ở mục Cần thu, đợi 1–2 phút rồi bấm Tải lại.' + (m.manual ? ' Khi kịp, nhớ cập nhật Theo dõi toàn diện.' : ''));
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
    if (!/^=/.test(String(v)) || input.cells[L.colA1(c + 1)] !== undefined || (input.noCopy || []).includes(L.colA1(c + 1))) return;
    requests.push({ copyPaste: { source: { sheetId, startRowIndex: source - 1, endRowIndex: source, startColumnIndex: c, endColumnIndex: c + 1 },
      destination: { sheetId, startRowIndex: target - 1, endRowIndex: target, startColumnIndex: c, endColumnIndex: c + 1 }, pasteType: 'PASTE_FORMULA' } });
  });
  // The last row can hold typed values where formulas belong (a leaver's I, M, N, O; a pasted HS MỚI row with no account), so the new row takes those from the last row that has one.
  const typed = (input.tab === L.NEW_TAB ? [0, 6, 7, 13, 14, 15, 18, 19, 20] : [8, 12, 13, 14]).filter(c => input.cells[L.colA1(c + 1)] === undefined && !/^=/.test(String((rowFormulas[0] || [])[c])));
  if (typed.length) {
    const first = Math.max(input.firstDataRow, source - 30), [all] = await batchGet([tab + '!A' + first + ':X' + source], 'FORMULA');
    typed.forEach(c => {
      let from = -1; all.forEach((r, k) => { if (/^=/.test(String((r || [])[c]))) from = k; });
      if (from >= 0) requests.push({ copyPaste: { source: { sheetId, startRowIndex: first + from - 1, endRowIndex: first + from, startColumnIndex: c, endColumnIndex: c + 1 },
        destination: { sheetId, startRowIndex: target - 1, endRowIndex: target, startColumnIndex: c, endColumnIndex: c + 1 }, pasteType: 'PASTE_FORMULA' } });
    });
  }
  if (requests.length) await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) }, 2);
  const fill = v => typeof v === 'string' ? v.replace(/{r}/g, target) : v;
  await batchWrite(Object.keys(input.cells).filter(c => input.cells[c] !== '').map(c => ({ range: tab + '!' + c + target, values: [[fill(input.cells[c])]] })));
}
async function boQuaMove(m) {
  if (!confirm('Bỏ qua ' + fullName(m) + '? App sẽ không nhắc lại thay đổi này.')) return;
  try { await batchWrite(m.rows.map(r => ({ range: "'_BIEN_DONG_HS'!H" + r, values: [['bo-qua']] }))); await loadMoves(); }
  catch (e) { notice('Không lưu được: ' + e.message, true); }
}
function stat(value, label, alert) { return el('div', { class: alert ? 'stat card alert' : 'stat card' }, [el('b', { textContent: value }), el('span', { textContent: label })]); }

const classRows = () => classes.map(name => { const c = store.get('hp_cls_' + name); return { name, data: c && c.data }; });
const updatedText = () => { const at = store.get('hp_all_at'); return loadingAll ? 'Đang cập nhật ' + loadedCount + ' / ' + loadTotal + ' lớp, vẫn bấm vào lớp được…' : at ? 'Cập nhật lúc ' + new Date(at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : 'Chưa đọc đủ các lớp'; };
const updateButton = () => el('button', { class: 'act', textContent: loadingAll ? 'Đang cập nhật…' : 'Cập nhật tất cả', disabled: loadingAll, onclick: () => loadAll() });
function tile(value, label, alert, onclick) {
  return el('button', { class: alert && value ? 'tile alert' : 'tile', onclick }, [el('b', { textContent: String(value) }), el('span', { textContent: label })]);
}
function goTo(name) { view = name; $('lop').value = ''; notice(''); window.scrollTo(0, 0); render(); }
const DUE_DOT = 'bien-dong'; // sent log's đợt column for new, transfer and leaving rows
const dueCls = it => it.cls || it.tab;
const dueMark = it => (sentIdx[dueCls(it) + '|' + DUE_DOT] || {})[it.key];
/** Classes due for collection with someone not ticked as sent. left is null until the class has been read. */
function chuaDanhDau() {
  const out = [], calOf = name => (cal ? cal.list : []).find(x => x.tab === name), dueNow = x => x.group === 'den' || x.group === 'qua';
  classes.forEach(name => {
    const c = store.get('hp_cls_' + name), x = calOf(name);
    if (!c) { if (x && dueNow(x) && !ackMap[L.ackKey(x.tab, x.dot)]) out.push({ x, total: 0, left: null }); return; }
    // The class's own đợt: one the calendar has not called due yet is not late, an older one still running is.
    const dot = String(c.data.dot), same = x && x.dot === dot ? x : null;
    if ((same && !dueNow(same)) || ackMap[L.ackKey(name, dot)]) return;
    const unpaid = phaiGui(c.data), left = L.notMarked(unpaid, sentIdx[name + '|' + dot]);
    if (left.length) out.push({ x: { tab: name, dot, due: same ? same.due : ackDue[L.ackKey(name, dot)] || '' }, total: unpaid.length, left });
  });
  return out;
}
/** Students a message should have gone to: owing, with something to say to them. */
const phaiGui = data => data.items.filter(y => canThu(y) && !y.trong && y.amount > 0);
/** Ticked as sent, for the class or for everyone still owing: this đợt needs nothing more from the top of the page. */
function daGuiHet(x) {
  if (ackMap[L.ackKey(x.tab, x.dot)]) return true;
  const c = store.get('hp_cls_' + x.tab);
  return !!c && String(c.data.dot) === x.dot && !L.notMarked(phaiGui(c.data), sentIdx[x.tab + '|' + x.dot]).length;
}
/** Who to remind again in one class: on the class's own đợt, so a class that has rolled over still counts. */
function nhacCua(data) {
  const key = L.ackKey(data.tab, data.dot);
  return L.remindDue(data.items.filter(x => !daRoi(x)), sentIdx[data.tab + '|' + data.dot], L.dayNow(new Date()), ackMap[key] ? L.dayOf(ackDue[key]) : NaN);
}
const nhacLaiRows = () => classRows().filter(r => r.data).map(r => ({ data: r.data, list: nhacCua(r.data) })).filter(r => r.list.length);
const ngayNgan = n => L.dayText(n).slice(0, 5);
const nhacText = r => (r.guess ? 'từ hạn thu ' : r.lan ? 'nhắc lần ' + r.lan + ' ' : 'gửi ') + ngayNgan(r.from) + ', ' + r.days + ' ngày';
function nhacLaiPanel(rows) {
  const names = list => el('div', { class: 'names' }, list.map(r => el('span', { class: r.onCycle ? 'name due' : 'name', title: nhacText(r) }, [fullName(r.item), el('small', { textContent: nhacText(r) })])));
  const plain = list => el('div', { class: 'names' }, list.map(r => el('span', { class: r.onCycle ? 'name due' : 'name', textContent: fullName(r.item) })));
  const line = c => {
    const clear = c.list.filter(r => !r.blank), dated = c.list.filter(r => r.blank && !r.guess), old = c.list.filter(r => r.blank && r.guess);
    return el('div', { class: 'row card' }, [
      el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: c.data.tab }), el('span', { class: 'sub', textContent: 'Đợt ' + c.data.dot + ' · ' + c.list.length + ' em' })]),
      clear.length ? el('div', { class: 'sub group', textContent: 'Chưa nộp' }) : '', clear.length ? names(clear) : '',
      dated.length ? el('div', { class: 'sub group', textContent: 'Chưa ghi, xem sao kê trước' }) : '', dated.length ? names(dated) : '',
      old.length ? el('div', { class: 'sub group', textContent: 'Chưa ghi, xem sao kê trước (' + nhacText(old[0]) + ')' }) : '', old.length ? plain(old) : '',
      el('div', { class: 'r2' }, [el('div', { class: 'fill' }),
        clear.length ? el('button', { class: 'quiet', textContent: 'Đã nhắc lại ' + clear.length + ' em chưa nộp', onclick: () => {
          if (!confirm('Ghi đã nhắc lại ' + clear.length + ' em chưa nộp lớp ' + c.data.tab + ' hôm nay? Sau ' + L.REMIND_EVERY + ' ngày chưa nộp sẽ cảnh báo tiếp.')) return;
          logSent(c.data.tab, c.data.dot, clear.map(r => r.item), 'nhac-lai'); render(); } }) : '',
        el('button', { class: 'act', textContent: 'Thu tiền', onclick: () => { tab = 'thu'; filter = 'xem'; openClass(c.data.tab); } }),
        el('button', { class: 'act', textContent: 'Gửi Zalo', onclick: () => { tab = 'zalo'; filter = 'can'; openClass(c.data.tab); loadSent(); } })])]);
  };
  const all = rows.reduce((n, c) => n + c.list.length, 0), blank = rows.reduce((n, c) => n + c.list.filter(r => r.blank).length, 0);
  return [el('h2', { class: 'section', id: 'nhacLai', textContent: 'Gửi đã ' + L.REMIND_AFTER + ' ngày, chưa thấy nộp (' + (all - blank) + ' chưa nộp, ' + blank + ' chưa ghi)' }),
    el('p', { class: 'sub', style: 'margin-bottom:8px', textContent: 'Tên tô màu là hôm nay đến lượt. Nhắc xong bấm "Đã nhắc lại", ' + L.REMIND_EVERY + ' ngày sau chưa nộp app cảnh báo tiếp. Chưa ghi có thể đã nộp, xem sao kê rồi tick.' }),
    el('div', { class: 'fee-list' }, rows.map(line))];
}
function nhacPanel(rows, due) {
  const line = r => el('div', { class: 'row card' }, [
    el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: r.x.tab }), el('span', { class: 'sub', textContent: 'Thu đợt ' + r.x.dot + (r.x.due ? ', hạn ' + r.x.due : '') })]),
    !r.left ? el('div', { class: 'sub', style: 'margin-top:4px', textContent: 'Chưa tick đã gửi cả lớp.' }) : el('div', {}, [el('div', { class: 'sub group', textContent: r.left.length + '/' + r.total + ' em chưa tick' }),
      el('div', { class: 'names' }, r.left.map(y => el('span', { class: 'name', textContent: fullName(y) + (chuaGhi(y) ? ' · chưa ghi nộp' : '') })))]),
    el('div', { class: 'r2' }, [el('div', { class: 'fill' }),
      el('button', { class: 'quiet', textContent: 'Đã gửi cả lớp', onclick: () => { if (confirm('Ghi đã gửi tin đợt ' + r.x.dot + ' cho cả lớp ' + r.x.tab + '?')) markClass(r.x.tab, r.x.dot, r.x.due, true); } }),
      el('button', { class: 'act', textContent: 'Mở Gửi Zalo', onclick: () => { tab = 'zalo'; filter = 'can'; openClass(r.x.tab); loadSent(); } })])]);
  const dueLine = it => el('div', { class: 'row card' }, [
    el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: fullName(it) }), el('span', { class: 'sub', textContent: KIND[it.kind] + ' · ' + it.cls })]),
    el('div', { class: 'r2' }, [el('div', { class: 'fill' }), el('button', { class: 'act', textContent: 'Xem ở Biến động', onclick: () => goTo('moves') })])]);
  return [el('h2', { class: 'section', id: 'nhacGui', textContent: 'Rà soát: chưa tick đã gửi Zalo (' + rows.reduce((n, r) => n + (r.left ? r.left.length : 0), 0) + ' em ở ' + rows.length + ' lớp' + (due.length ? ', ' + due.length + ' dòng Biến động' : '') + ')' }),
    el('p', { class: 'sub', style: 'margin-bottom:8px', textContent: 'Đã gửi rồi thì tick để hết nhắc. Chưa gửi thì mở lớp gửi nốt.' }),
    el('div', { class: 'fee-list' }, rows.map(line).concat(due.map(dueLine)))];
}
function renderHome(box) {
  const known = classRows().filter(r => r.data).map(r => summarize(r.data)), add = f => known.reduce((n, s) => n + f(s), 0);
  const blankAll = add(s => s.blank), blankOwe = add(s => s.blankOwe), owe = add(s => s.owe), flagged = add(s => s.warn);
  const list = cal ? cal.list : [], allNow = list.filter(x => x.group === 'den' || x.group === 'qua'), allSoon = list.filter(x => x.group === 'sap');
  const now = allNow.filter(x => !daGuiHet(x)), soon = allSoon.filter(x => !daGuiHet(x)), sentDone = allNow.concat(allSoon).filter(daGuiHet);
  const nhacLai = sentAt || sentRows.length ? nhacLaiRows() : [];
  const notSent = chuaDanhDau(), dueUnsent = moves ? moves.due.filter(it => !it.problem && !dueMark(it)) : [], moveCount = moves ? moves.list.filter(m => !m.wait).length + moves.due.length : 0;
  box.append(
    el('div', { class: 'page-title' }, [
      el('div', {}, [el('h1', { textContent: 'Việc cần làm' }), el('div', { class: 'sub', textContent: updatedText() })]),
      el('div', { class: 'add-btns' }, [el('button', { class: 'act', textContent: 'Thêm học sinh mới', onclick: async () => { goTo('moves'); if (!moves) await loadMoves(); if (moves) moThemMoi(); } }), updateButton()])]),
    el('div', { class: 'tiles' }, [
      tile(now.length, 'Lớp đến hạn thu', true, openCal),
      tile(notSent.reduce((n, r) => n + (r.left ? r.left.length : 1), 0) + dueUnsent.length, 'Chưa tick đã gửi Zalo', true, () => { const s = $('nhacGui'); if (s) s.scrollIntoView({ behavior: 'smooth' }); }),
      tile(nhacLai.reduce((n, c) => n + c.list.length, 0), 'Gửi quá ' + L.REMIND_AFTER + ' ngày chưa thấy nộp', true, () => { const s = $('nhacLai'); if (s) s.scrollIntoView({ behavior: 'smooth' }); }),
      tile(soon.length, 'Lớp sắp thu', false, openCal),
      tile(blankAll, 'Em chưa ghi nộp', false, () => { lopFilter = 'ghi'; goTo('lop'); }),
      tile(moveCount, 'Biến động cần xử lý', true, () => { goTo('moves'); if (!moves || Date.now() - moves.at > FRESH_MS) loadMoves(); }),
      tile(tutorViec().left.length, 'Tutor chưa thu', true, openTutor)]),
    el('div', { class: 'stats' }, [stat(L.fmt(owe - blankOwe) + ' đ', 'Đã rõ chưa nộp'), stat(L.fmt(blankOwe) + ' đ', 'Chưa ghi, có thể đã nộp'), stat(String(flagged), 'Số tiền cần xem lại', flagged > 0)]));
  if (!tutor && !tutorLoading) loadTutor();
  const tutorNhac = tutorViec().nhac;
  if (tutorNhac.length) box.append(el('div', { class: 'warn-line', style: 'margin:0 0 12px' }, ['Tutor: ' + tutorNhac.length + ' em gửi quá ' + L.REMIND_AFTER + ' ngày chưa thấy nộp.', el('button', { class: 'quiet', textContent: 'Xem', onclick: openTutor })]));
  if (notSent.length || dueUnsent.length) box.append(...nhacPanel(notSent, dueUnsent));
  if (nhacLai.length) box.append(...nhacLaiPanel(nhacLai));
  if (now.length) box.append(el('h2', { class: 'section', id: 'canLam', textContent: 'Đến hạn thu (' + now.length + ')' }), el('div', { class: 'classes' }, now.map(calRow)));
  if (soon.length) box.append(el('h2', { class: 'section', textContent: 'Sắp thu (' + soon.length + ')' }), el('div', { class: 'classes' }, soon.map(calRow)));
  if (!now.length && !soon.length) box.append(el('div', { class: 'empty', textContent: cal ? 'Không còn lớp nào đang chờ gửi tin.' : 'Đang đọc lịch thu…' }));
  if (sentDone.length) box.append(el('details', { class: 'hist' }, [el('summary', { textContent: 'Đã gửi tin (' + sentDone.length + ' lớp)' }), el('div', { class: 'classes' }, sentDone.map(calRow))]));
}
/* ---------- Tutor: its own file and page, counted from the Schedule ---------- */
let tutor = null, tutorLoading = false, tutorMonth = '', tutorOpen = '', tutorFilter = '', tutorShown = [], tutorCopied = '', tutorQueue = Promise.resolve();
async function loadTutor(force) {
  if (tutorLoading || (!force && tutor && !tutor.error && Date.now() - tutor.at < FRESH_MS)) return;
  tutorLoading = true; if (view === 'tutor') render();
  try {
    const [gia, thu] = await batchGetAt(TUTOR_API, ['Gia!A2:F', 'ThuTien!A2:O']);
    let sessions = tutor && tutor.sessions, weeks = tutor && tutor.weeks, schedAt = tutor && tutor.schedAt;
    // The weeks are the slow part and rarely change, so they wait 30 minutes unless someone presses update.
    if (force || !sessions || Date.now() - schedAt > 1800000) {
      const first = L.dayOf('01/09/2026'), meta = await api(SCHEDULE_API + '?fields=sheets.properties.title');
      weeks = meta.sheets.map(s => s.properties.title).map(title => {
        const m = title.match(/^(\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})$/);
        return m ? { title, from: L.dayOf(m[1]), to: L.dayOf(m[2]) } : null;
      }).filter(w => w && w.to >= first);
      sessions = [];
      for (let k = 0; k < weeks.length; k += 5) {
        const part = weeks.slice(k, k + 5);
        const got = await batchGetAt(SCHEDULE_API, part.reduce((a, w) => a.concat(['A30:E320', 'M30:M320', 'A30:G60'].map(r => L.quote(w.title) + '!' + r)), []));
        part.forEach((w, n) => { L.tutorSessions(got[n * 3], got[n * 3 + 1], got[n * 3 + 2]).filter(s => s.day >= w.from && s.day <= w.to && s.day >= first).forEach(s => sessions.push(s)); });
      }
      schedAt = Date.now();
    }
    tutor = { gia, thu, sessions, weeks, schedAt, at: Date.now() };
    store.set('hp_tutor', tutor);
  } catch (e) {
    if (tutor && !tutor.error) notice('Chưa đọc được dữ liệu tutor mới: ' + e.message, true);
    else tutor = { error: 'Chưa đọc được dữ liệu tutor: ' + e.message };
  }
  tutorLoading = false; if (view === 'tutor' || (view === 'home' && !homeBusy())) render();
}
function openTutor() { goTo('tutor'); loadBooks(); loadTutor(); }
const tutorMonthItems = month => L.tutorItems({ sessions: tutor.sessions, gia: tutor.gia, thu: tutor.thu, month, today: L.dayNow(new Date()) });
const tutorMarks = items => { const o = {}; items.forEach(x => { if (x.sentAt) o[x.key] = { at: x.sentAt, lan: x.lan }; }); return o; };
const tutorCanThu = x => !x.mien && !x.paid && (x.count > 0 || x.bookSum > 0 || x.own > 0);
/** Across every finished month: bills still to collect, and those whose reminder is due. Empty until the data has loaded. */
function tutorViec() {
  if (!tutor || tutor.error) return { left: [], nhac: [] };
  const today = L.dayNow(new Date()), all = L.tutorMonths(today).reduce((a, m) => a.concat(tutorMonthItems(m)), []).filter(x => x.finished && tutorCanThu(x));
  return { left: all, nhac: L.remindDue(all, tutorMarks(all), today, NaN) };
}
const tutorNow = () => L.dayText(L.dayNow(new Date())) + ' ' + new Date().toTimeString().slice(0, 5);
const tutorKeep = what => { tutorQueue = tutorQueue.then(what).catch(e => { notice('Không lưu được dữ liệu tutor: ' + e.message, true); return loadTutor(true); }); };
const tutorWrite = data => api(TUTOR_API + '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) }, 2);
const tutorAppend = (range, row) => api(TUTOR_API + '/values/' + range + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: [row] }) }, 2);
/** Shows the change at once and saves behind it, in order, so a second tick cannot overtake the first. */
function tutorLuu(it, change) {
  const row = L.tutorRecord(it, change, who, tutorNow()), at = tutor.thu.findIndex(r => r && r[0] === it.key);
  if (at >= 0) tutor.thu[at] = row; else tutor.thu.push(row);
  store.set('hp_tutor', tutor); render();
  tutorKeep(async () => {
    const k = tutor.thu.findIndex(r => r && r[0] === it.key);
    if (at >= 0) return tutorWrite([{ range: 'ThuTien!A' + (k + 2) + ':O' + (k + 2), values: [row] }]);
    const put = await tutorAppend('ThuTien!A:O', row), m = String(put.updates && put.updates.updatedRange).match(/!A(\d+)/);
    if (m && +m[1] !== k + 2) await loadTutor(true); // someone else added a row at the same moment
  });
}
function tutorLuuGia(name, month, mode, price) {
  const row = [name, month, mode, mode === 'mien' ? '' : price, who, tutorNow()];
  tutor.gia.push(row); store.set('hp_tutor', tutor); render();
  tutorKeep(() => tutorAppend('Gia!A:F', row));
}
function tutorRateText(it) {
  const r = it.rate;
  return !r ? 'Chưa chọn giá' : r.mode === 'mien' ? 'Miễn phí' : L.fmt(r.price) + ' đ/' + (r.mode === 'gio' ? 'giờ' : 'buổi');
}
function tutorDates(it) {
  if (!it.list.length) return el('div', { class: 'sub', textContent: 'Schedule không có buổi nào trong tháng này.' });
  let no = 0;
  return el('ul', { class: 'tt-days' }, it.list.map(s => {
    const later = it.later.includes(s), bad = it.bad.includes(s), counted = !s.off && !later && !bad;
    return el('li', { class: s.off ? 'off' : later ? 'later' : '' }, [
      el('span', { class: 'no', textContent: counted ? String(++no) : '' }),
      el('span', { textContent: L.dayShort(s.day) }), el('span', { textContent: s.time || 'chưa có giờ' }),
      el('span', { class: 'sub', textContent: s.off ? 'Nghỉ, không tính' : later ? 'Sắp học' : bad ? 'Thiếu giờ hoặc giáo viên, chưa tính' : s.teacher })]);
  }));
}
/** The next row in the list on screen, so a run of students can be done without going back to the list. */
function tutorTiep(it) {
  const k = tutorShown.indexOf(it.key);
  tutorOpen = tutorShown[k + 1] || tutorShown[k - 1] || '';
}
function tutorGiaForm(it) {
  const mode = el('select', { 'aria-label': 'Cách tính tiền' }, [['buoi', 'Theo buổi'], ['gio', 'Theo giờ'], ['mien', 'Miễn phí']].map(([v, t]) => el('option', { value: v, textContent: t })));
  mode.value = it.rate ? it.rate.mode : 'buoi';
  const luu = () => {
    const v = L.digits(price.value);
    if (mode.value !== 'mien' && !v) return notice('Hãy nhập số tiền, hoặc chọn Miễn phí.', true);
    notice('');
    if (tutorFilter === 'gia') tutorTiep(it);
    tutorLuuGia(it.name, it.month, mode.value, v);
  };
  const price = el('input', { id: 'ttGia', inputmode: 'numeric', placeholder: 'Số tiền', 'aria-label': 'Đơn giá', value: it.rate && it.rate.price ? String(it.rate.price) : '', onkeydown: e => { if (e.key === 'Enter') luu(); } });
  const used = el('div', { class: 'tutor-line' });
  const fillUsed = () => {
    const count = {};
    tutor.gia.forEach(r => { if (r[2] === mode.value && L.digits(r[3])) count[L.digits(r[3])] = (count[L.digits(r[3])] || 0) + 1; });
    used.replaceChildren(...Object.keys(count).sort((x, y) => count[y] - count[x]).slice(0, 6).map(p => el('button', { class: 'tt-pick', textContent: L.fmt(p), onclick: () => { price.value = p; luu(); } })));
    price.hidden = mode.value === 'mien'; used.hidden = mode.value === 'mien';
  };
  mode.addEventListener('change', fillUsed); fillUsed();
  return el('section', {}, [el('h3', { textContent: 'Giá' }), el('div', { class: 'tutor-line' }, [mode, price, el('button', { class: 'primary', textContent: 'Lưu giá', onclick: luu })]), used,
    el('div', { class: 'sub', textContent: 'Áp dụng từ tháng ' + L.monthText(it.month) + ' trở đi.' })]);
}
function tutorSachForm(it) {
  const pick = el('select', { 'aria-label': 'Chọn sách' }, [el('option', { value: '', textContent: bookList ? 'Chọn sách…' : 'Đang đọc danh mục…' })].concat((bookList || []).map(b => el('option', { value: b.name, textContent: b.name + ' · ' + L.fmt(b.price) }))));
  const price = el('input', { inputmode: 'numeric', placeholder: 'Giá', 'aria-label': 'Giá sách', style: 'width:100px' });
  pick.addEventListener('change', () => { const b = (bookList || []).find(x => x.name === pick.value); price.value = b ? String(b.price) : ''; });
  return el('section', {}, [el('h3', { textContent: 'Sách' }),
    it.book.length ? el('div', { class: 'names' }, it.book.map((b, k) => el('span', { class: 'chip idle' }, [b.name + ' · ' + L.fmt(b.price) + ' ', el('button', { class: 'quiet', style: 'min-height:24px;padding:0 4px', 'aria-label': 'Bỏ ' + b.name, textContent: '×', onclick: () => tutorLuu(it, { book: it.book.filter((x, n) => n !== k) }) })]))) : '',
    el('div', { class: 'tutor-line' }, [pick, price, el('button', { textContent: 'Thêm', onclick: () => {
      if (!pick.value || !L.digits(price.value)) return notice('Hãy chọn sách và giá.', true);
      notice(''); tutorLuu(it, { book: it.book.concat({ name: pick.value, price: L.digits(price.value) }) });
    } })])]);
}
function tutorRiengForm(it) {
  const amt = el('input', { inputmode: 'numeric', placeholder: 'Để trống là tự tính', 'aria-label': 'Số tiền riêng', value: it.own ? String(it.own) : '' });
  const msg = el('textarea', { 'aria-label': 'Tin nhắn riêng', value: it.msg });
  return el('details', { class: 'tt-more', open: !!(it.own || it.riengMsg) }, [el('summary', { textContent: it.own || it.riengMsg ? 'Sửa riêng (đang dùng)' : 'Sửa riêng' }), msg,
    el('div', { class: 'tutor-line' }, [amt, el('button', { textContent: 'Lưu riêng', onclick: () => tutorLuu(it, { own: L.digits(amt.value), riengMsg: msg.value.trim() === it.msg.trim() ? it.riengMsg : msg.value.trim() }) }),
      it.own || it.riengMsg ? el('button', { class: 'quiet', textContent: 'Dùng lại tự động', onclick: () => tutorLuu(it, { own: 0, riengMsg: '' }) }) : ''])]);
}
/** Same steps as a class: copy the card, paste it in Zalo, then come back and say it went. */
async function tutorCopy(it) {
  const blob = thiep(it), done = () => { tutorCopied = it.key; notice('Đã copy thiệp của ' + it.name + ', sang Zalo dán rồi gửi.'); render(); };
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return done(); } catch (e) {
    try {
      const f = new File([await blob], it.name + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return done(); }
    } catch (e2) { /* falls through to the hint */ }
    notice('Không copy được: nhấn giữ hoặc chuột phải vào ảnh thiệp để sao chép.', true);
  }
}
function tutorCard(it) {
  if (it.mien) return '';
  if (!it.qr) return el('section', {}, [el('h3', { textContent: 'Thiệp và mã QR' }), el('div', { class: 'sub', textContent: it.trong ? 'Chọn giá xong sẽ có thiệp và mã QR.' : 'Chưa có số tiền nên chưa có thiệp và mã QR.' })]);
  const img = el('img', { class: 'tt-card', alt: 'Thiệp học phí có mã QR của ' + it.name, onclick: () => moThiep(it) }), st = el('div', { class: 'sub', role: 'status', textContent: 'Đang tạo thiệp…' });
  thiep(it).then(b => { img.src = URL.createObjectURL(b); st.textContent = it.finished ? 'Bấm vào ảnh để xem to.' : 'Tạm tính đến hôm nay, tháng học xong số có thể đổi.'; }).catch(e => { st.textContent = 'Không tạo được thiệp: ' + e.message; });
  return el('section', {}, [el('h3', { textContent: 'Thiệp và mã QR' }), st, img]);
}
/** What can be done with this bill now, biggest step first. */
function tutorActions(it, nhac) {
  const today = L.dayNow(new Date()), acts = [];
  if (it.mien || it.trong) return acts;
  if (!it.finished) return [el('span', { class: 'sub', textContent: 'Tháng này chưa xong, thu ngày ' + L.dayText(L.billDay(it.month)) + '.' })];
  if (it.paid) return [el('span', { class: 'sent', textContent: 'Đã nộp ' + it.paid }), el('button', { class: 'quiet', textContent: 'Hoàn tác', onclick: () => tutorLuu(it, { paid: '' }) })];
  const date = el('input', { type: 'date', 'aria-label': 'Ngày nộp', value: new Date(today * 86400000).toISOString().slice(0, 10) });
  const copied = tutorCopied === it.key && !it.sentAt;
  const markSent = () => { tutorCopied = ''; if (tutorFilter === 'gui') tutorTiep(it); tutorLuu(it, { sentAt: L.dayText(today), by: who }); };
  if (it.qr) acts.push(el('button', { class: it.sentAt ? '' : 'primary', textContent: copied ? (tutorFilter === 'gui' ? 'Đã gửi, sang em tiếp' : 'Đã gửi') : 'Copy thiệp', onclick: () => copied ? markSent() : tutorCopy(it) }), copied ? el('button', { textContent: 'Copy lại', onclick: () => tutorCopy(it) }) : '', el('button', { textContent: 'Copy chữ và QR', onclick: () => navigator.clipboard.writeText(it.msg + '\n\nMã QR chuyển khoản: ' + it.qr).then(() => notice('Đã copy tin của ' + it.name + '.'), () => notice('Không copy được.', true)) }));
  if (!it.sentAt) { if (!copied) acts.push(el('button', { class: 'act', textContent: 'Đánh dấu đã gửi', onclick: markSent })); }
  else if (nhac) acts.push(el('button', { class: 'act', textContent: 'Đã nhắc lại', onclick: () => { if (tutorFilter === 'nhac') tutorTiep(it); tutorLuu(it, { sentAt: L.dayText(today), lan: it.lan + 1, by: who }); } }));
  acts.push(el('span', { class: 'tt-pay' }, [date, el('button', { class: 'act', textContent: 'Đã nộp', onclick: () => { tutorTiep(it); tutorLuu(it, { paid: date.value.split('-').reverse().join('/') }); } })]));
  return acts;
}
function tutorStatus(it, nhac) {
  if (it.mien) return el('span', { class: 'chip idle', textContent: 'Miễn phí' });
  if (it.trong) return el('span', { class: 'chip', textContent: 'Chưa có giá' });
  if (it.paid) return el('span', { class: 'chip ok', textContent: 'Nộp ' + it.paid.slice(0, 5) });
  if (!it.finished) return el('span', { class: 'chip idle', textContent: 'Đang học' });
  if (nhac) return el('span', { class: 'chip', textContent: 'Gửi ' + nhac.days + ' ngày' });
  if (it.sentAt) return el('span', { class: 'chip warn-soft', textContent: 'Gửi ' + it.sentAt.slice(0, 5) });
  return el('span', { class: 'chip', textContent: 'Chưa gửi' });
}
function tutorRow(it, nhac) {
  const open = tutorOpen === it.key, acts = open ? tutorActions(it, nhac) : [];
  const buoi = it.count + ' buổi · ' + L.hoursText(it.minutes), gia = it.trong ? '' : tutorRateText(it);
  return el('div', { class: 'tt-item' + (open ? ' open' : '') }, [
    el('button', { class: 'tt-row', 'aria-expanded': String(open), onclick: () => { tutorOpen = open ? '' : it.key; render(); } }, [
      el('span', { class: 'tt-name', textContent: it.name }), el('span', { class: 'tt-count', textContent: buoi }), el('span', { class: 'tt-rate', textContent: gia }),
      el('span', { class: 'tt-amt', textContent: it.mien || it.trong ? '' : money(it.amount) }), el('span', { class: 'tt-st' }, [tutorStatus(it, nhac)]), el('span', { class: 'tt-arrow', 'aria-hidden': 'true', textContent: open ? '▴' : '▾' })]),
    open ? el('div', { class: 'tt-body' }, [
      it.changed ? el('div', { class: 'warn-line', textContent: 'Lúc ' + (it.paid ? 'thu' : 'gửi') + ' là ' + money(it.amount) + ' (' + it.snapCount + ' buổi), Schedule và giá hiện tính ra ' + money(it.total) + ' (' + it.count + ' buổi).' }) : '',
      it.bad.length ? el('div', { class: 'warn-line', textContent: it.bad.length + ' buổi thiếu giờ hoặc giáo viên trong Schedule nên chưa tính.' }) : '',
      nhac ? el('div', { class: 'warn-line', textContent: 'Gửi đã ' + nhac.days + ' ngày chưa thấy nộp, nên nhắc lại.' }) : '',
      it.sentAt && !it.paid ? el('div', { class: 'sent', textContent: 'Đã gửi ' + it.sentAt + (it.by ? ', ' + it.by : '') + (it.lan ? ', nhắc ' + it.lan + ' lần' : '') + ' ' }, ) : '',
      acts.length ? el('div', { class: 'tt-acts' }, acts) : '',
      it.sentAt && !it.paid ? el('button', { class: 'quiet', textContent: 'Bỏ đánh dấu đã gửi', onclick: () => tutorLuu(it, { sentAt: '', by: '', lan: 0 }) }) : '',
      el('div', { class: 'tt-cols' }, [
        tutorCard(it) || el('section', {}, [el('h3', { textContent: 'Các buổi trong tháng' }), tutorDates(it)]),
        el('div', { class: 'tt-forms' }, [it.mien ? '' : el('section', {}, [el('h3', { textContent: 'Các buổi trong tháng' }), tutorDates(it)]), tutorGiaForm(it), tutorSachForm(it), tutorRiengForm(it)])])]) : '']);
}
function renderTutor(box) {
  box.append(el('div', { class: 'page-title' }, [
    el('div', {}, [el('h1', { textContent: 'Tutor' }), el('div', { class: 'sub', textContent: 'Học xong tháng nào, thu ngày đầu tháng sau.' })]),
    el('button', { class: 'act', textContent: tutorLoading ? 'Đang đọc Schedule…' : 'Cập nhật', disabled: tutorLoading, onclick: () => loadTutor(true) })]));
  if (!tutor) { box.append(el('div', { class: 'empty', textContent: 'Đang đọc các tuần trong Schedule…' })); return; }
  if (tutor.error) { box.append(el('div', { class: 'warn-line', textContent: tutor.error })); return; }
  const today = L.dayNow(new Date()), months = L.tutorMonths(today), done = months.filter(m => L.billDay(m) <= today);
  if (!months.includes(tutorMonth)) tutorMonth = done.length ? done[done.length - 1] : months[months.length - 1];
  const items = tutorMonthItems(tutorMonth), finished = L.billDay(tutorMonth) <= today, billed = items.filter(x => !x.mien && !x.trong);
  const got = billed.filter(x => x.paid), due = billed.filter(tutorCanThu), sum = list => list.reduce((n, x) => n + x.amount, 0);
  const nhacs = {}; L.remindDue(due, tutorMarks(due), today, NaN).forEach(n => { nhacs[n.item.key] = n; });
  box.append(el('div', { class: 'seg tt-months', style: 'grid-template-columns:repeat(' + months.length + ',1fr)' }, months.map(m => el('button', { textContent: 'Tháng ' + m.slice(5) + '/' + m.slice(2, 4), 'aria-pressed': String(m === tutorMonth), onclick: () => { tutorMonth = m; tutorOpen = ''; tutorFilter = ''; render(); } }))));
  box.append(el('div', { class: 'stats' }, [
    stat(L.dayText(L.billDay(tutorMonth)), finished ? 'Ngày thu' : 'Ngày thu, tháng chưa xong'),
    stat(L.fmt(sum(got)) + ' đ', 'Đã thu · ' + got.length + ' em'),
    stat(L.fmt(sum(due)) + ' đ', (finished ? 'Còn phải thu · ' : 'Tạm tính · ') + due.length + ' em', finished && due.length > 0)]));
  const missing = L.tutorMissing(tutor.weeks, tutorMonth, today);
  if (missing.length) box.append(el('div', { class: 'warn-line', style: 'margin:0 0 12px', textContent: 'Schedule chưa có tuần cho ' + missing.length + ' ngày trong tháng, từ ' + L.dayText(missing[0]) + ' đến ' + L.dayText(missing[missing.length - 1]) + '. Số buổi có thể thiếu.' }));
  const noPrice = items.filter(x => x.trong && (x.count > 0 || !finished)), free = items.filter(x => x.mien);
  const groups = (finished ? [
    ['gia', 'Chưa có giá', noPrice], ['nhac', 'Cần nhắc', due.filter(x => nhacs[x.key])], ['gui', 'Chưa gửi', due.filter(x => !x.sentAt)], ['cho', 'Chờ nộp', due.filter(x => x.sentAt && !nhacs[x.key])], ['nop', 'Đã nộp', got],
    ['mien', 'Miễn phí', free], ['khong', 'Không có buổi', items.filter(x => !x.mien && !x.paid && !noPrice.includes(x) && !due.includes(x))]
  ] : [['gia', 'Chưa có giá', noPrice], ['hoc', 'Đang học', billed], ['mien', 'Miễn phí', free]]).filter(g => g[2].length);
  if (!groups.length) { box.append(el('div', { class: 'empty', textContent: 'Schedule không có buổi tutor nào trong tháng này.' })); return; }
  if (!groups.some(g => g[0] === tutorFilter)) tutorFilter = groups[0][0];
  const list = groups.find(g => g[0] === tutorFilter)[2];
  tutorShown = list.map(x => x.key);
  box.append(el('div', { class: 'filters' }, groups.map(g => el('button', { textContent: g[1] + ' ' + g[2].length, 'aria-pressed': String(g[0] === tutorFilter), onclick: () => { tutorFilter = g[0]; tutorOpen = ''; render(); } }))));
  box.append(el('div', { class: 'card tt-list' }, [
    el('div', { class: 'tt-head', 'aria-hidden': 'true' }, [el('span', { textContent: 'Học sinh' }), el('span', { textContent: 'Đã học' }), el('span', { textContent: 'Giá' }), el('span', { class: 'r', textContent: 'Số tiền' }), el('span', { textContent: 'Trạng thái' }), el('span')])
  ].concat(list.map(x => tutorRow(x, nhacs[x.key])))));
  // Typing the price straight away is the common case; keep the open row in view after the list changes.
  setTimeout(() => { const o = document.querySelector('.tt-item.open'); if (!o) return; o.scrollIntoView({ block: 'nearest' }); const p = $('ttGia'); if (p && tutorFilter === 'gia' && !p.hidden) p.focus(); }, 0);
}
let lopFilter = 'all';
function renderLop(box) {
  const rows = classRows();
  box.append(el('div', { class: 'page-title' }, [
    el('div', {}, [el('h1', { textContent: 'Các lớp' }), el('div', { class: 'sub', textContent: updatedText() })]), updateButton()]));
  const pick = (id, label) => el('button', { textContent: label, 'aria-pressed': String(lopFilter === id), onclick: () => { lopFilter = id; render(); } });
  const q = el('input', { class: 'search', type: 'search', value: query, placeholder: 'Tìm lớp, ví dụ KIDS 31', 'aria-label': 'Tìm lớp',
    oninput: e => { query = e.target.value; const g = $('grid'); if (g) fillGrid(g, rows); } });
  const grid = el('div', { class: 'classes', id: 'grid' });
  box.append(q, el('div', { class: 'filters' }, [pick('all', 'Tất cả'), pick('owe', 'Còn phải thu'), pick('ghi', 'Có em chưa ghi')]), grid);
  fillGrid(grid, rows);
}
function fillGrid(grid, rows) {
  const t = query.trim().toLowerCase();
  const keep = r => { if (t && !r.name.toLowerCase().includes(t)) return false; if (lopFilter === 'all') return true; if (!r.data) return false; const s = summarize(r.data); return lopFilter === 'ghi' ? s.blank > 0 : s.owe > 0; };
  grid.replaceChildren(...rows.filter(keep).map(r => {
    const s = r.data ? summarize(r.data) : null;
    const kids = [el('div', { class: 'top' }, [el('b', { textContent: r.name }), el('small', { textContent: r.data ? 'Đang thu đợt ' + r.data.dot : 'Chưa đọc' })])];
    if (s) {
      kids.push(el('div', { class: 'track', role: 'img', 'aria-label': 'Đã nộp ' + s.paid + ' trên ' + s.total }, [el('i', { style: 'width:' + (s.total ? Math.round(s.paid / s.total * 100) : 0) + '%' })]));
      const low = [el('span', {}, ['Đã nộp ', el('strong', { textContent: s.paid + '/' + s.total })]), el('span', {}, ['Còn ', el('strong', { textContent: money(s.owe) || '0 đ' })])];
      if (s.blank) low.push(el('span', { class: 'note', textContent: s.blank + ' em chưa ghi' }));
      if (s.warn) low.push(el('span', { class: 'flag', textContent: s.warn + ' em cần xem lại số tiền' }));
      kids.push(el('div', { class: 'low' }, low));
    }
    return el('button', { class: 'class', onclick: () => { tab = 'thu'; filter = 'can'; openClass(r.name); } }, kids);
  }));
}
function renderClass(box) {
  if (!cur) { box.append(el('div', { class: 'empty', textContent: 'Đang tải lớp…' })); return; }
  const s = summarize(cur);
  // The due date belongs to the next đợt once it differs from the one being collected.
  const nextDot = cur.nextDot && String(cur.nextDot) !== String(cur.dot) ? 'đợt ' + cur.nextDot + ' ' : '';
  const meta = ['Đang thu đợt ' + cur.dot, cur.dueDate ? nextDot + 'hạn thu ' + cur.dueDate : '', cur.dueState].filter(Boolean).join(' · ');
  const when = curFresh ? 'Số mới lúc ' + new Date(curAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : 'Số lúc ' + new Date(curAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) + ', đang lấy số mới. Vẫn tick được, còn gửi thiệp thì đợi số mới.';
  box.append(
    el('div', { class: 'class-head card' }, [
      el('div', { class: 'page-title', style: 'margin:0' }, [el('h1', { textContent: cur.tab }), el('span', { class: 'sub', textContent: meta })]),
      el('div', { class: 'track', role: 'img', 'aria-label': 'Đã nộp ' + s.paid + ' trên ' + s.total }, [el('i', { style: 'width:' + (s.total ? Math.round(s.paid / s.total * 100) : 0) + '%' })]),
      el('div', { class: 'nums' }, [el('span', {}, ['Đã nộp ', el('strong', { textContent: s.paid + '/' + s.total })]), el('span', {}, ['Đã thu ', el('strong', { textContent: money(s.got) || '0 đ' })]), el('span', {}, ['Còn phải thu ', el('strong', { textContent: money(s.owe) || '0 đ' })])]),
      el('div', { class: curFresh ? 'sub' : 'hint', style: 'margin-top:6px', textContent: when }),
      classTick()]),
    el('div', { class: 'seg' }, [
      el('button', { textContent: 'Thu tiền', 'aria-pressed': String(tab === 'thu'), onclick: () => { tab = 'thu'; render(); } }),
      el('button', { textContent: 'Gửi Zalo', 'aria-pressed': String(tab === 'zalo'), onclick: () => { tab = 'zalo'; render(); loadSent(); } }),
      el('button', { textContent: 'Đợt học', 'aria-pressed': String(tab === 'dot'), onclick: () => { tab = 'dot'; render(); loadBooks(); loadCal().then(() => loadSchedule()); } })]));
  if (tab === 'zalo') renderZalo(box); else if (tab === 'dot') renderDot(box); else renderThu(box);
}
function classTick() {
  const name = cur.tab, dot = cur.dot, key = L.ackKey(name, dot), mark = (sentIdx[name + '|' + dot] || {})['*'];
  // The due date on the class page belongs to B3, so it only goes with this đợt when they are the same.
  const due = String(cur.nextDot) === String(dot) ? cur.dueDate : '';
  return el('label', { class: 'ack' }, [
    el('input', { type: 'checkbox', checked: !!ackMap[key], onchange: e => markClass(name, dot, due, e.target.checked) }),
    'Đã gửi tin cho cả lớp đợt ' + dot + (ackMap[key] && mark ? ' (' + mark.at + (mark.by ? ', ' + mark.by : '') + ')' : '')]);
}

/* ---------- Đợt học: lessons, books, history ---------- */
let bookList = null, bookDraft = null, bookExtra = {};
const readBookList = rows => rows.filter(r => r[0] && !/^Không thu/.test(r[0])).map(r => ({ name: String(r[0]), price: L.digits(r[1]) }));
async function loadBooks() {
  if (bookList) return;
  try {
    const [rows] = await batchGet(["'DANH_MUC_SACH'!A4:B80"]);
    bookList = readBookList(rows);
    if ((view === 'class' && tab === 'dot') || view === 'tutor') render();
  } catch (e) { notice('Chưa đọc được danh mục sách: ' + e.message, true); }
}
function renderDot(box) {
  if (!cur.history) { box.append(el('div', { class: 'empty', textContent: 'Đang lấy chi tiết đợt, bấm ↻ nếu chưa thấy.' })); return; }
  // Same source as the class's date formula: the previous đợt's history row, with B4 only as the fallback.
  const before = cur.history.find(h => Number(h.dot) === Number(cur.nextDot) - 1), prevEnd = L.dayOf(before && before.to ? before.to : cur.prevEnd);
  const today = L.dayNow(new Date()), off = (sched && sched.offs && sched.offs[cur.tab]) || [];
  const useSchedule = sched && sched.sessions && sched.last && !isNaN(prevEnd);
  // Dates follow the Schedule; the file's plan only fills weeks the Schedule has not reached.
  const list = useSchedule ? L.scheduleLessons(prevEnd, cur.lessons.length || Number(cur.sessions) || 20, sched.sessions[cur.tab], sched.last, cur.lessons) : cur.lessons.map(day => ({ day, known: false }));
  const learned = list.filter(x => x.known && x.day <= today).length, learning = Number(cur.nextDot) - 1, first = list[0], last = list[list.length - 1];
  const differs = useSchedule && last && !isNaN(L.dayOf(cur.end)) && last.day !== L.dayOf(cur.end);
  const next = list.find(x => x.day >= today), dueDay = L.dayOf(cur.dueDate), toDue = dueDay - today;
  const fact = (label, big, small, extra) => el('div', { class: 'fact' }, [el('span', { class: 'lab', textContent: label }), el('b', { textContent: big }), small ? el('span', { class: 'sub', textContent: small }) : '', extra || '']);
  box.append(el('div', { class: 'card facts' }, [
    fact('Đang học', 'Đợt ' + learning, first && last ? L.dayText(first.day).slice(0, 5) + ' đến ' + L.dayText(last.day) : ''),
    fact('Đã học', learned + '/' + list.length + ' buổi', 'Còn ' + Math.max(0, list.length - learned) + ' buổi', el('div', { class: 'track' }, [el('i', { style: 'width:' + (list.length ? Math.round(learned / list.length * 100) : 0) + '%' })])),
    fact(next && next.day === today ? 'Hôm nay học' : 'Buổi tới', next ? L.dayText(next.day).slice(0, 5) : 'Hết đợt', next ? L.weekdays([next.day]) + (next.known ? '' : ', dự kiến') : ''),
    fact('Thu đợt ' + cur.nextDot, isNaN(dueDay) ? (cur.dueDate || 'Chưa có') : L.dayText(dueDay), isNaN(dueDay) ? '' : toDue > 0 ? 'Còn ' + toDue + ' ngày' : toDue === 0 ? 'Hôm nay' : 'Quá ' + (-toDue) + ' ngày')]));
  if (differs) box.append(el('div', { class: 'warn-line', style: 'margin:0 0 12px', textContent: 'Theo Schedule đợt này hết ' + L.dayText(last.day) + ', file học phí tính hết ' + cur.end + '. Hạn thu đang theo file.' }));
  const left = el('div', { class: 'dot-col' }, [
    el('div', { class: 'card panel' }, [
      el('h2', { class: 'panel-title', textContent: 'Các buổi học đợt ' + learning }),
      el('ol', { class: 'les' }, list.map((x, k) => el('li', { class: (x.day < today ? 'past' : x === next ? 'next' : '') + (x.known ? '' : ' planned') }, [
        el('span', { class: 'no', textContent: String(k + 1) }), el('b', { textContent: L.dayText(x.day).slice(0, 5) }), el('span', { class: 'wd', textContent: L.weekdays([x.day]) })]))),
      el('div', { class: 'legend' }, [el('span', { class: 'k past', textContent: 'Đã học' }), el('span', { class: 'k next', textContent: next && next.day === today ? 'Hôm nay' : 'Buổi tới' }), el('span', { class: 'k planned', textContent: 'Dự kiến, chưa có trên Schedule' })]),
      useSchedule ? el('div', { class: 'sub', textContent: 'Schedule có đến tuần ' + L.dayText(sched.last) + '.' }) : el('div', { class: 'sub', textContent: 'Đang đối chiếu Schedule, tạm hiện ngày dự kiến của file.' }),
      off.length ? el('div', { class: 'sub', textContent: 'Schedule ghi nghỉ: ' + off.map(d => L.dayText(d).slice(0, 5)).join(', ') }) : '']),
    historyPanel()]);
  const right = el('div', { class: 'dot-col' }, [bookPanel(), sentPanel()]);
  const mien = cur.items.filter(L.free);
  if (mien.length) right.append(el('div', { class: 'card panel' }, [el('h2', { class: 'panel-title', textContent: 'Em miễn học phí' }),
    el('div', { class: 'sub', textContent: 'Không tính, không đếm, không gửi tin. Đổi mức ở đây nếu không còn miễn.' }),
    ...mien.map(it => el('div', { style: 'margin-top:8px' }, [el('b', { textContent: fullName(it) }), discLine(it)]))]));
  box.append(el('div', { class: 'dot-grid' }, [left, right]));
}
function bookPanel() {
  const draft = bookDraft && bookDraft.tab === cur.tab ? bookDraft.list : cur.books.slice();
  const price = name => { const b = (bookList || []).find(x => x.name === name); return b ? b.price : 0; };
  const sum = draft.reduce((a, n) => a + price(n), 0), fee = L.digits(cur.fee), changed = draft.join('|') !== cur.books.join('|');
  // One box is enough for most đợt; the others appear only when filled or asked for.
  const filled = draft.reduce((n, v, k) => (v ? k + 1 : n), 0), shown = Math.min(draft.length, Math.max(1, filled, bookExtra[cur.tab] || 0));
  const pickers = draft.slice(0, shown).map((value, k) => el('select', { 'aria-label': 'Sách ' + (k + 1), onchange: e => { const list = draft.slice(); list[k] = e.target.value; bookDraft = { tab: cur.tab, list }; render(); } },
    [el('option', { value: '', textContent: k === 0 ? 'Không thu sách' : '(trống)' })].concat(
      // A value typed in the Sheet that is no longer in the catalogue stays selectable, so saving cannot lose it.
      (bookList || []).concat(value && !(bookList || []).some(b => b.name === value) ? [{ name: value, price: 0 }] : []).map(b => el('option', { value: b.name, textContent: b.name + (b.price ? ' · ' + L.fmt(b.price) + ' đ' : ''), selected: b.name === value })))));
  return el('div', { class: 'card panel' }, [
    el('h2', { class: 'panel-title', textContent: 'Sách thu cùng đợt ' + cur.nextDot }),
    bookList ? el('div', { class: 'books' }, pickers) : el('div', { class: 'sub', textContent: 'Đang đọc danh mục sách…' }),
    bookList && shown < draft.length ? el('button', { class: 'act', style: 'margin-top:8px', textContent: '+ Thêm sách', onclick: () => { bookExtra[cur.tab] = shown + 1; render(); } }) : '',
    el('div', { class: 'sub', style: 'margin-top:8px', textContent: 'Học phí ' + L.fmt(fee) + ' đ + sách ' + L.fmt(sum) + ' đ = ' + L.fmt(fee + sum) + ' đ' }),
    changed ? el('div', { class: 'acts' }, [
      el('button', { class: 'primary', id: 'bookSave', textContent: 'Lưu sách', onclick: () => luuSach(draft) }),
      el('button', { textContent: 'Huỷ', onclick: () => { bookDraft = null; delete bookExtra[cur.tab]; render(); } })]) : '',
    changed ? el('div', { class: 'sub', style: 'margin-top:6px', textContent: 'Em đã nộp không đổi. Em chưa nộp tự cập nhật số tiền sáng hôm sau, trừ ô đã sửa tay.' }) : '']);
}
async function luuSach(list) {
  const name = cur.tab, btn = $('bookSave');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
  try {
    await batchWrite([{ range: L.quote(name) + '!B7:B11', values: list.map(v => [v]) }]);
    bookDraft = null;
    notice('Đã lưu sách của ' + name + '. File đang tính lại, số mới sẽ hiện sau ít phút.');
    await openClass(name, true);
    notice('Đã lưu sách của ' + name + '.');
  } catch (e) { notice('Chưa lưu được sách: ' + e.message, true); render(); }
}
function historyPanel() {
  return el('div', { class: 'card panel' }, [el('h2', { class: 'panel-title', textContent: 'Các đợt đã thu' })].concat(
    cur.history.length ? cur.history.map(h => el('details', { class: 'hist' }, [
      el('summary', { class: 'hist-row' }, [el('b', { textContent: 'Đợt ' + h.dot }), el('span', { class: 'sub', textContent: h.paidOn ? 'Thu ' + h.paidOn : '' }), el('strong', { textContent: h.total + ' đ' })]),
      el('dl', { class: 'kv' }, [
        el('dt', { textContent: 'Thu cho' }), el('dd', { textContent: 'Đợt ' + h.dot + ', sau khi đợt ' + (Number(h.dot) - 1) + ' học ' + h.from + ' đến ' + h.to }),
        el('dt', { textContent: 'Học phí' }), el('dd', { textContent: h.fee + ' đ' }),
        h.book ? el('dt', { textContent: 'Sách' }) : '', h.book ? el('dd', { textContent: h.book }) : '']),
      h.detail ? el('pre', { class: 'detail', textContent: h.detail }) : ''])) : [el('div', { class: 'sub', textContent: 'Chưa có đợt nào được ghi.' })]));
}
function sentPanel() {
  // One press often marks a whole group, so rows from the same moment read as one line.
  const rows = sentRows.filter(r => r[1] === cur.tab && String(r[2]) === String(cur.dot)).slice().reverse(), groups = [];
  rows.forEach(r => {
    const last = groups[groups.length - 1], word = r[6] === 'bo' ? 'Bỏ đánh dấu' : r[6] === 'nhac-lai' ? 'Nhắc lại' : 'Đã gửi';
    if (last && last.at === r[0] && last.by === r[7] && last.word === word) last.names.push(r);
    else groups.push({ at: r[0], by: r[7], word, names: [r] });
  });
  return el('div', { class: 'card panel' }, [el('h2', { class: 'panel-title', textContent: 'Lịch sử gửi Zalo đợt ' + cur.dot }),
    groups.length ? el('div', { class: 'sent-log' }, groups.map(g => el('div', { class: 'sent-row' }, [
      el('div', { class: 'sub', textContent: g.at + (g.by ? ' · ' + g.by : '') }),
      el('div', {}, [el('b', { textContent: g.word + ' ' }), g.names.map(r => r[3] + (r[4] ? ' (' + r[4] + ')' : '')).join(', ')])])))
      : el('div', { class: 'sub', textContent: 'Chưa ai đánh dấu đã gửi.' })]);
}

function renderThu(box) {
  const groups = { can: cur.items.filter(canThu), ghi: cur.items.filter(chuaGhi), da: cur.items.filter(daThu), hoan: cur.items.filter(x => L.deferred(x) && !L.free(x) && !daRoi(x)), roi: cur.items.filter(x => !x.paid && !L.free(x) && daRoi(x)), xem: cur.items.filter(x => canThu(x) && (x.warn || x.trong || x.gop || nhacOf(x))) };
  if ((filter === 'hoan' && !groups.hoan.length) || (filter === 'roi' && !groups.roi.length)) filter = 'can';
  const chip = (id, label) => el('button', { textContent: label + ' ' + groups[id].length, 'aria-pressed': String(filter === id), onclick: () => { filter = id; render(); } });
  const before = cur.items.filter(x => x.prev && !L.free(x) && (x.prev.amount > 0 || x.prev.paid)).sort((a, b) => a.prev.paid - b.prev.paid);
  if (filter === 'truoc' && !before.length) filter = 'can';
  groups.truoc = before;
  box.append(el('div', { class: 'filters' }, [chip('can', 'Chưa thu'), chip('ghi', 'Chưa ghi'), chip('xem', 'Cần xem lại'), chip('da', 'Đã nộp'), groups.hoan.length ? chip('hoan', 'Chưa thu ngay') : '', groups.roi.length ? chip('roi', 'Đã nghỉ, chuyển') : '',
    before.length ? el('button', { textContent: 'Đợt ' + before[0].prev.dot + ' chưa nộp ' + before.filter(x => !x.prev.paid).length, 'aria-pressed': String(filter === 'truoc'), onclick: () => { filter = 'truoc'; render(); } }) : '']));
  const list = groups[filter];
  if (!list.length) { box.append(el('div', { class: 'empty', textContent: filter === 'can' ? 'Lớp này đã nộp đủ đợt ' + cur.dot + '.' : filter === 'da' ? 'Chưa có em nào nộp đợt ' + cur.dot + '.' : filter === 'ghi' ? 'Không có em nào chưa ghi.' : 'Không có em nào cần xem lại.' })); return; }
  box.append(el('div', { class: 'fee-list' }, list.map(filter === 'truoc' ? prevRow : feeRow)));
}
const nhacOf = it => nhacCua(cur).find(r => r.item.key === it.key);
const nhacLine = (it, style) => {
  const r = nhacOf(it);
  return r ? el('div', { class: 'warn-line', style: style || '' }, [(r.guess ? 'Lớp đã tick từ trước, tính từ hạn thu ' : r.lan ? 'Nhắc lần ' + r.lan + ' ngày ' : 'Gửi ngày ') + ngayNgan(r.from) + ', ' + r.days + ' ngày rồi ' + (r.blank ? 'chưa ghi nộp, xem sao kê rồi nhắc lại.' : 'chưa nộp, đến lúc nhắc lại.'),
    el('button', { class: 'quiet', textContent: 'Đã nhắc lại', onclick: () => { logSent(cur.tab, cur.dot, [it], 'nhac-lai'); render(); } })]) : '';
};
/** One box for a discount: the levels in use, none, or another amount. read() gives the value or throws. */
function discPicker(current) {
  const levels = [['', 'Không giảm'], ['600000', '600.000 đ/đợt'], ['20%', '20%'], ['50%', '50%'], ['miễn học phí', 'Miễn học phí']];
  const now = L.discValue(current);
  if (now && !levels.some(l => l[0] === now)) levels.splice(1, 0, [now, L.discText(now)]);
  const other = el('input', { placeholder: 'Ví dụ 1000000 hoặc 10%', 'aria-label': 'Mức giảm khác', hidden: true });
  const sel = el('select', { 'aria-label': 'Mức giảm giá', onchange: () => { other.hidden = sel.value !== 'khac'; if (!other.hidden) other.focus(); } },
    levels.concat([['khac', 'Số khác…']]).map(l => el('option', { value: l[0], textContent: l[1], selected: l[0] === now })));
  return { node: el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' }, [sel, other]), read: () => L.discInput(sel.value === 'khac' ? other.value : sel.value) };
}
let discOpen = null;
async function luuGiam(it, picker, msg) {
  let disc;
  try { disc = picker.read(); } catch (e) { msg.textContent = e.message; return; }
  if (disc === L.discValue(it.disc) || String(disc) === L.discValue(it.disc)) { discOpen = null; return render(); }
  msg.textContent = 'Đang lưu…';
  const name = cur.tab;
  try {
    const want = L.freshRanges(name, [it.row]), [values, cells, e] = await Promise.all([batchGet(want.values), batchGet(want.cells, 'FORMULA'), batchGet([L.quote(name) + '!E' + it.row], 'FORMULA')]);
    await batchWrite(L.planDiscount(name, it, L.freshAt(values, cells, 0), disc, ((e[0] || [])[0] || [])[0] || ''));
    it.disc = disc === '' ? '' : String(disc); discOpen = null;
    const c = store.get('hp_cls_' + name);
    if (c) { const x = c.data.items.find(y => y.key === it.key); if (x) x.disc = it.disc; c.dirty = true; store.set('hp_cls_' + name, c); }
    notice((disc === '' ? 'Đã bỏ giảm giá của ' : 'Đã lưu giảm giá của ') + fullName(it) + '. Số tiền và tin nhắn tự đổi sau khoảng 1 phút.' + (it.paid ? ' Đợt ' + cur.dot + ' đã nộp nên áp dụng từ đợt sau.' : ''));
    render();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (view === 'class' && cur && cur.tab === name) refreshClass(name, ++loadSeq); }, 60000);
  } catch (e) { msg.textContent = 'Không lưu được: ' + e.message; }
}
function discLine(it) {
  if (discOpen !== it.key) return el('div', { class: 'r3' }, [el('button', { class: 'quiet', textContent: it.disc ? 'Giảm: ' + L.discText(it.disc) : 'Giảm giá', onclick: () => { discOpen = it.key; render(); } })]);
  const p = discPicker(it.disc), msg = el('span', { class: 'sub', role: 'status' });
  return el('div', { class: 'r3', style: 'flex-wrap:wrap' }, [p.node, el('button', { class: 'act', textContent: 'Lưu', onclick: () => luuGiam(it, p, msg) }), el('button', { class: 'quiet', textContent: 'Huỷ', onclick: () => { discOpen = null; render(); } }), msg]);
}
function feeRow(it) {
  const d = el('input', { type: 'date', value: picked[it.key] || localDate(), max: localDate(), 'aria-label': 'Ngày nộp của ' + it.name, oninput: e => { picked[it.key] = e.target.value; } });
  const gone = !it.paid && daRoi(it);
  const r2 = gone ? [el('span', { class: 'chip idle', textContent: (gone.kind === 'Chuyển lớp' ? 'Chuyển sang ' + gone.to : 'Nghỉ học') + ' từ ' + gone.date })]
    : L.free(it) ? [el('span', { class: 'chip idle', textContent: 'Miễn học phí, không thu' })] : it.paid
    ? [el('span', { class: 'chip ok', textContent: 'Đã nộp ' + it.date + (it.dangLuu ? ' · đang lưu' : '') }), el('div', { class: 'fill' }), el('button', { class: 'quiet', textContent: 'Bỏ tick', onclick: () => boTick(it) })]
    : [el('span', { class: /chưa thu ngay/i.test(it.status) || chuaGhi(it) ? 'chip idle' : 'chip', textContent: it.status || (chuaGhi(it) ? 'Chưa ghi' : 'Chưa nộp') }), el('div', { class: 'fill' }), d, el('button', { class: 'tick', textContent: 'Đã nộp', onclick: () => tick(it, d.value) })];
  const sent = !it.paid && sentOf(cur.tab, cur.dot, it.key);
  return el('div', { class: 'row card' }, [
    el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: fullName(it) }), el('span', { class: 'amt', textContent: L.free(it) || gone ? '' : money(it.amount) || (L.deferred(it) ? '' : 'Chưa có số') })]),
    el('div', { class: 'r2' }, r2),
    it.paid || !canThu(it) ? '' : el('div', { class: 'r3' }, sent
      ? [el('span', { class: 'sent', textContent: sentText(sent) }), (sentIdx[cur.tab + '|' + cur.dot] || {})[it.key] ? el('button', { class: 'quiet', textContent: 'Bỏ đánh dấu', onclick: () => markStudent(it, false) }) : '']
      : [el('button', { class: 'act', textContent: 'Đánh dấu đã gửi Zalo', onclick: () => markStudent(it, true) })]),
    gone ? el('div', { class: 'sub', style: 'margin-top:4px', textContent: 'Đã ghi ở Biến động, còn tên trong lớp đến khi Theo dõi toàn diện cập nhật. Không tính thu ở lớp này.' }) : discLine(it),
    nhacLine(it),
    it.gop && !it.paid ? el('div', { class: 'warn-line' }, ['Đã gộp đợt ' + it.gop.dot + ': ' + money(it.gop.amount) + (it.gop.blank ? ' vì đợt đó chưa ghi nộp hay chưa.' : ' vì đợt đó chưa nộp.'), el('button', { class: 'quiet', textContent: 'Đợt ' + it.gop.dot + ' đã nộp', onclick: () => tickPrev(it, d.value) })]) : '',
    prevDone[it.key] && it.prev && it.prev.paid && !it.paid ? el('div', { class: 'warn-line' }, ['Vừa ghi đợt ' + it.prev.dot + ' đã nộp ngày ' + it.prev.date + (it.prev.luu ? ' · đang lưu' : '') + '.', el('button', { class: 'quiet', textContent: 'Hoàn tác', onclick: () => boTickPrev(it) })]) : '',
    it.warn && !L.free(it) ? el('div', { class: 'warn-line' }, [it.warn, el('button', { class: 'quiet', textContent: 'Xem và sửa', onclick: () => moSua(it) })]) : '',
    L.free(it) && it.tienSheet > 0 ? el('div', { class: 'warn-line' }, ['Bảng vẫn ghi ' + money(it.tienSheet) + ' cho đợt này. Em miễn học phí nên app không tính số này, bạn xem lại ô đó trong Sheet.']) : '',
    !it.warn && it.trong && canThu(it) ? el('div', { class: 'warn-line' }, ['Chưa có tin hoặc số tiền đợt này.', el('button', { class: 'quiet', textContent: 'Nhập', onclick: () => moSua(it) })]) : '']);
}
function localDate() { const d = new Date(), p = n => ('0' + n).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function tick(it, iso) {
  if (!iso) return notice('Hãy chọn ngày nộp.', true);
  if (!it.amount && !confirm(fullName(it) + ' chưa có số tiền đợt này. Vẫn tick đã nộp?')) return;
  const [y, m, d] = iso.split('-');
  delete picked[it.key];
  queue({ kind: 'paid', tab: cur.tab, dot: cur.dot, date: d + '/' + m + '/' + y, item: { key: it.key, row: it.row, name: it.name, eng: it.eng, amount: it.amount, stale: it.stale, tienSheet: it.tienSheet } });
}
/** Status each previous-đợt tick replaced, so its undo can put it back. */
const prevDone = {};
/** The previous đợt was paid after all: tick that đợt, and the formula takes it back out of this one. */
function tickPrev(it, iso) {
  if (!iso) return notice('Hãy chọn ngày nộp.', true);
  const p = it.prev, [y, m, d] = iso.split('-'), date = d + '/' + m + '/' + y;
  const note = it.gop ? '\nSố cần thu đợt ' + cur.dot + ' sẽ còn ' + money(it.amount - it.gop.amount) + '.'
    : it.paid ? '\nEm này đã tick đợt ' + cur.dot + '. Nếu số đó đã gộp cả đợt ' + p.dot + ' thì đừng tick, kẻo hoá đơn tính trùng.' : '';
  if (!confirm('Ghi ' + fullName(it) + ' đã nộp đợt ' + p.dot + ' ngày ' + date + '?' + note)) return;
  prevDone[it.key] = { status: p.status };
  queue({ kind: 'paid', tab: cur.tab, dot: p.dot, gopOf: cur.dot, date, item: { key: it.key, row: it.row, name: it.name, eng: it.eng, amount: p.amount } });
}
function boTickPrev(it) {
  const p = it.prev, back = prevDone[it.key];
  if (!confirm('Bỏ tick đã nộp đợt ' + p.dot + ' của ' + fullName(it) + '? Ngày nộp sẽ bị xoá.' + (it.paid ? '' : '\nĐợt ' + p.dot + ' sẽ gộp lại vào đợt ' + cur.dot + '.'))) return;
  delete prevDone[it.key];
  queue({ kind: 'unpaid', tab: cur.tab, dot: p.dot, gopOf: cur.dot, item: { key: it.key, row: it.row, name: it.name, eng: it.eng, amount: p.amount, restore: back ? back.status : '' } });
}
function prevRow(it) {
  const p = it.prev, d = el('input', { type: 'date', value: localDate(), max: localDate(), 'aria-label': 'Ngày nộp đợt ' + p.dot + ' của ' + it.name });
  return el('div', { class: 'row card' }, [
    el('div', { class: 'r1' }, [el('span', { class: 'nm', textContent: fullName(it) }), el('span', { class: 'amt', textContent: money(p.amount) || 'Chưa có số' })]),
    el('div', { class: 'r2' }, p.paid
      ? [el('span', { class: 'chip ok', textContent: 'Đã nộp ' + p.date + (p.luu ? ' · đang lưu' : '') }), el('div', { class: 'fill' }), el('button', { class: 'quiet', textContent: 'Bỏ tick', onclick: () => boTickPrev(it) })]
      : [el('span', { class: 'chip idle', textContent: p.status || 'Chưa ghi' }), el('div', { class: 'fill' }), d, el('button', { class: 'tick', textContent: 'Đã nộp', onclick: () => tickPrev(it, d.value) })])]);
}
function boTick(it) {
  if (!confirm('Bỏ tick đã nộp của ' + fullName(it) + '? Ngày nộp sẽ bị xoá.')) return;
  queue({ kind: 'unpaid', tab: cur.tab, dot: cur.dot, item: { key: it.key, row: it.row, name: it.name, eng: it.eng, amount: it.amount } });
}

function renderZalo(box) {
  const items = zaloItems();
  if (!items.length) { box.append(el('div', { class: 'empty', textContent: 'Lớp này đã nộp đủ đợt ' + cur.dot + ', không cần nhắc nữa.' })); return; }
  i = Math.min(i, items.length - 1);
  const it = items[i], sentTo = x => sentOf(cur.tab, cur.dot, x.key), mine = sentTo(it), own = (sentIdx[cur.tab + '|' + cur.dot] || {})[it.key];
  const pick = k => { i = k; step = 0; render(); };
  const people = el('div', { class: 'people card', role: 'list' }, items.map((x, k) => el('button', { 'data-key': x.key, 'aria-current': String(k === i), onclick: () => pick(k) }, [
    el('span', { class: 'n', textContent: (k + 1) + '. ' + fullName(x) }),
    x.trong ? el('span', { class: 'm none', textContent: 'chưa có tin' }) : nhacOf(x) ? el('span', { class: 'm warn', textContent: 'nhắc lại' }) : (x.warn || x.gop) && !sentTo(x) ? el('span', { class: 'm warn', textContent: x.gop ? 'gộp đợt ' + x.gop.dot : 'xem lại' }) : sentTo(x) ? el('span', { class: 'm done', textContent: 'đã gửi' }) : chuaGhi(x) ? el('span', { class: 'm none', textContent: 'chưa ghi' }) : ''])));
  const sel = el('select', { id: 'chon', 'aria-label': 'Chọn học sinh', onchange: e => pick(+e.target.value) },
    items.map((x, k) => el('option', { value: String(k), textContent: (k + 1) + '. ' + fullName(x) + (x.trong ? ' – chưa có tin' : sentTo(x) ? ' – đã gửi' : x.warn ? ' – xem lại' : '') })));
  sel.value = String(i);
  const img = el('img', { id: 'card', alt: 'Thiệp học phí của ' + it.name });
  const done = items.filter(sentTo).length;
  box.append(el('div', { class: 'zalo' }, [people, el('div', { class: 'stage' }, [
    sel,
    el('div', { class: 'who' }, [el('b', { textContent: fullName(it) }), it.rieng ? el('span', { class: 'tag', textContent: 'đã sửa riêng' }) : '', el('button', { class: 'quiet', textContent: 'Sửa riêng', onclick: () => moSua(it) })]),
    it.warn ? el('div', { class: 'warn-line', style: 'margin:0 0 8px' }, [it.warn]) : '',
    nhacLine(it, 'margin:0 0 8px'),
    it.gop ? el('div', { class: 'warn-line', style: 'margin:0 0 8px' }, ['Tin này gộp cả đợt ' + it.gop.dot + ' (' + money(it.gop.amount) + ')' + (it.gop.blank ? ' vì đợt đó chưa ghi nộp hay chưa. Xem sao kê trước khi gửi' : '') + '. Đã nộp rồi thì bấm "Đợt ' + it.gop.dot + ' đã nộp" ở tab Thu tiền, số sẽ tự trừ.']) : '',
    chuaGhi(it) ? el('div', { class: 'warn-line', style: 'margin:0 0 8px' }, ['Em này chưa ghi nộp hay chưa. Xem sao kê trước khi gửi, đã nộp thì tick ở tab Thu tiền.']) : '',
    el('div', { class: 'r3' }, mine
      ? [el('span', { class: 'sent', textContent: sentText(mine) }), own ? el('button', { class: 'quiet', textContent: 'Bỏ đánh dấu', onclick: () => markStudent(it, false) }) : '']
      : [el('button', { class: 'act', textContent: 'Đánh dấu đã gửi', onclick: () => markStudent(it, true) })]),
    el('button', { class: 'one primary', id: 'one', textContent: oneLabel(it), onclick: oneClick }),
    it.qr ? el('div', { class: 'pv' }, [img]) : '',
    el('div', { class: 'nav', style: 'margin-top:8px' }, [
      el('button', { textContent: '← Em trước', disabled: i === 0, onclick: () => go(-1) }),
      el('button', { class: 'copy', textContent: 'Copy lại', disabled: !it.qr, onclick: copyCard }),
      el('button', { textContent: 'Em sau →', disabled: i === items.length - 1, onclick: () => go(1) })]),
    el('div', { id: 'st', class: 'st', role: 'status' }),
    el('div', { class: 'count', textContent: 'Em ' + (i + 1) + ' / ' + items.length + ' · đã gửi ' + done + ' / ' + items.length })])]));
  if (it.trong) return st('Em này chưa có tin hoặc số tiền đợt này, bấm nút để tự nhập.', true);
  if (!it.qr) return st('Em này chưa có link QR.', true);
  thiep(it).then(b => { if (zaloItems()[i] === it) img.src = URL.createObjectURL(b); }).catch(e => st('Không tạo được thiệp: ' + e.message, true));
  const j = nextIdx(); if (j >= 0 && items[j].qr) thiep(items[j]).catch(() => {});
}
function oneLabel(it) { return it.trong ? 'Nhập tin và số tiền cho em này' : step === 0 ? 'Copy thiệp' : (nextIdx() < 0 ? 'Đã gửi em này' : 'Đã gửi, sang em tiếp'); }
function nextIdx() { const z = zaloItems(); for (let j = i + 1; j < z.length; j++) if (!z[j].trong) return j; return -1; }
function go(d) { const z = zaloItems(); i = Math.min(z.length - 1, Math.max(0, i + d)); step = 0; render(); }
async function copyCard() {
  const it = zaloItems()[i]; if (!it || !it.qr) return st('Em này chưa có link QR.', true);
  const blob = thiep(it);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    step = 1; const b = $('one'); if (b) b.textContent = oneLabel(it);
    st('Đã copy thiệp, sang Zalo dán rồi gửi. Gửi xong bấm "Đã gửi".');
  } catch (e) {
    try {
      const f = new File([await blob], fullName(it) + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); step = 1; const b = $('one'); if (b) b.textContent = oneLabel(it); return st('Đã mở chia sẻ thiệp. Gửi xong bấm "Đã gửi".'); }
    } catch (e2) { /* falls through to the hint */ }
    st('Không copy được: nhấn giữ hoặc chuột phải vào ảnh để sao chép.', true);
  }
}
function oneClick() {
  const it = zaloItems()[i];
  if (it.trong) return moSua(it);
  if (step === 0) return copyCard();
  if (!sentOf(cur.tab, cur.dot, it.key)) logSent(cur.tab, cur.dot, [it], 'da-gui');
  const j = nextIdx();
  if (j < 0) { render(); return st('Đã gửi hết danh sách lớp này.'); }
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
    const [values, cells, kho] = await Promise.all([batchGet(want.values), batchGet(want.cells, 'FORMULA'), readKho(true)]);
    const plan = L.planOverride(name, it, L.freshAt(values, cells, 0), dot, msg, amt, kho), data = plan.updates.slice();
    if (plan.store && plan.store.row > 0) data.push({ range: "'_TRO_LY_ZALO'!A" + plan.store.row + ':B' + plan.store.row, values: [[plan.store.key, plan.store.value]] });
    if (plan.store && plan.store.row < 0) data.push({ range: "'_TRO_LY_ZALO'!A" + (kho.length + 1) + ':B' + (kho.length + 1), values: [[plan.store.key, plan.store.value]] });
    if (data.length) await batchWrite(data);
    $('sua').close();
    khoMemo = null;
    await openClass(name, true);
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
    if (view === 'home') render();
  } catch (e) { notice('Chưa đọc được danh sách lớp: ' + e.message, true); }
  if (pending.length) flush();
  loadMoves();
  loadWho();
  loadSent(true).then(flushSent);
  loadAck();
  // Read the calendar first so classes due for collection are refreshed before the others.
  await loadCal();
  loadAll(true);
}
function fillClasses(list) {
  classes = list; const s = $('lop'), v = s.value;
  s.replaceChildren(el('option', { value: '', textContent: 'Mở nhanh một lớp…' }), ...list.map(n => el('option', { value: n, textContent: n })));
  s.value = v;
}
window.addEventListener('load', () => {
  $('btnLogin').addEventListener('click', () => getToken(true).then(afterLogin).catch(e => { $('loginMsg').textContent = e.message; }));
  $('home').addEventListener('click', () => goTo('home'));
  $('navHome').addEventListener('click', () => goTo('home'));
  $('navLop').addEventListener('click', () => { lopFilter = 'all'; goTo('lop'); });
  $('lop').addEventListener('change', e => { if (e.target.value) { filter = 'can'; openClass(e.target.value); } });
  $('reload').addEventListener('click', () => {
    if (view === 'home' || view === 'lop') loadAll(); else if (view === 'moves') loadMoves();
    else if (view === 'cal') loadCal(true).then(() => loadSchedule(true));
    else if (view === 'tutor') loadTutor(true);
    else if (cur) openClass(cur.tab, true);
  });
  $('btnCal').addEventListener('click', openCal);
  $('btnMoves').addEventListener('click', () => { goTo('moves'); if (!moves || Date.now() - moves.at > FRESH_MS) loadMoves(); });
  $('dvLuu').addEventListener('click', luuDuyet);
  $('dvKhongThu').addEventListener('click', khongThuMove);
  $('dvHuy').addEventListener('click', () => $('duyet').close());
  $('thiepCopy').addEventListener('click', copyThiep);
  $('thiepChu').addEventListener('click', copyChuThiep);
  $('thiepDong').addEventListener('click', () => $('thiepDlg').close());
  applyTheme();
  $('btnTheme').addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; store.set('hp_theme', next); applyTheme(next); });
  $('navTutor').addEventListener('click', openTutor);
  $('navNguoi').addEventListener('click', () => { goTo('nguoi'); loadNguoi(); });
  $('btnOut').addEventListener('click', () => {
    if (pending.length && !confirm('Còn ' + pending.length + ' lần tick chưa lưu sẽ bị bỏ. Vẫn đăng xuất?')) return;
    if (linkKey && !confirm('Thoát trên máy này? Muốn vào lại phải mở lại link riêng của bạn.')) return;
    if (token) google.accounts.oauth2.revoke(token, () => {});
    linkKey = ''; linkRole = ''; $('navNguoi').hidden = true;
    token = null; pending = []; cal = null; sched = null; khoMemo = null; who = ''; sentRows = []; sentIdx = {}; sentQueue = []; ackMap = {}; bookDraft = null; tutor = null;
    try { sessionStorage.removeItem('hp_token'); } catch (e) { /* nothing to clear */ }
    store.clear();
    showLogin(false);
  });
  $('edLuu').addEventListener('click', () => ghiRieng($('edMsg').value, $('edAmt').value));
  $('edBo').addEventListener('click', () => ghiRieng('', ''));
  $('edHuy').addEventListener('click', () => $('sua').close());
  openStore().then(() => {
    applyTheme(store.get('hp_theme'));
    pending = store.get(QKEY) || []; cal = store.get('hp_cal'); sched = store.get('hp_sched'); tutor = store.get('hp_tutor'); restoreSent();
    const fromLink = (location.hash.match(/[#&]k=([\w-]{32,})/) || [])[1];
    if (fromLink) { store.set('hp_link', fromLink); history.replaceState(null, '', location.pathname); }
    linkKey = fromLink || store.get('hp_link') || '';
    if (linkKey) { showLogin(false); return afterLogin(); }
    const wait = setInterval(() => { if (window.google && google.accounts) {
      clearInterval(wait); initAuth(); $('btnLogin').disabled = false;
      showLogin(false);
      try {
        const kept = JSON.parse(sessionStorage.getItem('hp_token'));
        if (kept && Date.now() < kept.tokenUntil) { token = kept.token; tokenUntil = kept.tokenUntil; afterLogin(); }
      } catch (e) { /* the sign-in button is still there */ }
    } }, 100);
  });
  document.addEventListener('click', renewOnClick, true);
  window.addEventListener('beforeunload', e => { if (pending.length) e.preventDefault(); });
});
