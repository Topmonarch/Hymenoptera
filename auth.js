function continueAsGuest() {
  localStorage.setItem('hymenoptera_user', 'guest');
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  updateAccountDisplay();
}

function signIn() {
  var email = (document.getElementById('signin-email').value || '').trim().toLowerCase();
  var password = document.getElementById('signin-password').value || '';
  var errorEl = document.getElementById('signin-error');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Please enter email and password.';
    return;
  }

  localStorage.setItem('hymenoptera_user', email);
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  updateAccountDisplay();
}

function createAccount() {
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

  localStorage.setItem('hymenoptera_user', email);
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('chat-screen').style.display = 'flex';
  updateAccountDisplay();
}

function updateAccountDisplay() {
  var user = localStorage.getItem('hymenoptera_user');
  var label = document.getElementById('account-label');
  var signoutBtn = document.getElementById('signoutBtn');

  if (label) {
    label.textContent = user === 'guest'
      ? 'Signed in as: Guest'
      : (user ? 'Signed in as: ' + user : '');
  }

  if (signoutBtn) {
    signoutBtn.style.display = user ? 'block' : 'none';
  }
}

function signOut() {
  localStorage.removeItem('hymenoptera_user');
  document.getElementById('chat-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  if (typeof newChat === 'function') { newChat(); }
  updateAccountDisplay();
}

window.onload = function () {
  var user = localStorage.getItem('hymenoptera_user');
  if (user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';
  }
  updateAccountDisplay();
};
