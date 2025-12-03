// /admin/SchoolPortal.js – v0.8 (Dec 1, 2025)
// Canonical version aligned with ConfigAdmin.js (settings.config.* only)

console.log("✅ SchoolPortal.js v0.8 loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ----------------------------------------------------
     DOM Refs
  ---------------------------------------------------- */

  const slugBadge = $("portal-slug-badge");
  const schoolSelect = $("portal-school-selector") || $("portal-school-select");
  const statusEl = $("portal-status");

  const testsTableBody = $("tests-tbody") || $("portal-tests-tbody");
  const testsCountLabel = $("tests-count-label");

  const widgetTab = $("tab-widget");
  const dashboardTab = $("tab-dashboard");
  const iframeEl = $("portal-iframe");
  const embedSnippetEl = $("embed-snippet");
  const btnCopyEmbed = $("btn-copy-embed");

  const btnWidgetSurvey = $("btn-widgetSurvey");
  const btnConfigAdmin = $("btn-configAdmin");
  const btnRefreshTests = $("btn-refresh-tests");
  const logoutBtn = $("portal-logout");

  // Transcript / prompt modal
  const transcriptBackdrop = $("portal-transcript-backdrop");
  const transcriptTitle = $("portal-transcript-title");
  const transcriptBody = $("portal-transcript-body");

  // Stats elements
  const statsLoadingEl = $("stats-loading");
  const statsContentEl = $("stats-content");
  const statsRangeLabelEl = $("stats-range-label");
  const statTotalTestsEl = $("stat-totalTests");
  const statTopQuestionEl = $("stat-topQuestion");
  const statHighestCEFR = $("stat-highestCEFR");
  const statLowestCEFR = $("stat-lowestCEFR");
  const statAvgCEFR = $("stat-avgCEFR");
  const timeframeToggleEl = $("timeframe-toggle");

  /* ----------------------------------------------------
     State
  ---------------------------------------------------- */

  let SESSION = null;
  let CURRENT_SCHOOL = null;
  let ALL_SCHOOLS = [];
  let previewMode = "widget"; // "widget" | "dashboard"

  /* ----------------------------------------------------
     Helpers
  ---------------------------------------------------- */

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
    console.log("[portal-status]", msg);
  }

  function getSlugFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const slug = (params.get("slug") || "").trim();
    return slug || null;
  }

  function getCurrentSlug() {
    return (CURRENT_SCHOOL && CURRENT_SCHOOL.slug) || getSlugFromUrl() || "";
  }

  function getWidgetPath() {
    return (
      CURRENT_SCHOOL?.settings?.config?.widgetPath?.trim() ||
      "Widget.html"
    );
  }

  function getDashboardPath() {
    return (
      CURRENT_SCHOOL?.settings?.config?.dashboardPath?.trim() ||
      "Dashboard.html"
    );
  }

  function requireSessionOrRedirect() {
    if (!window.MSSAdminSession) {
      window.location.href = "/admin-login/AdminLogin.html";
      return null;
    }

    const session = window.MSSAdminSession.getSession();
    if (!session || !session.adminId) {
      const returnTo = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      window.location.href = `/admin-login/AdminLogin.html?returnTo=${returnTo}`;
      return null;
    }

    return session;
  }

  /* ----------------------------------------------------
     EMBED SNIPPET
  ---------------------------------------------------- */

  function updateEmbedSnippet() {
    if (!embedSnippetEl) return;

    const slug = getCurrentSlug();
    if (!slug) {
      embedSnippetEl.value = "";
      return;
    }

    const widget = getWidgetPath();
    const snippet = `
<iframe
  src="https://mss-widget-mt.vercel.app/widgets/${widget}?slug=${slug}"
  width="420"
  height="720"
  style="border:0;max-width:100%;"
  allow="microphone; camera; autoplay; encrypted-media"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin">
</iframe>`.trim();

    embedSnippetEl.value = snippet;
  }

  /* ----------------------------------------------------
     PREVIEW IFRAME
  ---------------------------------------------------- */

  function updatePortalIframe() {
    if (!iframeEl) return;

    const slug = getCurrentSlug();
    if (!slug) {
      iframeEl.src = "about:blank";
      return;
    }

    const widget = getWidgetPath();
    const dash = getDashboardPath();

    if (previewMode === "dashboard") {
      iframeEl.src = `/dashboards/${dash}?slug=${encodeURIComponent(slug)}`;
    } else {
      iframeEl.src = `/widgets/${widget}?slug=${encodeURIComponent(slug)}`;
    }
  }

  function setActiveTab(mode) {
    previewMode = mode;

    widgetTab?.classList.toggle("active", mode === "widget");
    dashboardTab?.classList.toggle("active", mode === "dashboard");

    updatePortalIframe();
  }

  /* ----------------------------------------------------
     SCHOOLS
  ---------------------------------------------------- */

  function updateSlugBadge(slug) {
    if (slugBadge) slugBadge.textContent = `slug: ${slug || "—"}`;
  }

  function populateSchoolSelect(schools, preferredSlug) {
    if (!schoolSelect) return;

    schoolSelect.innerHTML = "";
    schools.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.slug;
      opt.textContent = s.name || s.slug;
      schoolSelect.appendChild(opt);
    });

    let chosen =
      schools.find((s) => s.slug === preferredSlug) || schools[0] || null;

    if (chosen) {
      CURRENT_SCHOOL = chosen;
      schoolSelect.value = chosen.slug;
      updateSlugBadge(chosen.slug);
      updateEmbedSnippet();
      updatePortalIframe();
    }
  }

  /* ----------------------------------------------------
     TESTS TABLE (with new Action dropdown)
  ---------------------------------------------------- */

  function renderTestsTable(tests) {
    if (!testsTableBody) return;
    testsTableBody.innerHTML = "";

    tests.forEach((t) => {
      const tr = document.createElement("tr");
      const td = (txt) => {
        const cell = document.createElement("td");
        cell.textContent = txt == null ? "" : String(txt);
        return cell;
      };

      /* ---- ACTION DROPDOWN ---- */
      const tdActions = document.createElement("td");
      const sel = document.createElement("select");
      sel.innerHTML = `
        <option value="">View…</option>
        <option value="transcript">Transcript</option>
        <option value="prompt">AI Prompt</option>
        <option value="dashboard">Dashboard View</option>
      `;
      sel.addEventListener("change", async () => {
        const value = sel.value;
        sel.value = "";

        if (value === "transcript") {
          try {
            const res = await fetch(`/api/admin/test/${t.id}/transcript`);
            const data = await res.json();
            if (!res.ok || !data.ok)
              throw new Error(data.error || "Transcript error");

            transcriptTitle.textContent = "Transcript";
            transcriptBody.textContent =
              data.transcript_clean || data.transcript || "(none)";
            transcriptBackdrop.classList.remove("hidden");
          } catch (err) {
            console.error("Transcript error:", err);
          }
        }

        if (value === "prompt") {
          try {
            const res = await fetch(`/api/admin/test/${t.id}/prompt`);
            const data = await res.json();
            if (!res.ok || !data.ok)
              throw new Error(data.error || "Prompt error");

            transcriptTitle.textContent = "AI Prompt";
            transcriptBody.textContent =
              data.ai_prompt || data.prompt || data.meta?.ai_prompt || "(none)";
            transcriptBackdrop.classList.remove("hidden");
          } catch (err) {
            console.error("Prompt error:", err);
          }
        }

        if (value === "dashboard") {
          const slug = CURRENT_SCHOOL.slug;
          window.open(
            `/DashboardViewer.html?slug=${encodeURIComponent(
              slug
            )}&testId=${t.id}`,
            "_blank"
          );
        }
      });

      tdActions.appendChild(sel);
      tr.appendChild(tdActions);

      /* ---- DATA COLUMNS (no legacy transcript/prompt cols) ---- */
      tr.appendChild(td(t.id));
      tr.appendChild(td(t.submitted_at || ""));
      tr.appendChild(td(t.student_name || t.student_id || ""));
      tr.appendChild(td(t.question || ""));
      tr.appendChild(td(t.toefl ?? t.mss_toefl ?? ""));
      tr.appendChild(td(t.ielts ?? t.mss_ielts ?? ""));
      tr.appendChild(td(t.pte ?? t.mss_pte ?? ""));
      tr.appendChild(td(t.cefr ?? t.mss_cefr ?? ""));
      tr.appendChild(td(t.vox_score ?? ""));
      tr.appendChild(td(t.help_level ?? ""));
      tr.appendChild(td(t.dashboard_variant ?? ""));
      tr.appendChild(td(t.mss_fluency ?? ""));
      tr.appendChild(td(t.mss_grammar ?? ""));
      tr.appendChild(td(t.mss_pron ?? ""));
      tr.appendChild(td(t.mss_vocab ?? ""));
      tr.appendChild(td(t.mss_cefr ?? ""));
      tr.appendChild(td(t.mss_toefl ?? ""));
      tr.appendChild(td(t.mss_ielts ?? ""));
      tr.appendChild(td(t.mss_pte ?? ""));

      testsTableBody.appendChild(tr);
    });
  }

  async function loadTestsForCurrentSchool() {
    if (!CURRENT_SCHOOL) return;

    setStatus("Loading tests…");
    const params = new URLSearchParams({ slug: CURRENT_SCHOOL.slug });
    if (SESSION.token) params.set("token", SESSION.token);

    const url = `/api/admin/tests?${params.toString()}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.ok)
        throw new Error(data.error || "Failed loading tests");

      const tests = data.tests || [];
      renderTestsTable(tests);

      testsCountLabel.textContent = `${tests.length} tests`;
      setStatus(`Showing ${tests.length} test(s).`);
    } catch (err) {
      console.error("❌ loadTestsForCurrentSchool:", err);
      setStatus("Error loading tests.");
    }
  }

  /* ----------------------------------------------------
     STATS (unchanged, just cleaned)
  ---------------------------------------------------- */

  async function loadStats(range = "today") {
    if (!CURRENT_SCHOOL) return;

    const slug = CURRENT_SCHOOL.slug;
    const url = `/api/admin/stats/${slug}?range=${range}`;

    statsLoadingEl.style.display = "block";
    statsContentEl.style.display = "none";

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || data.ok === false)
        throw new Error(data.error || "Stats error");

      const stats = data.stats || data;

      statsRangeLabelEl.textContent =
        stats.from && stats.to
          ? `${stats.from} → ${stats.to} (${stats.range})`
          : `Range: ${stats.range || range}`;

      statTotalTestsEl.textContent = stats.totalTests ?? "—";
      statTopQuestionEl.textContent =
        stats.topQuestion?.text || "—";
      statHighestCEFR.textContent = stats.highestCEFR || "—";
      statLowestCEFR.textContent = stats.lowestCEFR || "—";
      statAvgCEFR.textContent = stats.avgCEFR || "—";

      statsLoadingEl.style.display = "none";
      statsContentEl.style.display = "block";
    } catch (err) {
      console.error("Stats load error:", err);
      statsRangeLabelEl.textContent = "Could not load stats.";
      statsLoadingEl.style.display = "none";
      statsContentEl.style.display = "none";
    }
  }

  /* ----------------------------------------------------
     INIT
  ---------------------------------------------------- */

  async function init() {
    console.log("🔎 SchoolPortal init()");

    SESSION = requireSessionOrRedirect();
    if (!SESSION) return;

    let schools = [];
    try {
      if (SESSION.isSuperAdmin) {
        const res = await fetch(`/api/admin/schools?adminId=${SESSION.adminId}`);
        const data = await res.json();
        if (res.ok && data.ok) schools = data.schools;
      } else {
        const res = await fetch(`/api/admin/my-schools?adminId=${SESSION.adminId}`);
        const data = await res.json();
        if (res.ok && data.ok) schools = data.schools;
      }
    } catch (err) {
      console.error("School load error:", err);
    }

    ALL_SCHOOLS = schools;
    const preferredSlug = getSlugFromUrl();
    populateSchoolSelect(schools, preferredSlug);

    await loadTestsForCurrentSchool();
    await loadStats("today");
    setActiveTab("widget");

    /* Attach UI listeners */
    schoolSelect?.addEventListener("change", async () => {
      const slug = schoolSelect.value;
      CURRENT_SCHOOL =
        ALL_SCHOOLS.find((s) => s.slug === slug) ||
        { slug, settings: { config: {} } };

      updateSlugBadge(slug);
      updatePortalIframe();
      updateEmbedSnippet();

      await loadTestsForCurrentSchool();
      await loadStats("today");
    });

    widgetTab?.addEventListener("click", () => setActiveTab("widget"));
    dashboardTab?.addEventListener("click", () => setActiveTab("dashboard"));

    btnWidgetSurvey?.addEventListener("click", () => {
      const slug = getCurrentSlug();
      window.open(
        `/questions-admin/WidgetSurvey.html?slug=${slug}`,
        "_blank"
      );
    });

    btnConfigAdmin?.addEventListener("click", () => {
      const slug = getCurrentSlug();
      window.open(
        `/config-admin/ConfigAdmin.html?slug=${slug}`,
        "_blank"
      );
    });

    btnRefreshTests?.addEventListener("click", () => loadTestsForCurrentSchool());

    logoutBtn?.addEventListener("click", () => {
      window.MSSAdminSession?.clearSession();
      window.location.href = "/admin-login/AdminLogin.html";
    });

    btnCopyEmbed?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(embedSnippetEl.value || "");
      } catch (err) {
        console.warn("Copy failed:", err);
      }
    });

    transcriptBackdrop?.addEventListener("click", (e) => {
      if (e.target.id === "portal-transcript-backdrop")
        transcriptBackdrop.classList.add("hidden");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();