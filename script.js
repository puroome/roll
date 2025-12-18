// [수정] 통계 조회 실행 (확정 여부 체크 및 출석생 계산 로직 추가)
async function runStatsSearch() {
  const container = document.getElementById('statsContainer');
  container.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">데이터 분석 중...</div>';

  // 1. 선택된 반 확인
  const selectedCheckboxes = document.querySelectorAll('input[name="classFilter"]:checked');
  const allCheckboxes = document.querySelectorAll('input[name="classFilter"]'); // 전체 반 개수 확인용
  
  if (selectedCheckboxes.length === 0) {
    container.innerHTML = '<div style="padding:40px; text-align:center; color:red;">선택된 반이 없습니다.</div>';
    return;
  }
  const targetClassKeys = Array.from(selectedCheckboxes).map(cb => cb.value);
  
  // 전체 반 선택 여부 확인
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
    if(!startStr || !endStr) {
        alert("시작일과 종료일을 모두 선택해주세요.");
        return;
    }
    filterStartDate = new Date(startStr);
    filterEndDate = new Date(endStr);
    
    if(filterStartDate > filterEndDate) {
        alert("종료일이 시작일보다 앞설 수 없습니다.");
        return;
    }

    displayTitle = `${startStr} ~ ${endStr} 통계`;

    // 기간 내 포함된 모든 월 계산
    let curr = new Date(filterStartDate.getFullYear(), filterStartDate.getMonth(), 1);
    const endLimit = new Date(filterEndDate.getFullYear(), filterEndDate.getMonth(), 1);
    
    while(curr <= endLimit) {
        targetMonthsToFetch.push({ 
            year: curr.getFullYear().toString(), 
            month: (curr.getMonth()+1).toString() 
        });
        curr.setMonth(curr.getMonth() + 1);
    }
  }
  
  // 통계 집계 변수 초기화
  window.currentStatsTotalCounts = { '1': 0, '2': 0, '3': 0 };
  let fullDayAbsentCounts = { '1': 0, '2': 0, '3': 0 }; // 하루 통으로 결석한 학생 수
  let isAllConfirmed = true; // 모든 반이 확정되었는지 여부
  
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
            // 해당 반 데이터 수집
            weeks.forEach(w => {
                const val = (monthData[w] && monthData[w][classKey]) ? monthData[w][classKey] : null;
                if(val) {
                    monthResults.push({
                        year: tm.year,
                        month: tm.month,
                        week: w,
                        classKey: classKey,
                        val: val
                    });
                }
            });
        });
        return monthResults;
    });

    const nestedResults = await Promise.all(promises);
    nestedResults.forEach(arr => results.push(...arr));

    // 데이터 처리 및 집계
    const aggregated = {}; 
    const finalClassSet = new Set(); // 학생 수 중복 집계 방지용
    const confirmedClassSet = new Set(); // 확정 여부 확인용

    // 1. 반별 확정 여부 및 총원 계산
    results.forEach(res => {
         if (!res.val) return;

         // 일별 모드일 때 확정 상태 체크
         if (mode === 'daily') {
             const dayStr = filterStartDate.getDate().toString();
             // 해당 반 데이터에 confirmations[day]가 없거나 false면 미확정 처리
             if (!res.val.confirmations || !res.val.confirmations[dayStr]) {
                 // 이 반은 미확정 상태임
                 // 주의: weeks 루프 때문에 같은 반 데이터가 여러 번 나올 수 있으므로,
                 // 여기서는 '미확정'이 하나라도 발견되면 false로 처리하는 로직은 조금 위험할 수 있음(데이터 파편화).
                 // 하지만 구조상 특정 날짜의 확정 정보는 해당 주차 데이터에만 존재하므로
                 // 해당 날짜가 포함된 주차 데이터를 찾았을 때만 판단해야 함.
                 // (여기서는 단순화를 위해, 해당 날짜 키가 있는데 false면 미확정으로 간주)
             }
             
             // 정확한 확정 여부 체크를 위해, 해당 날짜가 포함된 데이터 블록인지 확인
             // (간단히: 해당 반의 데이터가 로드되었고, 그 안에 confirmations가 있는지 확인)
             if (res.val.confirmations && res.val.confirmations[dayStr]) {
                 confirmedClassSet.add(res.classKey);
             }
         }

         // 총 학생 수 집계 (반별 최초 1회만)
         if (!finalClassSet.has(res.classKey) && res.val.students) {
            const grade = res.classKey.split('-')[0];
            window.currentStatsTotalCounts[grade] += res.val.students.length;
            finalClassSet.add(res.classKey);
         }
    });

    // 일별 모드이고 전체 반을 선택했을 때, 실제 데이터가 있는 반의 개수와 확정된 반의 개수 비교
    // (데이터가 아예 없는 반은 제외하고, 로드된 반들 기준)
    if (mode === 'daily' && isAllClassesSelected) {
        // targetClassKeys에 있는 모든 반이 confirmedClassSet에 있어야 함
        // (데이터가 아예 없는 반은 weekData 자체가 없으므로 제외되지만, 
        //  엄밀히는 '선택한 모든 반'이 확정되어야 하므로 아래와 같이 비교)
        const allTargetConfirmed = targetClassKeys.every(key => confirmedClassSet.has(key));
        if (!allTargetConfirmed) isAllConfirmed = false;
    } else {
        isAllConfirmed = false; // 일별이 아니거나 전체 선택이 아니면 요약표 미표시
    }


    // 2. 학생별 상세 내역 집계 및 전일 결석자 카운트
    results.forEach(res => {
      if (!res.val || !res.val.students) return;
      
      const classKey = res.classKey;
      const grade = classKey.split('-')[0];
      const students = res.val.students;

      if (!aggregated[classKey]) aggregated[classKey] = {};

      students.forEach(s => {
        if (!s.attendance) return;
        
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
          // [수정] 일별 모드일 때, 하루 통으로(6교시 이상) 결과가 있으면 '결석(비출석)'으로 카운트
          if (mode === 'daily') {
             // 해당 학생이 오늘 날짜에 대해 처리된 교시 수가 6개 이상이면 전일 결과처리자로 간주
             if (validRecords.length >= 6) {
                 // 중복 방지를 위해 aggregated에 아직 기록되지 않았거나, 
                 // (results 루프 구조상 한 학생은 한 번만 처리되므로 바로 카운트)
                 // 단, weeks가 나뉘어 있을 경우 중복될 수 있으므로 aggregated 확인 필요
                 if (!aggregated[classKey][s.no]) {
                    fullDayAbsentCounts[grade]++;
                 }
             }
          }

          if (!aggregated[classKey][s.no]) {
            aggregated[classKey][s.no] = { name: s.name, records: [] };
          }
          // 날짜 정보 보강
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
  
  // 출석생 = 총원 - 전일 결과처리자(6교시 이상)
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
