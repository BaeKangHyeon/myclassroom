// ===== 뽑기 (구슬 경주) =====
// lazygyu의 Marble Roulette에서 아이디어를 얻어 직접 만든 간단 물리 경주.
// 참가 학생들이 구슬이 되어 못(peg)·지그재그 경사로·깔때기를 지나 굴러 내려가고,
// 결승선에 먼저 도착한 순서대로 당첨된다.
// 외부 라이브러리 없이 캔버스 + 자체 원/선분 충돌 계산으로 동작한다.
(() => {

const RACE_W = 900;        // 코스의 논리적 폭 (화면 크기와 무관, 그리기 때 배율로 맞춤)
const MARBLE_R = 13;       // 구슬 반지름
const GRAV = 2600;         // 중력 가속도 (px/s²) - 한 판 10~15초 목표로 상향
const MAX_SPEED = 1500;    // 최고 속도 제한 (벽 뚫기 방지: 서브스텝당 이동량 < 구슬 반지름)
const REST_WALL = 0.3;     // 벽 반발력 (튀는 정도)
const REST_PEG = 0.55;     // 못 반발력
const SUBSTEPS = 4;        // 프레임당 물리 계산 나누기 (정확도, 속도 상향분 만큼 늘려 벽 뚫기 방지)
const MAX_RUN_TIME = 22;   // 안전장치: 이 시간(초)이 지나면 남은 구슬은 현재 위치 순으로 강제 완주 처리

const MARBLE_COLORS = [
  '#FF6F6F', '#5BC8FF', '#FFD24D', '#7ED9A8', '#C9A0FF', '#FF9ED8',
  '#4FD8C4', '#FFB347', '#9FB6FF', '#FF9466', '#B8E356', '#FF7FB2',
  '#6FD3FF', '#E8C06A', '#A0E8B0', '#D8A0FF', '#FF8F8F', '#7FE0D0',
  '#FFC97A', '#B0C4FF', '#D0E060', '#FFA0C8', '#8FD8FF', '#F0B860'
];

// 맵별 못(peg) 이미지: 큰 원본을 매번 그리면 느려서, 로드 때 한 번만
// 작은 원형 캔버스로 축소해두고 (회색 배경은 투명 처리) 그걸 그린다.
const PEG_SKINS = { classic: 'assets/1.png', seesaw: 'assets/2.png', storm: 'assets/3.png' };
const pegSkinCanvas = {};
for (const key of Object.keys(PEG_SKINS)) {
  const img = new Image();
  img.onload = () => {
    const s = 64;
    // 1단계: 원본에 그려진 지저분한 테두리 원이 안 들어오게 깊게(16%) 잘라내고,
    //         배경으로 깔린 회색(무채색 중간 밝기)을 투명 처리
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = s;
    const tc = tmp.getContext('2d');
    tc.beginPath(); tc.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); tc.clip();
    const m = img.width * 0.16;
    tc.drawImage(img, m, m, img.width - m * 2, img.height - m * 2, 0, 0, s, s);
    const d = tc.getImageData(0, 0, s, s);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 90 && r < 215) px[i + 3] = 0;
    }
    tc.putImageData(d, 0, 0);
    // 2단계: 크림색 바탕 원 + 캐릭터 + 깔끔한 갈색 테두리 원으로 토큰 완성
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const cx = cv.getContext('2d');
    cx.beginPath(); cx.arc(s / 2, s / 2, s / 2 - 1.5, 0, Math.PI * 2);
    cx.fillStyle = '#FFF8E7'; cx.fill();
    cx.save(); cx.clip(); cx.drawImage(tmp, 0, 0); cx.restore();
    cx.beginPath(); cx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    cx.lineWidth = 4; cx.strokeStyle = '#C8860C'; cx.stroke();
    pegSkinCanvas[key] = cv;
    // 상단 맵 선택 버튼의 아이콘에도 같은 토큰을 사용
    document.querySelectorAll('img[data-mapicon="' + key + '"]').forEach(el => { el.src = cv.toDataURL(); });
  };
  img.src = PEG_SKINS[key];
}

let raceExcluded = new Set();  // 참가자 선택 모달에서 체크 해제한 학생 idx
let race = null;               // 진행 중인 경주 전체 상태 (null이면 대기 화면)
let raceAnimId = 0;

// ---------- 참가자 ----------
// 반 데이터가 있으면 자리에 앉은 학생들, 없으면(연습용) 가짜 이름 10명
function getRaceRoster() {
  if (typeof state !== 'undefined' && state && state.groups) {
    return seatedIndices().map(idx => ({ idx, name: state.students[idx] || '?' }));
  }
  return Array.from({ length: 10 }, (_, i) => ({ idx: 'demo' + i, name: '연습' + (i + 1) }));
}

function getRacePlayers() {
  return getRaceRoster().filter(p => !raceExcluded.has(p.idx));
}

