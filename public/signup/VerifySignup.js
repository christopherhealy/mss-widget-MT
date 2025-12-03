// /public/signup/VerifySignup.js
console.log("✅ VerifySignup.js loaded");

(function () {
  "use strict";

  const statusEl = document.getElementById("verifyStatus");
  const msgEl = document.getElementById("verifyMessage");
  const linkBox = document.getElementById("verifyLink");

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "verify-status " + (isError ? "err" : "ok");
  }

  function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }

  async function verify() {
    const token = getTokenFromUrl().trim();
    if (!token) {
      msgEl.textContent = "This verification link is missing its token.";
      setStatus("Please check that you clicked the full link from your email.", true);
      return;
    }

    msgEl.textContent = "Checking your verification token…";

    try {
      const res = await fetch("/api/school-signup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const msg =
          json.message ||
          json.error ||
          "We could not verify this link. It may have expired or already been used.";
        setStatus(msg, true);
        msgEl.textContent = "Sorry — we couldn't complete your sign-up.";
        return;
      }

      // Success: school + admin created
      const slug = json.slug;
      const portalUrl = `/admin/SchoolPortal.html?slug=${encodeURIComponent(slug)}`;

      msgEl.textContent = `You're all set, ${json.adminName || "there"}!`;
      setStatus(
        `We created your MySpeakingScore school portal for “${json.schoolName}”.`,
        false
      );

      linkBox.style.display = "block";
      linkBox.innerHTML = `
        <a href="${portalUrl}">Go to your School Portal</a>
      `;
    } catch (err) {
      console.error("Verification error:", err);
      msgEl.textContent = "Something went wrong while talking to the server.";
      setStatus("Please try your link again in a moment.", true);
    }
  }

  verify();
})();