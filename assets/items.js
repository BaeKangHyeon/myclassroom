// 아바타/자리표 공용 아이템 데이터. avatar.html과 index.html이 함께 사용한다.
// 새 옷을 추가할 땐 이 파일에만 등록하면 상점(avatar.html)과 자리표(index.html) 양쪽에 자동 반영된다.

// 화면 표시용(투명 배경). 옷 추출 파이프라인(.claude/extract_outfit.ps1)은 원본 흰배경 파일을 그대로 참조하니 건드리지 말 것.
// 몸/머리/옷 3레이어 구조: 민머리 몸(body_*) 위에 옷 → 머리 순서로 얹는다.
const GENDER_IMAGES = {
  boy: 'assets/body_boy_display.png',
  girl: 'assets/body_girl_display.png'
};

// outfit_basic has no overlay image: it IS the base body/clothes.
// other outfits are transparent overlays layered on top of the base, pre-aligned to the same 512x512 frame.
// images may omit boy or girl — such items only appear for the matching gender.
const ITEMS = [
  // 아이콘은 합성본(민머리 몸+기본 머리). outfit_basic_*.png(머리 박힌 원본)은 옷 추출 파이프라인이 참조하므로 그대로 둠.
  { id: 'outfit_basic', name: '기본 옷차림', price: 0,
    images: { boy: 'assets/outfit_basic_boy_shop.png', girl: 'assets/outfit_basic_girl_shop.png' } },
  { id: 'outfit_hoodie', name: '후드티/가디건', price: 10,
    images: { boy: 'assets/outfit_hoodie_boy.png', girl: 'assets/outfit_hoodie_girl.png' } },
  { id: 'outfit_black', name: '블랙 니트 세트', price: 10,
    images: { boy: 'assets/outfit_black_boy.png' } },
  { id: 'outfit_soccer', name: '장등초 축구 유니폼', price: 10,
    images: { boy: 'assets/outfit_soccer_boy.png' } },
  { id: 'outfit_track', name: '네이비 트랙수트', price: 10,
    images: { girl: 'assets/outfit_track_girl.png' } },
  { id: 'outfit_coat', name: '네이비 롱코트', price: 10,
    images: { girl: 'assets/outfit_coat_girl.png' } },
  { id: 'outfit_dotpj', name: '물방울 잠옷', price: 10,
    images: { boy: 'assets/outfit_dotpj_boy.png' } },
  { id: 'outfit_puffer', name: '노란 패딩', price: 10,
    images: { boy: 'assets/outfit_puffer_boy.png' } },
  { id: 'outfit_grayset', name: '회색 반팔 세트', price: 10,
    images: { boy: 'assets/outfit_grayset_boy.png' } },
  { id: 'outfit_bearpj', name: '곰돌이 잠옷', price: 10,
    images: { girl: 'assets/outfit_bearpj_girl.png' } },
  { id: 'outfit_stardress', name: '별무늬 드레스', price: 10,
    images: { girl: 'assets/outfit_stardress_girl.png' } },
  { id: 'outfit_cattee', name: '곰돌이 민소매', price: 10,
    images: { girl: 'assets/outfit_cattee_girl.png' } },
];

// items available to the given gender (has an image for that gender)
function itemsForGender(gender) {
  return ITEMS.filter(i => i.images[gender]);
}

// 머리 스타일: 투명 배경 오버레이. 몸 → 옷 → 머리 순서로 그린다(머리가 어깨 위 옷을 자연스럽게 덮음).
// 성별별 첫 항목(해당 성별 이미지를 가진 첫 항목)이 그 성별의 기본 머리(무료·fallback).
const HAIRSTYLES = [
  // girl 기본: 검정 단발. 분홍 웨이브(예전 기본)는 상점 아이템.
  { id: 'hair_bob_black', name: '기본 단발', price: 0,
    images: { girl: 'assets/hair_bob_black_girl.png' } },
  // boy 기본: 원래 캐릭터의 갈색 머리.
  { id: 'hair_basic_boy', name: '기본 머리', price: 0,
    images: { boy: 'assets/hair_basic_boy.png' } },
  { id: 'hair_bob_brown', name: '갈색 단발', price: 10,
    images: { girl: 'assets/hair_bob_brown_girl.png' } },
  { id: 'hair_bob_pin', name: '옆핀 단발', price: 10,
    images: { girl: 'assets/hair_bob_pin_girl.png' } },
  { id: 'hair_bob_topbun', name: '사과머리 단발', price: 10,
    images: { girl: 'assets/hair_bob_topbun_girl.png' } },
  { id: 'hair_wave_bow', name: '리본 웨이브', price: 10,
    images: { girl: 'assets/hair_wave_bow_girl.png' } },
  { id: 'hair_basic', name: '분홍 웨이브', price: 10,
    images: { girl: 'assets/hair_basic_girl.png' } },
  { id: 'hair_spike', name: '스파이크 컷', price: 10,
    images: { boy: 'assets/hair_spike_boy.png' } },
  { id: 'hair_flow', name: '갈색 가르마 펌', price: 10,
    images: { boy: 'assets/hair_flow_boy.png' } },
  { id: 'hair_band', name: '헤어밴드 펌', price: 10,
    images: { boy: 'assets/hair_band_boy.png' } },
];

function hairForGender(gender) {
  return HAIRSTYLES.filter(h => h.images[gender]);
}

