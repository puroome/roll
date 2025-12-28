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

const nowForYear = new Date();
const CURRENT_YEAR = (nowForYear.getMonth() + 1 <= 2) 
    ? (nowForYear.getFullYear() - 1).toString() 
    : nowForYear.getFullYear().toString();

// [상태 변수]
let activeDate = new Date(); 
let currentSelectedClass = null; 
let isMultiMode = false;
let selectedCells = new Set();
let dragStartAction = null;
let longPressTimer = null;
let dragStartCell = null;
let pendingChanges = {};
let lastTouchTime = 0;

let pendingNavigation = null;
let currentRenderedData = null; 
let currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };

// ✅ Flatpickr 인스턴스 변수
let mainFlatpickr = null;
let statsDateFlatpickr = null;
let statsMonthFlatpickr = null;
let statsStartFlatpickr = null;
let statsEndFlatpickr = null;

document.addEventListener('DOMContentLoaded', () => {
  window.onSaveBtnClick = onSaveBtnClick;
  window.loadStudents = loadStudents;
  window.toggleReasonInput = toggleReasonInput;
  window.hideConfirmModal = hideConfirmModal;
  window.executeSave = executeSave;
  window.closeStudentModal = closeStudentModal;
  window.toggleDateConfirmation = toggleDateConfirmation;
  window.showStudentSummary = showStudentSummary;
  window.showMessageModal = showMessageModal;
  
  // ✅ Flatpickr 초기화
  setupDatePicker();

  document.getElementById('modalCancelBtn').addEventListener('click', hideConfirmModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', executeSave);
  
  document.getElementById('messageModalBtn').addEventListener('click', () => {
    document.getElementById('messageModal').classList.remove('show');
  });

  const radios = document.getElementsByName('attType');
  radios.forEach(r => r.addEventListener('change', toggleReasonInput));

  document.addEventListener('contextmenu', event => event.preventDefault());
  
  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(pendingChanges).length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  document.getElementById('btnStatsMode').addEventListener('click', enterStatsMode);
  document.getElementById('btnBackToHome').addEventListener('click', () => goHome(false));
  document.getElementById('btnBackToHomeStats').addEventListener('click', () => history.back());

  window.onclick = function(event) {
    const studentModal = document.getElementById('studentModal');
    if (event.target == studentModal) {
      closeStudentModal();
    }
    const confirmModal = document.getElementById('confirmModal');
    if (event.target == confirmModal) {
      hideConfirmModal();
    }
    const messageModal = document.getElementById('messageModal');
    if (event.target == messageModal) {
      messageModal.classList.remove('show');
    }
  }

  window.addEventListener('popstate', () => {
    goHome(true);
  });

  toggleReasonInput();
  fetchInitDataFromFirebase();
});

function showMessageModal(msg) {
  const modal = document.getElementById('messageModal');
  const body = document.getElementById('messageModalBody');
  body.innerText = msg; 
  modal.classList.add('show');
}

// =======================================================
// [날짜 선택기] ✅ Flatpickr 적용
// =======================================================
function setupDatePicker() {
  const btnTrigger = document.getElementById('btnDateTrigger');
  
  // 메인 출석부용 달력
  mainFlatpickr = flatpickr("#mainDatePicker", {
      locale: "ko",
      dateFormat: "Y-m-d",
      disableMobile: true,
      maxDate: "today",
      // ✅ [수정] 달력 위치 기준을 '버튼'으로 설정 (버튼 가림 방지)
      positionElement: document.getElementById('btnDateTrigger'),
      
      onChange: function(selectedDates, dateStr, instance) {
          if (!dateStr) return;

          if (Object.keys(pendingChanges).length > 0) {
              showMessageModal("저장하지 않은 데이터가 있습니다.\n먼저 저장하세요.");
              instance.setDate(activeDate); 
              updateDateLabel();
              return;
          }
          
          activeDate = new Date(dateStr);
          updateDateLabel();
          loadStudents();
      }
  });

  btnTrigger.addEventListener('click', () => {
    if (mainFlatpickr) mainFlatpickr.open();
  });
  
  updateDateLabel();
}

// ✅ 수업이 있는 "날짜" 리스트 반환 (YYYY-MM-DD)
function getEnableDates() {
    const year = CURRENT_YEAR;
    if (!globalData[year] || !globalData[year].validDays) return [];

    const validDaysMap = globalData[year].validDays; 
    const enabledDates = [];

    Object.keys(validDaysMap).forEach(monthStr => {
        const days = validDaysMap[monthStr];
        const m = parseInt(monthStr);
        let y = parseInt(year);
        // 1, 2월은 다음 해로 계산
        if (m === 1 || m === 2) y += 1;

        days.forEach(d => {
            const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            enabledDates.push(dateStr);
        });
    });
    return enabledDates;
}

// ✅ 수업이 있는 "월" 리스트 반환 (YYYY-MM)
function getEnableMonths() {
    const year = CURRENT_YEAR;
    if (!globalData[year] || !globalData[year].validDays) return [];
    
    const validMonths = [];
    const keys = Object.keys(globalData[year].validDays);
    
    keys.forEach(monthStr => {
        const m = parseInt(monthStr);
        let y = parseInt(year);
        if (m === 1 || m === 2) y += 1;
        
        validMonths.push(`${y}-${String(m).padStart(2,'0')}`);
    });
    return validMonths;
}

// ✅ 데이터 로드 후 Flatpickr 설정 업데이트 (핵심)
function updateFlatpickrAllowedDates() {
    const allowedDates = getEnableDates();
    const allowedMonths = getEnableMonths();

    // 1. 일별/기간 달력: enable 옵션으로 허용 날짜만 활성화
    if (allowedDates.length > 0) {
        if (mainFlatpickr) mainFlatpickr.set('enable', allowedDates);
        if (statsDateFlatpickr) statsDateFlatpickr.set('enable', allowedDates);
        if (statsStartFlatpickr) statsStartFlatpickr.set('enable', allowedDates);
        if (statsEndFlatpickr) statsEndFlatpickr.set('enable', allowedDates);
    }

    // 2. 월별 달력: disable 함수로 허용되지 않은 월 비활성화
    if (statsMonthFlatpickr && allowedMonths.length > 0) {
        statsMonthFlatpickr.set('disable', [
            function(date) {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const ym = `${y}-${m}`;
                return !allowedMonths.includes(ym);
            }
        ]);
    }
}

// ✅ 스마트 기본값: 오늘 또는 가장 가까운 과거 수업일
function findMostRecentSchoolDay(startDate) {
    const limit = 60;
    let checkDate = new Date(startDate);
    
    for (let i = 0; i < limit; i++) {
        if (isValidSchoolDay(checkDate)) {
            return checkDate;
        }
        checkDate.setDate(checkDate.getDate() - 1);
    }
    return startDate; // 못 찾으면 원래 날짜 반환
}

// ✅ 스마트 기본값: 올해 첫 수업일 찾기
function getFirstSchoolDay() {
    const dates = getEnableDates();
    if (dates.length > 0) {
        // 문자열 정렬 (YYYY-MM-DD 형태이므로 가능)
        dates.sort();
        return new Date(dates[0]);
    }
    return new Date(); // 데이터 없으면 오늘
}

function isValidSchoolDay(dateObj) {
    const year = CURRENT_YEAR;
    if (!globalData[year] || !globalData[year].validDays) return true; 

    const m = (dateObj.getMonth() + 1).toString();
    const d = dateObj.getDate();
    
    const validList = globalData[year].validDays[m];
    if (!validList) return false; 
    return validList.includes(d);
}

function updateDateLabel() {
  const label = document.getElementById('dateDisplayLabel');
  
  const yyyy = activeDate.getFullYear();
  const mm = String(activeDate.getMonth() + 1).padStart(2, '0');
  const dd = String(activeDate.getDate()).padStart(2, '0');
  
  if (mainFlatpickr) {
      mainFlatpickr.setDate(`${yyyy}-${mm}-${dd}`, false); 
  }
  
  label.innerText = `${mm}-${dd}`;
}

// =======================================================
// 화면 전환 및 홈 화면
// =======================================================
function goHome(fromHistory = false) {
  if (Object.keys(pendingChanges).length > 0) {
    showMessageModal("저장하지 않은 데이터가 있습니다.\n먼저 저장하세요.");
    if(fromHistory) history.pushState({ view: 'sub' }, '', '');
    return;
  }
  
  pendingChanges = {};
  updateSaveButtonUI();

  switchView('homeScreen');
  renderHomeScreenClassButtons(); 
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
      // ✅ 데이터 로드 후 달력 갱신
      updateFlatpickrAllowedDates();
    }
  } catch (error) {
    console.error(error);
  }
}

