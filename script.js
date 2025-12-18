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

// [통계] 전체 학생 수 저장 변수
let currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };

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
  window.toggleDateConfirmation = toggleDateConfirmation; // 확정 토글

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
  
  document.getElementById('btnBackToHome').addEventListener('click', () => history.back());
  document.getElementById('btnBackToHomeStats').addEventListener('click', () => history.back());

  window.addEventListener('popstate', () => {
    goHome(true);
  });

  toggleReasonInput();
  fetchInitDataFromFirebase();
});

function goHome(fromHistory = false) {
  if (Object.keys(pendingChanges).length > 0) {
    if(!confirm("저장하지 않은 데이터가 있습니다. 무시하고 나가시겠습니까?")) {
      if(fromHistory) {
        history.pushState({ view: 'sub' }, '', '');
      }
      return;
    }
    pendingChanges = {};
    updateSaveButtonUI();
  }
  switchView('homeScreen');
  renderHomeScreenClassButtons(); // 돌아올 때 상태 업데이트
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

// [수정] 홈 화면 반 버튼 (학년별 색상 및 확정상태 반영)
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
  const week = calculateCurrentWeek(year, month, today.getDate());
  
  // 이번 주 전체 데이터 가져오기 (각 반의 오늘 확정 상태 확인)
  let weekData = {};
  if (week > 0) {
    try {
      const path = `attendance/${year}/${month}/${week}`;
      const snapshot = await get(child(ref(db), path));
      if (snapshot.exists()) {
        weekData = snapshot.val();
      }
    } catch (e) {
      console.log("홈 데이터 로드 실패", e);
    }
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
        const classWeekData = weekData[classKey];
        const isConfirmedToday = classWeekData && classWeekData.confirmations && classWeekData.confirmations[day];

        if (isConfirmedToday) {
            // [수정] 학년 구분 없이 모든 반을 노란색(grade-1) 스타일로 통일
            btn.classList.add('grade-1');
        } else {
            // 미확정(기본): 회색
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
  
  const dailyInput = document.getElementById('statsDateInput');
  const monthlyInput = document.getElementById('statsMonthInput');
  const periodInput = document.getElementById('statsPeriodInput');

  dailyInput.style.display = 'none';
  monthlyInput.style.display = 'none';
  periodInput.style.display = 'none';

  if (mode === 'daily') {
    dailyInput.style.display = 'block';
  } else if (mode === 'monthly') {
    monthlyInput.style.display = 'block';
  } else if (mode === 'period') {
    periodInput.style.display = 'flex';
  }
}

function renderStatsFilters() {
  const container = document.getElementById('statsFilterContainer');
  container.innerHTML = "";

  const year = CURRENT_YEAR;
  if (!globalData[year]) {
    container.innerHTML = "데이터 없음";
    return;
  }

  const grades = globalData[year].grades || [];
  const classes = globalData[year].classes || [];

  const allWrapper = document.createElement('label');
  allWrapper.className = 'filter-tag';
  allWrapper.innerHTML = `<input type="checkbox" id="chkAll" checked><span>전체</span>`;
  container.appendChild(allWrapper);

  grades.forEach(g => {
    classes.forEach(c => {
      const label = document.createElement('label');
      label.className = 'filter-tag';
      const val = `${g}-${c}`;
      label.innerHTML = `<input type="checkbox" name="classFilter" value="${val}" checked><span>${val}</span>`;
      container.appendChild(label);
    });
  });

  const chkAll = document.getElementById('chkAll');
  const chkClasses = document.getElementsByName('classFilter');

  chkAll.addEventListener('change', (e) => {
    chkClasses.forEach(cb => cb.checked = e.target.checked);
  });
  
  chkClasses.forEach(cb => {
    cb.addEventListener('change', () => {
      const allChecked = Array.from(chkClasses).every(c => c.checked);
      chkAll.checked = allChecked;
    });
  });
}

// [수정] 통계 조회 실행 (총 교시 수와 결석 교시 수 비교 로직 개선)
async function runStatsSearch() {
  const container = document.getElementById('statsContainer');
  container.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">데이터 분석 중...</div>';

  // 1. 선택된 반 확인
  const selectedCheckboxes = document.querySelectorAll('input[name="classFilter"]:checked');
  const allCheckboxes = document.querySelectorAll('input[name="classFilter"]'); 
  
  if (selectedCheckboxes.length === 0) {
    container.innerHTML = '<div style="padding:40px; text-align:center; color:red;">선택된 반이 없습니다.</div>';
    return;
  }
  const targetClassKeys = Array.from(selectedCheckboxes).map(cb => cb.value);
  
  const isAllClassesSelected = (selectedCheckboxes.length === allCheckboxes.length);
  const mode = document.querySelector('input[name="statsType"]:checked').value; 
  
  let targetMonthsToFetch = []; 
  let filterStartDate = null;
  let filterEndDate = null;
  let displayTitle = "";

  if (mode === 'daily') {
    const dateStr = document.getElementById('statsDateInput').value; 
    if(!dateStr) return;
    const d = new Date(dateStr);
    filterStartDate = d;
    filterEndDate = d;
    targetMonthsToFetch.push({ year: d.getFullYear().toString(), month: (d.getMonth()+1).toString() });
    displayTitle = `${d.getMonth()+1}월 ${d.getDate()}일 통계`;

  } else if (mode === 'monthly') {
    const monthStr = document.getElementById('statsMonthInput').value; 
    if(!monthStr) return;
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

    let curr = new Date(filterStartDate.getFullYear(), filterStartDate.getMonth(), 1);
    const endLimit = new Date(filterEndDate.getFullYear(), filterEndDate.getMonth(), 1);
    while(curr <= endLimit) {
        targetMonthsToFetch.push({ year: curr.getFullYear().toString(), month: (curr.getMonth()+1).toString() });
        curr.setMonth(curr.getMonth() + 1);
    }
  }
  
  window.currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };
  let fullDayAbsentCounts = { '1': 0, '2': 0, '3': 0 }; 
  let isAllConfirmed = true; 
  
  try {
    const results = [];
    const promises = targetMonthsToFetch.map(async (tm) => {
        const path = `attendance/${tm.year}/${tm.month}`;
        const snapshot = await get(child(ref(db), path));
        if(!snapshot.exists()) return [];
        const monthData = snapshot.val();
        const monthResults = [];
        const weeks = Object.keys(monthData);
        targetClassKeys.forEach(classKey => {
            weeks.forEach(w => {
                const val = (monthData[w] && monthData[w][classKey]) ? monthData[w][classKey] : null;
                if(val) monthResults.push({ year: tm.year, month: tm.month, week: w, classKey, val });
            });
        });
        return monthResults;
    });

    const nestedResults = await Promise.all(promises);
    nestedResults.forEach(arr => results.push(...arr));

    const aggregated = {}; 
    const finalClassSet = new Set();
    const confirmedClassSet = new Set();

    // 1. 반별 확정 여부 및 총원 계산
    results.forEach(res => {
         if (!res.val) return;

         if (mode === 'daily') {
             const dayStr = filterStartDate.getDate().toString();
             // 해당 날짜(dayStr)의 확정 여부가 true인지 확인
             if (res.val.confirmations && res.val.confirmations[dayStr]) {
                 confirmedClassSet.add(res.classKey);
             }
         }

         if (!finalClassSet.has(res.classKey) && res.val.students) {
            const grade = res.classKey.split('-')[0];
            window.currentStatsTotalCounts[grade] += res.val.students.length;
            finalClassSet.add(res.classKey);
         }
    });

    if (mode === 'daily' && isAllClassesSelected) {
        const allTargetConfirmed = targetClassKeys.every(key => confirmedClassSet.has(key));
        if (!allTargetConfirmed) isAllConfirmed = false;
    } else {
        isAllConfirmed = false;
    }

    // 2. 학생별 상세 내역 및 전일 결석 집계
    results.forEach(res => {
      if (!res.val || !res.val.students) return;
      
      const classKey = res.classKey;
      const grade = classKey.split('-')[0];
      const students = res.val.students;

      if (!aggregated[classKey]) aggregated[classKey] = {};

      students.forEach(s => {
        if (!s.attendance) return;
        
        // 날짜 필터링 된 유효 기록(결석 등 값이 있는 것)
        let validRecords = s.attendance.filter(a => a.value && a.value.trim() !== "");
        
        if (mode === 'daily' || mode === 'period') {
            validRecords = validRecords.filter(a => {
                const rYear = parseInt(res.year);
                const rMonth = parseInt(res.month);
                const rDay = parseInt(a.day);
                const rDate = new Date(rYear, rMonth - 1, rDay);
                const fStart = new Date(filterStartDate); fStart.setHours(0,0,0,0);
                const fEnd = new Date(filterEndDate); fEnd.setHours(0,0,0,0);
                return rDate >= fStart && rDate <= fEnd;
            });
        }

        if (validRecords.length > 0) {
          // [수정된 로직] 일별 조회 시: (결과처리 된 교시 수) === (그 날의 총 교시 수) 인 경우만 전일 결석
          if (mode === 'daily') {
             const targetDay = filterStartDate.getDate();
             
             // 해당 날짜에 해당하는 모든 데이터(빈 값 포함)를 가져와서 총 교시 수 계산
             const allDailySlots = s.attendance.filter(a => parseInt(a.day) === targetDay);
             const totalPeriodsCount = allDailySlots.length; // 예: 7교시 날이면 7, 4교시 날이면 4

             // validRecords는 이미 '값이 있는 것'만 필터링 된 상태임.
             // 따라서 (값이 있는 교시 수 === 총 교시 수) 이면 모든 교시가 결석 처리된 것임.
             if (totalPeriodsCount > 0 && validRecords.length === totalPeriodsCount) {
                 // 중복 집계 방지: 한 학생이 여러 week 데이터에 걸쳐 있을 확률은 낮으나 방어 코드
                 // aggregated에 아직 이 학생이 처리되지 않았으면 카운트 (루프 순서상 여기서는 항상 처음 진입)
                 if (!aggregated[classKey][s.no]) {
                    fullDayAbsentCounts[grade]++;
                 }
             }
          }

          if (!aggregated[classKey][s.no]) {
            aggregated[classKey][s.no] = { name: s.name, records: [] };
          }
          const recordsWithMeta = validRecords.map(r => ({
              ...r,
              _fullDateStr: `${res.month}월 ${r.day}일`
          }));
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

// [수정] 통계 요약 함수 (출석생/총원 표시)
function calculateDailySummary(fullDayAbsentCounts) {
  if (!window.currentStatsTotalCounts) return "";

  const totals = window.currentStatsTotalCounts;
  
  // 출석생 = 총원 - 전일 결과처리자(하루 모든 교시 결석)
  const present1 = (totals['1'] || 0) - (fullDayAbsentCounts['1'] || 0);
  const present2 = (totals['2'] || 0) - (fullDayAbsentCounts['2'] || 0);
  const present3 = (totals['3'] || 0) - (fullDayAbsentCounts['3'] || 0);

  const allTotal = (totals['1']||0) + (totals['2']||0) + (totals['3']||0);
  const allPresent = present1 + present2 + present3;

  // 전체 학생수가 0이면 표시 안함
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

// [수정] 결과 렌더링 (파라미터 추가 및 조건부 요약 표시)
function renderStatsResult(aggregatedData, sortedClassKeys, mode, displayTitle, isAllConfirmed, fullDayAbsentCounts) {
  const container = document.getElementById('statsContainer');
  let html = "";
  
  html += `<div style="text-align:center; margin-bottom:15px; font-weight:bold; color:#555;">[ ${displayTitle} ]</div>`;

  // [수정] 일별 모드 + 모든 반 확정일 때만 요약표 표시
  if (mode === 'daily' && isAllConfirmed) {
      const summary = calculateDailySummary(fullDayAbsentCounts);
      if(summary) html += summary;
  } else if (mode === 'daily') {
      // 조건 불충족 시 안내 메시지 (필요 시 주석 해제)
      // html += `<div style="text-align:center; font-size:12px; color:#999; margin-bottom:10px;">* 전체 반 출석 마감 시 요약표가 표시됩니다.</div>`;
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

function getStudentSummaryText(records) {
  const dateGroups = {};
  records.forEach(r => {
    const key = r._fullDateStr || `${r.day}일`;
    if(!dateGroups[key]) dateGroups[key] = [];
    dateGroups[key].push(r);
  });

  let lines = [];
  const dateKeys = Object.keys(dateGroups); 

  dateKeys.forEach(dateStr => {
    const list = dateGroups[dateStr];
    const isFullDay = (list.length >= 6); 
    const firstVal = list[0].value;
    const isAllSame = list.every(x => x.value === firstVal);

    let text = `<b>${dateStr}</b>: `;
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

// [수정] 저장 실행 (확정 데이터 저장 및 더미 키 처리)
async function executeSave() {
  document.getElementById('confirmModal').classList.remove('show');
  const keys = Object.keys(pendingChanges);
  
  // 변경사항이 없어도 pendingChanges에 키가 있으면 실행됨
  // (확정 토글만 한 경우에도 키가 있음)
  if (keys.length === 0 && !pendingNavigation) return;

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
    // 확정 키는 데이터 자체(currentTableData.confirmations)에 이미 반영됨
    if (key.startsWith('CONFIRM-')) return; 

    const [r, c] = key.split('-'); 
    const val = pendingChanges[key];
    const student = currentTableData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) att.value = val;
    }
  });

  // 백업 로직: 확정 키는 제외하고 실제 출결 변경사항만 백업
  const backupPayload = keys
    .filter(key => !key.startsWith('CONFIRM-'))
    .map(key => {
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
        if (key.startsWith('CONFIRM-')) return;
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

// [신규] 날짜 확정 토글 함수
function toggleDateConfirmation(day) {
  if (!window.currentRenderedData) return;
  
  if (!window.currentRenderedData.confirmations) {
    window.currentRenderedData.confirmations = {};
  }
  
  const currentStatus = window.currentRenderedData.confirmations[day] || false;
  const newStatus = !currentStatus; // 상태 반전
  
  window.currentRenderedData.confirmations[day] = newStatus;
  
  // UI 즉시 업데이트
  const header = document.getElementById(`date-header-day-${day}`);
  if (header) {
    const originalText = header.getAttribute('data-original-text');
    header.innerText = originalText + (newStatus ? "(확정)" : "");
    if (newStatus) header.classList.add('confirmed-header');
    else header.classList.remove('confirmed-header');
  }
  
  const cells = document.querySelectorAll(`td[data-date-day="${day}"]`);
  cells.forEach(cell => {
    if (newStatus) cell.classList.add('confirmed-col');
    else cell.classList.remove('confirmed-col');
  });

  // 변경사항이 생겼으므로 저장 버튼 활성화 (가짜 키 사용)
  pendingChanges[`CONFIRM-${day}`] = newStatus; 
  updateSaveButtonUI();
}

// [수정] 테이블 렌더링 (확정 기능 반영)
function renderTable(data) {
  window.currentRenderedData = data;
  if (!data.confirmations) data.confirmations = {};

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
      currentDay = att.day; 
      const info = dayMap[currentDay]; 
      const dayOfWeek = getDayOfWeek(year, data.meta.month, currentDay);
      
      const isConfirmed = data.confirmations[currentDay] === true;
      const confirmText = isConfirmed ? "(확정)" : "";
      const confirmClass = isConfirmed ? "confirmed-header" : "";
      const label = `${data.meta.month}월 ${currentDay}일 (${dayOfWeek})`;

      info.headerId = `date-header-day-${currentDay}`;
      
      html += `<th id="${info.headerId}" colspan="${info.count}" 
                class="header-day ${info.colorClass} ${confirmClass}" 
                data-original-text="${label}"
                style="cursor:pointer;"
                onclick="toggleDateConfirmation('${currentDay}')">
                ${label}${confirmText}
               </th>`;
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
        
        const isConfirmed = data.confirmations[att.day] === true;
        const confirmedClass = isConfirmed ? "confirmed-col" : "";

        html += `<td class="check-cell ${colorClass} ${confirmedClass}" 
                 data-row="${std.rowNumber}" 
                 data-col="${att.colIndex}" 
                 data-date-day="${att.day}"
                 data-date-header-id="${dateHeaderId}"> ${displayHtml} </td>`;
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

// [수정] 다중 선택 시작 (확정된 셀 보호)
function startMultiSelect(cell) { 
  if (cell.classList.contains('confirmed-col')) return; // 추가

  isMultiMode=true; 
  clearHeaderHighlights(); 
  selectedCells.clear(); 
  const hasData = cell.querySelector('.mark-symbol') !== null;
  dragStartAction = hasData ? 'clear' : 'fill'; 
  addToSelection(cell); 
}

// [수정] 선택 추가 (확정된 셀 제외)
function addToSelection(cell) { 
  if (cell.classList.contains('confirmed-col')) return; // 추가
  if(!selectedCells.has(cell)){selectedCells.add(cell); cell.classList.add('multi-selecting'); highlightHeaders(cell);} 
}

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

// [수정] 단일 선택 (확정된 셀 보호)
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