// ---------- 유틸 ----------
function rRand(a, b) { return a + Math.random() * (b - a); }
function rShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function seg(x1, y1, x2, y2) {
  return { x1, y1, x2, y2, minY: Math.min(y1, y2), maxY: Math.max(y1, y2) };
}

// ---------- 코스 생성 ----------
// 매 경주마다 못 위치·깔때기 구멍·구간 순서가 조금씩 달라져서 결과 예측이 안 된다.
function buildCourse(n, mapType) {
  // 코스 구성요소를 한 객체(c)에 모아 구간 함수에 넘긴다.
  const c = { walls: [], pegs: [], spinners: [], seesaws: [], pendulums: [] };
  const W = RACE_W;

  // 시작 구역: 구슬들이 줄지어 놓일 공간
  const startCols = Math.min(Math.max(n, 4), 12);
  const startRows = Math.ceil(n / startCols);
  let y = 100 + startRows * 34;

  // 시작 깔때기: 전체 폭을 가운데로 모아줌
  c.walls.push(seg(0, y, W / 2 - 140, y + 170));
  c.walls.push(seg(W, y, W / 2 + 140, y + 170));
  y += 200;

  // 본 코스: 구간들을 무작위 순서로 이어붙임 (짧게 유지해 한 판이 오래 안 걸리게)
  let sections;
  if (mapType === 'storm') {
    // 폭풍 맵: 회전 막대가 곳곳에서 구슬을 튕겨내 순위가 계속 뒤집힌다.
    sections = rShuffle(['pegs', 'spinner', 'zigzag', 'funnel']);
    sections.push('windmill'); // 피날레: 가운데로 모아 큰 바람개비에 반드시 맞게 한다
  } else if (mapType === 'seesaw') {
    // 시소·진자 맵: 시소가 무게에 따라 기울고 진자가 후려쳐 역전이 잦다.
    sections = rShuffle(['seesaw', 'pendulum', 'miniseesaw', 'seesaw', 'miniseesaw', 'pendulum']);
    sections.push('pegs'); // 결승 직전 마지막 뒤섞기
  } else {
    sections = rShuffle(['pegs', 'zigzag', 'funnel']);
    sections.push('pegs');
  }
  for (const s of sections) y = addSection(s, y, c);

  const finishY = y + 220;
  const height = finishY + 260;

  // 양옆 벽 + 바닥
  c.walls.push(seg(0, 0, 0, height));
  c.walls.push(seg(W, 0, W, height));
  c.walls.push(seg(0, height - 10, W, height - 10));

  return { ...c, mapType, finishY, height, startCols, startRows };
}

