// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDpHj-GlKfGrP6G3BMt7Vwjgwg4QPT8yaI",
  authDomain: "expense-tracker-prod-df355.firebaseapp.com",
  projectId: "expense-tracker-prod-df355",
  storageBucket: "expense-tracker-prod-df355.firebasestorage.app",
  messagingSenderId: "48604707495",
  appId: "1:48604707495:web:d703944ade1a6e61f4b982"
};

// Initialize Firebase
let auth;
let firebaseUser = null; // internal firebase.User object
let firebaseIdToken = null; // cached id token
let firebaseReady = false;
let currentUserSnapshot = null; // lightweight {uid,email}

// Local-only mode: do not contact Firebase when running locally.
// Enable by visiting http://localhost:3000/?local=true or setting localStorage.setItem('localOnly','1')
const localOnly = (typeof window !== 'undefined') && (window.location && window.location.search && window.location.search.includes('local=true') || localStorage.getItem('localOnly') === '1');
// Expose to page scripts so they can avoid sending mocked tokens to the server
if (typeof window !== 'undefined') {
  window.appLocalOnly = localOnly;
}
if (localOnly) {
  console.log('⚠️ Firebase initialization skipped: running in local-only mode');
  firebaseReady = true;
  try {
    const stored = localStorage.getItem('currentUser') || localStorage.getItem('appCurrentUser');
    currentUserSnapshot = stored ? JSON.parse(stored) : null;
    firebaseIdToken = localStorage.getItem('authToken') || null;
  } catch (err) {
    console.warn('Local-only: failed to read stored auth state', err);
  }

  // Minimal mocked helpers so index.html can call the same functions
  async function firebaseRegister(email, password) {
    // In local mode we just create a fake snapshot and token
    const snapshot = { uid: `local-${Date.now()}`, email };
    currentUserSnapshot = snapshot;
    firebaseIdToken = `local-token-${Date.now()}`;
    try { localStorage.setItem('currentUser', JSON.stringify(snapshot)); localStorage.setItem('authToken', firebaseIdToken); } catch (e) {}
    return { user: snapshot };
  }

  async function firebaseLogin(email, password) {
    // Accept any credentials in local-only mode
    const snapshot = { uid: `local-${Date.now()}`, email };
    currentUserSnapshot = snapshot;
    firebaseIdToken = `local-token-${Date.now()}`;
    try { localStorage.setItem('currentUser', JSON.stringify(snapshot)); localStorage.setItem('authToken', firebaseIdToken); } catch (e) {}
    return { user: snapshot };
  }

  async function firebaseLogout() {
    currentUserSnapshot = null;
    firebaseIdToken = null;
    try { localStorage.removeItem('currentUser'); localStorage.removeItem('authToken'); } catch (e) {}
    // dispatch cleared event so UI reacts
    window.dispatchEvent(new CustomEvent('auth:cleared'));
  }

  async function getIdToken() {
    return firebaseIdToken;
  }

  // Export mocked helpers
  window.firebaseRegister = firebaseRegister;
  window.firebaseLogin = firebaseLogin;
  window.firebaseLogout = firebaseLogout;
  window.getIdToken = getIdToken;
  window.firebaseInitPromise = Promise.resolve();
}

function whenDomReady(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  } else {
    callback();
  }
}

function persistAuthState() {
  if (firebaseIdToken) {
    try {
      localStorage.setItem('authToken', firebaseIdToken);
    } catch (err) {
      console.warn('Could not store auth token:', err);
    }
  }

  if (firebaseUser) {
    const snapshot = { uid: firebaseUser.uid || null, email: firebaseUser.email || null };
    currentUserSnapshot = snapshot;
    try {
      // Write both legacy and new keys to ease migration for clients
      localStorage.setItem('currentUser', JSON.stringify(snapshot));
      localStorage.setItem('appCurrentUser', JSON.stringify(snapshot));
    } catch (err) {
      console.warn('Could not store current user:', err);
    }
  }
}

function showApp() {
  whenDomReady(() => {
    const authScreen = document.getElementById('authScreen');
    const app = document.getElementById('app');
    const usernameDisplay = document.getElementById('usernameDisplay');

    if (authScreen) authScreen.classList.add('hidden');
    if (app) app.classList.remove('hidden');
    if (usernameDisplay && currentUserSnapshot) {
      usernameDisplay.textContent = currentUserSnapshot.email || currentUserSnapshot.uid || '';
    }

    persistAuthState();
    // dispatch a lightweight user snapshot (uid/email) so other scripts don't rely on firebase.User methods
    window.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: currentUserSnapshot } }));
  });
}

