// 예치 현황 관리 - 로컬 서버
// 데이터는 data/deposits.json 파일에 저장됩니다 (브라우저 저장이 아닌 실제 파일 저장).

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'deposits.json');

// 간단한 비밀번호 보호 (환경변수 APP_PASSWORD로 설정, 미설정 시 기본값 사용)
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

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('데이터 파일 읽기 오류:', e);
    return [];
  }
}

function saveData(records) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

// 전체 목록 조회
app.get('/api/deposits', (req, res) => {
  res.json(loadData());
});

// 신규 등록
app.post('/api/deposits', (req, res) => {
  const records = loadData();
  const rec = req.body;
  if (!rec.customer || !rec.bank || !rec.product || !rec.amount || !rec.start || !rec.end) {
    return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
  }
  rec.id = 'id' + Date.now() + Math.floor(Math.random() * 1000);
  records.push(rec);
  saveData(records);
  res.json(rec);
});

// 수정
app.put('/api/deposits/:id', (req, res) => {
  const records = loadData();
  const idx = records.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '해당 내역을 찾을 수 없습니다.' });
  records[idx] = { ...records[idx], ...req.body, id: req.params.id };
  saveData(records);
  res.json(records[idx]);
});

// 삭제
app.delete('/api/deposits/:id', (req, res) => {
  let records = loadData();
  records = records.filter(r => r.id !== req.params.id);
  saveData(records);
  res.json({ ok: true });
});

// 데이터 백업 다운로드 (JSON 파일 그대로 받기, 파일명에 YYMMDD 날짜 포함)
app.get('/api/backup', (req, res) => {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const filename = `deposits_backup_${yy}${mm}${dd}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(loadData());
});

app.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('  예치 현황 관리 프로그램이 실행되었습니다.');
  console.log('  아래 주소를 웹 브라우저(크롬 등)에 붙여넣으세요:');
  console.log('');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  종료하려면 이 창에서 Ctrl + C 를 누르세요.');
  console.log('========================================');
  console.log('');
});
