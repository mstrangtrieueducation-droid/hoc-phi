// Run: node test.js
const assert = require('assert');
const L = require('./logic.js');
const pad = (r, n) => { const a = r.slice(); while (a.length < n) a.push(''); return a; };

const tom = 'LỚP KIDS 31\nHọc viên: BÙI MINH TUỆ (TOM)\nTổng số tiền cần thanh toán là: 3.000.000 đồng.\nMã QR chuyển khoản (đã có sẵn số tiền và nội dung): https://img.vietqr.io/image/MB-3338366366-compact2.png?amount=3000000&addInfo=KIDS31%20D8%20TOM&accountName=X\nTrân trọng';
const chris = tom.replace(/BÙI MINH TUỆ \(TOM\)/, 'TẠ PHÚC HƯNG (CHISTOPHER)').replace('3.000.000', '2.160.000').replace('amount=3000000', 'amount=2160000').replace('20TOM', '20CHISTOPHER');
const raw = {
  top: [['Tên lớp', 'KIDS 31'], ['Đợt học cần thu', '8', '', 'Tin nhắn chung', 'LỚP KIDS 31\nChung']],
  hist: [['Ngày thu', 'Loại thu', 'Đợt thu'], ['27/10/2026', 'Thu đợt', '8', '', '', '', '', '', '', 'LỚP KIDS 31'], ['x', 'y', '8', '[THÔNG BÁO THU HỌC PHÍ]\nLỚP KIDS 31\nTổng số tiền cần thanh toán là: 3.600.000 đồng.']],
  track: [[], ['Thông tin học sinh', '', '', '', '', 'Đợt 8', '', '', 'Đợt 9'], ['STT', 'Họ tên Tiếng Việt', 'Tên Tiếng Anh', 'Ngày vào lớp', 'Miễn', 'Trạng thái', 'Số tiền', 'Ngày nộp'],
    ['1', 'BÙI MINH TUỆ', 'TOM', '', '600000', 'Chưa nộp', '3.000.000 đ'],
    ['2', 'TẠ PHÚC HƯNG', 'CHISTOPHER', '25/09/2026', '', 'Chưa nộp', '3.600.000 đ'],
    ['3', 'ĐÃ NỘP RỒI', 'PAID', '', '', 'Đã nộp', '3.600.000 đ', '01/11/2026'],
    ['4', 'CHƯA CÓ TIỀN', 'NONE']],
  msg: [['Tin nhắn gửi PH – đợt 8'], [tom], [chris], [''], ['']],
  kho: {}
};

// Message logic matches layDanhSachGuiZalo.
let c = L.buildClass('KIDS 31', raw);
assert.strictEqual(c.dot, '8');
assert.strictEqual(c.items[0].row, 384);
assert.strictEqual(c.items[0].amount, 3000000);
assert.ok(c.items[0].msg.includes('3.000.000'));
assert.ok(!c.items[0].msg.includes('Mã QR'), 'QR line removed from the message');
assert.ok(c.items[0].qr.includes('amount=3000000'));
assert.strictEqual(c.items[0].warn, '');
// Without Sửa riêng the message wins over the cell, which the daily job rewrites.
assert.strictEqual(c.items[1].amount, 2160000);
assert.ok(c.items[1].msg.includes('2.160.000'));
assert.ok(c.items[1].qr.includes('amount=2160000'));
assert.strictEqual(c.items[1].warn, '');
assert.strictEqual(c.items[1].stale, true);
assert.strictEqual(c.items[2].paid, true);
assert.strictEqual(c.items[3].trong, true);
assert.ok(c.items[3].nhap.includes('Học viên: CHƯA CÓ TIỀN (NONE)'));

// An override with a message, and the amount kept when the table holds the same number.
raw.kho = { 'ZALO|KIDS 31|D8|TẠ PHÚC HƯNG|CHISTOPHER': JSON.stringify({ msg: 'LỚP KIDS 31\nRiêng\nTổng số tiền cần thanh toán là: 2.160.000 đồng.', amt: '2160000', daGhi: true }) };
const t2 = JSON.parse(JSON.stringify(raw)); t2.track[4][6] = '2.160.000 đ';
c = L.buildClass('KIDS 31', t2);
assert.strictEqual(c.items[1].rieng, true);
assert.ok(c.items[1].qr.includes('amount=2160000'));
assert.strictEqual(c.items[1].warn, '');
// A hand edit after the save wins over the saved amount.
c = L.buildClass('KIDS 31', raw);
assert.ok(c.items[1].qr.includes('amount=3600000'));
raw.kho = {};

// Writes. Row 385, student slot 2, period 8 is the first block F:H, ledger BT:BV? status col 6 => 73 (BU).
const LET = '=LET(r;ROW();...)';
const ledger = []; ledger[1] = pad(['', '', 3600000, ''], 60);
const fresh = (over) => Object.assign({
  marker: [['HP_COMPACT_ID_V1|abc']], names: [['TẠ PHÚC HƯNG', 'CHISTOPHER']],
  live: [[L.ACTIVE, JSON.stringify({ stt: 2, name: 'TẠ PHÚC HƯNG', eng: 'CHISTOPHER', key: 'x' })]],
  ledgerNames: [['BÙI MINH TUỆ', 'TOM'], ['TẠ PHÚC HƯNG', 'CHISTOPHER']], headers: [['Đợt 8', '', '', 'Đợt 9']],
  block: [[LET, 3600000, LET]], ledger
}, over);
const it = { row: 385, name: 'TẠ PHÚC HƯNG', eng: 'CHISTOPHER', key: 'ZALO|KIDS 31|D8|TẠ PHÚC HƯNG|CHISTOPHER' };
const ranges = u => u.map(x => x.range);

// Status 6 => ledger 73 = BU, date 8 => 75 = BW, ledger row = 3 + 1 = 4 (same mapping as hpLiveOnEdit: date c => c+67, status c+65).
assert.strictEqual(L.colA1(73), 'BU'); assert.strictEqual(L.colA1(75), 'BW');
let up = L.planPaid('KIDS 31', it, fresh(), '8', '03/11/2026', 3600000);
assert.deepStrictEqual(ranges(up), ["'KIDS 31'!BU4", "'KIDS 31'!BW4"], 'LET cells read the ledger, so only the ledger is written; amount kept');
assert.strictEqual(up[0].values[0][0], 'Đã nộp');

// Blank ledger amount gets filled; typed visible date and status are updated too.
const noAmt = []; noAmt[1] = [];
up = L.planPaid('KIDS 31', it, fresh({ ledger: noAmt, block: [['Chưa nộp', '', '']] }), '8', '03/11/2026', 2160000);
assert.deepStrictEqual(ranges(up).sort(), ["'KIDS 31'!BU4", "'KIDS 31'!BV4", "'KIDS 31'!BW4", "'KIDS 31'!F385", "'KIDS 31'!G385", "'KIDS 31'!H385"].sort());
assert.ok(String(up.find(x => x.range.endsWith('!G385')).values[0][0]).startsWith('=IF($EC385="Đang trong live";2160000;'));

// A hand-typed amount is never overwritten by a tick.
up = L.planPaid('KIDS 31', it, fresh({ block: [[LET, 3600000, LET]] }), '8', '03/11/2026', 2160000);
assert.ok(!ranges(up).includes("'KIDS 31'!G385") && !ranges(up).includes("'KIDS 31'!BV4"));

// Identity failures refuse the write.
assert.throws(() => L.planPaid('KIDS 31', it, fresh({ names: [['AI ĐÓ', 'X']] }), '8', '03/11/2026', 1), /đã đổi học sinh/);
assert.throws(() => L.planPaid('KIDS 31', it, fresh({ live: [['Không còn trong live', '{}']] }), '8', '03/11/2026', 1), /không còn trong live/);
assert.throws(() => L.planPaid('KIDS 31', it, fresh({ marker: [['']] }), '8', '03/11/2026', 1), /chưa dùng sổ mới/);
assert.throws(() => L.planPaid('KIDS 31', it, fresh({ ledgerNames: [['TẠ PHÚC HƯNG', 'CHISTOPHER'], ['TẠ PHÚC HƯNG', 'CHISTOPHER']] }), '8', '03/11/2026', 1), /không khớp duy nhất/);
assert.throws(() => L.planPaid('KIDS 31', it, fresh(), '99', '03/11/2026', 1), /Không thấy cột đợt/);

// Undo keeps the amount.
up = L.planUnpaid('KIDS 31', it, fresh(), '8');
assert.deepStrictEqual(ranges(up), ["'KIDS 31'!BU4", "'KIDS 31'!BW4"]);

