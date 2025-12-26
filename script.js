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
let currentSelectedClass = null; // "1-1" 등
let currentActiveDate = new Date(); // 현재 보고 있는 날짜

// [통계] 전체 학생 수 저장 변수
let currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };

// [캐시] 현재 로드된 월의 데이터 (불필요한 네트워크 요청 방지)
let loadedMonthData = null; 
let loadedMonthKey = ""; // "2025-12" 형태

document.addEventListener('DOMContentLoaded', () => {
  window.onSaveBtnClick = onSaveBtnClick;
  window.getPendingCount = () => Object.keys(pendingChanges).length;
  window.loadStudents = loadStudents;
  window.saveState = saveState;
  window.toggleReasonInput = toggleReasonInput;
  window.hideConfirmModal = hideConfirmModal;
  window.executeSave = executeSave;
  window.closeStudentModal = closeStudentModal;

  // 날짜 변경 리스너
  const dateInput = document.getElementById('dateInput');
  dateInput.addEventListener('change', (e) => {
    const newDate = new Date(e.target.value);
    
    const runChange = () => {
      currentActiveDate = newDate;
      updateDateLabel(newDate);
      loadStudents();
      saveState();
    };

    if (Object.keys(pendingChanges).length > 0) {
      pendingNavigation = runChange;
      showConfirmModal();
      // 날짜 선택기를 원래대로 돌려놓기 위해 리로드 필요할 수 있으나 UI상 단순 표기라 생략
    } else {
      runChange();
    }
  });

  // 날짜 라벨 클릭 시 날짜 선택기 열기
  const dateLabel = document.getElementById('dateDisplayLabel');
  dateLabel.addEventListener('click', () => {
    dateInput.showPicker(); // 브라우저 네이티브 피커
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
  
  // 오늘 날짜로 초기화
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  dateInput.value = `${yyyy}-${mm}-${dd}`;
  updateDateLabel(today);
});

function updateDateLabel(date) {
  const mm = date.getMonth() + 1;
  const dd = date.getDate();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dayStr = days[date.getDay()];
  // [요청] [12-29 📅] 형태
  const label = document.getElementById('dateDisplayLabel');
  // 월, 일 2자리 맞춤 (선택사항, 요청은 12-29)
  const padMM = String(mm).padStart(2, '0');
  const padDD = String(dd).padStart(2, '0');
  label.innerText = `${padMM}-${padDD} 📅`;
}

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
    } else {
      console.log("메타데이터 없음");
    }
  } catch (error) {
    console.error("데이터 로드 실패:", error);
  }
}

// [수정] 홈 화면 반 버튼 (월 단위 확정 로직으로 변경 필요하나, 일별 확정은 데이터 구조상 복잡하여 단순화)
async function renderHomeScreenClassButtons() {
  const container = document.getElementById('classButtonContainer');
  container.innerHTML = "<div style='grid-column:1/-1; text-align:center; color:#888;'>출결 현황 확인 중...</div>";
  
  const year = CURRENT_YEAR;
  if (!globalData[year]) {
    container.innerHTML = `<div style="grid-column:1/-1; text-align:center;">${year}년 데이터 없음</div>`;
    return;
  }

  container.innerHTML = "";
  const info = globalData[year];
  const existingGrades = (info.grades || []).map(String);
  const existingClasses = (info.classes || []).map(String);

  // 학년/반 렌더링 (단순화: 미확정/확정 색상 로직은 일별 단위에서 전체 조회 부하가 크므로, 기본 색상으로 우선 표시)
  // *고도화 시: 오늘 날짜 데이터만 미리 fetch해서 색상 적용 가능
  
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
        btn.className = 'class-btn grade-1'; // 기본 색상 (노랑 등)
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
  
  // 현재 설정된 날짜가 있으면 그 날짜로, 없으면 오늘로
  if(!currentActiveDate) currentActiveDate = new Date();
  
  history.pushState({ mode: 'attendance' }, '', '');
  switchView('attendanceScreen');
  loadStudents();
}

