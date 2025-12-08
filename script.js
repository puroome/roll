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
let lastTouchTime = 0;

// ==========================================================
// [초기화]
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  window.onSaveBtnClick = onSaveBtnClick;
  window.onMonthChange = onMonthChange;
  window.getPendingCount = () => Object.keys(pendingChanges).length;
  window.loadStudents = loadStudents;
  window.saveState = saveState;
  window.toggleReasonInput = toggleReasonInput;
  window.hideConfirmModal = hideConfirmModal;
  window.executeSave = executeSave;

  // --------------------------------------------------------
  // [핵심 수정] 변경 확인 로직 (뒤로가기와 동일한 원리 적용)
  // --------------------------------------------------------
  const monthSelect = document.getElementById('monthSelect');
  const weekSelect = document.getElementById('weekSelect');
  const classSelect = document.getElementById('classCombinedSelect');

  // [1] 변경 시도 시 실행되는 공통 함수
  function handleSelectChange(event, callback) {
    const element = event.target;
    const newValue = element.value;
    const oldValue = element.dataset.prev; // 직전에 저장된 '안전한' 값

    // 저장 안 된 데이터가 없으면 -> 그냥 통과
    if (Object.keys(pendingChanges).length === 0) {
      element.dataset.prev = newValue; // 새 값을 안전한 값으로 업데이트
      callback();
      return;
    }

    // 저장 안 된 데이터가 있으면 -> 확인 창
    if (confirm("저장하지 않은 변경사항이 있습니다.\n무시하고 이동하시겠습니까? (변경사항은 사라집니다)")) {
      // [확인]: 변경사항 초기화하고 이동
      pendingChanges = {};
      updateSaveButtonUI();
      element.dataset.prev = newValue; // 이동 확정
      callback();
    } else {
      // [취소]: 변경사항 유지하고, 드롭다운만 원래대로 되돌림
      element.value = oldValue; // UI를 강제로 되돌림
      // callback 실행 안 함 (이동 중단)
    }
  }

  // [2] 이벤트 연결
  monthSelect.addEventListener('change', (e) => handleSelectChange(e, () => {
    onMonthChange();
    saveState();
  }));

  weekSelect.addEventListener('change', (e) => handleSelectChange(e, () => {
    loadStudents();
    saveState();
  }));

  classSelect.addEventListener('change', (e) => handleSelectChange(e, () => {
    loadStudents();
    saveState();
  }));
  
  // --------------------------------------------------------
  
  document.getElementById('modalCancelBtn').addEventListener('click', hideConfirmModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', executeSave);
  
  const radios = document.getElementsByName('attType');
  radios.forEach(r => r.addEventListener('change', toggleReasonInput));

  document.addEventListener('contextmenu', event => event.preventDefault());
  
  // [기존] 브라우저 종료/새로고침/뒤로가기 방지 로직
  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(pendingChanges).length > 0) {
      e.preventDefault();
      e.returnValue = ''; // 크롬 등에서 기본 경고창 표시
    }
  });

  toggleReasonInput();
  fetchInitDataFromFirebase();
});

