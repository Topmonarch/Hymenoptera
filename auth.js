(function () {
  console.log('[auth-debug] init');

  function safeRun(fn) {
    try {
      fn();
    } catch (err) {
      console.warn('[auth-debug] error', err);
    }
  }

  safeRun(function () {
    if (!window.hymAuth) {
      console.warn('[auth-debug] hymAuth not available yet. Ensure auth.js is loaded before auth-debug.js');
      return;
    }

    const state = {
      loggedIn: !!(window.hymAuth.isLoggedIn && window.hymAuth.isLoggedIn()),
      guest: !!(window.hymAuth.isGuest && window.hymAuth.isGuest()),
      canSaveHistory: !!(window.hymAuth.canSaveHistory && window.hymAuth.canSaveHistory()),
      currentUser: window.hymAuth.currentUser ? window.hymAuth.currentUser() : null
    };

    console.log('[auth-debug] hymAuth state:', state);

    // If there is no session, create a temporary guest session so chat controls become enabled.
    if (!state.loggedIn && !state.guest) {
      if (typeof window.hymAuth.continueAsGuest === 'function') {
        console.log('[auth-debug] no session — creating temporary guest session via hymAuth.continueAsGuest()');
        window.hymAuth.continueAsGuest();
      } else {
        console.warn('[auth-debug] hymAuth.continueAsGuest() not found; cannot auto-create guest session');
      }
    }

    // Log DOM control state
    const sendBtn = document.getElementById('sendBtn');
    const userInput = document.getElementById('userInput');
    const authPanel = document.getElementById('authPanel');

    console.log('[auth-debug] DOM state:', {
      sendBtnExists: !!sendBtn,
      sendBtnDisabled: sendBtn ? sendBtn.disabled : null,
      userInputExists: !!userInput,
      userInputDisabled: userInput ? userInput.disabled : null,
      authPanelExists: !!authPanel,
      authPanelHidden: authPanel ? authPanel.classList.contains('hidden') : null
    });

    // Helper for manual testing from console: window.__authDebug.clickSend()
    window.__authDebug = {
      clickSend: function () {
        const b = document.getElementById('sendBtn');
        if (!b) return console.warn('[auth-debug] sendBtn not found');
        console.log('[auth-debug] programmatic click — disabled=', b.disabled);
        b.click();
      },
      logState: function () {
        console.log('[auth-debug] hymAuth state:', {
          loggedIn: !!(window.hymAuth.isLoggedIn && window.hymAuth.isLoggedIn()),
          guest: !!(window.hymAuth.isGuest && window.hymAuth.isGuest()),
          currentUser: window.hymAuth.currentUser ? window.hymAuth.currentUser() : null
        });
        const b = document.getElementById('sendBtn');
        const i = document.getElementById('userInput');
        console.log('[auth-debug] controls:', {
          sendBtnDisabled: b ? b.disabled : null,
          userInputDisabled: i ? i.disabled : null,
          authPanelHidden: document.getElementById('authPanel') ? document.getElementById('authPanel').classList.contains('hidden') : null
        });
      }
    };

    console.log('[auth-debug] ready — use window.__authDebug.clickSend() or window.__authDebug.logState() from the console for quick tests.');
  });
})();
