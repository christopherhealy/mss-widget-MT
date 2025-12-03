// /admin-login/PasswordResetRequest.js
console.log("✅ PasswordResetRequest.js loaded");

(function () {
  "use strict";

  // IDs must match PasswordResetRequest.html
  const form = document.getElementById("password-reset-request-form");
  const emailInput = document.getElementById("email");
  const statusEl = document.getElementById("reset-request-status");

  if (!form) {
    console.warn("PasswordResetRequest: form not found");
    return;
  }

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.style.display = msg ? "block" : "none";
    statusEl.style.color = isError ? "#b91c1c" : "#111827";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = (emailInput?.value || "").trim();
    if (!email) {
      setStatus("Please enter your admin email.", true);
      return;
    }

    setStatus("Sending reset email…");

    try {
      const res = await fetch("/api/admin/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => ({}));

      // Backend should return ok:true even if the email isn't registered
      if (!res.ok || !data.ok) {
        setStatus(
          data.message || "Could not send reset email. Please try again.",
          true
        );
        return;
      }

      setStatus(
        "If this email is registered, a reset link has been sent.",
        false
      );
    } catch (err) {
      console.error("PasswordResetRequest error:", err);
      setStatus(
        "Unexpected error while sending reset email. Please try again.",
        true
      );
    }
  });
})();