// /public/admin-invite/InviteSchoolSignup.js
// v1.3 — JWT token + RTE sync fix (single submit handler)

console.log("✅ InviteSchoolSignup.js loaded");

(function () {
  "use strict";

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_TOKEN_KEY = "mss_admin_token";

  const form = document.getElementById("inviteForm");
  const statusEl = document.getElementById("status");

  const toEmailEl = document.getElementById("toEmail");
  const firstNameEl = document.getElementById("firstName");
  const subjectEl = document.getElementById("subject");
  const messageEl = document.getElementById("messageHtml"); // hidden textarea (server payload)
  const bccEl = document.getElementById("bcc");

  // RTE
  const editorEl = document.getElementById("messageEditor");
  const toolbarEl = document.querySelector(".rte-toolbar");

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

  function readToken() {
    try {
      return (localStorage.getItem(LS_TOKEN_KEY) || "").trim();
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
  if (subjectEl) subjectEl.value = "Thanks — please create your School Sign-up";

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

  // Guard access (UX only — server must enforce)
  const session = readSession();
  if (!isSuperAdminSession(session)) {
    setStatus("Access denied (Super Admin only).", true);
    const btn = form?.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    return;
  }

  if (!form) {
    console.error("[InviteSchoolSignup] Missing #inviteForm");
    return;
  }
  if (!editorEl) {
    console.error("[InviteSchoolSignup] Missing #messageEditor");
    return;
  }
  if (!messageEl) {
    console.error("[InviteSchoolSignup] Missing #messageHtml (hidden textarea)");
    return;
  }

  // Init editor + hidden textarea
  editorEl.innerHTML = defaultMessage("");
  messageEl.value = editorEl.innerHTML;
  editorEl.dataset.touched = "0";

  // If firstName changes and user hasn't edited, regenerate message
  if (firstNameEl) {
    firstNameEl.addEventListener("input", () => {
      if (editorEl.dataset.touched === "1") return;
      editorEl.innerHTML = defaultMessage(firstNameEl.value);
      messageEl.value = editorEl.innerHTML;
    });
  }

  // Mark as touched when user edits
  editorEl.addEventListener("input", () => {
    editorEl.dataset.touched = "1";
    messageEl.value = editorEl.innerHTML.trim();
  });

  // Toolbar actions
  toolbarEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.dataset.cmd) {
      document.execCommand(btn.dataset.cmd, false, null);
      editorEl.focus();
    }

    if (btn.dataset.link) {
      const url = prompt("Enter link URL:");
      if (url) document.execCommand("createLink", false, url);
      editorEl.focus();
    }

    // keep textarea synced
    messageEl.value = editorEl.innerHTML.trim();
  });

  // SINGLE submit handler (sync → payload → validate → send)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const token = readToken();
    if (!token) {
      setStatus("Missing mss_admin_token. Please log in again.", true);
      return;
    }

    // Sync editor -> hidden textarea -> payload
    messageEl.value = editorEl.innerHTML.trim();

    const payload = {
      toEmail: (toEmailEl?.value || "").trim(),
      subject: (subjectEl?.value || "").trim(),
      messageHtml: (messageEl?.value || "").trim(),
      bcc: (bccEl?.value || "").trim(),
      firstName: (firstNameEl?.value || "").trim(),
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
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setStatus(data.message || `Invite send failed (HTTP ${res.status}).`, true);
        return;
      }

      setStatus("Invite sent.");
      form.reset();

      if (subjectEl) subjectEl.value = "Thanks — please create your School Sign-up";
      editorEl.dataset.touched = "0";
      editorEl.innerHTML = defaultMessage("");
      messageEl.value = editorEl.innerHTML;
    } catch (err) {
      console.error(err);
      setStatus("Network error sending invite.", true);
    }
  });
})();