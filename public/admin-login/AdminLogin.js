// /admin-login/AdminLogin.js
console.log("✅ AdminLogin.js loaded");

(function () {
  "use strict";

  const form       = document.getElementById("admin-login-form");
  const emailInput = document.getElementById("email");
  const passInput  = document.getElementById("password");
  const statusEl   = document.getElementById("login-status");

  if (!form) {
    console.warn("AdminLogin: form #admin-login-form not found");
    return;
  }

  // Show messages under the form
  function setStatus(msg, isError = false) {
    if (!statusEl) {
      if (msg) console[isError ? "warn" : "log"]("Login:", msg);
      return;
    }
    statusEl.textContent = msg || "";
    statusEl.style.display = msg ? "block" : "none";
    statusEl.style.color = isError ? "#b91c1c" : "#111827";
  }

  // If redirected after password reset, show success banner
  (function showResetMessageIfNeeded() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "ok") {
      setStatus("Your password has been reset. Please sign in.", false);
    }
  })();

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const email = (emailInput?.value || "").trim();
    const password = (passInput?.value || "").trim();

    if (!email || !password) {
      setStatus("Please enter both email and password.", true);
      return;
    }

    setStatus("Signing you in…", false);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        const msg =
          data.message ||
          (res.status === 401
            ? "Invalid email or password."
            : "Login failed. Please try again.");
        setStatus(msg, true);
        return;
      }

      // Build admin session object
      const session = {
        adminId: data.adminId,
        email: data.email,
        name: data.name,
        isSuperAdmin: !!data.isSuperAdmin,
        schools: data.schools || [],
        activeSchool:
          data.slug ||
          (Array.isArray(data.schools) && data.schools[0]
            ? data.schools[0].slug
            : null),
      };

      try {
        window.localStorage.setItem(
          "mssAdminSession",
          JSON.stringify(session)
        );
      } catch (err) {
        console.warn("AdminLogin: could not persist session:", err);
      }

      const targetSlug = session.activeSchool || "mss-demo";
      setStatus("");

      window.location.href =
        "/admin/SchoolPortal.html?slug=" + encodeURIComponent(targetSlug);
    } catch (err) {
      console.error("AdminLogin: unexpected error", err);
      setStatus("Unexpected error during login. Please try again.", true);
    }
  });
})();