// [헬퍼 함수] 현재 드롭다운 상태를 '안전한 값'으로 저장
// 데이터 로드 완료 직후에 호출하여 기준점을 잡습니다.
function setSafeDropdownValues() {
  const ids = ['monthSelect', 'weekSelect', 'classCombinedSelect'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.dataset.prev = el.value;
  });
}

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
  // 로딩 시작 (이 시점은 이미 사용자가 이동을 '확인'했거나 변경사항이 없는 상태임)
  pendingChanges = {}; // 안전하게 초기화
  
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
      updateSaveButtonUI();
      setSafeDropdownValues(); // [중요] 로드 성공 시 현재 상태 저장
    } else {
      document.getElementById('tableContainer').innerHTML = '<div style="padding:20px; text-align:center;">데이터 없음</div>';
      updateSaveButtonUI();
      setSafeDropdownValues(); // [중요] 데이터 없어도 이동은 했으니 상태 저장
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

  const nameHeader = document.querySelector('thead th.col-name');
  if(nameHeader) nameHeader.innerText = "...";

  const year = CURRENT_YEAR;
  const month = document.getElementById('monthSelect').value;
  const week = document.getElementById('weekSelect').value;
  const combinedVal = document.getElementById('classCombinedSelect').value;
  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  const currentTableData = window.currentRenderedData; 
  
  keys.forEach(key => {
    const [r, c] = key.split('-'); 
    const val = pendingChanges[key];
    const student = currentTableData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) att.value = val;
    }
  });

  const backupPayload = keys.map(key => {
    const [r, c] = key.split('-');
    const val = pendingChanges[key] !== undefined ? pendingChanges[key] : 
                window.currentRenderedData.students.find(s=>s.rowNumber==r).attendance.find(a=>a.colIndex==c).value;
    
    return { year: year, row: r, col: c, value: val };
  });

  const path = `attendance/${year}/${month}/${week}/${grade}-${cls}`;
  const updateRef = ref(db, path);
  
  try {
    await update(updateRef, currentTableData); 
    
    keys.forEach(key => {
        const [r, c] = key.split('-');
        const cell = document.querySelector(`.check-cell[data-row="${r}"][data-col="${c}"]`);
        if (cell) cell.classList.remove('unsaved-cell');
    });
    
    showToast("저장완료");

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
    updateSaveButtonUI();
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
  setSafeDropdownValues(); // [중요] 초기화 완료 후 현재 상태 저장
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
  
  setSafeDropdownValues(); // [중요] 월/주 구성이 바뀌면 현재 상태 다시 저장
}

// ----------------------------------------------------------------
// [유지] 라디오 버튼 변경 시 무조건 사유 텍스트 초기화
// ----------------------------------------------------------------
function toggleReasonInput() {
  const radios = document.getElementsByName('attType');
  let selected = ""; 
  for (const r of radios) if (r.checked) selected = r.value;
  
  const input = document.getElementById('reasonInput');
  
  // 라디오 버튼 변경 시 입력값 즉시 초기화
  input.value = ""; 

  if (selected === "△" || selected === "○") { 
    input.disabled = false; 
  } else { 
    input.disabled = true; 
  }
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

  const nameHeader = container.querySelector('thead th.col-name');
  if (nameHeader) {
      nameHeader.addEventListener('click', onSaveBtnClick);
  }
  updateSaveButtonUI();

  addDragListeners(); addFocusListeners();
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
  cell.innerHTML = formatValueToHtml(newValue);

  cell.classList.remove('flash-success'); 
  void cell.offsetWidth; 
  cell.classList.add('flash-success');
  setTimeout(() => { cell.classList.remove('flash-success'); }, 500);

  const r = cell.getAttribute('data-row'); 
  const c = cell.getAttribute('data-col');
  const key = `${r}-${c}`;

  let originalValue = "";
  if (window.currentRenderedData && window.currentRenderedData.students) {
    const student = window.currentRenderedData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) originalValue = att.value;
    }
  }

  if (newValue === originalValue) {
    delete pendingChanges[key];
    cell.classList.remove('unsaved-cell');
  } else {
    pendingChanges[key] = newValue;
    cell.classList.add('unsaved-cell');
  }

  updateSaveButtonUI();
}

function updateSaveButtonUI() {
  const count = Object.keys(pendingChanges).length;
  const nameHeader = document.querySelector('thead th.col-name');
  
  if (!nameHeader) return;

  if (count > 0) { 
      nameHeader.innerHTML = `저장<br>(${count})`; 
      nameHeader.classList.add('save-active'); 
  } else { 
      nameHeader.innerHTML = "이름"; 
      nameHeader.classList.remove('save-active'); 
  }
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
  if(navigator.vibrate) navigator.vibrate(1);

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
