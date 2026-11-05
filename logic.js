// Tuition logic with no browser or network code, so it can be tested with Node.
// buildClass ports layDanhSachGuiZalo (TroLyGuiZalo.gs); planPaid/planUnpaid/planOverride write what hpLiveOnEdit and luuRieng write.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HpLogic = factory();
})(this, function () {
  const ACTIVE = 'Đang trong live', COMPACT_MARKER = 'HP_COMPACT_ID_V1';
  const FIRST_ROW = 384, COUNT = 30, LEDGER_FIRST = 3, LEDGER_OFFSET = 67;
  const TRACK_FIRST = 381; // the tracking range is read from this row

  const cell = (rows, r, c) => { const x = (rows[r] || [])[c]; return x === undefined || x === null ? '' : x; };
  const text = (rows, r, c) => String(cell(rows, r, c));
  const digits = s => Number(String(s).replace(/\D/g, '')) || 0;
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const isPaid = s => /đã nộp|da nop/i.test(String(s));
  const clean = v => String(v === undefined || v === null ? '' : v).trim().split(/\r?\n/)[0].trim().replace(/\s+/g, ' ').toUpperCase();
  function colA1(n) { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
  const quote = name => "'" + String(name).replace(/'/g, "''") + "'";
  const a1 = (tab, col, row) => quote(tab) + '!' + colA1(col) + row;
  const liveFormula = (row, expr) => '=IF($EC' + row + '="' + ACTIVE + '";' + expr + ';"")';
  const totalIn = s => digits((String(s).match(/Tổng số tiền cần thanh toán là:\s*([\d.,]+)/i) || [])[1] || '');
  // The line the class's message formula (BP40) adds when the previous đợt rolls into this one.
  const GOP_LINE = /\n- Con [^\n]*còn học phí Đợt \d+ chưa thanh toán:[^\n]*/;
  function gopIn(s) {
    const m = String(s).match(/còn học phí Đợt (\d+) chưa thanh toán: ([\d.]+) đồng/);
    return m ? { dot: m[1], amount: digits(m[2]) } : null;
  }

  /** Ranges to read for one class, in the order buildClass expects them. */
  function classRanges(tab) {
    return ['A1:E17', 'J17:U36', 'A' + TRACK_FIRST + ':BM413', 'BP40:BP70', 'AK20:AK39'].map(r => quote(tab) + '!' + r);
  }

  /** The column of the period's "Trạng thái", 1-based, from the tracking rows; -1 if the block is not there. */
  function findPeriodCol(track, nameRowIdx, dot) {
    const head = track[nameRowIdx - 1] || [], sub = track[nameRowIdx] || [];
    for (let c = 0; c < head.length; c++) {
      if (String(head[c]).trim().toUpperCase() === 'ĐỢT ' + dot && String(sub[c + 1]).trim() === 'Số tiền') return c + 1;
    }
    return -1;
  }

  /** raw = {top, hist, track, msg, kho}; kho maps store keys to their JSON text. */
  function buildClass(tab, raw) {
    const track = raw.track || [], msg = raw.msg || [], hist = raw.hist || [], top = raw.top || [], kho = raw.kho || {};
    const m = text(msg, 0, 0).match(/^Tin nhắn gửi PH\s*[–-]\s*đợt\s*(\d+)/);
    let nameRow = -1, nameCol = -1;
    track.forEach((r, i) => { const c = (r || []).indexOf('Họ tên Tiếng Việt'); if (c >= 0 && nameRow < 0) { nameRow = i; nameCol = c; } });
    if (!m || nameRow < 0) throw new Error('Tab ' + tab + ' chưa có cột "Tin nhắn gửi PH".');
    const dot = m[1];

    let tinChung = '';
    top.forEach(r => (r || []).forEach((v, c) => { if (v === 'Tin nhắn chung' && !tinChung) tinChung = String(r[c + 1] || ''); }));
    const headRow = hist.findIndex(r => (r || []).indexOf('Đợt thu') >= 0);
    if (headRow >= 0) {
      const c = hist[headRow].indexOf('Đợt thu');
      for (let k = headRow + 1; k < hist.length; k++) {
        if (String(cell(hist, k, c)) !== dot) continue;
        const tin = (hist[k] || []).find(v => /^\[THÔNG BÁO/.test(String(v)));
        if (tin) { tinChung = tin; break; }
      }
    }

    const statusCol = findPeriodCol(track, nameRow, dot), prevCol = findPeriodCol(track, nameRow, Number(dot) - 1); // 1-based
    const rows = [];
    for (let k = 0; k < COUNT; k++) {
      const r = track[nameRow + 1 + k] || [], name = cell([r], 0, nameCol), eng = cell([r], 0, nameCol + 1);
      if (!name) continue;
      const row = TRACK_FIRST + nameRow + 1 + k, auto = text(msg, k + 1, 0), key = ['ZALO', tab, 'D' + dot, name, eng].join('|');
      let sua = {};
      try { sua = JSON.parse(kho[key] || '{}'); } catch (e) { sua = {}; }
      const status = statusCol > 0 ? String(cell([r], 0, statusCol - 1)) : '';
      const tienSheet = statusCol > 0 ? digits(cell([r], 0, statusCol)) : 0;
      const date = statusCol > 0 ? String(cell([r], 0, statusCol + 1)) : '';
      const tienAuto = totalIn(auto);
      // The owner's rule: only Sửa riêng keeps a hand figure. Any other cell that differs is rewritten by the daily job at 06:00; until then the message is right.
      const stale = !sua.msg && !sua.amt && tienSheet > 0 && tienAuto > 0 && tienSheet !== tienAuto;
      let soTien = String(sua.amt || '').replace(/\D/g, '');
      if (sua.msg || sua.amt) { if (!sua.daGhi && tienSheet > 0) soTien = ''; }
      if (soTien && tienSheet > 0 && tienSheet !== Number(soTien)) soTien = String(tienSheet);
      if (!soTien && tienSheet > 0 && tienSheet !== tienAuto && !stale) soTien = String(tienSheet);
      const prevStatus = prevCol > 0 ? String(cell([r], 0, prevCol - 1)).trim() : '';
      const prev = prevCol > 0 ? { dot: String(Number(dot) - 1), status: prevStatus, amount: digits(cell([r], 0, prevCol)), date: String(cell([r], 0, prevCol + 1)), paid: isPaid(prevStatus) } : null;
      rows.push({ disc: String(cell([r], 0, nameCol + 3)).trim(), stale, prevStatus, prev, row, name, eng, key, auto, manual: String(sua.msg || '').trim(), soTien, tienSheet, tienAuto, status, date,
        paid: isPaid(status), tuSheet: !!soTien && soTien !== String(sua.amt || ''), hadOverride: !!(sua.msg || sua.amt),
        link: (auto.match(/https:\/\/img\.vietqr\.io\/\S+/) || [''])[0], goc: sua.goc });
    }
    const mau = (rows.find(x => x.link) || {}).link || '';
    const boQr = s => s.replace(/\n?Mã QR chuyển khoản[^\n]*/, '');
    const items = rows.map(x => {
      const nm = x.name + (x.eng ? ' (' + x.eng + ')' : '');
      const nhap = tinChung ? tinChung.replace(/^(LỚP [^\n]*)/m, '$1\nHọc viên: ' + nm) : '';
      let msgOut = x.manual || x.auto;
      if (!msgOut && x.soTien) msgOut = nhap;
      const base = { disc: x.disc, prev: x.prev, row: x.row, name: x.name, eng: x.eng, key: x.key, paid: x.paid, status: x.status, date: x.date,
        tienSheet: x.tienSheet, tienAuto: x.tienAuto, goc: x.goc, hadOverride: x.hadOverride };
      if (!msgOut) return Object.assign(base, { trong: true, msg: '', qr: '', rieng: false, manual: '', soTien: '', auto: '', nhap: boQr(nhap), amount: x.tienSheet, warn: '' });
      // A typed amount wins over the merged one, so the message must not still claim the merge.
      const g = !x.manual && (!x.soTien || Number(x.soTien) === x.tienAuto) ? gopIn(x.auto) : null;
      if (!x.manual && !g) msgOut = msgOut.replace(GOP_LINE, '');
      let qr = x.link;
      if (!qr && mau) qr = mau.replace(/addInfo=[^&]*/, 'addInfo=' + encodeURIComponent(
        decodeURIComponent((mau.match(/addInfo=([^&]*)/) || ['', ''])[1]).replace(/\S+$/, x.eng || x.name)));
      let tien = x.soTien;
      if (tien) msgOut = msgOut.replace(/(Tổng số tiền cần thanh toán là:\s*)[\d.,]+/i, '$1' + fmt(tien));
      else if (x.manual) tien = String(totalIn(x.manual) || '');
      if (tien && qr) qr = qr.replace(/amount=\d+/, 'amount=' + tien);
      // Flags cases like a late joiner whose message deducts sessions while the table still holds the full fee.
      const warn = !x.manual && !x.paid && !x.stale && x.tienAuto > 0 && x.tienSheet > 0 && x.tienSheet !== x.tienAuto
        ? 'Số trong bảng (' + fmt(x.tienSheet) + ' đ) khác số tự tính trong tin (' + fmt(x.tienAuto) + ' đ). Thiệp đang theo số trong bảng.' : '';
      return Object.assign(base, { msg: boQr(msgOut), qr, rieng: !!(x.manual || (x.soTien && !x.tuSheet)), manual: x.manual ? boQr(x.manual) : '',
        soTien: x.soTien, auto: boQr(x.auto), amount: Number(tien) || (x.stale ? x.tienAuto : x.tienSheet || x.tienAuto), warn, stale: x.stale,
        gop: g ? { dot: g.dot, amount: g.amount, blank: !x.prevStatus } : null });
    });
    const label = name => { let out = ''; top.forEach(r => (r || []).forEach((v, c) => { if (v === name && !out) out = String(r[c + 1] || ''); })); return out; };
    const book = n => { const v = label('Tên sách/tài liệu ' + n).trim(); return v === '0' ? '' : v; };
    return { tab, lop: 'LỚP ' + tab, dot, statusCol, items, nextDot: label('Đợt học cần thu'), dueDate: label('Ngày cần thu tiền'), dueState: label('Trạng thái thu tiền'),
      prevEnd: label('Ngày kết thúc đợt ngay trước đợt đã qua'), start: label('Ngày đầu đợt đã qua'), end: label('Ngày kết thúc đợt đã qua'), sessions: label('Số buổi đợt mới'), fee: label('Học phí đợt mới'),
      bookTotal: label('Tổng tiền sách/tài liệu'), total: label('Tổng cần thu'), books: [1, 2, 3, 4, 5].map(book),
      lessons: (raw.lessons || []).map(r => dayOf((r || [])[0])).filter(n => !isNaN(n)), history: pastDots(hist, headRow) };
  }

  /** What the message formula will say once the previous đợt counts as paid, so a tick shows at once instead of after the recalculation. */
  function dropGop(it) {
    if (!it.gop) return;
    const own = it.amount - it.gop.amount, total = /(Tổng số tiền cần thanh toán là:\s*)[\d.,]+/i;
    it.msg = it.msg.replace(GOP_LINE, '').replace(total, '$1' + fmt(own));
    it.auto = String(it.auto || '').replace(GOP_LINE, '').replace(total, '$1' + fmt(own));
    it.qr = String(it.qr || '').replace(/amount=\d+/, 'amount=' + own);
    it.amount = it.tienAuto = own; it.stale = it.tienSheet > 0 && it.tienSheet !== own; it.gop = null;
  }

  /** The reverse of dropGop, for undoing that tick. Items whose card does not follow the formula (typed amount, own message, no message) stay as they are. */
  function addGop(it, dot, amount, blank) {
    if (it.gop || it.paid || it.trong || it.manual || it.soTien || !(amount > 0)) return;
    const own = it.amount, sum = own + amount, total = /(Tổng số tiền cần thanh toán là:\s*)[\d.,]+/i, nm = it.name + (it.eng ? ' (' + it.eng + ')' : '');
    const line = '\n- Con ' + nm + ' còn học phí Đợt ' + dot + ' chưa thanh toán: ' + fmt(amount) + ' đồng, nay gộp chung với học phí đợt này (' + fmt(own) + ' đồng). Nếu Quý Phụ huynh đã chuyển khoản đợt trước, xin gửi lại ảnh giao dịch để cô kiểm tra.';
    const put = s => String(s || '').replace(/(\n+Tổng số tiền cần thanh toán là:)/i, (m, t) => line + t).replace(total, '$1' + fmt(sum));
    it.msg = put(it.msg); it.auto = put(it.auto);
    it.qr = String(it.qr || '').replace(/amount=\d+/, 'amount=' + sum);
    it.amount = it.tienAuto = sum; it.stale = it.tienSheet > 0 && it.tienSheet !== sum; it.gop = { dot: String(dot), amount, blank: !!blank };
  }

  /** Collections already recorded in J:T, newest first. The first row under the header is the live formula for the coming đợt, so it is left out. */
  function pastDots(hist, headRow) {
    if (headRow < 0) return [];
    const c = hist[headRow].indexOf('Đợt thu');
    return hist.slice(headRow + 2).filter(r => /^\d+$/.test(String((r || [])[c]).trim())).map(r => ({
      dot: String(r[c]).trim(), paidOn: String(r[c - 2] || ''), from: String(r[c + 1] || ''), to: String(r[c + 2] || ''), fee: String(r[c + 3] || ''),
      book: /^0?$/.test(String(r[c + 4] || '').trim()) ? '' : String(r[c + 4]).trim(), total: String(r[c + 6] || ''), detail: String(r[c + 8] || '') }))
      .sort((a, b) => Number(b.dot) - Number(a.dot));
  }

  /**
   * Ranges read before a write. Names, markers and headers are often formulas, so `values` reads what they show;
   * `cells` reads formulas, so typed values and the amount/date cells can be told apart.
   */
  function freshRanges(tab, rows) {
    const q = quote(tab), values = [q + '!ED383', q + '!BQ3:BR32', q + '!F382:BM382'], cells = [q + '!BT3:EB32'];
    rows.forEach(r => { values.push(q + '!B' + r + ':C' + r, q + '!EC' + r + ':ED' + r); cells.push(q + '!F' + r + ':BM' + r); });
    return { values, cells };
  }
  /** The k-th requested row's data, from the results of the two freshRanges reads. */
  function freshAt(values, cells, k) {
    return { marker: values[0], ledgerNames: values[1], headers: values[2], names: values[3 + k * 2], live: values[4 + k * 2], ledger: cells[0], block: cells[1 + k] };
  }

  /** Confirms the row still belongs to this student and finds the ledger row; throws rather than guessing. */
  function locate(tab, it, fresh) {
    if (String(cell(fresh.marker, 0, 0)).indexOf(COMPACT_MARKER) !== 0) throw new Error(tab + ' chưa dùng sổ mới, hãy tick trong Sheet.');
    if (clean(cell(fresh.names, 0, 0)) !== clean(it.name) || clean(cell(fresh.names, 0, 1)) !== clean(it.eng)) throw new Error('Dòng ' + it.row + ' đã đổi học sinh, hãy tải lại lớp.');
    if (cell(fresh.live, 0, 0) !== ACTIVE) throw new Error(it.name + ' không còn trong live.');
    let slot; try { slot = JSON.parse(cell(fresh.live, 0, 1)); } catch (e) { throw new Error('Không đọc được mã của ' + it.name + '.'); }
    if (clean(slot.name) !== clean(it.name) || clean(slot.eng) !== clean(it.eng)) throw new Error('Mã dòng ' + it.row + ' không khớp ' + it.name + '.');
    const hits = [];
    (fresh.ledgerNames || []).forEach((r, j) => { if (cell([r], 0, 0) && clean(cell([r], 0, 0)) === clean(it.name) && clean(cell([r], 0, 1)) === clean(it.eng)) hits.push(j); });
    if (hits.length !== 1) throw new Error('Sổ lưu không khớp duy nhất: ' + it.name + '.');
    return hits[0];
  }

  /** Status/amount/date for the period, visible and ledger. fresh.block is F:BM of the row; fresh.ledger is BT3:EB32. */
  function periodCells(tab, it, fresh, dot) {
    const li = locate(tab, it, fresh);
    const off = (fresh.headers[0] || []).findIndex(h => String(h).trim().toUpperCase() === 'ĐỢT ' + dot);
    if (off < 0 || off % 3 !== 0) throw new Error('Không thấy cột đợt ' + dot + '.');
    const statusCol = 6 + off, ledgerRow = LEDGER_FIRST + li;
    const ledgerRowVals = (fresh.ledger || [])[li] || [];
    const lg = i => { const x = ledgerRowVals[statusCol + LEDGER_OFFSET - 72 + i]; return x === undefined || x === null ? '' : x; };
    const vis = i => cell(fresh.block, 0, off + i);
    return { statusCol, ledgerRow, vis, lg,
      vA1: i => a1(tab, statusCol + i, it.row), lA1: i => a1(tab, statusCol + i + LEDGER_OFFSET, ledgerRow) };
  }
  const isLet = v => /^=LET\(/.test(String(v));
  const isLiveWrap = (v, row) => String(v).indexOf('=IF($EC' + row + '=') === 0;

  /** Writes for "paid": the ledger always; visible cells only where they do not already read the ledger. */
  function planPaid(tab, it, fresh, dot, dateText, amount) {
    const p = periodCells(tab, it, fresh, dot), up = [];
    up.push({ range: p.lA1(0), values: [['Đã nộp']] }, { range: p.lA1(2), values: [[dateText]] });
    const amt = Number(amount) || 0;
    // A stale auto-filled cell gets the right amount before the paid status locks it; a cell changed by hand since then is left alone.
    const inCell = isLet(p.vis(1)) ? digits(p.lg(1)) : isLiveWrap(p.vis(1), it.row) ? digits((String(p.vis(1)).match(/;(\d+);/) || [])[1] || '') : digits(p.vis(1));
    const fix = !!it.stale && amt > 0 && inCell === Number(it.tienSheet);
    if ((p.lg(1) === '' || fix) && amt > 0) up.push({ range: p.lA1(1), values: [[amt]] });
    if (!isLet(p.vis(0))) up.push({ range: p.vA1(0), values: [[liveFormula(it.row, '"Đã nộp"')]] });
    if (!isLet(p.vis(1)) && (p.vis(1) === '' || fix) && amt > 0) up.push({ range: p.vA1(1), values: [[liveFormula(it.row, amt)]] });
    if (!isLet(p.vis(2))) up.push({ range: p.vA1(2), values: [[dateText]] });
    return up;
  }

  /**
   * A discount as the class formulas read it: '' none, a whole number of đồng per đợt, 'n%', or the free-tuition text.
   * Throws on anything else, because a bare 20 would read as 20 đồng.
   */
  function discInput(raw) {
    const s = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
    if (!s) return '';
    if (/miễn|mien/.test(s)) return 'miễn học phí';
    const pct = s.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
    if (pct) { const n = Number(pct[1].replace(',', '.')); if (n > 0 && n < 100) return n + '%'; throw new Error('Phần trăm giảm phải từ trên 0 đến dưới 100.'); }
    const n = digits(s);
    if (/^[\d.,\s]+(đ|đồng|d)?$/.test(s) && n >= 1000) return n;
    throw new Error('Nhập số tiền giảm mỗi đợt, ví dụ 600000, hoặc phần trăm, ví dụ 20%.');
  }
  /** The value a class row or a sheet shows, in words for the app: 600000, 0,2 and 20% all come through here. */
  function discText(v) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (!s) return '';
    if (/miễn|mien/i.test(s)) return 'Miễn học phí';
    if (/%$/.test(s)) return s;
    const n = Number(s.replace(',', '.'));
    if (n > 0 && n < 1) return Math.round(n * 1000) / 10 + '%';
    return digits(s) ? fmt(digits(s)) + ' đ' : s;
  }
  /** The same value in the form discInput takes, to preselect it. */
  function discValue(v) { const t = discText(v); return /^Miễn/.test(t) ? 'miễn học phí' : /%$/.test(t) ? t : String(digits(t) || ''); }
  /** Writes for a student's discount: the row's E cell and its ledger copy, which is what keeps it through a roster sync. curE is the cell's formula. */
  function planDiscount(tab, it, fresh, disc, curE) {
    const li = locate(tab, it, fresh), up = [], ledger = a1(tab, 72, LEDGER_FIRST + li);
    const pct = String(disc).match(/^(.+)%$/);
    const expr = pct ? 'TO_PERCENT(' + String(Number(pct[1]) / 100).replace('.', ',') + ')' : typeof disc === 'number' ? disc : '"' + disc + '"';
    up.push({ range: ledger, values: [[pct ? String(disc) : disc]] });
    if (!isLet(curE)) up.push({ range: a1(tab, 5, it.row), values: [[disc === '' ? '' : liveFormula(it.row, expr)]] });
    return up;
  }

  /** Undo of planPaid: the amount stays because it is still what this student owes. */
  function planUnpaid(tab, it, fresh, dot) {
    // restore puts back a status the tick replaced, such as a typed "Chưa nộp".
    const back = it.restore || '', p = periodCells(tab, it, fresh, dot), up = [{ range: p.lA1(0), values: [[back]] }, { range: p.lA1(2), values: [['']] }];
    if (!isLet(p.vis(0))) up.push({ range: p.vA1(0), values: [[back]] });
    if (!isLet(p.vis(2))) up.push({ range: p.vA1(2), values: [['']] });
    return up;
  }

  /** Same result as luuRieng: the message store plus the period's amount in table and ledger. */
  function planOverride(tab, it, fresh, dot, msg, amtText, storeValues) {
    msg = String(msg || '').trim();
    let amt = String(amtText || '').replace(/\D/g, '');
    if (!amt && msg) amt = String(totalIn(msg) || '');
    const p = periodCells(tab, it, fresh, dot), up = [], cu = (() => { try { return JSON.parse(storeRow_(storeValues, it.key).value || '{}'); } catch (e) { return {}; } })();
    let goc = cu.goc;
    const put = v => {
      up.push({ range: p.vA1(1), values: [[v === '' ? '' : liveFormula(it.row, Number(v))]] }, { range: p.lA1(1), values: [[v === '' ? '' : Number(v)]] });
    };
    if (amt) { if (goc === undefined) goc = [p.vis(1), p.lg(1)]; put(amt); }
    else if (goc !== undefined) {
      if (digits(p.lg(1)) === Number(cu.amt)) put(goc[1] === undefined || goc[1] === '' ? '' : digits(goc[1]));
      goc = undefined;
    }
    const value = !msg && !amt ? '' : JSON.stringify({ msg, amt, goc, daGhi: true });
    const at = storeRow_(storeValues, it.key).index;
    return { updates: up, store: at >= 0 ? { row: at + 1, key: value ? it.key : '', value } : (value ? { row: -1, key: it.key, value } : null) };
  }
  function storeRow_(values, key) {
    const index = (values || []).findIndex(r => r && r[0] === key);
    return { index, value: index >= 0 ? (values[index][1] || '') : '' };
  }

  /* ---------- Roster movements (new, transfer, leaving) ---------- */
  const DAY = 86400000, TRANSFER_WINDOW = 7 * DAY, LEAVE_WAIT = DAY;
  const EXIT_ACCOUNT = 'Triệu Thị Vân Trang - MB Bank';
  const sameName = (a, b) => clean(a) === clean(b);

  /**
   * events: rows of _BIEN_DONG_HS without the header [time, class, vao|ra, name, english, stt, tx, ignored].
   * newRows: HS MỚI B:D [class, name, english]. exitRows: HS NGHI_CHUYEN LOP [name, english, reason, destination, class].
   * Returns what still needs a decision; a leaver is not offered until the 24-hour wait is over.
   */
  function classifyMoves(events, newRows, exitRows, now) {
    const seen = {}, list = [];
    (events || []).forEach((r, i) => {
      if (!r || !r[1] || !r[3]) return;
      const id = [r[6], r[1], r[2], clean(r[3]), clean(r[4])].join('|');
      if (seen[id]) { seen[id].rows.push(i + 2); return; }
      const at = new Date(r[0]).getTime() || 0;
      seen[id] = { at, cls: String(r[1]), type: r[2], name: String(r[3]), eng: String(r[4] || ''), rows: [i + 2], ignored: !!r[7], blocks: parseBlocks(r[8]) };
      list.push(seen[id]);
    });
    list.sort((a, b) => a.at - b.at);
    const pairOf = new Map();
    list.filter(e => e.type === 'ra').forEach(out => {
      const near = list.filter(x => x.type === 'vao' && !pairOf.has(x) && sameName(x.name, out.name) && Math.abs(x.at - out.at) <= TRANSFER_WINDOW);
      const other = near.filter(x => x.cls !== out.cls);
      const again = near.filter(x => x.cls === out.cls);
      const sameEng = other.filter(x => clean(x.eng) === clean(out.eng));
      const pick = sameEng.length === 1 ? sameEng[0] : other.length === 1 ? other[0] : null;
      if (pick) { pairOf.set(out, pick); pairOf.set(pick, out); out.unsureEng = clean(pick.eng) !== clean(out.eng); }
      else if (other.length > 1) out.manyTargets = other.map(x => x.cls);
      else if (again.length) { pairOf.set(out, again[0]); pairOf.set(again[0], out); out.cameBack = again[0].cameBack = true; }
    });
    const hasNew = e => (newRows || []).some(r => r && r[0] === e.cls && sameName(r[1], e.name));
    // A row added by hand before the roster caught up: the later roster change is that same move, not a new one.
    const movedByHand = e => (exitRows || []).some(r => r && sameName(r[0], e.name) && String(r[2] || '') === 'Chuyển lớp'
      && (e.type === 'ra' ? String(r[4] || '') === e.cls : String(r[3] || '') === e.cls));
    const hasExit = (e, reason, dest) => (exitRows || []).some(r => r && sameName(r[0], e.name) && String(r[2] || '') === reason
      && (reason === 'Chuyển lớp' ? String(r[3] || '') === dest : String(r[4] || '') === e.cls));
    const out = [];
    list.forEach(e => {
      if (e.ignored || e.cameBack) return;
      const pair = pairOf.get(e);
      if (pair && e.type === 'vao') return; // the "ra" side of a pair reports the transfer
      if (!pair && movedByHand(e)) return;
      const base = { name: e.name, eng: e.eng, at: e.at, rows: pair ? e.rows.concat(pair.rows) : e.rows };
      if (pair) {
        if (hasExit(e, 'Chuyển lớp', pair.cls)) return;
        out.push(Object.assign(base, { kind: 'chuyen', from: e.cls, to: pair.cls, engTo: pair.eng, unsure: !!e.unsureEng, id: 'chuyen|' + e.rows[0] }));
      } else if (e.type === 'vao') {
        if (hasNew(e)) return;
        out.push(Object.assign(base, { kind: 'moi', to: e.cls, id: 'moi|' + e.rows[0] }));
      } else {
        if (hasExit(e, 'Nghỉ học')) return;
        const left = LEAVE_WAIT - (now - e.at);
        out.push(Object.assign(base, { kind: 'nghi', from: e.cls, blocks: e.blocks, wait: left > 0, waitMs: Math.max(0, left), targets: e.manyTargets || null, id: 'nghi|' + e.rows[0] }));
      }
    });
    return out;
  }

  function parseBlocks(text) { try { const v = JSON.parse(text || 'null'); return Array.isArray(v) ? v : null; } catch (e) { return null; } }
  function dayNumber(text) {
    const m = String(text || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : 0;
  }
  /**
   * Whether a leaving student still owes for the date they left. The dates on a class history row labelled đợt n are the
   * lessons of đợt n-1: row n only says when đợt n is collected. After the last known lesson the student is in the newest đợt.
   * hist: J18:N36 of the class [collect date, type, đợt, first lesson, last lesson]. blocks: the student's đợt saved when they left.
   */
  function leaveStatus(hist, blocks, dateText) {
    const day = dayNumber(dateText), rows = (hist || []).map(r => ({ dot: Number(String((r || [])[2] || '').replace(/\D/g, '')), from: dayNumber((r || [])[3]), to: dayNumber((r || [])[4]) })).filter(r => r.dot && r.from && r.to);
    if (!day || !rows.length) return { state: 'khong-ro', dot: 0, noSchedule: false };
    const hit = rows.find(r => r.from <= day && day <= r.to), last = rows.reduce((a, b) => (b.to > a.to ? b : a));
    const dot = hit ? hit.dot - 1 : day > last.to ? last.dot : 0, noSchedule = !hit && day > last.to;
    if (!dot) return { state: 'khong-ro', dot: 0, noSchedule: false };
    const block = (blocks || []).find(b => Number(String(b.d || '').replace(/\D/g, '')) === dot);
    if (!block) return { state: 'khong-ro', dot, noSchedule };
    // A blank status is not proof of owing: only an explicit "Chưa nộp" is, otherwise the owner decides.
    return { state: isPaid(block.s) || block.n ? 'da-dong' : /chưa nộp|chua nop/i.test(String(block.s)) ? 'chua-dong' : 'khong-ro', dot, noSchedule };
  }

  const NEW_TAB = 'HS MỚI', EXIT_TAB = 'HS NGHI_CHUYEN LOP';

  /** Input cells for an approved move, as {tab, firstDataRow, nameCol, cells: {column: value}}. Formula columns are filled separately. */
  /**
   * This tab takes its discount off the bill as one amount, but a discount lowers the price of each session, and these rows bill
   * only part of a đợt. So the cell holds the tuition's share of it, worked out from the row's own tuition (O) and {r} is its row.
   */
  function exitDiscount(disc) {
    const pct = String(disc).match(/^(.+)%$/);
    if (pct) return '=ROUND($O{r}*' + pct[1].replace('.', ',') + '%;0)';
    if (typeof disc !== 'number') return disc;
    return '=ROUND($O{r}*' + disc + `/INDIRECT("'"&$X{r}&"'!$B$6");0)`;
  }
  function moveInputs(move, form) {
    const books = form.books || [], date = form.date || '';
    const cells = {};
    if (move.kind === 'moi') {
      Object.assign(cells, { B: move.to, C: move.name, D: move.eng, E: date });
      if (form.disc) cells.F = form.disc;
      ['I', 'J', 'K', 'L', 'M'].forEach((c, i) => { if (books[i]) cells[c] = books[i]; });
      return { tab: NEW_TAB, firstDataRow: 3, nameCol: 'C', cells };
    }
    // "Đợt cần thu" (I) is left to its formula, which works the đợt out from the date.
    Object.assign(cells, { B: move.name, C: move.eng, F: move.kind === 'chuyen' ? 'Chuyển lớp' : 'Nghỉ học', H: date, X: move.from });
    if (move.kind === 'chuyen') cells.G = move.to; else cells.W = EXIT_ACCOUNT;
    // A leaver who already paid can still owe for books: tuition is set to 0 on this row, so the total is the books alone.
    if (form.onlyBooks) cells.O = 0;
    if (form.disc) cells.E = exitDiscount(form.disc);
    ['P', 'Q', 'R', 'S', 'T'].forEach((c, i) => { if (books[i]) cells[c] = books[i]; });
    return { tab: EXIT_TAB, firstDataRow: 4, nameCol: 'B', cells, noCopy: ['E'] };
  }

  const BANK_CODE = { 'MB Bank': 'MB', 'VietinBank': 'ICB' };
  const ascii = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  /** The QR address for a message that names its account; '' when the account or bank cannot be read. */
  function qrFromMessage(msg, amount, info) {
    const m = String(msg).match(/STK\s*(\d+)\s*–\s*([^–]+?)\s*–\s*(.+?)(?:,\s*đồng thời|\s+và gửi|\s*\n|$)/);
    if (!m || !BANK_CODE[m[2]] || !amount) return '';
    return 'https://img.vietqr.io/image/' + BANK_CODE[m[2]] + '-' + m[1] + '-compact2.png?amount=' + amount
      + '&addInfo=' + encodeURIComponent(ascii(info).toUpperCase()) + '&accountName=' + encodeURIComponent(ascii(m[3]).toUpperCase());
  }

  /**
   * Leavers and transfers recorded lately, by "class|name". A student added by hand can still be on the class list until the roster
   * catches up, and must not be chased for that class. Sixty days, so someone who later came back is billed again.
   */
  function recentExits(exitRows, today) {
    const out = {};
    (exitRows || []).forEach(r => {
      if (!r || !r[1] || !r[23]) return;
      const day = dayOf(r[7]), kind = String(r[5] || '');
      if (isNaN(day) || today - day > 60 || !/Nghỉ học|Chuyển lớp/.test(kind)) return;
      out[String(r[23]).trim() + '|' + clean(r[1])] = { kind, date: String(r[7]), to: String(r[6] || '') };
    });
    return out;
  }
  /** F382:BM382 and a student's F:BM row as the blocks leaveStatus reads, for a move that has no roster snapshot. */
  function blocksOf(heads, row) {
    const out = [], h = (heads && heads[0]) || [], r = (row && row[0]) || [];
    for (let c = 0; c < h.length; c += 3) if (String(h[c] || '').trim()) out.push({ d: String(h[c]).trim(), s: String(r[c] || ''), n: String(r[c + 2] || '') });
    return out;
  }

  /**
   * The bill for a leaver the Sheet cannot price because the running đợt has no saved lesson list: lessons from the Schedule,
   * the same words and sums as the leaver formula. It reads the row's E cell as that formula does, and refuses any E it cannot read.
   * in: { days, date, join, fee, sessions, bookFee, bookList, discCell, name, eng, cls, account, dot, used }
   */
  function leaveBill(p) {
    const fromDay = p.join && p.join > (p.days[0] || 0) ? p.join : p.days[0];
    const within = p.days.filter(d => d >= fromDay && d <= p.date);
    if (!p.days.length) return { error: 'Chưa có lịch buổi học của đợt này.' };
    // A date between two đợt has no lesson to count, so the owner says how many; the Sheet stops at the same place.
    const typed = !(p.used === undefined || p.used === '');
    if (!typed && (p.date < p.days[0] || p.date > p.days[p.days.length - 1])) return { error: 'Ngày nghỉ nằm ngoài đợt ' + p.dot + ' (' + dayText(p.days[0]) + ' đến ' + dayText(p.days[p.days.length - 1]) + '). Hãy nhập số buổi em đã học mà chưa đóng, chưa học buổi nào thì nhập 0.' };
    if (!(p.fee > 0) || !(p.sessions > 0)) return { error: 'Chưa đọc được học phí của lớp.' };
    const used = typed ? Number(p.used) : within.length;
    if (!Number.isInteger(used) || used < 0 || used > p.sessions) return { error: 'Số buổi phải từ 0 đến ' + p.sessions + '.' };
    const per = p.fee / p.sessions, tuition = Math.round(used * per), book = p.bookFee || 0;
    const cell = String(p.discCell === undefined || p.discCell === null ? '' : p.discCell).trim(), base = tuition + book;
    let share, off, m;
    if (/miễn|mien/i.test(cell.normalize('NFC'))) off = tuition;
    else if (!cell) off = 0;
    else if ((m = cell.match(/^=ROUND\(\$O\d+\*(\d+)\/INDIRECT/))) { share = Math.round(tuition * Number(m[1]) / p.fee); off = share; }
    else if ((m = cell.match(/^=ROUND\(\$O\d+\*([\d.,]+)%;0\)$/))) { share = Math.round(tuition * Number(m[1].replace(',', '.')) / 100); off = share; }
    else if (/^[\d.,]+$/.test(cell)) { const v = Number(cell.replace(',', '.')); off = v <= 1 ? Math.round(base * v) : v; }
    else return { error: 'Không đọc được ô giảm giá của dòng này, hãy mở Sheet kiểm tra.' };
    const total = Math.max(0, base - off), nm = p.name + (p.eng ? ' (' + p.eng + ')' : ''), two = n => ('0' + n).slice(-2);
    const msg = ['[THÔNG BÁO THU HỌC PHÍ]', 'LỚP ' + String(p.cls).toUpperCase(), '',
      used ? 'Do con ' + nm + ' học đến hết ngày ' + dayText(p.date) + ', là buổi thứ ' + two(used) + ' của đợt học mới và xin dừng lớp, cô xin gửi Quý Phụ huynh thông tin học phí cần hoàn tất như sau:'
        : 'Do con ' + nm + ' xin dừng lớp từ ngày ' + dayText(p.date) + ' và chưa học buổi nào của đợt học mới, cô xin gửi Quý Phụ huynh thông tin học phí cần hoàn tất như sau:', '',
      '- Học phí ' + two(used) + ' buổi: ' + fmt(tuition) + ' đồng'].concat(
      book > 0 ? ['- Tiền sách, tài liệu (' + p.bookList + '): ' + fmt(book) + ' đồng'] : [],
      off > 0 ? ['- Chiết khấu/điều chỉnh số tiền còn phải thu: ' + fmt(base - total) + ' đồng'] : [],
      ['', 'Tổng số tiền cần thanh toán: ' + fmt(total) + ' đồng.', '',
        total > 0 ? 'Kính nhờ Quý Phụ huynh chuyển khoản vào ' + p.account + ' và gửi lại ảnh giao dịch thành công để cô đối soát.' : 'Hiện không cần thanh toán thêm.', '',
        'Trân trọng cảm ơn Quý Phụ huynh!']).join('\n');
    return { used, counted: within.length, per, tuition, book, off: base - total, total, msg, share };
  }

  /** Unpaid rows of both intake tabs that are ready to collect or need checking. Rows come from row 3 (HS MỚI, A:U) and row 4 (HS NGHI, A:X). */
  function intakeDue(newRows, exitRows) {
    const out = [];
    const add = (o) => {
      const amount = digits(o.amountText), problem = /CẦN KIỂM TRA/.test(o.amountText + ' ' + o.msg);
      // Tuition set to 0 because it was already paid, no books: nothing to collect, whatever the schedule check says.
      if (o.noFee && !amount) return;
      // A payment date counts as paid even when the status cell is blank.
      if (isPaid(o.status) || o.paidDate || /chưa thu ngay/i.test(o.status) || free(o) || (!amount && !problem)) return;
      const tag = o.kind === 'moi' ? 'MOI' : o.kind === 'chuyen' ? 'CHUYEN' : 'NGHI';
      const info = String(o.cls).replace(/\s+/g, '') + ' ' + tag + ' ' + (o.eng || o.name);
      const reason = problem ? ((o.amountText + '\n' + o.msg).match(/CẦN KIỂM TRA:[^\n]*/) || [''])[0].replace('CẦN KIỂM TRA: ', '') : '';
      out.push(Object.assign(o, { amount: problem ? 0 : amount, problem, reason, key: o.tab + '|' + o.row, trong: false,
        qr: problem ? '' : qrFromMessage(o.msg, amount, info), msg: o.msg }));
    };
    (newRows || []).forEach((r, i) => { if (r && r[2]) add({ disc: r[5], tab: NEW_TAB, row: i + 3, kind: 'moi', cls: r[1], name: r[2], eng: r[3] || '', amountText: String(r[15] || ''), status: String(r[16] || ''), paidDate: String(r[17] || ''), msg: String(r[19] || ''), statusCol: 'Q', dateCol: 'R' }); });
    (exitRows || []).forEach((r, i) => { if (r && r[1]) add({ noFee: String(r[14]).trim() === '0', disc: r[4], tab: EXIT_TAB, row: i + 4, kind: r[5] === 'Chuyển lớp' ? 'chuyen' : 'nghi', cls: r[5] === 'Chuyển lớp' ? r[6] : r[23], name: r[1], eng: r[2] || '', amountText: String(r[10] || ''), status: String(r[9] || ''), paidDate: String(r[11] || ''), msg: String(r[12] || ''), statusCol: 'J', dateCol: 'L' }); });
    return out;
  }

  function todayText(d) { const p = n => ('0' + n).slice(-2); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }

  /** Day number of 'd/m/yyyy' or 'dd.mm.yyyy'; NaN when the text holds no real date. */
  function dayOf(s) {
    const m = String(s).match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
    if (!m) return NaN;
    const t = Date.UTC(+m[3], +m[2] - 1, +m[1]), d = new Date(t);
    return d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1 ? t / 86400000 : NaN;
  }
  const dayText = n => { const d = new Date(n * 86400000), p = x => ('0' + x).slice(-2); return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };
  const dayNow = now => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;

  const CAL_GROUP = { 'ĐẾN HẠN THU': 'den', 'ĐÃ QUA': 'qua', 'SẮP THU': 'sap', 'CHƯA ĐẾN': 'chua' };
  /** TỔNG HỢP rows (A:K, from row 3) as a list sorted by due date. The status is the Sheet's own. Rows with no đợt (T1, TV2) are left out. */
  function calendar(rows) {
    return (rows || []).filter(r => r && r[0] && r[2] && !isNaN(dayOf(r[5]))).map(r => {
      const state = String(r[10] || '').trim();
      return { tab: String(r[0]).trim(), dot: String(r[2]), start: String(r[3] || ''), end: String(r[4] || ''), due: String(r[5]),
        book: /^0?$/.test(String(r[6] || '').trim()) ? '' : String(r[6]).trim(), total: digits(r[9]), state, group: CAL_GROUP[state] || 'chua' };
    }).sort((a, b) => dayOf(a.due) - dayOf(b.due));
  }

  const classKey = s => clean(s).replace(/\s+/g, '');
  /**
   * Tuition-class sessions of one Schedule week. a, d, m are columns A, D, M read from the same first row; toggles holds the rows
   * around the whole-day "Học / Nghỉ" row. A class marked "Nghỉ học", or on a day marked "Nghỉ", counts as off.
   */
  function weekSessions(a, d, m, toggles) {
    const head = (d || []).findIndex((r, i) => clean((r || [])[0]) === 'CLASS' && clean(((m || [])[i] || [])[0]) === 'CLASS STATUS');
    if (head < 0) return [];
    const flags = (toggles || []).find(r => r && /^(học|nghỉ)$/i.test(String(r[0] || '').trim())) || [], out = [];
    let day = NaN;
    for (let i = head + 1; i < d.length; i++) {
      const n = dayOf((a[i] || [])[0]);
      if (!isNaN(n)) day = n;
      const cls = classKey((d[i] || [])[0]), status = String((m[i] || [])[0] || '').trim();
      if (isNaN(day) || !/^(KIDS|FIGHTER|TA)\d+$/.test(cls) || !/^(Học|Nghỉ học)$/.test(status)) continue;
      out.push({ cls, day, off: status === 'Nghỉ học' || /^nghỉ/i.test(String(flags[(day + 3) % 7] || '')) });
    }
    return out;
  }

  /**
   * Where the tuition file's lessons of one class differ from the Schedule, only inside weeks the Schedule already has.
   * nghi: counted as a lesson but the Schedule is off; thieu: counted but the class is not on the Schedule; them: on the Schedule but not counted.
   */
  function scheduleGaps(lessons, sessions, weeks) {
    const covered = day => (weeks || []).some(w => w.from <= day && day <= w.to), byDay = new Map(), out = [];
    (sessions || []).forEach(s => byDay.set(s.day, byDay.has(s.day) ? byDay.get(s.day) && s.off : s.off));
    (lessons || []).filter(covered).forEach(day => {
      if (!byDay.has(day)) out.push({ day, type: 'thieu' });
      else if (byDay.get(day)) out.push({ day, type: 'nghi' });
    });
    if ((lessons || []).length) {
      const min = Math.min(...lessons), max = Math.max(...lessons), known = new Set(lessons);
      byDay.forEach((off, day) => { if (!off && day >= min && day <= max && !known.has(day)) out.push({ day, type: 'them' }); });
    }
    return out.sort((x, y) => x.day - y.day);
  }

  const WEEKDAY = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
  /** The weekdays a list of days falls on, Monday first, e.g. 'Thứ 4, Thứ 7'. */
  function weekdays(days) {
    return [...new Set((days || []).map(n => (n + 3) % 7))].sort((a, b) => a - b).map(k => WEEKDAY[k]).join(', ');
  }

  /**
   * The đợt's lessons as the Schedule has them: real sessions after the previous đợt ended, then the file's planned
   * days for weeks the Schedule does not have yet. Each is { day, known }, known meaning it came from the Schedule.
   */
  function scheduleLessons(prevEnd, count, sessions, lastWeekEnd, fileLessons) {
    const off = new Map();
    (sessions || []).forEach(s => off.set(s.day, off.has(s.day) ? off.get(s.day) && s.off : s.off));
    const known = [...off.keys()].filter(d => !off.get(d) && d > prevEnd).sort((a, b) => a - b).slice(0, count).map(day => ({ day, known: true }));
    const planned = (fileLessons || []).filter(d => d > lastWeekEnd).map(day => ({ day, known: false }));
    return known.concat(planned).slice(0, count);
  }

  /** Same key as hp_orAckKey_ in the Apps Script reminder, e.g. 'kids33|6'. */
  const ackKey = (tab, dot) => ascii(tab).toLowerCase().replace(/\s+/g, '') + '|' + Number(dot);

  /** Log rows [time, class, đợt, name, English name, student key, action, who] as class|đợt → key → latest mark. '*' is the whole class. */
  function sentIndex(rows) {
    const idx = {};
    (rows || []).forEach(r => {
      if (!r || !r[1] || !r[5]) return;
      const c = idx[r[1] + '|' + r[2]] = idx[r[1] + '|' + r[2]] || {};
      const was = c[r[5]], mark = { at: String(r[0] || ''), by: String(r[7] || '') };
      // Taking back a repeat reminder returns to the send before it, so the seven days count from that again.
      if (r[6] === 'bo') { if (was && was.before) c[r[5]] = was.before; else delete c[r[5]]; }
      else if (r[6] === 'nhac-lai') c[r[5]] = Object.assign(mark, { lan: ((was && was.lan) || 0) + 1, before: was });
      else c[r[5]] = mark;
    });
    return idx;
  }
  const REMIND_AFTER = 7, REMIND_EVERY = 2;
  /** The owner chose not to collect from this student this đợt, so nothing is due and nothing should nag. */
  const deferred = x => !x.paid && /chưa thu ngay|chua thu ngay/i.test(String(x.status || ''));
  /** Free tuition is never counted, whatever else the row says: the owner's rule. */
  const free = x => /miễn|mien/i.test(String(x.disc || '').normalize('NFC'));
  /** The log writes "dd/mm hh:mm" with no year: it is the latest such date not after today. */
  function sentDay(at, today) {
    const m = String(at).match(/^(\d{1,2})\/(\d{1,2})/);
    if (!m) return NaN;
    const y = new Date(today * 86400000).getUTCFullYear(), day = year => Date.UTC(year, +m[2] - 1, +m[1]) / 86400000;
    return day(y) > today + 1 ? day(y - 1) : day(y);
  }
  /**
   * Students still owing REMIND_AFTER days after their message went out, then every REMIND_EVERY days; a marked reminder counts
   * REMIND_EVERY days from itself. onCycle says whether today is one of those days, which the email uses. Classes ticked before
   * the log existed have no send date, so ackDue (the due date of a ticked class) stands in and the row says so.
   */
  function remindDue(items, marks, today, ackDue) {
    return (items || []).filter(x => !x.paid && !x.trong && x.amount > 0 && !deferred(x) && !free(x)).map(x => {
      const own = marks && marks[x.key], whole = marks && marks['*'];
      const known = [own, whole].filter(Boolean).map(m => sentDay(m.at, today)).filter(n => !isNaN(n));
      const from = known.length ? Math.max.apply(null, known) : Number(ackDue);
      if (!from || isNaN(from)) return null;
      const wait = own && own.lan && sentDay(own.at, today) === from ? REMIND_EVERY : REMIND_AFTER;
      if (today - from < wait) return null;
      return { item: x, from, days: today - from, onCycle: (today - from - wait) % REMIND_EVERY === 0, guess: !known.length, lan: (own && own.lan) || 0, blank: !x.date && !String(x.status || '').trim() };
    }).filter(Boolean);
  }

  /** Students with no "đã gửi" mark for a đợt. marks: one class|đợt entry of sentIndex; '*' is the whole-class tick. */
  function notMarked(students, marks) {
    if (marks && marks['*']) return [];
    return (students || []).filter(x => !(marks && marks[x.key]));
  }

  return { leaveBill, recentExits, blocksOf, free, deferred, remindDue, REMIND_AFTER, REMIND_EVERY, sentDay, notMarked, dayOf, dayText, dayNow, calendar, classKey, weekSessions, scheduleGaps, scheduleLessons, weekdays, ackKey, sentIndex, leaveStatus, classifyMoves, moveInputs, qrFromMessage, intakeDue, EXIT_ACCOUNT, NEW_TAB, EXIT_TAB, buildClass, dropGop, addGop, discInput, discText, discValue, planDiscount, locate, classRanges, freshRanges, freshAt, planPaid, planUnpaid, planOverride, findPeriodCol, colA1, quote, fmt, digits, clean, isPaid, todayText, ACTIVE };
});