function addSection(type, y, c) {
  const W = RACE_W;
  if (type === 'pegs') {
    // 못 격자 (플링코): 줄마다 반 칸씩 엇갈리고, 위치가 조금씩 흔들림
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) ? 45 : 0;
      for (let x = 60 + offset; x < W - 40; x += 90) {
        c.pegs.push({ x: x + rRand(-12, 12), y: y + 90 + r * 78 + rRand(-8, 8), r: 16 });
      }
    }
    return y + 90 + rows * 78 + 50;
  }
  if (type === 'zigzag') {
    // 좌우 번갈아 경사로: 끝의 빈 구멍으로 우르르 쏟아짐
    let yy = y + 40;
    const startLeft = Math.random() < 0.5;
    for (let i = 0; i < 3; i++) {
      const fromLeft = startLeft ? (i % 2 === 0) : (i % 2 === 1);
      if (fromLeft) c.walls.push(seg(0, yy, W - 190, yy + 130));
      else c.walls.push(seg(W, yy, 190, yy + 130));
      yy += 195;
    }
    return yy + 45;
  }
  if (type === 'spinner') {
    // 회전 막대: 중심축을 기준으로 도는 팔이 구슬을 사방으로 튕겨낸다 (폭풍 맵)
    const count = Math.random() < 0.45 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const cxs = count === 1 ? W / 2 + rRand(-60, 60)
                              : (i === 0 ? W * 0.30 : W * 0.70);
      c.spinners.push({
        cx: cxs, cy: y + 150,
        len: rRand(95, 135), half: 9,
        arms: Math.random() < 0.5 ? 2 : 3,
        angle: rRand(0, Math.PI * 2),
        omega: rRand(1.8, 3.4) * (Math.random() < 0.5 ? -1 : 1)
      });
    }
    return y + 320;
  }
  if (type === 'windmill') {
    // 피날레: 가운데로 모으는 넓은 깔때기 아래 정중앙 큰 바람개비.
    // 목(gap)을 넓게 두고 회전팔은 목 아래에 둬서, 끼임 없이 모든 구슬이 바람개비에 맞고 튄다.
    const cx = W / 2, gap = 200;
    c.walls.push(seg(0, y + 20, cx - gap / 2, y + 190));
    c.walls.push(seg(W, y + 20, cx + gap / 2, y + 190));
    c.spinners.push({
      cx, cy: y + 345, len: 135, half: 12, arms: 4,
      angle: rRand(0, Math.PI * 2),
      omega: rRand(2.2, 3.2) * (Math.random() < 0.5 ? -1 : 1)
    });
    return y + 520;
  }
  if (type === 'seesaw') {
    // 시소 2개를 좌우에 높이를 엇갈려 배치해 전체 폭을 빈틈없이 덮는다.
    // 어느 쪽으로 떨어져도 반드시 시소 판 위에 착지 → 무게로 기울면 한쪽으로 쏟아짐.
    // 양끝 벽에 붙어 내려오는 구슬은 짧은 턱으로 안쪽으로 밀어 넣는다.
    c.walls.push(seg(0, y, 70, y + 90));
    c.walls.push(seg(W, y, W - 70, y + 90));
    const leftHigh = Math.random() < 0.5;
    c.seesaws.push({
      cx: W * 0.27 + rRand(-10, 10), cy: y + (leftHigh ? 140 : 260),
      len: 200, half: 10,
      angle: rRand(-0.15, 0.15), omega: 0, maxTilt: 0.55
    });
    c.seesaws.push({
      cx: W * 0.73 + rRand(-10, 10), cy: y + (leftHigh ? 260 : 140),
      len: 200, half: 10,
      angle: rRand(-0.15, 0.15), omega: 0, maxTilt: 0.55
    });
    return y + 440;
  }
  if (type === 'pendulum') {
    // 진자 2개가 좌·우에서 반대 방향으로 스윙하며 넓게 휩쓴다.
    c.walls.push(seg(0, y, 70, y + 90));
    c.walls.push(seg(W, y, W - 70, y + 90));
    for (let i = 0; i < 2; i++) {
      c.pendulums.push({
        px: W * (i === 0 ? 0.3 : 0.7) + rRand(-20, 20), py: y + 20,
        L: rRand(160, 185), r: 28,
        // 큰 각도에서 놓아 진폭을 크게 유지(감쇠 없음), 서로 반대 방향에서 시작
        theta: rRand(0.9, 1.15) * (i === 0 ? -1 : 1),
        thetaDot: 0
      });
    }
    return y + 360;
  }
  if (type === 'miniseesaw') {
    // 작은 시소 3개가 좌·중·우에 흩어져 있다. 판이 짧아 조금만 무거워도 홱 뒤집혀
    // 구슬을 예측 못 할 방향으로 쏟아낸다.
    c.walls.push(seg(0, y, 70, y + 90));
    c.walls.push(seg(W, y, W - 70, y + 90));
    for (let i = 0; i < 3; i++) {
      c.seesaws.push({
        cx: W * (0.2 + 0.3 * i) + rRand(-25, 25),
        cy: y + (i === 1 ? 210 : 120) + rRand(-15, 15), // 가운데만 낮춰 지그재그로 통과
        len: rRand(95, 115), half: 9,
        angle: rRand(-0.2, 0.2), omega: 0, maxTilt: 0.65
      });
    }
    return y + 340;
  }
  // funnel: 좁은 구멍 하나로만 통과 (병목에서 순위가 뒤집힘)
  const gap = 95;
  const cx = rRand(W * 0.3, W * 0.7);
  c.walls.push(seg(0, y + 40, cx - gap / 2, y + 210));
  c.walls.push(seg(W, y + 40, cx + gap / 2, y + 210));
  c.walls.push(seg(cx - gap / 2, y + 210, cx - gap / 2, y + 255));
  c.walls.push(seg(cx + gap / 2, y + 210, cx + gap / 2, y + 255));
  return y + 320;
}

// ---------- 경주 시작/종료 ----------
function startRace() {
  const players = getRacePlayers();
  if (players.length < 2) { showToast('⚠️ 참가자가 2명 이상 필요해요.'); return; }

  const cntInput = document.getElementById('raceWinnerCount');
  let winnersNeeded = parseInt(cntInput.value, 10);
  if (!winnersNeeded || winnersNeeded < 1) winnersNeeded = 1;
  winnersNeeded = Math.min(winnersNeeded, players.length);
  cntInput.value = winnersNeeded;

  fitRaceCanvas(); // 탭 전환 직후 등 캔버스 크기가 안 잡혀 있을 수 있어 시작 때마다 다시 맞춤
  const activeMap = document.querySelector('.map-opt.active');
  const course = buildCourse(players.length, activeMap ? activeMap.dataset.map : 'storm');

  // 출발 위치: 순서를 섞어서 격자로 배치 (자리 순서 유리함 없음)
  const shuffled = rShuffle([...players]);
  const cellW = (RACE_W - 100) / course.startCols;
  const marbles = shuffled.map((p, i) => ({
    name: p.name,
    color: MARBLE_COLORS[i % MARBLE_COLORS.length],
    x: 50 + cellW * ((i % course.startCols) + 0.5) + rRand(-6, 6),
    y: 50 + Math.floor(i / course.startCols) * 32,
    vx: 0, vy: 0,
    finished: false,
    still: 0 // 멈춰 있는 시간 (끼임 방지용)
  }));

  race = {
    course, marbles, winnersNeeded,
    ranks: [],            // 결승선 통과 순서대로 {name, color}
    phase: 'countdown',   // countdown → running → done
    countLeft: 3.6,
    camY: 0,
    timeScale: 1,
    runTime: 0,           // 실제로 달린 시간(초) - 안전장치용
    doneTimer: 0,
    lastTs: 0
  };
  document.getElementById('raceResultOverlay').style.display = 'none';
  cancelAnimationFrame(raceAnimId);
  raceAnimId = requestAnimationFrame(raceLoop);
}

