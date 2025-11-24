// /admin-login/AdminLogin.js
console.log("✅ AdminLogin.js loaded");

(function () {
  "use strict";

  // FIXED: correct ID matches AdminLogin.html
  const form = document.getElementById("admin-login-form");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    // TODO: real auth later; for now redirect to demo portal
    window.location.href = "/admin/SchoolPortal.html?slug=mss-demo";
  });
})();