console.log("✅ InviteSchoolSignup.js loaded");

(function () {
  "use strict";

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_ADMIN_KEY = "mss_admin_key";

  const form = document.getElementById("inviteForm");
  const statusEl = document.getElementById("status");

  const toEmailEl = document.getElementById("toEmail");
  const firstNameEl = document.getElementById("firstName");
  const subjectEl = document.getElementById("subject");
  const messageEl = document.getElementById("messageHtml");
  const bccEl = document.getElementById("bcc");

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#c0392b" : "";
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function readAdminKey() {
    try {
      return localStorage.getItem(LS_ADMIN_KEY) || "";
    } catch {
      return "";
    }
  }

  function isSuperAdminSession(session) {
    if (!session) return false;
    const email = session.email || "";
    return !!session.isSuperadmin || /@mss\.com$/i.test(email);
  }

  // Default subject + message
  subjectEl.value = "Thanks — please create your School Sign-up";

  function defaultMessage(firstName) {
    const name = firstName ? firstName.trim() : "";
    const greet = name ? `Hi ${name},` : "Hi there,";
    const signupUrl = `${window.location.origin}/signup/SchoolSignUp.html`;

    return `
      <p>${greet}</p>
      <p>It was a pleasure speaking with you.</p>
      <p>To start your 60-day trial, please complete our School Sign-Up form. Once you submit the form and verify your email, your School Portal will be ready to use.</p>
      <p><a href="${signupUrl}">School Sign-Up</a></p>
      <p>If you have any questions or run into any issues, reply to this email and we’ll be happy to help.</p>
      <p>Thanks,<br/>Chris, Andrew and the MSS Widget Team</p>
    `.trim();
  }

  messageEl.value = defaultMessage("");

  firstNameEl.addEventListener("input", () => {
    // only overwrite if user hasn't edited much (simple heuristic)
    if (messageEl.dataset.touched === "1") return;
    messageEl.value = defaultMessage(firstNameEl.value);
  });

  messageEl.addEventListener("input", () => {
    messageEl.dataset.touched = "1";
  });

  // Guard access (client-side)
  const session = readSession();
  if (!isSuperAdminSession(session)) {
    setStatus("Access denied (Super Admin only).", true);
    form.querySelector("button[type=submit]").disabled = true;
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const adminKey = readAdminKey();
    if (!adminKey) {
      setStatus("Missing mss_admin_key. Please log in again.", true);
      return;
    }

    const payload = {
      toEmail: (toEmailEl.value || "").trim(),
      firstName: (firstNameEl.value || "").trim(),
      subject: (subjectEl.value || "").trim(),
      messageHtml: (messageEl.value || "").trim(),
      bcc: (bccEl.value || "").trim(),
    };

    if (!payload.toEmail || !payload.subject || !payload.messageHtml) {
      setStatus("Recipient Email, Subject, and Message are required.", true);
      return;
    }

    setStatus("Sending…");

    try {
      const res = await fetch("/api/admin/invite-school-signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mss-admin-key": adminKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setStatus(data.message || "Invite send failed.", true);
        return;
      }

      setStatus("Invite sent.");
      form.reset();
      subjectEl.value = "Thanks — please create your School Sign-up";
      messageEl.dataset.touched = "0";
      messageEl.value = defaultMessage("");
    } catch (err) {
      console.error(err);
      setStatus("Network error sending invite.", true);
    }
  });
})();