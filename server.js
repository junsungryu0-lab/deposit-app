// 예치 현황 관리 - 로컬/배포 서버

const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR       = path.join(__dirname, 'data');
const DEPOSIT_FILE    = path.join(DATA_DIR, 'deposits.json');
const BANK_FILE       = path.join(DATA_DIR, 'banks.json');
const CUSTOMER_FILE   = path.join(DATA_DIR, 'customers.json');

// ── 비밀번호 보호 ───────────────────────────────────────
const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme123';
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="deposit-app"');
    return res.status(401).send('인증이 필요합니다.');
  }
  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [, password] = decoded.split(':');
  if (password !== APP_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="deposit-app"');
    return res.status(401).send('비밀번호가 올바르지 않습니다.');
  }
  next();
});

app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── 공용 파일 입출력 ────────────────────────────────────
function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function loadDeposits()  { return loadJson(DEPOSIT_FILE, []); }
function saveDeposits(d) { saveJson(DEPOSIT_FILE, d); }

function loadBanks() {
  const existing = loadJson(BANK_FILE, null);
  if (existing) return existing;
  // 최초 실행 시 기본 은행 목록 생성
  const defaults = ['농협은행','국민은행','신한은행','우리은행','하나은행','기업은행','새마을금고','신협','저축은행','기타']
    .map((name, i) => ({ id: 'bank' + (i+1), name }));
  saveJson(BANK_FILE, defaults);
  return defaults;
}
function saveBanks(b) { saveJson(BANK_FILE, b); }

function loadCustomers() { return loadJson(CUSTOMER_FILE, []); }
function saveCustomers(c) { saveJson(CUSTOMER_FILE, c); }

function dateTag() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function excelDateToStr(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return '';
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }
  return String(val).trim();
}
function isValidDate(str) {
  return !!str && /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());
}

// ── 정적 파일 (HTML 직접 접근은 막고 라우트로만 노출) ───
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js',  express.static(path.join(__dirname, 'public', 'js')));

// ── 페이지 라우트 ───────────────────────────────────────
app.get('/', (req, res) => res.redirect('/manage'));
app.get('/manage',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'manage.html')));
app.get('/inquiry', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inquiry.html')));
app.get('/master',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'master.html')));

// ── 은행 마스터 API ─────────────────────────────────────
app.get('/api/banks', (req, res) => res.json(loadBanks()));

app.post('/api/banks', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '은행명을 입력해주세요.' });
  const banks = loadBanks();
  if (banks.some(b => b.name === name)) return res.status(409).json({ error: '이미 등록된 은행입니다.' });
  const bank = { id: 'bank' + Date.now(), name };
  banks.push(bank);
  saveBanks(banks);
  res.json(bank);
});

app.delete('/api/banks/:id', (req, res) => {
  const banks = loadBanks();
  const target = banks.find(b => b.id === req.params.id);
  if (!target) return res.status(404).json({ error: '해당 은행을 찾을 수 없습니다.' });

  // 사용 중인 예치 데이터가 있으면 삭제 차단
  const deposits = loadDeposits();
  const inUse = deposits.some(d => d.bank === target.name);
  if (inUse) return res.status(409).json({ error: `"${target.name}"은 등록된 예치 데이터에서 사용 중이라 삭제할 수 없습니다.` });

  saveBanks(banks.filter(b => b.id !== req.params.id));
  res.json({ ok: true });
});

// ── 고객 마스터 API ─────────────────────────────────────
app.get('/api/customers', (req, res) => res.json(loadCustomers()));

app.post('/api/customers', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '고객명을 입력해주세요.' });
  const customers = loadCustomers();
  const existing = customers.find(c => c.name === name);
  if (existing) return res.json(existing); // 이미 있으면 그대로 반환 (중복 등록 방지, 양방향 흐름용)
  const customer = { id: 'cust' + Date.now(), name };
  customers.push(customer);
  saveCustomers(customers);
  res.json(customer);
});

app.delete('/api/customers/:id', (req, res) => {
  const customers = loadCustomers();
  const target = customers.find(c => c.id === req.params.id);
  if (!target) return res.status(404).json({ error: '해당 고객을 찾을 수 없습니다.' });

  const deposits = loadDeposits();
  const inUse = deposits.some(d => d.customer === target.name);
  if (inUse) return res.status(409).json({ error: `"${target.name}"은 등록된 예치 데이터에서 사용 중이라 삭제할 수 없습니다.` });

  saveCustomers(customers.filter(c => c.id !== req.params.id));
  res.json({ ok: true });
});

// ── 예치 데이터 CRUD ────────────────────────────────────
app.get('/api/deposits', (req, res) => res.json(loadDeposits()));

app.post('/api/deposits', (req, res) => {
  const records = loadDeposits();
  const rec = req.body;
  if (!rec.customer || !rec.bank || !rec.product || !rec.amount || !rec.start || !rec.end)
    return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });

  // 신규 고객명이면 고객 마스터에도 자동 등록 (양방향 동기화)
  const customers = loadCustomers();
  if (!customers.some(c => c.name === rec.customer)) {
    customers.push({ id: 'cust' + Date.now(), name: rec.customer });
    saveCustomers(customers);
  }

  rec.id = 'id' + Date.now() + Math.floor(Math.random() * 1000);
  records.push(rec);
  saveDeposits(records);
  res.json(rec);
});

