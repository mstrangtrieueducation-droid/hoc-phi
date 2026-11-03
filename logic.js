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

  /** Ranges to read for one class, in the order buildClass expects them. */
  function classRanges(tab) {
    return ['A1:E8', 'J17:U36', 'A' + TRACK_FIRST + ':BM413', 'BP40:BP70'].map(r => quote(tab) + '!' + r);
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

    const statusCol = findPeriodCol(track, nameRow, dot); // 1-based
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
      let soTien = String(sua.amt || '').replace(/\D/g, '');
      if (sua.msg || sua.amt) { if (!sua.daGhi && tienSheet > 0) soTien = ''; }
      if (soTien && tienSheet > 0 && tienSheet !== Number(soTien)) soTien = String(tienSheet);
      if (!soTien && tienSheet > 0 && tienSheet !== tienAuto) soTien = String(tienSheet);
      rows.push({ row, name, eng, key, auto, manual: String(sua.msg || '').trim(), soTien, tienSheet, tienAuto, status, date,
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
      const base = { row: x.row, name: x.name, eng: x.eng, key: x.key, paid: x.paid, status: x.status, date: x.date,
        tienSheet: x.tienSheet, tienAuto: x.tienAuto, goc: x.goc, hadOverride: x.hadOverride };
      if (!msgOut) return Object.assign(base, { trong: true, msg: '', qr: '', rieng: false, manual: '', soTien: '', auto: '', nhap: boQr(nhap), amount: x.tienSheet, warn: '' });
      let qr = x.link;
      if (!qr && mau) qr = mau.replace(/addInfo=[^&]*/, 'addInfo=' + encodeURIComponent(
        decodeURIComponent((mau.match(/addInfo=([^&]*)/) || ['', ''])[1]).replace(/\S+$/, x.eng || x.name)));
      let tien = x.soTien;
      if (tien) msgOut = msgOut.replace(/(Tổng số tiền cần thanh toán là:\s*)[\d.,]+/i, '$1' + fmt(tien));
      else if (x.manual) tien = String(totalIn(x.manual) || '');
      if (tien && qr) qr = qr.replace(/amount=\d+/, 'amount=' + tien);
      // Flags cases like a late joiner whose message deducts sessions while the table still holds the full fee.
      const warn = !x.manual && !x.paid && x.tienAuto > 0 && x.tienSheet > 0 && x.tienSheet !== x.tienAuto
        ? 'Số trong bảng (' + fmt(x.tienSheet) + ' đ) khác số tự tính trong tin (' + fmt(x.tienAuto) + ' đ). Thiệp đang theo số trong bảng.' : '';
      return Object.assign(base, { msg: boQr(msgOut), qr, rieng: !!(x.manual || (x.soTien && !x.tuSheet)), manual: x.manual ? boQr(x.manual) : '',
        soTien: x.soTien, auto: boQr(x.auto), amount: Number(tien) || x.tienSheet || x.tienAuto, warn });
    });
    const label = name => { let out = ''; top.forEach(r => (r || []).forEach((v, c) => { if (v === name && !out) out = String(r[c + 1] || ''); })); return out; };
    return { tab, lop: 'LỚP ' + tab, dot, statusCol, items, dueDate: label('Ngày cần thu tiền'), dueState: label('Trạng thái thu tiền') };
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
    if (p.lg(1) === '' && amt > 0) up.push({ range: p.lA1(1), values: [[amt]] });
    if (!isLet(p.vis(0))) up.push({ range: p.vA1(0), values: [[liveFormula(it.row, '"Đã nộp"')]] });
    if (!isLet(p.vis(1)) && p.vis(1) === '' && amt > 0) up.push({ range: p.vA1(1), values: [[liveFormula(it.row, amt)]] });
    if (!isLet(p.vis(2))) up.push({ range: p.vA1(2), values: [[dateText]] });
    return up;
  }

  /** Undo of planPaid: the amount stays because it is still what this student owes. */
  function planUnpaid(tab, it, fresh, dot) {
    const p = periodCells(tab, it, fresh, dot), up = [{ range: p.lA1(0), values: [['']] }, { range: p.lA1(2), values: [['']] }];
    if (!isLet(p.vis(0))) up.push({ range: p.vA1(0), values: [['']] });
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

  function todayText(d) { const p = n => ('0' + n).slice(-2); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); }

  return { buildClass, classRanges, freshRanges, freshAt, planPaid, planUnpaid, planOverride, findPeriodCol, colA1, quote, fmt, digits, clean, isPaid, todayText, ACTIVE };
});