function stopRace() {
  cancelAnimationFrame(raceAnimId);
  race = null;
  document.getElementById('raceResultOverlay').style.display = 'none';
  drawIdle();
}

// ---------- 물리 ----------
// 움직이는 장애물(회전 막대·시소·진자)을 한 서브스텝(h초)만큼 진행시킨다.
function updateObstacles(r, h) {
  const c = r.course;
  if (c.spinners) for (const sp of c.spinners) sp.angle += sp.omega * h;

  if (c.pendulums) for (const pd of c.pendulums) {
    // 단진자: θ'' = -(g/L)·sinθ (감쇠 없이 계속 흔들림)
    pd.thetaDot += (-(GRAV / pd.L) * Math.sin(pd.theta)) * h;
    pd.theta += pd.thetaDot * h;
  }

  if (c.seesaws) for (const sw of c.seesaws) {
    // 시소 위(축 주변)에 올라탄 구슬들의 무게로 토크 계산 → 무거운 쪽으로 기운다.
    let torque = 0;
    for (const m of r.marbles) {
      if (m.finished || Math.abs(m.x - sw.cx) > sw.len) continue;
      if (m.y > sw.cy - 55 && m.y < sw.cy + 35) torque += (m.x - sw.cx) / sw.len;
    }
    // 무게토크 + 복원(수평으로) + 감쇠 — 작은 무게 차이에도 확 기울도록 토크를 크게, 복원은 약하게
    sw.omega += (torque * 14 - sw.angle * 2.2 - sw.omega * 2.6) * h;
    sw.angle += sw.omega * h;
    if (sw.angle > sw.maxTilt) { sw.angle = sw.maxTilt; sw.omega *= -0.2; }
    if (sw.angle < -sw.maxTilt) { sw.angle = -sw.maxTilt; sw.omega *= -0.2; }
  }
}

function stepPhysics(r, dt) {
  const h = (dt / SUBSTEPS) * r.timeScale;
  for (let s = 0; s < SUBSTEPS; s++) {
    updateObstacles(r, h);
    for (const m of r.marbles) {
      if (m.finished) continue;
      m.vy += GRAV * h;
      const sp = Math.hypot(m.vx, m.vy);
      if (sp > MAX_SPEED) { m.vx *= MAX_SPEED / sp; m.vy *= MAX_SPEED / sp; }
      m.x += m.vx * h;
      m.y += m.vy * h;
    }
    collideAll(r);
  }

  // 끼임 방지: 한동안 거의 안 움직이면 살짝 흔들어줌
  for (const m of r.marbles) {
    if (m.finished) continue;
    if (Math.hypot(m.vx, m.vy) < 25) {
      m.still += dt;
      if (m.still > 0.8) { m.vx += rRand(-1, 1) * 220; m.vy -= rRand(40, 110); m.still = 0; }
    } else m.still = 0;
  }

  // 결승선 통과 확인
  for (const m of r.marbles) {
    if (!m.finished && m.y > r.course.finishY + MARBLE_R) {
      m.finished = true;
      r.ranks.push({ name: m.name, color: m.color });
    }
  }
}

