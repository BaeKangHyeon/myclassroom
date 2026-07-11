// 이 기기의 신원(어느 반, 어떤 역할인지) — index.js와 같은 키를 쓴다.
const CLASS_CODE_KEY = 'maple_class_code';
const ROLE_KEY = 'maple_role';
const STUDENT_IDX_KEY = 'maple_student_idx';
const BIND_TOKEN_KEY = 'maple_bind_token';

const role = localStorage.getItem(ROLE_KEY);
const classCode = localStorage.getItem(CLASS_CODE_KEY);
// 학생 기기는 저장된 자기 번호만 사용(주소를 바꿔도 남의 아바타로 못 감).
// 선생님이 자리표에서 학생 카드를 눌러 들어온 경우에만 주소의 번호를 쓴다.
const params = new URLSearchParams(location.search);
const studentIdx = role === 'student'
  ? parseInt(localStorage.getItem(STUDENT_IDX_KEY))
  : parseInt(params.get('student'));

let state = null;
let docRef = null;
let currentTab = 'shop';
let currentCategory = 'outfit';

// 내 아바타와 쓴 금액만 콕 집어 저장한다.
// (문서 전체를 덮어쓰지 않으므로 선생님이 동시에 점수를 바꿔도 서로 안 지워짐)
function saveAvatarState() {
  if (!docRef) return;
  const payload = {};
  payload[`avatars.${studentIdx}`] = state.avatars[studentIdx];
  payload[`spent.${studentIdx}`] = (state.spent && state.spent[studentIdx]) || 0;
  docRef.update(payload).catch(() => showToast('⚠️ 저장 실패! 인터넷을 확인해주세요.'));
}

function studentValid() {
  return state && Number.isInteger(studentIdx) && state.students && state.students[studentIdx] !== undefined;
}

// 상점에서 실제 쓸 수 있는 코인 = 누적 재화(currency) - 지금까지 쓴 금액.
// currency는 점수(하트)와 함께 오르내리지만, "점수 초기화" 버튼의 영향은 받지 않는 별도 값이다.
// 구매해도 점수(자리표에 보이는 값)는 그대로 두고, 쓴 금액만 늘려서 잔액을 줄인다.
function availableCoins(idx) {
  if (!state.currency) state.currency = {};
  if (!state.spent) state.spent = {};
  const currency = state.currency[idx] !== undefined ? state.currency[idx] : (state.scores[idx] || 0);
  return currency - (state.spent[idx] || 0);
}

function ensureAvatarShape(avatar) {
  if (!avatar.inventory) avatar.inventory = ['outfit_basic'];
  if (!avatar.inventory.includes('bg_none')) avatar.inventory.push('bg_none');
  if (!avatar.inventory.includes('frame_none')) avatar.inventory.push('frame_none');
  if (!avatar.inventory.includes('title_none')) avatar.inventory.push('title_none');
  if (!avatar.equipped) avatar.equipped = { outfit: 'outfit_basic' };
  if (!avatar.equipped.outfit) avatar.equipped.outfit = 'outfit_basic';
  if (!avatar.equipped.background) avatar.equipped.background = 'bg_none';
  if (!avatar.equipped.frame) avatar.equipped.frame = 'frame_none';
  if (!avatar.equipped.title) avatar.equipped.title = 'title_none';
}

function findCatalogItem(id) {
  return ITEMS.find(i => i.id === id) || BACKGROUNDS.find(b => b.id === id) || FRAMES.find(f => f.id === id) || TITLES.find(t => t.id === id);
}

function init() {
  if (!studentValid()) {
    document.getElementById('notFound').style.display = 'flex';
    return;
  }
  if (!state.avatars) state.avatars = {};
  if (!state.avatars[studentIdx]) state.avatars[studentIdx] = defaultAvatar();
  const avatar = state.avatars[studentIdx];
  ensureAvatarShape(avatar);
  document.getElementById('studentTitle').textContent = `🍄 ${state.students[studentIdx]}의 아바타`;
  document.getElementById('heartCount').textContent = availableCoins(studentIdx);
  // 성별은 선생님이 지정한다. 아직 지정 전이면 학생은 기다리는 화면만 본다(직접 선택 불가).
  if (!avatar.gender) {
    document.getElementById('genderWait').style.display = 'flex';
    document.getElementById('mainArea').style.display = 'none';
    return;
  }
  showMain();
}

function showMain() {
  document.getElementById('genderWait').style.display = 'none';
  document.getElementById('mainArea').style.display = 'flex';
  render();
}