// Override: same cells as ghiTien_, old amount kept for undo.
let ov = L.planOverride('KIDS 31', it, fresh(), '8', 'Tổng số tiền cần thanh toán là: 2.160.000 đồng.', '', [['Khoá', 'Giá trị']]);
assert.deepStrictEqual(ranges(ov.updates), ["'KIDS 31'!G385", "'KIDS 31'!BV4"]);
assert.strictEqual(ov.updates[1].values[0][0], 2160000);
assert.strictEqual(ov.store.row, -1);
assert.deepStrictEqual(JSON.parse(ov.store.value).goc, [3600000, 3600000]);
// Removing it restores the old amount and clears the store row.
const after = []; after[1] = pad(['', '', 2160000, ''], 60);
ov = L.planOverride('KIDS 31', it, fresh({ ledger: after }), '8', '', '', [['Khoá', 'Giá trị'], [it.key, JSON.stringify({ msg: 'x', amt: '2160000', goc: [3600000, 3600000], daGhi: true })]]);
assert.strictEqual(ov.updates[1].values[0][0], 3600000);
assert.strictEqual(ov.store.row, 2); assert.strictEqual(ov.store.value, '');

// Identity comes from the displayed values, because B:C and the đợt headers are formulas in the real file.
const want = L.freshRanges('KIDS 31', [384, 385]);
assert.deepStrictEqual(want.values.slice(3), ["'KIDS 31'!B384:C384", "'KIDS 31'!EC384:ED384", "'KIDS 31'!B385:C385", "'KIDS 31'!EC385:ED385"]);
assert.deepStrictEqual(want.cells, ["'KIDS 31'!BT3:EB32", "'KIDS 31'!F384:BM384", "'KIDS 31'!F385:BM385"]);
const at = L.freshAt([[['HP_COMPACT_ID_V1|a']], [['TOM2', 'T'], ['TẠ PHÚC HƯNG', 'CHISTOPHER']], [['Đợt 8']], [['TOM2', 'T']], [[L.ACTIVE, '{}']], [['TẠ PHÚC HƯNG', 'CHISTOPHER']], [[L.ACTIVE, JSON.stringify({ name: 'TẠ PHÚC HƯNG', eng: 'CHISTOPHER' })]]],
  [ledger, [['a']], [[LET, 3600000, LET]]], 1);
assert.deepStrictEqual(ranges(L.planPaid('KIDS 31', it, at, '8', '03/11/2026', 3600000)), ["'KIDS 31'!BU4", "'KIDS 31'!BW4"]);

/* Movements */
const T0 = Date.parse('2026-11-03T08:00:00Z'), H = 3600000;
const ev = (h, cls, type, name, eng, tx) => [new Date(T0 + h * H).toISOString(), cls, type, name, eng || '', '', tx || ('t' + h)];
const NOW30 = T0 + 30 * H; // 30 hours after T0
const kinds = m => m.map(x => x.kind + ':' + x.name + ':' + (x.from || '') + '>' + (x.to || '')).sort();

// New student only.
assert.deepStrictEqual(kinds(L.classifyMoves([ev(0, 'KIDS 7', 'vao', 'AN', 'A')], [], [], NOW30)), ['moi:AN:>KIDS 7']);
// Leaver: waits 24 hours, then is offered.
let m = L.classifyMoves([ev(10, 'KIDS 7', 'ra', 'BO', 'B')], [], [], NOW30);
assert.strictEqual(m[0].kind, 'nghi'); assert.strictEqual(m[0].wait, true);
m = L.classifyMoves([ev(0, 'KIDS 7', 'ra', 'BO', 'B')], [], [], NOW30);
assert.strictEqual(m[0].wait, false);
// Transfer, whichever file is edited first, and across different times; reported once.
assert.deepStrictEqual(kinds(L.classifyMoves([ev(0, 'KIDS 7', 'ra', 'CU', 'C'), ev(3, 'KIDS 8', 'vao', 'CU', 'C')], [], [], NOW30)), ['chuyen:CU:KIDS 7>KIDS 8']);
assert.deepStrictEqual(kinds(L.classifyMoves([ev(3, 'KIDS 8', 'vao', 'CU', 'C'), ev(5, 'KIDS 7', 'ra', 'CU', 'C')], [], [], NOW30)), ['chuyen:CU:KIDS 7>KIDS 8']);
// Different English name still pairs, flagged as unsure.
m = L.classifyMoves([ev(0, 'KIDS 7', 'ra', 'CU', 'C'), ev(1, 'KIDS 8', 'vao', 'CU', 'D')], [], [], NOW30);
assert.strictEqual(m[0].kind, 'chuyen'); assert.strictEqual(m[0].unsure, true);
// Out of the window: separate events.
assert.deepStrictEqual(kinds(L.classifyMoves([ev(-200, 'KIDS 7', 'ra', 'CU', 'C'), ev(0, 'KIDS 8', 'vao', 'CU', 'C')], [], [], NOW30)), ['moi:CU:>KIDS 8', 'nghi:CU:KIDS 7>']);
// Same name in two possible classes: never guessed.
m = L.classifyMoves([ev(0, 'KIDS 7', 'ra', 'CU', 'X'), ev(1, 'KIDS 8', 'vao', 'CU', 'Y'), ev(1, 'KIDS 9', 'vao', 'CU', 'Z')], [], [], NOW30);
assert.deepStrictEqual(m.find(x => x.kind === 'nghi').targets, ['KIDS 8', 'KIDS 9']);
// Removed and re-added in the same class: nothing to do.
assert.deepStrictEqual(L.classifyMoves([ev(0, 'KIDS 7', 'ra', 'CU', 'C'), ev(1, 'KIDS 7', 'vao', 'CU', 'C')], [], [], NOW30), []);
// Already entered by hand, ignored, repeated log rows.
assert.deepStrictEqual(L.classifyMoves([ev(0, 'KIDS 7', 'vao', 'AN', 'A')], [['KIDS 7', 'AN', 'A']], [], NOW30), []);
assert.deepStrictEqual(L.classifyMoves([ev(0, 'KIDS 7', 'ra', 'BO', 'B')], [], [['BO', 'B', 'Nghỉ học', '', 'KIDS 7']], NOW30), []);
assert.deepStrictEqual(L.classifyMoves([ev(0, 'KIDS 7', 'ra', 'CU', 'C'), ev(1, 'KIDS 8', 'vao', 'CU', 'C')], [], [['CU', 'C', 'Chuyển lớp', 'KIDS 8', 'KIDS 7']], NOW30), []);
assert.deepStrictEqual(L.classifyMoves([ev(0, 'KIDS 7', 'vao', 'AN', 'A').concat('bo-qua')], [], [], NOW30), []);
m = L.classifyMoves([ev(0, 'KIDS 7', 'vao', 'AN', 'A', 'tx'), ev(0, 'KIDS 7', 'vao', 'AN', 'A', 'tx')], [], [], NOW30);
assert.strictEqual(m.length, 1); assert.deepStrictEqual(m[0].rows, [2, 3]);

// Inputs: leavers use the personal MB account, transfers keep the class account.
let inp = L.moveInputs({ kind: 'nghi', name: 'BO', eng: 'B', from: 'KIDS 7' }, { date: '03/11/2026', books: ['Sách A'] });
assert.strictEqual(inp.tab, 'HS NGHI_CHUYEN LOP'); assert.strictEqual(inp.cells.W, 'Triệu Thị Vân Trang - MB Bank');
assert.strictEqual(inp.cells.F, 'Nghỉ học'); assert.strictEqual(inp.cells.I, undefined); assert.strictEqual(inp.cells.P, 'Sách A'); assert.strictEqual(inp.cells.X, 'KIDS 7');
inp = L.moveInputs({ kind: 'chuyen', name: 'CU', eng: 'C', from: 'KIDS 7', to: 'KIDS 8' }, { date: '03/11/2026', books: [] });
assert.strictEqual(inp.cells.G, 'KIDS 8'); assert.strictEqual(inp.cells.W, undefined); assert.strictEqual(inp.cells.F, 'Chuyển lớp');
inp = L.moveInputs({ kind: 'moi', name: 'AN', eng: 'A', to: 'KIDS 7' }, { date: '03/11/2026', books: ['A', 'B'] });
assert.strictEqual(inp.tab, 'HS MỚI'); assert.deepStrictEqual([inp.cells.B, inp.cells.C, inp.cells.D, inp.cells.E, inp.cells.I, inp.cells.J], ['KIDS 7', 'AN', 'A', '03/11/2026', 'A', 'B']);

// QR from the account named in the message.
let q = L.qrFromMessage('chuyển khoản vào STK 0918041993 – MB Bank – Triệu Thị Vân Trang và gửi lại ảnh', 580000, 'KIDS7 NGHI Bờm');
assert.ok(q.startsWith('https://img.vietqr.io/image/MB-0918041993-compact2.png?amount=580000&addInfo=KIDS7%20NGHI%20BOM'));
assert.ok(q.endsWith('accountName=TRIEU%20THI%20VAN%20TRANG'));
assert.ok(L.qrFromMessage('STK 101886824548 – VietinBank – Hộ kinh doanh Triệu Thị Vân Trang và gửi', 1, 'x').includes('/ICB-101886824548-'));
assert.ok(L.qrFromMessage('STK 3338366366 – MB Bank – Công ty TNHH Phúc Hưng Edu, đồng thời gửi', 1, 'x').endsWith('CONG%20TY%20TNHH%20PHUC%20HUNG%20EDU'));
assert.strictEqual(L.qrFromMessage('không có tài khoản', 1, 'x'), '');
assert.strictEqual(L.qrFromMessage('STK 1 – Ngân hàng lạ – A và gửi', 1, 'x'), '');

