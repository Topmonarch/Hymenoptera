function continueAsGuest() {

  localStorage.setItem("hymenoptera_user", "guest");

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("chat-screen").style.display = "flex";

  updateAccountDisplay();

}

function signIn() {

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!email || !password) {
    alert("Enter email and password");
    return;
  }

  localStorage.setItem("hymenoptera_user", email);

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("chat-screen").style.display = "flex";

  updateAccountDisplay();

}

function createAccount() {

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!email || !password) {
    alert("Enter email and password to create an account");
    return;
  }

  // NOTE: account creation is mocked on the client here.
  // Keep server-side auth unchanged — this preserves backend logic.
  // If you implement real account creation, call the backend here.
  localStorage.setItem("hymenoptera_user", email);

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("chat-screen").style.display = "flex";

  updateAccountDisplay();

  alert("Account created (client-side). You are signed in as " + email);

}

function updateAccountDisplay() {
  const el = document.getElementById("account-display");
  if (el) {
    const user = localStorage.getItem("hymenoptera_user");
    el.innerText = user ? user : "Not signed in";
  }
}

function signOut() {
  localStorage.removeItem("hymenoptera_user");
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("chat-screen").style.display = "none";
  updateAccountDisplay();
}

window.onload = function () {

  const user = localStorage.getItem("hymenoptera_user");

  // if user exists, open chat; otherwise show login
  if (user) {
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("chat-screen").style.display = "flex";
  } else {
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("chat-screen").style.display = "none";
  }

  updateAccountDisplay();

};