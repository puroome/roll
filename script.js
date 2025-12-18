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

let isMultiMode = false;
let selectedCells = new Set();
let dragStartAction = null;
let longPressTimer = null;
let dragStartCell = null;
let pendingChanges = {};
let lastTouchTime = 0;

let pendingNavigation = null;
let activeFilterId = null;
let previousSelectValues = {}; 

let currentSelectedClass = null;

document.addEventListener('DOMContentLoaded', () => {
  window.onSaveBtnClick = onSaveBtnClick;
  window.onMonthChange = onMonthChange;
  window.getPendingCount = () => Object.keys(pendingChanges).length;
  window.loadStudents = loadStudents;
  window.saveState = saveState;
  window.toggleReasonInput = toggleReasonInput;
  window.hideConfirmModal = hideConfirmModal;
  window.executeSave = executeSave;
  window.closeStudentModal = closeStudentModal;

  const filterIds = ['monthSelect', 'weekSelect'];
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('focus', () => { previousSelectValues[id] = el.value; });
    el.addEventListener('change', (e) => {
      const runFilterLogic = () => {
        if (id === 'monthSelect') onMonthChange(); 
        else loadStudents(); 
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

  document.getElementById('btnStatsMode').addEventListener('click', enterStatsMode);
  
  // [수정] goHome 직접 호출 대신 history.back() 사용
  document.getElementById('btnBackToHome').addEventListener('click', () => history.back());
  document.getElementById('btnBackToHomeStats').addEventListener('click', () => history.back());

  // [추가] 브라우저 뒤로가기(안드로이드 백버튼) 감지
  window.addEventListener('popstate', () => {
    // 히스토리가 변경되면 홈으로 이동을 시도
    goHome(true);
  });

  toggleReasonInput();
  fetchInitDataFromFirebase();
});

// [수정] fromHistory 파라미터 추가하여 백버튼 이벤트 처리
function goHome(fromHistory = false) {
  if (Object.keys(pendingChanges).length > 0) {
    if(!confirm("저장하지 않은 데이터가 있습니다. 무시하고 나가시겠습니까?")) {
      // 뒤로가기로 들어왔는데 취소했다면, 다시 히스토리를 채워넣어 현재 화면 상태 유지
      if(fromHistory) {
        history.pushState({ view: 'sub' }, '', '');
      }
      return;
    }
    pendingChanges = {};
    updateSaveButtonUI();
  }
  switchView('homeScreen');
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
    } else {
      alert("Firebase 데이터 없음");
    }
  } catch (error) {
    console.error(error);
    alert("데이터 로드 실패: " + error.message);
  }
}

// [수정] 학년별 줄바꿈 및 전체 반 버튼 생성 로직 (반 개수 2개로 수정됨)
function renderHomeScreenClassButtons() {
  const container = document.getElementById('classButtonContainer');
  container.innerHTML = "";
  
  if (!globalData[CURRENT_YEAR]) {
    container.innerHTML = `<div style="grid-column:1/-1; text-align:center;">${CURRENT_YEAR}년 데이터 없음</div>`;
    return;
  }

  const info = globalData[CURRENT_YEAR];
  
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
  const today = new Date();
  const currentMonth = (today.getMonth() + 1).toString();
  const currentWeek = calculateCurrentWeek(CURRENT_YEAR, currentMonth, today.getDate());

  currentSelectedClass = `${grade}-${cls}`;

  setupYearData(CURRENT_YEAR);
  
  const mSel = document.getElementById('monthSelect');
  mSel.value = currentMonth;
  onMonthChange(); 

  const wSel = document.getElementById('weekSelect');
  if (currentWeek > 0) {
    const weekOpt = Array.from(wSel.options).find(o => o.value == currentWeek);
    if(weekOpt) wSel.value = currentWeek;
    else if(wSel.options.length > 1) wSel.selectedIndex = wSel.options.length - 1;
  }

  // [추가] 히스토리 스택 추가
  history.pushState({ mode: 'attendance' }, '', '');
  switchView('attendanceScreen');
  loadStudents();
}

function calculateCurrentWeek(year, month, day) {
  const firstDayDate = new Date(year, month - 1, 1);
  const dayOfWeek = firstDayDate.getDay(); 
  
  let startDate = 1;
  if (dayOfWeek === 6) startDate = 3;
  else if (dayOfWeek === 0) startDate = 2;

  if (day < startDate) return 0;
  return Math.floor((day - startDate) / 7) + 1;
}

// ---------------------------------------------------------
// [수정] 통계 모드 진입 (초기화)
// ---------------------------------------------------------
async function enterStatsMode() {
  history.pushState({ mode: 'stats' }, '', '');
  switchView('statsScreen');
  
  // 1. 이벤트 리스너 연결 (중복 방지)
  const btnSearch = document.getElementById('btnSearchStats');
  btnSearch.onclick = runStatsSearch;

  const radios = document.getElementsByName('statsType');
  radios.forEach(r => r.addEventListener('change', updateStatsInputVisibility));

  // 2. 날짜 초기값 설정 (오늘)
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');

  document.getElementById('statsDateInput').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('statsMonthInput').value = `${yyyy}-${mm}`;

  // 3. 반 선택 필터 생성 (전체 선택 상태로)
  renderStatsFilters();
  
  // 4. 입력창 가시성 업데이트
  updateStatsInputVisibility();
}

// [추가] 일별/월별 라디오 버튼에 따라 입력창 전환
function updateStatsInputVisibility() {
  const mode = document.querySelector('input[name="statsType"]:checked').value;
  if (mode === 'daily') {
    document.getElementById('statsDateInput').style.display = 'block';
    document.getElementById('statsMonthInput').style.display = 'none';
  } else {
    document.getElementById('statsDateInput').style.display = 'none';
    document.getElementById('statsMonthInput').style.display = 'block';
  }
}

// [추가] 반 선택 필터 렌더링 (전체선택 포함)
function renderStatsFilters() {
  const container = document.getElementById('statsFilterContainer');
  container.innerHTML = "";

  // 현재 연도 데이터 확인
  const year = CURRENT_YEAR;
  if (!globalData[year]) {
    container.innerHTML = "데이터 없음";
    return;
  }

  const grades = globalData[year].grades || [];
  const classes = globalData[year].classes || [];

  // 1. 전체 선택 버튼
  const allWrapper = document.createElement('label');
  allWrapper.className = 'filter-tag';
  allWrapper.innerHTML = `<input type="checkbox" id="chkAll" checked><span>전체</span>`;
  container.appendChild(allWrapper);

  // 2. 각 반별 버튼 생성 (예: 1-1, 1-2, 2-1...)
  grades.forEach(g => {
    classes.forEach(c => {
      const label = document.createElement('label');
      label.className = 'filter-tag';
      const val = `${g}-${c}`;
      label.innerHTML = `<input type="checkbox" name="classFilter" value="${val}" checked><span>${val}</span>`;
      container.appendChild(label);
    });
  });

  // 전체 선택/해제 로직
  const chkAll = document.getElementById('chkAll');
  const chkClasses = document.getElementsByName('classFilter');

  chkAll.addEventListener('change', (e) => {
    chkClasses.forEach(cb => cb.checked = e.target.checked);
  });
  
  // 개별 버튼 클릭 시 '전체' 체크 상태 동기화
  chkClasses.forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = Array.from(chkClasses).every(c => c.checked);
      chkAll.checked = allChecked;
    });
  });
}