// Due rows: paid and zero rows skipped, checks flagged, no QR on a row with a problem.
const nr = []; nr[1] = 'KIDS 7'; nr[2] = 'AN'; nr[3] = 'A'; nr[15] = '4.100.000'; nr[16] = ''; nr[19] = 'STK 3338366366 – MB Bank – Công ty và gửi';
const paidNew = nr.slice(); paidNew[16] = 'Đã nộp';
const ex = []; ex[1] = 'BO'; ex[2] = 'B'; ex[5] = 'Nghỉ học'; ex[9] = ''; ex[10] = '580.000 đ'; ex[12] = 'STK 0918041993 – MB Bank – Triệu Thị Vân Trang và gửi'; ex[23] = 'KIDS 7';
const bad = ex.slice(); bad[1] = 'CU'; bad[10] = 'CẦN KIỂM TRA: Thiếu học phí.'; bad[12] = '';
const none = ex.slice(); none[1] = 'XE'; none[10] = '0 đ';
const due = L.intakeDue([nr, paidNew], [ex, bad, none]);
assert.deepStrictEqual(due.map(x => [x.name, x.row, x.amount, x.problem]), [['AN', 3, 4100000, false], ['BO', 4, 580000, false], ['CU', 5, 0, true]]);
assert.ok(due[1].qr.includes('MB-0918041993')); assert.strictEqual(due[2].qr, '');
assert.strictEqual(due[2].reason, 'Thiếu học phí.');

// A date in Ngày nộp means paid, even with a blank status.
const dated = ex.slice(); dated[11] = '27/09/2026';
assert.deepStrictEqual(L.intakeDue([], [dated]), []);

/* Leaving: paid or not, by the đợt the date really belongs to */
const hist31 = [['27/10/2026', 'Thu đợt', '8', '23/08/2026', '01/11/2026'], ['7/6/2026', 'Thu đợt', '6', '29/03/2026', '12/06/2026'], ['16/8/2026', 'Thu đợt', '7', '14/06/2026', '21/08/2026']];
const paid7 = [{ d: 'Đợt 7', s: 'Đã nộp', a: '3.600.000 đ', n: '16/08/2026' }, { d: 'Đợt 8', s: 'Chưa nộp', a: '3.600.000 đ', n: '' }];
// The owner's example: left 25/10, inside the row labelled đợt 8, which is really đợt 7 and already paid: nothing to collect.
assert.deepStrictEqual(L.leaveStatus(hist31, paid7, '25/10/2026'), { state: 'da-dong', dot: 7, noSchedule: false });
// Đợt 7 not paid: charge by sessions.
assert.strictEqual(L.leaveStatus(hist31, [{ d: 'Đợt 7', s: 'Chưa nộp', a: 'x', n: '' }], '25/10/2026').state, 'chua-dong');
// A date in the paid column counts as paid even with a blank status.
assert.strictEqual(L.leaveStatus(hist31, [{ d: 'Đợt 7', s: '', a: 'x', n: '16/08/2026' }], '25/10/2026').state, 'da-dong');
// After the last known lesson: the newest đợt, unpaid, and the Sheet has no schedule yet.
assert.deepStrictEqual(L.leaveStatus(hist31, paid7, '03/11/2026'), { state: 'chua-dong', dot: 8, noSchedule: true });
// No saved data for that đợt, or no saved data at all: never guess.
assert.deepStrictEqual(L.leaveStatus(hist31, [{ d: 'Đợt 8', s: 'Chưa nộp', a: 'x', n: '' }], '25/10/2026'), { state: 'khong-ro', dot: 7, noSchedule: false });
assert.strictEqual(L.leaveStatus(hist31, null, '25/10/2026').state, 'khong-ro');
assert.strictEqual(L.leaveStatus(hist31, paid7, '').state, 'khong-ro');
assert.strictEqual(L.leaveStatus(hist31, paid7, '01/01/2020').state, 'khong-ro');
assert.strictEqual(L.leaveStatus([], paid7, '25/10/2026').state, 'khong-ro');
// Blank status and no date: unknown, never charged automatically.
assert.strictEqual(L.leaveStatus(hist31, [{ d: 'Đợt 7', s: '', a: '3.600.000 đ', n: '' }], '25/10/2026').state, 'khong-ro');
// Boundary days belong to the đợt.
assert.strictEqual(L.leaveStatus(hist31, paid7, '01/11/2026').dot, 7);
assert.strictEqual(L.leaveStatus(hist31, paid7, '23/08/2026').dot, 7);
// Saved blocks reach the move.
const withBlocks = ev(0, 'KIDS 7', 'ra', 'BO', 'B').concat('', JSON.stringify(paid7));
assert.deepStrictEqual(L.classifyMoves([withBlocks], [], [], NOW30)[0].blocks, paid7);
assert.strictEqual(L.classifyMoves([ev(0, 'KIDS 7', 'ra', 'BO', 'B').concat('', 'hỏng')], [], [], NOW30)[0].blocks, null);

// Collection calendar: sorted by due date, keeps the Sheet's status, skips classes with no đợt.
const calRows = [
  ['KIDS 31', '31', '9', '06/11/2026', '10/01/2027', '05/01/2027', '', '3.600.000', '0', '3.600.000', 'CHƯA ĐẾN'],
  ['T1', '1', '', '', '', '', '', '', '', '', ''], [],
  ['KIDS 33', '33', '6', '23/08/2026', '04/11/2026', '30/10/2026', '0', '3.600.000', '0', '3.600.000', 'ĐẾN HẠN THU'],
  ['KIDS 37', '37', '3', '06/09/2026', '10/11/2026', '05/11/2026', 'Phonics 3,4', '3.600.000', '100.000', '3.700.000', 'SẮP THU']];
const calList = L.calendar(calRows);
assert.deepStrictEqual(calList.map(x => x.tab), ['KIDS 33', 'KIDS 37', 'KIDS 31']);
assert.deepStrictEqual(calList.map(x => x.group), ['den', 'sap', 'chua']);
assert.strictEqual(calList[0].book, '');
assert.strictEqual(calList[1].book, 'Phonics 3,4');
assert.strictEqual(calList[1].total, 3700000);

// Dates.
assert.strictEqual(L.dayText(L.dayOf('5/1/2027')), '05/01/2027');
assert.strictEqual(L.dayOf('MONDAY\n02.11.2026'), L.dayOf('02/11/2026'));
assert.ok(isNaN(L.dayOf('31/11/2026')));
assert.ok(isNaN(L.dayOf('Thứ 2\n02.11')));
assert.strictEqual(L.dayNow(new Date(2026, 10, 4, 23, 30)), L.dayOf('04/11/2026'));

// One Schedule week, laid out like tab 02.11: whole-day row, header, merged day cells, tutors and IELTS ignored.
const colA = [[], [], ['DAY'], ['MONDAY\n02.11.2026'], [], [], ['TUESDAY\n03.11.2026'], [], ['WEDNESDAY\n04.11.2026'], [], ['SELF STUDY'], []];
const colD = [[], [], ['CLASS'], ['IELTS 46.1'], ['KIDS 8'], ['TUTOR \nÁNH NGÂN 2017'], ['KIDS 18'], ['TA6'], ['KIDS 28'], ['KIDS 8'], [], ['KIDS 8']];
const colM = [[], [], ['CLASS STATUS'], ['Nghỉ học'], ['Học'], ['Nghỉ học'], ['Nghỉ học'], ['Học'], ['Học'], ['Học'], [], ['']];
const offDays = [['Thứ 2\n02.11', 'Thứ 3'], ['Học', 'Học', 'Nghỉ', 'Học', 'Học', 'Học', 'Học']];
assert.deepStrictEqual(L.weekSessions(colA, colD, colM, offDays), [
  { cls: 'KIDS8', day: L.dayOf('02/11/2026'), off: false }, { cls: 'KIDS18', day: L.dayOf('03/11/2026'), off: true }, { cls: 'TA6', day: L.dayOf('03/11/2026'), off: false },
  { cls: 'KIDS28', day: L.dayOf('04/11/2026'), off: true }, { cls: 'KIDS8', day: L.dayOf('04/11/2026'), off: true }]);
assert.deepStrictEqual(L.weekSessions([], [], [], []), []);
assert.strictEqual(L.classKey('KIDS 31'), 'KIDS31');

// Lessons against the Schedule, only inside the weeks it has.
const D = s => L.dayOf(s), week = [{ from: D('02/11/2026'), to: D('08/11/2026') }];
const lessons31 = [D('06/11/2026'), D('08/11/2026'), D('13/11/2026')];
const on = (s, off) => ({ cls: 'KIDS31', day: D(s), off: !!off });
assert.deepStrictEqual(L.scheduleGaps(lessons31, [on('06/11/2026'), on('08/11/2026')], week), []);
assert.deepStrictEqual(L.scheduleGaps(lessons31, [on('06/11/2026', true), on('08/11/2026')], week), [{ day: D('06/11/2026'), type: 'nghi' }]);
assert.deepStrictEqual(L.scheduleGaps(lessons31, [on('08/11/2026')], week), [{ day: D('06/11/2026'), type: 'thieu' }]);
assert.deepStrictEqual(L.scheduleGaps(lessons31, [on('06/11/2026'), on('07/11/2026'), on('08/11/2026')], week), [{ day: D('07/11/2026'), type: 'them' }]);
// A second session the same day keeps the lesson; an extra session before this đợt is not a difference.
assert.deepStrictEqual(L.scheduleGaps(lessons31, [on('06/11/2026', true), on('06/11/2026'), on('08/11/2026')], week), []);
assert.deepStrictEqual(L.scheduleGaps(lessons31, [on('02/11/2026'), on('06/11/2026'), on('08/11/2026')], week), []);

