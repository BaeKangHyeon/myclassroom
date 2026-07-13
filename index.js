// 이 기기의 신원(어느 반, 어떤 역할인지)을 기억하는 localStorage 키
const CLASS_CODE_KEY = 'maple_class_code';
const ROLE_KEY = 'maple_role';           // 'teacher' | 'student'
const STUDENT_IDX_KEY = 'maple_student_idx';
const BIND_TOKEN_KEY = 'maple_bind_token'; // 이 기기가 이름을 고를 때의 "연결 회차". 선생님이 초기화하면 이 숫자가 올라가서 기기가 스스로 로그아웃된다.

// 상단 가운데 빈자리(모둠1-모둠4 사이)에 들어갈 할 일 메모판 크기/위치. computeLayout()의 격자 계산과 맞춰둔 값.
const TODO_W = 660, TODO_H = 469;
const TODO_DEFAULT_POS = { x: 635, y: 16 };

let onbSizes = [];
let currentScale = 1;
const MIN_SCALE = 0.3; // 학생 수가 아주 많을 때만 작동하는 최소 안전장치, 평소엔 아래 자동맞춤 계산이 이보다 항상 큼

// 반 전체 데이터(state)는 Firestore의 classrooms/{반코드} 문서 하나에 저장되고,
// 교사/학생 화면 모두 이 문서를 실시간 구독한다. state가 null인 동안은 아직 로딩 전.
let state = null;
let stateDocRef = null;
let saveTimer = null;
let pendingJoin = null; // 학생 입장 절차 중 임시 보관 (코드 + 반 데이터)

// groupSizes: 모둠별 인원수 배열, 예 [4,4,4,4,4,3]
function defaultState(groupSizes) {
  const total = groupSizes.reduce((a,b)=>a+b, 0);
  const students = [];
  for (let i = 1; i <= total; i++) students.push(`학생${i}`);
  const groups = buildGroups(students, groupSizes);
  const scores = {};
  const currency = {};
  const spent = {};
  const history = {};
  const avatars = {};
  students.forEach((_, i) => { scores[i] = 0; currency[i] = 0; spent[i] = 0; history[i] = []; avatars[i] = defaultAvatar(); });
  const todoPos = computeLayout(groupSizes).todoPos;
  return { students, groups, scores, currency, spent, history, avatars, config: { groupSizes: [...groupSizes] }, todoNote: '', todoPos };
}

// 모둠 카드들을 3열로 자동 줄바꿈 배치. 인원이 많아 desks-grid 줄이 늘어난 모둠은 카드 실제 높이도 커지므로,
// 각 행의 높이를 그 행에서 가장 인원이 많은 모둠 기준으로 계산해 아래 행과 겹치지 않게 한다.
// (실측: desk-card 2줄=421px, 3줄=579px → 줄당 158px, 헤더/푸터/여백 고정 105px)
const DESK_ROW_H = 158, CARD_BASE_H = 105;
function estimateCardHeight(size) {
  const deskRows = Math.max(1, Math.ceil(size / 2));
  return CARD_BASE_H + DESK_ROW_H * deskRows;
}

function computeLayout(groupSizes) {
  const cardW = 595, gapX = 20, gapY = 24, ox = 20, oy = 16, cols = 3;
  const n = groupSizes.length;
  const rows = Math.max(1, Math.ceil(n / cols));
  const lastRow = rows - 1;
  const lastRowUsed = n - lastRow * cols; // 마지막 줄에 실제로 들어간 모둠 수(1~cols)

  const rowHeights = new Array(rows).fill(0);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    rowHeights[row] = Math.max(rowHeights[row], estimateCardHeight(groupSizes[i]));
  }
  // 할 일 메모판: 마지막 줄에 빈 칸이 있으면 그 자리를 채우고(기존 디자인처럼 새 줄/새 칸을 안 만듦),
  // 마지막 줄이 꽉 차 있을 때만 그 줄 오른쪽에 한 칸 이어붙인다(새 줄은 절대 만들지 않는다).
  const todoRow = lastRow;
  rowHeights[todoRow] = Math.max(rowHeights[todoRow], TODO_H);

  const rowY = [oy];
  for (let r = 1; r < rows; r++) rowY.push(rowY[r-1] + rowHeights[r-1] + gapY);

  const cellPos = (i) => ({ x: ox + (i % cols) * (cardW+gapX), y: rowY[Math.floor(i / cols)] });
  const positions = [];
  for (let g = 0; g < n; g++) positions.push(cellPos(g));
  const todoPos = { x: ox + (lastRowUsed) * (cardW+gapX), y: rowY[todoRow] };
  return { positions, todoPos };
}

function buildGroups(students, groupSizes) {
  const { positions } = computeLayout(groupSizes);
  const groups = [];
  let cursor = 0;

  for (let g = 0; g < groupSizes.length; g++) {
    const members = [];
    for (let i = cursor; i < cursor + groupSizes[g] && i < students.length; i++) {
      members.push(i);
    }
    cursor += groupSizes[g];
    groups.push({
      id: g+1,
      name: `모둠 ${g+1}`,
      position: positions[g],
      members
    });
  }
  return groups;
}

// Firestore에서 내려온 데이터에 빠진 필드가 있으면 기본값으로 채운다.
function ensureStateShape(s) {
  if (!s.history) s.history = {};
  if (!s.avatars) s.avatars = {};
  if (!s.spent) s.spent = {};
  if (!s.currency) s.currency = {};
  if (s.todoNote === undefined) s.todoNote = '';
  if (!s.todoPos) s.todoPos = { ...TODO_DEFAULT_POS };
  s.students.forEach((_, i) => {
    if (!s.history[i]) s.history[i] = [];
    if (!s.avatars[i]) s.avatars[i] = defaultAvatar();
    if (s.spent[i] === undefined) s.spent[i] = 0;
    if (s.currency[i] === undefined) s.currency[i] = s.scores[i] || 0;
  });
  return s;
}

