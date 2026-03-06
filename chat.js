// chat.js
// Frontend chat handler: POST to /api/chat, read data.reply, manage empty-state.
// Maintains conversation memory in messages array.

// Preserves hymAuth checks and saveMessageToHistory behavior.


(function () {
  'use strict';

  var messagesEl = document.getElementById('messages');
  var messageInput = document.getElementById('message-input');
  var emptyState = document.getElementById('empty-state');

  // Conversation memory: persists across sends, reset on New Chat
  var messages = [];

  function hideEmptyState() {
    if (emptyState) {
      emptyState.classList.add('hidden');
    }
  }

  function showEmptyState() {
    if (emptyState) {
      emptyState.classList.remove('hidden');
    }
  }


  // Save a message to local history only if allowed (logged-in, non-guest users)
  function saveMessageToHistory(msg) {
    try {
      if (window.hymAuth) {
        // If hymAuth is present, respect its canSaveHistory gate
        if (!window.hymAuth.canSaveHistory || !window.hymAuth.canSaveHistory()) return;
      } else {
        // Fallback: only save for authenticated (non-guest) users
        var user = localStorage.getItem('hymenoptera_user');
        if (!user || user === 'guest') return;
      }
      var key = 'hym_messages';
      var raw = localStorage.getItem(key);
      var arr = raw ? JSON.parse(raw) : [];
      arr.push(msg);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) {
      console.warn('saveMessageToHistory error', e);
    }
  }



  function addMessage(type, text) {
    if (!messagesEl) return;
    hideEmptyState();
    var div = document.createElement('div');
    div.className = 'message ' + type;
    div.innerText = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (type === 'assistant' && messageInput) {
      messageInput.focus();
    }
  }

  // Expose addMessage globally for any callers
  window.addMessage = addMessage;

  async function sendMessage() {
    if (!messageInput) return;
    var message = (messageInput.value || '').trim();
    if (!message) return;

    // Add user message to conversation memory
    messages.push({ role: 'user', content: message });
    addMessage('user', message);
    saveMessageToHistory({ role: 'user', content: message });
    messageInput.value = '';

    try {
      var response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages })
      });

      var data;
      try {
        data = await response.json();
      } catch (e) {
        addMessage('assistant', 'Error contacting AI server');
        return;
      }

      if (!response.ok) {
        addMessage('assistant', 'Error contacting AI server');
        return;
      }

      // api/chat always returns { reply: assistantText }
      var reply = data.reply || 'No response received from server';
      // Add assistant reply to conversation memory
      messages.push({ role: 'assistant', content: reply });
      addMessage('assistant', reply);
      saveMessageToHistory({ role: 'assistant', content: reply });
    } catch (err) {
      console.error('sendMessage error:', err);
      addMessage('assistant', 'Error contacting AI server');
    }
  }

  // Expose sendMessage globally so onclick="sendMessage()" works
  window.sendMessage = sendMessage;

  // Expose clearMessages so newChat() can reset conversation memory
  window.clearMessages = function () {
    messages = [];
  };

  // Also wire up the send button via event listener
  var sendBtn = document.querySelector('.send-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', function (e) {
      e.preventDefault();
      sendMessage();
    });
  }

  // Enter key sends (Shift+Enter allows newline)
  if (messageInput) {
    messageInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // Show empty-state on initial load (if chat-screen is visible and no messages)
  showEmptyState();
})();
