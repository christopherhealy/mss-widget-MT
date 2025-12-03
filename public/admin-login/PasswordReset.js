// /admin-login/PasswordReset.js
console.log("✅ PasswordReset.js loaded");

(function () {
  "use strict";

  const form = document.getElementById("password-reset-form");
  const tokenInput = document.getElementById("reset-token");
  const newPassInput = document.getElementById("new-password");
  const confirmInput = document.getElementById("confirm-password");
  const statusEl = document.getElementById("password-reset-status");

  if (!form) return;

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.style.display = msg ? "block" : "none";
    statusEl.style.color = isError ? "#b91c1c" : "#111827";
  }

  // Pre-fill token from URL if present (?token=XYZ)
  (function prefillTokenFromURL() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token && tokenInput) {
      tokenInput.value = token;
    }
  })();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const token = (tokenInput?.value || "").trim();
    const pw = (newPassInput?.value || "").trim();
    const pw2 = (confirmInput?.value || "").trim();

    if (!token) {
      setStatus("Verification code is required.", true);
      return;
    }
    if (!pw || pw.length < 8) {
      setStatus("Password must be at least 8 characters long.", true);
      return;
    }
    if (pw !== pw2) {
      setStatus("Passwords do not match.", true);
      return;
    }

    setStatus("Resetting password…");

    try {
      const res = await fetch("/api/admin/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: pw }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setStatus(
          data.message || "Reset failed. The link may be invalid or expired.",
          true
        );
        return;
      }

      // Success: send them back to login with reset=ok flag
      window.location.href = "/admin-login/AdminLogin.html?reset=ok";
    } catch (err) {
      console.error("PasswordReset error:", err);
      setStatus(
        "Unexpected error while resetting password. Please try again.",
        true
      );
    }
  });
})();