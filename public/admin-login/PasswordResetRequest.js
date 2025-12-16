// /admin-login/PasswordResetRequest.js
// v1.1 — hardened UX + safe fetch parsing

console.log("✅ PasswordResetRequest.js loaded");

(function () {
  "use strict";

  const form = document.getElementById("password-reset-request-form");
  const emailInput = document.getElementById("email");
  const statusEl = document.getElementById("reset-request-status");
  const btn = document.getElementById("btn-send-reset") || form?.querySelector('button[type="submit"]');

  if (!form || !emailInput) {
    console.warn("[PasswordResetRequest] form/email input not found");
    return;
  }

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.style.display = msg ? "block" : "none";
    statusEl.style.color = isError ? "#b91c1c" : "#111827";
  }

  function setBusy(isBusy) {
    if (!btn) return;
    btn.disabled = !!isBusy;
    btn.style.opacity = isBusy ? "0.7" : "";
    btn.style.cursor = isBusy ? "default" : "";
  }

  async function safeReadJson(res) {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }

  function looksLikeEmail(s) {
    // light validation; server remains source of truth
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = String(emailInput.value || "").trim().toLowerCase();

    if (!email) {
      setStatus("Please enter your admin email.", true);
      return;
    }
    if (!looksLikeEmail(email)) {
      setStatus("Please enter a valid email address.", true);
      return;
    }

    setStatus("Sending reset email…");
    setBusy(true);

    try {
      const res = await fetch("/api/admin/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await safeReadJson(res);

      if (!res.ok || data.ok === false) {
        setStatus(
          data.message || "Could not send reset email. Please try again.",
          true
        );
        setBusy(false);
        return;
      }

      // Do NOT reveal whether email exists
      setStatus("If this email is registered, a reset link has been sent.", false);
      setBusy(false);
    } catch (err) {
      console.error("[PasswordResetRequest] error:", err);
      setStatus("Unexpected error while sending reset email. Please try again.", true);
      setBusy(false);
    }
  });
})();