// chat.js
// Frontend chat logic for Hymenoptera.
// - Send button and Enter key both trigger sendMessage()
// - POSTs { messages: [{ role: "user", content: messageText }] } to /api/chat
// - Reads data.reply from the server response and displays it in the chat window
// - Handles server and network errors with readable messages
// - Guest users can chat but history is not saved (checks window.hymAuth.canSaveHistory())

(function () {
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const chatContainer = document.getElementById('chat');
  const newChatBtn = document.getElementById('newChatBtn');

  if (!userInput || !sendBtn || !chatContainer) {
    console.error('chat.js: missing required DOM elements.');
    return;
  }

  // Append a message bubble to the chat UI
  function appendMessage(role, text) {
    const el = document.createElement('div');
    el.className = 'message ' + (role === 'user' ? 'user' : 'assistant');
    el.textContent = text;
    chatContainer.appendChild(el);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // Persist a message to localStorage only when allowed (logged-in users only)
  function saveMessageToHistory(msg) {
    try {
      if (!window.hymAuth || !window.hymAuth.canSaveHistory || !window.hymAuth.canSaveHistory()) {
        return;
      }
      const key = 'hym_messages';
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(msg);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) {
      console.warn('saveMessageToHistory error', e);
    }
  }

  // Return true if the user has an active session (logged-in or guest).
  // If not, show the auth panel and return false.
  function ensureSessionOrPrompt() {
    if (window.hymAuth) {
      const loggedIn = window.hymAuth.isLoggedIn && window.hymAuth.isLoggedIn();
      const guest = window.hymAuth.isGuest && window.hymAuth.isGuest();
      if (loggedIn || guest) return true;
      if (window.hymAuth.requireAuth) window.hymAuth.requireAuth();
      return false;
    }
    // If hymAuth is not available, allow sending anyway
    return true;
  }

  // Send the current input to /api/chat and display the reply
  async function sendMessage() {
    const text = (userInput.value || '').trim();
    if (!text) return;

    if (!ensureSessionOrPrompt()) return;

    appendMessage('user', text);
    saveMessageToHistory({ role: 'user', content: text });

    userInput.value = '';
    sendBtn.disabled = true;
    userInput.disabled = true;

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: text }] })
      });

      let data;
      try {
        data = await resp.json();
      } catch (e) {
        appendMessage('assistant', 'Error: The server returned an unreadable response. Please try again.');
        return;
      }

      if (!resp.ok) {
        const errMsg = (data && data.error && data.error.message)
          ? data.error.message
          : 'Something went wrong on the server. Please try again.';
        appendMessage('assistant', 'Error: ' + errMsg);
        return;
      }

      const assistantText = data && data.reply;
      if (typeof assistantText !== 'string' || assistantText.length === 0) {
        appendMessage('assistant', 'Error: Received an empty or invalid reply from the server.');
        return;
      }

      appendMessage('assistant', assistantText);
      saveMessageToHistory({ role: 'assistant', content: assistantText });
    } catch (err) {
      appendMessage('assistant', 'Network error: ' + String(err));
    } finally {
      sendBtn.disabled = false;
      userInput.disabled = false;
      userInput.focus();
    }
  }

  // Send button click
  sendBtn.addEventListener('click', function (e) {
    e.preventDefault();
    sendMessage();
  });

  // Enter key sends (Shift+Enter allows a newline)
  userInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // New Chat button clears the visible conversation
  if (newChatBtn) {
    newChatBtn.addEventListener('click', function () {
      if (!ensureSessionOrPrompt()) return;
      chatContainer.innerHTML = '';
    });
  }

  // Enable or disable the input controls based on the current session state
  function refreshInputState() {
    if (window.hymAuth) {
      const loggedIn = window.hymAuth.isLoggedIn && window.hymAuth.isLoggedIn();
      const guest = window.hymAuth.isGuest && window.hymAuth.isGuest();
      const active = loggedIn || guest;
      userInput.disabled = !active;
      sendBtn.disabled = !active;
    } else {
      userInput.disabled = false;
      sendBtn.disabled = false;
    }
  }

  refreshInputState();

  // Poll for session changes (e.g. login/logout triggered by auth.js)
  if (window.hymAuth) {
    setInterval(refreshInputState, 1000);
  }
})();
