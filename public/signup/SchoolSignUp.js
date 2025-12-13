// /signup/SchoolSignUp.js
console.log("✅ SchoolSignUp.js loaded");

(function () {
  "use strict";

  const form = document.getElementById("schoolSignUpForm");
  const statusEl = document.getElementById("signupStatus");

  const LS_SESSION_KEY = "mssAdminSession";

  if (!form) {
    console.error("[SchoolSignUp] Missing #schoolSignUpForm – aborting.");
    return;
  }

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#c0392b" : "#2c3e50";
  }

  function getExams(formData) {
    return formData.getAll("exams") || [];
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function isSuperAdminSession(session) {
    if (!session) return false;
    const email = String(session.email || "");
    return (
      !!session.isSuperadmin ||
      !!session.is_superadmin ||
      !!session.isSuper ||
      /@mss\.com$/i.test(email)
    );
  }

  function toIntOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // -------------------------------------------------------------------
  // ✅ Modal (no HTML changes required)
  // -------------------------------------------------------------------
  function ensureModalDom() {
    let overlay = document.getElementById("mss-confirm-overlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "mss-confirm-overlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(15,23,42,0.55)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";
    overlay.style.padding = "16px";

    overlay.innerHTML = `
      <div id="mss-confirm-modal" style="
        width: min(520px, 100%);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
        overflow: hidden;
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      ">
        <div style="padding:16px 18px; border-bottom: 1px solid #e2e8f0;">
          <div style="font-size:16px; font-weight:700; color:#0f172a;">
            Send confirmation email?
          </div>
          <div style="margin-top:6px; font-size:13px; color:#64748b; line-height:1.35;">
            If you choose <b>No</b>, the school will be created as <b>confirmed</b> immediately, and no verification email will be sent.
          </div>
        </div>

        <div style="padding:16px 18px; display:flex; gap:10px; justify-content:flex-end;">
          <button id="mss-confirm-no" style="
            padding:10px 14px;
            border-radius: 10px;
            border: 1px solid #cbd5e1;
            background: #fff;
            color: #0f172a;
            font-weight: 600;
            cursor: pointer;
          ">No (auto-confirm)</button>

          <button id="mss-confirm-yes" style="
            padding:10px 14px;
            border-radius: 10px;
            border: none;
            background: #1d4ed8;
            color: #fff;
            font-weight: 700;
            cursor: pointer;
          ">Yes (send email)</button>
        </div>
      </div>
    `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        // clicking backdrop = safest default = YES (send email)
        overlay.dataset.choice = "yes";
        overlay.dispatchEvent(new Event("mssChoice"));
      }
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function askSendConfirmationEmail() {
    return new Promise((resolve) => {
      const overlay = ensureModalDom();
      const btnYes = overlay.querySelector("#mss-confirm-yes");
      const btnNo = overlay.querySelector("#mss-confirm-no");

      const cleanup = () => {
        overlay.style.display = "none";
        btnYes && btnYes.removeEventListener("click", onYes);
        btnNo && btnNo.removeEventListener("click", onNo);
        overlay.removeEventListener("mssChoice", onChoice);
        document.removeEventListener("keydown", onKey);
      };

      const onYes = () => {
        cleanup();
        resolve(true);
      };
      const onNo = () => {
        cleanup();
        resolve(false);
      };
      const onChoice = () => {
        const c = overlay.dataset.choice === "no" ? false : true;
        cleanup();
        resolve(c);
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          cleanup();
          resolve(true); // safest default = send email
        }
      };

      overlay.style.display = "flex";
      btnYes && btnYes.addEventListener("click", onYes);
      btnNo && btnNo.addEventListener("click", onNo);
      overlay.addEventListener("mssChoice", onChoice);
      document.addEventListener("keydown", onKey);
    });
  }

  // -------------------------------------------------------------------
  // Submit handler
  // -------------------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("Submitting your school details…");

    const fd = new FormData(form);

    const adminPassword = String(fd.get("adminPassword") || "");
    const adminPasswordConfirm = String(fd.get("adminPasswordConfirm") || "");

    if (!adminPassword || !adminPasswordConfirm) {
      setStatus("Please enter and confirm your password.", true);
      return;
    }
    if (adminPassword !== adminPasswordConfirm) {
      setStatus("Passwords do not match.", true);
      return;
    }

    // Build payload (shared)
    const payload = {
      // school basics
      schoolName: String(fd.get("schoolName") || "").trim(),
      websiteUrl: String(fd.get("websiteUrl") || "").trim(),
      country: String(fd.get("country") || "").trim(),
      timeZone: String(fd.get("timeZone") || "").trim(),

      // contact / admin
      contactName: String(fd.get("contactName") || "").trim(),
      contactEmail: String(fd.get("contactEmail") || "").trim(),

      roleTitle: String(fd.get("roleTitle") || "").trim(),
      teacherCount: toIntOrNull(fd.get("teacherCount")),

      // password (backend hashes)
      adminPassword,
      adminPasswordConfirm,

      // marketing / profile
      heard: String(fd.get("heard") || "").trim(),
      programDescription: String(fd.get("programDescription") || "").trim(),
      exams: getExams(fd),
      testsPerMonth: toIntOrNull(fd.get("testsPerMonth")),

      // funnel
      anonymousFunnel: String(fd.get("anonymousFunnel") || "yes").trim(),
      funnelUrl: String(fd.get("funnelUrl") || "").trim(),

      // notes
      notes: String(fd.get("notes") || "").trim(),
    };

    // Quick client-side completeness (mirrors v2 a bit; legacy may differ)
    const requiredMissing = [];
    if (!payload.schoolName) requiredMissing.push("School name");
    if (!payload.websiteUrl) requiredMissing.push("Website URL");
    if (!payload.country) requiredMissing.push("Country");
    if (!payload.contactName) requiredMissing.push("Contact name");
    if (!payload.contactEmail) requiredMissing.push("Contact email");
    if (!payload.notes) requiredMissing.push("Notes");

    if (requiredMissing.length) {
      setStatus(`Missing required fields: ${requiredMissing.join(", ")}`, true);
      return;
    }

    // Superadmin prompt
    const session = readSession();
    const isSuper = isSuperAdminSession(session);

    if (isSuper) {
      const sendEmail = await askSendConfirmationEmail();
      payload.sendConfirmationEmail = !!sendEmail;

      if (!sendEmail) {
        payload.autoConfirm = true;
        payload.skipEmailVerification = true;

        // ✅ v2 requires verifiedEmail=true (SP-only path)
        payload.verifiedEmail = true;
      }
    }

    // Route selection
    const useV2 = !!payload.autoConfirm; // autoConfirm => SP-only path
    const url = useV2 ? "/api/school-signup/v2" : "/api/school-signup";

    // Hygiene for v2: remove fields it doesn't care about (harmless if present, but keep clean)
    if (useV2) {
      delete payload.sendConfirmationEmail;
      delete payload.skipEmailVerification;
      // v2 doesn't require adminPasswordConfirm; keep or delete—either is fine
      // delete payload.adminPasswordConfirm;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        console.error("[SchoolSignUp] error response:", { status: res.status, data });
        setStatus(data.message || "We couldn’t submit your sign-up.", true);
        return;
      }

      if (useV2) {
        // show identifiers for QA
        const bits = [];
        if (data.schoolId) bits.push(`SchoolId: ${data.schoolId}`);
        if (data.adminId) bits.push(`AdminId: ${data.adminId}`);
        if (data.slug) bits.push(`Slug: ${data.slug}`);

        setStatus(
          "Done. The school was created as CONFIRMED (SP-only path)." +
            (bits.length ? " " + bits.join(" | ") : "")
        );
      } else {
        setStatus(
          "Thanks! Please check your email and click the verification link to finish setting up your school."
        );
      }

      form.reset();
    } catch (err) {
      console.error("[SchoolSignUp] network error:", err);
      setStatus("Network error submitting your sign-up.", true);
    }
  });
})();