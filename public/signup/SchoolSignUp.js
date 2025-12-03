// /public/signup/SchoolSignUp.js
console.log("SchoolSignUp.js loaded");

(function () {
  "use strict";

  const form = document.getElementById("schoolSignUpForm");
  if (!form) {
    console.warn("schoolSignUpForm not found");
    return;
  }

  const submitBtn = document.querySelector(".ss-btn-primary");

  // Simple inline status element at the bottom of the form
  const statusEl = document.createElement("div");
  statusEl.id = "signupStatus";
  statusEl.style.marginTop = "0.75rem";
  statusEl.style.fontSize = "0.8rem";
  statusEl.style.color = "#4b5563";
  form.appendChild(statusEl);

  function setStatus(msg, type = "info") {
    statusEl.textContent = msg || "";
    statusEl.style.color =
      type === "error" ? "#b91c1c" :
      type === "success" ? "#166534" :
      "#4b5563";
  }

  function getCheckedValues(name) {
    return Array.from(
      form.querySelectorAll(`input[name="${name}"]:checked`)
    ).map((el) => el.value);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("");

    // --- Collect values ---------------------------------------------------
    const schoolName     = form.schoolName.value.trim();
    const schoolWebsite  = form.websiteUrl.value.trim();
    const country        = form.country.value.trim();
    const timeZone       = form.timeZone.value.trim();

    const adminName      = form.contactName.value.trim();
    const adminEmail     = form.contactEmail.value.trim();
    const roleTitle      = form.roleTitle.value.trim();
    const teacherCount   = form.teacherCount.value.trim();

    const heard          = form.heard.value;
    const programDescription = form.programDescription.value.trim();
    const exams          = getCheckedValues("exams");
    const testsPerMonth  = form.testsPerMonth.value.trim();

    const anonymousFunnel = (form.anonymousFunnel.value || "").trim();
    const funnelUrl       = form.funnelUrl.value.trim();
    const notes           = form.notes.value.trim();

    const adminPassword       = form.adminPassword.value;
    const adminPasswordConfirm = form.adminPasswordConfirm.value;

    // --- Client-side validation -------------------------------------------
    if (!schoolName || !adminName || !adminEmail || !roleTitle) {
      setStatus(
        "Please fill in all required fields (school, contact, email, role).",
        "error"
      );
      return;
    }

    if (!adminPassword || adminPassword.length < 8) {
      setStatus(
        "Please choose an admin password with at least 8 characters.",
        "error"
      );
      return;
    }

    if (adminPassword !== adminPasswordConfirm) {
      setStatus("Passwords do not match. Please try again.", "error");
      return;
    }

    // Very light email check
    if (!adminEmail.includes("@")) {
      setStatus("Please enter a valid contact email address.", "error");
      return;
    }

    const payload = {
      schoolName,
      schoolWebsite,
      country,
      timeZone,
      adminName,
      adminEmail,
      adminPassword, // 👈 what /api/signup expects
      roleTitle,
      teacherCount: teacherCount ? Number(teacherCount) : null,
      heard,
      programDescription,
      exams,
      testsPerMonth: testsPerMonth ? Number(testsPerMonth) : null,
      anonymousFunnel,
      funnelUrl,
      notes,
    };

    // --- POST to /api/signup ----------------------------------------------
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting…";
      }

      const resp = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data.ok) {
        const msg =
          data.message ||
          data.error ||
          `Sign-up failed with status ${resp.status}.`;
        setStatus(msg, "error");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit school details";
        }
        return;
      }

      // Success – backend is currently returning { ok, schoolId, slug }
      setStatus(
        "Thanks! Your school has been created. You can now sign in with your email and password once your portal is ready.",
        "success"
      );

      console.log("Signup success:", data);

      // Optional: clear the form but keep email visible
      form.reset();
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitted";
      }
    } catch (err) {
      console.error("Sign-up error:", err);
      setStatus("There was a problem submitting your details. Please try again.", "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit school details";
      }
    }
  });
})();