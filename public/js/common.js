// 공통 네비게이션 렌더링 및 유틸 함수

function renderGNB(activePage){
  const items = [
    { key:'manage',  label:'예치 데이터 등록/관리', href:'/manage' },
    { key:'inquiry', label:'조회 현황',            href:'/inquiry' },
    { key:'master',  label:'기초코드 관리',         href:'/master' },
  ];
  const html = `
    <div class="gnb">
      <div class="gnb-inner">
        <span class="gnb-title">예치 현황 관리</span>
        ${items.map(it => `<a href="${it.href}" class="${it.key===activePage?'active':''}">${it.label}</a>`).join('')}
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('afterbegin', html);
}

function showToast(msg){
  let t = document.getElementById('globalToast');
  if(!t){
    t = document.createElement('div');
    t.id = 'globalToast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}

const fmtAmt = n => Number(n).toLocaleString('ko-KR') + '원';