app.put('/api/deposits/:id', (req, res) => {
  const records = loadDeposits();
  const idx = records.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '해당 내역을 찾을 수 없습니다.' });

  if (req.body.customer) {
    const customers = loadCustomers();
    if (!customers.some(c => c.name === req.body.customer)) {
      customers.push({ id: 'cust' + Date.now(), name: req.body.customer });
      saveCustomers(customers);
    }
  }

  records[idx] = { ...records[idx], ...req.body, id: req.params.id };
  saveDeposits(records);
  res.json(records[idx]);
});

app.delete('/api/deposits/:id', (req, res) => {
  let records = loadDeposits();
  records = records.filter(r => r.id !== req.params.id);
  saveDeposits(records);
  res.json({ ok: true });
});

// ── JSON 백업 ───────────────────────────────────────────
app.get('/api/backup', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="deposits_backup_${dateTag()}.json"`);
  res.json(loadDeposits());
});

// ── 엑셀 다운로드 ──────────────────────────────────────
app.get('/api/excel/download', (req, res) => {
  const records = loadDeposits();
  const headers = ['고객명', '은행종류', '예금(상품)명', '금액', '예치일', '만기일', '이율(%)'];
  const rows = records.map(r => [r.customer, r.bank, r.product, r.amount, r.start, r.end, r.rate != null ? r.rate : '']);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{wch:14},{wch:12},{wch:20},{wch:14},{wch:12},{wch:12},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '예치현황');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="deposits_${dateTag()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── 샘플 양식 다운로드 ─────────────────────────────────
app.get('/api/excel/template', (req, res) => {
  const headers = ['고객명', '은행종류', '예금(상품)명', '금액', '예치일', '만기일', '이율(%)'];
  const sample = [
    ['홍길동', '농협은행', '정기예금 12개월', 10000000, '2026-01-01', '2026-12-31', 3.5],
    ['김철수', '국민은행', '정기예금 6개월',  5000000,  '2026-03-01', '2026-08-31', 3.2],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws['!cols'] = [{wch:14},{wch:12},{wch:20},{wch:14},{wch:12},{wch:12},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '예치현황');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="deposits_sample.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── 엑셀 업로드 ────────────────────────────────────────
app.post('/api/excel/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

  let wb;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
  } catch (e) {
    return res.status(400).json({ error: '엑셀 파일을 읽을 수 없습니다. 올바른 .xlsx 파일인지 확인해주세요.' });
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return res.status(400).json({ error: '데이터가 없습니다. 2행부터 데이터를 입력해주세요.' });

  const errors = [];
  const newRecords = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    const rowErrors = [];
    if (row.every(cell => cell === '' || cell == null)) continue;

    const customer = String(row[0] || '').trim();
    const bank     = String(row[1] || '').trim();
    const product  = String(row[2] || '').trim();
    const amountRaw = row[3];
    const startRaw  = row[4];
    const endRaw    = row[5];
    const rateRaw   = row[6];

    if (!customer) rowErrors.push('고객명이 비어있습니다');
    if (!bank)     rowErrors.push('은행종류가 비어있습니다');
    if (!product)  rowErrors.push('예금(상품)명이 비어있습니다');

    const amount = parseFloat(amountRaw);
    if (!amountRaw && amountRaw !== 0) rowErrors.push('금액이 비어있습니다');
    else if (isNaN(amount) || amount <= 0) rowErrors.push(`금액이 올바르지 않습니다 (입력값: "${amountRaw}")`);

    const start = excelDateToStr(startRaw);
    if (!startRaw && startRaw !== 0) rowErrors.push('예치일이 비어있습니다');
    else if (!isValidDate(start)) rowErrors.push(`예치일 형식이 올바르지 않습니다 → YYYY-MM-DD (입력값: "${startRaw}")`);

    const end = excelDateToStr(endRaw);
    if (!endRaw && endRaw !== 0) rowErrors.push('만기일이 비어있습니다');
    else if (!isValidDate(end)) rowErrors.push(`만기일 형식이 올바르지 않습니다 → YYYY-MM-DD (입력값: "${endRaw}")`);

    if (isValidDate(start) && isValidDate(end) && new Date(end) <= new Date(start))
      rowErrors.push('만기일이 예치일보다 같거나 빠릅니다');

    let rate = null;
    if (rateRaw !== '' && rateRaw != null) {
      rate = parseFloat(rateRaw);
      if (isNaN(rate) || rate < 0 || rate > 100) rowErrors.push(`이율이 올바르지 않습니다 (0~100, 입력값: "${rateRaw}")`);
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, messages: rowErrors });
    } else {
      newRecords.push({ id: 'id' + Date.now() + Math.floor(Math.random()*9999) + i, customer, bank, product, amount, start, end, rate });
    }
  }

  if (errors.length > 0) return res.status(422).json({ errors });

  // 신규 고객/은행이 있으면 마스터에도 자동 반영
  const customers = loadCustomers();
  const banks = loadBanks();
  let custChanged = false, bankChanged = false;
  newRecords.forEach(r => {
    if (!customers.some(c => c.name === r.customer)) { customers.push({ id:'cust'+Date.now()+Math.random(), name:r.customer }); custChanged = true; }
    if (!banks.some(b => b.name === r.bank)) { banks.push({ id:'bank'+Date.now()+Math.random(), name:r.bank }); bankChanged = true; }
  });
  if (custChanged) saveCustomers(customers);
  if (bankChanged) saveBanks(banks);

  const existing = loadDeposits();
  saveDeposits([...existing, ...newRecords]);
  res.json({ success: true, count: newRecords.length });
});

app.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('  예치 현황 관리 프로그램이 실행되었습니다.');
  console.log('  http://localhost:' + PORT);
  console.log('  종료: Ctrl + C');
  console.log('========================================');
  console.log('');
});
