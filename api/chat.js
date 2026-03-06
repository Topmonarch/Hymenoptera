// chat.js - UI wiring for Hymenoptera chat and auth flow
// Wired: Send button + Enter key => sendMessage()
// Auth: Sign In, Sign Up, Continue as Guest => show chat UI

let currentUser = null;

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const authOverlay = document.getElementById('authOverlay');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const signInBtn = document.getElementById('signInBtn');
  const signUpBtn = document.getElementById('signUpBtn');
  const guestBtn = document.getElementById('guestBtn');
  const closeAuth = document.getElementById('closeAuth');

  const chatContainer = document.getElementById('chatContainer');
  const welcomeContainer = document.getElementById('welcomeContainer');
  const newChatBtn = document.getElementById('newChatBtn');
  const messages = document.getElementById('messages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const messageForm = document.getElementById('messageForm');

  // Tab switching
  tabSignIn.addEventListener('click', () => {
    tabSignIn.classList.add('active');
    tabSignUp.classList.remove('active');
    signInForm.classList.remove('hidden');
    signUpForm.classList.add('hidden');
  });

  tabSignUp.addEventListener('click', () => {
    tabSignUp.classList.add('active');
    tabSignIn.classList.remove('active');
    signUpForm.classList.remove('hidden');
    signInForm.classList.add('hidden');
  });

  // Auth actions
  signInBtn.addEventListener('click', signIn);
  signUpBtn.addEventListener('click', signUp);
  guestBtn.addEventListener('click', continueAsGuest);

  closeAuth.addEventListener('click', () => {
    // Close overlay but keep chat hidden if no auth
    authOverlay.classList.add('hidden');
  });

  // Chat actions
  sendBtn.addEventListener('click', sendMessage);

  // Enter key sends message; Shift+Enter adds newline
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  newChatBtn.addEventListener('click', () => {
    clearMessages();
    appendSystemMessage('New chat started.');
    messageInput.focus();
  });

  // Show auth overlay on load
  showAuthOverlay();
});

/* UI control functions */

function showAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.classList.remove('hidden');
  hideChatUI();
}

function hideAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function showChatUI() {
  hideAuthOverlay();
  const chatContainer = document.getElementById('chatContainer');
  const welcomeContainer = document.getElementById('welcomeContainer');
  if (chatContainer) chatContainer.classList.remove('hidden');
  if (welcomeContainer) welcomeContainer.classList.add('hidden');

  const input = document.getElementById('messageInput');
  if (input) input.focus();

  const messages = document.getElementById('messages');
  if (messages && messages.children.length === 0) {
    appendSystemMessage('You are now connected. Say hello!');
  }
}

function hideChatUI() {
  const chatContainer = document.getElementById('chatContainer');
  const welcomeContainer = document.getElementById('welcomeContainer');
  if (chatContainer) chatContainer.classList.add('hidden');
  if (welcomeContainer) welcomeContainer.classList.remove('hidden');
}

/* Simulated auth - replace with real backend calls */

function signIn() {
  const email = document.getElementById('signinEmail').value.trim();
  const password = document.getElementById('signinPassword').value.trim();

  if (!email || !password) {
    alert('Please enter both email and password.');
    return;
  }

  // TODO: replace with real authentication
  currentUser = { email, name: email.split('@')[0], guest: false };
  appendSystemMessage(`Signed in as ${currentUser.email}`);
  showChatUI();
}

function signUp() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value.trim();

  if (!name || !email || !password) {
    alert('Please fill out all fields to create an account.');
    return;
  }

  // TODO: replace with real account creation
  currentUser = { email, name, guest: false };
  appendSystemMessage(`Account created for ${currentUser.name}`);
  showChatUI();
}

function continueAsGuest() {
  currentUser = { name: 'Guest', guest: true };
  appendSystemMessage('Continuing as Guest');
  showChatUI();
}

/* Chat messaging functions */

function sendMessage() {
  const input = document.getElementById('messageInput');
  if (!input) return;
  const text = input.value.replace(/\u00A0/g, ' ').trim();
  if (!text) return;

  appendUserMessage(text);
  input.value = '';
  input.focus();

  // TODO: integrate with backend/AI message send here.
  // Placeholder: simulated reply
  simulateBotReply(text);
}

function appendUserMessage(text) {
  appendMessage('You', text, 'user');
}

function appendSystemMessage(text) {
  appendMessage('System', text, 'system');
}

function appendBotMessage(text) {
  appendMessage('Hymenoptera', text, 'bot');
}

function appendMessage(sender, text, kind) {
  const messages = document.getElementById('messages');
  if (!messages) return;

  const wrapper = document.createElement('div');
  wrapper.className = `message ${kind}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = sender;
  wrapper.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = text.split('\n').map(escapeHtml).join('<br/>');
  wrapper.appendChild(body);

  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
}

function clearMessages() {
  const messages = document.getElementById('messages');
  if (messages) messages.innerHTML = '';
}

function simulateBotReply(userText) {
  setTimeout(() => {
    appendBotMessage(`(simulated reply) You said: "${userText}"`);
  }, 700);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}