function collideAll(r) {
  const { walls, pegs, spinners, seesaws, pendulums } = r.course;
  const ms = r.marbles;

  for (const m of ms) {
    if (m.finished) continue;
    for (const w of walls) {
      if (m.y < w.minY - 40 || m.y > w.maxY + 40) continue;
      collideSeg(m, w, REST_WALL);
    }
    for (const p of pegs) {
      if (Math.abs(m.y - p.y) > 40) continue;
      collideCircle(m, p, REST_PEG);
    }
    if (spinners) {
      for (const sp of spinners) {
        if (Math.abs(m.y - sp.cy) > sp.len + 40) continue;
        collideCircle(m, { x: sp.cx, y: sp.cy, r: sp.half + 5 }, REST_PEG); // 중심 허브
        for (let k = 0; k < sp.arms; k++) {
          const a = sp.angle + k * (Math.PI * 2 / sp.arms);
          collideMovingSeg(m, sp.cx, sp.cy,
            sp.cx + Math.cos(a) * sp.len, sp.cy + Math.sin(a) * sp.len,
            sp.cx, sp.cy, sp.omega, sp.half, REST_PEG);
        }
      }
    }
    if (seesaws) {
      for (const sw of seesaws) {
        if (Math.abs(m.y - sw.cy) > sw.len + 40) continue;
        const ca = Math.cos(sw.angle), sa = Math.sin(sw.angle);
        collideMovingSeg(m, sw.cx - ca * sw.len, sw.cy - sa * sw.len,
          sw.cx + ca * sw.len, sw.cy + sa * sw.len,
          sw.cx, sw.cy, sw.omega, sw.half, REST_WALL);
      }
    }
    if (pendulums) {
      for (const pd of pendulums) {
        const bx = pd.px + Math.sin(pd.theta) * pd.L;
        const by = pd.py + Math.cos(pd.theta) * pd.L;
        if (Math.abs(m.y - by) > pd.r + 40) continue;
        // 추의 순간 속도 (v = d/dt of 위치)
        const bvx = Math.cos(pd.theta) * pd.thetaDot * pd.L;
        const bvy = -Math.sin(pd.theta) * pd.thetaDot * pd.L;
        collideMovingCircle(m, bx, by, pd.r, bvx, bvy, REST_PEG);
      }
    }
  }

  // 구슬끼리 충돌
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i];
    if (a.finished) continue;
    for (let j = i + 1; j < ms.length; j++) {
      const b = ms[j];
      if (b.finished) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= MARBLE_R * 2 || d === 0) continue;
      dx /= d; dy /= d;
      const overlap = (MARBLE_R * 2 - d) / 2;
      a.x -= dx * overlap; a.y -= dy * overlap;
      b.x += dx * overlap; b.y += dy * overlap;
      // 서로 다가가는 중일 때만 속도 교환 (질량 동일 가정)
      const rel = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
      if (rel < 0) {
        const imp = -rel * 0.75;
        a.vx -= dx * imp; a.vy -= dy * imp;
        b.vx += dx * imp; b.vy += dy * imp;
      }
    }
  }
}

