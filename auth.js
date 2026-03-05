// auth.js
// Extended frontend authentication logic with "Continue as Guest" support.
// - Sign In / Sign Up with localStorage-based temporary accounts
// - Continue as Guest creates a temporary guest session (no history saving)
// - Exposes window.hymAuth with helpers: isLoggedIn, isGuest, currentUser, canSaveHistory, requireAuth

(function () {
  // DOM elements
  const authPanel = document.getElementById('authPanel');
  const signInBox = document.getElementById('signInBox');
  const signUpBox = document.getElementById('signUpBox');
  const showSignup = document.getElementById('showSignup');
  const showSignin = document.getElementById('showSignin');

  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');

  const signinEmail = document.getElementById('signinEmail');
  const signinPassword = document.getElementById('signinPassword');
  const signupEmail = document.getElementById('signupEmail');
  const signupPassword = document.getElementById('signupPassword');
  const signupConfirm = document.getElementById('signupConfirm');

  const signinError = document.getElementById('signinError');
  const signupError = document.getElementById('signupError');

  const continueGuestBtn = document.getElementById('continueGuestBtn');

  const displayEmail = document.getElementById('displayEmail');
  const settingsBtn = document.getElementById('settingsBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const chatContainer = document.getElementById('chat');
  const newChatBtn = document.getElementById('newChatBtn');

  // storage keys
  const USERS_KEY = 'hym_users';
  const SESSION_KEY = 'hym_session';

  // Helpers to manage simple users store
  function loadUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  // Session management
  function setSession(email, opts = {}) {
    // opts.guest = boolean
    const session = { email: email || null, guest: !!opts.guest, createdAt: Date.now() };
    // For guest sessions, we still persist in localStorage so page reload keeps temporary session.
    // They are intended to be temporary; logout will clear them.
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  function setGuestSessionTemporary() {
    // Create a guest session with email "Guest User"
    setSession('Guest User', { guest: true });
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }
  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // UI helpers
  function showAuthPanel(show, mode = 'signin') {
    if (show) {
      authPanel.classList.remove('hidden');
      if (mode === 'signin') {
        signInBox.classList.remove('hidden');
        signUpBox.classList.add('hidden');
      } else {
        signUpBox.classList.remove('hidden');
        signInBox.classList.add('hidden');
      }
    } else {
      authPanel.classList.add('hidden');
    }
  }

  function updateUIForAuth() {
    const session = getSession();
    if (session && (session.email || session.guest)) {
      // logged in (or guest)
      const isGuest = !!session.guest;
      displayEmail.textContent = session.email || (isGuest ? 'Guest User' : '');
      displayEmail.classList.remove('hidden');

      // Settings only for fully authenticated users (not guest)
      if (!isGuest) {
        settingsBtn.classList.remove('hidden');
      } else {
        settingsBtn.classList.add('hidden');
      }
      logoutBtn.classList.remove('hidden');

      // Hide auth panel and enable chat input
      showAuthPanel(false);
      userInput.disabled = false;
      sendBtn.disabled = false;
      newChatBtn.disabled = false;

      // For guest sessions, show a mild notice (placed in chat)
      if (!chatContainer.querySelector('.message')) {
        const el = document.createElement('div');
        el.className = 'message assistant';
        if (isGuest) {
          el.textContent = `You're signed in as a Guest. Chat history will not be saved.`;
        } else {
          el.textContent = `Welcome back, ${session.email}! Ask me anything.`;
        }
        chatContainer.appendChild(el);
      }
    } else {
      // logged out
      displayEmail.classList.add('hidden');
      settingsBtn.classList.add('hidden');
      logoutBtn.classList.add('hidden');

      // Show auth panel and disable chat input
      showAuthPanel(true, 'signin');
      userInput.disabled = true;
      sendBtn.disabled = true;
      newChatBtn.disabled = true;
    }
  }

  // Event handlers
  signUpForm.addEventListener('submit', function (e) {
    e.preventDefault();
    signupError.textContent = '';

    const email = (signupEmail.value || '').trim().toLowerCase();
    const password = signupPassword.value || '';
    const confirm = signupConfirm.value || '';

    if (!email || !password) {
      signupError.textContent = 'Please enter email and password.';
      return;
    }
    if (password.length < 6) {
      signupError.textContent = 'Password must be at least 6 characters.';
      return;
    }
    if (password !== confirm) {
      signupError.textContent = 'Passwords do not match.';
      return;
    }

    const users = loadUsers();
    if (users[email]) {
      signupError.textContent = 'An account with that email already exists. Please sign in.';
      return;
    }

    // NOTE: This is temporary local-only storage. Do NOT use for production.
    users[email] = {
      password: password // plain text for demo; in production hash + server storage required
    };
    saveUsers(users);

    // Create session and update UI
    setSession(email, { guest: false });
    signupEmail.value = signupPassword.value = signupConfirm.value = '';
    updateUIForAuth();
  });

  signInForm.addEventListener('submit', function (e) {
    e.preventDefault();
    signinError.textContent = '';

    const email = (signinEmail.value || '').trim().toLowerCase();
    const password = signinPassword.value || '';

    if (!email || !password) {
      signinError.textContent = 'Please enter email and password.';
      return;
    }

    const users = loadUsers();
    if (!users[email] || users[email].password !== password) {
      signinError.textContent = 'Invalid email or password.';
      return;
    }

    // success
    setSession(email, { guest: false });
    signinEmail.value = signinPassword.value = '';
    updateUIForAuth();
  });

  // Continue as Guest handler
  continueGuestBtn.addEventListener('click', function () {
    // Create a temporary guest session
    setGuestSessionTemporary();

    // Important: Ensure we disable any local saving that might have persisted from a previous logged-in user.
    // Clear well-known local keys that might contain saved chat (best-effort; chat.js should check hymAuth.canSaveHistory())
    try {
      // Common keys that might be used by chat.js — remove to ensure guest does not inherit history.
      const potentialKeys = ['hym_messages', 'hym_conversations', 'hym_chat', 'chat_history', 'hym_last_chat'];
      potentialKeys.forEach((k) => {
        if (localStorage.getItem(k)) localStorage.removeItem(k);
      });
    } catch (e) {
      // ignore storage errors
    }

    updateUIForAuth();
  });

  showSignup.addEventListener('click', function () {
    showAuthPanel(true, 'signup');
    signinError.textContent = '';
    signupError.textContent = '';
  });
  showSignin.addEventListener('click', function () {
    showAuthPanel(true, 'signin');
    signinError.textContent = '';
    signupError.textContent = '';
  });

  logoutBtn.addEventListener('click', function () {
    clearSession();

    // If guest, nothing to persist; if regular user, you may want to clear local-only chat storage for privacy.
    // We'll remove common chat keys for safety.
    try {
      const potentialKeys = ['hym_messages', 'hym_conversations', 'hym_chat', 'chat_history', 'hym_last_chat'];
      potentialKeys.forEach((k) => {
        if (localStorage.getItem(k)) localStorage.removeItem(k);
      });
    } catch (e) {
      // ignore storage errors
    }

    updateUIForAuth();
    // Inform user
    alert('You have been logged out.');
  });

  settingsBtn.addEventListener('click', function () {
    const session = getSession();
    if (!session || session.guest) return;
    // Simple settings placeholder
    alert(`Settings for ${session.email}\n\n(Placeholder)`);
  });

  // Disable chat controls until authenticated (safety)
  userInput.disabled = true;
  sendBtn.disabled = true;
  newChatBtn.disabled = true;

  // Initialize UI based on session
  updateUIForAuth();

  // Expose a small API for other scripts (e.g., chat.js) to query session and capabilities
  window.hymAuth = {
    isLoggedIn: function () {
      const s = getSession();
      return !!(s && !s.guest && s.email);
    },
    isGuest: function () {
      const s = getSession();
      return !!(s && s.guest);
    },
    currentUser: function () {
      const s = getSession();
      if (!s) return null;
      // For guest sessions, return 'Guest User' string as requested.
      return s.guest ? 'Guest User' : s.email;
    },
    canSaveHistory: function () {
      const s = getSession();
      // Only allow saving chat history for authenticated (non-guest) users
      return !!(s && !s.guest && s.email);
    },
    requireAuth: function () {
      const s = getSession();
      if (!s) {
        showAuthPanel(true, 'signin');
        return false;
      }
      return true;
    },
    // helpers for programmatic sign out/sign in
    signOut: function () { clearSession(); updateUIForAuth(); },
    signInProgrammatic: function (email) { setSession(email, { guest: false }); updateUIForAuth(); },
    continueAsGuest: function () { setGuestSessionTemporary(); updateUIForAuth(); }
  };
})();
