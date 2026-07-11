const NEIS_STORAGE_KEY = 'maple_classroom_neis_v1';
const NEIS_CACHE_KEY = 'maple_classroom_neis_cache_v1';
const TIMETABLE_STORAGE_KEY = 'maple_classroom_timetable_v1';
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const TT_DAYS = ['월', '화', '수', '목', '금'];
const TT_PERIODS = [1, 2, 3, 4, 5, 6];
const SUBJECT_LIST = ['국어', '수학', '사회', '과학', '음악', '미술', '체육', '실과', '영어', '도덕', '창체'];
const SUBJECT_COLORS = {
  '국어': '#FF9466', '수학': '#5BC8FF', '사회': '#FFD966', '과학': '#7ED9A8',
  '음악': '#C9A0FF', '미술': '#FF9ED8', '체육': '#FF6F6F', '실과': '#B08968',
  '영어': '#4FD8C4', '도덕': '#FFB347', '창체': '#B8B8D8'
};

function loadNeisSettings() {
  try {
    const raw = localStorage.getItem(NEIS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function saveNeisSettings(settings) {
  localStorage.setItem(NEIS_STORAGE_KEY, JSON.stringify(settings));
}

// ===== 탭 전환 =====
function switchTab(tab) {
  const isSeat = tab === 'seat';
  document.getElementById('tabSeatBtn').classList.toggle('active', isSeat);
  document.getElementById('tabScheduleBtn').classList.toggle('active', !isSeat);
  document.getElementById('canvas').style.display = isSeat ? '' : 'none';
  document.getElementById('scheduleView').style.display = isSeat ? 'none' : 'block';
  document.getElementById('seatToolbarBtns').style.display = isSeat ? '' : 'none';
  document.getElementById('scheduleToolbarBtns').style.display = isSeat ? 'none' : '';
  if (!isSeat) renderScheduleView();
}
document.getElementById('tabSeatBtn').addEventListener('click', () => switchTab('seat'));
document.getElementById('tabScheduleBtn').addEventListener('click', () => switchTab('schedule'));

// ===== 학교 검색/설정 모달 (급식 조회용) =====
let neisPickedSchool = null;

function openNeisModal() {
  const settings = loadNeisSettings();
  document.getElementById('neisSchoolSearchInput').value = '';
  document.getElementById('neisSchoolList').innerHTML = '';
  neisPickedSchool = settings ? {
    ATPT_OFCDC_SC_CODE: settings.officeCode,
    SD_SCHUL_CODE: settings.schoolCode,
    SCHUL_NM: settings.schoolName,
    SCHUL_KND_SC_NM: settings.schoolKind
  } : null;
  renderSelectedSchool();
  document.getElementById('neisGrade').value = settings ? settings.grade : 3;
  document.getElementById('neisClass').value = settings ? settings.classNm : 1;
  document.getElementById('neisApiKey').value = settings ? (settings.apiKey || '') : '';
  document.getElementById('neisModal').style.display = 'flex';
}

function renderSelectedSchool() {
  const el = document.getElementById('neisSelectedSchool');
  if (!neisPickedSchool) {
    el.textContent = '선택된 학교가 없어요. 위에서 검색 후 선택해주세요.';
    return;
  }
  el.textContent = `✅ 선택됨: ${neisPickedSchool.SCHUL_NM} (${neisPickedSchool.SCHUL_KND_SC_NM || ''})`;
}

async function searchNeisSchool() {
  const name = document.getElementById('neisSchoolSearchInput').value.trim();
  if (!name) { showToast('학교 이름을 입력해주세요.'); return; }
  const list = document.getElementById('neisSchoolList');
  list.innerHTML = '<div class="schedule-empty">검색 중...</div>';
  try {
    const url = `https://open.neis.go.kr/hub/schoolInfo?Type=json&pSize=30&SCHUL_NM=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    const data = await res.json();
    const rows = data && data.schoolInfo && data.schoolInfo[1] && data.schoolInfo[1].row;
    if (!rows || !rows.length) {
      list.innerHTML = '<div class="schedule-empty">검색 결과가 없어요. 학교 이름을 다시 확인해주세요.</div>';
      return;
    }
    list.innerHTML = rows.map((s, i) => `
      <div class="neis-school-item" data-idx="${i}">
        <div class="neis-school-name">${escHtml(s.SCHUL_NM)}</div>
        <div class="neis-school-meta">${escHtml(s.SCHUL_KND_SC_NM || '')} · ${escHtml(s.ORG_RDNMA || '')}</div>
      </div>`).join('');
    list.querySelectorAll('.neis-school-item').forEach(el => {
      el.addEventListener('click', () => {
        neisPickedSchool = rows[parseInt(el.dataset.idx)];
        renderSelectedSchool();
        showToast(`✅ ${neisPickedSchool.SCHUL_NM} 선택됨`);
      });
    });
  } catch (e) {
    list.innerHTML = '<div class="schedule-empty">검색 중 오류가 발생했어요. 인터넷 연결을 확인해주세요.</div>';
  }
}

function saveNeisModal() {
  if (!neisPickedSchool) { showToast('학교를 검색해서 선택해주세요.'); return; }
  const grade = parseInt(document.getElementById('neisGrade').value) || 1;
  const classNm = parseInt(document.getElementById('neisClass').value) || 1;
  const apiKey = document.getElementById('neisApiKey').value.trim();
  saveNeisSettings({
    officeCode: neisPickedSchool.ATPT_OFCDC_SC_CODE,
    schoolCode: neisPickedSchool.SD_SCHUL_CODE,
    schoolName: neisPickedSchool.SCHUL_NM,
    schoolKind: neisPickedSchool.SCHUL_KND_SC_NM,
    grade, classNm, apiKey
  });
  localStorage.removeItem(NEIS_CACHE_KEY);
  document.getElementById('neisModal').style.display = 'none';
  showToast('✅ 저장했어요. 급식을 불러올게요.');
  renderScheduleView(true);
}

document.getElementById('neisSettingBtn').addEventListener('click', openNeisModal);
document.getElementById('cancelNeisBtn').addEventListener('click', () => {
  document.getElementById('neisModal').style.display = 'none';
});
document.getElementById('neisSchoolSearchBtn').addEventListener('click', searchNeisSchool);
document.getElementById('saveNeisBtn').addEventListener('click', saveNeisModal);
document.getElementById('scheduleRefreshBtn').addEventListener('click', () => {
  localStorage.removeItem(NEIS_CACHE_KEY);
  renderScheduleView(true);
});

// ===== 날짜 계산 =====
function ymd(date) {
  return `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
}

function thisWeekMonToFri() {
  const now = new Date();
  const day = now.getDay(); // 0=일 ~ 6=토
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return { from: ymd(mon), to: ymd(fri) };
}

function todayKorWeekday() {
  return WEEKDAY_NAMES[new Date().getDay()];
}

async function fetchNeisJson(endpoint, params) {
  const usp = new URLSearchParams({ Type: 'json', pSize: '100', ...params });
  const res = await fetch(`https://open.neis.go.kr/hub/${endpoint}?${usp.toString()}`);
  const data = await res.json();
  const body = data && data[endpoint];
  if (!body) return [];
  const rowsPart = body.find(p => p.row);
  return rowsPart ? rowsPart.row : [];
}

// ===== 시간표 (교사가 직접 설정, 매주 고정) =====
function loadManualTimetable() {
  try {
    const raw = localStorage.getItem(TIMETABLE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}

function saveManualTimetable(tt) {
  localStorage.setItem(TIMETABLE_STORAGE_KEY, JSON.stringify(tt));
}

let subjectPickTarget = null; // { day, period }

function renderTimetable() {
  const wrap = document.getElementById('timetableWrap');
  const tt = loadManualTimetable();
  const today = todayKorWeekday();

  let html = '<div class="timetable-table-wrap"><table class="timetable-table"><thead><tr><th></th>';
  TT_DAYS.forEach(d => html += `<th class="${d === today ? 'today-col' : ''}">${d}요일</th>`);
  html += '</tr></thead><tbody>';
  TT_PERIODS.forEach(p => {
    html += `<tr><th>${p}교시</th>`;
    TT_DAYS.forEach(d => {
      const subject = (tt[d] && tt[d][p]) || '';
      const color = SUBJECT_COLORS[subject];
      const chip = subject
        ? `<span class="subject-chip" style="background:${color}">${escHtml(subject)}</span>`
        : `<span class="subject-chip subject-chip-empty">＋</span>`;
      html += `<td class="subject-cell${d === today ? ' today-col' : ''}" data-day="${d}" data-period="${p}">${chip}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.subject-cell').forEach(cell => {
    cell.addEventListener('click', () => openSubjectPick(cell.dataset.day, parseInt(cell.dataset.period)));
  });
}

function openSubjectPick(day, period) {
  subjectPickTarget = { day, period };
  document.getElementById('subjectPickTitle').textContent = `✏️ ${day}요일 ${period}교시 과목 선택`;
  const grid = document.getElementById('subjectPickGrid');
  grid.innerHTML = SUBJECT_LIST.map(s => `
    <button type="button" class="subject-pick-btn" style="background:${SUBJECT_COLORS[s]}" data-subject="${s}">${s}</button>
  `).join('') + `<button type="button" class="subject-pick-btn subject-pick-clear" data-subject="">비우기</button>`;
  grid.querySelectorAll('.subject-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => pickSubject(btn.dataset.subject));
  });
  document.getElementById('subjectPickModal').style.display = 'flex';
}

function pickSubject(subject) {
  const { day, period } = subjectPickTarget;
  const tt = loadManualTimetable();
  if (!tt[day]) tt[day] = {};
  if (subject) tt[day][period] = subject;
  else delete tt[day][period];
  saveManualTimetable(tt);
  document.getElementById('subjectPickModal').style.display = 'none';
  renderTimetable();
}

document.getElementById('cancelSubjectPickBtn').addEventListener('click', () => {
  document.getElementById('subjectPickModal').style.display = 'none';
});

// ===== 급식 (나이스 자동 연동) =====
function dateLabel(yyyymmdd) {
  const y = yyyymmdd.slice(0,4), m = parseInt(yyyymmdd.slice(4,6)), d = parseInt(yyyymmdd.slice(6,8));
  const dow = WEEKDAY_NAMES[new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`).getDay()];
  return `${m}/${d} (${dow})`;
}

function renderMeal(rows) {
  const wrap = document.getElementById('mealWrap');
  if (!rows || !rows.length) {
    wrap.innerHTML = '<div class="schedule-empty">이번 주 급식 정보가 없어요.</div>';
    return;
  }
  const todayStr = ymd(new Date());
  const sorted = [...rows].sort((a,b) => a.MLSV_YMD.localeCompare(b.MLSV_YMD));
  const cards = sorted.map(r => {
    const dishes = (r.DDISH_NM || '').split('<br/>').map(d => d.replace(/\([0-9.]+\)/g, '').trim()).filter(Boolean);
    const isToday = r.MLSV_YMD === todayStr;
    return `
      <div class="meal-card${isToday ? ' today-meal' : ''}">
        <div class="meal-date">${isToday ? '👉 ' : ''}${dateLabel(r.MLSV_YMD)}</div>
        <ul class="meal-dish-list">${dishes.map(d => `<li>${escHtml(d)}</li>`).join('')}</ul>
      </div>`;
  }).join('');
  wrap.innerHTML = `<div class="meal-list">${cards}</div>`;
}

// ===== 전체 렌더링 =====
async function renderScheduleView(forceRefresh) {
  renderTimetable();

  const settings = loadNeisSettings();
  const schoolLabel = document.getElementById('scheduleSchoolLabel');
  if (!settings) {
    schoolLabel.textContent = '🏫 학교를 설정하면 급식 메뉴도 볼 수 있어요. (⚙️ 학교/학년반 설정)';
    document.getElementById('mealWrap').innerHTML = '<div class="schedule-empty">학교를 설정하면 급식 메뉴를 볼 수 있어요.</div>';
    return;
  }
  schoolLabel.textContent = `🏫 ${settings.schoolName} · ${settings.grade}학년 ${settings.classNm}반`;

  const range = thisWeekMonToFri();
  const cacheKey = `${settings.schoolCode}_${range.from}_${range.to}`;
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(NEIS_CACHE_KEY) || 'null'); } catch(e) {}

  if (!forceRefresh && cache && cache.key === cacheKey) {
    renderMeal(cache.meal);
    return;
  }

  document.getElementById('mealWrap').innerHTML = '<div class="schedule-empty">불러오는 중...</div>';

  const keyParam = settings.apiKey ? { KEY: settings.apiKey } : {};
  try {
    const meal = await fetchNeisJson('mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: settings.officeCode,
      SD_SCHUL_CODE: settings.schoolCode,
      MLSV_FROM_YMD: range.from,
      MLSV_TO_YMD: range.to,
      ...keyParam
    });
    localStorage.setItem(NEIS_CACHE_KEY, JSON.stringify({ key: cacheKey, meal }));
    renderMeal(meal);
  } catch (e) {
    document.getElementById('mealWrap').innerHTML = '<div class="schedule-empty">불러오지 못했어요. 인터넷 연결이나 학교 설정을 확인해주세요.</div>';
  }
}
