(function () {
  const form = document.getElementById("signupForm");
  const statusEl = document.getElementById("signupStatus");
  const resultShell = document.getElementById("resultShell");
  const schoolIdEl = document.getElementById("resultSchoolId");
  const slugEl = document.getElementById("resultSlug");
  const codeEl = document.getElementById("resultCode");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!statusEl) return;

    statusEl.textContent = "Creating your school…";
    statusEl.className = "mss-signup-status mss-signup-status-working";

    const fd = new FormData(form);
    const payload = {
      schoolName: (fd.get("schoolName") || "").toString().trim(),
      schoolWebsite: (fd.get("schoolWebsite") || "").toString().trim(),
      adminName: (fd.get("adminName") || "").toString().trim(),
      adminEmail: (fd.get("adminEmail") || "").toString().trim(),
      adminPassword: (fd.get("adminPassword") || "").toString(),
    };

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        const msg =
          body.message ||
          body.error ||
          "Something went wrong while creating your school.";
        statusEl.textContent = msg;
        statusEl.className = "mss-signup-status mss-signup-status-error";
        return;
      }

      const { schoolId, slug } = body;

      statusEl.textContent = "School created successfully.";
      statusEl.className = "mss-signup-status mss-signup-status-ok";

      if (resultShell && schoolIdEl && slugEl && codeEl) {
        resultShell.classList.remove("mss-hidden");
        schoolIdEl.textContent = schoolId;
        slugEl.textContent = slug;

        const base = window.location.origin.replace(/\/+$/, "");

        const snippet = [
          '<div id="mss-widget-container"></div>',
          `<script src="${base}/embed.js" data-school-id="${schoolId}"></script>`
        ].join("\n");

        codeEl.textContent = snippet;
      }
    } catch (err) {
      statusEl.textContent =
        "Network error while creating your school. Please try again.";
      statusEl.className = "mss-signup-status mss-signup-status-error";
      console.error("signup error:", err);
    }
  });
})();