// state 전체를 Firestore에 저장. 연달아 호출돼도(드래그 등) 잠깐 모아서 한 번만 쓴다.
function saveState() {
  if (!stateDocRef || !state) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    stateDocRef.set(state).catch(() => showToast('⚠️ 저장 실패! 인터넷 연결을 확인해주세요.'));
  }, 300);
}

function render() {
  if (!state) return;
  const canvasInner = document.getElementById('canvasInner');
  canvasInner.innerHTML = '';

  state.groups.forEach((group, gi) => {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.id = `group-${group.id}`;
    card.style.left = group.position.x + 'px';
    card.style.top = group.position.y + 'px';
    card.style.zIndex = 10 + gi;

    const header = document.createElement('div');
    header.className = 'group-header';
    header.textContent = `── ${group.name} ──`;
    card.appendChild(header);

    const grid = document.createElement('div');
    // 인원이 홀수인 모둠은 마지막 1명이 남으므로 가운데 정렬(desk-solo)한다.
    const isOddGroup = group.members.length % 2 === 1;
    grid.className = 'desks-grid';

    group.members.forEach((studentIdx, mi) => {
      const name = state.students[studentIdx] || '?';
      const score = state.scores[studentIdx] || 0;
      const desk = document.createElement('div');
      const isLast = mi === group.members.length - 1;
      desk.className = (isOddGroup && isLast) ? 'desk-card desk-solo' : 'desk-card';
      desk.dataset.studentIdx = studentIdx;
      desk.dataset.groupId = group.id;
      desk.draggable = true;
      desk.innerHTML = `
        ${deskAvatarHtml(studentIdx)}
        <div class="desk-info">
          <div class="desk-name">${titleIconHtml(studentIdx)}<span class="desk-name-text">${escHtml(name)}</span></div>
          <div class="desk-score-row">
            <span class="score-heart">❤️</span>
            <span class="score-num" id="score-${studentIdx}">${score}</span>
          </div>
          <div class="score-btns">
            <button class="score-btn plus" data-idx="${studentIdx}" data-delta="1">▲</button>
            <button class="score-btn minus" data-idx="${studentIdx}" data-delta="-1">▼</button>
            <button class="score-btn memo" data-idx="${studentIdx}" title="메모/기록">📝</button>
          </div>
        </div>`;
      applyDeskFrame(desk, studentIdx);
      grid.appendChild(desk);
    });

    card.appendChild(grid);

    const groupScore = group.members.reduce((s,i) => s+(state.scores[i]||0), 0);
    const footer = document.createElement('div');
    footer.className = 'group-footer';
    footer.innerHTML = `
      <div class="slime${groupScore < 0 ? ' sad' : groupScore > 0 ? ' happy' : ''}" id="slime-${group.id}">
        <div class="slime-body">
          <div class="slime-eye left"></div>
          <div class="slime-eye right"></div>
          <div class="slime-mouth"></div>
          <div class="slime-tear"></div>
        </div>
      </div>
      <span class="group-score-label">${escHtml(group.name)}</span>
      <span class="group-score-num" id="gscore-${group.id}">${groupScore}</span>
      <span class="group-score-star">⭐</span>`;
    card.appendChild(footer);
    canvasInner.appendChild(card);

    bindCardDrag(card, gi);
    bindDeskDrag(card);
  });

  renderTodoBoard();

  document.querySelectorAll('.score-btn.plus, .score-btn.minus').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      changeScore(parseInt(btn.dataset.idx), parseInt(btn.dataset.delta));
    });
  });

  document.querySelectorAll('.score-btn.memo').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openMemoModal(parseInt(btn.dataset.idx));
    });
  });

  document.querySelectorAll('.desk-avatar, .desk-avatar-empty').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      goToAvatar(parseInt(el.dataset.idx));
    });
  });

  fitCanvasToScreen();
}

// 그룹 카드 전체가 화면 한 눈에 들어오도록 자동으로 축소 비율을 계산해 적용한다.
function fitCanvasToScreen() {
  const canvas = document.getElementById('canvas');
  const canvasInner = document.getElementById('canvasInner');
  const cards = canvasInner.querySelectorAll('.group-card, .todo-card');
  if (!cards.length) return;

  let contentW = 0, contentH = 0;
  cards.forEach(c => {
    contentW = Math.max(contentW, c.offsetLeft + c.offsetWidth);
    contentH = Math.max(contentH, c.offsetTop + c.offsetHeight);
  });
  contentW += 20; contentH += 20; // 여백

  canvasInner.style.width = contentW + 'px';
  canvasInner.style.height = contentH + 'px';

  const availW = canvas.clientWidth;
  const availH = canvas.clientHeight;
  // 화면에 딱 맞춘 배율보다 살짝(3%) 더 줄여서, 여백 계산 오차 등으로 스크롤이 생기는 걸 방지한다.
  let scale = Math.min(availW / contentW, availH / contentH, 1) * 0.97;
  scale = Math.max(scale, MIN_SCALE);
  currentScale = scale;
  canvasInner.style.transform = `scale(${scale})`;

  // CSS transform은 스크롤 가능 영역 계산에 반영되지 않아, 실제로는 다 들어와도
  // 축소 전 크기 기준으로 스크롤바가 남는다. 실제로 화면에 다 들어오는지를 직접 계산해서,
  // 다 들어오면 스크롤을 숨기고 학생 수가 아주 많아 최소 배율로도 부족할 때만 스크롤을 허용한다.
  const fits = (contentW * scale <= availW + 1) && (contentH * scale <= availH + 1);
  canvas.style.overflow = fits ? 'hidden' : 'auto';
}