function showAuthScreen() {
  whenDomReady(() => {
    const authScreen = document.getElementById('authScreen');
    const app = document.getElementById('app');

    if (authScreen) authScreen.classList.remove('hidden');
    if (app) app.classList.add('hidden');

    try {
      // Clear both legacy and new keys
      localStorage.removeItem('authToken');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('appCurrentUser');
      currentUserSnapshot = null;
    } catch (err) {
      console.warn('Could not clear auth storage:', err);
    }

    window.dispatchEvent(new CustomEvent('auth:cleared'));
  });
}

async function initFirebase() {
  try {
    // Use ESM dynamic imports (do NOT insert script tags) so the browser treats the files as modules.
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js');
    const { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
    
    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    
    // Set persistence so user stays logged in
    await setPersistence(auth, browserLocalPersistence);
    
    // Mark Firebase as ready
    firebaseReady = true;
    console.log('✅ Firebase initialized');
    
    // Listen for auth state changes
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Keep the firebase.User object locally for token retrieval, but dispatch only a small snapshot
        firebaseUser = user;
        currentUserSnapshot = { uid: user.uid || null, email: user.email || null };
        firebaseIdToken = await user.getIdToken();
        persistAuthState();
        // Token expires after ~1 hour, refresh when needed and persist
        user.getIdToken(/* forceRefresh */ true).then(token => {
          firebaseIdToken = token;
          persistAuthState();
        }).catch(err => console.warn('Token refresh failed:', err));
        showApp();
      } else {
        firebaseUser = null;
        firebaseIdToken = null;
        showAuthScreen();
      }
    });
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

function loadScript(src) {
  // Deprecated: keep for backwards compatibility but prefer dynamic ESM imports.
  return Promise.reject(new Error('loadScript is deprecated; use dynamic import() instead'));
}

async function firebaseRegister(email, password) {
  // Wait for Firebase to be ready
  while (!firebaseReady || !auth) {
    await new Promise(r => setTimeout(r, 100));
  }
  
  try {
    const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    // Immediately populate local state so callers can get an ID token without waiting for onAuthStateChanged
    try {
      firebaseUser = userCredential.user;
      firebaseIdToken = await firebaseUser.getIdToken();
      currentUserSnapshot = { uid: firebaseUser.uid || null, email: firebaseUser.email || null };
      persistAuthState();
      // notify listeners that auth is ready
      window.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: currentUserSnapshot } }));
    } catch (e) {
      // non-fatal: continue and return user info
      console.warn('Post-register token retrieval failed:', e);
    }

    return { user: { uid: userCredential.user.uid, email: userCredential.user.email } };
  } catch (error) {
    throw new Error(error.message);
  }
}

async function firebaseLogin(email, password) {
  // Wait for Firebase to be ready
  while (!firebaseReady || !auth) {
    await new Promise(r => setTimeout(r, 100));
  }
  
  try {
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    // Populate local state immediately so callers can obtain token and UI can update without waiting for onAuthStateChanged
    try {
      firebaseUser = userCredential.user;
      firebaseIdToken = await firebaseUser.getIdToken();
      currentUserSnapshot = { uid: firebaseUser.uid || null, email: firebaseUser.email || null };
      persistAuthState();
      window.dispatchEvent(new CustomEvent('auth:ready', { detail: { user: currentUserSnapshot } }));
    } catch (e) {
      console.warn('Post-login token retrieval failed:', e);
    }

    return { user: { uid: userCredential.user.uid, email: userCredential.user.email } };
  } catch (error) {
    throw new Error(error.message);
  }
}

async function firebaseLogout() {
  try {
    const { signOut } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
    await signOut(auth);
    firebaseUser = null;
    firebaseIdToken = null;
  } catch (error) {
    console.error('Logout error:', error);
  }
}

async function getIdToken() {
  if (firebaseUser) {
    try {
      firebaseIdToken = await firebaseUser.getIdToken();
      persistAuthState();
      return firebaseIdToken;
    } catch (error) {
      console.error('Error getting ID token:', error);
      return null;
    }
  }
  return null;
}

// Initialize Firebase when page loads
document.addEventListener('DOMContentLoaded', initFirebase);

// Also start initialization immediately for faster loading
// This ensures Firebase functions are available when event listeners are attached
const firebaseInitPromise = (async () => {
  // Wait a bit for DOM to be ready, then init
  if (document.readyState === 'loading') {
    // DOM not ready, wait for it
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
  }
  // Initialize Firebase
  if (!firebaseReady) {
    await initFirebase();
  }
})();

// Export functions to global scope to ensure they're always accessible
// This prevents "function not defined" errors during race conditions
window.firebaseRegister = firebaseRegister;
window.firebaseLogin = firebaseLogin;
window.firebaseLogout = firebaseLogout;
window.getIdToken = getIdToken;
window.initFirebase = initFirebase;
window.showApp = showApp;
window.showAuthScreen = showAuthScreen;
window.firebaseInitPromise = firebaseInitPromise;
