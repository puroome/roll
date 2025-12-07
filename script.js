// script.js

// ==========================================================
// [1] Firebase 라이브러리
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, get, update, child } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==========================================================
// [2] Firebase 설정
// ==========================================================
const firebaseConfig = {
  apiKey: "AIzaSyAB1JoulqyMqo3KxS64igennc_dIPKLz7E",
  authDomain: "attendance-2d8c9.firebaseapp.com",
  projectId: "attendance-2d8c9",
  storageBucket: "attendance-2d8c9.firebasestorage.app",
  messagingSenderId: "413105215000",
  appId: "1:413105215000:web:8d0ff808f1f069c2a5156d",
  databaseURL: "https://attendance-2d8c9-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ★ 중요: Code.gs를 배포한 후 생성된 "웹 앱 URL"을 여기에 정확히 입력해야 합니다.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyrfBR0zPaaTrGOrVUl3r1fRjDrPXnG7uycNL0547aOrSdTiXLbG2ggooANum2hX4NFFg/exec";

// ==========================================================
// [전역 변수]
// ==========================================================
let globalData = {}; 
const CURRENT_YEAR = new Date().getFullYear().toString();

let isMultiMode = false;
let selectedCells = new Set();
let dragStartAction = null;
let longPressTimer = null;
let dragStartCell = null;
let pendingChanges = {};

// [핵심] 뒷북 마우스 클릭 방지용 시간 기록
let lastTouchTime = 0;

// ==========================================================
// [초기화]
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  window.onSaveBtnClick = onSaveBtnClick;
  window.onMonthChange = onMonthChange;
  window.loadStudents = loadStudents;
  window.saveState = saveState;
  window.toggleReasonInput = toggleReasonInput;
  window.hideConfirmModal = hideConfirmModal;
  window.executeSave = executeSave;

  document.getElementById('monthSelect').addEventListener('change', () => { onMonthChange(); saveState(); });
  document.getElementById('weekSelect').addEventListener('change', () => { loadStudents(); saveState(); });
  document.getElementById('classCombinedSelect').addEventListener('change', () => { loadStudents(); saveState(); });
  document.getElementById('saveBtn').addEventListener('click', onSaveBtnClick);
  document.getElementById('modalCancelBtn').addEventListener('click', hideConfirmModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', executeSave);
  
  const radios = document.getElementsByName('attType');
  radios.forEach(r => r.addEventListener('change', toggleReasonInput));

  document.addEventListener('contextmenu', event => event.preventDefault());
  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(pendingChanges).length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // [추가] 리사이즈 시 높이 재조정
  window.addEventListener('resize', adjustRowHeight);

  toggleReasonInput();
  fetchInitDataFromFirebase();
});

