// 

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, get, update, child } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

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

let globalData = {}; 
const CURRENT_YEAR = new Date().getFullYear().toString();

// [상태 변수]
let activeDate = new Date(); // 현재 선택된 날짜 (Date 객체)
let currentSelectedClass = null; // "1-1" 형태
let isMultiMode = false;
let selectedCells = new Set();
let dragStartAction = null;
let longPressTimer = null;
let dragStartCell = null;
let pendingChanges = {};
let lastTouchTime = 0;

let pendingNavigation = null;
let currentRenderedData = null; // 현재 로드된 전체 데이터(월)

// [통계]
let currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };

document.addEventListener('DOMContentLoaded', () => {
  // 전역 함수 바인딩
  window.onSaveBtnClick = onSaveBtnClick;
  window.loadStudents = loadStudents;
  window.toggleReasonInput = toggleReasonInput;
  window.hideConfirmModal = hideConfirmModal;
  window.executeSave = executeSave;
  window.closeStudentModal = closeStudentModal;
  window.toggleDateConfirmation = toggleDateConfirmation;
  
  // 날짜 선택기 초기화
  setupDatePicker();

  // 모달 버튼
  document.getElementById('modalCancelBtn').addEventListener('click', hideConfirmModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', executeSave);
  
  // 라디오 버튼 (출석 유형)
  const radios = document.getElementsByName('attType');
  radios.forEach(r => r.addEventListener('change', toggleReasonInput));

  // 우클릭 방지
  document.addEventListener('contextmenu', event => event.preventDefault());
  
  // 페이지 이탈 방지
  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(pendingChanges).length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // 버튼 이벤트
  document.getElementById('btnStatsMode').addEventListener('click', enterStatsMode);
  document.getElementById('btnBackToHome').addEventListener('click', () => goHome(false));
  document.getElementById('btnBackToHomeStats').addEventListener('click', () => history.back());

  // 뒤로가기 처리
  window.addEventListener('popstate', () => {
    goHome(true);
  });

  toggleReasonInput();
  fetchInitDataFromFirebase();
});

// =======================================================
// [신규] 날짜 선택기 설정
// =======================================================
function setupDatePicker() {
  const dateInput = document.getElementById('mainDatePicker');
  const btnTrigger = document.getElementById('btnDateTrigger');
  
  // 초기값: 오늘
  activeDate = new Date();
  updateDateLabel();

  // 버튼 클릭 시 숨겨진 date input 열기
  btnTrigger.addEventListener('click', () => {
    try {
      dateInput.showPicker();
    } catch (e) {
      dateInput.focus(); // fallback
    }
  });

  // 날짜 변경 시
  dateInput.addEventListener('change', (e) => {
    if (!e.target.value) return;
    
    // 저장되지 않은 변경사항 체크
    if (Object.keys(pendingChanges).length > 0) {
      if(!confirm("저장하지 않은 데이터가 있습니다. 무시하고 이동합니까?")) {
        // 원래 날짜로 복구
        updateDateLabel(); 
        return;
      }
      pendingChanges = {};
      updateSaveButtonUI();
    }

    activeDate = new Date(e.target.value);
    updateDateLabel();
    loadStudents(); // 데이터 다시 로드
  });
}

function updateDateLabel() {
  const dateInput = document.getElementById('mainDatePicker');
  const label = document.getElementById('dateDisplayLabel');
  
  // YYYY-MM-DD 포맷
  const yyyy = activeDate.getFullYear();
  const mm = String(activeDate.getMonth() + 1).padStart(2, '0');
  const dd = String(activeDate.getDate()).padStart(2, '0');
  
  dateInput.value = `${yyyy}-${mm}-${dd}`;
  label.innerText = `${mm}-${dd}`;
}

// =======================================================
// 화면 전환 및 홈 화면
// =======================================================
function goHome(fromHistory = false) {
  if (Object.keys(pendingChanges).length > 0) {
    if(!confirm("저장하지 않은 데이터가 있습니다. 무시하고 나가시겠습니까?")) {
      if(fromHistory) history.pushState({ view: 'sub' }, '', '');
      return;
    }
    pendingChanges = {};
    updateSaveButtonUI();
  }
  switchView('homeScreen');
  renderHomeScreenClassButtons(); // 상태 업데이트
}

function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

async function fetchInitDataFromFirebase() {
  const dbRef = ref(db);
  try {
    const snapshot = await get(child(dbRef, `metadata`));
    if (snapshot.exists()) {
      globalData = snapshot.val();
      renderHomeScreenClassButtons();
    }
  } catch (error) {
    console.error(error);
  }
}

// 홈 화면: 반 버튼 렌더링 (오늘 날짜 확정 여부 반영)
async function renderHomeScreenClassButtons() {
  const container = document.getElementById('classButtonContainer');
  container.innerHTML = "<div style='grid-column:1/-1; text-align:center; color:#888;'>출결 현황 확인 중...</div>";
  
  const year = CURRENT_YEAR;
  if (!globalData[year]) {
    container.innerHTML = `<div style="grid-column:1/-1; text-align:center;">${year}년 데이터 없음</div>`;
    return;
  }

  // 오늘 날짜 기준 데이터 조회
  const today = new Date();
  const month = (today.getMonth() + 1).toString();
  const day = today.getDate().toString();
  
  let monthData = {};
  
  // 이번 달 전체 데이터 가져와서 오늘 확정 여부 확인
  try {
    // [변경] 경로에서 week 제거 (attendance/YYYY/MM)
    const path = `attendance/${year}/${month}`;
    const snapshot = await get(child(ref(db), path));
    if (snapshot.exists()) {
      monthData = snapshot.val();
    }
  } catch (e) {
    console.log("홈 데이터 로드 실패", e);
  }

  container.innerHTML = "";

  const info = globalData[year];
  const existingGrades = (info.grades || []).map(String);
  const existingClasses = (info.classes || []).map(String);

  const targetGrades = ['1', '2', '3'];
  const maxClasses = 2; 

  targetGrades.forEach(g => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'grade-row';
    
    for (let cNum = 1; cNum <= maxClasses; cNum++) {
      const c = cNum.toString(); 
      const btn = document.createElement('button');
      const label = `${g}-${c}`;
      btn.innerText = label;

      const isActive = existingGrades.includes(g) && existingClasses.includes(c);

      if (isActive) {
        btn.className = 'class-btn';
        
        // [확정 상태 확인]
        const classKey = `${g}-${c}`;
        const classData = monthData[classKey];
        // data.confirmations[day] 가 true인지 확인
        const isConfirmedToday = classData && classData.confirmations && classData.confirmations[day];

        if (isConfirmedToday) {
            btn.classList.add('grade-1'); // 노란색 (확정)
        } else {
            btn.classList.add('gray-status'); // 회색 (미확정)
        }

        btn.onclick = () => enterAttendanceMode(g, c);
      } else {
        btn.className = 'class-btn disabled';
      }
      rowDiv.appendChild(btn);
    }
    container.appendChild(rowDiv);
  });
}

