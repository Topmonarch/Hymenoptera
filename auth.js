function updateUIForAuth() {
    const session = getSession();
    if (session && (session.email || session.guest)) {
      ...
      // Hide auth panel and enable chat input
      showAuthPanel(false);
      userInput.disabled = false;
      sendBtn.disabled = false;
      newChatBtn.disabled = false;
      ...
    } else {
      // logged out
      ...
      // Show auth panel and disable chat input
      showAuthPanel(true, 'signin');
      userInput.disabled = true;
      sendBtn.disabled = true;
      newChatBtn.disabled = true;
    }
  }