// Weekdays, Monday first. Older Schedule tabs have their header higher up, and a row of "Nghỉ:" labels is not the whole-day row.
assert.strictEqual(L.weekdays([D('07/11/2026'), D('04/11/2026'), D('11/11/2026')]), 'Thứ 4, Thứ 7');
assert.strictEqual(L.weekdays([D('08/11/2026')]), 'Chủ nhật');
assert.deepStrictEqual(L.weekSessions([['DAY'], ['MONDAY\n12.10.2026']], [['CLASS'], ['KIDS 8']], [['CLASS STATUS'], ['Học']], [['Nghỉ:', 'Nghỉ:', 'Nghỉ:', 'Nghỉ:', 'Nghỉ:', 'Nghỉ:', 'Nghỉ:']]),
  [{ cls: 'KIDS8', day: D('12/10/2026'), off: false }]);

// Lessons follow the Schedule: real sessions first, off days skipped, a second session the same day counts once, the file's plan after the last known week.
const sess = (s, off) => ({ day: D(s), off: !!off });
assert.deepStrictEqual(L.scheduleLessons(D('16/09/2026'), 4,
  [sess('16/09/2026'), sess('19/09/2026'), sess('23/09/2026', true), sess('26/09/2026'), sess('26/09/2026', true)], D('27/09/2026'), [D('21/09/2026'), D('30/09/2026'), D('03/10/2026')]),
[{ day: D('19/09/2026'), known: true }, { day: D('26/09/2026'), known: true }, { day: D('30/09/2026'), known: false }, { day: D('03/10/2026'), known: false }]);
// Never more than the đợt's number of sessions, and nothing from before the previous đợt ended.
assert.deepStrictEqual(L.scheduleLessons(D('19/09/2026'), 1, [sess('19/09/2026'), sess('26/09/2026'), sess('30/09/2026')], D('04/10/2026'), []), [{ day: D('26/09/2026'), known: true }]);
assert.deepStrictEqual(L.scheduleLessons(D('19/09/2026'), 2, [], D('04/10/2026'), [D('07/10/2026')]), [{ day: D('07/10/2026'), known: false }]);

// Same key as the reminder email's XÁC NHẬN ĐÃ GỬI tab.
assert.strictEqual(L.ackKey('KIDS 33', '6'), 'kids33|6');
assert.strictEqual(L.ackKey('TA6', 2), 'ta6|2');

// Log of who sent what: latest action wins, a mark can be taken back, the whole class has its own key.
const logRows = [['04/11 09:00', 'KIDS 33', '6', 'A', 'AA', 'k1', 'da-gui', 'Cô Trang'], ['04/11 09:05', 'KIDS 33', '6', 'B', 'BB', 'k2', 'da-gui', 'Sơn'],
  ['04/11 09:06', 'KIDS 33', '6', 'B', 'BB', 'k2', 'bo', 'Sơn'], ['04/11 10:00', 'KIDS 33', '5', '(cả lớp)', '', '*', 'da-gui', 'Sơn'], [], ['x']];
assert.deepStrictEqual(L.sentIndex(logRows), { 'KIDS 33|6': { k1: { at: '04/11 09:00', by: 'Cô Trang' } }, 'KIDS 33|5': { '*': { at: '04/11 10:00', by: 'Sơn' } } });

// Class details from the settings block, lessons and collection history.
const full = L.buildClass('KIDS 31', Object.assign({}, raw, {
  top: raw.top.concat([['Ngày kết thúc đợt ngay trước', '', '', 'Ngày đầu đợt đã qua', '06/11/2026'], ['Số buổi đợt mới', '20', '', 'Ngày kết thúc đợt đã qua', '10/01/2027'], ['Học phí đợt mới', '3.600.000'],
    ['Tên sách/tài liệu 1', 'Discover 3', '250.000'], ['Tên sách/tài liệu 2', '0'], ['Tổng tiền sách/tài liệu', '250.000'], ['Tổng cần thu', '3.850.000']]),
  hist: [['Ngày thu', 'Loại thu', 'Đợt thu'], ['5/1/2027', 'Thu đợt', '9', '06/11/2026', '10/01/2027'],
    ['7/6/2026', 'Thu đợt', '6', '29/03/2026', '12/06/2026', '3.600.000', '', '0', '3.600.000', 'tin', 'Chi tiết 6'],
    ['16/8/2026', 'Thu đợt', '7', '14/06/2026', '21/08/2026', '3.600.000', 'Family and Friends 2', '250.000', '3.850.000', 'tin', 'Chi tiết 7'], [], ['', '', '']],
  lessons: [['06/11/2026'], ['08/11/2026'], [''], ['x']] }));
assert.strictEqual(full.start, '06/11/2026');
assert.strictEqual(full.end, '10/01/2027');
assert.strictEqual(full.total, '3.850.000');
assert.deepStrictEqual(full.books, ['Discover 3', '', '', '', '']);
assert.deepStrictEqual(full.lessons, [D('06/11/2026'), D('08/11/2026')]);
assert.deepStrictEqual(full.history.map(h => h.dot), ['7', '6']);
assert.deepStrictEqual(full.history[0], { dot: '7', paidOn: '16/8/2026', from: '14/06/2026', to: '21/08/2026', fee: '3.600.000', book: 'Family and Friends 2', total: '3.850.000', detail: 'Chi tiết 7' });
assert.strictEqual(L.classRanges('KIDS 31').length, 5);

const trio = [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }, { key: 'c', name: 'C' }];
assert.deepStrictEqual(L.notMarked(trio, undefined).map(x => x.key), ['a', 'b', 'c']);
assert.deepStrictEqual(L.notMarked(trio, { a: {} }).map(x => x.key), ['b', 'c']);
assert.deepStrictEqual(L.notMarked(trio, { '*': {} }), []);
const undone = L.sentIndex([['t', 'KIDS 1', '2', 'A', '', 'a', 'da-gui', 'x'], ['t', 'KIDS 1', '2', 'A', '', 'a', 'bo', 'x']]);
assert.strictEqual(L.notMarked(trio, undone['KIDS 1|2']).length, 3, 'taking a mark back puts the student on the list again');
const bookOnly = L.moveInputs({ kind: 'nghi', name: 'N', eng: '', from: 'KIDS 1' }, { date: '04/11/2026', books: ['Discover 1'], onlyBooks: true });
assert.strictEqual(bookOnly.cells.O, 0);
assert.strictEqual(bookOnly.cells.P, 'Discover 1');
assert.strictEqual(L.moveInputs({ kind: 'nghi', name: 'N', eng: '', from: 'KIDS 1' }, { date: '04/11/2026', books: ['Discover 1'] }).cells.O, undefined);


