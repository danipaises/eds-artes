import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { collection, doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyC0dMjYUa8z5fkEC37jT641dbxqJJzGJp4',
  authDomain: 'studio-9856609900-1bb16.firebaseapp.com',
  projectId: 'studio-9856609900-1bb16',
  storageBucket: 'studio-9856609900-1bb16.firebasestorage.app',
  messagingSenderId: '177143768062',
  appId: '1:177143768062:web:5693c1f7d34c9cc39d96af'
};

const APP_NAMESPACE = 'super-quiz-escola-v2';
const LOCAL_KEY = `${APP_NAMESPACE}:rooms`;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(APP_NAMESPACE) : null;
const useLocal = new URLSearchParams(window.location.search).get('sync') === 'local';

let firebaseReadyPromise;
function firebaseReady() {
  if (useLocal) return Promise.resolve(null);
  if (!firebaseReadyPromise) {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    firebaseReadyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tempo esgotado ao autenticar no Firebase.')), 10000);
      const stop = onAuthStateChanged(auth, async (user) => {
        if (user) {
          clearTimeout(timeout);
          stop();
          resolve({ auth, db });
          return;
        }
        try {
          await signInAnonymously(auth);
        } catch (error) {
          clearTimeout(timeout);
          stop();
          reject(error);
        }
      });
    });
  }
  return firebaseReadyPromise;
}

function readLocalRooms() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
  } catch {
    return {};
  }
}

export function resetLocalRooms() {
  localStorage.removeItem(LOCAL_KEY);
  channel?.postMessage({ type: 'reset' });
}

export async function saveRoom(room) {
  if (useLocal) {
    const rooms = readLocalRooms();
    rooms[room.id] = { ...room, updatedAt: Date.now() };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rooms));
    channel?.postMessage({ type: 'room', room: rooms[room.id] });
    return;
  }
  const ctx = await firebaseReady();
  await setDoc(doc(ctx.db, 'artifacts', APP_NAMESPACE, 'public', 'data', 'live_quiz_groups', room.id), {
    ...room,
    updatedAt: serverTimestamp()
  });
}

export function subscribeRooms(callback, onError = console.error) {
  if (useLocal) {
    const emit = () => callback(Object.values(readLocalRooms()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    emit();
    const onStorage = (event) => {
      if (event.key === LOCAL_KEY) emit();
    };
    const onMessage = () => emit();
    window.addEventListener('storage', onStorage);
    channel?.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.removeEventListener('message', onMessage);
    };
  }

  let unsubscribe = () => {};
  let cancelled = false;
  firebaseReady()
    .then((ctx) => {
      if (cancelled) return;
      const ref = collection(ctx.db, 'artifacts', APP_NAMESPACE, 'public', 'data', 'live_quiz_groups');
      unsubscribe = onSnapshot(ref, (snapshot) => {
        const rooms = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
        callback(rooms);
      }, onError);
    })
    .catch(onError);
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export { useLocal };