// 통계 모드 진입
function enterStatsMode() {
  history.pushState({ mode: 'stats' }, '', '');
  switchView('statsScreen');
  
  document.getElementById('btnSearchStats').onclick = runStatsSearch;
  
  // 날짜 초기화
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  
  document.getElementById('statsDateInput').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('statsMonthInput').value = `${yyyy}-${mm}`;

  const radios = document.getElementsByName('statsType');
  radios.forEach(r => r.addEventListener('change', () => {
    if(r.value === 'daily') {
      document.getElementById('statsDateInput').style.display = 'block';
      document.getElementById('statsMonthInput').style.display = 'none';
    } else {
      document.getElementById('statsDateInput').style.display = 'none';
      document.getElementById('statsMonthInput').style.display = 'block';
    }
  }));

  renderStatsFilters();
}

function renderStatsFilters() {
  const container = document.getElementById('statsFilterContainer');
  container.innerHTML = "";
  
  // 전체 선택 체크박스
  const allWrapper = document.createElement('label');
  allWrapper.className = 'filter-tag';
  allWrapper.innerHTML = `<input type="checkbox" id="chkAll" checked><span>전체</span>`;
  container.appendChild(allWrapper);

  const year = CURRENT_YEAR;
  if(globalData[year]) {
    const grades = globalData[year].grades || [];
    const classes = globalData[year].classes || [];
    grades.forEach(g => {
      classes.forEach(c => {
        const label = document.createElement('label');
        label.className = 'filter-tag';
        const val = `${g}-${c}`;
        label.innerHTML = `<input type="checkbox" name="classFilter" value="${val}" checked><span>${val}</span>`;
        container.appendChild(label);
      });
    });
  }
  
  const chkAll = document.getElementById('chkAll');
  const chkClasses = document.getElementsByName('classFilter');
  chkAll.addEventListener('change', (e) => chkClasses.forEach(cb => cb.checked = e.target.checked));
}

// [수정] 통계 조회 (월 단위 구조 반영)
async function runStatsSearch() {
  const container = document.getElementById('statsContainer');
  container.innerHTML = '분석 중...';
  
  const selectedCheckboxes = document.querySelectorAll('input[name="classFilter"]:checked');
  if (selectedCheckboxes.length === 0) { container.innerHTML = '선택된 반이 없습니다.'; return; }
  
  const targetClassKeys = Array.from(selectedCheckboxes).map(cb => cb.value);
  const mode = document.querySelector('input[name="statsType"]:checked').value;
  
  let targetYear = CURRENT_YEAR;
  let targetMonth = "";
  let targetDay = -1;
  
  if (mode === 'daily') {
    const dVal = document.getElementById('statsDateInput').value;
    const d = new Date(dVal);
    targetYear = d.getFullYear().toString();
    targetMonth = (d.getMonth()+1).toString();
    targetDay = d.getDate();
  } else {
    const mVal = document.getElementById('statsMonthInput').value;
    const parts = mVal.split('-');
    targetYear = parts[0];
    targetMonth = parseInt(parts[1]).toString();
  }

  window.currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };
  
  // 데이터 페치 (해당 월 전체)
  const promises = targetClassKeys.map(async key => {
    // attendance/2025/12/1-1
    const path = `attendance/${targetYear}/${targetMonth}/${key}`;
    const snapshot = await get(child(ref(db), path));
    return { key, val: snapshot.val() };
  });

  const results = await Promise.all(promises);
  let html = `<div style="text-align:center; font-weight:bold; margin-bottom:15px;">
              [${targetMonth}월 ${mode === 'daily' ? targetDay + '일' : '전체'} 통계]</div>`;

  results.forEach(res => {
    if(!res.val || !res.val.students) return;
    const grade = res.key.split('-')[0];
    window.currentStatsTotalCounts[grade] += res.val.students.length;
    
    // 학생별 결석 체크
    let classHtml = "";
    let hasClassEvent = false;

    res.val.students.forEach(s => {
      if(!s.attendance) return;
      
      // 조건에 맞는 기록 필터링
      const events = s.attendance.filter(a => {
        if(mode === 'daily') return a.day == targetDay && a.value;
        else return a.value; // 월별은 모든 값
      });

      if(events.length > 0) {
        hasClassEvent = true;
        // 요약 텍스트 생성
        let summary = "";
        if(mode === 'daily') {
          const values = events.map(e => `${e.period}교시(${e.value})`).join(', ');
          summary = values;
        } else {
          // 월별: 날짜별 그룹핑
          const dayMap = {};
          events.forEach(e => {
            if(!dayMap[e.day]) dayMap[e.day] = [];
            dayMap[e.day].push(e);
          });
          summary = Object.keys(dayMap).map(d => `${d}일(${dayMap[d].length}건)`).join(', ');
        }
        
        classHtml += `<div class="stats-student-row">
          <div class="stats-student-name">${s.no}번 ${s.name}</div>
          <div class="stats-detail">${summary}</div>
        </div>`;
      }
    });

    if(hasClassEvent) {
      html += `<div class="stats-class-block"><div class="stats-class-header">${res.key}반</div>${classHtml}</div>`;
    }
  });

  if(html.indexOf("stats-class-block") === -1) {
    html += "<div style='text-align:center; padding:30px; color:#999;'>특이사항 없음</div>";
  }

  container.innerHTML = html;
}


