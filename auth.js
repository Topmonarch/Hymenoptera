function continueAsGuest() {

  localStorage.setItem("hymenoptera_user", "guest");

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("chat-screen").style.display = "flex";

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

}

window.onload = function () {

  const user = localStorage.getItem("hymenoptera_user");

  if (user) {

    document.getElementById("login-screen").style.display = "none";
    document.getElementById("chat-screen").style.display = "flex";

  }

};
