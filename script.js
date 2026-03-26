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
let currentSmsUri = ""; 

// [유틸리티: 학년도 계산 통합]
function getSchoolYear(dateObj) {
    const m = dateObj.getMonth() + 1;
    const y = dateObj.getFullYear();
    // 1월, 2월은 작년 학년도로 취급
    return (m <= 2) ? (y - 1).toString() : y.toString();
}

// [유틸리티: 학년도+월 -> 실제 연도 계산]
function getRealYear(schoolYear, month) {
    const m = parseInt(month);
    const y = parseInt(schoolYear);
    return (m <= 2) ? y + 1 : y;
}

const CURRENT_YEAR = getSchoolYear(new Date());

// [상태 변수 그룹화]
const state = {
    activeDate: new Date(),
    currentSelectedClass: null,
    isMultiMode: false,
    selectedCells: new Set(),
    dragStartAction: null,
    longPressTimer: null,
    dragStartCell: null,
    pendingChanges: {},
    lastTouchTime: 0,
    pendingNavigation: null,
    currentRenderedData: null,
    currentStatsTotalCounts: { '1': 0, '2': 0, '3': 0 },
    // Flatpickr 인스턴스
    pickers: {
        main: null,
        statsDate: null,
        statsMonth: null,
        statsStart: null,
        statsEnd: null
    }
};

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

  // [수정됨] 위치 토글 및 실행 함수
  window.toggleLocationMode = () => {
      const container = document.getElementById('contactBtnContainer');
      if(container) {
          // 클래스 토글로 CSS 애니메이션 트리거
          container.classList.toggle('options-active');
      }
  };

  window.execLocationRequest = () => {
      if(currentSmsUri) window.location.href = currentSmsUri;
      // 실행 후 원래대로 복귀하고 싶다면 아래 주석 해제
      // toggleLocationMode(); 
  };
  
  window.execLocationCheck = () => {
      window.open("https://puroome.github.io/pin/check/", "_blank");
      // 실행 후 원래대로 복귀하고 싶다면 아래 주석 해제
      // toggleLocationMode();
  };
  
  // ✅ Flatpickr 초기화
  setupDatePicker();
  
  // ✅ 드래그 가능한 플로팅 저장 버튼 생성
  createFloatingSaveButton();

  document.getElementById('modalCancelBtn').addEventListener('click', hideConfirmModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', executeSave);
  
  document.getElementById('messageModalBtn').addEventListener('click', () => {
    document.getElementById('messageModal').classList.remove('show');
  });

  const radios = document.getElementsByName('attType');
  radios.forEach(r => r.addEventListener('change', toggleReasonInput));

  document.addEventListener('contextmenu', event => event.preventDefault());
  
  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(state.pendingChanges).length > 0) {
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

// ✅ 드래그 가능한 플로팅 저장 버튼 생성 및 이벤트 연결
function createFloatingSaveButton() {
    const btn = document.createElement('div');
    btn.id = 'floatingSaveBtn';
    btn.className = 'floating-save-btn';
    btn.innerHTML = '저장'; 
    document.body.appendChild(btn);

    // 드래그 관련 변수
    let active = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;
    
    // 클릭 vs 드래그 구분용 변수
    let startClickX = 0;
    let startClickY = 0;

    // 터치 이벤트
    btn.addEventListener("touchstart", dragStart, false);
    btn.addEventListener("touchend", dragEnd, false);
    btn.addEventListener("touchmove", drag, false);

    // 마우스 이벤트 (PC 테스트용)
    btn.addEventListener("mousedown", dragStart, false);
    document.addEventListener("mouseup", dragEnd, false);
    document.addEventListener("mousemove", drag, false);

    function dragStart(e) {
      if (e.type === "touchstart") {
        initialX = e.touches[0].clientX - xOffset;
        initialY = e.touches[0].clientY - yOffset;
        startClickX = e.touches[0].clientX;
        startClickY = e.touches[0].clientY;
      } else {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        startClickX = e.clientX;
        startClickY = e.clientY;
      }

      if (e.target === btn) {
        active = true;
      }
    }

    function dragEnd(e) {
      initialX = currentX;
      initialY = currentY;
      active = false;
      
      // 드래그 거리가 짧으면(5px 미만) 클릭으로 간주하여 저장 실행
      let endClickX, endClickY;
      if (e.type === "touchend") {
          // touchend에는 clientX/Y가 없으므로 changedTouches 사용
          endClickX = e.changedTouches[0].clientX;
          endClickY = e.changedTouches[0].clientY;
      } else {
          endClickX = e.clientX;
          endClickY = e.clientY;
      }

      const dist = Math.hypot(endClickX - startClickX, endClickY - startClickY);
      if (dist < 5 && e.target === btn) {
          onSaveBtnClick();
      }
    }

    function drag(e) {
      if (active) {
        e.preventDefault();
      
        if (e.type === "touchmove") {
          currentX = e.touches[0].clientX - initialX;
          currentY = e.touches[0].clientY - initialY;
        } else {
          currentX = e.clientX - initialX;
          currentY = e.clientY - initialY;
        }

        xOffset = currentX;
        yOffset = currentY;

        setTranslate(currentX, currentY, btn);
      }
    }

    function setTranslate(xPos, yPos, el) {
      el.style.transform = "translate3d(" + xPos + "px, " + yPos + "px, 0)";
    }
}

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
  state.pickers.main = flatpickr("#mainDatePicker", {
      locale: "ko",
      dateFormat: "Y-m-d",
      disableMobile: true,
      maxDate: "today",
      positionElement: document.getElementById('btnDateTrigger'),
      
      onChange: function(selectedDates, dateStr, instance) {
          if (!dateStr) return;

          if (Object.keys(state.pendingChanges).length > 0) {
              showMessageModal("미저장 자료가 있습니다.\n먼저 저장하세요.");
              instance.setDate(state.activeDate); 
              updateDateLabel();
              return;
          }
          
          state.activeDate = new Date(dateStr);
          updateDateLabel();
          loadStudents();
      }
  });

  btnTrigger.addEventListener('click', () => {
    if (state.pickers.main) state.pickers.main.open();
  });
  
  updateDateLabel();
}

