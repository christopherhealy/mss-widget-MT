// /admin/AdminLogin.js
console.log("✅ AdminLogin.js loaded");

// Decide where the API lives
const ADMIN_API_BASE =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"                       // local dev (Node server)
    : "https://mss-widget-mt.onrender.com";        // Render production API

const form = document.getElementById("adminLoginForm");
const statusEl = document.getElementById("loginStatus");

function setStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#d00" : "";
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = (form.email?.value || "").trim();
    const password = form.password?.value || "";

    if (!email || !password) {
      setStatus("Please enter your email and password.", true);
      return;
    }

    setStatus("Signing you in…");

    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // get/set admin cookies
        body: JSON.stringify({ email, password }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // ignore JSON parse error, fall back to generic message
      }

      if (!res.ok) {
        const msg =
          data.message ||
          data.error ||
          "Login failed. Please check your email and password.";
        console.error("[AdminLogin] login failed:", data);
        setStatus(msg, true);
        return;
      }

      console.log("[AdminLogin] login success:", data);
      setStatus("Signed in. Redirecting…", false);

      // Redirect to Config Admin or School Portal
      window.location.href = "/admin/SchoolPortal.html";
    } catch (err) {
      console.error("[AdminLogin] network error:", err);
      setStatus(
        "We couldn’t reach the admin server. Please try again in a moment.",
        true
      );
    }
  });
} else {
  console.warn("[AdminLogin] form#adminLoginForm not found");
}