// Previous đợt rolled into this one by the message formula.
{
  const line = '\n- Con AN (A) còn học phí Đợt 7 chưa thanh toán: 3.600.000 đồng, nay gộp chung với học phí đợt này (3.000.000 đồng). Nếu Quý Phụ huynh đã chuyển khoản đợt trước, xin gửi lại ảnh giao dịch để cô kiểm tra.';
  const mk = (st, sheet, kho) => L.buildClass('KIDS 31', {
    top: [], hist: [], kho: kho || {},
    track: [[], ['', '', '', '', '', 'Đợt 7', '', '', 'Đợt 8'], ['STT', 'Họ tên Tiếng Việt', 'Tên Tiếng Anh', 'Ngày', 'Miễn', 'Trạng thái', 'Số tiền', 'Ngày nộp', 'Trạng thái', 'Số tiền', 'Ngày nộp'],
      ['1', 'AN', 'A', '', '', st, '3.600.000 đ', '', 'Chưa nộp', sheet]],
    msg: [['Tin nhắn gửi PH – đợt 8'], ['LỚP KIDS 31\nHọc viên: AN (A)' + line + '\nTổng số tiền cần thanh toán là: 6.600.000 đồng.\nMã QR chuyển khoản (đã có sẵn số tiền và nội dung): https://img.vietqr.io/image/MB-1-compact2.png?amount=6600000&addInfo=x']] }).items[0];
  const TD = { 'TUDIEN|KIDS 31|D8|AN|A': '3000000' }, TD2 = { 'TUDIEN|KIDS 31|D8|AN|A': '6600000' };
  // Cell filled by the daily job, not rewritten yet: the merged message wins and nothing is flagged.
  let a = mk('', '3.000.000 đ', TD);
  assert.strictEqual(a.amount, 6600000); assert.strictEqual(a.stale, true); assert.strictEqual(a.warn, '');
  assert.deepStrictEqual(a.gop, { dot: '7', amount: 3600000, blank: true });
  assert.ok(a.qr.includes('amount=6600000')); assert.ok(a.msg.includes('còn học phí Đợt 7'));
  assert.strictEqual(mk('Chưa nộp', '6.600.000 đ', TD2).gop.blank, false);
  // Cell already at the merged amount: same message, nothing stale.
  a = mk('', '6.600.000 đ', TD2);
  assert.strictEqual(a.stale, false); assert.strictEqual(a.amount, 6600000); assert.ok(a.gop);
  // An amount from Sửa riêng wins: no merge claimed in the message, and the mismatch is flagged.
  const OWN = { 'ZALO|KIDS 31|D8|AN|A': JSON.stringify({ amt: '3000000', daGhi: true }) };
  a = mk('', '3.000.000 đ', OWN);
  assert.strictEqual(a.amount, 3000000); assert.strictEqual(a.gop, null); assert.ok(!a.msg.includes('còn học phí')); assert.ok(a.msg.includes('là: 3.000.000')); assert.ok(a.warn); assert.ok(a.qr.includes('amount=3000000'));
  // Ticking the previous đợt shows the lower amount at once.
  a = mk('', '6.600.000 đ', TD2); L.dropGop(a);
  assert.strictEqual(a.amount, 3000000); assert.strictEqual(a.gop, null); assert.strictEqual(a.stale, true); assert.ok(!a.msg.includes('còn học phí')); assert.ok(a.msg.includes('là: 3.000.000')); assert.ok(a.qr.includes('amount=3000000'));
  // Ticking this đợt while its cell is stale writes the right amount; a cell changed by hand meanwhile is kept.
  const who = { row: 390, name: 'AN', eng: 'A', stale: true, tienSheet: 6600000 };
  const ledger = [Array(5).fill('')]; ledger[0][1] = 'Chưa nộp'; ledger[0][2] = 6600000;
  const fr = block => ({ marker: [['HP_COMPACT_ID_V1']], names: [['AN', 'A']], live: [['Đang trong live', JSON.stringify({ name: 'AN', eng: 'A' })]], ledgerNames: [['AN', 'A']], headers: [['Đợt 8']], ledger, block });
  const cellOf = (ups, r) => (ups.find(u => u.range === r) || {}).values;
  let ups = L.planPaid('KIDS 31', who, fr([['Chưa nộp', '=IF($EC390="Đang trong live";6600000;"")', '']]), '8', '05/11/2026', 3000000);
  assert.strictEqual(cellOf(ups, "'KIDS 31'!G390")[0][0], '=IF($EC390="Đang trong live";3000000;"")');
  assert.strictEqual(cellOf(ups, "'KIDS 31'!BV3")[0][0], 3000000);
  ups = L.planPaid('KIDS 31', who, fr([['Chưa nộp', 5000000, '']]), '8', '05/11/2026', 3000000);
  assert.strictEqual(cellOf(ups, "'KIDS 31'!G390"), undefined, 'hand-changed cell stays');
}

// Undoing a tick on the previous đợt.
{
  const merged = 'LỚP KIDS 31\nHọc viên: AN (A)\n\n- Đợt học số 8 gồm 20 buổi học tiếp theo.\n- Con AN (A) còn học phí Đợt 7 chưa thanh toán: 3.600.000 đồng, nay gộp chung với học phí đợt này (3.000.000 đồng). Nếu Quý Phụ huynh đã chuyển khoản đợt trước, xin gửi lại ảnh giao dịch để cô kiểm tra.\n\nTổng số tiền cần thanh toán là: 6.600.000 đồng.\nMã QR chuyển khoản (đã có sẵn số tiền và nội dung): https://img.vietqr.io/image/MB-1-compact2.png?amount=6600000&addInfo=x';
  const mk = (st, sheet, kho) => L.buildClass('KIDS 31', { top: [], hist: [], kho,
    track: [[], ['', '', '', '', '', 'Đợt 7', '', '', 'Đợt 8'], ['STT', 'Họ tên Tiếng Việt', 'Tên Tiếng Anh', 'Ngày', 'Miễn', 'Trạng thái', 'Số tiền', 'Ngày nộp', 'Trạng thái', 'Số tiền', 'Ngày nộp'],
      ['1', 'AN', 'A', '', '', st, '3.600.000 đ', '', 'Chưa nộp', sheet]],
    msg: [['Tin nhắn gửi PH – đợt 8'], [merged]] }).items[0];
  const a = mk('', '6.600.000 đ', { 'TUDIEN|KIDS 31|D8|AN|A': '6600000' }), before = a.msg;
  assert.deepStrictEqual(a.prev, { dot: '7', status: '', amount: 3600000, date: '', paid: false });
  // Tick then undo gives back the same message, amount and QR.
  L.dropGop(a); L.addGop(a, '7', 3600000, true);
  assert.strictEqual(a.msg, before); assert.strictEqual(a.amount, 6600000); assert.deepStrictEqual(a.gop, { dot: '7', amount: 3600000, blank: true });
  assert.ok(a.qr.includes('amount=6600000')); assert.strictEqual(a.stale, false);
  // Twice in a row changes nothing.
  L.addGop(a, '7', 3600000, true); assert.strictEqual(a.amount, 6600000);
  // An amount from Sửa riêng or a paid student keeps the card as it is.
  const typed = mk('', '3.000.000 đ', { 'ZALO|KIDS 31|D8|AN|A': JSON.stringify({ amt: '3000000', daGhi: true }) }), n = typed.amount; L.addGop(typed, '7', 3600000, true); assert.strictEqual(typed.amount, n); assert.strictEqual(typed.gop, null);
  // The undo restores a typed status, and clears the date.
  const fr = { marker: [['HP_COMPACT_ID_V1']], names: [['AN', 'A']], live: [['Đang trong live', JSON.stringify({ name: 'AN', eng: 'A' })]], ledgerNames: [['AN', 'A']], headers: [['Đợt 7']], ledger: [['', 'Đã nộp', 3600000, '01/11/2026']], block: [['=IF($EC390="x";"Đã nộp";"")', 3600000, '01/11/2026']] };
  const ups = L.planUnpaid('KIDS 31', { row: 390, name: 'AN', eng: 'A', restore: 'Chưa nộp' }, fr, '7'), at = r => ups.find(u => u.range === "'KIDS 31'!" + r).values[0][0];
  assert.strictEqual(at('BU3'), 'Chưa nộp'); assert.strictEqual(at('F390'), 'Chưa nộp'); assert.strictEqual(at('BW3'), ''); assert.strictEqual(at('H390'), '');
  assert.strictEqual(L.planUnpaid('KIDS 31', { row: 390, name: 'AN', eng: 'A' }, fr, '7').find(u => u.range === "'KIDS 31'!F390").values[0][0], '');
}

// Seven days after sending: remind again.
{
  const day = s => L.dayOf(s), who = (key, extra) => Object.assign({ key, name: key, eng: '', paid: false, amount: 3600000, status: 'Chưa nộp', date: '' }, extra);
  const log = (at, key, act) => [at, 'KIDS 1', '6', key, '', key, act, 'Cô Trang'];
  const marks = rows => L.sentIndex(rows)['KIDS 1|6'];
  // Six days is too soon, seven is due, counted in calendar days whatever the hour.
  let today = day('04/11/2026'), m = marks([log('29/10 23:50', 'a', 'da-gui'), log('28/10 23:50', 'b', 'da-gui')]);
  let out = L.remindDue([who('a'), who('b'), who('c')], m, today);
  assert.deepStrictEqual(out.map(r => [r.item.key, r.days, r.guess]), [['b', 7, false]]);
  // Paid, no message, nothing to collect and deferred students are never reminded.
  m = marks([log('01/10 09:00', '*', 'da-gui')]);
  out = L.remindDue([who('a', { paid: true }), who('b', { trong: true }), who('c', { amount: 0 }), who('d', { status: 'Chưa thu ngay' }), who('e', { status: '' })], m, today);
  assert.deepStrictEqual(out.map(r => [r.item.key, r.blank]), [['e', true]]);
  // A whole-class tick counts, and the later of the class tick and the student's own mark wins.
  m = marks([log('01/10 09:00', '*', 'da-gui'), log('01/11 09:00', 'a', 'da-gui')]);
  assert.deepStrictEqual(L.remindDue([who('a'), who('b')], m, today).map(r => r.item.key), ['b']);
  // A marked reminder comes back after two days while the student has not paid.
  m = marks([log('20/10 09:00', 'a', 'da-gui'), log('04/11 09:00', 'a', 'nhac-lai')]);
  assert.strictEqual(L.remindDue([who('a')], m, today).length, 0);
  assert.strictEqual(L.remindDue([who('a')], m, day('05/11/2026')).length, 0);
  out = L.remindDue([who('a')], m, day('06/11/2026'));
  assert.deepStrictEqual([out[0].days, out[0].lan, out[0].onCycle], [2, 1, true]);
  // With nothing marked: on the list from day seven, on cycle every second day.
  m = marks([log('20/10 09:00', 'a', 'da-gui')]);
  const cycle = d => L.remindDue([who('a')], m, day(d))[0].onCycle;
  assert.deepStrictEqual(['27/10/2026', '28/10/2026', '29/10/2026', '30/10/2026'].map(cycle), [true, false, true, false]);
  // A whole-class send after the reminder starts the seven days again.
  m = marks([log('20/10 09:00', 'a', 'nhac-lai'), log('01/11 09:00', '*', 'da-gui')]);
  assert.strictEqual(L.remindDue([who('a')], m, today).length, 0);
  m = marks([log('20/10 09:00', 'a', 'da-gui'), log('28/10 09:00', 'a', 'nhac-lai'), log('04/11 09:00', 'a', 'nhac-lai')]);
  assert.strictEqual(m.a.lan, 2);
  // Taking back a reminder returns to the send before it, not to "never sent".
  m = marks([log('20/10 09:00', 'a', 'da-gui'), log('04/11 09:00', 'a', 'nhac-lai'), log('04/11 09:05', 'a', 'bo')]);
  assert.strictEqual(m.a.at, '20/10 09:00'); assert.strictEqual(L.remindDue([who('a')], m, today)[0].days, 15);
  m = marks([log('20/10 09:00', '*', 'da-gui'), log('04/11 09:00', 'a', 'nhac-lai'), log('04/11 09:05', 'a', 'bo')]);
  assert.strictEqual(L.remindDue([who('a')], m, today)[0].days, 15);
  assert.strictEqual(marks([log('04/11 09:00', 'a', 'nhac-lai'), log('04/11 09:05', 'a', 'bo')]).a, undefined, 'no empty mark left behind');
  // No log but the class was ticked: the due date stands in and says so. Not ticked at all: no reminder.
  out = L.remindDue([who('a')], undefined, today, day('28/09/2026'));
  assert.deepStrictEqual([out[0].guess, out[0].days], [true, 37]);
  assert.strictEqual(L.remindDue([who('a')], undefined, today, NaN).length, 0);
  // The log has no year: a December send read in January belongs to last year.
  assert.strictEqual(L.sentDay('28/12 09:00', day('04/01/2027')), day('28/12/2026'));
}

