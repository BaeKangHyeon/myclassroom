// ============================================================
// Firebase 설정
// Firebase 콘솔(console.firebase.google.com)에서 웹 앱을 등록하면
// 나오는 firebaseConfig 값을 아래에 그대로 붙여넣으세요.
// (apiKey가 "PASTE_YOUR_CONFIG_HERE"인 동안에는 임시 저장소 모드로
//  동작합니다 — 이 컴퓨터/브라우저 안에서만 저장되고 공유는 안 됩니다.)
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzekrCABBM3NCEXsqDQLx3ZmC9BU53Zfo",
  authDomain: "bkhschool.firebaseapp.com",
  projectId: "bkhschool",
  storageBucket: "bkhschool.firebasestorage.app",
  messagingSenderId: "199792565640",
  appId: "1:199792565640:web:570586144e3c8a7507ae3d"
};

let db = null;
let usingMockDb = false;

if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'PASTE_YOUR_CONFIG_HERE') {
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
} else {
  db = createMockDb();
  usingMockDb = true;
}

function firebaseReady() { return !!db; }

// ===== 설정 전 임시 저장소 =====
// Firestore와 같은 모양(collection/doc/get/set/update/delete/onSnapshot)의
// 아주 작은 흉내 구현. localStorage에 저장하므로 같은 브라우저 안에서만 유지된다.
// 실제 Firebase 설정을 붙여넣는 순간 자동으로 진짜 Firestore로 전환된다.
function createMockDb() {
  const listeners = {}; // path -> [fn, ...]

  function storageKey(path) { return 'mockdb:' + path; }
  function read(path) {
    try {
      const raw = localStorage.getItem(storageKey(path));
      return raw === null ? null : JSON.parse(raw);
    } catch (e) { return null; }
  }
  function makeSnap(path) {
    const data = read(path);
    return { exists: data !== null, data: () => data, metadata: { hasPendingWrites: false } };
  }
  function notify(path) {
    (listeners[path] || []).forEach(fn => { try { fn(makeSnap(path)); } catch (e) {} });
  }
  // 다른 탭에서 저장하면 이 탭에도 반영 (같은 브라우저 안 실시간 동기화 흉내)
  window.addEventListener('storage', e => {
    if (e.key && e.key.startsWith('mockdb:')) notify(e.key.slice('mockdb:'.length));
  });
  // update()의 "avatars.3" 같은 점(.) 경로를 실제 중첩 객체에 반영
  function setDeep(obj, dotPath, value) {
    const parts = dotPath.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  return {
    collection(col) {
      return {
        doc(id) {
          const path = col + '/' + id;
          return {
            get() { return Promise.resolve(makeSnap(path)); },
            set(data) {
              localStorage.setItem(storageKey(path), JSON.stringify(data));
              notify(path);
              return Promise.resolve();
            },
            update(payload) {
              const data = read(path);
              if (data === null) return Promise.reject(new Error('no-document'));
              Object.keys(payload).forEach(k => setDeep(data, k, payload[k]));
              localStorage.setItem(storageKey(path), JSON.stringify(data));
              notify(path);
              return Promise.resolve();
            },
            delete() {
              localStorage.removeItem(storageKey(path));
              notify(path);
              return Promise.resolve();
            },
            onSnapshot(fn, errFn) {
              (listeners[path] = listeners[path] || []).push(fn);
              setTimeout(() => fn(makeSnap(path)), 0);
              return () => {
                const arr = listeners[path] || [];
                const i = arr.indexOf(fn);
                if (i !== -1) arr.splice(i, 1);
              };
            }
          };
        }
      };
    }
  };
}