function render() {
  renderAvatar();
  renderItemGrid();
}

function renderAvatar() {
  const avatar = state.avatars[studentIdx];
  const baseImg = document.getElementById('avatarBaseImg');
  const outfitImg = document.getElementById('avatarOutfitImg');
  const bgImg = document.getElementById('avatarBgImg');
  baseImg.src = GENDER_IMAGES[avatar.gender];

  const bg = BACKGROUNDS.find(b => b.id === avatar.equipped.background);
  if (bg && bg.image) {
    bgImg.src = bg.image;
    bgImg.style.display = 'block';
  } else {
    bgImg.src = '';
    bgImg.style.display = 'none';
  }

  const item = ITEMS.find(i => i.id === avatar.equipped.outfit);
  // if equipped outfit has no image for this gender (e.g. after switching gender), fall back to basic
  if (item && item.id !== 'outfit_basic' && item.images[avatar.gender]) {
    outfitImg.src = item.images[avatar.gender];
    outfitImg.style.display = 'block';
  } else {
    if (!item || !item.images[avatar.gender]) avatar.equipped.outfit = 'outfit_basic';
    outfitImg.src = '';
    outfitImg.style.display = 'none';
  }

  const fr = FRAMES.find(f => f.id === avatar.equipped.frame);
  const corners = ['frameTL', 'frameTR', 'frameBL', 'frameBR'].map(id => document.getElementById(id));
  corners.forEach(el => {
    if (fr && fr.image) {
      el.src = fr.image;
      el.style.display = 'block';
    } else {
      el.src = '';
      el.style.display = 'none';
    }
  });

  const stage = document.getElementById('avatarStage');
  if (fr && fr.color) {
    stage.style.borderWidth = '4px';
    stage.style.borderStyle = 'solid';
    stage.style.borderColor = fr.color;
  } else {
    stage.style.borderWidth = '0';
    stage.style.borderStyle = 'none';
  }

  const title = resolveTitle(avatar);
  const titlePreview = document.getElementById('titlePreview');
  if (title) {
    document.getElementById('titleIcon').src = title.image;
    document.getElementById('titleText').textContent = title.name;
    titlePreview.style.display = 'flex';
  } else {
    titlePreview.style.display = 'none';
  }
}

function bounceAvatar() {
  const stage = document.getElementById('avatarStage');
  stage.classList.remove('bounce');
  void stage.offsetWidth;
  stage.classList.add('bounce');
}

function flashHeart() {
  const el = document.getElementById('heartCount');
  el.classList.remove('flash-down');
  void el.offsetWidth;
  el.classList.add('flash-down');
}

function renderItemGrid() {
  const grid = document.getElementById('itemGrid');
  grid.innerHTML = '';
  const avatar = state.avatars[studentIdx];
  const hearts = availableCoins(studentIdx);
  const catalog = currentCategory === 'background' ? BACKGROUNDS
    : currentCategory === 'frame' ? FRAMES
    : currentCategory === 'title' ? TITLES
    : itemsForGender(avatar.gender);
  const emptyMsg = currentCategory === 'background' ? '아직 보유한 배경이 없어요. 상점에서 구매해보세요!'
    : currentCategory === 'frame' ? '아직 보유한 테두리가 없어요. 상점에서 구매해보세요!'
    : currentCategory === 'title' ? '아직 보유한 칭호가 없어요. 상점에서 구매해보세요!'
    : '아직 보유한 옷이 없어요. 상점에서 구매해보세요!';

  let items = catalog;
  if (currentTab === 'inventory') {
    items = items.filter(i => avatar.inventory.includes(i.id));
  }

  if (!items.length) {
    const msg = document.createElement('div');
    msg.className = 'empty-msg';
    msg.textContent = emptyMsg;
    grid.appendChild(msg);
    return;
  }

  const equippedId = avatar.equipped[currentCategory];

  items.forEach(item => {
    const owned = avatar.inventory.includes(item.id);
    const isEquipped = equippedId === item.id;
    const card = document.createElement('div');
    card.className = 'item-card' + (isEquipped ? ' equipped' : '');

    let actionHtml = '';
    if (currentTab === 'shop') {
      if (owned) {
        actionHtml = `<span class="item-badge">✅ 보유중</span>`;
      } else {
        const disabled = hearts < item.price ? 'disabled' : '';
        actionHtml = `
          <div class="item-price">🪙 ${item.price}</div>
          <button class="btn" data-action="buy" data-id="${item.id}" ${disabled}>구매하기</button>`;
      }
    } else {
      actionHtml = isEquipped
        ? `<button class="btn" disabled>착용중</button>`
        : `<button class="btn" data-action="equip" data-id="${item.id}">장착</button>`;
    }

    const iconSrc = currentCategory === 'outfit' ? item.images[avatar.gender] : item.image;
    card.innerHTML = `
      <div class="item-icon">${iconSrc ? `<img src="${iconSrc}" alt="">` : ''}</div>
      <div class="item-name">${item.name}</div>
      ${actionHtml}`;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-action="buy"]').forEach(btn => {
    btn.addEventListener('click', () => buyItem(btn.dataset.id));
  });
  grid.querySelectorAll('[data-action="equip"]').forEach(btn => {
    btn.addEventListener('click', () => equipItem(btn.dataset.id));
  });
}