let fitResizeTimer;
function scheduleFit() {
  clearTimeout(fitResizeTimer);
  fitResizeTimer = setTimeout(fitCanvasToScreen, 120);
}
window.addEventListener('resize', scheduleFit);
// ResizeObserver: 브라우저 zoom, 창 크기 변경, 개발자도구 여닫기 등 window resize 이벤트가
// 안 뜨는 경우까지 확실히 잡기 위해 #canvas 자체 크기 변화를 직접 관찰한다.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(scheduleFit).observe(document.getElementById('canvas'));
}

// 학생의 현재 아바타(기본 몸 + 착용한 옷)를 자리칸에 보여줄 HTML. 성별을 아직 안 골랐으면 꾸미기 유도 버튼.
function deskAvatarHtml(studentIdx) {
  const avatar = state.avatars[studentIdx];
  const layers = resolveAvatarLayers(avatar);
  if (!layers) {
    return `<div class="desk-avatar-empty" data-idx="${studentIdx}" title="내 캐릭터 만들기">
      <img class="icon" src="assets/핑크빈.png" alt="">
      <span class="label">꾸미기</span>
    </div>`;
  }
  const bgImg = layers.background ? `<img class="desk-bg" src="${layers.background}" alt="">` : '';
  const overlayImg = layers.overlay ? `<img src="${layers.overlay}" alt="">` : '';
  const hairImg = layers.hair ? `<img src="${layers.hair}" alt="">` : '';
  return `<div class="desk-avatar" data-idx="${studentIdx}" title="내 아바타 꾸미기">
    ${bgImg}
    <img src="${layers.base}" alt="">
    ${overlayImg}
    ${hairImg}
  </div>`;
}

// 이름 앞에 붙는 칭호 메달 아이콘.
function titleIconHtml(studentIdx) {
  const avatar = state.avatars[studentIdx];
  const title = avatar ? resolveTitle(avatar) : null;
  if (!title) return '';
  return `<img class="title-icon" src="${title.image}" alt="" title="${escHtml(title.name)}">`;
}

// 학생 카드 네 모서리에 테두리 장식 뱃지를 붙이고, 변은 등급 색상 선으로 잇는다.
function applyDeskFrame(desk, studentIdx) {
  const avatar = state.avatars[studentIdx];
  const fr = avatar && avatar.equipped ? FRAMES.find(f => f.id === avatar.equipped.frame) : null;
  if (!fr || !fr.image) return;
  ['tl', 'tr', 'bl', 'br'].forEach(pos => {
    const img = document.createElement('img');
    img.className = `frame-corner ${pos}`;
    img.src = fr.image;
    img.alt = '';
    desk.appendChild(img);
  });
  if (fr.color) {
    desk.style.borderWidth = '3px';
    desk.style.borderColor = fr.color;
  }
}

function goToAvatar(idx) {
  location.href = `avatar.html?student=${idx}`;
}

function formatDateKor(d) {
  return `${d.getMonth()+1}월 ${d.getDate()}일`;
}

function addHistory(idx, delta, reason) {
  if (!state.history) state.history = {};
  if (!state.history[idx]) state.history[idx] = [];
  state.history[idx].unshift({ date: formatDateKor(new Date()), delta, reason: (reason||'').trim() });
}

function renderMemoHistory(idx) {
  const list = document.getElementById('memoHistoryList');
  const entries = (state.history && state.history[idx]) || [];
  if (!entries.length) {
    list.innerHTML = '<div class="memo-history-empty">아직 기록이 없어요.</div>';
    return;
  }
  list.innerHTML = entries.map((en, i) => {
    const sign = en.delta > 0 ? '+' : '';
    const cls = en.delta > 0 ? 'plus' : (en.delta < 0 ? 'minus' : '');
    return `
      <div class="memo-history-item">
        <span class="memo-history-date">${escHtml(en.date)}</span>
        <span class="memo-history-reason">${escHtml(en.reason || '(사유 없음)')}</span>
        <span class="memo-history-delta ${cls}">${en.delta !== 0 ? sign + en.delta + '점' : '-'}</span>
        <button class="memo-history-delete" data-entry="${i}" title="이 기록 삭제">✕</button>
      </div>`;
  }).join('');
  list.querySelectorAll('.memo-history-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteHistoryEntry(idx, parseInt(btn.dataset.entry)));
  });
}

function deleteHistoryEntry(idx, entryIndex) {
  if (!state.history || !state.history[idx]) return;
  state.history[idx].splice(entryIndex, 1);
  saveState();
  renderMemoHistory(idx);
}

let currentMemoIdx = null;
function openMemoModal(idx) {
  currentMemoIdx = idx;
  const name = state.students[idx] || '?';
  document.getElementById('memoModalTitle').textContent = `📝 ${name} 학생 메모`;
  document.getElementById('memoDelta').value = 0;
  document.getElementById('memoReason').value = '';
  renderMemoHistory(idx);
  document.getElementById('memoModal').style.display = 'flex';
}

