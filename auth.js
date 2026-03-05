// auth.js
// Simple frontend authentication logic using localStorage for temporary session storage.
// Responsibilities:
// - Show Sign In / Sign Up forms before chat is accessible
// - Allow creating a local account (stored in localStorage: 'hym_users')
// - Create a session on sign-in (localStorage key: 'hym_session')
// - Show logged-in user's email in the header and show Settings / Logout buttons
// - Ensure chat input is only usable when logged in

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

  function setSession(email) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email }));
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
    if (session && session.email) {
      // logged in
      displayEmail.textContent = session.email;
      displayEmail.classList.remove('hidden');
      settingsBtn.classList.remove('hidden');
      logoutBtn.classList.remove('hidden');

      // Hide auth panel and enable chat input
      showAuthPanel(false);
      userInput.disabled = false;
      sendBtn.disabled = false;
      newChatBtn.disabled = false;

      // Optionally, show a welcome message in chat if empty
      if (!chatContainer.querySelector('.message')) {
        const el = document.createElement('div');
        el.className = 'message assistant';
        el.textContent = `Welcome back, ${session.email}! Ask me anything.`;
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

      // Optionally, clear chat area so content isn't visible when logged out.
      // We keep messages visible in this simple implementation but you can clear if desired.
      // chatContainer.innerHTML = '';
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
    setSession(email);
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
    setSession(email);
    signinEmail.value = signinPassword.value = '';
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
    // Optionally remove any chat-related session keys here.
    updateUIForAuth();
    // Inform user
    alert('You have been logged out.');
  });

  settingsBtn.addEventListener('click', function () {
    const session = getSession();
    if (!session) return;
    // Simple settings placeholder
    alert(`Settings for ${session.email}\n\n(Placeholder)`);
  });

  // Disable chat controls until authenticated (safety)
  userInput.disabled = true;
  sendBtn.disabled = true;
  newChatBtn.disabled = true;

  // Initialize UI based on session
  updateUIForAuth();

  // Expose a small API for other scripts (e.g., chat.js) to query session
  window.hymAuth = {
    isLoggedIn: function () { return !!getSession(); },
    currentUser: function () { const s = getSession(); return s ? s.email : null; },
    requireAuth: function () {
      const s = getSession();
      if (!s) {
        showAuthPanel(true, 'signin');
        return false;
      }
      return true;
    }
  };
})();