// Discount choices.
{
  assert.strictEqual(L.discInput(''), ''); assert.strictEqual(L.discInput('600000'), 600000); assert.strictEqual(L.discInput('1.600.000'), 1600000);
  assert.strictEqual(L.discInput('20%'), '20%'); assert.strictEqual(L.discInput('7,5%'), '7.5%'); assert.strictEqual(L.discInput('Miễn học phí'), 'miễn học phí');
  assert.throws(() => L.discInput('20'), /số tiền giảm/); assert.throws(() => L.discInput('abc'), /số tiền giảm/); assert.throws(() => L.discInput('120%'), /Phần trăm/);
  // Whatever the sheet shows reads back the same way.
  assert.strictEqual(L.discText('600000'), '600.000 đ'); assert.strictEqual(L.discText('0,2'), '20%'); assert.strictEqual(L.discText('20%'), '20%'); assert.strictEqual(L.discText('miễn'), 'Miễn học phí'); assert.strictEqual(L.discText(''), '');
  assert.strictEqual(L.discValue('0,2'), '20%'); assert.strictEqual(L.discValue('600000'), '600000'); assert.strictEqual(L.discValue('miễn học phí'), 'miễn học phí'); assert.strictEqual(L.discValue(''), '');
  const fr = { marker: [['HP_COMPACT_ID_V1']], names: [['AN', 'A']], live: [['Đang trong live', JSON.stringify({ name: 'AN', eng: 'A' })]], ledgerNames: [['X', 'Y'], ['AN', 'A']], headers: [['Đợt 8']], ledger: [], block: [[]] };
  const who = { row: 390, name: 'AN', eng: 'A' }, plan = (d, e) => L.planDiscount('KIDS 31', who, fr, d, e || '').map(u => [u.range, u.values[0][0]]);
  assert.deepStrictEqual(plan(600000), [["'KIDS 31'!BT4", 600000], ["'KIDS 31'!E390", '=IF($EC390="Đang trong live";600000;"")']]);
  assert.deepStrictEqual(plan('20%'), [["'KIDS 31'!BT4", '20%'], ["'KIDS 31'!E390", '=IF($EC390="Đang trong live";TO_PERCENT(0,2);"")']]);
  assert.deepStrictEqual(plan('miễn học phí'), [["'KIDS 31'!BT4", 'miễn học phí'], ["'KIDS 31'!E390", '=IF($EC390="Đang trong live";"miễn học phí";"")']]);
  assert.deepStrictEqual(plan(''), [["'KIDS 31'!BT4", ''], ["'KIDS 31'!E390", '']], 'taking a discount off clears both');
  assert.deepStrictEqual(plan(600000, '=LET(a;1;a)'), [["'KIDS 31'!BT4", 600000]], 'a formula that reads the ledger is left alone');
  assert.throws(() => L.planDiscount('KIDS 31', who, Object.assign({}, fr, { names: [['AI ĐÓ', 'X']] }), 600000, ''), /đã đổi học sinh/);
  // New students, leavers and transfers take it in their own tab's column.
  const move = k => ({ kind: k, name: 'N', eng: 'E', from: 'KIDS 1', to: 'KIDS 2' });
  assert.strictEqual(L.moveInputs(move('moi'), { date: 'd', disc: 600000 }).cells.F, 600000);
  // Leavers and transfers bill part of a đợt, so the discount is their tuition's share of it.
  assert.strictEqual(L.moveInputs(move('nghi'), { date: 'd', disc: '20%' }).cells.E, '=ROUND($O{r}*20%;0)');
  assert.strictEqual(L.moveInputs(move('nghi'), { date: 'd', disc: '7.5%' }).cells.E, '=ROUND($O{r}*7,5%;0)');
  assert.strictEqual(L.moveInputs(move('chuyen'), { date: 'd', disc: 600000 }).cells.E, `=ROUND($O{r}*600000/INDIRECT("'"&$X{r}&"'!$B$6");0)`);
  assert.strictEqual(L.moveInputs(move('nghi'), { date: 'd', disc: 'miễn học phí' }).cells.E, 'miễn học phí');
  assert.deepStrictEqual(L.moveInputs(move('nghi'), { date: 'd' }).noCopy, ['E'], 'a discount never spreads to the next row');
  assert.ok(!('F' in L.moveInputs(move('moi'), { date: 'd', disc: '' }).cells)); assert.ok(!('E' in L.moveInputs(move('nghi'), { date: 'd', disc: '' }).cells));
}

// "Chưa thu ngay" is the owner's choice, not a problem.
assert.strictEqual(L.deferred({ status: 'Chưa thu ngay' }), true);
assert.strictEqual(L.deferred({ status: 'Chưa nộp' }), false);
assert.strictEqual(L.deferred({ status: '' }), false);
assert.strictEqual(L.deferred({ status: 'Chưa thu ngay', paid: true }), false);

// Free tuition is neither due nor paid.
assert.strictEqual(L.free({ disc: 'miễn học phí', status: 'Chưa nộp' }), true);
assert.strictEqual(L.free({ disc: 'miễn', status: '' }), true);
assert.strictEqual(L.free({ disc: '600000', status: 'Chưa nộp' }), false);
assert.strictEqual(L.free({ disc: 'miễn học phí', paid: true }), true, 'never counted, even with a payment on the row');
assert.strictEqual(L.free({ disc: 'miễn học phí', manual: 'tin riêng' }), true, 'never counted, even with a hand-written message');
assert.strictEqual(L.remindDue([{ key: 'k', disc: 'miễn học phí', paid: false, amount: 3600000, status: '' }], { k: { at: '01/10 09:00' } }, L.dayOf('04/11/2026')).length, 0);

// A text typed with separate accents still reads as free; free intake rows are not due.
assert.strictEqual(L.free({ disc: 'miễn học phí'.normalize('NFD') }), true);
{
  const r = Array(18).fill(''); r[1] = 'KIDS 1'; r[2] = 'AN'; r[15] = '250.000 đ'; const f = r.slice(); f[5] = 'miễn học phí';
  assert.strictEqual(L.intakeDue([r], []).length, 1); assert.strictEqual(L.intakeDue([f], []).length, 0);
}

