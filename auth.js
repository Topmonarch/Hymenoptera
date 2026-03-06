function continueAsGuest() {

  localStorage.setItem("hymenoptera_user", "guest");

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("chat-screen").style.display = "flex";

}

function signIn() {

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!email || !password) {
    alert("Enter email and password");
    return;
  }

  localStorage.setItem("hymenoptera_user", email);

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("chat-screen").style.display = "flex";

}

window.onload = function () {

  const user = localStorage.getItem("hymenoptera_user");

  if (user) {

    document.getElementById("login-screen").style.display = "none";
    document.getElementById("chat-screen").style.display = "flex";

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

  function openSettings() {
    const session = getSession();
    if (!session || session.guest) {
      alert('Sign in to access Settings.');
      return;
    }
    // Simple settings placeholder
    alert(`Settings for ${session.email}\n\n(Placeholder)`);
  }

  settingsBtn.addEventListener('click', openSettings);

  // Sidebar Settings button (always visible)
  const sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
  if (sidebarSettingsBtn) {
    sidebarSettingsBtn.addEventListener('click', openSettings);
  }

  // Disable chat controls until authenticated (safety)
  userInput.disabled = true;
  sendBtn.disabled = true;
  newChatBtn.disabled = true;

  // Initialize UI based on session
  updateUIForAuth();
=======
  }


};