// [핵심] 출석부 데이터 로드 (월 단위 전체 로드 -> 일 단위 필터링)
async function loadStudents() {
  pendingChanges = {};
  updateSaveButtonUI();
  
  const year = CURRENT_YEAR;
  const month = (currentActiveDate.getMonth() + 1).toString();
  const day = currentActiveDate.getDate(); // 숫자형
  const combinedVal = currentSelectedClass; 

  if (!year || !month || !combinedVal) return;

  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  document.getElementById('loading').style.display = 'inline';
  const container = document.getElementById('tableContainer');
  
  // 캐싱 키 확인
  const cacheKey = `${year}-${month}-${combinedVal}`;
  
  let data = null;

  // 같은 반, 같은 월이면 네트워크 요청 스킵
  if (loadedMonthKey === cacheKey && loadedMonthData) {
    data = loadedMonthData;
  } else {
    // Firebase: attendance/2025/12/1-1
    const path = `attendance/${year}/${month}/${grade}-${cls}`;
    try {
      const snapshot = await get(child(ref(db), path));
      if (snapshot.exists()) {
        data = snapshot.val();
        loadedMonthData = data;
        loadedMonthKey = cacheKey;
      } else {
        container.innerHTML = '<div style="padding:20px; text-align:center;">데이터 없음</div>';
        document.getElementById('loading').style.display = 'none';
        return;
      }
    } catch (error) {
      console.error(error);
      container.innerHTML = '데이터 로드 실패';
      document.getElementById('loading').style.display = 'none';
      return;
    }
  }

  renderTableDaily(data, day);
}