// A move chosen by hand, then the roster catching up later.
{
  const at = '2026-11-01T02:00:00Z', now = Date.parse('2026-11-05T02:00:00Z');
  const ra = ['2026-11-01T02:00:00Z', 'KIDS 1', 'ra', 'AN', 'A', '1', 'tx1'], vao = ['2026-11-04T02:00:00Z', 'KIDS 2', 'vao', 'AN', 'A', '1', 'tx2'];
  const exits = kind => [['AN', 'A', kind, kind === 'Chuyển lớp' ? 'KIDS 2' : '', 'KIDS 1']];
  // Removed from the old class and added to the new one days apart: neither asks again after a hand-entered transfer.
  assert.strictEqual(L.classifyMoves([ra], [], exits('Chuyển lớp'), now).length, 0);
  assert.strictEqual(L.classifyMoves([vao], [], exits('Chuyển lớp'), now).length, 0);
  // Without that row they still show as before; a different class is not the same move.
  assert.strictEqual(L.classifyMoves([ra], [], [], now)[0].kind, 'nghi');
  assert.strictEqual(L.classifyMoves([vao], [], [], now)[0].kind, 'moi');
  assert.strictEqual(L.classifyMoves([['2026-11-04T02:00:00Z', 'KIDS 9', 'vao', 'AN', 'A', '1', 'tx3']], [], exits('Chuyển lớp'), now)[0].kind, 'moi');
  // A hand-entered leaver is not asked again either.
  assert.strictEqual(L.classifyMoves([ra], [], exits('Nghỉ học'), now).length, 0);
  // Recent exits by class and name; old rows and rows with no source class are left out.
  const row = (name, kind, date, from, to) => { const r = Array(24).fill(''); r[1] = name; r[5] = kind; r[6] = to || ''; r[7] = date; r[23] = from; return r; };
  const today = L.dayOf('05/11/2026');
  const m = L.recentExits([row('An', 'Nghỉ học', '04/11/2026', 'KIDS 1'), row('Bình', 'Chuyển lớp', '01/10/2026', 'KIDS 1', 'KIDS 2'), row('Cũ', 'Nghỉ học', '01/07/2026', 'KIDS 1'), row('Không lớp', 'Nghỉ học', '04/11/2026', '')], today);
  assert.deepStrictEqual(Object.keys(m).sort(), ['KIDS 1|AN', 'KIDS 1|BÌNH']);
  assert.strictEqual(m['KIDS 1|BÌNH'].to, 'KIDS 2');
  // A student's row read as blocks, the shape the paid check takes.
  const blocks = L.blocksOf([['Đợt 3', '', '', 'Đợt 4', '', '', '']], [['Đã nộp', '3.600.000 đ', '01/10/2026', 'Chưa nộp', '3.600.000 đ', '']]);
  assert.deepStrictEqual(blocks, [{ d: 'Đợt 3', s: 'Đã nộp', n: '01/10/2026' }, { d: 'Đợt 4', s: 'Chưa nộp', n: '' }]);
  const hist = [['', '', '4', '01/09/2026', '30/10/2026'], ['', '', '5', '01/11/2026', '30/12/2026']];
  assert.strictEqual(L.leaveStatus(hist, blocks, '10/09/2026').state, 'da-dong');
  assert.strictEqual(L.leaveStatus(hist, blocks, '10/11/2026').state, 'chua-dong');
  assert.strictEqual(L.leaveStatus(hist, null, '10/11/2026').state, 'khong-ro');
}

// A paid leaver's row with no tuition and no books is not a problem to chase, even with no schedule yet.
{
  const r = Array(24).fill(''); r[1] = 'AN'; r[5] = 'Nghỉ học'; r[10] = '0 đ'; r[12] = 'CẦN KIỂM TRA: chưa có lịch'; r[14] = '0'; r[23] = 'KIDS 1';
  assert.strictEqual(L.intakeDue([], [r]).length, 0);
  const owes = r.slice(); owes[14] = 'CẦN KIỂM TRA: chưa có lịch'; owes[10] = 'CẦN KIỂM TRA: chưa có lịch';
  assert.strictEqual(L.intakeDue([], [owes])[0].problem, true, 'an unpaid leaver with no schedule is still shown');
}

// A leaver the Sheet cannot price yet.
{
  const day = s => L.dayOf(s), days = ['27/10/2026', '29/10/2026', '03/11/2026', '05/11/2026', '10/11/2026'].map(day);
  const base = { days, date: day('03/11/2026'), join: 0, fee: 3600000, sessions: 20, bookFee: 0, bookList: '', discCell: '', name: 'AN', eng: 'A', cls: 'KIDS 31', account: 'STK 3338366366 – MB Bank – Công ty', dot: 8 };
  let b = L.leaveBill(base);
  assert.deepStrictEqual([b.used, b.tuition, b.off, b.total], [3, 540000, 0, 540000]);
  assert.ok(b.msg.includes('Do con AN (A) học đến hết ngày 03/11/2026, là buổi thứ 03 của đợt học mới và xin dừng lớp'));
  assert.ok(b.msg.includes('- Học phí 03 buổi: 540.000 đồng'));
  assert.ok(b.msg.includes('Tổng số tiền cần thanh toán: 540.000 đồng.'));
  assert.ok(b.msg.includes('Kính nhờ Quý Phụ huynh chuyển khoản vào STK 3338366366 – MB Bank – Công ty và gửi lại'));
  assert.ok(L.qrFromMessage(b.msg, b.total, 'x').includes('amount=540000'), 'the card can be drawn from it');
  // Joined mid-đợt: only their own lessons.
  assert.strictEqual(L.leaveBill(Object.assign({}, base, { join: day('29/10/2026') })).used, 2);
  // Books, then each kind of discount the row can hold. A discount is the share of tuition, not of books.
  b = L.leaveBill(Object.assign({}, base, { bookFee: 250000, bookList: 'Discover 1', discCell: '=ROUND($O17*600000/INDIRECT("\'"&$X17&"\'!$B$6");0)' }));
  assert.deepStrictEqual([b.tuition, b.off, b.total], [540000, 90000, 700000]);
  assert.strictEqual(b.total, 3 * 150000 + 250000, 'three sessions at the discounted price, books in full');
  assert.ok(b.msg.includes('- Tiền sách, tài liệu (Discover 1): 250.000 đồng')); assert.ok(b.msg.includes('- Chiết khấu/điều chỉnh số tiền còn phải thu: 90.000 đồng'));
  assert.strictEqual(L.leaveBill(Object.assign({}, base, { discCell: '=ROUND($O17*20%;0)' })).total, 432000);
  assert.strictEqual(L.leaveBill(Object.assign({}, base, { discCell: '=ROUND($O17*7,5%;0)' })).total, 499500);
  assert.strictEqual(L.leaveBill(Object.assign({}, base, { discCell: 100000 })).total, 440000, 'a whole amount typed by hand comes off whole, as the formula does');
  b = L.leaveBill(Object.assign({}, base, { bookFee: 250000, bookList: 'B', discCell: 'miễn học phí' }));
  assert.deepStrictEqual([b.total, b.off], [250000, 540000]);
  assert.ok(L.leaveBill(Object.assign({}, base, { discCell: '=IF(1;2;3)' })).error, 'an unknown discount cell is refused');
  // The owner can correct the count; nonsense and dates outside the đợt are refused.
  b = L.leaveBill(Object.assign({}, base, { used: '4' })); assert.deepStrictEqual([b.used, b.counted, b.total], [4, 3, 720000]);
  assert.ok(L.leaveBill(Object.assign({}, base, { used: '21' })).error); assert.ok(L.leaveBill(Object.assign({}, base, { used: '1.5' })).error);
  assert.ok(L.leaveBill(Object.assign({}, base, { date: day('01/10/2026') })).error); assert.ok(L.leaveBill(Object.assign({}, base, { date: day('01/12/2026') })).error);
  // Between two đợt the owner says how many, and no lesson reads as such.
  b = L.leaveBill(Object.assign({}, base, { date: day('01/10/2026'), used: '0', bookFee: 250000, bookList: 'B' }));
  assert.strictEqual(b.total, 250000); assert.ok(b.msg.includes('xin dừng lớp từ ngày 01/10/2026 và chưa học buổi nào')); assert.ok(!b.msg.includes('buổi thứ 00'));
  assert.strictEqual(L.leaveBill(Object.assign({}, base, { date: day('01/10/2026'), used: '2' })).total, 360000);
  assert.ok(L.leaveBill(Object.assign({}, base, { days: [] })).error); assert.ok(L.leaveBill(Object.assign({}, base, { fee: 0 })).error);
  // Nothing owed reads as such.
  b = L.leaveBill(Object.assign({}, base, { used: '0' })); assert.strictEqual(b.total, 0); assert.ok(b.msg.includes('Hiện không cần thanh toán thêm.'));
}


