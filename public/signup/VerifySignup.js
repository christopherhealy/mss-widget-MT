// /signup/VerifySignup.js
console.log("✅ VerifySignup.js loaded");

(function () {
  const msgEl = document.getElementById("verifyMessage") || null;
  const statusEl = document.getElementById("verifyStatus") || null;
  const linkEl = document.getElementById("verifyLink") || null;

  function setMessage(text) {
    if (msgEl) msgEl.textContent = text || "";
  }

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("ok", !isError);
    statusEl.classList.toggle("err", !!isError);
  }

  function showLoginLink(email) {
    if (!linkEl) return;
    const href =
      "/admin-login/AdminLogin.html" +
      (email ? `?email=${encodeURIComponent(email)}` : "");

    linkEl.style.display = "block";
    linkEl.innerHTML = `<a href="${href}">Go to Admin Login</a>`;
  }

  // 1) Grab token from URL
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    console.error("[VerifySignup] No token in URL");
    setMessage("Verification link problem");
    setStatus(
      "The verification link is missing its token. Please click the full link in your email.",
      true
    );
    return;
  }

  setMessage("Please wait while we confirm your email.");
  setStatus("Verifying your school sign-up…", false);

  // 2) Call backend
  const url = `/api/school-signup/verify?token=${encodeURIComponent(token)}`;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  })
    .then(async (res) => {
      let data = {};
      try {
        data = await res.json();
      } catch {
        // ignore
      }

      if (!res.ok || data.ok === false) {
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

      setMessage("Verified.");
      setStatus(msg, false);

      // If API returned adminEmail, wire it into login link
      showLoginLink(data.adminEmail || null);
    })
    .catch((err) => {
      console.error("[VerifySignup] error:", err);
      setMessage("We could not verify your sign-up.");
      setStatus(
        err.message ||
          "We couldn't complete your sign-up due to a technical problem.",
        true
      );
    });
})();