// 구슬-선분 충돌: 선분 위 가장 가까운 점을 찾아 겹친 만큼 밀어내고 속도를 반사
function collideSeg(m, s, rest) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((m.x - s.x1) * dx + (m.y - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = s.x1 + t * dx, py = s.y1 + t * dy;
  let nx = m.x - px, ny = m.y - py;
  const d = Math.hypot(nx, ny);
  const wallHalf = 5; // 벽 두께의 절반
  if (d >= MARBLE_R + wallHalf) return;
  if (d < 0.0001) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  const overlap = MARBLE_R + wallHalf - d;
  m.x += nx * overlap; m.y += ny * overlap;
  const vn = m.vx * nx + m.vy * ny;
  if (vn < 0) {
    m.vx -= (1 + rest) * vn * nx;
    m.vy -= (1 + rest) * vn * ny;
    m.vx *= 0.995; m.vy *= 0.995; // 벽 타고 미끄러질 때 마찰
  }
}

// 회전하는 막대(움직이는 선분)와의 충돌: 접점의 표면 속도를 반영해 구슬을 튕겨낸다.
function collideMovingSeg(m, x1, y1, x2, y2, cx, cy, omega, half, rest) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((m.x - x1) * dx + (m.y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx, py = y1 + t * dy;
  let nx = m.x - px, ny = m.y - py;
  const d = Math.hypot(nx, ny);
  if (d >= MARBLE_R + half) return;
  if (d < 0.0001) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
  m.x += nx * (MARBLE_R + half - d);
  m.y += ny * (MARBLE_R + half - d);
  // 접점에서 막대 표면이 도는 속도 (v = ω × r). 이걸 반영해야 구슬이 튕겨 날아간다.
  const svx = -omega * (py - cy), svy = omega * (px - cx);
  const rvn = (m.vx - svx) * nx + (m.vy - svy) * ny; // 표면 대비 상대 속도의 법선 성분
  if (rvn < 0) {
    const j = (1 + rest) * rvn;
    m.vx -= j * nx; m.vy -= j * ny;
  }
}

// 움직이는 원(진자 추)과의 충돌: 추의 순간 속도를 반영해 구슬을 후려친다.
function collideMovingCircle(m, cx, cy, cr, cvx, cvy, rest) {
  let nx = m.x - cx, ny = m.y - cy;
  const d = Math.hypot(nx, ny);
  if (d >= MARBLE_R + cr || d === 0) return;
  nx /= d; ny /= d;
  m.x += nx * (MARBLE_R + cr - d);
  m.y += ny * (MARBLE_R + cr - d);
  const rvn = (m.vx - cvx) * nx + (m.vy - cvy) * ny;
  if (rvn < 0) {
    const j = (1 + rest) * rvn;
    m.vx -= j * nx; m.vy -= j * ny;
  }
}

function collideCircle(m, c, rest) {
  let nx = m.x - c.x, ny = m.y - c.y;
  const d = Math.hypot(nx, ny);
  if (d >= MARBLE_R + c.r || d === 0) return;
  nx /= d; ny /= d;
  const overlap = MARBLE_R + c.r - d;
  m.x += nx * overlap; m.y += ny * overlap;
  const vn = m.vx * nx + m.vy * ny;
  if (vn < 0) {
    m.vx -= (1 + rest) * vn * nx;
    m.vy -= (1 + rest) * vn * ny;
  }
}

// ---------- 메인 루프 ----------
function raceLoop(ts) {
  const r = race;
  if (!r) return;
  if (!r.lastTs) r.lastTs = ts;
  const dt = Math.min((ts - r.lastTs) / 1000, 0.05); // 탭 전환 등으로 프레임이 밀려도 폭주 방지
  r.lastTs = ts;

  if (r.phase === 'countdown') {
    r.countLeft -= dt;
    if (r.countLeft <= 0) r.phase = 'running';
  } else if (r.phase === 'running') {
    r.runTime += dt;
    // 아직 아무도 못 들어온 상태에서 선두가 결승선에 다가가면 딱 한 번 슬로모션 (1등 결정 순간의 긴장감).
    // 그 뒤로는 정상 속도로 나머지 전원이 빠르게 완주한다.
    const alive = r.marbles.filter(m => !m.finished);
    const leaderY = alive.length ? Math.max(...alive.map(m => m.y)) : r.course.finishY;
    r.timeScale = (r.ranks.length === 0 && leaderY > r.course.finishY - 300) ? 0.45 : 1;
    stepPhysics(r, dt);
    // 안전장치: 끼여서 안 내려오는 구슬이 있어도 일정 시간이 지나면 현재 높이 순으로 강제 완주
    if (r.runTime > MAX_RUN_TIME && alive.length) {
      alive.sort((a, b) => b.y - a.y).forEach(m => {
        m.finished = true;
        r.ranks.push({ name: m.name, color: m.color });
      });
    }
    // 전원이 결승선을 통과하면 종료 (1등만 정해져도 끝내지 않고 꼴등까지 본다)
    if (r.marbles.every(m => m.finished)) { r.phase = 'done'; r.doneTimer = 0; }
  } else if (r.phase === 'done') {
    r.timeScale = 1;
    r.doneTimer += dt;
    const overlay = document.getElementById('raceResultOverlay');
    if (r.doneTimer > 0.6 && overlay.style.display === 'none') showRaceResult(r);
  }

  updateCamera(r, dt);
  drawRace(r);
  raceAnimId = requestAnimationFrame(raceLoop);
}

function updateCamera(r, dt) {
  const ch = raceCanvasSize().h / raceScale();
  let target = 0;
  if (r.phase !== 'countdown') {
    const alive = r.marbles.filter(m => !m.finished);
    const leaderY = alive.length ? Math.max(...alive.map(m => m.y)) : r.course.finishY;
    target = Math.max(0, Math.min(leaderY - ch * 0.42, r.course.height - ch));
  }
  r.camY += (target - r.camY) * Math.min(1, dt * 5);
}

// ---------- 그리기 ----------
function raceCanvasSize() {
  const cv = document.getElementById('raceCanvas');
  return { w: cv.clientWidth, h: cv.clientHeight };
}
function raceScale() {
  return Math.min(raceCanvasSize().w / RACE_W, 1.4);
}

function fitRaceCanvas() {
  const cv = document.getElementById('raceCanvas');
  const dpr = window.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr;
  cv.height = cv.clientHeight * dpr;
}

function drawRace(r) {
  const cv = document.getElementById('raceCanvas');
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const { w: cw, h: chPx } = raceCanvasSize();
  const scale = raceScale();
  const offX = (cw - RACE_W * scale) / 2;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#2E2317';
  ctx.fillRect(0, 0, cw, chPx);

  // 카메라 적용 (이후 좌표는 전부 코스 논리 좌표)
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, -dpr * scale * r.camY);
  const viewTop = r.camY - 40, viewBot = r.camY + chPx / scale + 40;

  // 코스 바탕 + 속도감용 가로 줄무늬
  ctx.fillStyle = '#FBF3DF';
  ctx.fillRect(0, viewTop, RACE_W, viewBot - viewTop);
  ctx.fillStyle = 'rgba(160,98,42,0.06)';
  for (let y = Math.floor(viewTop / 200) * 200; y < viewBot; y += 200) {
    ctx.fillRect(0, y, RACE_W, 100);
  }

  // 결승선 (체크무늬)
  const fy = r.course.finishY;
  if (fy > viewTop && fy < viewBot) {
    const sq = 22;
    for (let i = 0; i < Math.ceil(RACE_W / sq); i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#3A2E20' : '#FFF8E7';
        ctx.fillRect(i * sq, fy + j * sq, sq, sq);
      }
    }
  }

  // 벽
  ctx.strokeStyle = '#8A5220';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  for (const w of r.course.walls) {
    if (w.maxY < viewTop || w.minY > viewBot) continue;
    ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
  }

  // 못: 맵별 캐릭터 이미지 (아직 로드 전이면 기존 노란 원)
  const pegSkin = pegSkinCanvas[r.course.mapType];
  for (const p of r.course.pegs) {
    if (p.y < viewTop || p.y > viewBot) continue;
    if (pegSkin) {
      ctx.drawImage(pegSkin, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    } else {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD966'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#C8860C'; ctx.stroke();
    }
  }

  // 회전 막대 (폭풍 맵)
  if (r.course.spinners) {
    for (const sp of r.course.spinners) {
      if (sp.cy + sp.len < viewTop || sp.cy - sp.len > viewBot) continue;
      ctx.save();
      ctx.translate(sp.cx, sp.cy);
      ctx.strokeStyle = '#E0662E';
      ctx.lineWidth = sp.half * 2;
      ctx.lineCap = 'round';
      for (let k = 0; k < sp.arms; k++) {
        ctx.save();
        ctx.rotate(sp.angle + k * (Math.PI * 2 / sp.arms));
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sp.len, 0); ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(0, 0, sp.half + 5, 0, Math.PI * 2);
      ctx.fillStyle = '#7A3E12'; ctx.fill();
      ctx.restore();
    }
  }

  // 시소 (시소·진자 맵)
  if (r.course.seesaws) {
    for (const sw of r.course.seesaws) {
      if (sw.cy + 60 < viewTop || sw.cy - 60 > viewBot) continue;
      const ca = Math.cos(sw.angle), sa = Math.sin(sw.angle);
      ctx.strokeStyle = '#3FA9C9'; ctx.lineWidth = sw.half * 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sw.cx - ca * sw.len, sw.cy - sa * sw.len);
      ctx.lineTo(sw.cx + ca * sw.len, sw.cy + sa * sw.len);
      ctx.stroke();
      ctx.fillStyle = '#8A5220'; // 받침(삼각형)
      ctx.beginPath();
      ctx.moveTo(sw.cx, sw.cy + 4);
      ctx.lineTo(sw.cx - 20, sw.cy + 44);
      ctx.lineTo(sw.cx + 20, sw.cy + 44);
      ctx.closePath(); ctx.fill();
    }
  }

  // 진자 (시소·진자 맵)
  if (r.course.pendulums) {
    for (const pd of r.course.pendulums) {
      const bx = pd.px + Math.sin(pd.theta) * pd.L;
      const by = pd.py + Math.cos(pd.theta) * pd.L;
      if (by + pd.r < viewTop || pd.py - 20 > viewBot) continue;
      ctx.strokeStyle = '#9A7B5A'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pd.px, pd.py); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#5A3A1A'; // 천장 고정점
      ctx.beginPath(); ctx.arc(pd.px, pd.py, 7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(bx, by, pd.r, 0, Math.PI * 2); // 추
      ctx.fillStyle = '#C0508A'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#7A2050'; ctx.stroke();
    }
  }

  // 구슬 + 이름표
  ctx.textAlign = 'center';
  for (const m of r.marbles) {
    if (m.finished || m.y < viewTop || m.y > viewBot) continue;
    ctx.beginPath(); ctx.arc(m.x, m.y, MARBLE_R, 0, Math.PI * 2);
    ctx.fillStyle = m.color; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(m.x - 4, m.y - 4, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();

    ctx.font = '700 12px "Noto Sans KR", sans-serif';
    const tw = ctx.measureText(m.name).width + 10;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(m.x - tw / 2, m.y + MARBLE_R + 3, tw, 17);
    ctx.fillStyle = '#4A3018';
    ctx.fillText(m.name, m.x, m.y + MARBLE_R + 16);
  }

  // ----- 화면 고정 UI (카메라 무시) -----
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 순위판 (결승 통과자) — 전원 표시. 인원이 많으면 줄 간격·글씨를 줄여 화면 안에 다 들어가게.
  if (r.ranks.length) {
    const medals = ['🥇', '🥈', '🥉'];
    const rowH = Math.max(14, Math.min(26, (chPx - 44) / r.ranks.length));
    const fs = Math.round(Math.min(16, rowH * 0.62));
    const dotR = Math.min(7, rowH * 0.28);
    ctx.textAlign = 'left';
    ctx.font = `900 ${fs}px "Noto Sans KR", sans-serif`;
    ctx.fillStyle = 'rgba(40,25,10,0.72)';
    ctx.fillRect(12, 12, 190, 20 + r.ranks.length * rowH);
    r.ranks.forEach((rk, i) => {
      const cy = 22 + i * rowH + rowH / 2;
      const label = (medals[i] || `${i + 1}등`) + ' ' + rk.name;
      ctx.fillStyle = rk.color;
      ctx.beginPath(); ctx.arc(30, cy, dotR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = i < r.winnersNeeded ? '#FFD966' : 'rgba(255,255,255,0.7)';
      ctx.fillText(label, 44, cy + fs * 0.36);
    });
  }

  // 카운트다운
  if (r.phase === 'countdown') {
    const n = Math.ceil(r.countLeft - 0.6);
    const text = n >= 1 ? String(n) : '출발!';
    ctx.textAlign = 'center';
    ctx.font = '900 90px "Noto Sans KR", sans-serif';
    ctx.lineWidth = 10; ctx.strokeStyle = '#8A5220';
    ctx.strokeText(text, cw / 2, chPx / 2);
    ctx.fillStyle = '#FFD966';
    ctx.fillText(text, cw / 2, chPx / 2);
  }

  // 슬로모션 표시
  if (r.timeScale < 1 && r.phase === 'running') {
    ctx.textAlign = 'center';
    ctx.font = '900 22px "Noto Sans KR", sans-serif';
    ctx.fillStyle = 'rgba(255,217,102,0.9)';
    ctx.fillText('🔥 결승 직전! 🔥', cw / 2, 40);
  }
}

function drawIdle() {
  const cv = document.getElementById('raceCanvas');
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const { w: cw, h: chPx } = raceCanvasSize();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#2E2317';
  ctx.fillRect(0, 0, cw, chPx);
  ctx.textAlign = 'center';
  ctx.font = '900 44px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#FFD966';
  ctx.fillText('🎲 구슬 뽑기 경주', cw / 2, chPx / 2 - 40);
  ctx.font = '700 18px "Noto Sans KR", sans-serif';
  ctx.fillStyle = 'rgba(255,248,231,0.85)';
  const n = getRacePlayers().length;
  ctx.fillText(`참가자 ${n}명 · 오른쪽 위 [▶ 경주 시작] 버튼을 눌러주세요!`, cw / 2, chPx / 2 + 10);
}

// ---------- 결과 표시 ----------
// 1등부터 꼴등까지 전체 순위를 보여준다. 뽑기 인원(winnersNeeded) 안에 든 학생은 금색으로 강조.
function showRaceResult(r) {
  const medals = ['🥇', '🥈', '🥉'];
  const listEl = document.getElementById('raceResultList');
  listEl.innerHTML = r.ranks.map((w, i) => {
    const isWinner = i < r.winnersNeeded;
    const rankLabel = medals[i] || (i + 1) + '등';
    return `
    <div class="race-result-item${isWinner ? ' race-winner' : ''}">
      <span class="race-rank">${rankLabel}</span>
      <span class="race-dot" style="background:${w.color}"></span>
      <span class="race-name">${escHtml(w.name)}</span>
    </div>`;
  }).join('');
  document.getElementById('raceResultOverlay').style.display = 'flex';
}

// ---------- 참가자 선택 모달 ----------
function openRacePlayersModal() {
  const listEl = document.getElementById('racePlayersList');
  let html = '';
  if (typeof state !== 'undefined' && state && state.groups) {
    state.groups.forEach(group => {
      html += `<div class="bulk-group-label">${escHtml(group.name)}</div>`;
      group.members.forEach(idx => {
        const name = state.students[idx] || '?';
        html += `
          <label class="bulk-student-item">
            <input type="checkbox" class="race-player-check" data-idx="${idx}" ${raceExcluded.has(idx) ? '' : 'checked'}>
            <span>${escHtml(name)}</span>
          </label>`;
      });
    });
  } else {
    getRaceRoster().forEach(p => {
      html += `
        <label class="bulk-student-item">
          <input type="checkbox" class="race-player-check" data-idx="${p.idx}" ${raceExcluded.has(p.idx) ? '' : 'checked'}>
          <span>${escHtml(p.name)}</span>
        </label>`;
    });
  }
  listEl.innerHTML = html;
  document.getElementById('racePlayersModal').style.display = 'flex';
}

function closeRacePlayersModal() {
  raceExcluded = new Set();
  document.querySelectorAll('.race-player-check').forEach(chk => {
    if (!chk.checked) {
      const raw = chk.dataset.idx;
      raceExcluded.add(String(parseInt(raw, 10)) === raw ? parseInt(raw, 10) : raw);
    }
  });
  document.getElementById('racePlayersModal').style.display = 'none';
  if (!race) drawIdle();
}

// ---------- 탭 열기 / 이벤트 연결 ----------
function onRaceTabOpen() {
  fitRaceCanvas();
  if (!race) drawIdle();
}
window.onRaceTabOpen = onRaceTabOpen;

window.addEventListener('resize', () => {
  if (document.getElementById('raceView').style.display === 'none') return;
  fitRaceCanvas();
  if (!race) drawIdle();
});

document.querySelectorAll('.map-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.map-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    if (!race) drawIdle();
  });
});

document.getElementById('raceStartBtn').addEventListener('click', startRace);
document.getElementById('raceAgainBtn').addEventListener('click', startRace);
document.getElementById('raceCloseResultBtn').addEventListener('click', stopRace);
document.getElementById('racePickPlayersBtn').addEventListener('click', openRacePlayersModal);
document.getElementById('raceCloseModalBtn').addEventListener('click', closeRacePlayersModal);
document.getElementById('raceSelectAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.race-player-check').forEach(c => c.checked = true);
});
document.getElementById('raceSelectNoneBtn').addEventListener('click', () => {
  document.querySelectorAll('.race-player-check').forEach(c => c.checked = false);
});

})();
