// ===== SETTINGS MODULE =====
// Hymenoptera Settings - Profile, Preferences, Security, Billing

var currentView = 'chat';

function setCurrentView(view) {
  currentView = view;
  var chatContainer = document.getElementById('chat-screen');
  var settingsContainer = document.getElementById('settings-screen');
  if (view === 'chat') {
    if (chatContainer) chatContainer.style.display = 'flex';
    if (settingsContainer) settingsContainer.style.display = 'none';
  } else if (view === 'settings') {
    if (chatContainer) chatContainer.style.display = 'none';
    if (settingsContainer) settingsContainer.style.display = 'flex';
  }
}

function openSettings() {
  setCurrentView('settings');
  loadSettingsData();
}

function closeSettings() {
  setCurrentView('chat');
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.querySelectorAll('.settings-panel').forEach(function(el) {
    el.classList.toggle('active', el.id === 'settings-' + tab);
  });
  clearSettingsMessages();
}

function loadSettingsData() {
  loadProfileData();
  loadBillingData();
  loadPreferencesData();
}

// ===== PROFILE =====

function loadProfileData() {
  var user = localStorage.getItem('hymenoptera_user') || '';
  var profileKey = 'hymenoptera_profile_' + user;
  var profile = {};
  try {
    profile = JSON.parse(localStorage.getItem(profileKey) || '{}');
  } catch(e) {}

  var emailEl = document.getElementById('profile-email');
  var nameEl = document.getElementById('profile-name');
  var countryEl = document.getElementById('profile-country');
  var langEl = document.getElementById('profile-language');
  var dobEl = document.getElementById('profile-dob');

  if (emailEl) emailEl.value = (user === 'guest') ? '' : user;
  if (nameEl) nameEl.value = profile.name || '';
  if (countryEl) countryEl.value = profile.country || '';
  if (langEl) langEl.value = profile.language || '';
  if (dobEl) dobEl.value = profile.dob || '';
}

function saveProfile() {
  var user = localStorage.getItem('hymenoptera_user');
  if (!user || user === 'guest') {
    showSettingsMessage('profile-message', 'Please sign in to save profile data.', 'error');
    return;
  }

  var name = (document.getElementById('profile-name').value || '').trim();
  var country = document.getElementById('profile-country').value;
  var language = document.getElementById('profile-language').value;
  var dob = document.getElementById('profile-dob').value;

  var profileKey = 'hymenoptera_profile_' + user;
  localStorage.setItem(profileKey, JSON.stringify({
    name: name,
    country: country,
    language: language,
    dob: dob
  }));

  showSettingsMessage('profile-message', 'Profile saved successfully.', 'success');
}

// ===== PREFERENCES =====

var prefDefaults = {
  compactMode: false,
  autoScroll: true,
  soundNotifications: false
};

function loadPreferencesData() {
  var stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('hymenoptera_preferences') || '{}');
  } catch(e) {}

  var prefs = Object.assign({}, prefDefaults, stored);

  var compactEl = document.getElementById('pref-compact');
  var scrollEl = document.getElementById('pref-autoscroll');
  var soundEl = document.getElementById('pref-sound');

  if (compactEl) compactEl.checked = !!prefs.compactMode;
  if (scrollEl) scrollEl.checked = !!prefs.autoScroll;
  if (soundEl) soundEl.checked = !!prefs.soundNotifications;
}

function savePreferences() {
  var compactEl = document.getElementById('pref-compact');
  var scrollEl = document.getElementById('pref-autoscroll');
  var soundEl = document.getElementById('pref-sound');

  var prefs = {
    compactMode: compactEl ? compactEl.checked : false,
    autoScroll: scrollEl ? scrollEl.checked : true,
    soundNotifications: soundEl ? soundEl.checked : false
  };

  localStorage.setItem('hymenoptera_preferences', JSON.stringify(prefs));
  showSettingsMessage('preferences-message', 'Preferences saved.', 'success');
}

// ===== SECURITY =====

function changePassword() {
  var user = localStorage.getItem('hymenoptera_user');
  if (!user || user === 'guest') {
    showSettingsMessage('security-message', 'Please sign in to change your password.', 'error');
    return;
  }

  var currentPass = (document.getElementById('current-password').value || '');
  var newPass = (document.getElementById('new-password').value || '');
  var confirmPass = (document.getElementById('confirm-new-password').value || '');

  if (!currentPass || !newPass || !confirmPass) {
    showSettingsMessage('security-message', 'All password fields are required.', 'error');
    return;
  }

  if (newPass.length < 6) {
    showSettingsMessage('security-message', 'New password must be at least 6 characters.', 'error');
    return;
  }

  if (newPass !== confirmPass) {
    showSettingsMessage('security-message', 'New passwords do not match.', 'error');
    return;
  }

  localStorage.setItem('hymenoptera_password_' + user, newPass);

  document.getElementById('current-password').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('confirm-new-password').value = '';

  showSettingsMessage('security-message', 'Password updated successfully.', 'success');
}

function logoutAllSessions() {
  if (confirm('This will sign you out of the current session. Continue?')) {
    closeSettings();
    if (typeof signOut === 'function') signOut();
  }
}