// [신규] 일일 테이블 렌더링
function renderTableDaily(data, targetDay) {
  const container = document.getElementById('tableContainer');
  document.getElementById('loading').style.display = 'none';

  if (!data || !data.students) {
    container.innerHTML = "데이터 오류";
    return;
  }

  // 1. 해당 날짜(targetDay)에 해당하는 교시(Period) 목록 추출
  // 모든 학생을 스캔하여 해당 날짜에 존재하는 최대 교시를 찾음
  let periods = new Set();
  
  data.students.forEach(s => {
    if(s.attendance) {
      s.attendance.forEach(a => {
        if(a.day == targetDay) periods.add(a.period);
      });
    }
  });

  const sortedPeriods = Array.from(periods).sort((a,b) => {
    // 교시가 숫자면 숫자 정렬, 아니면 문자 정렬
    const na = parseInt(a);
    const nb = parseInt(b);
    if(!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.toString().localeCompare(b.toString());
  });

  if (sortedPeriods.length === 0) {
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#888;">
      ${targetDay}일은 수업이 없는 날이거나<br>데이터가 없습니다.
    </div>`;
    return;
  }

  let html = '<table><thead><tr>';
  html += '<th class="col-no">번호</th><th class="col-name">이름</th>';
  
  // 교시 헤더
  sortedPeriods.forEach((p, idx) => {
    const bgClass = (idx % 2 === 0) ? 'bg-period-1' : 'bg-period-2';
    html += `<th class="${bgClass}">${p}교시</th>`;
  });
  
  html += '</tr></thead><tbody>';

  data.students.forEach(std => {
    html += '<tr>';
    html += `<td>${std.no}</td>`;
    html += `<td class="col-name" onclick="showStudentSummary('${std.no}', '${std.name}')">${std.name}</td>`;
    
    // 학생의 해당 날짜 출결 맵핑
    const todayAtt = {};
    if(std.attendance) {
      std.attendance.forEach(a => {
        if(a.day == targetDay) todayAtt[a.period] = a;
      });
    }

    sortedPeriods.forEach((p, idx) => {
      const att = todayAtt[p];
      const val = att ? att.value : "";
      const bgClass = (idx % 2 === 0) ? 'bg-period-1' : 'bg-period-2';
      
      // DB 경로(path) 저장을 위해 row/col 인덱스 필요
      // 하지만 Firebase 구조가 변경되어(월 단위), 업데이트 시에는 학생 배열 인덱스와 attendance 배열 인덱스를 찾아야 함.
      // 편의상 data-key 로 직접 식별자를 심어둠 (stdNo-period)
      // *주의*: 기존 로직(row/col 인덱스 기반)을 유지하려면 att.colIndex가 있어야 함.
      // 구글 시트의 colIndex를 그대로 사용하므로 att.colIndex 사용 가능.
      
      const colIndex = att ? att.colIndex : -1;
      
      html += `<td class="check-cell ${bgClass}" 
               data-std-row="${std.rowNumber}" 
               data-col-idx="${colIndex}"
               data-val="${val}">
               ${formatValueToHtml(val)}
               </td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';

  container.innerHTML = html;
  
  // 저장 버튼 텍스트 복구
  updateSaveButtonUI();
  
  // 드래그/터치 리스너 다시 등록
  addDragListeners();
}

function formatValueToHtml(val) {
  if (!val) return "";
  const match = val.toString().match(/^([^(\s]+)\s*\((.+)\)$/);
  if (match) return `<span class="mark-symbol">${match[1]}</span><span class="mark-note">(${match[2]})</span>`;
  return `<span class="mark-symbol">${val}</span>`;
}

// [수정] 저장 로직
async function executeSave() {
  document.getElementById('confirmModal').classList.remove('show');
  
  const keys = Object.keys(pendingChanges); // 키 형식: "rowNumber-colIndex"
  if (keys.length === 0 && !pendingNavigation) return;

  const year = CURRENT_YEAR;
  const month = (currentActiveDate.getMonth() + 1).toString();
  const combinedVal = currentSelectedClass; 
  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  // 로컬 메모리 데이터 업데이트 (loadedMonthData)
  keys.forEach(key => {
    const [row, col] = key.split('-');
    const val = pendingChanges[key];
    
    // loadedMonthData에서 해당 학생 찾아서 업데이트
    const student = loadedMonthData.students.find(s => s.rowNumber == row);
    if(student) {
      const att = student.attendance.find(a => a.colIndex == col);
      if(att) att.value = val;
    }
  });

  // 백업용 (옵션)
  const backupPayload = keys.map(key => {
    const [r, c] = key.split('-');
    return { year: year, row: r, col: c, value: pendingChanges[key] };
  });

  // Firebase 저장 (통째로 업데이트)
  // *최적화*: 전체를 덮어쓰는게 안전함 (구조상)
  const path = `attendance/${year}/${month}/${grade}-${cls}`;
  const updateRef = ref(db, path);

  try {
    await update(updateRef, loadedMonthData);
    
    // UI 업데이트
    keys.forEach(key => {
       const [r, c] = key.split('-');
       const cell = document.querySelector(`.check-cell[data-std-row="${r}"][data-col-idx="${c}"]`);
       if(cell) cell.classList.remove('unsaved-cell');
    });

    showToast("저장 완료");

    // 구글 시트 백업 (비동기)
    if (backupPayload.length > 0) {
        fetch(APPS_SCRIPT_URL, { 
            method: "POST", 
            body: JSON.stringify({ action: "saveAttendanceBatch", data: backupPayload }) 
        }).catch(e => console.log("시트 백업 실패(무시)", e));
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

function showToast(message) { 
  const t = document.getElementById("toast-container"); 
  t.textContent = message; t.className = "show"; 
  setTimeout(()=>{t.className = t.className.replace("show", "");}, 3000); 
}
function showConfirmModal() { document.getElementById('confirmModal').classList.add('show'); }
function hideConfirmModal() { 
  document.getElementById('confirmModal').classList.remove('show'); 
  pendingNavigation = null;
}

function saveState() {
  // 상태 저장 로직 (필요 시 구현)
}

function toggleReasonInput() {
  const radios = document.getElementsByName('attType');
  let selected = ""; 
  for (const r of radios) if (r.checked) selected = r.value;
  
  const input = document.getElementById('reasonInput');
  input.value = "";  
  if (selected === "△" || selected === "○") input.disabled = false; 
  else { input.disabled = true; input.value = ""; }
}

// ==========================================
// [이벤트 핸들러] 드래그 & 터치 (기존 로직 유지/수정)
// ==========================================
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

function onSaveBtnClick() { if (Object.keys(pendingChanges).length > 0) showConfirmModal(); }

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

function onMouseDown(e) { 
  if (Date.now() - lastTouchTime < 1000) return; 
  const cell = e.currentTarget;
  if (e.button === 0) { processSingleCell(cell); return; } // 좌클릭
  if (e.button === 2) { startMultiSelect(cell); } // 우클릭
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
    if(target){ const c=target.closest('.check-cell'); if(c) addToSelection(c); }
  }
}
function onTouchEnd(e) { 
  lastTouchTime = Date.now(); 
  if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;} 
  if(isMultiMode) finishMultiSelect(); 
}

function startMultiSelect(cell) { 
  isMultiMode=true; 
  selectedCells.clear(); 
  const hasData = cell.getAttribute('data-val') && cell.getAttribute('data-val') !== "";
  dragStartAction = hasData ? 'clear' : 'fill'; 
  addToSelection(cell); 
}
function addToSelection(cell) { 
  if(!selectedCells.has(cell)){ selectedCells.add(cell); cell.classList.add('multi-selecting'); } 
}
function finishMultiSelect() { 
  isMultiMode=false; 
  let val=""; 
  if(dragStartAction==='fill'){
    const s = document.querySelector('input[name="attType"]:checked').value; 
    const r = document.getElementById('reasonInput').value.trim(); 
    if(s!==""){ val=s; if((s==="△"||s==="○")&&r!=="") val=`${s}(${r})`; }
  } 
  selectedCells.forEach(c=>{ c.classList.remove('multi-selecting'); queueUpdate(c, val); }); 
  selectedCells.clear(); 
}

function processSingleCell(cell) { 
  if(isMultiMode) return; 
  const hasData = cell.getAttribute('data-val') && cell.getAttribute('data-val') !== "";
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

function queueUpdate(cell, newValue) {
  // 시각적 업데이트
  cell.innerHTML = formatValueToHtml(newValue);
  cell.setAttribute('data-val', newValue);
  
  cell.classList.remove('flash-success'); void cell.offsetWidth; cell.classList.add('flash-success');
  
  const r = cell.getAttribute('data-std-row'); 
  const c = cell.getAttribute('data-col-idx');
  const key = `${r}-${c}`;
  
  // 변경사항 큐에 추가
  // 원래 값과 같으면 삭제 로직을 넣을 수 있으나, 월별 데이터 원본 비교가 번거로우므로 우선 변경 시 무조건 저장 대상
  pendingChanges[key] = newValue;
  cell.classList.add('unsaved-cell');
  updateSaveButtonUI();
}

window.showStudentSummary = function(studentNo, studentName) {
  alert(`${studentName} 학생 상세 정보는 준비 중입니다.`);
};

// 학생 상세 모달 닫기
function closeStudentModal() {
  document.getElementById('studentModal').classList.remove('show');
}
