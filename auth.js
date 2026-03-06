// auth.js – session management and UI toggling for #login-screen / #chat-screen

// ── Session helpers ──────────────────────────────────────────────────────────

function getSession() {
  try {
    const raw = localStorage.getItem('hymenoptera_session');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setSession(email, opts) {
  try {
    localStorage.setItem('hymenoptera_session', JSON.stringify({
      email: email,
      guest: !!(opts && opts.guest)
    }));
    // legacy key kept for backwards compat
    localStorage.setItem('hymenoptera_user', email);
  } catch (e) { /* ignore */ }
}

function clearSession() {
  try {
    localStorage.removeItem('hymenoptera_session');
    localStorage.removeItem('hymenoptera_user');
    const chatKeys = ['hym_messages', 'hym_conversations', 'hym_chat', 'chat_history', 'hym_last_chat'];
    chatKeys.forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) { /* ignore */ }
}

// ── Expose hymAuth for chat.js ───────────────────────────────────────────────

window.hymAuth = {
  isLoggedIn: function () {
    var s = getSession();
    return !!(s && !s.guest);
  },
  isGuest: function () {
    var s = getSession();
    return !!(s && s.guest);
  },
  canSaveHistory: function () {
    return window.hymAuth.isLoggedIn();
  },
  requireAuth: function () {
    showLoginScreen();
  }
};

// ── Screen helpers ───────────────────────────────────────────────────────────

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('chat-screen').style.display = 'none';
}

function showChatScreen() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';

  var s = getSession();
  var emailEl = document.getElementById('displayEmail');
  var logoutBtn = document.getElementById('logoutBtn');
  var settingsBtn = document.getElementById('settingsBtn');

  if (s) {
    if (emailEl) {
      emailEl.textContent = s.guest ? 'Guest' : s.email;
      emailEl.classList.remove('hidden');
    }
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    if (settingsBtn) {
      if (s.guest) {
        settingsBtn.classList.add('hidden');
      } else {
        settingsBtn.classList.remove('hidden');
      }
    }
  }
}

// ── Global auth functions (called by inline onclick in HTML) ─────────────────

function continueAsGuest() {
  setSession('guest', { guest: true });
  showChatScreen();
}

function signIn() {
  var email = (document.getElementById('email').value || '').trim();
  var password = document.getElementById('password').value || '';

  if (!email || !password) {
    alert('Enter email and password');
    return;
  }

  setSession(email, { guest: false });
  showChatScreen();
}

// ── Initialise on page load ──────────────────────────────────────────────────

window.onload = function () {
  // Restore session if one exists
  var session = getSession();
  var legacyUser = localStorage.getItem('hymenoptera_user');

  if (session || legacyUser) {
    showChatScreen();
  }

  // Logout button
  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      clearSession();
      var emailEl = document.getElementById('displayEmail');
      if (emailEl) emailEl.classList.add('hidden');
      logoutBtn.classList.add('hidden');
      var settingsBtn = document.getElementById('settingsBtn');
      if (settingsBtn) settingsBtn.classList.add('hidden');
      showLoginScreen();
      alert('You have been logged out.');
    });
  }

  // Header settings button (logged-in users only)
  var settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function () {
      var s = getSession();
      alert('Settings for ' + (s ? s.email : 'user') + '\n\n(Placeholder)');
    });
  }

  // Sidebar settings button
  var sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
  if (sidebarSettingsBtn) {
    sidebarSettingsBtn.addEventListener('click', function () {
      var s = getSession();
      if (!s || s.guest) {
        alert('Sign in to access Settings.');
        return;
      }
      alert('Settings for ' + s.email + '\n\n(Placeholder)');
    });
  }

  // New Chat button state (chat.js handles the click, but auth controls disabled state)
  var newChatBtn = document.getElementById('newChatBtn');
  if (newChatBtn) {
    newChatBtn.disabled = !(session || legacyUser);
  }
};
