// /signup/SchoolSignUp.js

console.log("✅ SchoolSignUp.js loaded");

(function () {
  "use strict";

  const form = document.getElementById("schoolSignUpForm");
  const statusEl = document.getElementById("signupStatus");

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#c0392b" : "#2c3e50";
  }

  function getExams(formData) {
    return formData.getAll("exams") || [];
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("Submitting your school details…");

    const fd = new FormData(form);

    const adminPassword = fd.get("adminPassword") || "";
    const adminPasswordConfirm = fd.get("adminPasswordConfirm") || "";

    if (adminPassword !== adminPasswordConfirm) {
      setStatus("Passwords do not match.", true);
      return;
    }

    const payload = {
      // school basics
      schoolName: (fd.get("schoolName") || "").trim(),
      websiteUrl: (fd.get("websiteUrl") || "").trim(),
      country: (fd.get("country") || "").trim(),
      timeZone: (fd.get("timeZone") || "").trim(),

      // contact / admin
      contactName: (fd.get("contactName") || "").trim(),
      contactEmail: (fd.get("contactEmail") || "").trim(),
      roleTitle: (fd.get("roleTitle") || "").trim(),
      teacherCount: Number(fd.get("teacherCount") || 0) || 0,

      // passwords – backend will hash
      adminPassword,
      adminPasswordConfirm,

      // marketing / profile
      heard: fd.get("heard") || "",
      programDescription: (fd.get("programDescription") || "").trim(),
      exams: getExams(fd),
      testsPerMonth: Number(fd.get("testsPerMonth") || 0) || 0,

      // funnel
      anonymousFunnel: fd.get("anonymousFunnel") || "yes",
      funnelUrl: (fd.get("funnelUrl") || "").trim(),

      // notes
      notes: (fd.get("notes") || "").trim(),
    };

    try {
      const res = await fetch("/api/school-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        console.error("[SchoolSignUp] error response:", data);
        setStatus(data.message || "We couldn’t submit your sign-up.", true);
        return;
      }

      setStatus(
        "Thanks! Please check your email and click the verification link to finish setting up your school."
      );
      form.reset();
    } catch (err) {
      console.error("[SchoolSignUp] network error:", err);
      setStatus("Network error submitting your sign-up.", true);
    }
  });
})();