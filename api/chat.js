// chat.js
// Handles sending messages to /api/chat for both guest and logged-in users.
// Fixes:
// - Send button triggers sendMessage()
// - Pressing Enter sends the message
// - POSTs { messages: [ { role: "user", content: messageText } ] } to /api/chat
// - Displays assistant reply in the chat window
// - Disables saving history for guest users (checks window.hymAuth.canSaveHistory())

(function () {
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const chatContainer = document.getElementById('chat');
  const newChatBtn = document.getElementById('newChatBtn');

  if (!userInput || !sendBtn || !chatContainer) {
    console.error('chat.js: missing required DOM elements.');
    return;
  }

  // Append a message to the chat UI
  function appendMessage(role, text) {
    const el = document.createElement('div');
    el.className = 'message ' + (role === 'user' ? 'user' : 'assistant');
    // Keep newline-friendly text rendering
    el.textContent = text;
    chatContainer.appendChild(el);
    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // Save a message to local history only if allowed
  function saveMessageToHistory(msg) {
    try {
      if (!window.hymAuth || !window.hymAuth.canSaveHistory || !window.hymAuth.canSaveHistory()) {
        // Do not save if no auth helper or if guest mode
        return;
      }
      const key = 'hym_messages';
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(msg);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) {
      // Ignore storage errors to avoid breaking chat flow
      console.warn('saveMessageToHistory error', e);
    }
  }

  // Ensure there is a session (logged in or guest). If none, prompt for auth.
  function ensureSessionOrPrompt() {
    if (window.hymAuth) {
      const loggedIn = window.hymAuth.isLoggedIn && window.hymAuth.isLoggedIn();
      const guest = window.hymAuth.isGuest && window.hymAuth.isGuest();
      if (loggedIn || guest) return true;
      // show auth
      if (window.hymAuth.requireAuth) window.hymAuth.requireAuth();
      return false;
    }
    // If hymAuth is not available, allow sending but warn
    return true;
  }

  // Send message to /api/chat
  async function sendMessage() {
    const text = (userInput.value || '').trim();
    if (!text) return;

    // Ensure user has a session (either authenticated or guest)
    if (!ensureSessionOrPrompt()) return;

    // Append user message locally
    appendMessage('user', text);

    // Save user message conditionally
    saveMessageToHistory({ role: 'user', content: text });

    // Clear input and disable controls while sending
    userInput.value = '';
    sendBtn.disabled = true;
    userInput.disabled = true;

    try {
      const payload = {
        messages: [
          { role: 'user', content: text }
        ]
      };

      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      let data;
      try {
        data = await resp.json();
      } catch (e) {
        // Non-JSON response
        appendMessage('assistant', 'Error: Invalid response from server.');
        return;
      }

      if (!resp.ok) {
        // If the server returned an error shape, try to show it
        const errMsg = (data && data.error) ? (data.error.message || JSON.stringify(data.error)) : 'Server error';
        appendMessage('assistant', `Error: ${errMsg}`);
        return;
      }

      // The backend returns { reply: assistantMessage }
      const assistantText = (data && (data.reply || data.output_text)) ? (data.reply || data.output_text) : JSON.stringify(data);
      appendMessage('assistant', assistantText);

      // Save assistant reply conditionally
      saveMessageToHistory({ role: 'assistant', content: assistantText });
    } catch (err) {
      appendMessage('assistant', 'Network error: ' + String(err));
    } finally {
      // Re-enable controls
      sendBtn.disabled = false;
      userInput.disabled = false;
      userInput.focus();
    }
  }

  // Wire up the send button
  sendBtn.addEventListener('click', function (e) {
    e.preventDefault();
    sendMessage();
  });

  // Enter key sends message (Shift+Enter allows newline)
  userInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // New Chat button clears the chat (only if session present)
  if (newChatBtn) {
    newChatBtn.addEventListener('click', function () {
      if (!ensureSessionOrPrompt()) return;
      // Clear the chat UI but do not persist for guest users
      chatContainer.innerHTML = '';
    });
  }

  // If page loads with a preexisting session (auth.js handles initial UI),
  // enable or disable the input appropriately.
  function refreshInputState() {
    if (window.hymAuth) {
      const loggedIn = window.hymAuth.isLoggedIn && window.hymAuth.isLoggedIn();
      const guest = window.hymAuth.isGuest && window.hymAuth.isGuest();
      if (loggedIn || guest) {
        userInput.disabled = false;
        sendBtn.disabled = false;
      } else {
        userInput.disabled = true;
        sendBtn.disabled = true;
      }
    } else {
      // If hymAuth isn't present, keep inputs enabled so chat can function.
      userInput.disabled = false;
      sendBtn.disabled = false;
    }
  }

  // Run at startup
  refreshInputState();

  // If hymAuth is available, listen for possible external session changes by polling a short interval
  // (simple approach when no event system is provided).
  if (window.hymAuth) {
    setInterval(refreshInputState, 1000);
  }
})();
