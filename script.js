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
let pendingChanges = {};
let currentSelectedClass = null;
let currentActiveDate = new Date();
let loadedMonthData = null; 
let loadedMonthKey = "";

document.addEventListener('DOMContentLoaded', () => {
  window.onSaveBtnClick = onSaveBtnClick;
  window.closeStudentModal = closeStudentModal;
  window.executeSave = executeSave;
  window.hideConfirmModal = hideConfirmModal;
  window.handleCellClick = handleCellClick;
  
  // [안전장치] HTML이 업데이트되지 않았을 경우 경고
  const dateInput = document.getElementById('dateInput');
  if (!dateInput) {
    alert("오류: index.html 파일이 최신 버전이 아닙니다. 파일을 덮어씌워주세요!");
    return;
  }

  dateInput.addEventListener('change', (e) => {
    if(!e.target.value) return;
    const newDate = new Date(e.target.value);
    if (Object.keys(pendingChanges).length > 0) {
      if(!confirm("저장하지 않은 데이터가 있습니다. 이동하시겠습니까?")) {
        updateDateLabel(currentActiveDate);
        return;
      }
    }
    currentActiveDate = newDate;
    updateDateLabel(newDate);
    loadStudents();
  });

  document.getElementById('modalCancelBtn').addEventListener('click', hideConfirmModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', executeSave);
  
  const radios = document.getElementsByName('attType');
  radios.forEach(r => r.addEventListener('change', toggleReasonInput));

  document.addEventListener('contextmenu', event => event.preventDefault());
  window.addEventListener('beforeunload', (e) => { if(Object.keys(pendingChanges).length > 0) e.returnValue = ''; });

  document.getElementById('btnStatsMode').addEventListener('click', enterStatsMode);
  document.getElementById('btnBackToHome').addEventListener('click', () => goHome());
  document.getElementById('btnBackToHomeStats').addEventListener('click', () => goHome());

  toggleReasonInput();
  fetchInitDataFromFirebase();
  
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
  const padMM = String(mm).padStart(2, '0');
  const padDD = String(dd).padStart(2, '0');
  document.getElementById('dateDisplayLabel').innerText = `${padMM}-${padDD}`;
  const yyyy = date.getFullYear();
  document.getElementById('dateInput').value = `${yyyy}-${padMM}-${padDD}`;
}

function goHome() {
  if (Object.keys(pendingChanges).length > 0) {
    if(!confirm("저장하지 않은 내용이 있습니다. 무시하고 홈으로 가시겠습니까?")) return;
    pendingChanges = {};
    updateSaveButtonUI();
  }
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById('homeScreen').classList.add('active');
  renderHomeScreenClassButtons();
}

// [수정] 데이터 없을 때 멈춤 현상 해결
async function fetchInitDataFromFirebase() {
  try {
    const snapshot = await get(child(ref(db), `metadata`));
    if (snapshot.exists()) {
      globalData = snapshot.val();
      renderHomeScreenClassButtons();
    } else {
      // 데이터가 없을 경우 안내 표시
      document.getElementById('classButtonContainer').innerHTML = 
        '<div style="grid-column:1/-1; text-align:center; padding:20px; line-height:1.5;">' +
        '데이터가 없습니다.<br>구글 시트 확장프로그램에서<br><b>[Firebase로 데이터 동기화]</b>를<br>실행해주세요.</div>';
    }
  } catch (error) { 
    console.error(error); 
    document.getElementById('classButtonContainer').innerHTML = "연결 오류: " + error.message;
  }
}

// [핵심] 홈 화면 반 버튼: 오늘 확정 여부 체크 (노랑/회색)
async function renderHomeScreenClassButtons() {
  const container = document.getElementById('classButtonContainer');
  const year = CURRENT_YEAR;
  if (!globalData[year]) { container.innerHTML = "데이터 없음"; return; }

  const today = new Date();
  const mm = (today.getMonth()+1).toString();
  const dd = today.getDate().toString();
  
  const existingGrades = (globalData[year].grades || []).map(String);
  const existingClasses = (globalData[year].classes || []).map(String);
  
  container.innerHTML = "출결 확인 중...";
  
  const statusMap = {}; 
  const promises = [];
  const classKeys = [];

  ['1', '2', '3'].forEach(g => {
     ['1', '2'].forEach(c => { 
        if(existingGrades.includes(g) && existingClasses.includes(c)) {
           const key = `${g}-${c}`;
           classKeys.push(key);
           const path = `attendance/${year}/${mm}/${key}/confirmations/${dd}`;
           promises.push(get(child(ref(db), path)));
        }
     });
  });

  const snapshots = await Promise.all(promises);
  snapshots.forEach((snap, idx) => {
     statusMap[classKeys[idx]] = snap.exists() && snap.val() === true;
  });

  container.innerHTML = "";
  
  ['1', '2', '3'].forEach(g => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'grade-row';
    for (let cNum = 1; cNum <= 2; cNum++) {
      const c = cNum.toString(); 
      const btn = document.createElement('button');
      const key = `${g}-${c}`;
      btn.innerText = key;
      
      if (existingGrades.includes(g) && existingClasses.includes(c)) {
        if(statusMap[key]) {
             btn.className = 'class-btn grade-1'; // 확정(노랑)
        } else {
             btn.className = 'class-btn gray-status'; // 미확정(회색)
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
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById('attendanceScreen').classList.add('active');
  loadStudents();
}

function enterStatsMode() {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById('statsScreen').classList.add('active');
  document.getElementById('btnSearchStats').onclick = runStatsSearch;
  
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  
  document.getElementById('statsDateInput').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('statsMonthInput').value = `${yyyy}-${mm}`;
  document.getElementById('statsStartDate').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('statsEndDate').value = `${yyyy}-${mm}-${dd}`;

  const radios = document.getElementsByName('statsType');
  radios.forEach(r => r.addEventListener('change', updateStatsUI));
  updateStatsUI();
  renderStatsFilters();
}

function updateStatsUI() {
  const mode = document.querySelector('input[name="statsType"]:checked').value;
  document.getElementById('statsDateInput').style.display = (mode === 'daily') ? 'block' : 'none';
  document.getElementById('statsMonthInput').style.display = (mode === 'monthly') ? 'block' : 'none';
  document.getElementById('statsPeriodGroup').style.display = (mode === 'period') ? 'flex' : 'none';
}

function renderStatsFilters() {
  const container = document.getElementById('statsFilterContainer');
  container.innerHTML = "";
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

// [복구] 상세 내역 및 기간 조회 로직
async function runStatsSearch() {
  const container = document.getElementById('statsContainer');
  container.innerHTML = '분석 중...';
  
  const selectedCheckboxes = document.querySelectorAll('input[name="classFilter"]:checked');
  if (selectedCheckboxes.length === 0) { container.innerHTML = '선택된 반이 없습니다.'; return; }
  
  const targetClassKeys = Array.from(selectedCheckboxes).map(cb => cb.value);
  const mode = document.querySelector('input[name="statsType"]:checked').value;
  
  let startDate, endDate;
  if (mode === 'daily') {
    const d = new Date(document.getElementById('statsDateInput').value);
    startDate = d; endDate = d;
  } else if (mode === 'monthly') {
    const mVal = document.getElementById('statsMonthInput').value; 
    const parts = mVal.split('-');
    startDate = new Date(parts[0], parts[1]-1, 1);
    endDate = new Date(parts[0], parts[1], 0); 
  } else if (mode === 'period') {
    startDate = new Date(document.getElementById('statsStartDate').value);
    endDate = new Date(document.getElementById('statsEndDate').value);
  }

  const promises = [];
  let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endLimit = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  
  while(current <= endLimit) {
    const y = current.getFullYear().toString();
    const m = (current.getMonth()+1).toString();
    targetClassKeys.forEach(key => {
      const path = `attendance/${y}/${m}/${key}`;
      promises.push(get(child(ref(db), path)).then(snap => ({ key, val: snap.val(), year: y, month: m })));
    });
    current.setMonth(current.getMonth() + 1);
  }

  const results = await Promise.all(promises);
  let html = `<div style="text-align:center; margin-bottom:15px; font-weight:bold;">[기간 조회 결과]</div>`;
  const aggregated = {}; 

  results.forEach(res => {
    if(!res.val || !res.val.students) return;
    if(!aggregated[res.key]) aggregated[res.key] = {};
    
    res.val.students.forEach(s => {
      if(!s.attendance) return;
      const validLogs = s.attendance.filter(a => {
        if(!a.value) return false;
        const logDate = new Date(res.year, res.month - 1, a.day);
        const check = new Date(logDate.toDateString());
        const sDate = new Date(startDate.toDateString());
        const eDate = new Date(endDate.toDateString());
        return check >= sDate && check <= eDate;
      });

      if(validLogs.length > 0) {
        if(!aggregated[res.key][s.no]) aggregated[res.key][s.no] = { name: s.name, logs: [] };
        aggregated[res.key][s.no].logs.push(...validLogs.map(l => ({...l, month: res.month})));
      }
    });
  });

  let hasData = false;
  Object.keys(aggregated).sort().forEach(cls => {
    html += `<div class="stats-class-block"><div class="stats-class-header">${cls}반</div>`;
    Object.keys(aggregated[cls]).sort((a,b)=>Number(a)-Number(b)).forEach(no => {
      const student = aggregated[cls][no];
      
      const logsStr = student.logs.map(l => {
         const { typeText, reason } = parseValueWithText(l.value);
         let text = `${l.month}/${l.day} ${l.period}교시(${typeText}`;
         if(reason) text += `, ${reason}`;
         text += `)`;
         return text;
      }).join(', ');
      
      html += `<div class="stats-student-row">
        <div class="stats-student-name">${no}번 ${student.name}</div>
        <div class="stats-detail">${logsStr}</div>
      </div>`;
      hasData = true;
    });
    html += `</div>`;
  });

  if(!hasData) html = "<div style='text-align:center; padding:30px; color:#999;'>특이사항 없음</div>";
  container.innerHTML = html;
}

function parseValueWithText(val) {
  if (!val) return { typeText: "", reason: "" };
  const match = val.toString().match(/^([^(\s]+)\s*(?:\((.+)\))?$/);
  let symbol = val; 
  let reason = "";
  if (match) { symbol = match[1].trim(); reason = match[2] ? match[2].trim() : ""; }
  
  let typeText = symbol;
  if(symbol === "△") typeText = "인정";
  else if(symbol === "○") typeText = "병결";
  else if(symbol === "Ⅹ" || symbol === "X") typeText = "무단";
  
  return { typeText, reason };
}

async function loadStudents() {
  pendingChanges = {};
  updateSaveButtonUI();
  
  const year = CURRENT_YEAR;
  const month = (currentActiveDate.getMonth() + 1).toString();
  const day = currentActiveDate.getDate();
  const combinedVal = currentSelectedClass; 
  if (!year || !month || !combinedVal) return;

  const [grade, cls] = combinedVal.split('-');
  document.getElementById('loading').style.display = 'inline';
  const container = document.getElementById('tableContainer');
  
  const cacheKey = `${year}-${month}-${combinedVal}`;
  let data = null;

  if (loadedMonthKey === cacheKey && loadedMonthData) {
    data = loadedMonthData;
  } else {
    try {
      const snapshot = await get(child(ref(db), `attendance/${year}/${month}/${grade}-${cls}`));
      if (snapshot.exists()) {
        data = snapshot.val();
        loadedMonthData = data;
        loadedMonthKey = cacheKey;
      } else {
        container.innerHTML = '<div style="padding:20px; text-align:center;">데이터 없음</div>';
        document.getElementById('loading').style.display = 'none';
        return;
      }
    } catch (error) { container.innerHTML = '로드 실패'; return; }
  }
  renderTableDaily(data, day);
}

function renderTableDaily(data, targetDay) {
  const container = document.getElementById('tableContainer');
  document.getElementById('loading').style.display = 'none';
  if (!data || !data.students) { container.innerHTML = "오류"; return; }

  let periods = new Set();
  data.students.forEach(s => {
    if(s.attendance) s.attendance.forEach(a => { if(a.day == targetDay) periods.add(a.period); });
  });
  
  const sortedPeriods = Array.from(periods).sort((a,b) => {
    const na = parseInt(a), nb = parseInt(b);
    return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.toString().localeCompare(b.toString());
  });

  if (sortedPeriods.length === 0) {
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#888;">${targetDay}일 수업 데이터가 없습니다.</div>`;
    return;
  }

  let html = '<table><thead><tr><th class="col-no">번호</th><th class="col-name">이름</th>';
  sortedPeriods.forEach((p, i) => html += `<th class="${i%2===0?'bg-period-1':'bg-period-2'}">${p}교시</th>`);
  html += '</tr></thead><tbody>';

  data.students.forEach(std => {
    html += '<tr><td>' + std.no + '</td><td class="col-name">' + std.name + '</td>';
    const todayAtt = {};
    if(std.attendance) std.attendance.forEach(a => { if(a.day == targetDay) todayAtt[a.period] = a; });

    sortedPeriods.forEach((p, i) => {
      const att = todayAtt[p];
      const val = att ? att.value : "";
      const colIndex = att ? att.colIndex : -1;
      html += `<td class="check-cell ${i%2===0?'bg-period-1':'bg-period-2'}" 
               data-std-row="${std.rowNumber}" data-col-idx="${colIndex}" data-val="${val}"
               onmousedown="handleCellClick(event, this)">
               ${formatValue(val)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function formatValue(val) {
  if (!val) return "";
  const match = val.toString().match(/^([^(\s]+)\s*\((.+)\)$/);
  if (match) return `<span class="mark-symbol">${match[1]}</span><span class="mark-note">(${match[2]})</span>`;
  return `<span class="mark-symbol">${val}</span>`;
}

function handleCellClick(e, cell) {
  processSingleCell(cell);
}

function processSingleCell(cell) {
  const s = document.querySelector('input[name="attType"]:checked').value;
  const r = document.getElementById('reasonInput').value.trim();
  let val = s; 
  if((s==="△"||s==="○")&&r!=="") val=`${s}(${r})`;
  queueUpdate(cell, val);
}

function queueUpdate(cell, newValue) {
  cell.innerHTML = formatValue(newValue);
  cell.classList.add('unsaved-cell');
  const r = cell.getAttribute('data-std-row');
  const c = cell.getAttribute('data-col-idx');
  pendingChanges[`${r}-${c}`] = newValue;
  updateSaveButtonUI();
}

function updateSaveButtonUI() {
  const count = Object.keys(pendingChanges).length;
  const th = document.querySelector('thead th.col-name');
  if(th) {
    if(count > 0) { th.innerHTML = `저장<br>(${count})`; th.classList.add('save-active'); }
    else { th.innerHTML = "이름"; th.classList.remove('save-active'); }
  }
}

function onSaveBtnClick() { if(Object.keys(pendingChanges).length > 0) document.getElementById('confirmModal').classList.add('show'); }
function hideConfirmModal() { document.getElementById('confirmModal').classList.remove('show'); }

function toggleReasonInput() {
  const s = document.querySelector('input[name="attType"]:checked').value;
  const input = document.getElementById('reasonInput');
  input.disabled = !(s === "△" || s === "○");
  if(input.disabled) input.value = "";
}

async function executeSave() {
  hideConfirmModal();
  const keys = Object.keys(pendingChanges);
  if(keys.length === 0) return;

  const [grade, cls] = currentSelectedClass.split('-');
  const month = (currentActiveDate.getMonth()+1).toString();
  const day = currentActiveDate.getDate().toString();
  
  keys.forEach(k => {
    const [row, col] = k.split('-');
    const student = loadedMonthData.students.find(s => s.rowNumber == row);
    if(student) {
      const att = student.attendance.find(a => a.colIndex == col);
      if(att) att.value = pendingChanges[k];
      else {
        student.attendance.push({ colIndex: col, day: parseInt(day), period: "?", value: pendingChanges[k] });
      }
    }
  });

  if(!loadedMonthData.confirmations) loadedMonthData.confirmations = {};
  loadedMonthData.confirmations[day] = true;

  const path = `attendance/${CURRENT_YEAR}/${month}/${grade}-${cls}`;
  await update(ref(db, path), loadedMonthData);
  
  const backupData = keys.map(k => {
    const [r, c] = k.split('-');
    return { year: CURRENT_YEAR, row: r, col: c, value: pendingChanges[k] };
  });

  fetch(APPS_SCRIPT_URL, { 
    method: "POST", body: JSON.stringify({ action: "saveAttendanceBatch", data: backupData }) 
  }).catch(console.error);

  // [신규] 구글 시트 색상 변경 요청 (확정=true)
  fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "setConfirmationColor",
      year: CURRENT_YEAR, month: month, grade: grade, classNum: cls, day: day,
      isConfirmed: true 
    })
  }).catch(console.error);

  pendingChanges = {};
  document.querySelectorAll('.unsaved-cell').forEach(c => c.classList.remove('unsaved-cell'));
  updateSaveButtonUI();
}