function getEnableDates() {
    const year = CURRENT_YEAR;
    if (!globalData[year] || !globalData[year].validDays) return [];

    const validDaysMap = globalData[year].validDays; 
    const enabledDates = [];

    Object.keys(validDaysMap).forEach(monthStr => {
        const days = validDaysMap[monthStr];
        const m = parseInt(monthStr);
        // [수정] getRealYear 사용으로 통일
        const y = getRealYear(year, m);

        days.forEach(d => {
            const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            enabledDates.push(dateStr);
        });
    });
    return enabledDates;
}

function getEnableMonths() {
    const year = CURRENT_YEAR;
    if (!globalData[year] || !globalData[year].validDays) return [];
    
    const validMonths = [];
    const keys = Object.keys(globalData[year].validDays);
    
    keys.forEach(monthStr => {
        const m = parseInt(monthStr);
        // [수정] getRealYear 사용으로 통일
        const y = getRealYear(year, m);
        
        validMonths.push(`${y}-${String(m).padStart(2,'0')}`);
    });
    return validMonths;
}

function updateFlatpickrAllowedDates() {
    const allowedDates = getEnableDates();
    const allowedMonths = getEnableMonths();

    // 1. 일별/기간 달력
    if (allowedDates.length > 0) {
        if (state.pickers.main) state.pickers.main.set('enable', allowedDates);
        if (state.pickers.statsDate) state.pickers.statsDate.set('enable', allowedDates);
        if (state.pickers.statsStart) state.pickers.statsStart.set('enable', allowedDates);
        if (state.pickers.statsEnd) state.pickers.statsEnd.set('enable', allowedDates);
    }

    // 2. 월별 달력
    if (state.pickers.statsMonth && allowedMonths.length > 0) {
        state.pickers.statsMonth.set('disable', [
            function(date) {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const ym = `${y}-${m}`;
                return !allowedMonths.includes(ym);
            }
        ]);
    }
}

function findMostRecentSchoolDay(startDate) {
    const limit = 60;
    let checkDate = new Date(startDate);
    
    for (let i = 0; i < limit; i++) {
        if (isValidSchoolDay(checkDate)) {
            return checkDate;
        }
        checkDate.setDate(checkDate.getDate() - 1);
    }
    return startDate; 
}

function getFirstSchoolDay() {
    const dates = getEnableDates();
    if (dates.length > 0) {
        dates.sort();
        return new Date(dates[0]);
    }
    return new Date(); 
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
  
  const yyyy = state.activeDate.getFullYear();
  const mm = String(state.activeDate.getMonth() + 1).padStart(2, '0');
  const dd = String(state.activeDate.getDate()).padStart(2, '0');
  
  if (state.pickers.main) {
      state.pickers.main.setDate(`${yyyy}-${mm}-${dd}`, false); 
  }
  
  label.innerText = `${mm}-${dd}`;
}

