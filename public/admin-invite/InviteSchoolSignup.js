// /public/admin-invite/InviteSchoolSignup.js
// v1.2 — JWT token version (prod-ready)
// - Reads mssAdminSession + mss_admin_token
// - Sends Authorization: Bearer <token>
// - Payload matches server: { toEmail, firstName, subject, messageHtml, bcc }

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

  function readToken() {
    try {
      return localStorage.getItem(LS_TOKEN_KEY) || "";
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

    // IMPORTANT: adjust if your signup path differs
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

  if (messageEl) messageEl.value = defaultMessage("");

  if (firstNameEl && messageEl) {
    firstNameEl.addEventListener("input", () => {
      if (messageEl.dataset.touched === "1") return;
      messageEl.value = defaultMessage(firstNameEl.value);
    });

    messageEl.addEventListener("input", () => {
      messageEl.dataset.touched = "1";
    });
  }

  // Guard access (client-side UX only — server must enforce JWT + superadmin)
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const token = readToken();
    if (!token) {
      setStatus("Missing mss_admin_token. Please log in again.", true);
      return;
    }

    const payload = {
       toEmail: (toEmailEl?.value || "").trim(),
       subject: (subjectEl?.value || "").trim(),
       messageHtml: (messageEl?.value || "").trim(), // HTML allowed
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
      if (messageEl) {
        messageEl.dataset.touched = "0";
        messageEl.value = defaultMessage("");
      }
    } catch (err) {
      console.error(err);
      setStatus("Network error sending invite.", true);
    }
  });

const editorEl = document.getElementById("messageEditor");

// init
editorEl.innerHTML = defaultMessage("");
messageEl.value = editorEl.innerHTML;

// touched
editorEl.addEventListener("input", () => { editorEl.dataset.touched = "1"; });

// firstName change (only if not touched)
firstNameEl.addEventListener("input", () => {
  if (editorEl.dataset.touched === "1") return;
  editorEl.innerHTML = defaultMessage(firstNameEl.value);
});

// toolbar
document.querySelector(".rte-toolbar")?.addEventListener("click", (e) => {
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
});

// submit: copy editor HTML into hidden textarea
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  messageEl.value = editorEl.innerHTML.trim();
  // then proceed with your existing payload.messageHtml = messageEl.value
});

})();