// /admin-login/AdminLogin.js
// Handles admin login + creates localStorage session for SchoolPortal/ConfigAdmin

console.log("✅ AdminLogin.js loaded");

(function () {
  "use strict";

  const LS_KEY = "mssAdminSession";

  const form          = document.getElementById("adminLoginForm");
  const emailInput    = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const statusEl      = document.getElementById("loginStatus");

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!isError);
  }

  function localStorageAvailable() {
    try {
      const testKey = "__mss_ls_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      console.warn("[AdminLogin] localStorage unavailable", e);
      return false;
    }
  }

  function saveAdminSession(admin, schools) {
    if (!localStorageAvailable()) {
      setStatus(
        "Local storage is disabled. Please enable it in your browser to use the admin portal.",
        true
      );
      return;
    }

    const safeSchools = Array.isArray(schools) ? schools : [];
    const currentSlug =
      safeSchools.length && safeSchools[0].slug ? safeSchools[0].slug : null;

    const session = {
      adminId: admin.id,
      email: admin.email,
      name: admin.name,
      // be defensive about the flag name
      superAdmin: !!(
        admin.is_super_admin ||
        admin.super_admin ||
        admin.isSuperAdmin
      ),
      schools: safeSchools.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
      })),
      currentSlug,
      createdAt: new Date().toISOString(),
    };

    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(session));
      console.log("[AdminLogin] Saved admin session to localStorage:", session);
    } catch (e) {
      console.error("[AdminLogin] Failed to save session", e);
      setStatus(
        "Could not save login session. Check browser storage settings.",
        true
      );
    }

    return currentSlug;
  }

  async function onLoginSubmit(event) {
    event.preventDefault();

    const email    = (emailInput && emailInput.value.trim()) || "";
    const password = (passwordInput && passwordInput.value) || "";

    if (!email || !password) {
      setStatus("Please enter both email and password.", true);
      return;
    }

    setStatus("Signing in…", false);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setStatus("Login failed. Check your email and password.", true);
        return;
      }

      const data = await res.json();
      if (!data.ok || !data.admin) {
        setStatus("Login failed. Check your email and password.", true);
        return;
      }

      const admin   = data.admin;
      const schools = data.schools || [];

      const slug = saveAdminSession(admin, schools);

      // Redirect into the portal; for now we still pass slug via query
      let target = "/admin/SchoolPortal.html";
      if (slug) {
        target += `?slug=${encodeURIComponent(slug)}`;
      }

      setStatus("Login successful. Redirecting…", false);
      window.location.href = target;
    } catch (err) {
      console.error("[AdminLogin] Login error", err);
      setStatus("Network or server error during login.", true);
    }
  }

  function init() {
    if (!form) {
      console.warn("[AdminLogin] adminLoginForm not found");
      return;
    }
    form.addEventListener("submit", onLoginSubmit);
  }

  document.addEventListener("DOMContentLoaded", init);
})();