function saveMemo() {
  if (currentMemoIdx === null) return;
  const deltaVal = parseInt(document.getElementById('memoDelta').value);
  const delta = isNaN(deltaVal) ? 0 : deltaVal;
  const reason = document.getElementById('memoReason').value.trim();
  if (delta === 0 && !reason) {
    showToast('점수 또는 사유를 입력해주세요.');
    return;
  }
  if (delta !== 0) {
    changeScore(currentMemoIdx, delta, reason);
  } else {
    addHistory(currentMemoIdx, 0, reason);
    saveState();
  }
  renderMemoHistory(currentMemoIdx);
  document.getElementById('memoDelta').value = 0;
  document.getElementById('memoReason').value = '';
  showToast('📝 기록이 저장되었습니다.');
}

function openBulkModal() {
  if (!state) return;
  const list = document.getElementById('bulkStudentList');
  let html = '';
  state.groups.forEach(group => {
    html += `<div class="bulk-group-label">${escHtml(group.name)}</div>`;
    group.members.forEach(idx => {
      const name = state.students[idx] || '?';
      html += `
        <label class="bulk-student-item">
          <input type="checkbox" class="bulk-student-check" data-idx="${idx}">
          <span>${escHtml(name)}</span>
        </label>`;
    });
  });
  list.innerHTML = html;
  document.getElementById('bulkDelta').value = 0;
  document.getElementById('bulkReason').value = '';
  document.getElementById('bulkModal').style.display = 'flex';
}

