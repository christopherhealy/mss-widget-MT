// /signup/VerifySignup.js
console.log("✅ VerifySignup.js loaded");

(function () {
  // Try a few likely IDs; fall back to body if none found
  const statusEl =
    document.getElementById("verifyStatus") ||
    document.getElementById("signupStatus") ||
    document.querySelector(".verify-status") ||
    document.body;

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (isError) {
      statusEl.style.color = "#d00";
    } else {
      statusEl.style.color = "";
    }
  }

  // 1. Grab token from URL
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    console.error("[VerifySignup] No token in URL");
    setStatus(
      "The verification link is missing its token. Please click the full link in your email.",
      true
    );
    return;
  }

  setStatus("Verifying your school sign-up…");

  // 2. Call backend, sending token in BOTH query + body
  const url = `/api/school-signup/verify?token=${encodeURIComponent(token)}`;

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  })
    .then(async (res) => {
      let data = {};
      try {
        data = await res.json();
      } catch (e) {
        // ignore JSON parse errors; we'll fall back to generic message
      }

      if (!res.ok) {
        const msg =
          (data && (data.message || data.error)) ||
          "We couldn't complete your sign-up.";
        throw new Error(msg);
      }

      return data;
    })
    .then((data) => {
      console.log("[VerifySignup] success:", data);

      const msg =
        data.message ||
        "Your MySpeakingScore school has been created. You can now sign in to your admin portal with your email and password.";
      setStatus(msg, false);
    })
    .catch((err) => {
      console.error("[VerifySignup] error:", err);
      setStatus(
        err.message ||
          "We couldn't complete your sign-up due to a technical problem.",
        true
      );
    });
})();