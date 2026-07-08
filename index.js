const STORAGE_KEY = 'maple_classroom_v4';
const GROUP_COUNT = 5;
const DEFAULT_STUDENTS = [
  '학생1','학생2','학생3','학생4','학생5','학생6','학생7',
  '학생8','학생9','학생10','학생11','학생12','학생13','학생14',
  '학생15','학생16','학생17','학생18','학생19','학생20','학생21'
];

// 상단 가운데 빈자리(모둠1-모둠4 사이)에 들어갈 할 일 메모판 크기/위치. buildGroups()의 격자 계산과 맞춰둔 값.
const TODO_W = 660, TODO_H = 469;
const TODO_DEFAULT_POS = { x: 635, y: 16 };

let state = loadState();
saveState();

function defaultState() {
  const students = [...DEFAULT_STUDENTS];
  const groups = buildGroups(students);
  const scores = {};
  const spent = {};
  const history = {};
  const avatars = {};
  students.forEach((_, i) => { scores[i] = 0; spent[i] = 0; history[i] = []; avatars[i] = defaultAvatar(); });
  return { students, groups, scores, spent, history, avatars, todoNote: '', todoPos: { ...TODO_DEFAULT_POS } };
}

function buildGroups(students) {
  // 배치: [모둠1][빈자리][모둠4] / [모둠2][모둠3][모둠5]
  // 모둠1,2,4,5: 4명 / 모둠3: 5명
  const cardW = 595, cardH = 425, gapX = 20, gapY = 24, ox = 20, oy = 16;

  // 상단 가운데(할 일 메모판) 폭/높이가 모둠 카드보다 커서, 그만큼 오른쪽 열과 아랫줄을 밀어서 안 겹치게 계산
  const col2X = ox + (cardW+gapX) + (TODO_W+gapX);
  const row1Y = oy + Math.max(cardH, TODO_H) + gapY;

  // 각 모둠 화면 위치 (가운데 상단은 빈자리라 col=1 상단은 없음)
  const positions = [
    { x: ox + 0*(cardW+gapX), y: oy }, // 모둠1: 상단 왼쪽
    { x: ox + 0*(cardW+gapX), y: row1Y }, // 모둠2: 하단 왼쪽
    { x: ox + (cardW+gapX), y: row1Y }, // 모둠3: 하단 가운데 (5명)
    { x: col2X, y: oy }, // 모둠4: 상단 오른쪽
    { x: col2X, y: row1Y }  // 모둠5: 하단 오른쪽
  ];

  // 멤버 배분: 모둠1,2,4,5 = 4명씩, 모둠3 = 5명 (총 21명)
  const sizes = [4, 4, 5, 4, 4];
  const groups = [];
  let cursor = 0;

  for (let g = 0; g < GROUP_COUNT; g++) {
    const members = [];
    for (let i = cursor; i < cursor + sizes[g] && i < students.length; i++) {
      members.push(i);
    }
    cursor += sizes[g];
    groups.push({
      id: g+1,
      name: `모둠 ${g+1}`,
      position: positions[g],
      members
    });
  }
  return groups;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.history) parsed.history = {};
      if (!parsed.avatars) parsed.avatars = {};
      if (!parsed.spent) parsed.spent = {};
      if (parsed.todoNote === undefined) parsed.todoNote = '';
      if (!parsed.todoPos) parsed.todoPos = { ...TODO_DEFAULT_POS };
      parsed.students.forEach((_, i) => {
        if (!parsed.history[i]) parsed.history[i] = [];
        if (!parsed.avatars[i]) parsed.avatars[i] = defaultAvatar();
        if (parsed.spent[i] === undefined) parsed.spent[i] = 0;
      });
      return parsed;
    }
  } catch(e) {}
  return defaultState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
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
    // 5명인 모둠은 2+2+1 배치 → 2열 그리드, 마지막 1명은 가운데 정렬
    const isFiveDesk = group.members.length === 5;
    grid.className = isFiveDesk ? 'desks-grid desks-grid-221' : 'desks-grid';

    group.members.forEach((studentIdx, mi) => {
      const name = state.students[studentIdx] || '?';
      const score = state.scores[studentIdx] || 0;
      const desk = document.createElement('div');
      // 5번째 학생(index 4)은 가운데 정렬용 클래스 추가
      desk.className = (isFiveDesk && mi === 4) ? 'desk-card desk-solo' : 'desk-card';
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
let currentScale = 1;
const MIN_SCALE = 0.5;
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
  let scale = Math.min(availW / contentW, availH / contentH, 1);
  scale = Math.max(scale, MIN_SCALE);
  currentScale = scale;
  canvasInner.style.transform = `scale(${scale})`;

  // CSS transform은 스크롤 가능 영역 계산에 반영되지 않아, 실제로는 다 들어와도
  // 축소 전 크기 기준으로 스크롤바가 남는다. 정상적으로 다 들어오면 스크롤을 숨기고,
  // 최소 배율로도 화면이 부족한 경우에만(아주 많은 학생 수 등) 스크롤을 허용한다.
  canvas.style.overflow = (scale <= MIN_SCALE) ? 'auto' : 'hidden';
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
  return `<div class="desk-avatar" data-idx="${studentIdx}" title="내 아바타 꾸미기">
    ${bgImg}
    <img src="${layers.base}" alt="">
    ${overlayImg}
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
    if (delta !== 0) state.scores[idx] = (state.scores[idx]||0) + delta;
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
  const all = state.students.map((_,i)=>i);
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
  if (!confirm('모든 학생의 점수를 0으로 초기화할까요?')) return;
  state.students.forEach((_,i) => { state.scores[i] = 0; });
  saveState();
  render();
  showToast('🔄 점수가 초기화되었습니다.');
}

function openSetting() {
  document.getElementById('studentInput').value = state.students.join('\n');
  document.getElementById('settingModal').style.display = 'flex';
}

function saveSetting() {
  const lines = document.getElementById('studentInput').value
    .split('\n').map(s=>s.trim()).filter(s=>s);
  if (!lines.length) { showToast('이름을 입력해주세요.'); return; }
  const oldPos = state.groups.map(g=>g.position);
  state.students = lines;
  state.scores = {};
  state.spent = {};
  state.history = {};
  state.avatars = {};
  lines.forEach((_,i) => { state.scores[i] = 0; state.spent[i] = 0; state.history[i] = []; state.avatars[i] = defaultAvatar(); });
  state.groups = buildGroups(lines);
  state.groups.forEach((g,i) => { if (oldPos[i]) g.position = oldPos[i]; });
  saveState();
  document.getElementById('settingModal').style.display = 'none';
  render();
  showToast(`✅ ${lines.length}명의 학생이 저장되었습니다.`);
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

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

render();
