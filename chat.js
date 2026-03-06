// chat.js
// Frontend chat handler: POST to /api/chat, read data.reply, manage empty-state.

(function () {
  'use strict';

  var messagesEl = document.getElementById('messages');
  var messageInput = document.getElementById('message-input');
  var emptyState = document.getElementById('empty-state');

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

  function addMessage(type, text) {
    if (!messagesEl) return;
    hideEmptyState();
    var div = document.createElement('div');
    div.className = 'message ' + type;
    div.innerText = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (type === 'bot' && messageInput) {
      messageInput.focus();
    }
  }

  // Expose addMessage globally for any callers
  window.addMessage = addMessage;

  async function sendMessage() {
    if (!messageInput) return;
    var message = (messageInput.value || '').trim();
    if (!message) return;

    addMessage('user', message);
    messageInput.value = '';

    var payload = {
      messages: [{ role: 'user', content: message }]
    };

    try {
      var response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      var data;
      try {
        data = await response.json();
      } catch (e) {
        addMessage('bot', 'Error: Invalid response from server.');
        return;
      }

      if (!response.ok) {
        var errMsg = (data && data.error && data.error.message)
          ? data.error.message
          : 'Server error';
        addMessage('bot', 'Error: ' + errMsg);
        return;
      }

      // api/chat always returns { reply: assistantText }
      addMessage('bot', data.reply || 'No reply');
    } catch (err) {
      console.error('sendMessage error:', err);
      addMessage('bot', 'Network error');
    }
  }

  // Expose sendMessage globally so onclick="sendMessage()" works
  window.sendMessage = sendMessage;

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