function buyItem(id) {
  const item = findCatalogItem(id);
  const avatar = state.avatars[studentIdx];
  if (avatar.inventory.includes(id)) return;

  const hearts = availableCoins(studentIdx);
  if (hearts < item.price) {
    showToast('코인이 부족해요! 💦');
    return;
  }

  if (!state.spent) state.spent = {};
  state.spent[studentIdx] = (state.spent[studentIdx] || 0) + item.price;
  avatar.inventory.push(id);
  saveAvatarState();
  flashHeart();
  document.getElementById('heartCount').textContent = availableCoins(studentIdx);
  showToast(`✅ ${item.name}을(를) 구매했어요!`);
  render();
}

function equipItem(id) {
  const item = findCatalogItem(id);
  const avatar = state.avatars[studentIdx];
  if (BACKGROUNDS.some(b => b.id === id)) {
    avatar.equipped.background = id;
  } else if (FRAMES.some(f => f.id === id)) {
    avatar.equipped.frame = id;
  } else if (TITLES.some(t => t.id === id)) {
    avatar.equipped.title = id;
  } else {
    avatar.equipped.outfit = id;
  }
  saveAvatarState();
  bounceAvatar();
  showToast(`✨ ${item.name} 적용!`);
  render();
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

document.getElementById('backBtn').addEventListener('click', () => location.href = 'index.html');
document.getElementById('backBtn2').addEventListener('click', () => location.href = 'index.html');
document.querySelectorAll('.cat-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    currentCategory = btn.dataset.cat;
    document.querySelectorAll('.cat-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderItemGrid();
  });
});
document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderItemGrid();
  });
});

// ===== 시작: 반 문서 실시간 구독 =====
function isSeated(idx) {
  return !!(state && state.groups && state.groups.some(g => g.members.includes(idx)));
}

// 학급 초기화/학생 삭제/선생님의 기기 초기화 시: 이 기기의 신원을 지우고 입장 화면으로.
// 반 코드는 주소에 실어 보내서, 같은 반이면 코드 재입력 없이 바로 이름 선택 화면이 뜨게 한다.
function leaveToGate() {
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(STUDENT_IDX_KEY);
  localStorage.removeItem(BIND_TOKEN_KEY);
  location.href = classCode ? ('index.html?class=' + classCode) : 'index.html';
}

function bootstrapAvatar() {
  if (!firebaseReady() || !classCode || isNaN(studentIdx)) {
    if (role === 'student') { leaveToGate(); return; }
    document.getElementById('notFound').style.display = 'flex';
    return;
  }
  if (role === 'student') {
    // 학생 기기는 자리표로 돌아갈 수 없으므로 돌아가기 버튼을 숨긴다.
    document.getElementById('backBtn').style.display = 'none';
  }
  docRef = db.collection('classrooms').doc(classCode);
  docRef.onSnapshot(snap => {
    if (!snap.exists) { leaveToGate(); return; }
    if (snap.metadata.hasPendingWrites) return; // 내가 방금 쓴 내용의 메아리는 무시
    state = snap.data();
    if (role === 'student' && !isSeated(studentIdx)) { leaveToGate(); return; }
    // 선생님이 이 자리의 기기 연결을 초기화(연결 회차 상승)했으면 스스로 로그아웃
    if (role === 'student') {
      const serverToken = (state.bindTokens && state.bindTokens[studentIdx]) || 0;
      const myToken = parseInt(localStorage.getItem(BIND_TOKEN_KEY) || '0');
      if (serverToken > myToken) { leaveToGate(); return; }
    }
    init();
  }, () => showToast('⚠️ 서버 연결 오류! 인터넷을 확인해주세요.'));
}
bootstrapAvatar();