function enterAttendanceMode(grade, cls) {
  currentSelectedClass = `${grade}-${cls}`;
  
  // 들어갈 때 날짜를 오늘로 초기화 (혹은 이전에 선택한 날짜 유지? -> 기획상 오늘이 나을듯)
  activeDate = new Date();
  updateDateLabel();

  history.pushState({ mode: 'attendance' }, '', '');
  switchView('attendanceScreen');
  loadStudents();
}

// =======================================================
// [핵심] 학생 데이터 로드 및 렌더링 (일자별)
// =======================================================
async function loadStudents() {
  pendingChanges = {};
  updateSaveButtonUI(); 
  
  const year = CURRENT_YEAR;
  const month = (activeDate.getMonth() + 1).toString();
  const combinedVal = currentSelectedClass; 

  if (!combinedVal) return;

  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  document.getElementById('loading').style.display = 'inline';
  
  // [변경] 주(Week) 제거된 경로 사용
  const path = `attendance/${year}/${month}/${grade}-${cls}`;
  const dbRef = ref(db);

  try {
    const snapshot = await get(child(dbRef, path));
    if (snapshot.exists()) {
      currentRenderedData = snapshot.val();
      renderTable(currentRenderedData);
    } else {
      currentRenderedData = null;
      document.getElementById('tableContainer').innerHTML = '<div style="padding:20px; text-align:center;">데이터 없음</div>';
    }
  } catch (error) {
    console.error(error);
    document.getElementById('tableContainer').innerHTML = '<div style="padding:20px; text-align:center; color:red;">로드 실패</div>';
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

// [수정] 테이블 렌더링 (하루치 데이터만 필터링)
function renderTable(data) {
  if (!data.confirmations) data.confirmations = {};
  
  const container = document.getElementById('tableContainer');
  
  if (!data || data.error) { 
    container.innerHTML = `<div style="padding:20px; text-align:center; color:red;">${data.error || '오류'}</div>`; 
    return; 
  }
  if (!data.students || data.students.length === 0) { 
    container.innerHTML = '<div style="padding:20px; text-align:center;">학생 데이터가 없습니다.</div>'; 
    return; 
  }

  const targetDay = activeDate.getDate();
  const targetDayStr = targetDay.toString();
  
  // 확정 여부
  const isConfirmed = data.confirmations[targetDayStr] === true;
  
  // 해당 날짜의 교시 정보 파악 (첫 번째 학생 기준)
  // 학생 데이터 구조: student.attendance = [{colIndex, day, period, value}, ...]
  const sampleStudent = data.students[0];
  const dayRecords = sampleStudent.attendance.filter(a => a.day == targetDay);
  
  if (dayRecords.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center;">${activeDate.getMonth()+1}월 ${targetDay}일 데이터가 없습니다.</div>`;
    return;
  }

  // 교시 정렬
  dayRecords.sort((a,b) => parseInt(a.period) - parseInt(b.period));

  // 테이블 생성
  let html = '<table><thead>';
  
  // 헤더 1열: 날짜 및 마감 체크박스
  const dayOfWeek = getDayOfWeek(activeDate);
  const dateLabel = `${activeDate.getMonth()+1}/${targetDay}(${dayOfWeek})`;

  // [마감(확정) UI]
  // 체크박스 상태에 따라 isConfirmed 값 반영
  const checkedAttr = isConfirmed ? 'checked' : '';
  const headerClass = isConfirmed ? 'confirmed-header' : '';
  const statusText = isConfirmed ? '마감됨' : '마감하기';

  html += `
    <tr>
      <th rowspan="2" class="col-no">번호</th>
      <th rowspan="2" class="col-name" onclick="onSaveBtnClick()">이름</th>
      <th colspan="${dayRecords.length}" class="header-day ${headerClass}">
        <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
          <span>${dateLabel}</span>
          <label style="font-size:12px; display:flex; align-items:center; cursor:pointer; background:rgba(255,255,255,0.5); padding:2px 6px; border-radius:4px;">
            <input type="checkbox" id="chkConfirmDay" ${checkedAttr} onchange="toggleDateConfirmation('${targetDayStr}')">
            <span style="margin-left:4px;">${statusText}</span>
          </label>
        </div>
      </th>
    </tr>
    <tr>
  `;
  
  // 교시 헤더
  dayRecords.forEach(r => {
    html += `<th>${r.period}</th>`;
  });
  html += '</tr></thead><tbody>';

  // 바디: 학생별 Row
  data.students.forEach(std => {
    html += '<tr>';
    html += `<td>${std.no}</td>`;
    html += `<td class="col-name" onclick="showStudentSummary('${std.no}', '${std.name}')">${std.name}</td>`;
    
    // 해당 날짜의 데이터만 필터링하여 매핑
    // 효율성을 위해 미리 맵으로 변환하거나 find 사용
    dayRecords.forEach(headerRec => {
      // colIndex로 매칭 (가장 정확함)
      const cellData = std.attendance.find(a => a.colIndex == headerRec.colIndex) || {};
      const val = cellData.value || "";
      const displayHtml = formatValueToHtml(val);
      
      const confirmedClass = isConfirmed ? "confirmed-col" : "";

      html += `<td class="check-cell ${confirmedClass}" 
               data-row="${std.rowNumber}" 
               data-col="${cellData.colIndex}" 
               data-day="${targetDay}"> ${displayHtml} </td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  updateSaveButtonUI();
  addDragListeners(); 
  addFocusListeners();
}

// [신규] 날짜 확정 토글 (체크박스) -> 즉시 저장 및 시트 색상 변경
async function toggleDateConfirmation(dayStr) {
  if (!currentRenderedData) return;

  const checkbox = document.getElementById('chkConfirmDay');
  const newStatus = checkbox.checked;

  if (!currentRenderedData.confirmations) currentRenderedData.confirmations = {};
  currentRenderedData.confirmations[dayStr] = newStatus;

  // 1. Firebase 업데이트 (메타데이터)
  const year = CURRENT_YEAR;
  const month = (activeDate.getMonth() + 1).toString();
  const [grade, cls] = currentSelectedClass.split('-');
  const path = `attendance/${year}/${month}/${grade}-${cls}/confirmations`;
  
  try {
    await update(ref(db, path), { [dayStr]: newStatus });
    
    // UI 즉시 반영 (리렌더링 없이 클래스 토글)
    const header = document.querySelector('.header-day');
    const cells = document.querySelectorAll('.check-cell');
    
    if (newStatus) {
      header.classList.add('confirmed-header');
      cells.forEach(c => c.classList.add('confirmed-col'));
    } else {
      header.classList.remove('confirmed-header');
      cells.forEach(c => c.classList.remove('confirmed-col'));
    }
    
    // [중요] 2. Google 시트에 색상 동기화 요청
    syncColorToGoogleSheet(newStatus);
    
    showToast(newStatus ? "마감(확정) 되었습니다." : "마감 해제되었습니다.");

  } catch (e) {
    alert("오류 발생: " + e.message);
    checkbox.checked = !newStatus; // 롤백
  }
}

// [신규] 시트에 배경색 변경 요청 보내기
function syncColorToGoogleSheet(isConfirmed) {
  if (!currentRenderedData || !currentRenderedData.students) return;

  const year = CURRENT_YEAR;
  const day = activeDate.getDate();
  
  // 현재 날짜의 모든 학생 데이터 셀 정보를 수집
  const batchData = [];
  
  currentRenderedData.students.forEach(std => {
    // 해당 날짜(day)에 해당하는 attendance 찾기
    const dayAtts = std.attendance.filter(a => a.day == day);
    dayAtts.forEach(att => {
      batchData.push({
        year: year,
        row: std.rowNumber,
        col: att.colIndex,
        value: att.value,     // 값은 그대로 유지
        isConfirmed: isConfirmed // [핵심] 확정 여부 플래그
      });
    });
  });

  if (batchData.length === 0) return;

  // GAS로 전송
  const payload = { action: "saveAttendanceBatch", data: batchData };
  fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload)
  }).then(res => res.json())
    .then(json => console.log("Color Sync:", json))
    .catch(err => console.error("Color Sync Failed:", err));
}


// [수정] 데이터 저장 (확정 상태도 함께 전송하여 색상 유지)
async function executeSave() {
  document.getElementById('confirmModal').classList.remove('show');
  const keys = Object.keys(pendingChanges);
  if (keys.length === 0 && !pendingNavigation) return;

  const year = CURRENT_YEAR;
  const month = (activeDate.getMonth() + 1).toString();
  const [grade, cls] = currentSelectedClass.split('-');
  
  // 현재 날짜의 확정 상태 확인
  const dayStr = activeDate.getDate().toString();
  const isConfirmed = currentRenderedData.confirmations ? currentRenderedData.confirmations[dayStr] : false;

  // 1. 로컬 데이터 업데이트
  keys.forEach(key => {
    const [r, c] = key.split('-');
    const val = pendingChanges[key];
    const student = currentRenderedData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) att.value = val;
    }
  });

  // 2. Firebase 업데이트
  const path = `attendance/${year}/${month}/${grade}-${cls}`;
  try {
    await update(ref(db, path), currentRenderedData);
    
    // UI 업데이트 (unsaved 클래스 제거)
    keys.forEach(key => {
      const [r, c] = key.split('-');
      const cell = document.querySelector(`.check-cell[data-row="${r}"][data-col="${c}"]`);
      if (cell) cell.classList.remove('unsaved-cell');
    });

    showToast("저장완료");
    
    // 3. Google Sheet 백업 및 색상 동기화
    // 변경된 셀들만 보내되, isConfirmed 정보를 담아서 보냄
    const backupPayload = keys.map(key => {
        const [r, c] = key.split('-');
        const val = pendingChanges[key];
        return { 
          year: year, 
          row: r, 
          col: c, 
          value: val, 
          isConfirmed: isConfirmed // 배경색 처리를 위해 전달
        };
    });

    if (backupPayload.length > 0) {
        const payload = { action: "saveAttendanceBatch", data: backupPayload };
        fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
    }

    pendingChanges = {};
    updateSaveButtonUI();

    if (pendingNavigation) {
        pendingNavigation(); 
        pendingNavigation = null;
    }
  } catch (error) {
    alert("저장 실패: " + error.message);
  }
}

// 기타 유틸리티 함수들...
function saveState() { 
  // 날짜 기반이므로 로컬스토리지 저장 필요성이 낮아졌으나, 필요시 구현
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
  }
}

function getDayOfWeek(dateObj) { 
  const days = ['일', '월', '화', '수', '목', '금', '토']; 
  return days[dateObj.getDay()]; 
}

function formatValueToHtml(val) {
  if (!val) return "";
  const match = val.toString().match(/^([^(\s]+)\s*\((.+)\)$/);
  if (match) return `<span class="mark-symbol">${match[1]}</span><span class="mark-note">(${match[2]})</span>`;
  return `<span class="mark-symbol">${val}</span>`;
}

function showToast(message) { 
  const t = document.getElementById("toast-container"); 
  t.textContent = message; 
  t.className = "show"; 
  setTimeout(()=>{t.className = t.className.replace("show", "");}, 3000); 
}

function showConfirmModal() { document.getElementById('confirmModal').classList.add('show'); }

function hideConfirmModal() { 
  document.getElementById('confirmModal').classList.remove('show'); 
  pendingNavigation = null;
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

  // 원본 값 확인
  let originalValue = "";
  if (currentRenderedData) {
    const student = currentRenderedData.students.find(s => s.rowNumber == r);
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

// 드래그 및 터치 이벤트 핸들러
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

function addFocusListeners() { 
  const cells = document.querySelectorAll('.check-cell'); 
  cells.forEach(c => { 
    c.addEventListener('mouseenter', (e) => { if(!isMultiMode) highlightHeaders(e.currentTarget); }); 
    c.addEventListener('mouseleave', () => { if(!isMultiMode) clearHeaderHighlights(); }); 
  }); 
}

function highlightHeaders(cell) { 
  // 심플하게 컬럼만 하이라이트
  // (복잡한 로직 제거됨)
}
function clearHeaderHighlights() {}

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
  if(isMultiMode){
    e.preventDefault(); 
    const t=e.touches[0]; 
    const target=document.elementFromPoint(t.clientX, t.clientY); 
    if(target){const c=target.closest('.check-cell'); if(c) addToSelection(c);}
  }
}

function onTouchEnd(e) { 
  lastTouchTime = Date.now(); 
  if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;} 
  if(isMultiMode) finishMultiSelect(); 
}

function startMultiSelect(cell) { 
  if (cell.classList.contains('confirmed-col')) return; 

  isMultiMode=true; 
  selectedCells.clear(); 
  const hasData = cell.querySelector('.mark-symbol') !== null;
  dragStartAction = hasData ? 'clear' : 'fill'; 
  addToSelection(cell); 
}

function addToSelection(cell) { 
  if (cell.classList.contains('confirmed-col')) return;
  if(!selectedCells.has(cell)){selectedCells.add(cell); cell.classList.add('multi-selecting');} 
}

function finishMultiSelect() { 
  isMultiMode=false; 
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
  if (cell.classList.contains('confirmed-col')) {
      showToast("마감된 날짜입니다.");
      return;
  }
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

// 학생 상세 보기 및 통계 관련 로직은 기존 유지 (단, 주차 로직은 제거됨)
// 통계 모드 진입
async function enterStatsMode() {
  history.pushState({ mode: 'stats' }, '', '');
  switchView('statsScreen');
  
  const btnSearch = document.getElementById('btnSearchStats');
  btnSearch.onclick = runStatsSearch;

  const radios = document.getElementsByName('statsType');
  radios.forEach(r => r.addEventListener('change', updateStatsInputVisibility));

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  document.getElementById('statsDateInput').value = todayStr;
  document.getElementById('statsMonthInput').value = `${yyyy}-${mm}`;
  document.getElementById('statsStartDate').value = todayStr;
  document.getElementById('statsEndDate').value = todayStr;

  renderStatsFilters();
  updateStatsInputVisibility();
}

function updateStatsInputVisibility() {
  const mode = document.querySelector('input[name="statsType"]:checked').value;
  document.getElementById('statsDateInput').style.display = (mode === 'daily') ? 'block' : 'none';
  document.getElementById('statsMonthInput').style.display = (mode === 'monthly') ? 'block' : 'none';
  document.getElementById('statsPeriodInput').style.display = (mode === 'period') ? 'flex' : 'none';
}

function renderStatsFilters() {
    // 필터 렌더링 (생략 - 기존 로직과 유사)
    // globalData를 기반으로 필터 생성
    const container = document.getElementById('statsFilterContainer');
    container.innerHTML = "";
    
    if(!globalData[CURRENT_YEAR]) return;
    
    const grades = globalData[CURRENT_YEAR].grades || [];
    const classes = globalData[CURRENT_YEAR].classes || [];
    
    const allWrapper = document.createElement('label');
    allWrapper.className = 'filter-tag';
    allWrapper.innerHTML = `<input type="checkbox" id="chkAll" checked><span>전체</span>`;
    container.appendChild(allWrapper);

    grades.forEach(g => {
        classes.forEach(c => {
            const label = document.createElement('label');
            label.className = 'filter-tag';
            label.innerHTML = `<input type="checkbox" name="classFilter" value="${g}-${c}" checked><span>${g}-${c}</span>`;
            container.appendChild(label);
        });
    });

    const chkAll = document.getElementById('chkAll');
    const chkClasses = document.getElementsByName('classFilter');
    chkAll.addEventListener('change', (e) => { chkClasses.forEach(cb => cb.checked = e.target.checked); });
}

// =======================================================
// [통계 조회] 수정된 로직 (주차 제거 -> 월 단위 조회)
// =======================================================
async function runStatsSearch() {
  const container = document.getElementById('statsContainer');
  container.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">데이터 분석 중...</div>';

  // 1. 선택된 반 확인
  const selectedCheckboxes = document.querySelectorAll('input[name="classFilter"]:checked');
  if (selectedCheckboxes.length === 0) {
    container.innerHTML = '<div style="padding:40px; text-align:center; color:red;">선택된 반이 없습니다.</div>';
    return;
  }
  const targetClassKeys = Array.from(selectedCheckboxes).map(cb => cb.value); // ["1-1", "1-2"...]
  
  const mode = document.querySelector('input[name="statsType"]:checked').value; 
  
  let targetMonthsToFetch = []; 
  let filterStartDate = null;
  let filterEndDate = null;
  let displayTitle = "";

  // 날짜 필터 설정
  if (mode === 'daily') {
    const dateStr = document.getElementById('statsDateInput').value; 
    if(!dateStr) { alert("날짜를 선택해주세요."); return; }
    const d = new Date(dateStr);
    filterStartDate = d;
    filterEndDate = d;
    targetMonthsToFetch.push({ year: d.getFullYear().toString(), month: (d.getMonth()+1).toString() });
    
    const dayChar = getDayOfWeek(d);
    displayTitle = `${d.getMonth()+1}월 ${d.getDate()}일(${dayChar}) 통계`;

  } else if (mode === 'monthly') {
    const monthStr = document.getElementById('statsMonthInput').value; 
    if(!monthStr) { alert("월을 선택해주세요."); return; }
    const parts = monthStr.split('-');
    targetMonthsToFetch.push({ year: parts[0], month: parseInt(parts[1]).toString() });
    displayTitle = `${parseInt(parts[1])}월 전체 통계`;

  } else if (mode === 'period') {
    const startStr = document.getElementById('statsStartDate').value;
    const endStr = document.getElementById('statsEndDate').value;
    if(!startStr || !endStr) { alert("시작일과 종료일을 선택해주세요."); return; }
    
    filterStartDate = new Date(startStr);
    filterEndDate = new Date(endStr);
    if(filterStartDate > filterEndDate) { alert("날짜 범위 오류"); return; }
    displayTitle = `${startStr} ~ ${endStr} 통계`;

    // 기간 내 모든 월 수집
    let curr = new Date(filterStartDate.getFullYear(), filterStartDate.getMonth(), 1);
    const endLimit = new Date(filterEndDate.getFullYear(), filterEndDate.getMonth(), 1);
    
    while(curr <= endLimit) {
        targetMonthsToFetch.push({ year: curr.getFullYear().toString(), month: (curr.getMonth()+1).toString() });
        curr.setMonth(curr.getMonth() + 1);
    }
  }
  
  // 통계 집계 변수
  window.currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 }; // 학년별 총원
  let fullDayAbsentCounts = { '1': 0, '2': 0, '3': 0 }; // 학년별 전일 결석자 수
  
  try {
    const results = [];
    
    // 선택된 월(Month)들의 데이터 가져오기
    const promises = targetMonthsToFetch.map(async (tm) => {
        // 경로 변경됨: attendance/YYYY/MM
        const path = `attendance/${tm.year}/${tm.month}`;
        const snapshot = await get(child(ref(db), path));
        
        if(!snapshot.exists()) return [];
        
        const monthData = snapshot.val(); // { "1-1": {...}, "1-2": {...}, "confirmations": {...} }
        const monthResults = [];
        
        // 반별 데이터 추출
        targetClassKeys.forEach(classKey => {
            if (monthData[classKey]) {
                monthResults.push({ 
                    year: tm.year, 
                    month: tm.month, 
                    classKey, 
                    val: monthData[classKey],
                    confirmations: monthData.confirmations // 해당 월의 마감 정보
                });
            }
        });
        return monthResults;
    });

    const nestedResults = await Promise.all(promises);
    nestedResults.forEach(arr => results.push(...arr));

    // 집계 시작
    const aggregated = {}; 
    const finalClassSet = new Set();
    let isAllConfirmed = true; 

    // 1. 총원 계산 및 마감 여부 확인
    results.forEach(res => {
         if (!res.val) return;

         // 일별 모드일 경우 마감(확정) 여부 체크
         if (mode === 'daily') {
             const dayStr = filterStartDate.getDate().toString();
             const isConfirmedToday = res.confirmations && res.confirmations[dayStr];
             if (!isConfirmedToday) isAllConfirmed = false;
         } else {
             isAllConfirmed = false; // 월/기간 통계는 마감 요약 표시 안함 (복잡성 때문)
         }

         // 학년별 총원 (중복 집계 방지)
         if (!finalClassSet.has(res.classKey) && res.val.students) {
            const grade = res.classKey.split('-')[0];
            window.currentStatsTotalCounts[grade] += res.val.students.length;
            finalClassSet.add(res.classKey);
         }
    });

    // 2. 학생별 결석 데이터 필터링 및 집계
    results.forEach(res => {
      if (!res.val || !res.val.students) return;
      
      const classKey = res.classKey;
      const grade = classKey.split('-')[0];
      const students = res.val.students;

      if (!aggregated[classKey]) aggregated[classKey] = {};

      students.forEach(s => {
        if (!s.attendance) return;

        // 해당 월/일 범위에 맞는 데이터만 필터링
        let validRecords = s.attendance.filter(a => {
            // 값이 있는 것만 (결석 등)
            if (!a.value || a.value.trim() === "") return false;

            const rYear = parseInt(res.year);
            const rMonth = parseInt(res.month);
            const rDay = parseInt(a.day);
            const rDate = new Date(rYear, rMonth - 1, rDay);

            if (mode === 'daily' || mode === 'period') {
                const fStart = new Date(filterStartDate); fStart.setHours(0,0,0,0);
                const fEnd = new Date(filterEndDate); fEnd.setHours(0,0,0,0);
                return rDate >= fStart && rDate <= fEnd;
            }
            return true; // monthly는 이미 월별 fetch 했으므로 pass
        });

        // 결과 데이터가 하나라도 있으면 집계
        if (validRecords.length > 0) {
          
          // 전일 결석 여부 판단 (일별 조회 시)
          if (mode === 'daily') {
             const targetDay = filterStartDate.getDate();
             // 그 날의 전체 교시 수 계산 (빈 값 포함)
             const totalPeriodsThatDay = s.attendance.filter(a => a.day == targetDay).length;
             
             // 결석 데이터 수 == 전체 교시 수 이면 전일 결석
             if (totalPeriodsThatDay > 0 && validRecords.length === totalPeriodsThatDay) {
                 if (!aggregated[classKey][s.no]) { // 중복 방지
                    fullDayAbsentCounts[grade]++;
                 }
             }
          }

          if (!aggregated[classKey][s.no]) {
            aggregated[classKey][s.no] = { name: s.name, records: [] };
          }

          // 화면 표시용 메타데이터 추가
          const recordsWithMeta = validRecords.map(r => {
              const rYear = parseInt(res.year);
              const rMonth = parseInt(res.month);
              const rDay = parseInt(r.day);
              const yoil = getDayOfWeek(new Date(rYear, rMonth-1, rDay));
              
              // 해당 날짜의 총 교시 수 구하기 (전일 결과 판별용)
              const totalP = s.attendance.filter(a => a.day == r.day).length;

              return {
                  ...r,
                  _fullDateStr: `${rMonth}월 ${rDay}일(${yoil})`,
                  _totalPeriods: totalP
              };
          });
          aggregated[classKey][s.no].records.push(...recordsWithMeta);
        }
      });
    });

    renderStatsResult(aggregated, targetClassKeys, mode, displayTitle, isAllConfirmed, fullDayAbsentCounts);

  } catch (e) {
    console.error(e);
    container.innerHTML = `<div style="text-align:center; color:red;">오류: ${e.message}</div>`;
  }
}

// [통계 렌더링] 결과 표시
function renderStatsResult(aggregatedData, sortedClassKeys, mode, displayTitle, isAllConfirmed, fullDayAbsentCounts) {
  const container = document.getElementById('statsContainer');
  let html = "";
  
  html += `<div style="text-align:center; margin-bottom:15px; font-weight:bold; color:#555;">[ ${displayTitle} ]</div>`;

  // 일별 모드 + 전체 마감 시 요약표 표시
  if (mode === 'daily' && isAllConfirmed) {
      const summary = calculateDailySummary(fullDayAbsentCounts);
      if(summary) html += summary;
  }

  let hasAnyData = false;
  sortedClassKeys.forEach(classKey => {
    const studentsMap = aggregatedData[classKey];
    if (!studentsMap || Object.keys(studentsMap).length === 0) return;

    hasAnyData = true;
    html += `<div class="stats-class-block"><div class="stats-class-header">${classKey}반</div>`;

    const sortedStudentNos = Object.keys(studentsMap).sort((a,b) => Number(a) - Number(b));
    
    sortedStudentNos.forEach(sNo => {
      const sData = studentsMap[sNo];
      const summary = getStudentSummaryText(sData.records);
      if(summary) {
        html += `<div class="stats-student-row">
          <div class="stats-student-name">${sNo}번 ${sData.name}</div>
          <div class="stats-detail">${summary}</div>
        </div>`;
      }
    });
    html += `</div>`;
  });

  if (!hasAnyData) {
    html += `<div style="padding:20px; text-align:center; color:#888;">해당 기간에 특이사항(결석 등)이 없습니다.</div>`;
  }
  container.innerHTML = html;
}

// [통계 요약] 상단 총계 박스
function calculateDailySummary(fullDayAbsentCounts) {
  if (!window.currentStatsTotalCounts) return "";
  const totals = window.currentStatsTotalCounts;
  
  const present1 = (totals['1'] || 0) - (fullDayAbsentCounts['1'] || 0);
  const present2 = (totals['2'] || 0) - (fullDayAbsentCounts['2'] || 0);
  const present3 = (totals['3'] || 0) - (fullDayAbsentCounts['3'] || 0);

  const allTotal = (totals['1']||0) + (totals['2']||0) + (totals['3']||0);
  const allPresent = present1 + present2 + present3;

  if (allTotal === 0) return "";

  return `
    <div class="stats-summary-box">
      <div class="stats-summary-row"><span>1학년</span> <span>${present1} / ${totals['1']||0}</span></div>
      <div class="stats-summary-row"><span>2학년</span> <span>${present2} / ${totals['2']||0}</span></div>
      <div class="stats-summary-row"><span>3학년</span> <span>${present3} / ${totals['3']||0}</span></div>
      <div class="stats-summary-row summary-total"><span>전학년 출석</span> <span>${allPresent} / ${allTotal}</span></div>
    </div>
  `;
}

// [통계 텍스트] 학생별 상세 내역 생성
function getStudentSummaryText(records) {
  // 날짜별 그룹화
  const dateGroups = {};
  records.forEach(r => {
    const key = r._fullDateStr;
    if(!dateGroups[key]) dateGroups[key] = [];
    dateGroups[key].push(r);
  });

  let lines = [];
  const dateKeys = Object.keys(dateGroups).sort(); // 날짜순 정렬은 문자열이라 완벽하진 않으나 대략 맞음

  dateKeys.forEach(dateStr => {
    const list = dateGroups[dateStr];
    
    const totalPeriods = list[0]._totalPeriods || 0;
    const isFullDay = (totalPeriods > 0 && list.length === totalPeriods);
    
    const firstVal = list[0].value;
    const isAllSame = list.every(x => x.value === firstVal);

    let text = `<b>${dateStr}</b>: `;
    
    if (isFullDay && isAllSame) {
       const { typeText, reason } = parseValueWithText(firstVal);
       text += `<span style="color:#d63384; font-weight:bold;">${typeText}결석</span>`;
       if (reason) text += ` (${reason})`;
    } else {
       // 교시별 결과 결과
       const reasonGroups = {};
       list.forEach(item => {
         if(!reasonGroups[item.value]) reasonGroups[item.value] = [];
         reasonGroups[item.value].push(item.period);
       });
       
       const parts = [];
       for(const [val, periods] of Object.entries(reasonGroups)){
         const { typeText, reason } = parseValueWithText(val);
         // 교시 정렬
         periods.sort((a,b)=>Number(a)-Number(b));
         
         let sub = `${periods.join(',')}교시 ${typeText}결과`;
         if(reason) sub += `(${reason})`;
         parts.push(sub);
       }
       text += parts.join(' / ');
    }
    lines.push(text);
  });

  return lines.join('<br>');
}

// [유틸] 텍스트 파싱 (기존 함수 재사용)
function parseValueWithText(val) {
  if (!val) return { typeText: "", reason: "" };
  const match = val.match(/^([^(]+)\s*(?:\((.+)\))?$/);
  let symbol = val;
  let reason = "";
  if (match) {
    symbol = match[1].trim();
    reason = match[2] ? match[2].trim() : "";
  }
  const typeText = convertSymbolToText(symbol);
  return { typeText, reason };
}

function convertSymbolToText(symbol) {
  if (symbol === '△') return '인정';
  if (symbol === '○') return '병';
  if (symbol === 'Ⅹ' || symbol === 'X' || symbol === 'x') return '무단';
  return symbol; 
}

