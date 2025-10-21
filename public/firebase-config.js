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
let currentUser = null;
let currentIdToken = null;
let firebaseReady = false;

async function initFirebase() {
  try {
    // Dynamically load Firebase SDK
    await loadScript('https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
    
    // Import Firebase modules
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
        currentUser = user;
        currentIdToken = await user.getIdToken();
        // Token expires after ~1 hour, refresh when needed
        user.getIdToken(/* forceRefresh */ true).then(token => {
          currentIdToken = token;
        });
        showApp();
      } else {
        currentUser = null;
        currentIdToken = null;
        showAuthScreen();
      }
    });
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

async function firebaseRegister(email, password) {
  // Wait for Firebase to be ready
  while (!firebaseReady || !auth) {
    await new Promise(r => setTimeout(r, 100));
  }
  
  try {
    const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
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
    return { user: { uid: userCredential.user.uid, email: userCredential.user.email } };
  } catch (error) {
    throw new Error(error.message);
  }
}

async function firebaseLogout() {
  try {
    const { signOut } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
    await signOut(auth);
    currentUser = null;
    currentIdToken = null;
  } catch (error) {
    console.error('Logout error:', error);
  }
}

async function getIdToken() {
  if (currentUser) {
    try {
      currentIdToken = await currentUser.getIdToken();
      return currentIdToken;
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
