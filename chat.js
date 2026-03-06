// chat.js
// Frontend chat handler: POST to /api/chat, read data.reply, manage empty-state.
// Maintains conversation memory in messages array.

// Preserves hymAuth checks and saveMessageToHistory behavior.


(function () {
  'use strict';

  var messagesEl = document.getElementById('messages');
  var messageInput = document.getElementById('message-input');
  var emptyState = document.getElementById('empty-state');

  // Multi-conversation storage
  var conversations = {};
  var currentChatId = null;

  // Load saved conversations from localStorage
  try {
    conversations = JSON.parse(localStorage.getItem('hymenoptera_conversations')) || {};
  } catch (e) {
    conversations = {};
  }

  function generateChatId() {
    var rand = Math.random().toString(36).slice(2, 7);
    return 'chat_' + Date.now() + '_' + rand;
  }

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

  function saveConversations() {
    try {
      localStorage.setItem('hymenoptera_conversations', JSON.stringify(conversations));
    } catch (e) {
      console.warn('saveConversations error', e);
    }
  }

  function renderChatHistory() {
    var history = document.getElementById('chat-history');
    if (!history) return;
    history.innerHTML = '';
    Object.keys(conversations).forEach(function (id, index) {
      var item = document.createElement('div');
      item.className = 'chat-item';
      item.textContent = 'Chat ' + (index + 1);
      if (id === currentChatId) {
        item.classList.add('active');
      }
      item.onclick = function () { loadChat(id); };
      history.appendChild(item);
    });
  }

  function clearChatUI() {
    if (messagesEl) messagesEl.innerHTML = '';
    showEmptyState();
  }

  function loadChat(chatId) {
    currentChatId = chatId;
    var chatMessages = conversations[chatId] || [];
    clearChatUI();
    chatMessages.forEach(function (msg) {
      addMessage(msg.role, msg.content);
    });
    renderChatHistory();
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

    // Ensure we have an active chat
    if (!currentChatId) {
      currentChatId = generateChatId();
      conversations[currentChatId] = [];
      renderChatHistory();
    }

    // Add user message to conversation
    conversations[currentChatId].push({ role: 'user', content: message });
    addMessage('user', message);
    saveMessageToHistory({ role: 'user', content: message });
    saveConversations();
    messageInput.value = '';

    try {
      var response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversations[currentChatId] })
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
      // Add assistant reply to conversation
      conversations[currentChatId].push({ role: 'assistant', content: reply });
      addMessage('assistant', reply);
      saveMessageToHistory({ role: 'assistant', content: reply });
      saveConversations();
    } catch (err) {
      console.error('sendMessage error:', err);
      addMessage('assistant', 'Error contacting AI server');
    }
  }

  // Expose sendMessage globally so onclick="sendMessage()" works
  window.sendMessage = sendMessage;

  // Expose clearMessages for legacy callers (resets the current conversation)
  window.clearMessages = function () {
    if (currentChatId && conversations[currentChatId]) {
      conversations[currentChatId] = [];
    }
  };

  // New chat: create a fresh conversation and update the sidebar
  window.newChat = function () {
    var user = localStorage.getItem('hymenoptera_user');
    if (!user) return;
    currentChatId = generateChatId();
    conversations[currentChatId] = [];
    saveConversations();
    clearChatUI();
    renderChatHistory();
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

  // On page load: render chat history and restore the most recent conversation
  window.addEventListener('load', function () {
    renderChatHistory();
    var ids = Object.keys(conversations).sort(function (a, b) {
      // IDs are 'chat_TIMESTAMP_random'; sort by numeric timestamp portion
      var ta = parseInt(a.split('_')[1], 10) || 0;
      var tb = parseInt(b.split('_')[1], 10) || 0;
      return ta - tb;
    });
    if (ids.length > 0) {
      loadChat(ids[ids.length - 1]);
    }
  });

  // Show empty-state on initial load (if chat-screen is visible and no messages)
  showEmptyState();
})();
