// /admin-login/PasswordReset.js
console.log("✅ PasswordReset.js loaded");

(function () {
  "use strict";

  const form = document.getElementById("password-reset-form");
  const tokenInput = document.getElementById("reset-token");
  const pw1 = document.getElementById("new-password");
  const pw2 = document.getElementById("confirm-password");
  const statusEl = document.getElementById("password-reset-status");

  if (!form || !tokenInput || !pw1 || !pw2) {
    console.warn("[PasswordReset] Missing form fields.");
    return;
  }

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.style.display = msg ? "block" : "none";
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#b91c1c" : "#111827";
  }

  // Prefill token from URL
  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken && !tokenInput.value) tokenInput.value = urlToken;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const token = String(tokenInput.value || "").trim();
    const p1 = String(pw1.value || "");
    const p2 = String(pw2.value || "");

    if (!token) return setStatus("Please enter the verification code.", true);
    if (!p1 || p1.length < 8) return setStatus("Password must be at least 8 characters.", true);
    if (p1 !== p2) return setStatus("Passwords do not match.", true);

    setStatus("Resetting password…");

    try {
      const res = await fetch("/api/admin/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: p1 }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        return setStatus(data.message || "Server error while resetting password.", true);
      }

      setStatus("Password updated. You can now sign in.", false);
      setTimeout(() => (window.location.href = "/admin-login/AdminLogin.html"), 900);
    } catch (err) {
      console.error("[PasswordReset] error:", err);
      setStatus("Unexpected error. Please try again.", true);
    }
  });
})();