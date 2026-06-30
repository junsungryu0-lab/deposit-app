// 예치 현황 관리 - 로컬 서버
// 데이터는 data/deposits.json 파일에 저장됩니다.

const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'deposits.json');

// 비밀번호 보호
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
app.use(express.static(path.join(__dirname, 'public')));

// multer 메모리 업로드 (파일을 디스크 저장 없이 메모리에서 처리)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 날짜 포맷 헬퍼 (YYMMDD)
function dateTag() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// 엑셀 날짜 시리얼 → YYYY-MM-DD 변환
function excelDateToStr(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return '';
    const mm = String(d.m).padStart(2, '0');
    const dd = String(d.d).padStart(2, '0');
    return `${d.y}-${mm}-${dd}`;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    // YYYY-MM-DD or YYYY/MM/DD
    const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }
  return String(val).trim();
}

function isValidDate(str) {
  if (!str) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(new Date(str).getTime());
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveData(records) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

// ── 기존 CRUD ──────────────────────────────────────────
app.get('/api/deposits', (req, res) => res.json(loadData()));

app.post('/api/deposits', (req, res) => {
  const records = loadData();
  const rec = req.body;
  if (!rec.customer || !rec.bank || !rec.product || !rec.amount || !rec.start || !rec.end)
    return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
  rec.id = 'id' + Date.now() + Math.floor(Math.random() * 1000);
  records.push(rec);
  saveData(records);
  res.json(rec);
});

app.put('/api/deposits/:id', (req, res) => {
  const records = loadData();
  const idx = records.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '해당 내역을 찾을 수 없습니다.' });
  records[idx] = { ...records[idx], ...req.body, id: req.params.id };
  saveData(records);
  res.json(records[idx]);
});

app.delete('/api/deposits/:id', (req, res) => {
  let records = loadData();
  records = records.filter(r => r.id !== req.params.id);
  saveData(records);
  res.json({ ok: true });
});

// ── JSON 백업 ───────────────────────────────────────────
app.get('/api/backup', (req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="deposits_backup_${dateTag()}.json"`);
  res.json(loadData());
});

// ── 엑셀 다운로드 ──────────────────────────────────────
app.get('/api/excel/download', (req, res) => {
  const records = loadData();

  const headers = ['고객명', '은행종류', '예금(상품)명', '금액', '예치일', '만기일', '이율(%)'];
  const rows = records.map(r => [
    r.customer, r.bank, r.product,
    r.amount,
    r.start, r.end,
    r.rate != null ? r.rate : ''
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // 컬럼 너비
  ws['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 20 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }
  ];

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
  ws['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 20 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }
  ];

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

  // 1행은 헤더, 2행(index 1)부터 데이터
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1; // 사용자 눈에 보이는 행 번호
    const rowErrors = [];

    // 빈 행 스킵
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
    else if (!isValidDate(start)) rowErrors.push(`예치일 형식이 올바르지 않습니다 → YYYY-MM-DD 형식으로 입력해주세요 (입력값: "${startRaw}")`);

    const end = excelDateToStr(endRaw);
    if (!endRaw && endRaw !== 0) rowErrors.push('만기일이 비어있습니다');
    else if (!isValidDate(end)) rowErrors.push(`만기일 형식이 올바르지 않습니다 → YYYY-MM-DD 형식으로 입력해주세요 (입력값: "${endRaw}")`);

    if (isValidDate(start) && isValidDate(end) && new Date(end) <= new Date(start))
      rowErrors.push('만기일이 예치일보다 같거나 빠릅니다');

    let rate = null;
    if (rateRaw !== '' && rateRaw != null) {
      rate = parseFloat(rateRaw);
      if (isNaN(rate) || rate < 0 || rate > 100)
        rowErrors.push(`이율이 올바르지 않습니다 (0~100 사이 숫자, 입력값: "${rateRaw}")`);
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, messages: rowErrors });
    } else {
      newRecords.push({
        id: 'id' + Date.now() + Math.floor(Math.random() * 9999) + i,
        customer, bank, product,
        amount, start, end,
        rate: rate != null ? rate : null
      });
    }
  }

  if (errors.length > 0) {
    return res.status(422).json({ errors });
  }

  // 기존 데이터에 추가 (덮어쓰기 아님)
  const existing = loadData();
  saveData([...existing, ...newRecords]);

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