// ---------------------------------------------------------
// [핵심] 통계 조회 실행 함수
// ---------------------------------------------------------
async function runStatsSearch() {
  const container = document.getElementById('statsContainer');
  container.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">데이터 분석 중...</div>';

  // 1. 선택된 필터 확인
  const selectedCheckboxes = document.querySelectorAll('input[name="classFilter"]:checked');
  if (selectedCheckboxes.length === 0) {
    container.innerHTML = '<div style="padding:40px; text-align:center; color:red;">선택된 반이 없습니다.</div>';
    return;
  }
  const targetClassKeys = Array.from(selectedCheckboxes).map(cb => cb.value);

  // 2. 날짜/모드 확인
  const mode = document.querySelector('input[name="statsType"]:checked').value; // 'daily' or 'monthly'
  let targetYear = CURRENT_YEAR;
  let targetMonth = "";
  let targetWeek = "";     // 일별 모드일 때 사용
  let specificDay = "";    // 일별 모드일 때 사용 (예: 15)
  let targetWeeks = [];    // 월별 모드일 때 사용

  if (mode === 'daily') {
    const dateStr = document.getElementById('statsDateInput').value; // yyyy-mm-dd
    if(!dateStr) return;
    const dateObj = new Date(dateStr);
    targetYear = dateObj.getFullYear().toString();
    targetMonth = (dateObj.getMonth() + 1).toString();
    specificDay = dateObj.getDate().toString();
    
    // 해당 날짜가 몇 주차인지 계산
    targetWeek = calculateCurrentWeek(targetYear, targetMonth, parseInt(specificDay)).toString();
    if(targetWeek === "0") {
        container.innerHTML = '<div style="padding:40px; text-align:center;">선택한 날짜의 주차 정보를 찾을 수 없습니다.</div>';
        return;
    }
    targetWeeks = [targetWeek]; // 일별이라도 로직 통일을 위해 배열로 처리

  } else {
    // Monthly
    const monthStr = document.getElementById('statsMonthInput').value; // yyyy-mm
    if(!monthStr) return;
    const parts = monthStr.split('-');
    targetYear = parts[0];
    targetMonth = parseInt(parts[1]).toString(); // "05" -> "5"

    // 해당 월의 모든 주차 가져오기 (globalData에서 조회)
    if (globalData[targetYear] && globalData[targetYear].weeks[targetMonth]) {
      targetWeeks = globalData[targetYear].weeks[targetMonth];
    } else {
      container.innerHTML = '<div style="padding:40px; text-align:center;">해당 월의 데이터가 없습니다.</div>';
      return;
    }
  }

  // 3. Firebase 데이터 가져오기 (병렬 처리)
  const promises = [];
  targetClassKeys.forEach(classKey => {
    targetWeeks.forEach(w => {
      const path = `attendance/${targetYear}/${targetMonth}/${w}/${classKey}`;
      promises.push(get(child(ref(db), path)).then(snap => ({ 
        classKey: classKey, 
        week: w, 
        val: snap.exists() ? snap.val() : null 
      })));
    });
  });

  try {
    const results = await Promise.all(promises);
    
    // 4. 데이터 집계
    const aggregated = {}; // { "1-1": { "1번": {name, records:[]} } }

    results.forEach(res => {
      if (!res.val || !res.val.students) return;
      
      const classKey = res.classKey;
      const students = res.val.students;

      if (!aggregated[classKey]) aggregated[classKey] = {};

      students.forEach(s => {
        if (!s.attendance) return;
        
        // 필터링: 일별 모드면 특정 날짜(day)만, 월별이면 전체
        let validRecords = s.attendance.filter(a => a.value && a.value.trim() !== "");
        
        if (mode === 'daily') {
          validRecords = validRecords.filter(a => a.day == specificDay);
        }

        if (validRecords.length > 0) {
          if (!aggregated[classKey][s.no]) {
            aggregated[classKey][s.no] = { name: s.name, records: [] };
          }
          aggregated[classKey][s.no].records.push(...validRecords);
        }
      });
    });

    // 5. 결과 화면 렌더링
    renderStatsResult(aggregated, targetClassKeys, mode, specificDay, targetMonth);

  } catch (e) {
    console.error(e);
    container.innerHTML = `<div style="text-align:center; color:red;">오류: ${e.message}</div>`;
  }
}

