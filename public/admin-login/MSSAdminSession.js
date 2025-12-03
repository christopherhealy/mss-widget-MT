// /admin-login/MSSAdminSession.js
console.log("✅ MSSAdminSession loaded");

(function () {
  "use strict";

  const KEY = "mss_admin_session_v1"; // <-- single source of truth

  function getSession() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.error("[MSSAdminSession] getSession error:", err);
      return null;
    }
  }

  function setSession(session) {
    try {
      console.log("[MSSAdminSession] setSession", session);
      localStorage.setItem(KEY, JSON.stringify(session || {}));
    } catch (err) {
      console.error("[MSSAdminSession] setSession error:", err);
    }
  }

  function clearSession() {
    try {
      console.log("[MSSAdminSession] clearSession");
      localStorage.removeItem(KEY);
    } catch (err) {
      console.error("[MSSAdminSession] clearSession error:", err);
    }
  }

  window.MSSAdminSession = {
    KEY,
    getSession,
    setSession,
    clearSession,
  };
})();