// ==========================================================
// [통신 함수]
// ==========================================================
async function fetchInitDataFromFirebase() {
  document.getElementById('loading').style.display = 'inline';
  const dbRef = ref(db);
  try {
    const snapshot = await get(child(dbRef, `metadata`));
    if (snapshot.exists()) {
      initUI(snapshot.val());
    } else {
      alert("Firebase 데이터 없음");
    }
  } catch (error) {
    console.error(error);
    alert("데이터 로드 실패: " + error.message);
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

async function loadStudents() {
  pendingChanges = {};
  updateSaveButtonUI();

  const year = CURRENT_YEAR;
  const month = document.getElementById('monthSelect').value;
  const week = document.getElementById('weekSelect').value;
  const combinedVal = document.getElementById('classCombinedSelect').value; 

  if (!year || !month || !week || !combinedVal) return;

  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  document.getElementById('loading').style.display = 'inline';
  
  const path = `attendance/${year}/${month}/${week}/${grade}-${cls}`;
  const dbRef = ref(db);

  try {
    const snapshot = await get(child(dbRef, path));
    if (snapshot.exists()) {
      renderTable(snapshot.val());
    } else {
      document.getElementById('tableContainer').innerHTML = '<div style="padding:20px; text-align:center;">데이터 없음</div>';
    }
  } catch (error) {
    console.error(error);
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

async function executeSave() {
  document.getElementById('confirmModal').classList.remove('show');
  const keys = Object.keys(pendingChanges);
  if (keys.length === 0) return;

  const btn = document.getElementById('saveBtn');
  btn.innerText = "...";
  btn.disabled = true;

  const year = CURRENT_YEAR;
  const month = document.getElementById('monthSelect').value;
  const week = document.getElementById('weekSelect').value;
  const combinedVal = document.getElementById('classCombinedSelect').value;
  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  const currentTableData = window.currentRenderedData; 
  
  // 1. Firebase 데이터 업데이트 준비
  keys.forEach(key => {
    const [r, c] = key.split('-'); 
    const val = pendingChanges[key];
    const student = currentTableData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) att.value = val;
    }
  });

  // 2. 구글 시트 백업용 데이터 준비 (배열로 묶기)
  const backupPayload = keys.map(key => {
    const [r, c] = key.split('-');
    const val = pendingChanges[key] !== undefined ? pendingChanges[key] : 
                window.currentRenderedData.students.find(s=>s.rowNumber==r).attendance.find(a=>a.colIndex==c).value;
    
    return { year: year, row: r, col: c, value: val };
  });

  const path = `attendance/${year}/${month}/${week}/${grade}-${cls}`;
  const updateRef = ref(db, path);
  
  try {
    // 3. Firebase 저장 (빠름)
    await update(updateRef, currentTableData); 
    
    // UI 업데이트 (붉은 테두리 제거)
    keys.forEach(key => {
        const [r, c] = key.split('-');
        const cell = document.querySelector(`.check-cell[data-row="${r}"][data-col="${c}"]`);
        if (cell) cell.classList.remove('unsaved-cell');
    });
    
    showToast("저장완료");

    // 4. 구글 시트 백업 (일괄 전송)
    if (backupPayload.length > 0) {
        const payload = { action: "saveAttendanceBatch", data: backupPayload };
        fetch(APPS_SCRIPT_URL, { 
            method: "POST", 
            body: JSON.stringify(payload) 
        })
        .then(res => res.json())
        .then(json => {
            if(json.error) console.error("시트 백업 에러:", json.error);
            else console.log("시트 백업 성공:", json.count + "건");
        })
        .catch(err => {
            console.error("시트 통신 실패", err);
            showToast("⚠️ 시트 백업 실패 (인터넷 확인)");
        });
    }

    pendingChanges = {};
    updateSaveButtonUI();

  } catch (error) {
    alert("저장 실패: " + error.message);
    btn.disabled = false;
    btn.innerText = "저장";
  }
}

// ==========================================================
// [UI 로직]
// ==========================================================
function saveState() { 
  const s = { 
    month: document.getElementById('monthSelect').value, 
    week: document.getElementById('weekSelect').value, 
    combinedClass: document.getElementById('classCombinedSelect').value 
  }; 
  localStorage.setItem('attendanceState', JSON.stringify(s)); 
}
function getSavedState() { const s = localStorage.getItem('attendanceState'); return s ? JSON.parse(s) : null; }

function initUI(data) {
  document.getElementById('loading').style.display = 'none';
  globalData = data;
  if (!globalData[CURRENT_YEAR]) { alert("올해 데이터 없음"); return; }
  setupYearData(CURRENT_YEAR);
  const s = getSavedState();
  const m = document.getElementById('monthSelect');
  if (s && s.month) { 
    const o = Array.from(m.options).find(opt => opt.value == s.month);
    if (o) { m.value = s.month; onMonthChange(true); }
  }
}

function setupYearData(year) {
  const info = globalData[year];
  const mSel = document.getElementById('monthSelect');
  const cSel = document.getElementById('classCombinedSelect'); 
  mSel.innerHTML = '<option value="">월</option>';
  cSel.innerHTML = '<option value="">반</option>';
  document.getElementById('weekSelect').innerHTML = '<option value="">주</option>';
  
  info.months.forEach(m => mSel.add(new Option(m + '월', m))); 
  info.grades.forEach(g => { info.classes.forEach(c => { cSel.add(new Option(`${g}-${c}`, `${g}-${c}`)); }); });
}

function onMonthChange(isRestoring = false) {
  const year = CURRENT_YEAR;
  const month = document.getElementById('monthSelect').value;
  const wSel = document.getElementById('weekSelect');
  const cSel = document.getElementById('classCombinedSelect');
  wSel.innerHTML = '<option value="">주</option>'; 
  if (!month || !globalData[year]) return;
  const weeks = globalData[year].weeks[month];
  
  if (weeks) { weeks.forEach(w => wSel.add(new Option(w + '주', w))); }
  
  if (isRestoring) {
     const s = getSavedState();
     if (s.week) { const o = Array.from(wSel.options).find(opt => opt.value == s.week); if (o) wSel.value = s.week; }
     if (s.combinedClass) { const o = Array.from(cSel.options).find(opt => opt.value == s.combinedClass); if (o) { cSel.value = s.combinedClass; loadStudents(); return; } }
  }
  if (weeks && weeks.length === 1) { wSel.value = weeks[0]; if(cSel.value) loadStudents(); saveState(); }
}

function toggleReasonInput() {
  const radios = document.getElementsByName('attType');
  let selected = ""; for (const r of radios) if (r.checked) selected = r.value;
  const input = document.getElementById('reasonInput');
  if (selected === "△" || selected === "○") { input.disabled = false; } else { input.disabled = true; input.value = ""; }
}

function getDayOfWeek(year, month, day) { const days = ['일', '월', '화', '수', '목', '금', '토']; const d = new Date(year, month - 1, day); return days[d.getDay()]; }

function renderTable(data) {
  window.currentRenderedData = data;
  document.getElementById('loading').style.display = 'none';
  const container = document.getElementById('tableContainer');
  const year = CURRENT_YEAR; 
  if (!data || data.error) { container.innerHTML = `<div style="padding:20px; text-align:center; color:red;">${data.error || '오류'}</div>`; return; }
  if (data.students.length === 0) { container.innerHTML = '<div style="padding:20px; text-align:center;">데이터 없음</div>'; return; }

  const first = data.students[0].attendance;
  let dayMap = {}; let colorIdx = 0;
  first.forEach(att => {
    if (!dayMap[att.day]) { colorIdx = (colorIdx + 1) % 2; dayMap[att.day] = { count: 0, colorClass: `bg-date-${colorIdx + 1}` }; }
    dayMap[att.day].count++;
  });

  let html = '<table><thead><tr><th rowspan="2" class="col-no">번호</th><th rowspan="2" class="col-name">이름</th>';
  let dateHeaderIdCounter = 0; let currentDay = null;
  
  first.forEach(att => {
    if (att.day !== currentDay) {
      currentDay = att.day; const info = dayMap[currentDay]; const dayOfWeek = getDayOfWeek(year, data.meta.month, currentDay);
      info.headerId = `date-header-${dateHeaderIdCounter++}`;
      // [수정] 날짜 헤더 생성 (클릭 이벤트를 위해 클래스 유지)
      html += `<th id="${info.headerId}" colspan="${info.count}" class="header-day ${info.colorClass}">${data.meta.month}월 ${currentDay}일 (${dayOfWeek})</th>`;
    }
  });
  html += '</tr><tr>';
  first.forEach(att => { html += `<th class="${dayMap[att.day].colorClass}" data-col="${att.colIndex}">${att.period}</th>`; });
  html += '</tr></thead><tbody>';

  data.students.forEach(std => {
    html += '<tr>';
    html += `<td>${std.no}</td><td class="col-name">${std.name}</td>`; 
    std.attendance.forEach(att => {
        const colorClass = dayMap[att.day].colorClass;
        const displayHtml = formatValueToHtml(att.value);
        const dateHeaderId = dayMap[att.day].headerId; 
        html += `<td class="check-cell ${colorClass}" data-row="${std.rowNumber}" data-col="${att.colIndex}" data-date-header-id="${dateHeaderId}"> ${displayHtml} </td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  // [추가] 날짜 클릭 시 저장 기능 연결
  container.querySelectorAll('.header-day').forEach(header => {
    header.addEventListener('click', () => {
        if(Object.keys(pendingChanges).length > 0) {
            onSaveBtnClick(); // 기존 저장 버튼(모달) 로직 실행
        } else {
            showToast("변경사항이 없습니다.");
        }
    });
  });

  addDragListeners(); 
  addFocusListeners();

  // [추가] 높이 자동 조절
  adjustRowHeight();
}

// [추가] 행 높이 자동 조절 함수
function adjustRowHeight() {
    const tableContainer = document.getElementById('tableContainer');
    const table = tableContainer.querySelector('table');
    if (!table) return;

    const rows = table.querySelectorAll('tbody tr');
    if (rows.length === 0) return;

    // 1. 사용 가능한 높이 계산
    const controlsHeight = document.querySelector('.controls').offsetHeight;
    const theadHeight = table.querySelector('thead').offsetHeight;
    const windowHeight = window.innerHeight;
    const availableHeight = windowHeight - controlsHeight - theadHeight - 20;

    // 2. 행 당 적절한 높이 계산
    const calculatedHeight = availableHeight / rows.length;
    const defaultHeight = 35; 

    // 3. 로직: 명단이 길어서 짤릴 때만 줄임
    let finalHeight = defaultHeight;
    if (calculatedHeight < defaultHeight) {
        finalHeight = calculatedHeight;
    }

    // 4. 스타일 적용
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach(td => {
            td.style.height = `${finalHeight}px`;
            // 높이가 너무 작아지면 폰트도 줄임
            if (finalHeight < 25) {
                td.style.fontSize = '11px';
            } else {
                td.style.fontSize = '13px';
            }
        });
    });
}

function formatValueToHtml(val) {
  if (!val) return "";
  const match = val.toString().match(/^([^(\s]+)\s*\((.+)\)$/);
  if (match) return `<span class="mark-symbol">${match[1]}</span><span class="mark-note">(${match[2]})</span>`;
  return `<span class="mark-symbol">${val}</span>`;
}
function showToast(message) { const t = document.getElementById("toast-container"); t.textContent = message; t.className = "show"; setTimeout(()=>{t.className = t.className.replace("show", "");}, 3000); }
function showConfirmModal() { document.getElementById('confirmModal').classList.add('show'); }
function hideConfirmModal() { document.getElementById('confirmModal').classList.remove('show'); showToast("취소됨"); }

function queueUpdate(cell, newValue) {
  // 1. 화면에 값 표시
  cell.innerHTML = formatValueToHtml(newValue);

  // 2. [수정됨] 깜빡임 효과 실행 및 자동 제거
  cell.classList.remove('flash-success'); 
  void cell.offsetWidth; // 리플로우 강제 (애니메이션 리셋용)
  cell.classList.add('flash-success');

  // ★ 0.5초 뒤에 애니메이션 클래스를 지워서 원래 배경색이 나오도록 함
  setTimeout(() => {
    cell.classList.remove('flash-success');
  }, 500);

  // 3. 좌표 및 키 생성
  const r = cell.getAttribute('data-row'); 
  const c = cell.getAttribute('data-col');
  const key = `${r}-${c}`;

  // 4. 원본 데이터 찾기 (DB 값)
  let originalValue = "";
  if (window.currentRenderedData && window.currentRenderedData.students) {
    const student = window.currentRenderedData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) originalValue = att.value;
    }
  }

  // 5. 변경 여부 판단 (원래 값과 비교)
  if (newValue === originalValue) {
    // 원래 값으로 돌아왔다면 -> 저장 목록 & 빨간 테두리 제거
    delete pendingChanges[key];
    cell.classList.remove('unsaved-cell');
  } else {
    // 값이 변경되었다면 -> 저장 목록 & 빨간 테두리 추가
    pendingChanges[key] = newValue;
    cell.classList.add('unsaved-cell');
  }

  // 6. 버튼 UI 갱신
  updateSaveButtonUI();
}
function updateSaveButtonUI() {
  const btn = document.getElementById('saveBtn'); const count = Object.keys(pendingChanges).length;
  if (count > 0) { btn.innerText = `저장 (${count})`; btn.disabled = false; btn.classList.add('active'); }
  else { btn.innerText = "저장"; btn.disabled = true; btn.classList.remove('active'); }
}
function onSaveBtnClick() { if (Object.keys(pendingChanges).length === 0) return; showConfirmModal(); }

// ==========================================================
// [이벤트] 드래그 및 터치
// ==========================================================

function addDragListeners() { 
  const cells = document.querySelectorAll('.check-cell'); 
  cells.forEach(c => { 
    c.addEventListener('mousedown', onMouseDown); 
    c.addEventListener('mouseenter', onMouseEnter); 
    c.addEventListener('touchstart', onTouchStart); 
    c.addEventListener('touchmove', onTouchMove); 
    c.addEventListener('touchend', onTouchEnd); 
  }); 
  document.addEventListener('mouseup', onMouseUp); 
}

function addFocusListeners() { const cells = document.querySelectorAll('.check-cell'); cells.forEach(c => { c.addEventListener('mouseenter', onCellFocusEnter); c.addEventListener('mouseleave', onCellFocusLeave); c.addEventListener('touchstart', onCellFocusEnter, {passive: true}); }); }
function highlightHeaders(cell) { const row = cell.closest('tr'); const col = cell.getAttribute('data-col'); const dhId = cell.getAttribute('data-date-header-id'); const nh = row.querySelector('.col-name'); if(nh) nh.classList.add('highlight-header'); const ph = document.querySelector(`thead tr:nth-child(2) th[data-col="${col}"]`); if(ph) ph.classList.add('highlight-header'); if(dhId){const dh=document.getElementById(dhId);if(dh)dh.classList.add('highlight-header');} }
function onCellFocusEnter(e) { if (isMultiMode) return; clearHeaderHighlights(); highlightHeaders(e.currentTarget); }
function onCellFocusLeave() { if (!isMultiMode) clearHeaderHighlights(); }
function clearHeaderHighlights() { document.querySelectorAll('.highlight-header').forEach(el => el.classList.remove('highlight-header')); }

function onMouseDown(e) { 
  if (Date.now() - lastTouchTime < 1000) return; 
  const cell = e.currentTarget;
  if (e.button === 0) {
    processSingleCell(cell);
    return;
  }
  if (e.button === 2) {
    startMultiSelect(cell);
  }
}

function onMouseEnter(e) { if(isMultiMode) addToSelection(e.currentTarget); }
function onMouseUp() { if(isMultiMode) finishMultiSelect(); }

function onTouchStart(e) { 
  lastTouchTime = Date.now(); 
  const cell = e.currentTarget;
  dragStartCell = cell; 
  longPressTimer = setTimeout(() => { 
    if(navigator.vibrate) navigator.vibrate(50); 
    startMultiSelect(cell); 
  }, 300); 
}

function onTouchMove(e) { 
  if(longPressTimer && !isMultiMode){clearTimeout(longPressTimer);longPressTimer=null;} 
  if(isMultiMode){e.preventDefault(); const t=e.touches[0]; const target=document.elementFromPoint(t.clientX, t.clientY); if(target){const c=target.closest('.check-cell'); if(c) addToSelection(c);}}
}

function onTouchEnd(e) { 
  lastTouchTime = Date.now(); 
  if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;} 
  if(isMultiMode) finishMultiSelect(); 
}

function startMultiSelect(cell) { 
  isMultiMode=true; 
  clearHeaderHighlights(); 
  selectedCells.clear(); 
  const hasData = cell.querySelector('.mark-symbol') !== null;
  dragStartAction = hasData ? 'clear' : 'fill'; 
  addToSelection(cell); 
}

function addToSelection(cell) { if(!selectedCells.has(cell)){selectedCells.add(cell); cell.classList.add('multi-selecting'); highlightHeaders(cell);} }

function finishMultiSelect() { 
  isMultiMode=false; 
  clearHeaderHighlights(); 
  let val=""; 
  
  if(dragStartAction==='fill'){
    const s = document.querySelector('input[name="attType"]:checked').value; 
    const r = document.getElementById('reasonInput').value.trim(); 
    if(s!==""){
      val=s; 
      if((s==="△"||s==="○")&&r!=="") val=`${s}(${r})`;
    }
  } 
  
  selectedCells.forEach(c=>{c.classList.remove('multi-selecting'); queueUpdate(c, val);}); 
  selectedCells.clear(); 
}

function processSingleCell(cell) { 
  if(isMultiMode) return; 
  const hasData = cell.querySelector('.mark-symbol') !== null;
  let val = ""; 
  
  if(!hasData){
    const s = document.querySelector('input[name="attType"]:checked').value; 
    const r = document.getElementById('reasonInput').value.trim(); 
    if(s==="") return; 
    val=s; 
    if((s==="△"||s==="○")&&r!=="") val=`${s}(${r})`;
  } 
  queueUpdate(cell, val); 
}

// ==========================================================
// [Android 연동 인터페이스]
// ==========================================================
window.checkUnsavedChanges = function() {
    return Object.keys(pendingChanges).length > 0;
};

window.forceSave = function() {
    executeSave();
};