// Tutor: names, minutes, off days, months.
{
  assert.strictEqual(L.tutorName('TUTOR IELTS\nNAM KHÁNH'), 'NAM KHÁNH');
  assert.strictEqual(L.tutorName('TUTOR\nNAM KHÁNH IELTS'), 'NAM KHÁNH');
  assert.strictEqual(L.tutorName('TUTOR \nACHI KIDS 28'), 'ACHI KIDS 28');
  assert.strictEqual(L.tutorName('TUTOR\nJERRY KIDS 8'), 'JERRY');
  assert.strictEqual(L.tutorMinutes('18:30 - 20.00'), 90); assert.strictEqual(L.tutorMinutes('19.00  - 20.30'), 90); assert.strictEqual(L.tutorMinutes('07.30 - 11.30'), 240); assert.strictEqual(L.tutorMinutes('x'), 0);
  assert.strictEqual(L.hoursText(690), '11 giờ 30 phút'); assert.strictEqual(L.hoursText(720), '12 giờ'); assert.strictEqual(L.hoursText(30), '30 phút');
  const rows = [['DAY', 'TIME', 'B', 'CLASS', 'TEACHER'], ['MONDAY\n05.10.2026', '19.00 - 21.00', '', 'TUTOR\nACHI KIDS 28', 'THUY TRANG'], ['', '17.30 - 19.00', '', 'KIDS 21', 'RUBY'],
    ['', '9.00 - 10.30', '', 'TUTOR IELTS\nTÚ', 'MY LINH'], ['TUESDAY\n06.10.2026', '19:00 - 21.00', '', 'TUTOR\nACHI KIDS 28', 'THUY TRANG'], ['WEDNESDAY\n07.10.2026', '19.00 - 21.00', '', 'TUTOR\nACHI KIDS 28', ''], ['SUNDAY\n11.10.2026', '19.00 - 21.00', '', 'TUTOR\nACHI KIDS 28', 'THUY TRANG'], ['', '8.00 - 9.00', '', 'TUTOR\nTEDDY', 'MY LINH']];
  const m = [['CLASS STATUS'], ['Học'], ['Học'], ['Nghỉ học'], ['Học'], ['Học'], [''], ['Học']];
  const s = L.tutorSessions(rows, m, [['Học', 'Học', 'Học', 'Học', 'Học', 'Học', 'Nghỉ']]);
  assert.deepStrictEqual(s.map(x => [x.name, L.dayText(x.day), x.min, x.off]), [['ACHI KIDS 28', '05/10/2026', 120, false], ['TÚ', '05/10/2026', 90, true], ['ACHI KIDS 28', '06/10/2026', 120, false], ['ACHI KIDS 28', '07/10/2026', 120, false], ['ACHI KIDS 28', '11/10/2026', 120, true], ['TEDDY', '11/10/2026', 60, false]]);
  assert.strictEqual(s[2].time, '19.00 - 21.00');
  const today = L.dayOf('05/11/2026');
  assert.deepStrictEqual(L.tutorMonths(today), ['2026-09', '2026-10', '2026-11']);
  assert.strictEqual(L.dayText(L.billDay('2026-11')), '01/12/2026'); assert.strictEqual(L.dayText(L.billDay('2026-12')), '01/01/2027');
  assert.deepStrictEqual(L.tutorMissing([{ from: L.dayOf('28/09/2026'), to: L.dayOf('04/10/2026') }], '2026-10', L.dayOf('05/10/2026')), [L.dayOf('05/10/2026')]);

  // Prices: a later start applies from then on, earlier months keep theirs.
  const gia = [['ACHI KIDS 28', '2026-09', 'buoi', 300000], ['ACHI KIDS 28', '2026-11', 'gio', '200.000'], ['TÚ', '2026-10', 'mien', '']];
  assert.strictEqual(L.tutorRate(gia, 'ACHI KIDS 28', '2026-10').price, 300000);
  assert.strictEqual(L.tutorRate(gia, 'ACHI KIDS 28', '2026-11').mode, 'gio');
  assert.strictEqual(L.tutorRate(gia, 'TÚ', '2026-09'), null);

  // A bill: only sessions held and with a teacher count; the card can read it; QR goes to the MB account.
  const items = thu => L.tutorItems({ sessions: s, gia, thu, month: '2026-10', today });
  let a = items([])[0];
  assert.strictEqual(a.name, 'ACHI KIDS 28'); assert.strictEqual(a.count, 2); assert.strictEqual(a.minutes, 240); assert.strictEqual(a.bad.length, 1); assert.strictEqual(a.offs.length, 1);
  assert.strictEqual(a.total, 600000); assert.ok(a.finished);
  assert.ok(a.msg.includes('Tháng 10/2026 con học 2 buổi, tổng 4 giờ.'));
  assert.ok(a.msg.includes('1. Thứ 2, 05/10: 19.00 - 21.00 (THUY TRANG)')); assert.ok(a.msg.includes('2. Thứ 3, 06/10:'));
  assert.ok(a.msg.includes('Buổi nghỉ không tính: 11/10.'));
  assert.ok(a.msg.includes('- Học phí: 2 buổi x 300.000 đồng/buổi = 600.000 đồng'));
  assert.ok(a.msg.includes('Tổng số tiền cần thanh toán là: 600.000 đồng.'));
  assert.ok(a.qr.startsWith('https://img.vietqr.io/image/MB-0918041993-compact2.png?amount=600000&addInfo=TUTOR%20T10%20ACHI%20KIDS%2028'));
  assert.ok(a.qr.endsWith('accountName=TRIEU%20THI%20VAN%20TRANG'));
  // Hours, with a book.
  const nov = [{ name: 'ACHI KIDS 28', day: L.dayOf('03/11/2026'), time: '19.00 - 20.30', teacher: 'A', min: 90, off: false }, { name: 'ACHI KIDS 28', day: L.dayOf('20/11/2026'), time: '19.00 - 20.30', teacher: 'A', min: 90, off: false }];
  let b = L.tutorItems({ sessions: nov, gia, month: '2026-11', today, thu: [['T|2026-11|ACHI KIDS 28', '2026-11', 'ACHI KIDS 28', '', '', '', JSON.stringify([{ name: 'Discover 1', price: 250000 }])]] })[0];
  assert.strictEqual(b.count, 1, 'a session after today is not counted yet'); assert.strictEqual(b.later.length, 1); assert.strictEqual(b.fee, 300000); assert.strictEqual(b.total, 550000); assert.strictEqual(b.finished, false);
  assert.ok(b.msg.includes('- Học phí: 1 giờ 30 phút x 200.000 đồng/giờ = 300.000 đồng')); assert.ok(b.msg.includes('- Sách: Discover 1: 250.000 đồng'));
  // Free: never counted, unless there is a book to pay for.
  const tu = [{ name: 'TÚ', day: L.dayOf('05/10/2026'), time: '9.00 - 10.30', teacher: 'A', min: 90, off: false }];
  let c = L.tutorItems({ sessions: tu, gia, month: '2026-10', today, thu: [] })[0];
  assert.strictEqual(c.mien, true); assert.strictEqual(c.total, 0);
  c = L.tutorItems({ sessions: tu, gia, month: '2026-10', today, thu: [['T|2026-10|TÚ', '2026-10', 'TÚ', '', '', '', JSON.stringify([{ name: 'S', price: 100000 }])]] })[0];
  assert.strictEqual(c.mien, false); assert.strictEqual(c.total, 100000); assert.ok(c.msg.includes('- Học phí: miễn phí'));
  // No price yet.
  assert.strictEqual(L.tutorItems({ sessions: tu, gia: [], month: '2026-10', today, thu: [] })[0].trong, true);

  // Marking keeps the figure; a later price or Schedule change is flagged, not applied; Sửa riêng wins.
  a = items([]);
  let row = L.tutorRecord(a[0], { sentAt: '05/11/2026', by: 'Cô Trang' }, 'Cô Trang', 'x');
  assert.strictEqual(row.length, 15); assert.strictEqual(row[0], 'T|2026-10|ACHI KIDS 28'); assert.strictEqual(row[3], 2); assert.strictEqual(row[5], 600000); assert.strictEqual(row[9], '05/11/2026');
  const giaMoi = [['ACHI KIDS 28', '2026-10', 'buoi', 350000]];
  let d = L.tutorItems({ sessions: s, gia: giaMoi, thu: [row], month: '2026-10', today })[0];
  assert.strictEqual(d.row, 2); assert.strictEqual(d.amount, 600000); assert.strictEqual(d.total, 700000); assert.strictEqual(d.changed, true); assert.ok(d.qr.includes('amount=600000'));
  row = L.tutorRecord(d, { paid: '06/11/2026' }, 'Cô Trang', 'x'); assert.strictEqual(row[5], 600000, 'paying keeps what was sent'); assert.strictEqual(row[12], '06/11/2026');
  row = L.tutorRecord(d, { own: 650000 }, 'Cô Trang', 'x'); assert.strictEqual(row[5], 650000, 'an edited amount replaces it');
  const undone = L.tutorRecord(a[0], { sentAt: '', by: '' }, 'Cô Trang', 'x'); assert.strictEqual(undone[5], ''); assert.strictEqual(undone[9], '');
  d = L.tutorItems({ sessions: s, gia, thu: [L.tutorRecord(a[0], { own: 500000, riengMsg: 'Tin riêng' }, 'x', 'y')], month: '2026-10', today })[0];
  assert.strictEqual(d.amount, 500000); assert.strictEqual(d.msg, 'Tin riêng'); assert.ok(d.qr.includes('amount=500000'));
  // Reminders reuse the same 7-then-2-days rule.
  const r7 = L.tutorItems({ sessions: s, gia, thu: [L.tutorRecord(a[0], { sentAt: '29/10/2026' }, 'x', 'y')], month: '2026-10', today })[0];
  assert.strictEqual(L.remindDue([r7], { [r7.key]: { at: r7.sentAt, lan: r7.lan } }, today, NaN).length, 1);
  assert.strictEqual(L.remindDue([r7], { [r7.key]: { at: r7.sentAt, lan: r7.lan } }, L.dayOf('04/11/2026'), NaN).length, 0);
}
console.log('OK');
