// script.js 앞부분은 그대로 두시고, [초기화] 부분과 [이벤트] 부분만 확인하세요.

// ... (Firebase import 및 설정 코드는 그대로 유지) ...

// ==========================================================
// [초기화] 
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  // [핵심 1] 사용자가 화면 어디든 처음 터치할 때 '무음 진동'을 울려 권한을 미리 따놓습니다.
  document.body.addEventListener('touchstart', function unlockVibration() {
    if (navigator.vibrate) navigator.vibrate(1);
    document.body.removeEventListener('touchstart', unlockVibration); // 한 번만 실행하고 삭제
  }, { once: true });

  // ... (기존 초기화 코드들: window.onSaveBtnClick 등등) ...
  window.onSaveBtnClick = onSaveBtnClick;
  window.onMonthChange = onMonthChange;
  window.loadStudents = loadStudents;
  window.saveState = saveState;
  window.toggleReasonInput = toggleReasonInput;
  window.hideConfirmModal = hideConfirmModal;
  window.executeSave = executeSave;

  document.getElementById('monthSelect').addEventListener('change', () => { onMonthChange(); saveState(); });
  document.getElementById('weekSelect').addEventListener('change', () => { loadStudents(); saveState(); });
  document.getElementById('classCombinedSelect').addEventListener('change', () => { loadStudents(); saveState(); });
  
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

// ... (통신 함수, UI 로직 등 중간 코드는 그대로 유지) ...

// ==========================================================
// [이벤트] 드래그 및 터치
// ==========================================================

// ... (addDragListeners 등 그대로 유지) ...

function onTouchStart(e) { 
  // [핵심 2] 혹시 몰라 여기서도 1ms 노크
  if(navigator.vibrate) navigator.vibrate(1);

  lastTouchTime = Date.now(); 
  const cell = e.currentTarget;
  dragStartCell = cell; 
  longPressTimer = setTimeout(() => { 
    if(navigator.vibrate) navigator.vibrate(50); // 이제 무조건 울립니다
    startMultiSelect(cell); 
  }, 300); 
}

// ... (나머지 코드 그대로 유지) ...
