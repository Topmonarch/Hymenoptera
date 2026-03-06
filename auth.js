// auth.js
// Handles authentication: Sign In, Sign Up, Continue as Guest, Logout.
// Exposes window.hymAuth API for chat.js to check session state.

// ── Local storage helpers ──────────────────────────────────────────────────

function loadUsers() {
  try {
    var raw = localStorage.getItem('hym_users');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveUser(email, data) {
  var users = loadUsers();
  users[email] = data;
  localStorage.setItem('hym_users', JSON.stringify(users));
}

function setSession(email, opts) {
  var session = { email: email, guest: !!(opts && opts.guest), ts: Date.now() };
  localStorage.setItem('hym_session', JSON.stringify(session));
}

// Guest sessions live only for the browser tab (sessionStorage).
function setGuestSessionTemporary() {
  var session = { email: 'guest', guest: true, ts: Date.now() };
  sessionStorage.setItem('hym_session', JSON.stringify(session));
  localStorage.removeItem('hym_session');
}

function getSession() {
  try {
    var raw = localStorage.getItem('hym_session') || sessionStorage.getItem('hym_session');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem('hym_session');
  sessionStorage.removeItem('hym_session');
}

// ── Public API consumed by api/chat.js ────────────────────────────────────

window.hymAuth = {
  isLoggedIn: function () {
    var s = getSession();
    return !!(s && s.email && !s.guest);
  },
  isGuest: function () {
    var s = getSession();
    return !!(s && s.guest);
  },
  canSaveHistory: function () {
    var s = getSession();
    return !!(s && s.email && !s.guest);
  },
  requireAuth: function () {
    showAuthPanel(true, 'signin');
  }
};

// ── UI helpers ─────────────────────────────────────────────────────────────

function showAuthPanel(show, mode) {
  var panel = document.getElementById('authPanel');
  if (!panel) return;
  if (show) {
    panel.classList.remove('hidden');
    var signInBox = document.getElementById('signInBox');
    var signUpBox = document.getElementById('signUpBox');
    if (mode === 'signup') {
      if (signInBox) signInBox.classList.add('hidden');
      if (signUpBox) signUpBox.classList.remove('hidden');
    } else {
      if (signInBox) signInBox.classList.remove('hidden');
      if (signUpBox) signUpBox.classList.add('hidden');
    }
  } else {
    panel.classList.add('hidden');
  }
}

function updateUIForAuth() {
  var session = getSession();
  var loggedIn = !!(session && session.email && !session.guest);
  var guest = !!(session && session.guest);
  var authenticated = loggedIn || guest;

  // Auth panel: show when not authenticated
  showAuthPanel(!authenticated);

  var displayEmail = document.getElementById('displayEmail');
  var settingsBtn  = document.getElementById('settingsBtn');
  var logoutBtn    = document.getElementById('logoutBtn');
  var userInput    = document.getElementById('userInput');
  var sendBtn      = document.getElementById('sendBtn');
  var newChatBtn   = document.getElementById('newChatBtn');

  if (displayEmail) {
    if (loggedIn) {
      displayEmail.textContent = session.email;
      displayEmail.classList.remove('hidden');
    } else {
      displayEmail.textContent = '';
      displayEmail.classList.add('hidden');
    }
  }

  if (settingsBtn) {
    if (loggedIn) settingsBtn.classList.remove('hidden');
    else settingsBtn.classList.add('hidden');
  }

  if (logoutBtn) {
    if (authenticated) logoutBtn.classList.remove('hidden');
    else logoutBtn.classList.add('hidden');
  }

  if (userInput) userInput.disabled = !authenticated;
  if (sendBtn)   sendBtn.disabled   = !authenticated;
  if (newChatBtn) newChatBtn.disabled = !authenticated;
}

// ── Initialise on load ─────────────────────────────────────────────────────

window.onload = function () {

  var signInForm      = document.getElementById('signInForm');
  var signUpForm      = document.getElementById('signUpForm');
  var continueGuestBtn = document.getElementById('continueGuestBtn');
  var showSignup      = document.getElementById('showSignup');
  var showSignin      = document.getElementById('showSignin');
  var settingsBtn     = document.getElementById('settingsBtn');
  var logoutBtn       = document.getElementById('logoutBtn');
  var signinEmail     = document.getElementById('signinEmail');
  var signinPassword  = document.getElementById('signinPassword');
  var signinError     = document.getElementById('signinError');
  var signupEmail     = document.getElementById('signupEmail');
  var signupPassword  = document.getElementById('signupPassword');
  var signupConfirm   = document.getElementById('signupConfirm');
  var signupError     = document.getElementById('signupError');

  // Sign In handler
  if (signInForm) {
    signInForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (signinError) signinError.textContent = '';

      var email    = (signinEmail.value || '').trim().toLowerCase();
      var password = signinPassword.value || '';

      if (!email || !password) {
        if (signinError) signinError.textContent = 'Please enter email and password.';
        return;
      }

      var users = loadUsers();
      if (!users[email] || users[email].password !== password) {
        if (signinError) signinError.textContent = 'Invalid email or password.';
        return;
      }

      setSession(email, { guest: false });
      signinEmail.value = signinPassword.value = '';
      updateUIForAuth();
    });
  }

  // Sign Up handler
  if (signUpForm) {
    signUpForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (signupError) signupError.textContent = '';

      var email    = (signupEmail.value || '').trim().toLowerCase();
      var password = signupPassword.value || '';
      var confirm  = signupConfirm.value || '';

      if (!email || !password) {
        if (signupError) signupError.textContent = 'Please enter email and password.';
        return;
      }
      if (password !== confirm) {
        if (signupError) signupError.textContent = 'Passwords do not match.';
        return;
      }

      var users = loadUsers();
      if (users[email]) {
        if (signupError) signupError.textContent = 'An account with this email already exists.';
        return;
      }

      saveUser(email, { password: password });
      setSession(email, { guest: false });
      signupEmail.value = signupPassword.value = signupConfirm.value = '';
      updateUIForAuth();
    });
  }

  // Continue as Guest handler
  if (continueGuestBtn) {
    continueGuestBtn.addEventListener('click', function () {
      setGuestSessionTemporary();
      // Clear any leftover chat history from a previous logged-in user.
      try {
        var potentialKeys = ['hym_messages', 'hym_conversations', 'hym_chat', 'chat_history', 'hym_last_chat'];
        potentialKeys.forEach(function (k) {
          if (localStorage.getItem(k)) localStorage.removeItem(k);
        });
      } catch (e) { /* ignore storage errors */ }
      updateUIForAuth();
    });
  }

  // Toggle between Sign In and Sign Up forms
  if (showSignup) {
    showSignup.addEventListener('click', function () {
      showAuthPanel(true, 'signup');
      if (signinError) signinError.textContent = '';
      if (signupError) signupError.textContent = '';
    });
  }

  if (showSignin) {
    showSignin.addEventListener('click', function () {
      showAuthPanel(true, 'signin');
      if (signinError) signinError.textContent = '';
      if (signupError) signupError.textContent = '';
    });
  }

  // Logout handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      clearSession();
      try {
        var potentialKeys = ['hym_messages', 'hym_conversations', 'hym_chat', 'chat_history', 'hym_last_chat'];
        potentialKeys.forEach(function (k) {
          if (localStorage.getItem(k)) localStorage.removeItem(k);
        });
      } catch (e) { /* ignore storage errors */ }
      updateUIForAuth();
      alert('You have been logged out.');
    });
  }

  function openSettings() {
    var session = getSession();
    if (!session || session.guest) {
      alert('Sign in to access Settings.');
      return;
    }
    alert('Settings for ' + session.email + '\n\n(Placeholder)');
  }

  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

  var sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
  if (sidebarSettingsBtn) sidebarSettingsBtn.addEventListener('click', openSettings);

  // Apply initial UI state based on any existing session.
  updateUIForAuth();
};
