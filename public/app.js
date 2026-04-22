/* global window, document, fetch, history */

const STATUS_LABELS = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  CLOSED: "Closed",
};

const state = {
  user: null,
  repositories: [],
  activeRepoId: null,
  statusFilter: "",
  csrfToken: null,
  editingIssue: null,
};

const $ = (sel) => document.querySelector(sel);
const tpl = (id) =>
  document.getElementById(id).content.firstElementChild.cloneNode(true);

/* ---------- API helpers ---------- */

async function api(path, options = {}) {
  const opts = { credentials: "same-origin", ...options };
  opts.headers = { ...(options.headers || {}) };
  const isMutating =
    opts.method && !["GET", "HEAD", "OPTIONS"].includes(opts.method);
  if (isMutating) {
    if (!state.csrfToken) {
      const r = await fetch("/api/csrf-token", { credentials: "same-origin" });
      const j = await r.json();
      state.csrfToken = j.csrfToken;
    }
    opts.headers["X-CSRF-Token"] = state.csrfToken;
    if (opts.body && typeof opts.body !== "string") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- Toast ---------- */

let toastTimer;
function toast(message, type = "info") {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", type === "error");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3500);
}

/* ---------- Routing ---------- */

function parseRoute(pathname = window.location.pathname) {
  const m = pathname.match(/^\/issues\/(\d+)\/?$/);
  if (m) return { name: "issue", id: parseInt(m[1], 10) };
  return { name: "dashboard" };
}

function navigate(pathname) {
  if (window.location.pathname === pathname) return;
  history.pushState({}, "", pathname);
  renderRoute();
}

function renderRoute() {
  const route = parseRoute();
  if (route.name === "issue") {
    renderIssueDetail(route.id);
  } else {
    renderDashboard();
  }
}

/* ---------- Rendering ---------- */

function renderUserNav() {
  const nav = $("#user-nav");
  if (state.user) {
    nav.hidden = false;
    const avatar = $("#user-avatar");
    if (state.user.avatarUrl) {
      avatar.src = state.user.avatarUrl;
      avatar.hidden = false;
    } else {
      avatar.hidden = true;
    }
    $("#user-login").textContent = state.user.login;
  } else {
    nav.hidden = true;
  }
}

function renderDashboard() {
  const app = $("#app");
  app.replaceChildren();

  if (!state.user) {
    app.appendChild(tpl("tpl-landing"));
    return;
  }

  if (state.repositories.length === 0) {
    app.appendChild(tpl("tpl-no-repos"));
    return;
  }

  const dash = tpl("tpl-dashboard");
  app.appendChild(dash);

  renderRepoList();
  $("#status-filter").value = state.statusFilter;
  $("#status-filter").addEventListener("change", (e) => {
    state.statusFilter = e.target.value;
    loadIssues();
  });
  $("#new-issue-btn").addEventListener("click", () => openIssueModal());

  loadIssues();
}

function renderRepoList() {
  const list = $("#repo-list");
  list.replaceChildren();
  for (const repo of state.repositories) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    if (repo.id === state.activeRepoId) btn.classList.add("active");

    const name = document.createElement("div");
    name.textContent = repo.name;
    const owner = document.createElement("div");
    owner.className = "owner";
    owner.textContent = repo.owner;
    btn.appendChild(name);
    btn.appendChild(owner);

    btn.addEventListener("click", () => {
      state.activeRepoId = repo.id;
      renderRepoList();
      updateActiveRepoHeader();
      loadIssues();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  updateActiveRepoHeader();
}

function updateActiveRepoHeader() {
  const repo = state.repositories.find((r) => r.id === state.activeRepoId);
  if (!repo) return;
  $("#active-repo-name").textContent = repo.fullName;
  const meta = repo.installation
    ? `${repo.installation.accountType} · ${repo.installation.accountLogin}`
    : "";
  $("#active-repo-meta").textContent = meta;
}

function renderIssues(issues) {
  const list = $("#issue-list");
  list.replaceChildren();
  if (issues.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-issues";
    empty.textContent = state.statusFilter
      ? `No ${STATUS_LABELS[state.statusFilter].toLowerCase()} issues.`
      : "No issues yet. Click \u201cNew issue\u201d to create the first one.";
    list.appendChild(empty);
    return;
  }
  for (const issue of issues) {
    const card = tpl("tpl-issue-card");
    card.querySelector("[data-status]").dataset.status = issue.status;
    const link = card.querySelector("[data-title-link]");
    link.textContent = issue.title;
    link.href = `/issues/${issue.id}`;
    const desc = card.querySelector("[data-desc]");
    desc.textContent = issue.description || "";
    card.querySelector("[data-author]").textContent =
      `@${issue.author?.login || "unknown"}`;
    card.querySelector("[data-created]").textContent = formatDate(
      issue.createdAt,
    );
    const select = card.querySelector("[data-status-select]");
    select.value = issue.status;
    select.addEventListener("change", async (e) => {
      try {
        await api(`/api/issues/${issue.id}`, {
          method: "PATCH",
          body: { status: e.target.value },
        });
        loadIssues();
      } catch (err) {
        toast(err.message, "error");
        select.value = issue.status;
      }
    });
    card.querySelector("[data-edit]").addEventListener("click", () => {
      openIssueModal(issue);
    });
    card.querySelector("[data-delete]").addEventListener("click", async () => {
      if (!window.confirm(`Delete "${issue.title}"?`)) return;
      try {
        await api(`/api/issues/${issue.id}`, { method: "DELETE" });
        toast("Issue deleted");
        loadIssues();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    list.appendChild(card);
  }
}

async function renderIssueDetail(id) {
  const app = $("#app");
  app.replaceChildren(
    Object.assign(document.createElement("div"), {
      className: "loading",
      textContent: "Loading issue\u2026",
    }),
  );

  if (!state.user) {
    app.replaceChildren(tpl("tpl-landing"));
    return;
  }

  let issue;
  try {
    issue = await api(`/api/issues/${id}`);
  } catch (err) {
    app.replaceChildren();
    const box = document.createElement("section");
    box.className = "empty";
    const heading = document.createElement("h2");
    heading.textContent = err.status === 404 ? "Issue not found" : "Could not load issue";
    box.appendChild(heading);
    const p = document.createElement("p");
    p.textContent = err.message;
    box.appendChild(p);
    const back = document.createElement("a");
    back.href = "/";
    back.className = "btn btn-primary";
    back.textContent = "Back to issues";
    box.appendChild(back);
    app.appendChild(box);
    return;
  }

  const view = tpl("tpl-issue-detail");
  view.querySelector("[data-status]").dataset.status = issue.status;
  view.querySelector("[data-title]").textContent = issue.title;
  view.querySelector("[data-author]").textContent =
    `@${issue.author?.login || "unknown"}`;
  view.querySelector("[data-created]").textContent = formatDate(
    issue.createdAt,
  );
  const repoLink = view.querySelector("[data-repo-link]");
  repoLink.textContent = issue.repository?.fullName || "repository";
  repoLink.href = "/";
  const desc = view.querySelector("[data-desc]");
  if (issue.description) {
    desc.textContent = issue.description;
  } else {
    const em = document.createElement("em");
    em.className = "muted";
    em.textContent = "No description.";
    desc.appendChild(em);
  }

  const select = view.querySelector("[data-status-select]");
  select.value = issue.status;
  select.addEventListener("change", async (e) => {
    try {
      const updated = await api(`/api/issues/${issue.id}`, {
        method: "PATCH",
        body: { status: e.target.value },
      });
      issue.status = updated.status;
      view.querySelector("[data-status]").dataset.status = updated.status;
    } catch (err) {
      toast(err.message, "error");
      select.value = issue.status;
    }
  });

  view.querySelector("[data-edit]").addEventListener("click", () => {
    openIssueModal(issue, () => renderIssueDetail(issue.id));
  });
  view.querySelector("[data-delete]").addEventListener("click", async () => {
    if (!window.confirm(`Delete "${issue.title}"?`)) return;
    try {
      await api(`/api/issues/${issue.id}`, { method: "DELETE" });
      toast("Issue deleted");
      navigate("/");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  app.replaceChildren(view);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------- Modal ---------- */

let modalAfterSave = null;

function openIssueModal(issue = null, afterSave = null) {
  state.editingIssue = issue;
  modalAfterSave = afterSave;
  $("#modal-title").textContent = issue ? "Edit issue" : "New issue";
  $("#issue-title-input").value = issue ? issue.title : "";
  $("#issue-desc-input").value = issue ? issue.description || "" : "";
  $("#issue-status-row").hidden = !issue;
  if (issue) $("#issue-status-input").value = issue.status;
  $("#modal").hidden = false;
  setTimeout(() => $("#issue-title-input").focus(), 0);
}

function closeIssueModal() {
  $("#modal").hidden = true;
  state.editingIssue = null;
  modalAfterSave = null;
}

async function submitIssueForm(e) {
  e.preventDefault();
  const title = $("#issue-title-input").value.trim();
  const description = $("#issue-desc-input").value;
  if (!title) {
    toast("Title is required", "error");
    return;
  }
  const saveBtn = $("#save-btn");
  saveBtn.disabled = true;
  try {
    if (state.editingIssue) {
      await api(`/api/issues/${state.editingIssue.id}`, {
        method: "PATCH",
        body: {
          title,
          description: description || null,
          status: $("#issue-status-input").value,
        },
      });
      toast("Issue updated");
    } else {
      await api("/api/issues", {
        method: "POST",
        body: {
          title,
          description: description || null,
          repositoryId: state.activeRepoId,
        },
      });
      toast("Issue created");
    }
    const after = modalAfterSave;
    closeIssueModal();
    if (after) {
      after();
    } else {
      loadIssues();
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    saveBtn.disabled = false;
  }
}

/* ---------- Data loading ---------- */

async function loadIssues() {
  const list = $("#issue-list");
  if (!list) return;
  list.replaceChildren(
    Object.assign(document.createElement("li"), {
      className: "empty-issues",
      textContent: "Loading issues\u2026",
    }),
  );
  const params = new URLSearchParams();
  if (state.activeRepoId) params.set("repositoryId", String(state.activeRepoId));
  if (state.statusFilter) params.set("status", state.statusFilter);
  try {
    const issues = await api(`/api/issues?${params.toString()}`);
    renderIssues(issues);
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---------- Boot ---------- */

async function boot() {
  // Try to load current user
  try {
    state.user = await api("/api/me");
  } catch (err) {
    if (err.status !== 401) toast(err.message, "error");
    state.user = null;
  }

  if (state.user) {
    try {
      state.repositories = await api("/api/repositories");
      if (state.repositories.length > 0) {
        state.activeRepoId = state.repositories[0].id;
      }
    } catch (err) {
      toast(err.message, "error");
    }
  }

  renderUserNav();
  renderRoute();
}

/* ---------- Wire static handlers ---------- */

document.addEventListener("DOMContentLoaded", () => {
  $("#logout-btn").addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
      window.location.assign("/");
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("#modal-close").addEventListener("click", closeIssueModal);
  $("#cancel-btn").addEventListener("click", closeIssueModal);
  $("#modal").addEventListener("click", (e) => {
    if (e.target === $("#modal")) closeIssueModal();
  });
  $("#issue-form").addEventListener("submit", submitIssueForm);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#modal").hidden) closeIssueModal();
  });

  // Intercept clicks on internal links so we can use client-side routing
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    if (a.target && a.target !== "" && a.target !== "_self") return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("//")) return;
    // Only intercept routes the SPA owns
    if (href === "/" || /^\/issues\/\d+\/?$/.test(href)) {
      e.preventDefault();
      navigate(href);
    }
  });

  window.addEventListener("popstate", renderRoute);

  boot();
});