function applyBulk() {
  const checked = Array.from(document.querySelectorAll('.bulk-student-check:checked')).map(el => parseInt(el.dataset.idx));
  if (!checked.length) { showToast('학생을 선택해주세요.'); return; }
  const deltaVal = parseInt(document.getElementById('bulkDelta').value);
  const delta = isNaN(deltaVal) ? 0 : deltaVal;
  const reason = document.getElementById('bulkReason').value.trim();
  if (delta === 0 && !reason) { showToast('점수 또는 사유를 입력해주세요.'); return; }
  checked.forEach(idx => {
    if (delta !== 0) {
      state.scores[idx] = (state.scores[idx]||0) + delta;
      state.currency[idx] = (state.currency[idx]||0) + delta;
    }
    addHistory(idx, delta, reason);
  });
  saveState();
  render();
  document.getElementById('bulkModal').style.display = 'none';
  showToast(`✅ 학생 ${checked.length}명에게 적용했습니다.`);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function changeScore(idx, delta, reason) {
  state.scores[idx] = (state.scores[idx]||0) + delta;
  state.currency[idx] = (state.currency[idx]||0) + delta;
  addHistory(idx, delta, reason);
  saveState();
  const el = document.getElementById(`score-${idx}`);
  if (el) {
    el.textContent = state.scores[idx];
    el.classList.remove('flash-up','flash-down');
    void el.offsetWidth;
    el.classList.add(delta > 0 ? 'flash-up' : 'flash-down');
  }
  state.groups.forEach(group => {
    if (!group.members.includes(idx)) return;
    const total = group.members.reduce((s,i) => s+(state.scores[i]||0), 0);
    const gEl = document.getElementById(`gscore-${group.id}`);
    if (gEl) gEl.textContent = total;
    const slimeEl = document.getElementById(`slime-${group.id}`);
    if (slimeEl) {
      slimeEl.classList.toggle('sad', total < 0);
      slimeEl.classList.toggle('happy', total > 0);
      if (delta > 0) { slimeEl.classList.remove('bounce'); void slimeEl.offsetWidth; slimeEl.classList.add('bounce'); }
    }
  });
}

function bindCardDrag(card, gi) {
  let dragging = false, sx, sy, sl, st;
  card.addEventListener('mousedown', e => {
    if (e.target.closest('.score-btn') || e.target.closest('.desk-card')) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    sl = parseInt(card.style.left)||0; st = parseInt(card.style.top)||0;
    card.classList.add('dragging');
    card.style.zIndex = 999;
    const move = e => {
      if (!dragging) return;
      card.style.left = Math.max(0, sl + (e.clientX - sx) / currentScale) + 'px';
      card.style.top = Math.max(0, st + (e.clientY - sy) / currentScale) + 'px';
    };
    const up = () => {
      dragging = false;
      card.classList.remove('dragging');
      card.style.zIndex = 10 + gi;
      state.groups[gi].position = { x: parseInt(card.style.left), y: parseInt(card.style.top) };
      saveState();
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// 상단 가운데 빈자리에 오늘의 할 일 메모판을 그린다.
function renderTodoBoard() {
  const canvasInner = document.getElementById('canvasInner');
  const pos = state.todoPos || TODO_DEFAULT_POS;
  const card = document.createElement('div');
  card.className = 'todo-card';
  card.style.left = pos.x + 'px';
  card.style.top = pos.y + 'px';
  card.style.zIndex = 50;
  card.innerHTML = `<textarea class="todo-textarea" id="todoTextarea">${escHtml(state.todoNote || '')}</textarea>`;
  canvasInner.appendChild(card);

  document.getElementById('todoTextarea').addEventListener('input', e => {
    state.todoNote = e.target.value;
    saveState();
  });

  bindTodoDrag(card);
}

function bindTodoDrag(card) {
  let dragging = false, sx, sy, sl, st;
  card.addEventListener('mousedown', e => {
    if (e.target.closest('.todo-textarea')) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    sl = parseInt(card.style.left)||0; st = parseInt(card.style.top)||0;
    card.classList.add('dragging');
    card.style.zIndex = 999;
    const move = e => {
      if (!dragging) return;
      card.style.left = Math.max(0, sl + (e.clientX - sx) / currentScale) + 'px';
      card.style.top = Math.max(0, st + (e.clientY - sy) / currentScale) + 'px';
    };
    const up = () => {
      dragging = false;
      card.classList.remove('dragging');
      card.style.zIndex = 50;
      state.todoPos = { x: parseInt(card.style.left), y: parseInt(card.style.top) };
      saveState();
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function bindDeskDrag(groupCard) {
  groupCard.querySelectorAll('.desk-card').forEach(desk => {
    desk.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', desk.dataset.studentIdx);
      setTimeout(() => desk.style.opacity = '0.4', 0);
    });
    desk.addEventListener('dragend', () => {
      desk.style.opacity = '1';
      document.querySelectorAll('.desk-card').forEach(d => d.classList.remove('drag-over'));
    });
    desk.addEventListener('dragover', e => { e.preventDefault(); desk.classList.add('drag-over'); });
    desk.addEventListener('dragleave', () => desk.classList.remove('drag-over'));
    desk.addEventListener('drop', e => {
      e.preventDefault();
      desk.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = parseInt(desk.dataset.studentIdx);
      if (fromIdx === toIdx) return;
      swapStudents(fromIdx, toIdx);
    });
  });
}

function swapStudents(a, b) {
  let posA = null, posB = null, grpA = null, grpB = null;
  state.groups.forEach((g, gi) => {
    const ia = g.members.indexOf(a);
    const ib = g.members.indexOf(b);
    if (ia !== -1) { posA = ia; grpA = gi; }
    if (ib !== -1) { posB = ib; grpB = gi; }
  });
  if (grpA !== null && grpB !== null) {
    state.groups[grpA].members[posA] = b;
    state.groups[grpB].members[posB] = a;
    saveState();
    render();
  }
}

function shuffleSeats() {
  if (!state) return;
  // 삭제된(자리에서 빠진) 학생은 안 섞이도록, 실제로 어느 모둠엔가 배치되어 있는 학생만 대상으로 한다.
  const all = state.groups.flatMap(g => g.members);
  for (let i = all.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [all[i],all[j]] = [all[j],all[i]];
  }
  let cur = 0;
  state.groups.forEach(g => {
    const size = g.members.length;
    g.members = all.slice(cur, cur+size);
    cur += size;
  });
  saveState();
  render();
  document.querySelectorAll('.group-card').forEach(c => {
    c.classList.remove('shuffle'); void c.offsetWidth; c.classList.add('shuffle');
  });
  showToast('🔀 자리가 랜덤으로 바뀌었습니다!');
}

function resetScores() {
  if (!state) return;
  if (!confirm('모든 학생의 점수를 0으로 초기화할까요?')) return;
  state.students.forEach((_,i) => { state.scores[i] = 0; });
  saveState();
  render();
  showToast('🔄 점수가 초기화되었습니다.');
}

function seatedIndices() {
  return state.groups.flatMap(g => g.members);
}

// 성별 선택 토글 버튼 HTML (남/여). 현재 선택된 쪽에 active.
function genderToggleHtml(selected, idxAttr) {
  const g = selected === 'girl' ? 'girl' : 'boy';
  return `<div class="gender-toggle"${idxAttr !== undefined ? ` data-idx="${idxAttr}"` : ''}>
    <button type="button" data-g="boy" class="${g === 'boy' ? 'active' : ''}">남</button>
    <button type="button" data-g="girl" class="${g === 'girl' ? 'active' : ''}">여</button>
  </div>`;
}

// 한 토글 묶음 안에서 남/여 버튼 클릭 시 active 이동
function bindGenderToggle(container) {
  container.querySelectorAll('.gender-toggle').forEach(tg => {
    tg.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        tg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  });
}

function openSetting() {
  if (!state) return;
  const seats = seatedIndices();
  document.getElementById('settingModalDesc').innerHTML =
    `각 자리의 학생 이름과 성별을 정해주세요. (현재 ${seats.length}명)<br>성별에 맞는 아바타가 학생 화면에 적용되고, 학생은 성별을 바꿀 수 없어요.`;
  const list = document.getElementById('studentSetupList');
  list.innerHTML = seats.map((idx, i) => {
    const gender = (state.avatars[idx] && state.avatars[idx].gender) || 'boy';
    return `<div class="student-setup-row" data-idx="${idx}">
      <span class="student-setup-num">${i + 1}</span>
      <input class="student-setup-name" type="text" value="${escHtml(state.students[idx] || '')}" placeholder="이름">
      ${genderToggleHtml(gender)}
    </div>`;
  }).join('');
  bindGenderToggle(list);
  document.getElementById('settingModal').style.display = 'flex';
}

function saveSetting() {
  const rows = Array.from(document.querySelectorAll('#studentSetupList .student-setup-row'));
  const entries = rows.map(row => ({
    idx: parseInt(row.dataset.idx),
    name: row.querySelector('.student-setup-name').value.trim(),
    gender: row.querySelector('.gender-toggle button.active').dataset.g
  }));
  if (entries.some(e => !e.name)) { showToast('빈 이름이 있어요. 모든 자리의 이름을 입력해주세요.'); return; }
  entries.forEach(e => {
    state.students[e.idx] = e.name;
    state.scores[e.idx] = 0;
    state.currency[e.idx] = 0;
    state.spent[e.idx] = 0;
    state.history[e.idx] = [];
    state.avatars[e.idx] = defaultAvatar(e.gender);
  });
  saveState();
  document.getElementById('settingModal').style.display = 'none';
  render();
  showToast(`✅ ${entries.length}명의 학생이 저장되었습니다.`);
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ===== 온보딩(최초 교실 설정) =====
function calcGroupSizes(total, perGroup) {
  total = Math.max(1, total|0);
  perGroup = Math.max(1, perGroup|0);
  const numGroups = Math.ceil(total / perGroup);
  const sizes = new Array(numGroups).fill(perGroup);
  sizes[numGroups - 1] = total - perGroup * (numGroups - 1);
  return sizes;
}

function renderOnbGroupList() {
  const list = document.getElementById('onbGroupList');
  list.innerHTML = onbSizes.map((size, i) => `
    <div class="onboarding-group-row">
      <span class="gname">모둠 ${i+1}</span>
      <input type="number" min="1" value="${size}" data-idx="${i}" class="onb-size-input">
      <span>명</span>
      <button type="button" class="gremove" data-idx="${i}" ${onbSizes.length <= 1 ? 'disabled' : ''}>✕ 삭제</button>
    </div>`).join('');
  list.querySelectorAll('.onb-size-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.dataset.idx);
      const v = parseInt(inp.value);
      onbSizes[i] = isNaN(v) || v < 1 ? 1 : v;
    });
  });
  list.querySelectorAll('.gremove').forEach(btn => {
    btn.addEventListener('click', () => {
      if (onbSizes.length <= 1) return;
      onbSizes.splice(parseInt(btn.dataset.idx), 1);
      renderOnbGroupList();
    });
  });
}

function showOnboarding() {
  onbSizes = calcGroupSizes(21, 4);
  renderOnbGroupList();
  document.getElementById('onboardingModal').style.display = 'flex';
}

async function startClassroom() {
  const sizes = onbSizes.filter(n => n >= 1);
  if (!sizes.length) { showToast('모둠을 1개 이상 만들어주세요.'); return; }

  // 다른 반과 절대 안 겹치는 반 코드를 하나 만든다 (이미 있으면 다시 뽑기).
  let code = null;
  for (let i = 0; i < 5; i++) {
    const candidate = genClassCode();
    try {
      const snap = await db.collection('classrooms').doc(candidate).get();
      if (!snap.exists) { code = candidate; break; }
    } catch (e) {
      showToast('⚠️ 서버 연결에 실패했어요. 인터넷을 확인해주세요.');
      return;
    }
  }
  if (!code) { showToast('반 코드 생성에 실패했어요. 다시 시도해주세요.'); return; }

  state = defaultState(sizes);
  try {
    await db.collection('classrooms').doc(code).set(state);
  } catch (e) {
    showToast('⚠️ 학급 생성에 실패했어요. 인터넷을 확인해주세요.');
    return;
  }
  // 이 기기를 "이 반의 선생님"으로 기억
  localStorage.setItem(ROLE_KEY, 'teacher');
  localStorage.setItem(CLASS_CODE_KEY, code);
  history.replaceState(null, '', '?class=' + code);

  document.getElementById('onboardingModal').style.display = 'none';
  connectClassroom(code);
  showToast(`✅ 학급 생성 완료! 반 코드: ${code}`);
}

document.getElementById('onbCalcBtn').addEventListener('click', () => {
  const total = parseInt(document.getElementById('onbTotal').value);
  const perGroup = parseInt(document.getElementById('onbPerGroup').value);
  onbSizes = calcGroupSizes(total, perGroup);
  renderOnbGroupList();
});
document.getElementById('onbAddGroupBtn').addEventListener('click', () => {
  const perGroup = parseInt(document.getElementById('onbPerGroup').value) || 4;
  onbSizes.push(perGroup);
  renderOnbGroupList();
});
document.getElementById('onbStartBtn').addEventListener('click', startClassroom);

// ===== 학급 초기화(새 학기 시작) =====
document.getElementById('newSemesterBtn').addEventListener('click', () => {
  if (!state || !stateDocRef) return;
  if (!confirm('학급을 초기화할까요?\n모든 학생/점수/기록/아바타 데이터가 삭제되고(학생들 기기에서도), 교실 설정을 처음부터 다시 합니다.')) return;
  stateDocRef.delete().then(() => {
    clearIdentity();
    // 이 기기에 남아있던 학교/급식/시간표 설정도 지워서 새 학급이 처음부터 고를 수 있게 한다.
    localStorage.removeItem(NEIS_STORAGE_KEY);
    localStorage.removeItem(NEIS_CACHE_KEY);
    localStorage.removeItem(TIMETABLE_STORAGE_KEY);
    location.href = location.pathname; // 주소의 ?class= 부분을 떼고 처음 화면으로
  }).catch(() => showToast('⚠️ 초기화 실패! 인터넷 연결을 확인해주세요.'));
});

// ===== 학생 추가/삭제(부분 수정) =====
function openRosterModal() {
  if (!state) return;
  const groupSelect = document.getElementById('rosterAddGroup');
  groupSelect.innerHTML = state.groups.map(g => `<option value="${g.id}">${escHtml(g.name)} (${g.members.length}명)</option>`).join('');
  document.getElementById('rosterAddName').value = '';
  renderRosterRemoveList();
  document.getElementById('rosterModal').style.display = 'flex';
}

function renderRosterRemoveList() {
  const list = document.getElementById('rosterRemoveList');
  const rows = [];
  state.groups.forEach(g => {
    g.members.forEach(idx => {
      rows.push(`
        <div class="roster-remove-item">
          <span>${escHtml(g.name)} · ${escHtml(state.students[idx] || '?')}</span>
          <span class="roster-row-actions">
            <button type="button" class="rdevice" data-idx="${idx}" title="이 학생이 이름을 잘못 골랐을 때, 그 기기를 이름 선택 화면으로 되돌립니다">📱 기기 초기화</button>
            <button type="button" class="rremove" data-idx="${idx}" title="자리에서 삭제">✕</button>
          </span>
        </div>`);
    });
  });
  list.innerHTML = rows.join('') || '<div class="memo-history-empty">학생이 없어요.</div>';
  list.querySelectorAll('.rremove').forEach(btn => {
    btn.addEventListener('click', () => removeStudent(parseInt(btn.dataset.idx)));
  });
  list.querySelectorAll('.rdevice').forEach(btn => {
    btn.addEventListener('click', () => disconnectStudentDevice(parseInt(btn.dataset.idx)));
  });
}

function addStudent() {
  const groupId = parseInt(document.getElementById('rosterAddGroup').value);
  const name = document.getElementById('rosterAddName').value.trim();
  if (!name) { showToast('학생 이름을 입력해주세요.'); return; }
  const gender = document.querySelector('#rosterAddGender button.active').dataset.g;
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return;
  const newIdx = state.students.length;
  state.students.push(name);
  state.scores[newIdx] = 0;
  state.currency[newIdx] = 0;
  state.spent[newIdx] = 0;
  state.history[newIdx] = [];
  state.avatars[newIdx] = defaultAvatar(gender);
  group.members.push(newIdx);
  saveState();
  render();
  openRosterModal();
  showToast(`✅ ${name} 학생을 ${group.name}에 추가했습니다.`);
}

// 학생이 실수로 다른 이름을 골랐을 때: 그 학생의 연결 회차를 올려서, 해당 기기가 자동으로 이름 선택 화면으로 돌아가게 한다.
function disconnectStudentDevice(idx) {
  if (!state) return;
  const name = state.students[idx] || '?';
  if (!confirm(`"${name}" 자리의 기기 연결을 초기화할까요?\n그 학생 기기는 다시 이름 선택 화면으로 돌아가고, 아바타/점수 데이터는 그대로 유지됩니다.`)) return;
  if (!state.bindTokens) state.bindTokens = {};
  state.bindTokens[idx] = (state.bindTokens[idx] || 0) + 1;
  saveState();
  showToast(`📱 "${name}" 자리의 기기 연결을 초기화했어요.`);
}

function removeStudent(idx) {
  const name = state.students[idx] || '?';
  if (!confirm(`${name} 학생을 자리에서 제거할까요?\n(점수/기록 데이터는 보존되지만 화면엔 더 이상 표시되지 않습니다)`)) return;
  state.groups.forEach(g => {
    const pos = g.members.indexOf(idx);
    if (pos !== -1) g.members.splice(pos, 1);
  });
  saveState();
  render();
  openRosterModal();
  showToast(`🗑️ ${name} 학생을 제거했습니다.`);
}

document.getElementById('rosterBtn').addEventListener('click', openRosterModal);
document.getElementById('closeRosterBtn').addEventListener('click', () => {
  document.getElementById('rosterModal').style.display = 'none';
});
document.getElementById('rosterAddBtn').addEventListener('click', addStudent);
bindGenderToggle(document.getElementById('rosterModal'));

// 작은 QR 클릭 → 크게 보기
document.getElementById('miniQrBtn').addEventListener('click', () => {
  document.getElementById('qrModal').style.display = 'flex';
});
document.getElementById('closeQrBtn').addEventListener('click', () => {
  document.getElementById('qrModal').style.display = 'none';
});
document.getElementById('qrModal').addEventListener('click', e => {
  if (e.target.id === 'qrModal') e.target.style.display = 'none'; // 바깥 클릭 시 닫기
});

document.getElementById('shuffleBtn').addEventListener('click', shuffleSeats);
document.getElementById('resetScoreBtn').addEventListener('click', resetScores);
document.getElementById('settingBtn').addEventListener('click', openSetting);
document.getElementById('saveSettingBtn').addEventListener('click', saveSetting);
document.getElementById('cancelSettingBtn').addEventListener('click', () => {
  document.getElementById('settingModal').style.display = 'none';
});

document.getElementById('cancelMemoBtn').addEventListener('click', () => {
  document.getElementById('memoModal').style.display = 'none';
});
document.getElementById('saveMemoBtn').addEventListener('click', saveMemo);

document.getElementById('bulkScoreBtn').addEventListener('click', openBulkModal);
document.getElementById('cancelBulkBtn').addEventListener('click', () => {
  document.getElementById('bulkModal').style.display = 'none';
});
document.getElementById('applyBulkBtn').addEventListener('click', applyBulk);
document.getElementById('bulkSelectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.bulk-student-check').forEach(cb => cb.checked = true);
});
document.getElementById('bulkSelectNoneBtn').addEventListener('click', () => {
  document.querySelectorAll('.bulk-student-check').forEach(cb => cb.checked = false);
});

// ===== 입장(반 코드/이름 선택) & Firestore 연결 =====

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 알파벳+숫자로 6자리 반 코드 생성
function genClassCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function clearIdentity() {
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(CLASS_CODE_KEY);
  localStorage.removeItem(STUDENT_IDX_KEY);
}

// 반 문서를 실시간 구독. 다른 기기(학생 아바타 구매 등)의 변경이 자동으로 화면에 반영된다.
// 학생이 스캔해서 바로 들어오는 입장 주소
function joinUrl(code) {
  return location.origin + location.pathname + '?class=' + code;
}

// 반 입장 주소를 QR로 만들어 상단의 작은 QR과 확대용 QR에 넣는다.
function setupQr(code) {
  try {
    const url = joinUrl(code);
    const qr = qrcode(0, 'M'); // 0=크기 자동, M=중간 오류복원
    qr.addData(url);
    qr.make();
    const dataUrl = qr.createDataURL(8, 2); // 큼직하게 만들고 작은 QR은 CSS로 축소(선명 유지)
    document.getElementById('miniQrImg').src = dataUrl;
    document.getElementById('bigQrImg').src = dataUrl;
    document.getElementById('qrUrlText').textContent = url;
    document.getElementById('miniQrBtn').style.display = 'inline-flex';
  } catch (e) {}
}

function connectClassroom(code) {
  stateDocRef = db.collection('classrooms').doc(code);
  const badge = document.getElementById('classCodeBadge');
  badge.textContent = `반 코드 ${code}`;
  badge.style.display = 'inline-block';
  setupQr(code);

  stateDocRef.onSnapshot(snap => {
    if (!snap.exists) {
      // 학급이 초기화(삭제)됨 → 이 기기의 기억도 지우고 처음 화면으로
      clearIdentity();
      location.href = location.pathname;
      return;
    }
    if (snap.metadata.hasPendingWrites) return; // 내가 방금 쓴 내용의 메아리는 무시 (이미 화면에 반영됨)
    state = ensureStateShape(snap.data());
    render();
  }, () => showToast('⚠️ 서버 연결 오류! 인터넷을 확인해주세요.'));
}

function showGate(prefillCode) {
  document.getElementById('gateCodeInput').value = prefillCode || '';
  if (typeof usingMockDb !== 'undefined' && usingMockDb) {
    document.getElementById('gateMockNotice').style.display = 'block';
  }
  document.getElementById('gateModal').style.display = 'flex';
}

// 반 코드로 입장 → 이름 선택 화면 표시. (직접 입력, QR 스캔, 기기 초기화 후 재입장에서 공용으로 씀)
async function enterCode(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) { showToast('반 코드를 입력해주세요.'); return; }
  let snap;
  try {
    snap = await db.collection('classrooms').doc(code).get();
  } catch (e) {
    showToast('⚠️ 서버 연결에 실패했어요. 인터넷을 확인해주세요.');
    showGate(code);
    return;
  }
  if (!snap.exists) { showToast('반 코드를 찾을 수 없어요. 다시 확인해주세요.'); showGate(code); return; }
  pendingJoin = { code, data: snap.data() };
  renderNameGate();
  document.getElementById('gateModal').style.display = 'none';
  document.getElementById('nameGateModal').style.display = 'flex';
}

function gateEnter() {
  enterCode(document.getElementById('gateCodeInput').value);
}

// 자리에 배치된 학생들의 이름 버튼 목록
function renderNameGate() {
  const grid = document.getElementById('nameGateGrid');
  const data = pendingJoin.data;
  const seats = (data.groups || []).flatMap(g => g.members);
  grid.innerHTML = seats.map(idx => `
    <button type="button" class="name-gate-btn" data-idx="${idx}">${escHtml(data.students[idx] || '?')}</button>
  `).join('') || '<div class="memo-history-empty">아직 등록된 학생이 없어요.</div>';
  grid.querySelectorAll('.name-gate-btn').forEach(btn => {
    btn.addEventListener('click', () => bindStudent(parseInt(btn.dataset.idx)));
  });
}

// 이 기기를 "이 반의 이 학생"으로 기억하고 아바타 화면으로 이동
function bindStudent(idx) {
  localStorage.setItem(ROLE_KEY, 'student');
  localStorage.setItem(CLASS_CODE_KEY, pendingJoin.code);
  localStorage.setItem(STUDENT_IDX_KEY, String(idx));
  // 지금 시점의 연결 회차를 기억. 나중에 선생님이 이 값을 올리면(초기화) 기기가 스스로 로그아웃한다.
  const token = (pendingJoin.data.bindTokens && pendingJoin.data.bindTokens[idx]) || 0;
  localStorage.setItem(BIND_TOKEN_KEY, String(token));
  location.href = 'avatar.html';
}

document.getElementById('gateEnterBtn').addEventListener('click', gateEnter);
document.getElementById('gateCodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') gateEnter();
});
document.getElementById('gateNewClassBtn').addEventListener('click', () => {
  document.getElementById('gateModal').style.display = 'none';
  showOnboarding();
});
document.getElementById('nameGateBackBtn').addEventListener('click', () => {
  document.getElementById('nameGateModal').style.display = 'none';
  showGate(pendingJoin ? pendingJoin.code : '');
});

// ===== 시작: 이 기기가 누구인지에 따라 화면 분기 =====
function bootstrap() {
  if (!firebaseReady()) {
    showGate('');
    showToast('⚠️ 서버 설정이 필요해요 (firebase-config.js)');
    return;
  }
  const urlCode = (new URLSearchParams(location.search).get('class') || '').trim().toUpperCase();
  const role = localStorage.getItem(ROLE_KEY);
  const savedCode = localStorage.getItem(CLASS_CODE_KEY) || '';

  if (role === 'student') {
    // 학생 기기는 자리표 화면 접근 불가 → 항상 자기 아바타 화면으로
    location.replace('avatar.html');
    return;
  }
  if (role === 'teacher' && savedCode) {
    if (!urlCode || urlCode !== savedCode) history.replaceState(null, '', '?class=' + savedCode);
    connectClassroom(savedCode);
    return;
  }
  // 주소에 반 코드가 있으면(QR 스캔 또는 기기 초기화 후 돌아옴) 코드 입력을 건너뛰고 바로 이름 선택으로
  if (urlCode) {
    enterCode(urlCode);
    return;
  }
  showGate('');
}
bootstrap();
