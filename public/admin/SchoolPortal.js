// /admin/SchoolPortal.js — v0.12 Portal logic, Build: 2025-11-28
// - Uses /api/admin/reports/:slug (view-backed) for the Tests/Reports table
// - Uses /api/list-dashboards to list *all* dashboards in /public/dashboards
// - "Dashboard view" opens DashboardViewer.html in a new tab/window

console.log("✅ SchoolPortal.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---- Parse query params ----
  const params = new URLSearchParams(window.location.search);
  const SLUG = params.get("slug");
  const ASSESSMENT_ID_FROM_URL = params.get("assessmentId"); // optional override

  if (!SLUG) {
    alert("Missing slug in URL. Example: ?slug=mss-demo");
  }

  // ---- DOM refs ----
  const titleEl = $("portal-title");
  const subtitleEl = $("portal-subtitle");
  const slugBadgeEl = $("portal-slug-badge");
  const assessmentLabelEl = $("portal-assessment-label");

  const iframeEl = $("portal-iframe");
  const tabWidgetEl = $("tab-widget");
  const tabDashboardEl = $("tab-dashboard");

  const btnWidgetSurvey = $("btn-widgetSurvey");
  const btnConfigAdmin = $("btn-configAdmin");
  const btnCopyEmbed = $("btn-copy-embed");
  const embedSnippetEl = $("embed-snippet");

  const statsLoadingEl = $("stats-loading");
  const statsContentEl = $("stats-content");
  const statsRangeLabelEl = $("stats-range-label");
  const statTotalTestsEl = $("stat-totalTests");
  const statTopQuestionEl = $("stat-topQuestion");
  const statHighestCEFR = $("stat-highestCEFR");
  const statLowestCEFR = $("stat-lowestCEFR");
  const statAvgCEFR = $("stat-avgCEFR");

  const timeframeToggleEl = $("timeframe-toggle");

  const filterFromEl = $("filter-from");
  const filterToEl = $("filter-to");
  const btnRefreshTests = $("btn-refresh-tests");
  const btnDownloadCsv = $("btn-download-csv");
  const btnDeleteSelected = $("btn-delete-selected");
  const testsCountLabel = $("tests-count-label");
  const testsTbody = $("tests-tbody");

  // ---- State ----

  // Defaults if config is missing
  let widgetPath = "/widgets/WidgetMin.html"; // light theme preview
  let dashboardPath = "/dashboards/Dashboard3.html";

  let assessmentId = ASSESSMENT_ID_FROM_URL
    ? Number(ASSESSMENT_ID_FROM_URL)
    : null;
  let assessmentName = null;

  let currentTimeRange = "today";

  // tests == submissions from vw_widget_reports for this slug
  let tests = [];

  // holds IDs waiting for confirmation in the delete modal
  let pendingDeleteIds = [];

  // Current report view mode from the global dropdown:
  // "transcript", "dashboard3", "dashboard4", etc.
  let REPORT_VIEW_MODE = "transcript";

  // Cached dashboard options loaded from /api/list-dashboards
  // [{ value: "dashboard3", label: "Dashboard3" }, ...]
  let DASHBOARD_OPTIONS = [];

  /* -----------------------------------------------------------------------
     Helpers
     --------------------------------------------------------------------- */

  function setActivePreviewTab(target) {
    [tabWidgetEl, tabDashboardEl].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.target === target);
    });

    if (target === "widget") {
      setIframeToWidget();
    } else {
      setIframeToDashboard();
    }
  }

  function setIframeToWidget() {
    const url = `${widgetPath}?slug=${encodeURIComponent(SLUG)}`;
    iframeEl.src = url;
  }

  function setIframeToDashboard() {
    const url = `${dashboardPath}?slug=${encodeURIComponent(SLUG)}`;
    iframeEl.src = url;
  }

  // ---- Embed snippet builder (for teachers embedding on their site) ----
  function buildEmbedSnippet() {
    if (!embedSnippetEl) return;

    // Canonical host for the student-facing widget (where mic is allowed)
    const baseEmbedOrigin = "https://mss-widget-mt.vercel.app";

    let base;
    if (/^https?:\/\//i.test(widgetPath)) {
      // widgetPath already a full URL (rare, but allow it)
      base = widgetPath;
    } else {
      // ensure leading slash, then prepend Vercel origin
      const path = widgetPath.startsWith("/") ? widgetPath : `/${widgetPath}`;
      base = `${baseEmbedOrigin}${path}`;
    }

    const url = `${base}?slug=${encodeURIComponent(SLUG)}`;

    embedSnippetEl.value = `<iframe
  src="${url}"
  width="420"
  height="720"
  style="border:0;max-width:100%;"
  allow="microphone; camera; autoplay; encrypted-media"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin">
</iframe>`;
  }

  function copyEmbedToClipboard() {
    if (!embedSnippetEl) return;
    embedSnippetEl.select();
    embedSnippetEl.setSelectionRange(0, 99999);
    try {
      document.execCommand("copy");
      btnCopyEmbed.textContent = "Copied!";
      setTimeout(() => (btnCopyEmbed.textContent = "Copy embed code"), 1500);
    } catch (e) {
      console.warn("Copy failed", e);
      alert("Copy failed. Please select the text and copy manually.");
    }
  }

  function formatShortDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Small helpers for Help / Dash columns
  function formatHelpCell(t) {
    const level = t.help_level || "none";
    const surface = t.help_surface || "";
    if (!surface) return level;
    return `${level} / ${surface}`;
  }

  function formatDashCell(t) {
    const w = t.widget_variant || "";
    const d = t.dashboard_variant || "";
    if (w && d) return `${w} → ${d}`;
    if (w) return w;
    if (d) return d;
    return "—";
  }

  /* -----------------------------------------------------------------------
     Global report view selector (top dropdown)
     --------------------------------------------------------------------- */

  // Populate #reportViewSelect from /api/list-dashboards
  async function loadDashboardOptionsIntoSelect() {
    const select = document.getElementById("reportViewSelect");
    const hasSelect = !!select;

    if (hasSelect) {
      // Keep transcript first
      select.innerHTML = `
        <option value="transcript">Transcript + AI Prompt</option>
      `;
    }

    try {
      const resp = await fetch("/api/list-dashboards");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json = await resp.json();
      DASHBOARD_OPTIONS = [];

      if (Array.isArray(json.dashboards)) {
        json.dashboards.forEach((dashName) => {
          // e.g. "Dashboard3"
          const value = dashName.toLowerCase(); // "dashboard3"
          const label = dashName;

          DASHBOARD_OPTIONS.push({ value, label });

          if (hasSelect) {
            select.insertAdjacentHTML(
              "beforeend",
              `<option value="${value}">${label}</option>`
            );
          }
        });
      }

      console.log("📊 Dashboard options loaded:", DASHBOARD_OPTIONS);
    } catch (err) {
      console.warn("Could not load dashboards:", err);
    }
  }

  function initReportViewMode() {
    const select = document.getElementById("reportViewSelect");
    if (!select) {
      REPORT_VIEW_MODE = "transcript";
      return;
    }

    // Initial value after options have loaded
    REPORT_VIEW_MODE = select.value || "transcript";

    select.addEventListener("change", () => {
      REPORT_VIEW_MODE = select.value;
      console.log("📊 Report view mode:", REPORT_VIEW_MODE);
    });
  }

  /* -----------------------------------------------------------------------
     Tests table rendering
     --------------------------------------------------------------------- */

  function renderTestsTable() {
    const safe = (v) =>
      v === null || v === undefined || v === "" ? "—" : v;

    if (!tests || tests.length === 0) {
      // 1 (Select) + 1 (Actions) + 19 other data columns = 21
      testsTbody.innerHTML =
        `<tr><td colspan="21" class="muted">No data for this period.</td></tr>`;
      testsCountLabel.textContent = "0 tests";
      return;
    }

    const rows = tests.map((t) => {
      const date = formatShortDateTime(
        t.submitted_at || t.submittedAt || t.created_at
      );

      const helpText = formatHelpCell(t);
      const dashText = formatDashCell(t);

      return `<tr data-id="${safe(t.id)}">
        <td>
          <input 
            type="checkbox" 
            class="test-select" 
            data-id="${safe(t.id)}"
          />
        </td>
        <td>
          <select class="row-action-select" data-id="${safe(t.id)}">
            <option value="">Actions…</option>
            <option value="transcript">Transcript</option>
            <option value="prompt">AI Prompt</option>
            <option value="dashboard">Dashboard view</option>
          </select>
        </td>
        <td>${safe(t.id)}</td>
        <td>${safe(date)}</td>
        <td>${safe(t.student_id)}</td>
        <td>${safe(t.question)}</td>
        <td>${safe(t.toefl)}</td>
        <td>${safe(t.ielts)}</td>
        <td>${safe(t.pte)}</td>
        <td>${safe(t.cefr)}</td>
        <td>${safe(t.vox_score)}</td>
        <td>${safe(helpText)}</td>
        <td>${safe(dashText)}</td>
        <td>${safe(t.mss_fluency)}</td>
        <td>${safe(t.mss_grammar)}</td>
        <td>${safe(t.mss_pron)}</td>
        <td>${safe(t.mss_vocab)}</td>
        <td>${safe(t.mss_cefr)}</td>
        <td>${safe(t.mss_toefl)}</td>
        <td>${safe(t.mss_ielts)}</td>
        <td>${safe(t.mss_pte)}</td>
      </tr>`;
    });

    testsTbody.innerHTML = rows.join("");
    testsCountLabel.textContent = `${tests.length} test${
      tests.length === 1 ? "" : "s"
    }`;

    wireRowActionSelects();
  }

  function wireRowActionSelects() {
    const selects = testsTbody.querySelectorAll(".row-action-select");
    if (!selects.length) return;

    selects.forEach((select) => {
      select.addEventListener("change", () => {
        const value = select.value;
        if (!value) return;

        const id = select.dataset.id;
        if (!id) {
          select.value = "";
          return;
        }

        const row = tests.find((t) => String(t.id) === String(id));
        if (!row) {
          select.value = "";
          return;
        }

        if (value === "transcript") {
          // Transcript dialog
          showTranscript(row);
        } else if (value === "prompt") {
          // AI prompt modal
          const promptText = buildAIPromptFromRow(row);
          if (window.mssShowPrompt) {
            window.mssShowPrompt(promptText);
          } else {
            console.warn("mssShowPrompt not available; prompt:", promptText);
            alert(
              "Prompt dialog is not available. Please check the portal setup."
            );
          }
        } else if (value === "dashboard") {
          // Open DashboardViewer for this row
          openDashboardPickerForRow(row);
        }

        // Reset dropdown so user can choose again
        select.value = "";
      });
    });
  }

  // Transcript viewer – uses transcript_clean
  function showTranscript(row) {
    const text = (row && row.transcript_clean) || "";

    const backdrop = document.getElementById("portal-transcript-backdrop");
    const body = document.getElementById("portal-transcript-body");
    const title = document.getElementById("portal-transcript-title");
    const closeBtn = document.getElementById("portal-transcript-close");
    const okBtn = document.getElementById("portal-transcript-ok");

    // If no fancy markup yet, just fall back to alert
    if (!backdrop || !body) {
      alert(text || "No transcript available.");
      return;
    }

    if (title) {
      title.textContent =
        "Transcript – " +
        formatShortDateTime(row.submitted_at || row.created_at || "");
    }

    body.textContent = text || "No transcript available.";

    backdrop.classList.remove("hidden");

    const close = () => backdrop.classList.add("hidden");

    if (closeBtn && !closeBtn._mssBound) {
      closeBtn.addEventListener("click", close);
      closeBtn._mssBound = true;
    }
    if (okBtn && !okBtn._mssBound) {
      okBtn.addEventListener("click", close);
      okBtn._mssBound = true;
    }

    document.addEventListener(
      "keydown",
      function escHandler(e) {
        if (e.key === "Escape") {
          close();
          document.removeEventListener("keydown", escHandler);
        }
      },
      { once: true }
    );
  }

  /* -----------------------------------------------------------------------
     DashboardViewer integration
     --------------------------------------------------------------------- */

  // Build URL for the new DashboardViewer.html
  function buildDashboardViewerUrl(row, explicitLayout) {
    const baseLayout =
      explicitLayout && explicitLayout !== "transcript"
        ? explicitLayout
        : REPORT_VIEW_MODE && REPORT_VIEW_MODE.startsWith("dashboard")
        ? REPORT_VIEW_MODE
        : "dashboard3";

    const params = new URLSearchParams({
      slug: row.school_slug || SLUG,
      submissionId: row.id,
      layout: baseLayout, // e.g. "dashboard3"
    });

    return `/DashboardViewer.html?${params.toString()}`;
  }

  // Per-row dashboard view: ALWAYS use DashboardViewer (new tab)
  function openDashboardPickerForRow(row) {
    if (!row) return;

    const url = buildDashboardViewerUrl(row);
    console.log("🧭 Opening DashboardViewer:", url);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // Used by any future "Open report" button that respects REPORT_VIEW_MODE
  function openReportForRow(row) {
    if (!row) return;

    if (!REPORT_VIEW_MODE || REPORT_VIEW_MODE === "transcript") {
      showTranscript(row);
      return;
    }

    const url = buildDashboardViewerUrl(row, REPORT_VIEW_MODE);
    console.log("🧭 Opening DashboardViewer (global mode):", {
      REPORT_VIEW_MODE,
      url,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  }

  /* -----------------------------------------------------------------------
     API calls
     --------------------------------------------------------------------- */

  async function fetchWidgetMeta() {
    if (!SLUG) return;

    try {
      const res = await fetch(
        `/api/admin/widget/${encodeURIComponent(SLUG)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      // Merge both possible config shapes:
      //  - new:  data.config
      //  - old:  data.settings.config
      const rootCfg = data.config || {};
      const nestedCfg =
        (data.settings && data.settings.config) || {};
      const cfg = { ...nestedCfg, ...rootCfg };

      // --------- Derive widget + dashboard paths from multiple keys -----
      const rawWidget =
        cfg.widgetPath ||
        cfg.widgetUrl ||
        cfg.widget_layout ||
        cfg.widgetLayout ||
        null;

      if (rawWidget) {
        if (/^https?:\/\//i.test(rawWidget) || rawWidget.startsWith("/")) {
          widgetPath = rawWidget;
        } else {
          // assume bare filename like "WidgetMin.html"
          widgetPath = `/widgets/${rawWidget}`;
        }
      }

      const rawDash =
        cfg.dashboardPath ||
        cfg.dashboardUrl ||
        cfg.dashboard_style ||
        cfg.dashboardStyle ||
        null;

      if (rawDash) {
        if (/^https?:\/\//i.test(rawDash) || rawDash.startsWith("/")) {
          dashboardPath = rawDash;
        } else {
          // assume bare filename like "Dashboard3.html"
          dashboardPath = `/dashboards/${rawDash}`;
        }
      }

      console.log("🎛 Widget meta", {
        rawWidget,
        rawDash,
        widgetPath,
        dashboardPath,
        cfg,
        data,
      });
      // ----------------------------------------------------------------------

      // Titles / labels
      const schoolName = (data.school && data.school.name) || "School Portal";
      titleEl.textContent = schoolName;
      subtitleEl.textContent =
        cfg.subtitle ||
        cfg.title ||
        "Manage your questions, widget, dashboard, and reports.";
      slugBadgeEl.textContent = `slug: ${SLUG}`;

      // Initial view
      setActivePreviewTab("widget");
      buildEmbedSnippet();
    } catch (err) {
      console.error("Failed to fetch widget meta", err);
      subtitleEl.textContent = "Error loading widget configuration.";
    }
  }

  async function fetchAssessmentMeta() {
    if (!SLUG) return;
    if (assessmentId && ASSESSMENT_ID_FROM_URL) {
      // If user explicitly provided assessmentId, just label it simply
      assessmentLabelEl.textContent = `Assessment ID: ${assessmentId}`;
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/assessments/${encodeURIComponent(SLUG)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (data.ok === false) throw new Error(data.error || "api_error");

      assessmentId = data.assessmentId;
      assessmentName = data.assessment?.name || null;

      if (assessmentId) {
        const labelName = assessmentName || `#${assessmentId}`;
        assessmentLabelEl.textContent = `Assessment: ${labelName}`;
      } else {
        assessmentLabelEl.textContent = "Assessment: —";
      }
    } catch (err) {
      console.error("Failed to fetch assessment meta", err);
      assessmentLabelEl.textContent = "Assessment: —";
    }
  }

  async function fetchStats(range) {
    if (!SLUG) return;
    statsLoadingEl.style.display = "block";
    statsContentEl.style.display = "none";

    try {
      const url = `/api/admin/stats/${encodeURIComponent(
        SLUG
      )}?range=${encodeURIComponent(range)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      currentTimeRange = data.range || range;

      statsRangeLabelEl.textContent = `Showing ${
        currentTimeRange || range
      } (${data.from || "—"} to ${data.to || "—"})`;
      statTotalTestsEl.textContent =
        data.totalTests != null ? data.totalTests : "0";
      statTopQuestionEl.textContent = data.topQuestion?.text || "—";
      statHighestCEFR.textContent = data.highestCEFR || "—";
      statLowestCEFR.textContent = data.lowestCEFR || "—";
      statAvgCEFR.textContent = data.avgCEFR || "—";

      statsLoadingEl.style.display = "none";
      statsContentEl.style.display = "block";
    } catch (err) {
      console.error("Failed to fetch stats", err);
      statsLoadingEl.textContent = "Error fetching stats.";
      statsContentEl.style.display = "none";
    }
  }

  /* -----------------------------------------------------------------------
     Shared date-range helpers
     --------------------------------------------------------------------- */

  function parseYmd(str) {
    if (!str) return null;
    const [y, m, d] = str.split("-").map((v) => Number(v));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d); // local date, no time
  }

  function validateDateRangeFields(fromInput, toInput) {
    if (!fromInput || !toInput) return true;

    const fromVal = fromInput.value;
    const toVal = toInput.value;

    if (!fromVal || !toVal) return true;

    const fromDate = parseYmd(fromVal);
    const toDate = parseYmd(toVal);
    if (!fromDate || !toDate) return true;

    if (toDate < fromDate) {
      showWarning(
        "The end date cannot be earlier than the start date. I've adjusted it for you."
      );
      // Snap "to" back to "from"
      toInput.value = fromVal;
      return false;
    }
    return true;
  }

  function validateDateRange() {
    return validateDateRangeFields(filterFromEl, filterToEl);
  }

  function showWarning(message) {
    const backdrop = $("portal-warning-backdrop");
    const msgEl = $("portal-warning-message");
    const okBtn = $("portal-warning-ok");

    if (backdrop && msgEl && okBtn) {
      msgEl.textContent = message;
      backdrop.classList.remove("hidden");

      okBtn.onclick = () => {
        backdrop.classList.add("hidden");
      };
    } else {
      // Fallback so we still show *something* if the modal isn't in the HTML yet
      window.alert(message);
    }
  }

  /* -----------------------------------------------------------------------
     Tests table API + CSV (backed by vw_widget_reports)
     --------------------------------------------------------------------- */

  function filterRowsByDate(rows) {
    const fromVal = filterFromEl.value;
    const toVal = filterToEl.value;

    if (!fromVal && !toVal) return rows;

    const fromDate = fromVal ? parseYmd(fromVal) : null;
    const toDate = toVal ? parseYmd(toVal) : null;

    if (!fromDate && !toDate) return rows;

    return rows.filter((row) => {
      const dtRaw = row.submitted_at || row.takenAt || row.timestamp;
      if (!dtRaw) return true;
      const dt = new Date(dtRaw);
      if (Number.isNaN(dt.getTime())) return true;

      if (fromDate && dt < fromDate) return false;

      if (toDate) {
        const endOfDay = new Date(
          toDate.getFullYear(),
          toDate.getMonth(),
          toDate.getDate(),
          23,
          59,
          59,
          999
        );
        if (dt > endOfDay) return false;
      }
      return true;
    });
  }

  async function fetchTests() {
    if (!SLUG) return;

    // Front-end guard so we don't hit the server with a bad range
    if (!validateDateRange()) {
      tests = [];
      renderTestsTable();
      return;
    }

    btnRefreshTests.disabled = true;
    btnRefreshTests.innerHTML = `<span class="spinner"></span>`;

    try {
      // New reports endpoint backed by view
      const url = `/api/admin/reports/${encodeURIComponent(
        SLUG
      )}?limit=500`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const allRows =
        (Array.isArray(data.rows) && data.rows) ||
        (Array.isArray(data.tests) && data.tests) ||
        [];

      tests = filterRowsByDate(allRows);
      renderTestsTable();
    } catch (err) {
      console.error("Failed to fetch tests/reports", err);
      tests = [];
      renderTestsTable();
    } finally {
      btnRefreshTests.disabled = false;
      btnRefreshTests.textContent = "Refresh";
    }
  }

  // Client-side CSV based on tests[]
  function downloadCsv() {
    if (!SLUG) return;

    if (!validateDateRange()) {
      return;
    }

    if (!tests || !tests.length) {
      alert("No tests to export for this period.");
      return;
    }

    console.log("✅ SchoolPortal downloadCsv using local tests[]");

    const headers = [
      "id",
      "school_slug",
      "submitted_at",
      "question",
      "student_id",
      "toefl",
      "ielts",
      "pte",
      "cefr",
      "vox_score",
      "help_level",
      "help_surface",
      "widget_variant",
      "dashboard_variant",
      "mss_fluency",
      "mss_grammar",
      "mss_pron",
      "mss_vocab",
      "mss_cefr",
      "mss_toefl",
      "mss_ielts",
      "mss_pte",
      "transcript_clean",
    ];

    const lines = [];
    lines.push(toCsvRow(headers));

    for (const t of tests) {
      const row = [
        t.id,
        t.school_slug,
        t.submitted_at || t.created_at || "",
        t.question,
        t.student_id,
        t.toefl,
        t.ielts,
        t.pte,
        t.cefr,
        t.vox_score,
        t.help_level,
        t.help_surface,
        t.widget_variant,
        t.dashboard_variant,
        t.mss_fluency,
        t.mss_grammar,
        t.mss_pron,
        t.mss_vocab,
        t.mss_cefr,
        t.mss_toefl,
        t.mss_ielts,
        t.mss_pte,
        normalizeTranscriptForCsv(t.transcript_clean || ""),
      ];
      lines.push(toCsvRow(row));
    }

    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `mss-reports-${SLUG}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  function normalizeTranscriptForCsv(value) {
    if (!value) return "";

    let s = String(value);

    // Strip any stray HTML tags (defensive)
    s = s.replace(/<[^>]*>/g, "");

    // Normalise whitespace and NBSP
    s = s.replace(/\u00A0/g, " "); // NBSP → space
    s = s.replace(/\s+/g, " ").trim();

    return s;
  }

  function toCsvRow(cells) {
    return cells
      .map((val) => {
        if (val == null) return '""';
        let s = String(val);
        // normalise line breaks for CSV
        s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        s = s.replace(/"/g, '""');
        return `"${s}"`;
      })
      .join(",");
  }

  /* -----------------------------------------------------------------------
     Delete Selected (soft delete via /api/admin/reports/delete)
     --------------------------------------------------------------------- */

  function onDeleteSelected() {
    if (!tests || !tests.length) {
      showWarning("No tests to delete.");
      return;
    }

    const checked = testsTbody.querySelectorAll(".test-select:checked");
    if (!checked.length) {
      showWarning("Please select at least one row to delete.");
      return;
    }

    const ids = Array.from(checked).map((cb) => Number(cb.dataset.id));
    pendingDeleteIds = ids;

    const backdrop = document.getElementById("portal-delete-backdrop");
    const msgEl = document.getElementById("portal-delete-message");

    if (msgEl) {
      msgEl.textContent =
        ids.length === 1
          ? "Delete this submission? This cannot be undone."
          : `Delete ${ids.length} submissions? This cannot be undone.`;
    }

    if (backdrop) {
      backdrop.classList.remove("hidden");
    }
  }

  async function handleDeleteConfirm() {
    const backdrop = document.getElementById("portal-delete-backdrop");
    if (!pendingDeleteIds || !pendingDeleteIds.length) {
      if (backdrop) backdrop.classList.add("hidden");
      return;
    }

    const ids = pendingDeleteIds.slice();
    pendingDeleteIds = [];

    try {
      const res = await fetch("/api/admin/reports/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // if non-JSON, fall back to generic error
      }

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      // Remove deleted rows from local tests[] and re-render
      tests = tests.filter((t) => !ids.includes(Number(t.id)));
      renderTestsTable();
    } catch (err) {
      console.error("Failed to delete submissions:", err);
      alert("Error deleting submissions. Please try again.");
    } finally {
      if (backdrop) backdrop.classList.add("hidden");
    }
  }

  /* -----------------------------------------------------------------------
     Prompt dialog helpers
     --------------------------------------------------------------------- */

  (function () {
    const overlay = document.getElementById("mssPromptOverlay");
    const modal = document.getElementById("mssPromptModal");
    const textarea = document.getElementById("mssPromptText");
    const closeBtn = document.getElementById("mssPromptClose");
    const copyBtn = document.getElementById("mssPromptCopy");
    const statusEl = document.getElementById("mssPromptStatus");

    function openPrompt(promptText) {
      if (!overlay || !modal || !textarea) return;
      textarea.value = promptText || "";
      overlay.hidden = false;
      modal.hidden = false;
      statusEl && (statusEl.textContent = "");
      // focus + select for quick Cmd+C / Ctrl+C
      textarea.focus();
      textarea.select();
    }

    function closePrompt() {
      if (!overlay || !modal) return;
      overlay.hidden = true;
      modal.hidden = true;
    }

    async function copyPrompt() {
      if (!textarea) return;
      const text = textarea.value;
      if (!text) return;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          // Fallback
          textarea.focus();
          textarea.select();
          document.execCommand("copy");
        }
        if (statusEl) statusEl.textContent = "Prompt copied to clipboard.";
      } catch (err) {
        console.error("Copy failed:", err);
        if (statusEl)
          statusEl.textContent =
            "Unable to copy. Please select and copy manually.";
      }
    }

    // Wire events
    if (closeBtn) closeBtn.addEventListener("click", closePrompt);
    if (copyBtn) copyBtn.addEventListener("click", copyPrompt);
    if (overlay) {
      overlay.addEventListener("click", closePrompt);
    }
    document.addEventListener("keydown", (e) => {
      const modalVisible = modal && !modal.hidden;
      if (e.key === "Escape" && modalVisible) {
        closePrompt();
      }
    });

    // Expose a global entry point we can call from the Reports table
    window.mssShowPrompt = openPrompt;
  })();

  // Build AI prompt (feedback + email) for a single submission row
  function buildAIPromptFromRow(row) {
    const safe = (v, fallback = "N/A") =>
      v === null || v === undefined || v === "" ? fallback : v;

    const question = safe(row.question, "Not specified");
    const studentId = safe(row.student_id, "Unknown student");

    // Scores: use what we know is in vw_widget_reports, but allow for optional fields
    const taskScore = safe(row.task_score ?? row.task, "N/A");
    const speedWpm = safe(row.speed_wpm ?? row.speed ?? row.wpm, "N/A");

    const fluency = safe(row.mss_fluency);
    const pron = safe(row.mss_pron);
    const grammar = safe(row.mss_grammar);
    const vocab = safe(row.mss_vocab);

    const mssCefr = safe(row.mss_cefr ?? row.cefr);
    const mssToefl = safe(row.mss_toefl ?? row.toefl);
    const mssIelts = safe(row.mss_ielts ?? row.ielts);
    const mssPte = safe(row.mss_pte ?? row.pte);

    // You can tweak this “goal” sentence if you later collect explicit goals
    const defaultGoal =
      "reach a level of English that is strong enough for full-time work, admission to a college or university program, and higher scores on tests like TOEFL, IELTS, or PTE.";

    return `
Act as an experienced English tutor speaking directly to a student who has just completed a speaking task on the topic:

"${question}"

The submission belongs to: ${studentId}.

Here are this student's MSS speaking results:

- Task Score: ${taskScore} / 4
- Speed: ${speedWpm} words per minute
- Fluency: ${fluency} / 100
- Pronunciation: ${pron} / 100
- Grammar: ${grammar} / 100
- Vocabulary: ${vocab} / 100
- Overall level: CEFR ${mssCefr}
- Estimated TOEFL Speaking: ${mssToefl} / 30
- Estimated IELTS Speaking: ${mssIelts} / 9
- Estimated PTE Speaking: ${mssPte} / 100

The student's general goal is to ${defaultGoal}

Please do TWO things:

1) FEEDBACK REPORT  
Write a structured feedback report directly to the student in the second person ("you"), in English.  
Include:
- A short overall summary (2–3 sentences) of what these results mean.  
- 2–3 clear strengths.  
- 3–5 key areas for improvement, focusing especially on the lowest scores (for example pronunciation, fluency, etc.).  
- Concrete practice suggestions the student can start this week (specific exercises, how often to practice, what to pay attention to).

2) EMAIL TO THE STUDENT  
Write a separate email that a teacher at the school could send to this student.  
The email should:
- Have a short, clear subject line.  
- Greet the student politely.  
- Briefly summarize their current level using simple language (for example: "You are around CEFR ${mssCefr}, which means…").  
- Highlight why it would be helpful for them to work with a professional tutor at the school.  
- Invite them to sign up for lessons, a consultation, or a short trial, and mention that improving their English will help them reach goals like study abroad, job interviews, or passing TOEFL/IELTS/PTE.  
- End with a warm, encouraging closing.

Tone: warm, encouraging, and professional. Be honest about the work needed, but remember that as a teacher you also depend on motivated students signing up for lessons.
`.trim();
  }

  /* -----------------------------------------------------------------------
     Event wiring
     --------------------------------------------------------------------- */

  function wireEvents() {
    // Widget/Dashboard tabs
    tabWidgetEl.addEventListener("click", () =>
      setActivePreviewTab("widget")
    );
    tabDashboardEl.addEventListener("click", () =>
      setActivePreviewTab("dashboard")
    );

    // Open Question Editor (WidgetSurvey)
    btnWidgetSurvey.addEventListener("click", () => {
      let url;
      if (assessmentId) {
        url = `/questions-admin/WidgetSurvey.html?assessmentId=${encodeURIComponent(
          assessmentId
        )}`;
      } else if (ASSESSMENT_ID_FROM_URL) {
        url = `/questions-admin/WidgetSurvey.html?assessmentId=${encodeURIComponent(
          ASSESSMENT_ID_FROM_URL
        )}`;
      } else {
        // fallback – old behavior if no assessment meta
        url = `/questions-admin/WidgetSurvey.html`;
      }
      window.open(url, "_blank");
    });

    // Open Config Admin
    btnConfigAdmin.addEventListener("click", () => {
      const url = `/config-admin/ConfigAdmin.html?slug=${encodeURIComponent(
        SLUG
      )}`;
      window.open(url, "_blank");
    });

    // Copy embed
    btnCopyEmbed.addEventListener("click", copyEmbedToClipboard);

    // Timeframe toggle
    timeframeToggleEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".timeframe-btn");
      if (!btn) return;
      const range = btn.dataset.range;
      if (!range) return;

      Array.from(
        timeframeToggleEl.querySelectorAll(".timeframe-btn")
      ).forEach((b) =>
        b.classList.toggle("active", b.dataset.range === range)
      );
      fetchStats(range);
    });

    // Date filter validation
    filterFromEl.addEventListener("change", () => {
      validateDateRange();
    });

    filterToEl.addEventListener("change", () => {
      validateDateRange();
    });

    // Delete modal buttons
    const deleteBackdrop = document.getElementById("portal-delete-backdrop");
    const deleteCancelBtn = document.getElementById("portal-delete-cancel");
    const deleteConfirmBtn = document.getElementById("portal-delete-confirm");

    if (deleteCancelBtn && deleteBackdrop) {
      deleteCancelBtn.addEventListener("click", () => {
        pendingDeleteIds = [];
        deleteBackdrop.classList.add("hidden");
      });
    }

    if (deleteConfirmBtn) {
      deleteConfirmBtn.addEventListener("click", handleDeleteConfirm);
    }

    // Tests / reports
    btnRefreshTests.addEventListener("click", fetchTests);
    btnDownloadCsv.addEventListener("click", downloadCsv);
    btnDeleteSelected.addEventListener("click", onDeleteSelected);
  }

  /* -----------------------------------------------------------------------
     Init
     --------------------------------------------------------------------- */

  function initDefaultDateFilters() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const todayStr = `${yyyy}-${mm}-${dd}`;

    filterToEl.value = todayStr;

    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const yyyy2 = weekAgo.getFullYear();
    const mm2 = String(weekAgo.getMonth() + 1).padStart(2, "0");
    const dd2 = String(weekAgo.getDate()).padStart(2, "0");
    filterFromEl.value = `${yyyy2}-${mm2}-${dd2}`;
  }

  async function init() {
    wireEvents();
    initDefaultDateFilters();

    // Populate global report view dropdown from /api/list-dashboards
    await loadDashboardOptionsIntoSelect();

    // Track current selection ("transcript", "dashboard3", etc.)
    initReportViewMode();

    await fetchWidgetMeta();
    await fetchAssessmentMeta();
    await fetchStats("today");
    await fetchTests();
  }

  document.addEventListener("DOMContentLoaded", init);
})();