// =======================================================
// 화면 전환 및 홈 화면
// =======================================================
function goHome(fromHistory = false) {
  if (Object.keys(state.pendingChanges).length > 0) {
    showMessageModal("미저장 자료가 있습니다.\n먼저 저장하세요.");
    if(fromHistory) history.pushState({ view: 'sub' }, '', '');
    return;
  }
  
  state.pendingChanges = {};
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
      updateFlatpickrAllowedDates();
    }
  } catch (error) {
    console.error(error);
  }
}

async function renderHomeScreenClassButtons() {
  const container = document.getElementById('classButtonContainer');
  // [수정] 인라인 스타일 -> CSS 클래스
  container.innerHTML = "<div class='message-full text-gray'>출결 현황 확인 중...</div>";
  
  const year = CURRENT_YEAR;
  if (!globalData[year]) {
    container.innerHTML = `<div class='message-full'>${year}년 데이터 없음</div>`;
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
  state.currentSelectedClass = `${grade}-${cls}`;
  
  state.activeDate = findMostRecentSchoolDay(new Date());
  
  updateDateLabel();

  history.pushState({ mode: 'attendance' }, '', '');
  switchView('attendanceScreen');
  loadStudents();
}

async function loadStudents() {
  state.pendingChanges = {};
  updateSaveButtonUI(); 
  
  const year = CURRENT_YEAR;
  const month = (state.activeDate.getMonth() + 1).toString();
  const combinedVal = state.currentSelectedClass; 

  if (!combinedVal) return;

  const parts = combinedVal.split('-');
  const grade = parts[0];
  const cls = parts[1];

  const tableContainer = document.getElementById('tableContainer');
  tableContainer.innerHTML = ''; 
  
  // [수정] 스켈레톤 인라인 스타일 -> CSS 클래스 (width는 유지 필요할 수 있으나 가능하면 클래스로)
  // 여기서는 width가 레이아웃에 중요하므로 인라인 유지 혹은 별도 처리.
  // 다만 요청 사항에 "긴 style 문자열" 정리이므로, 구조적 스타일은 클래스로 뺄 수 있음.
  // 여기서는 간단히 유지하되, 반복되는 부분 최소화.
  const skeletonHTML = Array(10).fill(0).map(() => `
    <div class="skeleton-row">
      <div class="skeleton-box" style="width: 30px;"></div>
      <div class="skeleton-box" style="width: 60px;"></div>
      <div class="skeleton-box" style="flex:1;"></div>
    </div>
  `).join('');
  
  tableContainer.innerHTML = `<div style="padding:10px;">${skeletonHTML}</div>`;
  document.getElementById('loading').style.display = 'inline';
  
  const path = `attendance/${year}/${month}/${grade}-${cls}`;
  const dbRef = ref(db);

  try {
    const snapshot = await get(child(dbRef, path));
    if (snapshot.exists()) {
      state.currentRenderedData = snapshot.val();
      renderTable(state.currentRenderedData);
    } else {
      state.currentRenderedData = null;
      // [수정] 인라인 스타일 -> 클래스
      document.getElementById('tableContainer').innerHTML = '<div class="message-box">데이터 없음</div>';
    }
  } catch (error) {
    console.error(error);
    // [수정] 인라인 스타일 -> 클래스
    document.getElementById('tableContainer').innerHTML = '<div class="message-box text-red">로드 실패</div>';
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

function renderTable(data) {
  if (!data.confirmations) data.confirmations = {};
  
  const container = document.getElementById('tableContainer');
  
  if (!data || data.error) { 
    // [수정] 인라인 스타일 -> 클래스
    container.innerHTML = `<div class="message-box text-red">${data.error || '오류'}</div>`; 
    return; 
  }
  if (!data.students || data.students.length === 0) { 
    container.innerHTML = '<div class="message-box">학생 데이터가 없습니다.</div>'; 
    return; 
  }

  const targetDay = state.activeDate.getDate();
  const targetDayStr = targetDay.toString();
  
  const isConfirmed = data.confirmations[targetDayStr] === true;
  
  const sampleStudent = data.students[0];
  const dayRecords = sampleStudent.attendance.filter(a => a.day == targetDay);
  
  if (dayRecords.length === 0) {
    container.innerHTML = `<div class="message-box">${state.activeDate.getMonth()+1}월 ${targetDay}일 데이터가 없습니다.</div>`;
    return;
  }

  dayRecords.sort((a,b) => parseInt(a.period) - parseInt(b.period));
  
  const FIXED_WIDTH_NO = 30;   
  const FIXED_WIDTH_NAME = 55; 
  const MIN_CELL_WIDTH = 35;   

  const MAX_PERIODS = 7;
  const dataCount = dayRecords.length;
  const remainingCount = Math.max(0, MAX_PERIODS - dataCount);

  const minTableWidth = FIXED_WIDTH_NO + FIXED_WIDTH_NAME + (MAX_PERIODS * MIN_CELL_WIDTH);

  const htmlParts = [];
  
  // 동적 너비 계산은 인라인 스타일 유지가 필요함
  htmlParts.push(`<table style="min-width: ${minTableWidth}px;">`);
  htmlParts.push('<colgroup>');
  htmlParts.push(`<col style="width: ${FIXED_WIDTH_NO}px;">`);
  htmlParts.push(`<col style="width: ${FIXED_WIDTH_NAME}px;">`);
  
  for(let i = 0; i < MAX_PERIODS; i++) {
      htmlParts.push('<col>'); 
  }
  htmlParts.push('</colgroup>');

  htmlParts.push('<thead>');
  
  const dayOfWeek = getDayOfWeek(state.activeDate);
  const dateLabel = `${state.activeDate.getMonth()+1}/${targetDay}(${dayOfWeek})`;

  const checkedAttr = isConfirmed ? 'checked' : '';
  const headerClass = isConfirmed ? 'confirmed-header' : '';
  const statusText = isConfirmed ? '마감됨' : '마감하기';
  
  // [수정] 헤더 내용 div 인라인 스타일 -> 클래스
  htmlParts.push(`
    <tr>
      <th rowspan="2" class="col-no">번호</th>
      <th rowspan="2" class="col-name">이름</th>
      <th colspan="${MAX_PERIODS}" class="header-day ${headerClass}">
        <div class="header-day-content">
          <span>${dateLabel}</span>
          <label class="header-checkbox-label">
            <input type="checkbox" id="chkConfirmDay" ${checkedAttr} onchange="toggleDateConfirmation('${targetDayStr}')">
            <span class="header-checkbox-span">${statusText}</span>
          </label>
        </div>
      </th>
    </tr>
    <tr>
  `);
  
  dayRecords.forEach(r => {
    htmlParts.push(`<th>${r.period}</th>`);
  });
  
  if (remainingCount > 0) {
      htmlParts.push(`<th colspan="${remainingCount}" class="inactive-header"></th>`);
  }
  
  htmlParts.push('</tr></thead><tbody>');

  let renderedCount = 0;
data.students.forEach(std => {
    const todayRecords = std.attendance.filter(a => a.day === targetDay);
    if (todayRecords.length > 0 && todayRecords.every(a => a.value === 'n/a')) return;
    renderedCount++;
    htmlParts.push(`<tr>`);
    htmlParts.push(`<td>${std.no}</td>`);
    htmlParts.push(`<td class="col-name" onclick="showStudentSummary('${std.no}', '${std.name}')">${std.name}</td>`);
    
    dayRecords.forEach(headerRec => {
      const cellData = std.attendance.find(a => a.colIndex == headerRec.colIndex) || {};
      const val = cellData.value || "";
      const displayHtml = formatValueToHtml(val);
      
      const confirmedClass = isConfirmed ? "confirmed-col" : "";

      htmlParts.push(`<td class="check-cell ${confirmedClass}" 
               data-row="${std.rowNumber}" 
               data-col="${cellData.colIndex}" 
               data-day="${targetDay}"> ${displayHtml} </td>`);
    });

    if (remainingCount > 0) {
        htmlParts.push(`<td colspan="${remainingCount}" class="inactive-cell"></td>`);
    }

    htmlParts.push('</tr>');
  });
  htmlParts.push('</tbody></table>');
  
  const grade = state.currentSelectedClass.split('-')[0];
state.currentStatsTotalCounts[grade] = renderedCount;
container.innerHTML = htmlParts.join('');
updateSaveButtonUI();
addDragListeners();
addFocusListeners();

}

async function toggleDateConfirmation(dayStr) {
  if (Object.keys(state.pendingChanges).length > 0) {
      showMessageModal("미저장 자료가 있습니다.\n먼저 저장하세요.");
      const checkbox = document.getElementById('chkConfirmDay');
      checkbox.checked = !checkbox.checked;
      return;
  }

  if (!state.currentRenderedData) return;

  const checkbox = document.getElementById('chkConfirmDay');
  const newStatus = checkbox.checked;

  if (!state.currentRenderedData.confirmations) state.currentRenderedData.confirmations = {};
  state.currentRenderedData.confirmations[dayStr] = newStatus;

  const year = CURRENT_YEAR;
  const month = (state.activeDate.getMonth() + 1).toString();
  const [grade, cls] = state.currentSelectedClass.split('-');
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
  if (!state.currentRenderedData || !state.currentRenderedData.students) return;

  const year = CURRENT_YEAR;
  const day = state.activeDate.getDate();
  const batchData = [];
  
  state.currentRenderedData.students.forEach(std => {
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
  const keys = Object.keys(state.pendingChanges);
  if (keys.length === 0 && !state.pendingNavigation) return;

  const year = CURRENT_YEAR;
  const month = (state.activeDate.getMonth() + 1).toString();
  const [grade, cls] = state.currentSelectedClass.split('-');
  
  const dayStr = state.activeDate.getDate().toString();
  const isConfirmed = state.currentRenderedData.confirmations ? state.currentRenderedData.confirmations[dayStr] : false;

  keys.forEach(key => {
    const [r, c] = key.split('-');
    const val = state.pendingChanges[key];
    const student = state.currentRenderedData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) att.value = val;
    }
  });

  const path = `attendance/${year}/${month}/${grade}-${cls}`;
  try {
    await update(ref(db, path), state.currentRenderedData);
    
    keys.forEach(key => {
      const [r, c] = key.split('-');
      const cell = document.querySelector(`.check-cell[data-row="${r}"][data-col="${c}"]`);
      if (cell) cell.classList.remove('unsaved-cell');
    });

    showToast("저장완료");
    
    const backupPayload = keys.map(key => {
        const [r, c] = key.split('-');
        const val = state.pendingChanges[key];
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

    state.pendingChanges = {};
    updateSaveButtonUI();

    if (state.pendingNavigation) {
        state.pendingNavigation(); 
        state.pendingNavigation = null;
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
  state.pendingNavigation = null;
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
  if (state.currentRenderedData) {
    const student = state.currentRenderedData.students.find(s => s.rowNumber == r);
    if (student) {
      const att = student.attendance.find(a => a.colIndex == c);
      if (att) originalValue = att.value;
    }
  }

  if (newValue === originalValue) {
    delete state.pendingChanges[key];
    cell.classList.remove('unsaved-cell');
  } else {
    state.pendingChanges[key] = newValue;
    cell.classList.add('unsaved-cell');
  }

  updateSaveButtonUI();
}

function updateSaveButtonUI() {
  const count = Object.keys(state.pendingChanges).length;
  const fab = document.getElementById('floatingSaveBtn');
  
  if (count > 0) { 
      if(fab) {
          fab.classList.add('show');
          fab.innerHTML = `저장<br>(${count})`;
      }
  } else { 
      if(fab) {
          fab.classList.remove('show');
      }
  }
}

function onSaveBtnClick() { if (Object.keys(state.pendingChanges).length === 0) return; showConfirmModal(); }

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
    c.addEventListener('mouseenter', (e) => { if(!state.isMultiMode) highlightHeaders(e.currentTarget); }); 
    c.addEventListener('mouseleave', () => { if(!state.isMultiMode) clearHeaderHighlights(); }); 
  }); 
}

function highlightHeaders(cell) {}
function clearHeaderHighlights() {}

function onMouseDown(e) { 
  if (Date.now() - state.lastTouchTime < 1000) return; 
  const cell = e.currentTarget;
  if (e.button === 0) {
    processSingleCell(cell);
    return;
  }
  if (e.button === 2) {
    startMultiSelect(cell);
  }
}

function onMouseEnter(e) { if(state.isMultiMode) addToSelection(e.currentTarget); }
function onMouseUp() { if(state.isMultiMode) finishMultiSelect(); }

function onTouchStart(e) { 
  if(navigator.vibrate) navigator.vibrate(1);
  state.lastTouchTime = Date.now(); 
  const cell = e.currentTarget;
  state.dragStartCell = cell; 
  state.longPressTimer = setTimeout(() => { 
    if(navigator.vibrate) navigator.vibrate(50); 
    startMultiSelect(cell); 
  }, 300); 
}

function onTouchMove(e) { 
  if(state.longPressTimer && !state.isMultiMode){clearTimeout(state.longPressTimer);state.longPressTimer=null;} 
  if(state.isMultiMode){
    e.preventDefault(); 
    const t=e.touches[0]; 
    const target=document.elementFromPoint(t.clientX, t.clientY); 
    if(target){const c=target.closest('.check-cell'); if(c) addToSelection(c);}
  }
}

function onTouchEnd(e) { 
  state.lastTouchTime = Date.now(); 
  if(state.longPressTimer){clearTimeout(state.longPressTimer);state.longPressTimer=null;} 
  if(state.isMultiMode) finishMultiSelect(); 
}

function startMultiSelect(cell) { 
  if (cell.classList.contains('confirmed-col')) return; 
  state.isMultiMode=true; 
  state.selectedCells.clear(); 
  const hasData = cell.querySelector('.mark-symbol') !== null;
  state.dragStartAction = hasData ? 'clear' : 'fill'; 
  addToSelection(cell); 
}

function addToSelection(cell) { 
  if (cell.classList.contains('confirmed-col')) return;
  if(!state.selectedCells.has(cell)){state.selectedCells.add(cell); cell.classList.add('multi-selecting');} 
}

function finishMultiSelect() { 
  state.isMultiMode=false; 
  let val=""; 
  if(state.dragStartAction==='fill'){
    const s = document.querySelector('input[name="attType"]:checked').value; 
    const r = document.getElementById('reasonInput').value.trim(); 
    if(s!==""){
      val=s; 
      if((s==="△"||s==="○")&&r!=="") val=`${s}(${r})`;
    }
  } 
  state.selectedCells.forEach(c=>{c.classList.remove('multi-selecting'); queueUpdate(c, val);}); 
  state.selectedCells.clear(); 
}

function processSingleCell(cell) { 
  if(state.isMultiMode) return; 
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
  if (!state.currentRenderedData || !state.currentRenderedData.students) {
     alert("데이터가 로드되지 않았습니다.");
     return;
  }
  
  const student = state.currentRenderedData.students.find(s => s.no == studentNo);
  if (!student) {
     alert("학생 정보를 찾을 수 없습니다.");
     return;
  }

  const month = (state.activeDate.getMonth() + 1).toString();
  
  const titleEl = document.getElementById('studentModalTitle');
  // [수정] 인라인 스타일 -> CSS 클래스
  titleEl.innerHTML = `${studentName} <span class="student-modal-subtitle">(${studentNo}번)</span> <span class="student-modal-month">${month}</span>월 출결사항`;
  
  // 연락처 및 버튼 그룹 (토글 방식 적용)
  let contactHtml = "";
  const phone = student.phone ? student.phone.replace(/[^0-9]/g, '') : ""; 
  
  if (phone) {
    const shortName = studentName.length > 1 ? studentName.substring(1) : studentName;

    const lastChar = shortName.charCodeAt(shortName.length - 1);
    const hasBatchim = (lastChar - 0xAC00) % 28 > 0;
    const suffix = hasBatchim ? "아" : "야";

    const locationUrl = "https://puroome.github.io/pin/";
    const smsBody = `${shortName}${suffix}, 선생님이야. 아래에 접속후 이름적고 출석하기 클릭하면 돼.\n${locationUrl}`;
    const encodedBody = encodeURIComponent(smsBody);
    
    // [수정됨] 전역 변수에 URI 저장
    currentSmsUri = `sms:${phone}?body=${encodedBody}`;

    contactHtml = `
      <div id="contactBtnContainer" class="contact-container">
          <div class="contact-swap-area">
              <div class="btn-group-default">
                  <a href="tel:${phone}" class="contact-btn btn-pastel-blue">📞 통화</a>
                  <a href="sms:${phone}" class="contact-btn btn-pastel-green">📩 문자</a>
              </div>
              <div class="btn-group-options">
                  <div class="contact-btn btn-pastel-red" onclick="execLocationRequest()">❓ 요청</div>
                  <div class="contact-btn btn-pastel-red" onclick="execLocationCheck()">❗ 확인</div>
              </div>
          </div>
          <div class="contact-btn btn-location-toggle btn-pastel-red" onclick="toggleLocationMode()">
              📍 위치
          </div>
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
  
  // [수정] 인라인 스타일 -> CSS 클래스
  let html = "<div class='summary-list-container'>";
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
    
    html += `<div class="summary-item">• <b>${day}일</b> : `;
    
    if (isFullDay && isAllSame) {
      const { typeText, reason } = parseValueWithText(firstVal);
      html += `<span class="summary-absent-type">${typeText}결석</span>`;
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
        let text = `${periodStr}교시 (<span class="summary-detail-text">${typeText}</span>`;
        if (reason) text += `, ${reason}`;
        text += `)`;
        parts.push(text);
      }
      html += parts.join(', ');
    }
    html += `</div>`;
  });
  
  if (!hasData) html += "<div class='message-box text-gray'>이번 달 특이사항 없음</div>";
  html += "</div>";
  return html;
}

// =======================================================
// [통계 기능]
// =======================================================

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
  
  state.pickers.statsDate = flatpickr("#statsDateInput", {
      locale: "ko", dateFormat: "Y-m-d", disableMobile: true, maxDate: "today",
      defaultDate: recentDayStr, 
      enable: getEnableDates(),
      positionElement: document.getElementById('btnStatsDateTrigger'),
      onChange: (selectedDates, dateStr) => {
          txtDate.innerText = dateStr;
      }
  });
  document.getElementById('btnStatsDateTrigger').onclick = () => state.pickers.statsDate.open();

  
  // 2. 월별 통계
  txtMonth.innerText = recentMonthStr;

  state.pickers.statsMonth = flatpickr("#statsMonthInput", {
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
      positionElement: document.getElementById('btnStatsMonthTrigger'),
      onChange: (selectedDates, dateStr) => {
          txtMonth.innerText = dateStr;
      }
  });
  document.getElementById('btnStatsMonthTrigger').onclick = () => state.pickers.statsMonth.open();


  // 3. 기간 통계 (시작)
  txtStart.innerText = firstDayStr;

  state.pickers.statsStart = flatpickr("#statsStartDate", {
      locale: "ko", dateFormat: "Y-m-d", disableMobile: true, maxDate: "today",
      defaultDate: firstDayStr,
      enable: getEnableDates(),
      positionElement: document.getElementById('btnStatsStartTrigger'),
      onChange: (selectedDates, dateStr) => {
          txtStart.innerText = dateStr;
      }
  });
  document.getElementById('btnStatsStartTrigger').onclick = () => state.pickers.statsStart.open();

  // 4. 기간 통계 (종료)
  txtEnd.innerText = recentDayStr;

  state.pickers.statsEnd = flatpickr("#statsEndDate", {
      locale: "ko", dateFormat: "Y-m-d", disableMobile: true, maxDate: "today",
      defaultDate: recentDayStr,
      enable: getEnableDates(),
      positionElement: document.getElementById('btnStatsEndTrigger'),
      onChange: (selectedDates, dateStr) => {
          txtEnd.innerText = dateStr;
      }
  });
  document.getElementById('btnStatsEndTrigger').onclick = () => state.pickers.statsEnd.open();
  
  updateFlatpickrAllowedDates();

  renderStatsFilters();
  updateStatsInputVisibility();
}

function updateStatsInputVisibility() {
  const mode = document.querySelector('input[name="statsType"]:checked').value;
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

    chkClasses.forEach(cb => {
        cb.addEventListener('change', () => {
            const allChecked = Array.from(chkClasses).every(c => c.checked);
            chkAll.checked = allChecked;
        });
    });
}

async function runStatsSearch() {
  const container = document.getElementById('statsContainer');
  // [수정] 인라인 스타일 -> CSS 클래스
  container.innerHTML = '<div class="message-box-lg text-gray">데이터 분석 중...</div>';

  const selectedCheckboxes = document.querySelectorAll('input[name="classFilter"]:checked');
  if (selectedCheckboxes.length === 0) {
    container.innerHTML = '<div class="message-box-lg text-red">선택된 반이 없습니다.</div>';
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
    
    // [수정] getSchoolYear 로직 통합
    const qYear = parseInt(getSchoolYear(d));
    const qMonth = d.getMonth() + 1;

    targetMonthsToFetch.push({ year: qYear.toString(), month: qMonth.toString() });
    
    const dayChar = getDayOfWeek(d);
    displayTitle = `${d.getMonth()+1}월 ${d.getDate()}일(${dayChar}) 통계`;

  } else if (mode === 'monthly') {
    const monthStr = document.getElementById('statsMonthInput').value; 
    if(!monthStr) { alert("월을 선택해주세요."); return; }
    const parts = monthStr.split('-');
    
    let mYear = parseInt(parts[0]);
    let mMonth = parseInt(parts[1]);
    
    // [수정] getSchoolYear 로직 통합 (임시 날짜 생성하여 계산)
    const tempDate = new Date(mYear, mMonth - 1, 1);
    const sYear = getSchoolYear(tempDate);
    // getSchoolYear는 1,2월일 때 작년으로 반환하므로, API 호출용 mYear는 sYear 사용
    mYear = parseInt(sYear);

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
        // [수정] getSchoolYear 로직 통합
        const qYear = parseInt(getSchoolYear(curr));
        const qMonth = curr.getMonth() + 1;

        targetMonthsToFetch.push({ year: qYear.toString(), month: qMonth.toString() });
        curr.setMonth(curr.getMonth() + 1);
    }
  }
  
  state.currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };
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

    const unconfirmedInfo = {}; 

    targetClassKeys.forEach(k => unconfirmedInfo[k] = []);

    const yearKey = CURRENT_YEAR;
    const validDaysMap = globalData[yearKey] ? globalData[yearKey].validDays : {};

    const checkEndDate = (filterEndDate > today) ? today : filterEndDate;
    const checkStartDate = filterStartDate;

    const requiredDates = []; 
    
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
    const activeStudents = res.val.students.filter(s =>
        !s.attendance.every(a => a.value === 'n/a')
    );
    state.currentStatsTotalCounts[grade] += activeStudents.length;
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

        // [수정] getRealYear 사용
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
    if (!a.value || a.value.trim() === '') return false;
    if (a.value === 'n/a') return false;
    return checkRange(a);
});


        if (validRecords.length > 0) {
          if (mode === 'daily') {
             const targetDay = filterStartDate.getDate();
             const totalPeriodsThatDay = s.attendance.filter(a => a.day == targetDay && a.value !== 'n/a').length;

             
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

    renderStatsResult(aggregated, targetClassKeys, mode, displayTitle, unconfirmedInfo, fullDayAbsentCounts, hasRangeData);

  } catch (e) {
    console.error(e);
    // [수정] 인라인 스타일 -> CSS 클래스
    container.innerHTML = `<div class="message-center text-red">오류: ${e.message}</div>`;
  }
}

function renderStatsResult(aggregatedData, sortedClassKeys, mode, displayTitle, unconfirmedInfo, fullDayAbsentCounts, hasRangeData) {
  const container = document.getElementById('statsContainer');
  let html = "";
  
  // [수정] 인라인 스타일 -> CSS 클래스
  html += `<div class="stats-title">[ ${displayTitle} ]</div>`;

  if (mode === 'daily') {
      let isAllConfirmedForSummary = true;
      for (const cKey of sortedClassKeys) {
          const unconf = unconfirmedInfo[cKey] || [];
          if (unconf.length > 0) {
              isAllConfirmedForSummary = false;
              break;
          }
      }

      if (isAllConfirmedForSummary) {
          const summary = calculateDailySummary(fullDayAbsentCounts);
          if(summary) html += summary;
      }
  }

  let isAllClean = true;
  for (const cKey of sortedClassKeys) {
      const notConfirmedList = unconfirmedInfo[cKey] || [];
      const hasStudents = aggregatedData[cKey] && Object.keys(aggregatedData[cKey]).length > 0;
      
      if (notConfirmedList.length > 0 || hasStudents) {
          isAllClean = false;
          break;
      }
  }

  if (hasRangeData && isAllClean) {
      // [수정] 인라인 스타일 -> CSS 클래스
      html += `<div class="message-box-lg text-gray">특이사항이 없습니다.</div>`;
      container.innerHTML = html;
      return;
  }
  
  sortedClassKeys.forEach(classKey => {
    const notConfirmedList = unconfirmedInfo[classKey] || [];
    let badgeHtml = "";
    let unconfirmedText = "";

    if (notConfirmedList.length === 0) {
        // [수정] 인라인 스타일 -> CSS 클래스
        badgeHtml = `<span class="badge-confirmed">[마감 완료]</span>`;
    } else {
        badgeHtml = `<span class="badge-unconfirmed">[마감 전]</span>`;

        if (mode !== 'daily') {
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
                
                let ranges = [];
                if (days.length > 0) {
                    let start = days[0];
                    let end = days[0];

                    for (let i = 1; i < days.length; i++) {
                        const current = days[i];
                        
                        const validIdxStart = validList.indexOf(end);
                        const validIdxEnd = validList.indexOf(current);
                        
                        if (validIdxStart !== -1 && validIdxEnd !== -1 && (validIdxEnd - validIdxStart === 1)) {
                            end = current;
                        } else {
                            ranges.push(start === end ? `${start}` : `${start}~${end}`);
                            start = current;
                            end = current;
                        }
                    }
                    ranges.push(start === end ? `${start}` : `${start}~${end}`);
                }
                
                parts.push(`${m}월 ${ranges.join(', ')}일`);
            });
            
            // [수정] 인라인 스타일 -> CSS 클래스
            unconfirmedText = `<span class="text-red-small">${parts.join(', ')}</span>`;
        }
    }

    const studentsMap = aggregatedData[classKey];
    const hasStudents = studentsMap && Object.keys(studentsMap).length > 0;

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
        html += `<div style="padding:15px; text-align:center; color:#888; font-size:13px;">특이사항이 없습니다.</div>`;
    }
    html += `</div>`;
  });

  if (!hasRangeData) {
    html += `<div class="message-box text-gray">해당 기간의 수업 자료가 없습니다.</div>`;
  } 
  
  container.innerHTML = html;
}

function calculateDailySummary(fullDayAbsentCounts) {
  if (!state.currentStatsTotalCounts) return "";
  const totals = state.currentStatsTotalCounts;
  
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
       // [수정] 인라인 스타일 -> CSS 클래스
       text += `<span class="summary-absent-type">${typeText}결석</span>`;
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