// 성별별 기본 머리 id (해당 성별 목록의 첫 항목). 성별 미지정이면 null.
function defaultHairId(gender) {
  const list = hairForGender(gender);
  return list.length ? list[0].id : null;
}

// 배경: 옷과 별개 슬롯. 성별 구분 없이 이미지 1장씩만 가짐.
const BACKGROUNDS = [
  { id: 'bg_none', name: '배경 없음', price: 0, image: null },
  { id: 'bg_1', name: '배경 1', price: 15, image: 'assets/배경1.png' },
  { id: 'bg_2', name: '배경 2', price: 15, image: 'assets/배경2.png' },
  { id: 'bg_3', name: '배경 3', price: 15, image: 'assets/배경3.png' },
];

// 테두리: 학생 카드 네 모서리에 장식 뱃지(이미지) + 변은 등급 색상의 얇은 선으로 연결.
// (원본 테두리 전체를 border-image로 늘리면 디테일이 뭉개지고 상단 중앙 장식이 어긋나서 모서리만 잘라 쓰고, 변은 이미지 대신 색선으로 대체. 원본은 frame_*.png, 모서리만 자른 건 frame_*_corner.png)
const FRAMES = [
  { id: 'frame_none', name: '테두리 없음', price: 0, image: null, color: null },
  { id: 'frame_bronze', name: '브론즈 테두리', price: 15, image: 'assets/frame_bronze_corner.png', color: '#B08D57' },
  { id: 'frame_silver', name: '실버 테두리', price: 20, image: 'assets/frame_silver_corner.png', color: '#C0C4CC' },
  { id: 'frame_gold', name: '골드 테두리', price: 25, image: 'assets/frame_gold_corner.png', color: '#E0A72A' },
  { id: 'frame_platinum', name: '플래티넘 테두리', price: 30, image: 'assets/frame_platinum_corner.png', color: '#4FD8C4' },
  { id: 'frame_diamond', name: '다이아몬드 테두리', price: 40, image: 'assets/frame_diamond_corner.png', color: '#8FD8FF' },
];

// 칭호: 이름 앞에 붙는 작은 메달 아이콘 + 텍스트. 10단계 랭크로, 메달 이미지 1장 + 텍스트 조합.
const TITLES = [
  { id: 'title_none', name: '칭호 없음', price: 0, image: null },
  { id: 'title_1', name: '새싹', price: 5, image: 'assets/medal_1.png' },
  { id: 'title_2', name: '은빛 잎사귀', price: 10, image: 'assets/medal_2.png' },
  { id: 'title_3', name: '초록 보석', price: 15, image: 'assets/medal_3.png' },
  { id: 'title_4', name: '골드 크라운', price: 20, image: 'assets/medal_4.png' },
  { id: 'title_5', name: '방패지기', price: 25, image: 'assets/medal_5.png' },
  { id: 'title_6', name: '사파이어 트로피', price: 30, image: 'assets/medal_6.png' },
  { id: 'title_7', name: '루비 날개', price: 35, image: 'assets/medal_7.png' },
  { id: 'title_8', name: '플래티넘 이글', price: 40, image: 'assets/medal_8.png' },
  { id: 'title_9', name: '자수정 왕관', price: 50, image: 'assets/medal_9.png' },
];

function defaultAvatar(gender) {
  const hair = defaultHairId(gender);
  const inv = ['outfit_basic', 'bg_none', 'frame_none', 'title_none'];
  if (hair) inv.push(hair);
  return {
    gender: gender || null,
    inventory: inv,
    equipped: { outfit: 'outfit_basic', hair: hair, background: 'bg_none', frame: 'frame_none', title: 'title_none' }
  };
}

// resolve which image(s) to layer for a given avatar state:
// { base, overlay(nullable), hair(nullable), background(nullable), frame(nullable) }
// 그리는 순서: background → base(몸) → overlay(옷) → hair(머리)
function resolveAvatarLayers(avatar) {
  if (!avatar || !avatar.gender) return null;
  const base = GENDER_IMAGES[avatar.gender];
  const item = ITEMS.find(i => i.id === (avatar.equipped && avatar.equipped.outfit));
  const overlay = (item && item.id !== 'outfit_basic' && item.images[avatar.gender]) ? item.images[avatar.gender] : null;
  // 예전 데이터엔 equipped.hair가 없을 수 있음 → 성별별 기본 머리로 처리.
  // 착용한 머리가 이 성별 이미지를 안 가지면(성별 변경 등)도 기본 머리로.
  const hairId = (avatar.equipped && avatar.equipped.hair) || defaultHairId(avatar.gender);
  let hs = HAIRSTYLES.find(h => h.id === hairId);
  if (!hs || !hs.images[avatar.gender]) hs = HAIRSTYLES.find(h => h.id === defaultHairId(avatar.gender));
  const hair = (hs && hs.images[avatar.gender]) ? hs.images[avatar.gender] : null;
  const bg = BACKGROUNDS.find(b => b.id === (avatar.equipped && avatar.equipped.background));
  const background = bg ? bg.image : null;
  const fr = FRAMES.find(f => f.id === (avatar.equipped && avatar.equipped.frame));
  const frame = fr ? fr.image : null;
  return { base, overlay, hair, background, frame };
}

// resolve equipped title: { image, name } or null
function resolveTitle(avatar) {
  const t = TITLES.find(t => t.id === (avatar && avatar.equipped && avatar.equipped.title));
  return (t && t.image) ? t : null;
}
