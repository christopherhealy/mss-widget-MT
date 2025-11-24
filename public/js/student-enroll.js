(function () {
  const root = document.getElementById("mss-student-enroll");
  if (!root) return;

  const slug = root.dataset.mssSlug || "widget-academy";

  // Grab submissionId from the URL (sent from Dashboard4)
  const params = new URLSearchParams(window.location.search || "");
  const submissionId = params.get("submissionId");

  root.innerHTML = `
    <form id="mssEnrollForm" class="mss-enroll-form">
      <label>
        Full name
        <input type="text" name="name" required />
      </label>
      <label>
        Email
        <input type="email" name="email" required />
      </label>
      <button type="submit">Join Widget Academy</button>
      <p id="mssEnrollStatus"></p>
    </form>
  `;

  const form = document.getElementById("mssEnrollForm");
  const statusEl = document.getElementById("mssEnrollStatus");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    statusEl.textContent = "Saving your details…";

    const fd = new FormData(form);
    const payload = {
      slug,
      submissionId,
      name: fd.get("name"),
      email: fd.get("email")
    };

    try {
      const res = await fetch("https://app.myspeakingscore.com/api/student/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.ok) {
        statusEl.textContent = "Sorry, we could not save your details.";
        console.warn("enroll error", json);
        return;
      }
      statusEl.textContent = "Thanks! Your scores are now linked to your account.";
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Network error. Please try again.";
    }
  });
})();