async function renderHomeScreenClassButtons() {
  const container = document.getElementById('classButtonContainer');
  container.innerHTML = "<div style='grid-column:1/-1; text-align:center; color:#888;'>출결 현황 확인 중...</div>";
  
  const year = CURRENT_YEAR;
  if (!globalData[year]) {
    container.innerHTML = `<div style="grid-column:1/-1; text-align:center;">${year}년 데이터 없음</div>`;
    return;
  }

  const today = new Date();
  const month = (today.getMonth() + 1).toString();
  const day = today.getDate().toString();
  
  let monthData = {};
  
  try {
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
        
        const classKey = `${g}-${c}`;
        const classData = monthData[classKey];
        const isConfirmedToday = classData && classData.confirmations && classData.confirmations[day];

        if (isConfirmedToday) {
            btn.classList.add('grade-1'); 
        } else {
            btn.classList.add('gray-status'); 
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
  
  activeDate = findMostRecentSchoolDay(new Date());
  
  updateDateLabel();

  history.pushState({ mode: 'attendance' }, '', '');
  switchView('attendanceScreen');
  loadStudents();
}

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
  
  const isConfirmed = data.confirmations[targetDayStr] === true;
  
  const sampleStudent = data.students[0];
  const dayRecords = sampleStudent.attendance.filter(a => a.day == targetDay);
  
  if (dayRecords.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center;">${activeDate.getMonth()+1}월 ${targetDay}일 데이터가 없습니다.</div>`;
    return;
  }

  dayRecords.sort((a,b) => parseInt(a.period) - parseInt(b.period));
  
  const FIXED_WIDTH_NO = 30;   
  const FIXED_WIDTH_NAME = 55; 
  const MIN_CELL_WIDTH = 35;   
  
  const totalCols = dayRecords.length;
  const minTableWidth = FIXED_WIDTH_NO + FIXED_WIDTH_NAME + (totalCols * MIN_CELL_WIDTH);

  let html = `<table style="min-width: ${minTableWidth}px;">`;

  html += '<colgroup>';
  html += `<col style="width: ${FIXED_WIDTH_NO}px;">`;
  html += `<col style="width: ${FIXED_WIDTH_NAME}px;">`;
  for(let i=0; i<totalCols; i++) {
    html += '<col>'; 
  }
  html += '</colgroup>';

  html += '<thead>';
  
  const dayOfWeek = getDayOfWeek(activeDate);
  const dateLabel = `${activeDate.getMonth()+1}/${targetDay}(${dayOfWeek})`;

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
  
  dayRecords.forEach(r => {
    html += `<th>${r.period}</th>`;
  });
  html += '</tr></thead><tbody>';

  data.students.forEach(std => {
    html += '<tr>';
    html += `<td>${std.no}</td>`;
    html += `<td class="col-name" onclick="showStudentSummary('${std.no}', '${std.name}')">${std.name}</td>`;
    
    dayRecords.forEach(headerRec => {
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

async function toggleDateConfirmation(dayStr) {
  if (Object.keys(pendingChanges).length > 0) {
      showMessageModal("아직 저장안된 데이터가 있습니다.\n변경된 사항을 저장한 후에 다시 시도하세요.");
      const checkbox = document.getElementById('chkConfirmDay');
      checkbox.checked = !checkbox.checked;
      return;
  }

  if (!currentRenderedData) return;

  const checkbox = document.getElementById('chkConfirmDay');
  const newStatus = checkbox.checked;

  if (!currentRenderedData.confirmations) currentRenderedData.confirmations = {};
  currentRenderedData.confirmations[dayStr] = newStatus;

  const year = CURRENT_YEAR;
  const month = (activeDate.getMonth() + 1).toString();
  const [grade, cls] = currentSelectedClass.split('-');
  const path = `attendance/${year}/${month}/${grade}-${cls}/confirmations`;
  
  try {
    await update(ref(db, path), { [dayStr]: newStatus });
    
    const header = document.querySelector('.header-day');
    const cells = document.querySelectorAll('.check-cell');
    const labelSpan = checkbox.nextElementSibling;
    if (labelSpan) labelSpan.innerText = newStatus ? "마감됨" : "마감하기";
    
    if (newStatus) {
      header.classList.add('confirmed-header');
      cells.forEach(c => c.classList.add('confirmed-col'));
    } else {
      header.classList.remove('confirmed-header');
      cells.forEach(c => c.classList.remove('confirmed-col'));
    }
    
    syncColorToGoogleSheet(newStatus);
    showToast(newStatus ? "마감(확정) 되었습니다." : "마감 해제되었습니다.");

  } catch (e) {
    alert("오류 발생: " + e.message);
    checkbox.checked = !newStatus; 
  }
}

function syncColorToGoogleSheet(isConfirmed) {
  if (!currentRenderedData || !currentRenderedData.students) return;

  const year = CURRENT_YEAR;
  const day = activeDate.getDate();
  const batchData = [];
  
  currentRenderedData.students.forEach(std => {
    const dayAtts = std.attendance.filter(a => a.day == day);
    dayAtts.forEach(att => {
      batchData.push({
        year: year,
        row: std.rowNumber,
        col: att.colIndex,
        value: att.value,
        isConfirmed: isConfirmed
      });
    });
  });

  if (batchData.length === 0) return;

  const payload = { action: "saveAttendanceBatch", data: batchData };
  fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload)
  }).then(res => res.json())
    .then(json => console.log("Color Sync:", json))
    .catch(err => console.error("Color Sync Failed:", err));
}

async function executeSave() {
  document.getElementById('confirmModal').classList.remove('show');
  const keys = Object.keys(pendingChanges);
  if (keys.length === 0 && !pendingNavigation) return;

  const year = CURRENT_YEAR;
  const month = (activeDate.getMonth() + 1).toString();
  const [grade, cls] = currentSelectedClass.split('-');
  
  const dayStr = activeDate.getDate().toString();
  const isConfirmed = currentRenderedData.confirmations ? currentRenderedData.confirmations[dayStr] : false;

  keys.forEach(key => {
    const [r, c] = key.split('-');
    const val = pendingChanges[key];
    const student = currentRenderedData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) att.value = val;
    }
  });

  const path = `attendance/${year}/${month}/${grade}-${cls}`;
  try {
    await update(ref(db, path), currentRenderedData);
    
    keys.forEach(key => {
      const [r, c] = key.split('-');
      const cell = document.querySelector(`.check-cell[data-row="${r}"][data-col="${c}"]`);
      if (cell) cell.classList.remove('unsaved-cell');
    });

    showToast("저장완료");
    
    const backupPayload = keys.map(key => {
        const [r, c] = key.split('-');
        const val = pendingChanges[key];
        return { 
          year: year, 
          row: r, 
          col: c, 
          value: val, 
          isConfirmed: isConfirmed
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

function saveState() {}

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

// 드래그 및 터치
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

function highlightHeaders(cell) {}
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

function closeStudentModal() {
  document.getElementById('studentModal').classList.remove('show');
}

// =======================================================
// [수정됨] 학생 상세 보기 팝업 함수
// =======================================================
function showStudentSummary(studentNo, studentName) {
  if (!currentRenderedData || !currentRenderedData.students) {
     alert("데이터가 로드되지 않았습니다.");
     return;
  }
  
  const student = currentRenderedData.students.find(s => s.no == studentNo);
  if (!student) {
     alert("학생 정보를 찾을 수 없습니다.");
     return;
  }

  const month = (activeDate.getMonth() + 1).toString();
  
  const titleEl = document.getElementById('studentModalTitle');
  titleEl.innerHTML = `${studentName} <span style="font-size:0.8em; color:#666;">(${studentNo}번)</span> <span style="color:#007bff">${month}</span>월 출결사항`;
  
  // 연락처 및 3단 버튼 생성
  let contactHtml = "";
  const phone = student.phone ? student.phone.replace(/[^0-9]/g, '') : ""; 
  
  if (phone) {
    const shortName = studentName.length > 1 ? studentName.substring(1) : studentName;

    const lastChar = shortName.charCodeAt(shortName.length - 1);
    const hasBatchim = (lastChar - 0xAC00) % 28 > 0;
    const suffix = hasBatchim ? "아" : "야";

    const locationUrl = "https://puroome.github.io/pin/";
    const smsBody = `${shortName}${suffix}, 선생님이야. 아래 주소에 들어가서 이름적고, 출석하기 버튼 누르면 돼.\n${locationUrl}`;
    const encodedBody = encodeURIComponent(smsBody);

    contactHtml = `
      <div class="contact-btn-group">
          <a href="tel:${phone}" class="contact-btn btn-pastel-blue">
             📞 통화
          </a>
          <a href="sms:${phone}" class="contact-btn btn-pastel-green">
             📩 문자
          </a>
          <a href="sms:${phone}?body=${encodedBody}" class="contact-btn btn-pastel-red">
             📍 위치
          </a>
      </div>
    `;
  } else {
    contactHtml = "";
  }

  const sortedAttendance = (student.attendance || []).sort((a,b) => {
    return (parseInt(a.day) - parseInt(b.day)) || (parseInt(a.period) - parseInt(b.period));
  });
  
  const summaryHtml = generateSummaryHtml(sortedAttendance); 

  document.getElementById('studentModalBody').innerHTML = contactHtml + summaryHtml;
  document.getElementById('studentModal').classList.add('show');
}

// (보조 함수) 출석 내역 HTML 생성기
function generateSummaryHtml(attendanceList) {
  const dayGroups = {};
  attendanceList.forEach(att => {
    if (!dayGroups[att.day]) dayGroups[att.day] = [];
    dayGroups[att.day].push(att);
  });
  
  let html = "<div style='text-align:left;'>";
  const days = Object.keys(dayGroups).sort((a, b) => Number(a) - Number(b));
  let hasData = false;
  
  days.forEach(day => {
    const records = dayGroups[day];
    const absents = records.filter(r => r.value && r.value.trim() !== "");
    if (absents.length === 0) return; 
    
    hasData = true;
    const isFullDay = (absents.length === records.length);
    const firstVal = absents[0].value;
    const isAllSame = absents.every(r => r.value === firstVal);
    
    html += `<div style="margin-bottom: 8px; font-size:15px; padding-bottom:5px; border-bottom:1px dashed #eee;">• <b>${day}일</b> : `;
    
    if (isFullDay && isAllSame) {
      const { typeText, reason } = parseValueWithText(firstVal);
      html += `<span style="font-weight:bold; color:#d63384;">${typeText}결석</span>`;
      if (reason) html += `, ${reason}`;
    } else {
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
      html += parts.join(', ');
    }
    html += `</div>`;
  });
  
  if (!hasData) html += "<div style='text-align:center; color:#999; padding:20px;'>이번 달 특이사항 없음</div>";
  html += "</div>";
  return html;
}

// =======================================================
// [통계 기능] (✅ 수정됨: UI 버튼 연결 및 연도 표시)
// =======================================================
// [script.js] enterStatsMode 함수 전체 교체

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
  const thisMonthStr = `${yyyy}-${mm}`;

  const dateInput = document.getElementById('statsDateInput');
  const monthInput = document.getElementById('statsMonthInput');
  const startInput = document.getElementById('statsStartDate');
  const endInput = document.getElementById('statsEndDate');

  const txtDate = document.getElementById('txtStatsDate');
  const txtMonth = document.getElementById('txtStatsMonth');
  const txtStart = document.getElementById('txtStatsStart');
  const txtEnd = document.getElementById('txtStatsEnd');

  // 기본값 설정
  dateInput.value = todayStr;
  monthInput.value = thisMonthStr;
  startInput.value = todayStr;
  endInput.value = todayStr;

  const recentDay = findMostRecentSchoolDay(new Date());
  const firstDay = getFirstSchoolDay();

  const r_yyyy = recentDay.getFullYear();
  const r_mm = String(recentDay.getMonth() + 1).padStart(2, '0');
  const r_dd = String(recentDay.getDate()).padStart(2, '0');
  const recentDayStr = `${r_yyyy}-${r_mm}-${r_dd}`;
  const recentMonthStr = `${r_yyyy}-${r_mm}`;

  const f_yyyy = firstDay.getFullYear();
  const f_mm = String(firstDay.getMonth() + 1).padStart(2, '0');
  const f_dd = String(firstDay.getDate()).padStart(2, '0');
  const firstDayStr = `${f_yyyy}-${f_mm}-${f_dd}`;

  // 1. 일별 통계
  txtDate.innerText = recentDayStr;
  
  statsDateFlatpickr = flatpickr("#statsDateInput", {
      locale: "ko", dateFormat: "Y-m-d", disableMobile: true, maxDate: "today",
      defaultDate: recentDayStr, 
      enable: getEnableDates(),
      // ✅ [수정] 달력 위치 기준을 버튼으로
      positionElement: document.getElementById('btnStatsDateTrigger'),
      onChange: (selectedDates, dateStr) => {
          txtDate.innerText = dateStr;
      }
  });
  document.getElementById('btnStatsDateTrigger').onclick = () => statsDateFlatpickr.open();

  
  // 2. 월별 통계
  txtMonth.innerText = recentMonthStr;

  statsMonthFlatpickr = flatpickr("#statsMonthInput", {
      locale: "ko", 
      disableMobile: true,
      plugins: [
          new monthSelectPlugin({
            shorthand: true, 
            dateFormat: "Y-m", 
            theme: "light"
          })
      ],
      maxDate: "today",
      defaultDate: recentMonthStr,
      disable: [],
      // ✅ [수정] 달력 위치 기준을 버튼으로
      positionElement: document.getElementById('btnStatsMonthTrigger'),
      onChange: (selectedDates, dateStr) => {
          txtMonth.innerText = dateStr;
      }
  });
  document.getElementById('btnStatsMonthTrigger').onclick = () => statsMonthFlatpickr.open();


  // 3. 기간 통계 (시작)
  txtStart.innerText = firstDayStr;

  statsStartFlatpickr = flatpickr("#statsStartDate", {
      locale: "ko", dateFormat: "Y-m-d", disableMobile: true, maxDate: "today",
      defaultDate: firstDayStr,
      enable: getEnableDates(),
      // ✅ [수정] 달력 위치 기준을 버튼으로
      positionElement: document.getElementById('btnStatsStartTrigger'),
      onChange: (selectedDates, dateStr) => {
          txtStart.innerText = dateStr;
      }
  });
  document.getElementById('btnStatsStartTrigger').onclick = () => statsStartFlatpickr.open();

  // 4. 기간 통계 (종료)
  txtEnd.innerText = recentDayStr;

  statsEndFlatpickr = flatpickr("#statsEndDate", {
      locale: "ko", dateFormat: "Y-m-d", disableMobile: true, maxDate: "today",
      defaultDate: recentDayStr,
      enable: getEnableDates(),
      // ✅ [수정] 달력 위치 기준을 버튼으로
      positionElement: document.getElementById('btnStatsEndTrigger'),
      onChange: (selectedDates, dateStr) => {
          txtEnd.innerText = dateStr;
      }
  });
  document.getElementById('btnStatsEndTrigger').onclick = () => statsEndFlatpickr.open();
  
  updateFlatpickrAllowedDates();

  renderStatsFilters();
  updateStatsInputVisibility();
}

function updateStatsInputVisibility() {
  const mode = document.querySelector('input[name="statsType"]:checked').value;
  // Wrapper ID로 접근 (CSS에서 display 제어)
  document.getElementById('dailyWrapper').style.display = (mode === 'daily') ? 'inline-block' : 'none';
  document.getElementById('monthlyWrapper').style.display = (mode === 'monthly') ? 'inline-block' : 'none';
  document.getElementById('statsPeriodInput').style.display = (mode === 'period') ? 'flex' : 'none';
}

function renderStatsFilters() {
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
    
    chkAll.addEventListener('change', (e) => { 
        chkClasses.forEach(cb => cb.checked = e.target.checked); 
    });

    // ✅ [수정] 개별 체크박스 상태가 변경되면 '전체' 체크박스도 동기화
    chkClasses.forEach(cb => {
        cb.addEventListener('change', () => {
            const allChecked = Array.from(chkClasses).every(c => c.checked);
            chkAll.checked = allChecked;
        });
    });
}

async function runStatsSearch() {
  const container = document.getElementById('statsContainer');
  container.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">데이터 분석 중...</div>';

  const selectedCheckboxes = document.querySelectorAll('input[name="classFilter"]:checked');
  if (selectedCheckboxes.length === 0) {
    container.innerHTML = '<div style="padding:40px; text-align:center; color:red;">선택된 반이 없습니다.</div>';
    return;
  }
  const targetClassKeys = Array.from(selectedCheckboxes).map(cb => cb.value);
  
  const mode = document.querySelector('input[name="statsType"]:checked').value; 
  
  let targetMonthsToFetch = []; 
  let filterStartDate = null;
  let filterEndDate = null;
  let displayTitle = "";

  const today = new Date(); 

  if (mode === 'daily') {
    const dateStr = document.getElementById('statsDateInput').value; 
    if(!dateStr) { alert("날짜를 선택해주세요."); return; }
    const d = new Date(dateStr);
    
    filterStartDate = d;
    filterEndDate = d;
    
    let qMonth = d.getMonth() + 1;
    let qYear = d.getFullYear();
    if (qMonth <= 2) qYear -= 1; 

    targetMonthsToFetch.push({ year: qYear.toString(), month: qMonth.toString() });
    
    const dayChar = getDayOfWeek(d);
    displayTitle = `${d.getMonth()+1}월 ${d.getDate()}일(${dayChar}) 통계`;

  } else if (mode === 'monthly') {
    const monthStr = document.getElementById('statsMonthInput').value; 
    if(!monthStr) { alert("월을 선택해주세요."); return; }
    const parts = monthStr.split('-');
    
    let mYear = parseInt(parts[0]);
    let mMonth = parseInt(parts[1]);
    
    // ✅ [수정] 미래 월 경고 로직 삭제 (Flatpickr가 막아주므로)

    if (mMonth <= 2) mYear -= 1;

    // 해당 월의 1일부터 말일까지 범위 설정
    filterStartDate = new Date(parts[0], mMonth - 1, 1);
    filterEndDate = new Date(parts[0], mMonth, 0);

    targetMonthsToFetch.push({ year: mYear.toString(), month: mMonth.toString() });
    displayTitle = `${parseInt(parts[1])}월 전체 통계`;

  } else if (mode === 'period') {
    const startStr = document.getElementById('statsStartDate').value;
    const endStr = document.getElementById('statsEndDate').value;
    if(!startStr || !endStr) { alert("시작일과 종료일을 선택해주세요."); return; }
    
    filterStartDate = new Date(startStr);
    filterEndDate = new Date(endStr);
    
    if(filterStartDate > filterEndDate) { alert("날짜 범위 오류"); return; }
    
    displayTitle = `${startStr} ~ ${endStr} 통계`;

    let curr = new Date(filterStartDate.getFullYear(), filterStartDate.getMonth(), 1);
    const endLimit = new Date(filterEndDate.getFullYear(), filterEndDate.getMonth(), 1);
    
    while(curr <= endLimit) {
        let qMonth = curr.getMonth() + 1;
        let qYear = curr.getFullYear();
        if (qMonth <= 2) qYear -= 1;

        targetMonthsToFetch.push({ year: qYear.toString(), month: qMonth.toString() });
        curr.setMonth(curr.getMonth() + 1);
    }
  }
  
  window.currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };
  let fullDayAbsentCounts = { '1': 0, '2': 0, '3': 0 }; 
  
  let hasRangeData = false;
  
  try {
    const results = [];
    const promises = targetMonthsToFetch.map(async (tm) => {
        const path = `attendance/${tm.year}/${tm.month}`;
        const snapshot = await get(child(ref(db), path));
        
        if(!snapshot.exists()) return [];
        
        const monthData = snapshot.val(); 
        const monthResults = [];
        
        targetClassKeys.forEach(classKey => {
            if (monthData[classKey]) {
                monthResults.push({ 
                    year: tm.year, 
                    month: tm.month, 
                    classKey, 
                    val: monthData[classKey] 
                });
            }
        });
        return monthResults;
    });

    const nestedResults = await Promise.all(promises);
    nestedResults.forEach(arr => results.push(...arr));

    // ✅ [수정] 마감 정보를 별도로 수집 (모든 클래스에 대해)
    const unconfirmedInfo = {}; // key: classKey, val: [ {month, day}, ... ]

    // 1. 초기화
    targetClassKeys.forEach(k => unconfirmedInfo[k] = []);

    // 2. 검색 범위 내의 "유효 날짜(Valid Date)" 목록 생성
    const yearKey = CURRENT_YEAR;
    const validDaysMap = globalData[yearKey] ? globalData[yearKey].validDays : {};

    // 체크해야 할 날짜 리스트 만들기
    const checkEndDate = (filterEndDate > today) ? today : filterEndDate;
    const checkStartDate = filterStartDate;

    const requiredDates = []; // { m: "3", d: 5 }
    
    if (validDaysMap) {
        let loopDate = new Date(checkStartDate);
        loopDate.setHours(0,0,0,0);
        const loopEnd = new Date(checkEndDate);
        loopEnd.setHours(0,0,0,0);

        while(loopDate <= loopEnd) {
             const mStr = (loopDate.getMonth() + 1).toString();
             const dVal = loopDate.getDate();
             
             if (validDaysMap[mStr] && validDaysMap[mStr].includes(dVal)) {
                 requiredDates.push({ m: mStr, d: dVal });
             }
             loopDate.setDate(loopDate.getDate() + 1);
        }
    }

    // 3. 각 반별로 확인
    const classDataMap = {};
    results.forEach(res => {
        if (!classDataMap[res.classKey]) classDataMap[res.classKey] = {};
        classDataMap[res.classKey][res.month] = res.val;
    });

    targetClassKeys.forEach(cKey => {
        requiredDates.forEach(rd => {
            const m = rd.m;
            const dStr = rd.d.toString();
            
            let isConf = false;
            if (classDataMap[cKey] && classDataMap[cKey][m]) {
                const cData = classDataMap[cKey][m];
                if (cData.confirmations && cData.confirmations[dStr]) {
                    isConf = true;
                }
            }
            
            if (!isConf) {
                unconfirmedInfo[cKey].push({ month: m, day: rd.d });
            }
        });
    });

    const aggregated = {}; 
    const finalClassSet = new Set();
    
    results.forEach(res => {
         if (!res.val) return;

         if (!finalClassSet.has(res.classKey) && res.val.students) {
            const grade = res.classKey.split('-')[0];
            window.currentStatsTotalCounts[grade] += res.val.students.length;
            finalClassSet.add(res.classKey);
         }
    });

    results.forEach(res => {
      if (!res.val || !res.val.students) return;
      
      const classKey = res.classKey;
      const grade = classKey.split('-')[0];
      const students = res.val.students;

      if (!aggregated[classKey]) aggregated[classKey] = {};

      students.forEach(s => {
        if (!s.attendance) return;

        const rYear = getRealYear(res.year, res.month);
        const rMonth = parseInt(res.month);

        const checkRange = (att) => {
             const rDay = parseInt(att.day);
             const rDate = new Date(rYear, rMonth - 1, rDay);
             const fStart = new Date(filterStartDate); fStart.setHours(0,0,0,0);
             const fEnd = new Date(filterEndDate); fEnd.setHours(0,0,0,0);
             return rDate >= fStart && rDate <= fEnd;
        };

        if (!hasRangeData) {
            const hasDataInPeriod = s.attendance.some(a => checkRange(a));
            if (hasDataInPeriod) hasRangeData = true;
        }

        let validRecords = s.attendance.filter(a => {
            if (!a.value || a.value.trim() === "") return false;
            return checkRange(a);
        });

        if (validRecords.length > 0) {
          if (mode === 'daily') {
             const targetDay = filterStartDate.getDate();
             const totalPeriodsThatDay = s.attendance.filter(a => a.day == targetDay).length;
             
             if (totalPeriodsThatDay > 0 && validRecords.length === totalPeriodsThatDay) {
                 if (!aggregated[classKey][s.no]) { 
                    fullDayAbsentCounts[grade]++;
                 }
             }
          }

          if (!aggregated[classKey][s.no]) {
            aggregated[classKey][s.no] = { name: s.name, records: [] };
          }

          const recordsWithMeta = validRecords.map(r => {
              const rDay = parseInt(r.day);
              const yoil = getDayOfWeek(new Date(rYear, rMonth-1, rDay));
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

    // unconfirmedInfo를 인자로 전달
    renderStatsResult(aggregated, targetClassKeys, mode, displayTitle, unconfirmedInfo, fullDayAbsentCounts, hasRangeData);

  } catch (e) {
    console.error(e);
    container.innerHTML = `<div style="text-align:center; color:red;">오류: ${e.message}</div>`;
  }
}

function renderStatsResult(aggregatedData, sortedClassKeys, mode, displayTitle, unconfirmedInfo, fullDayAbsentCounts, hasRangeData) {
  const container = document.getElementById('statsContainer');
  let html = "";
  
  html += `<div style="text-align:center; margin-bottom:15px; font-weight:bold; color:#555;">[ ${displayTitle} ]</div>`;

  if (mode === 'daily') {
      // ✅ [추가 로직] 모든 반이 마감되었는지 확인
      let isAllConfirmedForSummary = true;
      for (const cKey of sortedClassKeys) {
          const unconf = unconfirmedInfo[cKey] || [];
          if (unconf.length > 0) {
              isAllConfirmedForSummary = false;
              break;
          }
      }

      // 모든 반이 마감되었을 때만 요약 통계 표시
      if (isAllConfirmedForSummary) {
          const summary = calculateDailySummary(fullDayAbsentCounts);
          if(summary) html += summary;
      }
  }

  // ✅ [수정 완료: 기능 5-2 All Clean Check]
  // 모든 반이 1) 마감 완료이고 2) 특이사항이 없는지 체크
  let isAllClean = true;
  for (const cKey of sortedClassKeys) {
      const notConfirmedList = unconfirmedInfo[cKey] || [];
      const hasStudents = aggregatedData[cKey] && Object.keys(aggregatedData[cKey]).length > 0;
      
      if (notConfirmedList.length > 0 || hasStudents) {
          isAllClean = false;
          break;
      }
  }

  // 데이터가 아예 없는 경우(미래 등)는 위에서 걸러졌거나 hasRangeData로 처리됨.
  // 만약 조회 기간 내에 유효 데이터가 있지만, 모두 출석하고 모두 마감했다면:
  if (hasRangeData && isAllClean) {
      // ✅ [수정 완료: 기능 3] 문구 통일
      html += `<div style="padding:40px; text-align:center; color:#888;">특이사항(결석 등)이 없습니다.</div>`;
      container.innerHTML = html;
      return;
  }
  
  // 반별 렌더링
  sortedClassKeys.forEach(classKey => {
    // 1. 마감 배지 생성
    const notConfirmedList = unconfirmedInfo[classKey] || [];
    let badgeHtml = "";
    let unconfirmedText = "";

    if (notConfirmedList.length === 0) {
        badgeHtml = `<span style="font-size:12px; color:green; margin-left:8px;">[마감 완료]</span>`;
    } else {
        badgeHtml = `<span style="font-size:12px; color:red; margin-left:8px;">[마감 전]</span>`;

        // ✅ [수정 완료] 일별 조회 시 텍스트 제거, 월별/기간만 텍스트 표시
        if (mode !== 'daily') {
            // 월별 그룹핑 및 연속 날짜 스마트 요약
            // 1. 월별로 나누기
            const groupByMonth = {};
            notConfirmedList.forEach(item => {
                if (!groupByMonth[item.month]) groupByMonth[item.month] = [];
                groupByMonth[item.month].push(item.day);
            });
            
            const parts = [];
            const yearKey = CURRENT_YEAR;
            const validDaysMap = globalData[yearKey] ? globalData[yearKey].validDays : {};

            Object.keys(groupByMonth).sort((a,b)=>Number(a)-Number(b)).forEach(m => {
                const days = groupByMonth[m].sort((a,b)=>a-b);
                const validList = validDaysMap[m] || [];
                
                // 연속성 체크 로직 (Smart Grouping)
                // validList에서 days[i]와 days[i+1] 사이에 다른 valid day가 없으면 연속으로 판단
                
                let ranges = [];
                if (days.length > 0) {
                    let start = days[0];
                    let end = days[0];

                    for (let i = 1; i < days.length; i++) {
                        const current = days[i];
                        
                        // prev(end)와 current 사이에 valid day가 있는지 확인
                        const validIdxStart = validList.indexOf(end);
                        const validIdxEnd = validList.indexOf(current);
                        
                        // 인덱스가 연속되면 (즉, validList 상에서 바로 옆이면) -> 연속된 수업일
                        if (validIdxStart !== -1 && validIdxEnd !== -1 && (validIdxEnd - validIdxStart === 1)) {
                            end = current;
                        } else {
                            // 끊김 -> 저장 후 새로 시작
                            ranges.push(start === end ? `${start}` : `${start}~${end}`);
                            start = current;
                            end = current;
                        }
                    }
                    ranges.push(start === end ? `${start}` : `${start}~${end}`);
                }
                
                parts.push(`${m}월 ${ranges.join(', ')}일`);
            });
            
            // "마감 전" 텍스트 중복 제거
            unconfirmedText = `<span style="font-size:12px; color:red; margin-left:5px;">${parts.join(', ')}</span>`;
        }
    }

    const studentsMap = aggregatedData[classKey];
    const hasStudents = studentsMap && Object.keys(studentsMap).length > 0;

    // ✅ [수정 완료: 기능 5-1] 무조건 반 리스트 표시
    html += `<div class="stats-class-block">
                <div class="stats-class-header">
                    ${classKey}반 ${badgeHtml} ${unconfirmedText}
                </div>`;

    if (hasStudents) {
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
    } else {
        // ✅ [수정 완료: 기능 3] 특이사항 없음 문구 통일
        html += `<div style="padding:15px; text-align:center; color:#888; font-size:13px;">특이사항(결석 등)이 없습니다.</div>`;
    }
    html += `</div>`;
  });

  if (!hasRangeData) {
    // ✅ [수정 완료: 기능 4] 조회 불가 메시지 (이미 runStatsSearch 초반에 처리했지만 이중 안전장치)
    // 여기 도달했다는 건 날짜 범위가 과거지만 데이터가 없는 경우(휴일 등)
    html += `<div style="padding:20px; text-align:center; color:#888;">해당 기간의 수업 자료가 없습니다.</div>`;
  } 
  
  container.innerHTML = html;
}

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
      <div class="stats-summary-row summary-total"><span>총 출석</span> <span>${allPresent} / ${allTotal}</span></div>
    </div>
  `;
}

function getStudentSummaryText(records) {
  const dateGroups = {};
  records.forEach(r => {
    const key = r._fullDateStr;
    if(!dateGroups[key]) dateGroups[key] = [];
    dateGroups[key].push(r);
  });

  let lines = [];
  const dateKeys = Object.keys(dateGroups).sort(); 

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
       const reasonGroups = {};
       list.forEach(item => {
         if(!reasonGroups[item.value]) reasonGroups[item.value] = [];
         reasonGroups[item.value].push(item.period);
       });
       
       const parts = [];
       for(const [val, periods] of Object.entries(reasonGroups)){
         const { typeText, reason } = parseValueWithText(val);
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

// ✅ [신규 함수] 학년도(SchoolYear)와 월(Month)을 입력받아
// 실제 달력상의 연도(CalendarYear)를 반환하는 함수
function getRealYear(schoolYear, month) {
  const m = parseInt(month);
  const y = parseInt(schoolYear);
  // 1월, 2월 데이터는 실제로는 (학년도 + 1)년의 데이터임
  if (m === 1 || m === 2) {
    return y + 1;
  }
  return y;
}

