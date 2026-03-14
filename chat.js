// chat.js
// Frontend chat handler: POST to /api/chat (SSE stream), manage empty-state.
// Maintains conversation memory in messages array.

// Preserves hymAuth checks and saveMessageToHistory behavior.


(function () {
  'use strict';

  var messagesEl = document.getElementById('messages');
  var messageInput = document.getElementById('message-input');
  var emptyState = document.getElementById('empty-state');

  // Conversation memory: each chat stores its full message history in conversations[id].messages.
  // When a message is sent, the entire history is forwarded to the backend so the AI maintains context.
  var conversations = {};
  var currentChatId = null;

  // Current agent selection
  var currentAgent = 'general';

  // Current model selection
  var DEFAULT_MODEL = 'smart';
  var currentModel = DEFAULT_MODEL;

  // Hive Mode toggle
  var hiveMode = false;

  // Web research toggle
  var webAccess = false;

  // Stores uploaded document text
  var uploadedFileContent = "";

  // Stores captured or uploaded image (base64 data URL)
  var uploadedImageData = "";

  // Projects: containers for chats and files
  var projects = {};
  var currentProject = 'Default';

  // Subscription plan limits (messages per day)
  var planLimits = {
    starter: 30,
    basic: 100,
    premium: 500,
    ultimate: Infinity
  };

  // Current user plan — defaults to 'starter' for all new users
  var userPlan = localStorage.getItem('hymenoptera_plan') || 'starter';

  // Returns today's date as a stable YYYY-MM-DD string in the Pacific/Auckland timezone.
  // Using a fixed timezone and date-only format keeps the reset boundary consistent and
  // avoids locale-dependent output from Date.prototype.toDateString().
  function getTodayDateString() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Auckland',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  // Daily message usage tracking
  var messagesToday = Number(localStorage.getItem('messagesToday')) || 0;
  var lastResetDate = localStorage.getItem('lastResetDate') || getTodayDateString();

  // Daily reset check on page load: if the calendar day has changed, reset the counter
  (function () {
    var today = getTodayDateString();
    if (lastResetDate !== today) {
      messagesToday = 0;
      lastResetDate = today;
      localStorage.setItem('messagesToday', '0');
      localStorage.setItem('lastResetDate', today);
    }
  }());

  var modelLabels = {
    fast: 'Fast',
    smart: 'Smart',
    coding: 'Coding',
    vision: 'Vision',
    'image-generator': 'Image Generator',
    'video-generator': 'Video Generator'
  };

  var identityBlock = '\n\nYou are Hymenoptera, an advanced AI assistant. Your name is Hymenoptera. If a user asks who you are or asks if you are Hymenoptera, you must respond that you are Hymenoptera. You assist users with: conversations, coding, research, image generation, file analysis, business insights, and general knowledge. Always speak confidently as Hymenoptera and represent the Hymenoptera AI platform.';

  var agents = {
    general: {
      name: 'General AI',
      systemPrompt: 'You are a helpful AI assistant.' + identityBlock,
      tools: []
    },
    coding: {
      name: 'Coding Agent',
      systemPrompt: 'You are a professional software engineer who writes clean, correct code and explains programming clearly.' + identityBlock,
      tools: []
    },
    research: {
      name: 'Research Agent',
      systemPrompt: 'You specialize in research, summarizing topics, and explaining complex subjects clearly.' + identityBlock,
      tools: []
    },
    business: {
      name: 'Business Agent',
      systemPrompt: 'You provide startup ideas, business strategies, and market analysis.' + identityBlock,
      tools: []
    },
    robotics: {
      name: 'Robotics Agent',
      systemPrompt: 'You assist with robotics engineering, automation, sensors, and control systems.' + identityBlock,
      tools: []
    }
  };

  var NO_RESPONSE_MSG = 'No response received from server';

  var WELCOME_MESSAGE = 'Hello, I\'m Hymenoptera \uD83D\uDC1D\nYour AI assistant and agent platform.\n\nYou can ask questions, generate images, analyze files, or switch to specialized agents like Coding, Research, Business, and Robotics.\n\nHow can I help today?';

  function updateAgentIndicator() {
    var indicator = document.getElementById('agent-indicator');
    if (indicator) {
      indicator.textContent = 'Agent: ' + (agents[currentAgent] ? agents[currentAgent].name : 'General AI');
    }
    document.querySelectorAll('.agent-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.agent === currentAgent);
    });
  }

  function updateModelIndicator() {
    var btn = document.getElementById('model-button');
    if (btn) {
      btn.textContent = modelLabels[currentModel] || 'Smart';
    }
    document.querySelectorAll('.model-option').forEach(function (opt) {
      opt.classList.toggle('active', opt.dataset.model === currentModel);
    });
  }

  function setStatus(text) {
    var indicator = document.getElementById('status-indicator');
    if (indicator) {
      indicator.textContent = 'Status: ' + text;
    }
  }

  function updateHiveIndicator() {
    var indicator = document.getElementById('hive-indicator');
    if (indicator) {
      indicator.textContent = 'Hive Mode: ' + (hiveMode ? 'ON' : 'OFF');
      indicator.style.color = hiveMode ? '#2d8cff' : '#888';
    }
  }

  function updateMessageCounter() {
    var counter = document.getElementById('message-counter');
    if (!counter) return;
    var limit = planLimits[userPlan];
    var text = limit === Infinity
      ? messagesToday + ' / \u221e'
      : messagesToday + ' / ' + limit;
    counter.textContent = 'Messages Today: ' + text;
    var resetNote = counter.querySelector('.counter-reset-note');
    if (!resetNote) {
      resetNote = document.createElement('span');
      resetNote.className = 'counter-reset-note';
      resetNote.style.cssText = 'display:block;font-size:10px;color:#666;';
      counter.appendChild(resetNote);
    }
    resetNote.textContent = 'Resets at 12:00 AM';
  }

  // Fetch the authoritative usage count from the backend and update the local
  // counter. Called on page load, new chat, and when a day boundary is crossed
  // so the displayed counter always reflects the backend source of truth.
  function fetchUsageFromBackend() {
    try {
      var hymenAuth = window.hymAuth && window.hymAuth.currentUser;
      var userId = hymenAuth ? hymenAuth.uid : 'guest';
      var sessionId = currentChatId || '';
      var url = '/api/usage?plan=' + encodeURIComponent(userPlan) +
        '&userId=' + encodeURIComponent(userId) +
        '&sessionId=' + encodeURIComponent(sessionId);
      fetch(url).then(function (response) {
        if (!response.ok) {
          console.warn('fetchUsageFromBackend: unexpected status', response.status);
          return;
        }
        return response.json();
      }).then(function (data) {
        if (data && typeof data.messages_used === 'number') {
          messagesToday = data.messages_used;
          localStorage.setItem('messagesToday', messagesToday);
          updateMessageCounter();
        }
      }).catch(function () {
        // Non-fatal: fall back to locally tracked counter
      });
    } catch (e) {
      // Non-fatal: ignore errors in the refresh path
    }
  }

  function updateWebIndicator() {
    var indicator = document.getElementById('web-indicator');
    if (indicator) {
      indicator.textContent = 'Web: ' + (webAccess ? 'ON' : 'OFF');
      indicator.style.color = webAccess ? '#2d8cff' : '#888';
    }
  }

  window.toggleHiveMode = function () {
    hiveMode = !hiveMode;
    updateHiveIndicator();
  };

  window.toggleWebAccess = function () {
    webAccess = !webAccess;
    updateWebIndicator();
  };

  // Model dropdown toggle
  document.addEventListener('click', function (e) {
    var btn = document.getElementById('model-button');
    var dropdown = document.getElementById('model-dropdown');
    if (!dropdown) return;
    if (btn && btn.contains(e.target)) {
      dropdown.classList.toggle('open');
    } else {
      dropdown.classList.remove('open');
    }
  });

  // Model option selection
  document.querySelectorAll('.model-option').forEach(function (opt) {
    opt.addEventListener('click', function (e) {
      e.stopPropagation();
      var selected = opt.dataset.model;
      currentModel = selected;
      if (currentChatId && conversations[currentChatId]) {
        conversations[currentChatId].model = selected;
        saveConversations();
      }
      updateModelIndicator();
      var dropdown = document.getElementById('model-dropdown');
      if (dropdown) dropdown.classList.remove('open');
    });
  });

  document.querySelectorAll('.agent-item').forEach(function (item) {
    item.onclick = function () {
      currentAgent = item.dataset.agent;
      if (currentChatId && conversations[currentChatId]) {
        conversations[currentChatId].agent = currentAgent;
        saveConversations();
      }
      updateAgentIndicator();
    };
  });

  // Load saved conversations from localStorage
  try {
    conversations = JSON.parse(localStorage.getItem('hymenoptera_conversations')) || {};
  } catch (e) {
    conversations = {};
  }

  // Load saved projects from localStorage
  try {
    projects = JSON.parse(localStorage.getItem('hymenoptera_projects')) || { 'Default': { files: [] } };
  } catch (e) {
    projects = { 'Default': { files: [] } };
  }
  if (!projects[currentProject]) {
    projects[currentProject] = { files: [] };
  }

  // Migrate old array-based conversations to the new metadata object format
  (function migrateConversations() {
    var ids = Object.keys(conversations).sort(function (a, b) {
      var ta = parseInt(a.split('_')[1], 10) || 0;
      var tb = parseInt(b.split('_')[1], 10) || 0;
      return ta - tb;
    });
    ids.forEach(function (id, index) {
      if (Array.isArray(conversations[id])) {
        conversations[id] = {
          title: 'Chat ' + (index + 1),
          pinned: false,
          archived: false,
          agent: 'general',
          model: DEFAULT_MODEL,
          project: 'Default',
          messages: conversations[id]
        };
      } else {
        if (!conversations[id].title) conversations[id].title = 'Chat ' + (index + 1);
        if (conversations[id].pinned === undefined) conversations[id].pinned = false;
        if (conversations[id].archived === undefined) conversations[id].archived = false;
        if (!conversations[id].messages) conversations[id].messages = [];
        if (!conversations[id].model) conversations[id].model = DEFAULT_MODEL;
        if (!conversations[id].agent) conversations[id].agent = 'general';
        if (!conversations[id].project) conversations[id].project = 'Default';
      }
    });
  }());

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
      localStorage.setItem('hymenoptera_projects', JSON.stringify(projects));
    } catch (e) {
      console.warn('saveConversations error', e);
    }
  }

  function renderProjectList() {
    var list = document.getElementById('project-list');
    if (!list) return;
    list.innerHTML = '';
    Object.keys(projects).forEach(function (name) {
      var item = document.createElement('div');
      item.className = 'project-item' + (name === currentProject ? ' active' : '');
      item.textContent = name;
      item.onclick = function () { switchProject(name); };
      list.appendChild(item);
    });
  }

  function createAndSwitchProject(projectName) {
    if (!projectName || !projectName.trim()) return;
    projectName = projectName.trim();
    if (projects[projectName]) {
      alert('A project named "' + projectName + '" already exists. Switching to it.');
    } else {
      projects[projectName] = { files: [] };
    }
    currentProject = projectName;
    saveConversations();
    renderProjectList();
    currentChatId = null;
    clearChatUI();
    renderChatHistory();
  }

  function switchProject(projectName) {
    currentProject = projectName;
    if (!projects[currentProject]) {
      projects[currentProject] = { files: [] };
    }
    currentChatId = null;
    clearChatUI();
    renderChatHistory();
    renderProjectList();
  }

  // Track the currently open chat options menu
  var activeChatMenu = null;

  function closeChatMenu() {
    if (activeChatMenu) {
      activeChatMenu.remove();
      activeChatMenu = null;
    }
  }

  function openChatMenu(chatId, anchorEl) {
    closeChatMenu();
    var menu = document.createElement('div');
    menu.className = 'chat-menu';

    var conv = conversations[chatId];
    var menuItems = [
      { label: 'Rename', action: function () { renameChat(chatId); } },
      { label: conv && conv.pinned ? 'Unpin' : 'Pin', action: function () { pinChat(chatId); } },
      { label: 'Archive', action: function () { archiveChat(chatId); } },
      { label: 'Delete', action: function () { deleteChat(chatId); }, cls: 'delete' }
    ];

    menuItems.forEach(function (mi) {
      var div = document.createElement('div');
      div.className = 'menu-item' + (mi.cls ? ' ' + mi.cls : '');
      div.textContent = mi.label;
      div.onclick = function (e) {
        e.stopPropagation();
        closeChatMenu();
        mi.action();
      };
      menu.appendChild(div);
    });

    document.body.appendChild(menu);
    var rect = anchorEl.getBoundingClientRect();
    var menuWidth = menu.offsetWidth;
    var left = rect.right - menuWidth;
    if (left < 0) left = 0;
    menu.style.left = left + 'px';
    menu.style.top = rect.bottom + 'px';
    activeChatMenu = menu;
  }

  document.addEventListener('click', function () { closeChatMenu(); });

  function renameChat(chatId) {
    if (!conversations[chatId]) return;
    var current = conversations[chatId].title || '';
    var newTitle = prompt('Rename chat:', current);
    if (newTitle !== null && newTitle.trim() !== '') {
      conversations[chatId].title = newTitle.trim();
      saveConversations();
      renderChatHistory();
    }
  }

  function pinChat(chatId) {
    if (!conversations[chatId]) return;
    conversations[chatId].pinned = !conversations[chatId].pinned;
    saveConversations();
    renderChatHistory();
  }

  function archiveChat(chatId) {
    if (!conversations[chatId]) return;
    conversations[chatId].archived = true;
    if (currentChatId === chatId) {
      currentChatId = null;
      clearChatUI();
    }
    saveConversations();
    renderChatHistory();
  }

  function deleteChat(chatId) {
    if (!confirm('Are you sure you want to delete this chat?')) return;
    delete conversations[chatId];
    if (currentChatId === chatId) {
      currentChatId = null;
      clearChatUI();
    }
    saveConversations();
    renderChatHistory();
  }

  function renderChatHistory() {
    var history = document.getElementById('chat-history');
    if (!history) return;
    history.innerHTML = '';

    // Exclude archived chats and chats not in the current project; sort pinned to top, then by timestamp descending
    var ids = Object.keys(conversations).filter(function (id) {
      return !conversations[id].archived && conversations[id].project === currentProject;
    });
    ids.sort(function (a, b) {
      var pa = conversations[a].pinned ? 1 : 0;
      var pb = conversations[b].pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      var ta = parseInt(a.split('_')[1], 10) || 0;
      var tb = parseInt(b.split('_')[1], 10) || 0;
      return tb - ta;
    });

    ids.forEach(function (id) {
      var conv = conversations[id];
      var item = document.createElement('div');
      item.className = 'chat-item';
      if (id === currentChatId) item.classList.add('active');

      var titleSpan = document.createElement('span');
      titleSpan.className = 'chat-title';
      titleSpan.textContent = conv.title || 'Chat';

      var optBtn = document.createElement('button');
      optBtn.className = 'chat-options';
      optBtn.textContent = '⋯';
      optBtn.title = 'Options';
      optBtn.onclick = function (e) {
        e.stopPropagation();
        openChatMenu(id, optBtn);
      };

      item.appendChild(titleSpan);
      item.appendChild(optBtn);
      item.onclick = function () { loadChat(id); };
      history.appendChild(item);
    });
  }

  function clearChatUI() {
    if (messagesEl) messagesEl.innerHTML = '';
    showEmptyState();
  }

  function loadChat(chatId) {
    if (typeof setCurrentView === 'function' && window.currentView === 'settings') {
      setCurrentView('chat');
    }
    currentChatId = chatId;
    var conv = conversations[chatId];
    currentModel = (conv && conv.model) ? conv.model : DEFAULT_MODEL;
    currentAgent = (conv && conv.agent) ? conv.agent : 'general';
    updateModelIndicator();
    updateAgentIndicator();
    var chatMessages = (conv && conv.messages) ? conv.messages : (Array.isArray(conv) ? conv : []);

    // Fade out, swap content, fade back in
    if (messagesEl) {
      messagesEl.classList.add('fading');
    }
    setTimeout(function () {
      clearChatUI();
      chatMessages.forEach(function (msg) {
        addMessage(msg.role, msg.content);
      });
      // Show welcome message for empty conversations
      if (chatMessages.length === 0) {
        addMessage('assistant', WELCOME_MESSAGE);
      }
      renderChatHistory();
      if (messagesEl) {
        messagesEl.classList.remove('fading');
      }
    }, 150);
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

  // Create an empty streaming assistant bubble and return the element
  function createStreamingBubble() {
    if (!messagesEl) return null;
    hideEmptyState();
    var div = document.createElement('div');
    div.className = 'message assistant';
    div.innerText = '';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  async function sendMessage() {
    if (!messageInput) return;
    var message = (messageInput.value || '').trim();
    if (!message) return;

    // Daily reset: if the date has changed since last use, reset the counter
    // and re-fetch usage from the backend to get the authoritative value.
    var today = getTodayDateString();
    if (today !== lastResetDate) {
      messagesToday = 0;
      lastResetDate = today;
      localStorage.setItem('messagesToday', '0');
      localStorage.setItem('lastResetDate', today);
      updateMessageCounter();
      // Refresh counter from backend asynchronously (non-blocking)
      fetchUsageFromBackend();
    }

    // Check plan limit before sending
    var limit = planLimits[userPlan];
    if (messagesToday >= limit) {
      alert('Daily message limit reached. Upgrade your plan or wait until tomorrow.');
      return;
    }

    // Ensure we have an active chat
    if (!currentChatId) {
      currentChatId = generateChatId();
      var chatCount = Object.keys(conversations).filter(function (id) {
        return !conversations[id].archived && conversations[id].project === currentProject;
      }).length + 1;
      conversations[currentChatId] = {
        title: 'Chat ' + chatCount,
        pinned: false,
        archived: false,
        agent: currentAgent,
        model: currentModel,
        project: currentProject,
        messages: []
      };
      renderChatHistory();
    }

    // Append user message to conversation memory before sending.
    // The full history (all prior messages + this new one) will be sent to the backend.
    conversations[currentChatId].messages.push({ role: 'user', content: message });
    addMessage('user', message);
    saveMessageToHistory({ role: 'user', content: message });
    saveConversations();
    messageInput.value = '';

    // Show thinking status and create a typing indicator bubble
    setStatus('Thinking...');
    var typingIndicator = createStreamingBubble();
    if (typingIndicator) {
      typingIndicator.innerText = 'Hymenoptera is thinking.';
      typingIndicator.classList.add('typing-indicator');
    }
    // Animate the dots: cycle through 1, 2, 3 dots every 500ms
    var dotCount = 1;
    var dotInterval = null;
    if (typingIndicator) {
      dotInterval = setInterval(function () {
        dotCount = (dotCount % 3) + 1;
        if (typingIndicator && typingIndicator.parentNode) {
          typingIndicator.innerText = 'Hymenoptera is thinking' + '.'.repeat(dotCount);
        } else {
          clearInterval(dotInterval);
        }
      }, 500);
    }
    var assistantBubble = null;
    var assistantText = '';

    try {
      var convAgent = conversations[currentChatId].agent || currentAgent;
      var convModel = conversations[currentChatId].model || currentModel;

      // Increment message count before sending the AI request
      messagesToday++;
      localStorage.setItem('messagesToday', messagesToday);
      updateMessageCounter();

      // Image Generator mode: route to /api/generate-image instead of /api/chat
      if (convModel === 'image-generator') {
        var imgHymenAuth = window.hymAuth && window.hymAuth.currentUser;
        var imgUserId = imgHymenAuth ? imgHymenAuth.uid : 'guest';
        var imgResponse = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: message, plan: userPlan, userId: imgUserId, sessionId: currentChatId })
        });
        clearInterval(dotInterval);
        if (!imgResponse.ok) {
          var imgErr = null;
          try { imgErr = await imgResponse.json(); } catch (e) { /* ignore */ }
          var errMsg = (imgErr && imgErr.error && imgErr.error.message) || 'Image generation failed';
          if (typingIndicator) {
            typingIndicator.classList.remove('typing-indicator');
            typingIndicator.innerText = errMsg;
          }
          assistantText = errMsg;
        } else {
          var imgData = await imgResponse.json();
          if (typingIndicator) typingIndicator.remove();
          // Build an image bubble with download and regenerate controls
          var imgBubble = document.createElement('div');
          imgBubble.className = 'message assistant';
          var imgEl = document.createElement('img');
          imgEl.src = imgData.imageUrl;
          imgEl.alt = 'Generated image';
          imgEl.style.cssText = 'max-width:100%;border-radius:8px;display:block;margin-bottom:8px;';
          imgBubble.appendChild(imgEl);
          if (imgData.revisedPrompt && imgData.revisedPrompt !== message) {
            var captionEl = document.createElement('div');
            captionEl.style.cssText = 'font-size:11px;color:#888;margin-bottom:8px;';
            captionEl.textContent = 'Prompt: ' + imgData.revisedPrompt;
            imgBubble.appendChild(captionEl);
          }
          var btnRow = document.createElement('div');
          btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
          var dlBtn = document.createElement('a');
          dlBtn.href = imgData.imageUrl;
          dlBtn.download = 'hymenoptera-image.png';
          dlBtn.target = '_blank';
          dlBtn.rel = 'noopener noreferrer';
          dlBtn.textContent = '⬇ Download';
          dlBtn.style.cssText = 'font-size:12px;color:#2D8CFF;cursor:pointer;text-decoration:none;padding:4px 10px;border:1px solid #2D8CFF;border-radius:4px;';
          btnRow.appendChild(dlBtn);
          var regenBtn = document.createElement('button');
          regenBtn.textContent = '🔄 Regenerate';
          regenBtn.style.cssText = 'font-size:12px;color:#2D8CFF;cursor:pointer;background:none;border:1px solid #2D8CFF;border-radius:4px;padding:4px 10px;';
          regenBtn.addEventListener('click', function () {
            if (messageInput) messageInput.value = message;
            sendMessage();
          });
          btnRow.appendChild(regenBtn);
          imgBubble.appendChild(btnRow);
          if (messagesEl) {
            messagesEl.appendChild(imgBubble);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          assistantText = '[Image generated] ' + (imgData.revisedPrompt || message);
          assistantBubble = imgBubble;
        }
        conversations[currentChatId].messages.push({ role: 'assistant', content: assistantText });
        saveMessageToHistory({ role: 'assistant', content: assistantText });
        saveConversations();
        setStatus('Ready');
        if (messageInput) messageInput.focus();
        return;
      }

      // Send the full conversation history to the backend so the AI remembers all prior messages.
      var response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversations[currentChatId].messages, agent: convAgent, systemPrompt: agents[convAgent].systemPrompt, model: convModel, hiveMode: hiveMode, fileContext: uploadedFileContent, image: uploadedImageData, webAccess: webAccess })
      });

      if (!response.ok) {
        clearInterval(dotInterval);
        if (typingIndicator) {
          typingIndicator.classList.remove('typing-indicator');
          typingIndicator.innerText = 'Error contacting AI server';
        }
        setStatus('Ready');
        return;
      }

      if (hiveMode) {
        // Hive mode returns a JSON response with the combined agent outputs
        var data = await response.json();
        assistantText = (data && data.content) ? data.content : NO_RESPONSE_MSG;
        // Replace typing indicator with the actual response
        if (typingIndicator) {
          clearInterval(dotInterval);
          typingIndicator.classList.remove('typing-indicator');
          typingIndicator.innerText = assistantText;
          assistantBubble = typingIndicator;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      } else {
        // Read SSE stream
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var typingRemoved = false;

        while (true) {
          var result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });

          // Process complete SSE lines
          var lines = buffer.split('\n');
          buffer = lines.pop(); // hold incomplete last line

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line === 'data: [DONE]') continue;
            if (line.startsWith('data: ')) {
              try {
                var parsed = JSON.parse(line.slice(6));
                var delta = parsed.choices &&
                            parsed.choices[0] &&
                            parsed.choices[0].delta &&
                            parsed.choices[0].delta.content;
                if (delta) {
                  // On first token: remove typing indicator and create the real assistant bubble
                  if (!typingRemoved) {
                    typingRemoved = true;
                    clearInterval(dotInterval);
                    if (typingIndicator) typingIndicator.remove();
                    assistantBubble = createStreamingBubble();
                  }
                  assistantText += delta;
                  if (assistantBubble) {
                    assistantBubble.innerText = assistantText;
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                  }
                }
              } catch (e) {
                // ignore malformed SSE chunks
              }
            }
          }
        }

        // If no streaming content was captured, show fallback
        if (!assistantText) {
          if (!typingRemoved && typingIndicator) {
            clearInterval(dotInterval);
            typingIndicator.classList.remove('typing-indicator');
            typingIndicator.innerText = NO_RESPONSE_MSG;
            assistantBubble = typingIndicator;
          } else if (assistantBubble) {
            assistantBubble.innerText = NO_RESPONSE_MSG;
          }
          assistantText = NO_RESPONSE_MSG;
        }
      }

      // Append assistant reply to conversation memory so future messages retain full context.
      conversations[currentChatId].messages.push({ role: 'assistant', content: assistantText });
      saveMessageToHistory({ role: 'assistant', content: assistantText });
      saveConversations();
    } catch (err) {
      console.error('sendMessage error:', err);
      clearInterval(dotInterval);
      // Show error in whichever bubble is currently visible
      var errorBubble = assistantBubble || typingIndicator;
      if (errorBubble) {
        errorBubble.classList.remove('typing-indicator');
        errorBubble.innerText = 'Error contacting AI server';
      }
    }

    setStatus('Ready');
    if (messageInput) messageInput.focus();
  }

  // Expose sendMessage globally so onclick="sendMessage()" works
  window.sendMessage = sendMessage;

  // Expose clearMessages for legacy callers (resets the current conversation)
  window.clearMessages = function () {
    if (currentChatId && conversations[currentChatId]) {
      conversations[currentChatId].messages = [];
    }
  };

  // New chat: create a fresh conversation and update the sidebar.
  // Resets conversation memory by starting a new messages array for the new chat.
  window.newChat = function () {
    if (typeof setCurrentView === 'function' && window.currentView === 'settings') {
      setCurrentView('chat');
    }
    var user = localStorage.getItem('hymenoptera_user');
    if (!user) return;
    currentChatId = generateChatId();
    var chatCount = Object.keys(conversations).filter(function (id) {
      return !conversations[id].archived && conversations[id].project === currentProject;
    }).length + 1;
    conversations[currentChatId] = {
      title: 'Chat ' + chatCount,
      pinned: false,
      archived: false,
      agent: currentAgent,
      model: currentModel,
      project: currentProject,
      messages: [] // Fresh memory: no prior messages for the new conversation
    };
    saveConversations();
    clearChatUI();
    addMessage('assistant', WELCOME_MESSAGE);
    renderChatHistory();
    // Clear uploaded file context for the new conversation
    uploadedFileContent = '';
    var fileUploadBtn = document.getElementById('file-upload-button');
    if (fileUploadBtn) fileUploadBtn.title = 'Upload file';
    var fileInput = document.getElementById('file-upload');
    if (fileInput) fileInput.value = '';
    // Clear uploaded image for the new conversation
    uploadedImageData = '';
    var camBtn = document.getElementById('camera-btn');
    if (camBtn) camBtn.title = 'Upload image';
    // Refresh usage counter from backend for the new chat session
    fetchUsageFromBackend();
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

  // Supported MIME type categories — mirrors the server-side fileProcessor logic.
  var fileTypeCategories = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    pdf:   ['application/pdf'],
    video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/ogg']
  };
  var fileExtCategories = {
    '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image',
    '.pdf': 'pdf',
    '.mp4': 'video', '.mov': 'video', '.avi': 'video', '.webm': 'video', '.mkv': 'video', '.ogv': 'video'
  };

  function detectUploadCategory(file) {
    var mime = (file.type || '').toLowerCase().split(';')[0].trim();
    for (var cat in fileTypeCategories) {
      if (fileTypeCategories[cat].indexOf(mime) !== -1) return cat;
    }
    var ext = (file.name || '').toLowerCase().match(/(\.[^.]+)$/);
    if (ext && fileExtCategories[ext[1]]) return fileExtCategories[ext[1]];
    return 'text'; // default: treat as text/code
  }

  /**
   * Send a file to /api/upload-file and display the AI analysis in the chat.
   * For text and code files the existing text-extraction path is also kept
   * so the content can be used as context in subsequent chat messages.
   */
  async function processUploadedFile(file, base64Data, category) {
    var fileUploadBtn = document.getElementById('file-upload-button');

    // Ensure there is an active chat to display the analysis in.
    if (!currentChatId) {
      currentChatId = generateChatId();
      var chatCount = Object.keys(conversations).filter(function (id) {
        return !conversations[id].archived && conversations[id].project === currentProject;
      }).length + 1;
      conversations[currentChatId] = {
        title: 'Chat ' + chatCount,
        messages: [],
        agent: currentAgent,
        model: currentModel,
        project: currentProject
      };
      renderChatList();
    }
    if (emptyState) emptyState.style.display = 'none';

    // Show a user message indicating the upload.
    var userMsg = '📎 Uploaded file: ' + file.name;
    addMessage('user', userMsg);
    saveMessageToHistory({ role: 'user', content: userMsg });
    saveConversations();

    // Show a loading indicator.
    setStatus('Analyzing file...');
    var thinkingBubble = createStreamingBubble();
    if (thinkingBubble) {
      thinkingBubble.innerText = 'Analyzing file...';
      thinkingBubble.classList.add('typing-indicator');
    }

    try {
      var hymenAuth = window.hymAuth && window.hymAuth.currentUser;
      var userId = hymenAuth ? hymenAuth.uid : 'guest';

      var response = await fetch('/api/upload-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileData: base64Data,
          fileName: file.name,
          mimeType: file.type || '',
          fileSize: file.size || 0,
          userId: userId,
          plan: userPlan,
          sessionId: currentChatId
        })
      });

      var data = await response.json();

      if (thinkingBubble) {
        thinkingBubble.classList.remove('typing-indicator');
        thinkingBubble.remove();
      }

      if (!response.ok) {
        var errMsg = (data && data.error && data.error.message) || 'File analysis failed.';
        addMessage('assistant', errMsg);
        saveMessageToHistory({ role: 'assistant', content: errMsg });
        setStatus('Ready');
        if (fileUploadBtn) fileUploadBtn.title = 'Upload file';
        return;
      }

      var analysis = data.analysis || 'No analysis returned.';
      addMessage('assistant', analysis);
      saveMessageToHistory({ role: 'assistant', content: analysis });
      saveConversations();
      if (fileUploadBtn) fileUploadBtn.title = 'File analyzed: ' + file.name;
    } catch (err) {
      if (thinkingBubble) {
        thinkingBubble.classList.remove('typing-indicator');
        thinkingBubble.remove();
      }
      addMessage('assistant', 'Error analyzing file: ' + (err.message || 'Unknown error'));
      if (fileUploadBtn) fileUploadBtn.title = 'File upload failed';
    }
    setStatus('Ready');
  }

  // File upload: detect file type and route accordingly.
  // • Text / code files: read as text for use as chat context (existing behaviour) AND
  //   send to /api/upload-file for AI analysis.
  // • Images, PDFs, videos: read as base64 and send to /api/upload-file.
  var fileUploadInput = document.getElementById('file-upload');
  if (fileUploadInput) {
    fileUploadInput.addEventListener('change', function (event) {
      var file = event.target.files[0];
      if (!file) return;
      var fileUploadBtn = document.getElementById('file-upload-button');
      var category = detectUploadCategory(file);

      if (category === 'text') {
        // Original behaviour: read as UTF-8 text and store as context.
        var textReader = new FileReader();
        textReader.onload = function (e) {
          uploadedFileContent = e.target.result;
          if (!projects[currentProject]) projects[currentProject] = { files: [] };
          if (!projects[currentProject].files) projects[currentProject].files = [];
          projects[currentProject].files.push(uploadedFileContent);
          saveConversations();
          if (fileUploadBtn) fileUploadBtn.title = 'File loaded: ' + file.name;

          // Also send to upload endpoint for inline AI analysis.
          var b64Reader = new FileReader();
          b64Reader.onload = function (ev) {
            var dataUrl = ev.target.result || '';
            var base64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
            processUploadedFile(file, base64, category);
          };
          b64Reader.readAsDataURL(file);
        };
        textReader.onerror = function () {
          uploadedFileContent = '';
          if (fileUploadBtn) fileUploadBtn.title = 'File upload failed';
        };
        textReader.readAsText(file);
      } else {
        // Image, PDF, video: read as base64 DataURL, strip the prefix, send to endpoint.
        var b64Reader = new FileReader();
        b64Reader.onload = function (ev) {
          var dataUrl = ev.target.result || '';
          var base64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
          processUploadedFile(file, base64, category);
        };
        b64Reader.onerror = function () {
          if (fileUploadBtn) fileUploadBtn.title = 'File upload failed';
        };
        b64Reader.readAsDataURL(file);
      }

      // Reset the input so the same file can be re-selected.
      event.target.value = '';
    });
  }

  // Mobile detection: returns true for phones and tablets
  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Tablet/i.test(navigator.userAgent);
  }

  // Show camera button only on mobile devices; voice button is always visible via CSS
  if (isMobileDevice()) {
    var camBtnEl = document.getElementById('camera-btn');
    if (camBtnEl) camBtnEl.style.display = 'inline-block';
  }

  // Camera / image input: open file picker for images (native camera on mobile), convert to base64
  var cameraBtn = document.getElementById('camera-btn');
  if (cameraBtn) {
    cameraBtn.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (isMobileDevice()) {
        // 'environment' opens the rear-facing camera on mobile devices
        input.capture = 'environment';
      }
      input.onchange = function (event) {
        var file = event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          uploadedImageData = e.target.result;
          cameraBtn.title = 'Image loaded: ' + file.name;
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  // Voice input: use Web Speech API to fill the chat input with spoken text
  var recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    ? new (window.SpeechRecognition || window.webkitSpeechRecognition)()
    : null;

  var isListening = false;
  var voiceCancelled = false;

  if (recognition) {
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = function (event) {
      if (!voiceCancelled) {
        var transcript = event.results[0][0].transcript;
        if (messageInput) messageInput.value += (messageInput.value ? ' ' : '') + transcript;
      }
    };

    recognition.onerror = function () {
      isListening = false;
      updateVoiceIndicator(false);
    };

    recognition.onend = function () {
      isListening = false;
      updateVoiceIndicator(false);
    };
  }

  function updateVoiceIndicator(active) {
    var voiceBtn = document.getElementById('voice-btn');
    if (!voiceBtn) return;
    if (active) {
      voiceBtn.textContent = '🎤 Listening...';
      voiceBtn.classList.add('listening');
    } else {
      voiceBtn.textContent = '🎤';
      voiceBtn.classList.remove('listening');
    }
  }

  var voiceBtn = document.getElementById('voice-btn');
  if (voiceBtn) {
    voiceBtn.addEventListener('click', function () {
      if (!recognition) {
        alert('Speech recognition is not supported in this browser.');
        return;
      }
      if (isListening) {
        voiceCancelled = true;
        recognition.stop();
        isListening = false;
        updateVoiceIndicator(false);
      } else {
        voiceCancelled = false;
        try {
          recognition.start();
          isListening = true;
          updateVoiceIndicator(true);
        } catch (e) {
          // recognition may already be running; ignore
        }
      }
    });
  }

  // New Project button
  var newProjectBtn = document.getElementById('new-project-btn');
  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', function () {
      var projectName = prompt('Enter project name');
      createAndSwitchProject(projectName);
    });
  }

  // ===== COMMAND PALETTE =====

  function makeSwitchAgentCmd(agentKey) {
    return {
      label: 'Switch Agent: ' + agents[agentKey].name,
      action: function () { currentAgent = agentKey; updateAgentIndicator(); }
    };
  }

  var COMMANDS = [
    { label: 'New Chat',     action: function () { window.newChat(); } },
    { label: 'New Project',  action: function () {
      var name = prompt('Enter project name');
      createAndSwitchProject(name);
    }},
    makeSwitchAgentCmd('general'),
    makeSwitchAgentCmd('coding'),
    makeSwitchAgentCmd('research'),
    makeSwitchAgentCmd('business'),
    makeSwitchAgentCmd('robotics'),
    { label: 'Rename Chat',  action: function () { if (currentChatId) renameChat(currentChatId); } },
    { label: 'Archive Chat', action: function () { if (currentChatId) archiveChat(currentChatId); } },
    { label: 'Delete Chat',  action: function () { if (currentChatId) deleteChat(currentChatId); } }
  ];

  function renderCommandList(filter) {
    var list = document.getElementById('command-list');
    if (!list) return;
    list.innerHTML = '';
    var filtered = filter
      ? COMMANDS.filter(function (c) { return c.label.toLowerCase().indexOf(filter.toLowerCase()) !== -1; })
      : COMMANDS;
    filtered.forEach(function (cmd) {
      var div = document.createElement('div');
      div.className = 'command-item';
      div.textContent = cmd.label;
      div.onclick = function () {
        closeCommandPalette();
        cmd.action();
      };
      list.appendChild(div);
    });
  }

  function openCommandPalette() {
    var palette = document.getElementById('command-palette');
    if (!palette) return;
    palette.classList.remove('hidden');
    var input = document.getElementById('command-input');
    if (input) {
      input.value = '';
      renderCommandList('');
      input.focus();
    }
  }

  function closeCommandPalette() {
    var palette = document.getElementById('command-palette');
    if (palette) palette.classList.add('hidden');
  }

  // Command input filtering
  var commandInputEl = document.getElementById('command-input');
  if (commandInputEl) {
    commandInputEl.addEventListener('input', function () {
      renderCommandList(this.value);
    });
    commandInputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeCommandPalette();
      }
    });
  }

  // Close palette when clicking the backdrop
  var paletteEl = document.getElementById('command-palette');
  if (paletteEl) {
    paletteEl.addEventListener('click', function (e) {
      if (e.target === paletteEl || e.target.classList.contains('command-palette-backdrop')) {
        closeCommandPalette();
      }
    });
  }

  // Ctrl+K opens command palette; Escape closes it
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      openCommandPalette();
    } else if (e.key === 'Escape') {
      closeCommandPalette();
    }
  });

  // Expose openCommandPalette globally if needed
  window.openCommandPalette = openCommandPalette;

  // On page load: render project list and chat history, restore the most recent non-archived conversation
  window.addEventListener('load', function () {
    renderProjectList();
    renderChatHistory();
    var ids = Object.keys(conversations)
      .filter(function (id) { return !conversations[id].archived && conversations[id].project === currentProject; })
      .sort(function (a, b) {
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

  // Initialize the message counter display and refresh from backend
  updateMessageCounter();
  fetchUsageFromBackend();

  // Plan display
  function updatePlanDisplay() {
    var planDisplay = document.getElementById('plan-display');
    var upgradeBtnEl = document.getElementById('upgrade-btn');
    if (!planDisplay || !upgradeBtnEl) { return; }
    var plan = userPlan || 'starter';

    planDisplay.textContent = 'Plan: ' + plan.charAt(0).toUpperCase() + plan.slice(1);

    if (plan === 'starter') {
      upgradeBtnEl.style.display = 'block';
      upgradeBtnEl.textContent = 'Upgrade Plan';
    } else {
      upgradeBtnEl.style.display = 'none';
    }
  }

  var upgradeBtn = document.getElementById('upgrade-btn');
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', function () {
      document.getElementById('upgrade-modal').classList.remove('hidden');
    });
  }

  // Stripe payment links
  var stripeLinks = {
    basic: "https://buy.stripe.com/dRm3co30K4Nra70b8ld7q00",
    premium: "https://buy.stripe.com/aFa6oA6cWcfT2Ey7W9d7q01",
    ultimate: "https://buy.stripe.com/4gM00catc7ZDengccpd7q02"
  };

  function openStripeCheckout(plan) {
    var url = stripeLinks[plan];
    if (!url) {
      console.error("Stripe link not configured for plan:", plan);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  var upgradeBasic = document.getElementById('upgrade-basic');
  if (upgradeBasic) {
    upgradeBasic.addEventListener('click', function () { openStripeCheckout('basic'); });
  }

  var upgradePremium = document.getElementById('upgrade-premium');
  if (upgradePremium) {
    upgradePremium.addEventListener('click', function () { openStripeCheckout('premium'); });
  }

  var upgradeUltimate = document.getElementById('upgrade-ultimate');
  if (upgradeUltimate) {
    upgradeUltimate.addEventListener('click', function () { openStripeCheckout('ultimate'); });
  }

  updatePlanDisplay();
})();