// [추가] 통계 결과 렌더링 함수
function renderStatsResult(aggregatedData, sortedClassKeys, mode, day, month) {
  const container = document.getElementById('statsContainer');
  let html = "";
  let hasAnyData = false;
  
  // 제목 표시
  const titleText = (mode === 'daily') 
    ? `${month}월 ${day}일 통계` 
    : `${month}월 전체 통계`;

  html += `<div style="text-align:center; margin-bottom:15px; font-weight:bold; color:#555;">[ ${titleText} ]</div>`;

  sortedClassKeys.forEach(classKey => {
    const studentsMap = aggregatedData[classKey];
    if (!studentsMap || Object.keys(studentsMap).length === 0) return;

    hasAnyData = true;
    html += `<div class="stats-class-block"><div class="stats-class-header">${classKey}반</div>`;

    // 번호순 정렬
    const sortedStudentNos = Object.keys(studentsMap).sort((a,b) => Number(a) - Number(b));
    
    sortedStudentNos.forEach(sNo => {
      const sData = studentsMap[sNo];
      // 날짜/교시순 정렬
      sData.records.sort((a,b) => Number(a.day) - Number(b.day) || Number(a.period) - Number(b.period));
      
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

function getStudentSummaryText(records) {
  const dayGroups = {};
  records.forEach(r => {
    if(!dayGroups[r.day]) dayGroups[r.day] = [];
    dayGroups[r.day].push(r);
  });

  let lines = [];
  const days = Object.keys(dayGroups).sort((a,b)=>Number(a)-Number(b));

  days.forEach(day => {
    const list = dayGroups[day];
    const totalPeriods = 7; 
    const isFullDay = (list.length >= 6); 
    const firstVal = list[0].value;
    const isAllSame = list.every(x => x.value === firstVal);

    let text = `<b>${day}일</b>: `;
    if (isFullDay && isAllSame) {
       const { typeText, reason } = parseValueWithText(firstVal);
       text += `<span style="color:#d63384;">${typeText}결석</span>`;
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
         let sub = `${periods.join(',')}교시 ${typeText}`;
         if(reason) sub += `(${reason})`;
         parts.push(sub);
       }
       text += parts.join(' / ');
    }
    lines.push(text);
  });

  return lines.join('<br>');
}

async function loadStudents() {
  pendingChanges = {};
  updateSaveButtonUI(); 
  
  const year = CURRENT_YEAR;
  const month = document.getElementById('monthSelect').value;
  const week = document.getElementById('weekSelect').value;
  const combinedVal = currentSelectedClass; 

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
  const combinedVal = currentSelectedClass; 
  
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

function saveState() { 
  const s = { 
    month: document.getElementById('monthSelect').value, 
    week: document.getElementById('weekSelect').value, 
    combinedClass: currentSelectedClass 
  }; 
  localStorage.setItem('attendanceState', JSON.stringify(s)); 
}
function getSavedState() { const s = localStorage.getItem('attendanceState'); return s ? JSON.parse(s) : null; }

function initUI(data) {
  document.getElementById('loading').style.display = 'none';
  globalData = data;
}

function setupYearData(year) {
  const info = globalData[year];
  const mSel = document.getElementById('monthSelect');
  mSel.innerHTML = '<option value="">월</option>';
  document.getElementById('weekSelect').innerHTML = '<option value="">주</option>';
  
  info.months.forEach(m => mSel.add(new Option(m + '월', m))); 
}

function onMonthChange(isRestoring = false) {
  const year = CURRENT_YEAR;
  const month = document.getElementById('monthSelect').value;
  const wSel = document.getElementById('weekSelect');
  
  wSel.innerHTML = '<option value="">주</option>'; 
  if (!month) return; 

  const weeks = calculateWeeks(year, month);
  weeks.forEach(w => wSel.add(new Option(w + '주', w)));
  
  if (isRestoring) {
     const s = getSavedState();
     if (s.week) { 
       const o = Array.from(wSel.options).find(opt => opt.value == s.week); 
       if (o) wSel.value = s.week; 
     }
  }
}

function calculateWeeks(year, month) {
  const weeks = [];
  const firstDayDate = new Date(year, month - 1, 1);
  const dayOfWeek = firstDayDate.getDay(); 
  const lastDayDate = new Date(year, month, 0);
  const lastDate = lastDayDate.getDate();

  let startDate = 1;
  if (dayOfWeek === 6) startDate = 3;
  else if (dayOfWeek === 0) startDate = 2;

  let currentWeekCount = 1;
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

function convertSymbolToText(symbol) {
  if (symbol === '△') return '인정';
  if (symbol === '○') return '병';
  if (symbol === 'Ⅹ' || symbol === 'X' || symbol === 'x') return '무단';
  return symbol; 
}

window.showStudentSummary = async function(studentNo, studentName) {
  const month = document.getElementById('monthSelect').value;
  const year = CURRENT_YEAR;
  const combinedVal = currentSelectedClass; 
  
  if (!month || !combinedVal) return;
  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  document.getElementById('studentModalTitle').innerText = `${studentName} (${month}월 출결)`;
  document.getElementById('studentModalBody').innerHTML = "<div style='text-align:center; padding:30px; color:#888;'>전체 데이터를 불러오는 중...</div>";
  document.getElementById('studentModal').classList.add('show');

  try {
    const weeks = globalData[year].weeks[month]; 
    if (!weeks || weeks.length === 0) {
       document.getElementById('studentModalBody').innerHTML = "<div style='text-align:center; padding:20px;'>데이터가 없습니다.</div>";
       return;
    }
    const promises = weeks.map(w => {
        const path = `attendance/${year}/${month}/${w}/${grade}-${cls}`;
        return get(child(ref(db), path));
    });
    const snapshots = await Promise.all(promises);
    let allAttendance = [];
    snapshots.forEach(snapshot => {
        if (!snapshot.exists()) return;
        const data = snapshot.val();
        const student = data.students.find(s => s.no == studentNo); 
        if (student && student.attendance) {
            allAttendance = allAttendance.concat(student.attendance);
        }
    });
    allAttendance.sort((a, b) => Number(a.day) - Number(b.day) || Number(a.period) - Number(b.period));
    renderStudentMonthlySummary(allAttendance);
  } catch (err) {
    console.error(err);
    document.getElementById('studentModalBody').innerHTML = `<div style='text-align:center; color:red; padding:20px;'>오류 발생: ${err.message}</div>`;
  }
};

function renderStudentMonthlySummary(attendanceList) {
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
    const absents = records.filter(r => r.value && r.value.trim() !== "");
    if (absents.length === 0) return; 
    hasData = true;
    const isFullDay = (absents.length === records.length);
    const firstVal = absents[0].value;
    const isAllSame = absents.every(r => r.value === firstVal);
    contentHtml += `<div style="margin-bottom: 8px; font-size:15px; padding-bottom:5px; border-bottom:1px dashed #eee;">• <b>${day}일</b> : `;
    if (isFullDay && isAllSame) {
      const { typeText, reason } = parseValueWithText(firstVal);
      contentHtml += `<span style="font-weight:bold; color:#d63384;">${typeText}결석</span>`;
      if (reason) contentHtml += `, ${reason}`;
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
      contentHtml += parts.join(', ');
    }
    contentHtml += `</div>`;
  });
  if (!hasData) contentHtml = "<div style='text-align:center; color:#999; padding:30px;'>이번 달 특이사항 없음</div>";
  document.getElementById('studentModalBody').innerHTML = contentHtml;
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

function closeStudentModal() {
  document.getElementById('studentModal').classList.remove('show');
}
