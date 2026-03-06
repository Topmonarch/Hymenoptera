/* auth.js
   Authentication helper for Hymenoptera AI

   Features added:
   - Continue as Guest mode (session stored in sessionStorage so it's temporary)
   - getCurrentUser(), isGuest(), canSaveHistory(), onAuthChange() callbacks
   - Existing sign-in / create-account functions kept (they should call backend endpoints)
   - UI code can subscribe to auth changes via Auth.onAuthChange(handler)
*/

(function (global) {
  const STORAGE_KEY = 'hymenoptera_auth_user'; // used for persistent login
  const GUEST_SESSION_KEY = 'hymenoptera_guest_user'; // sessionStorage for guest

  const listeners = [];

  function notify() {
    const u = getCurrentUser();
    listeners.forEach((cb) => {
      try { cb(u); } catch (e) { console.error('Auth listener error', e); }
    });
  }

  function savePersistentUser(userObj) {
    if (!userObj) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userObj));
  }

  function saveGuestSession(userObj) {
    if (!userObj) {
      sessionStorage.removeItem(GUEST_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(userObj));
  }

  function loadPersistentUser() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const u = JSON.parse(raw);
      // expiration handling could be implemented here if tokens expire
      return u;
    } catch (e) {
      return null;
    }
  }

  function loadGuestSession() {
    const raw = sessionStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    try {
      const u = JSON.parse(raw);
      // If we stored an expiresAt, check it
      if (u.expiresAt && Date.now() > u.expiresAt) {
        sessionStorage.removeItem(GUEST_SESSION_KEY);
        return null;
      }
      return u;
    } catch (e) {
      return null;
    }
  }

  // Public API
  const Auth = {
    init() {
      // Called on app start to load any existing user
      const persistent = loadPersistentUser();
      const guest = loadGuestSession();

      if (persistent) {
        Auth._currentUser = persistent;
      } else if (guest) {
        Auth._currentUser = guest;
      } else {
        Auth._currentUser = null;
      }

      notify();
    },

    // Placeholder: perform sign-in via backend. Returns a Promise that resolves to user object.
    signIn(email, password) {
      // Example implementation - replace with real API call
      return fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
        .then((r) => {
          if (!r.ok) throw new Error('Sign-in failed');
          return r.json();
        })
        .then((data) => {
          // backend should return { email, name, token, ... }
          const user = Object.assign({}, data, { guest: false });
          savePersistentUser(user);
          saveGuestSession(null);
          Auth._currentUser = user;
          notify();
          return user;
        });
    },

    // Placeholder: create account via backend. Returns Promise.
    createAccount(email, password) {
      return fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
        .then((r) => {
          if (!r.ok) throw new Error('Account creation failed');
          return r.json();
        })
        .then((data) => {
          const user = Object.assign({}, data, { guest: false });
          savePersistentUser(user);
          saveGuestSession(null);
          Auth._currentUser = user;
          notify();
          return user;
        });
    },

    // Continue as a temporary guest user. Stored in sessionStorage so it expires when tab/window closed.
    continueAsGuest() {
      return new Promise((resolve) => {
        // Create a minimal guest user object.
        const guestUser = {
          guest: true,
          name: 'Guest User',
          email: null,
          // optionally set an expiry: 2 hours from now
          expiresAt: Date.now() + 2 * 60 * 60 * 1000
        };
        // Persist in session only (temporary)
        saveGuestSession(guestUser);
        // Ensure persistent storage is not used for guest sessions
        savePersistentUser(null);
        Auth._currentUser = guestUser;
        notify();
        resolve(guestUser);
      });
    },

    signOut() {
      savePersistentUser(null);
      saveGuestSession(null);
      Auth._currentUser = null;
      notify();
    },

    getCurrentUser() {
      return Auth._currentUser || null;
    },

    isGuest() {
      const u = Auth.getCurrentUser();
      return !!(u && u.guest);
    },

    // Whether saving chat history (or other persistent user-only features) is allowed
    canSaveHistory() {
      const u = Auth.getCurrentUser();
      // Only allow if logged in and not a guest
      return !!(u && !u.guest);
    },

    onAuthChange(callback) {
      if (typeof callback === 'function') {
        listeners.push(callback);
      }
    },

    // internal current user storage
    _currentUser: null
  };

  // Expose globally
  global.Auth = Auth;

  // Auto-initialize
  document.addEventListener('DOMContentLoaded', () => {
    Auth.init();
  });
})(window);