function deleteAccount() {
  if (!confirm('Are you sure you want to permanently delete your account? All your data will be removed and this cannot be undone.')) return;

  var user = localStorage.getItem('hymenoptera_user');

  var keysToRemove = [
    'hymenoptera_user',
    'hymenoptera_plan',
    'hymenoptera_msg_count',
    'hymenoptera_msg_date',
    'hymenoptera_conversations',
    'hymenoptera_projects',
    'hymenoptera_preferences',
    'hymenoptera_needs_verification',
    'hymenoptera_pending_email',
    'hymenoptera_pending_token'
  ];

  if (user) {
    keysToRemove.push('hymenoptera_verified_' + user);
    keysToRemove.push('hymenoptera_profile_' + user);
    keysToRemove.push('hymenoptera_password_' + user);
    keysToRemove.push('hymenoptera_stripe_customer_' + user);
  }

  keysToRemove.forEach(function(key) {
    localStorage.removeItem(key);
  });

  document.getElementById('settings-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  if (typeof updateAccountDisplay === 'function') updateAccountDisplay();
}

// ===== BILLING =====

var planLimitsDisplay = {
  starter: '30 messages / day',
  basic: '150 messages / day',
  premium: '500 messages / day',
  ultimate: 'Unlimited messages'
};

function loadBillingData() {
  var plan = localStorage.getItem('hymenoptera_plan') || 'starter';
  var planName = plan.charAt(0).toUpperCase() + plan.slice(1);

  var planNameEl = document.getElementById('billing-plan-name');
  var planLimitEl = document.getElementById('billing-plan-limit');

  if (planNameEl) planNameEl.textContent = planName;
  if (planLimitEl) planLimitEl.textContent = planLimitsDisplay[plan] || '30 messages / day';
}

function openBillingPortal() {
  var user = localStorage.getItem('hymenoptera_user');
  if (!user || user === 'guest') {
    showSettingsMessage('billing-message', 'Please sign in to manage billing.', 'error');
    return;
  }

  var customerId = localStorage.getItem('hymenoptera_stripe_customer_' + user);
  if (!customerId) {
    showSettingsMessage('billing-message', 'No billing account found. Please upgrade to a paid plan first.', 'error');
    return;
  }

  fetch('/api/billing-portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: customerId })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.url) {
      window.location.href = data.url;
    } else {
      showSettingsMessage('billing-message', 'Could not open billing portal. Please try again.', 'error');
    }
  })
  .catch(function() {
    showSettingsMessage('billing-message', 'Could not connect to billing portal. Please try again.', 'error');
  });
}

// ===== HELPERS =====

function showSettingsMessage(elementId, message, type) {
  var el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = 'settings-message ' + (type || 'success');
  clearTimeout(el._msgTimeout);
  el._msgTimeout = setTimeout(function() {
    el.textContent = '';
    el.className = 'settings-message';
  }, 4000);
}

function clearSettingsMessages() {
  document.querySelectorAll('.settings-message').forEach(function(el) {
    el.textContent = '';
    el.className = 'settings-message';
  });
}

// ===== EMAIL VERIFICATION =====

function createAccountWithVerification() {
  var email = (document.getElementById('signup-email').value || '').trim().toLowerCase();
  var password = document.getElementById('signup-password').value || '';
  var confirm = document.getElementById('signup-confirm').value || '';
  var errorEl = document.getElementById('signup-error');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password.';
    return;
  }

  if (password !== confirm) {
    errorEl.textContent = 'Passwords do not match.';
    return;
  }

  var token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  localStorage.setItem('hymenoptera_pending_email', email);
  localStorage.setItem('hymenoptera_pending_token', token);
  localStorage.setItem('hymenoptera_password_' + email, password);
  localStorage.setItem('hymenoptera_needs_verification', 'true');

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('verification-screen').style.display = 'flex';

  var emailDisplay = document.getElementById('verification-email-display');
  if (emailDisplay) emailDisplay.textContent = email;
}

function cancelVerification() {
  localStorage.removeItem('hymenoptera_needs_verification');
  localStorage.removeItem('hymenoptera_pending_email');
  localStorage.removeItem('hymenoptera_pending_token');

  document.getElementById('verification-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function resendVerificationEmail() {
  var msgEl = document.getElementById('verification-message');
  if (msgEl) msgEl.textContent = 'Verification email resent.';
}

function checkVerificationToken() {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('verify');

  if (token) {
    var storedToken = localStorage.getItem('hymenoptera_pending_token');
    if (token === storedToken) {
      var email = localStorage.getItem('hymenoptera_pending_email');
      localStorage.removeItem('hymenoptera_needs_verification');
      localStorage.removeItem('hymenoptera_pending_token');
      localStorage.removeItem('hymenoptera_pending_email');
      localStorage.setItem('hymenoptera_user', email);
      localStorage.setItem('hymenoptera_verified_' + email, 'true');
      history.replaceState(null, '', window.location.pathname);
    }
  }
}

function checkVerificationState() {
  var needsVerification = localStorage.getItem('hymenoptera_needs_verification');
  var user = localStorage.getItem('hymenoptera_user');

  if (needsVerification === 'true' && !user) {
    var loginScreen = document.getElementById('login-screen');
    var verificationScreen = document.getElementById('verification-screen');
    if (loginScreen) loginScreen.style.display = 'none';
    if (verificationScreen) verificationScreen.style.display = 'flex';

    var email = localStorage.getItem('hymenoptera_pending_email');
    var emailDisplay = document.getElementById('verification-email-display');
    if (emailDisplay && email) emailDisplay.textContent = email;
  }
}

// ===== INIT =====

document.addEventListener('DOMContentLoaded', function() {
  checkVerificationToken();
  checkVerificationState();

  var params = new URLSearchParams(window.location.search);
  if (params.get('portal') === 'return') {
    history.replaceState(null, '', window.location.pathname);
    var user = localStorage.getItem('hymenoptera_user');
    if (user) {
      openSettings();
      switchSettingsTab('billing');
    }
  }
});
