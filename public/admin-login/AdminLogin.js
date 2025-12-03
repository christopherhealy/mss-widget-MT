// /admin-login/AdminLogin.js
console.log("✅ AdminLogin.js loaded");

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("admin-login-form");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const statusEl = document.getElementById("login-status");

    function setStatus(msg) {
      if (!statusEl) {
        console.log("[login-status]", msg);
        return;
      }
      statusEl.textContent = msg || "";
      statusEl.style.display = msg ? "block" : "none";
    }

    if (!form) {
      console.error("❌ admin-login-form not found in DOM.");
      return;
    }

    async function handleLoginSubmit(event) {
      event.preventDefault();

      const email = (emailInput && emailInput.value.trim()) || "";
      const password = (passwordInput && passwordInput.value) || "";

      if (!email || !password) {
        setStatus("Please enter both email and password.");
        return;
      }

      setStatus("Signing you in…");

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        let data;
        try {
          data = await res.json();
        } catch (parseErr) {
          const text = await res.text();
          console.error("Login JSON parse error:", parseErr, text);
          setStatus("Server returned an unexpected response.");
          return;
        }

        console.log("[AdminLogin] response data:", data);

        if (!res.ok || !data.ok) {
          console.error("Login HTTP error:", res.status, data);
          setStatus(
            data.message ||
              data.error ||
              `Login failed (${res.status}).`
          );
          return;
        }

        // Normalise the admin fields, no matter how backend sends them
        let adminId = data.adminId;
        let adminEmail = data.email;
        let adminName = data.name;
        let isSuperAdmin = !!data.isSuperAdmin;
        let schools = data.schools || [];
        let token = data.token || null;

        if (data.admin) {
          adminId = adminId ?? data.admin.id;
          adminEmail = adminEmail ?? data.admin.email;
          adminName = adminName ?? data.admin.name;
          if (typeof data.admin.isSuperAdmin === "boolean") {
            isSuperAdmin = data.admin.isSuperAdmin;
          }
          if (Array.isArray(data.admin.schools)) {
            schools = data.admin.schools;
          }
        }

        const session =
          data.session ||
          {
            adminId,
            email: adminEmail,
            name: adminName,
            isSuperAdmin,
            schools,
            createdAt: Date.now(),
            token,
          };

        console.log("[AdminLogin] built session:", session);

        if (window.MSSAdminSession && session && session.adminId) {
          window.MSSAdminSession.setSession(session);
        } else {
          console.warn(
            "[AdminLogin] MSSAdminSession missing OR no adminId in session – NOT saving."
          );
        }

        const params = new URLSearchParams(window.location.search);
        const returnTo = params.get("returnTo");
        const next = returnTo || "/admin/SchoolPortal.html";

        window.location.href = next;
      } catch (err) {
        console.error("Login error:", err);
        setStatus("Could not sign you in. Please try again.");
      }
    }

    form.addEventListener("submit", handleLoginSubmit);
  });
})();