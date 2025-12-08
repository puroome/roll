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

// 백업용 구글 스크립트 URL (기존 유지)
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

// [네비게이션 제어 변수]
let pendingNavigation = null;
let activeFilterId = null;
let previousSelectValues = {}; 

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
  
  // [추가] 팝업 닫기 함수 등록
  window.closeStudentModal = closeStudentModal;

  // 필터 요소들 (월, 주, 반)
  const filterIds = ['monthSelect', 'weekSelect', 'classCombinedSelect'];
  
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    
    el.addEventListener('focus', () => {
      previousSelectValues[id] = el.value;
    });

    el.addEventListener('change', (e) => {
      const runFilterLogic = () => {
        if (id === 'monthSelect') {
          onMonthChange(); 
        } else {
          loadStudents(); 
        }
        saveState(); 
      };

      if (Object.keys(pendingChanges).length > 0) {
        activeFilterId = id;
        pendingNavigation = runFilterLogic; 
        showConfirmModal();
      } else {
        runFilterLogic();
      }
    });
  });
  
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
      updateSaveButtonUI();
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
  if (keys.length === 0) {
    if (pendingNavigation) {
        pendingNavigation();
        pendingNavigation = null;
        activeFilterId = null;
    }
    return;
  }

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
            // showToast("⚠️ 시트 백업 실패 (인터넷 확인)"); 
        });
    }

    pendingChanges = {};
    updateSaveButtonUI();

    if (pendingNavigation) {
        pendingNavigation(); 
        pendingNavigation = null;
        activeFilterId = null;
    }

  } catch (error) {
    alert("저장 실패: " + error.message);
    updateSaveButtonUI();
    pendingNavigation = null;
    activeFilterId = null;
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

// [수정됨] 월 변경 시 주차(Week) 자동 계산 로직 적용
function onMonthChange(isRestoring = false) {
  const year = CURRENT_YEAR;
  const month = document.getElementById('monthSelect').value;
  const wSel = document.getElementById('weekSelect');
  const cSel = document.getElementById('classCombinedSelect');
  
  wSel.innerHTML = '<option value="">주</option>'; 
  
  if (!month) return; // 월이 선택되지 않았으면 종료

  // [변경] 기존 globalData에서 가져오는 대신 함수로 계산
  const weeks = calculateWeeks(year, month);
  
  weeks.forEach(w => wSel.add(new Option(w + '주', w)));
  
  if (isRestoring) {
     const s = getSavedState();
     if (s.week) { 
       const o = Array.from(wSel.options).find(opt => opt.value == s.week); 
       if (o) wSel.value = s.week; 
     }
     if (s.combinedClass) { 
       const o = Array.from(cSel.options).find(opt => opt.value == s.combinedClass); 
       if (o) { 
         cSel.value = s.combinedClass; 
         loadStudents(); 
         return; 
       } 
     }
  }
}

// [신규 추가] 요청하신 규칙대로 주차 리스트 생성 함수
function calculateWeeks(year, month) {
  const weeks = [];
  
  // 해당 월의 1일 날짜 정보
  const firstDayDate = new Date(year, month - 1, 1);
  const dayOfWeek = firstDayDate.getDay(); // 0:일, 1:월 ... 6:토
  
  // 마지막 날짜 (그 달의 말일)
  const lastDayDate = new Date(year, month, 0);
  const lastDate = lastDayDate.getDate();

  let startDate = 1;

  // 규칙 적용: 
  // 1일이 토(6) -> 다음주 월요일(3일)부터 1주차
  // 1일이 일(0) -> 다음날 월요일(2일)부터 1주차
  // 1일이 월~금 -> 1일부터 1주차
  if (dayOfWeek === 6) {
    startDate = 3;
  } else if (dayOfWeek === 0) {
    startDate = 2;
  } else {
    startDate = 1;
  }

  let currentWeekCount = 1;
  
  // 시작일(startDate)부터 7일씩 더해가며 말일을 넘지 않을 때까지 주차 생성
  for (let d = startDate; d <= lastDate; d += 7) {
    weeks.push(currentWeekCount.toString());
    currentWeekCount++;
  }

  return weeks;
}

function toggleReasonInput() {
  const radios = document.getElementsByName('attType');
  let selected = ""; 
  for (const r of radios) if (r.checked) selected = r.value;
  
  const input = document.getElementById('reasonInput');
  input.value = "";  

  if (selected === "△" || selected === "○") { 
    input.disabled = false; 
  } else { 
    input.disabled = true; 
    input.value = ""; 
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

  let html = '<table><thead><tr><th rowspan="2" class="col-no" style="cursor:pointer;" onclick="window.open(\'https://docs.google.com/spreadsheets/d/1gEA0AMd-l21L9LPOtQX4YQTHKlBd6FVs2otgyLbLXC8/edit?usp=sharing\', \'_blank\')">번호</th><th rowspan="2" class="col-name">이름</th>';
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
    html += `<td>${std.no}</td>`;
    
    // [수정] 식별을 위해 std.no도 같이 넘깁니다. (번호가 고유하다고 가정)
    html += `<td class="col-name" onclick="showStudentSummary('${std.no}', '${std.name}')">${std.name}</td>`;
    
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

function hideConfirmModal() { 
  document.getElementById('confirmModal').classList.remove('show'); 
  
  if (activeFilterId && previousSelectValues[activeFilterId] !== undefined) {
      document.getElementById(activeFilterId).value = previousSelectValues[activeFilterId];
  }

  pendingNavigation = null;
  activeFilterId = null;
  
  showToast("취소됨"); 
}

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

// ==========================================================
// [추가] 학생별 "월간 전체" 출결 요약 팝업 로직
// ==========================================================

// 기호 -> 텍스트 매핑 함수
function convertSymbolToText(symbol) {
  if (symbol === '△') return '인정';
  if (symbol === '○') return '병';
  if (symbol === 'Ⅹ' || symbol === 'X' || symbol === 'x') return '무단';
  return symbol; // 그 외는 그대로
}

// 1. 팝업 열기 및 전체 데이터 로드
window.showStudentSummary = async function(studentNo, studentName) {
  const month = document.getElementById('monthSelect').value;
  const year = CURRENT_YEAR;
  const combinedVal = document.getElementById('classCombinedSelect').value;
  
  if (!month || !combinedVal) return;

  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  // 1. 모달 띄우기 (로딩 상태)
  const title = `${studentName} (${month}월 출결)`;
  document.getElementById('studentModalTitle').innerText = title;
  document.getElementById('studentModalBody').innerHTML = "<div style='text-align:center; padding:30px; color:#888;'>전체 데이터를 불러오는 중...</div>";
  document.getElementById('studentModal').classList.add('show');

  try {
    // 2. 해당 월의 '모든 주차' 정보 가져오기
    // globalData에 주차 정보가 있다고 가정 (setupYearData 참조)
    const weeks = globalData[year].weeks[month]; // ["1", "2", "3", "4", "5"]
    
    if (!weeks || weeks.length === 0) {
       document.getElementById('studentModalBody').innerHTML = "<div style='text-align:center; padding:20px;'>데이터가 없습니다.</div>";
       return;
    }

    // 3. 모든 주차의 데이터를 병렬로 Fetch
    const promises = weeks.map(w => {
        const path = `attendance/${year}/${month}/${w}/${grade}-${cls}`;
        return get(child(ref(db), path));
    });

    const snapshots = await Promise.all(promises);

    // 4. 데이터 합치기
    let allAttendance = [];

    snapshots.forEach(snapshot => {
        if (!snapshot.exists()) return;
        const data = snapshot.val();
        // 해당 주차 데이터에서 이 학생(번호 기준) 찾기
        const student = data.students.find(s => s.no == studentNo); // 번호로 비교 (문자열/숫자 주의)
        if (student && student.attendance) {
            allAttendance = allAttendance.concat(student.attendance);
        }
    });

    // 5. 날짜순 정렬 (Day 기준)
    allAttendance.sort((a, b) => Number(a.day) - Number(b.day) || Number(a.period) - Number(b.period));

    // 6. 결과 렌더링
    renderStudentMonthlySummary(allAttendance);

  } catch (err) {
    console.error(err);
    document.getElementById('studentModalBody').innerHTML = `<div style='text-align:center; color:red; padding:20px;'>오류 발생: ${err.message}</div>`;
  }
};

// 2. 데이터 분석 및 HTML 생성 (기호 -> 텍스트 변환 적용)
function renderStudentMonthlySummary(attendanceList) {
  // 날짜별 그룹핑
  const dayGroups = {};
  attendanceList.forEach(att => {
    if (!dayGroups[att.day]) dayGroups[att.day] = [];
    dayGroups[att.day].push(att);
  });

  let contentHtml = "";
  const days = Object.keys(dayGroups).sort((a, b) => Number(a) - Number(b));
  let hasData = false;

  days.forEach(day => {
    const records = dayGroups[day];
    // 값이 있는 교시만 필터링
    const absents = records.filter(r => r.value && r.value.trim() !== "");
    
    if (absents.length === 0) return; // 결석/지각 등이 없으면 패스
    hasData = true;

    // 해당 날짜의 '모든' 교시 개수와 '결석한' 교시 개수가 같은지 확인 (전교시 결석 여부)
    const isFullDay = (absents.length === records.length);
    
    // 모든 결석 사유가 동일한지 체크
    const firstVal = absents[0].value;
    const isAllSame = absents.every(r => r.value === firstVal);

    contentHtml += `<div style="margin-bottom: 8px; font-size:15px; padding-bottom:5px; border-bottom:1px dashed #eee;">• <b>${day}일</b> : `;

    if (isFullDay && isAllSame) {
      // [케이스 1] 전교시 동일 사유 결석 -> "인정결석" 등으로 표기
      const { typeText, reason } = parseValueWithText(firstVal);
      contentHtml += `<span style="font-weight:bold; color:#d63384;">${typeText}결석</span>`;
      if (reason) contentHtml += `, ${reason}`;
      
    } else {
      // [케이스 2] 부분 결석
      // 사유별로 다시 묶기
      const reasonGroups = {}; 
      absents.forEach(a => {
        if(!reasonGroups[a.value]) reasonGroups[a.value] = [];
        reasonGroups[a.value].push(a.period);
      });

      const parts = [];
      for (const [val, periods] of Object.entries(reasonGroups)) {
        const { typeText, reason } = parseValueWithText(val);
        const periodStr = periods.join('/');
        
        let text = `${periodStr}교시 (<span style="font-weight:bold;">${typeText}</span>`;
        if (reason) text += `, ${reason}`;
        text += `)`;
        parts.push(text);
      }
      contentHtml += parts.join(', ');
    }
    
    contentHtml += `</div>`;
  });

  if (!hasData) {
    contentHtml = "<div style='text-align:center; color:#999; padding:30px;'>이번 달 특이사항 없음</div>";
  }

  document.getElementById('studentModalBody').innerHTML = contentHtml;
}

// 3. 값 파싱 + 텍스트 변환 헬퍼 (핵심)
function parseValueWithText(val) {
  if (!val) return { typeText: "", reason: "" };
  
  // 예: "△(두통)" -> symbol="△", note="두통"
  const match = val.match(/^([^(]+)\s*(?:\((.+)\))?$/);
  
  let symbol = val;
  let reason = "";

  if (match) {
    symbol = match[1].trim();
    reason = match[2] ? match[2].trim() : "";
  }

  // 기호를 텍스트로 변환 (△ -> 인정)
  const typeText = convertSymbolToText(symbol);

  return { typeText, reason };
}

// 4. 팝업 닫기 함수
function closeStudentModal() {
  document.getElementById('studentModal').classList.remove('show');
}


