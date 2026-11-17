import {
  STORAGE_KEY,
  getState,
  rpc,
  normalizeDomain,
  suggestDomain,
  matchesDomain,
  intervalFromInput,
  intervalParts,
  formatInterval,
  formatRelative,
} from "./lib.js";

const els = {
  currentLoading: document.getElementById("current-loading"),
  currentError: document.getElementById("current-error"),
  currentUnsupported: document.getElementById("current-unsupported"),
  currentCovered: document.getElementById("current-covered"),
  coveredDomain: document.getElementById("covered-domain"),
  coveredRun: document.getElementById("covered-run"),
  coveredRemove: document.getElementById("covered-remove"),
  addForm: document.getElementById("add-form"),
  addDomain: document.getElementById("add-domain"),
  addInterval: document.getElementById("add-interval"),
  addUnit: document.getElementById("add-unit"),
  currentStatus: document.getElementById("current-status"),
  rulesLoading: document.getElementById("rules-loading"),
  rulesEmpty: document.getElementById("rules-empty"),
  rulesList: document.getElementById("rules-list"),
  rulesError: document.getElementById("rules-error"),
  rulesCount: document.getElementById("rules-count"),
  openOptions: document.getElementById("open-options"),
  openOptionsFooter: document.getElementById("open-options-footer"),
};

let state = null;
let currentHost = "";
let coveredRule = null;
let busy = false;
let refreshTimer = null;

void init();

async function init() {
  els.openOptions.addEventListener("click", openOptions);
  els.openOptionsFooter.addEventListener("click", openOptions);
  els.addForm.addEventListener("submit", onAdd);
  els.coveredRun.addEventListener("click", () => {
    if (coveredRule) void runRule(coveredRule.id);
  });
  els.coveredRemove.addEventListener("click", () => {
    if (coveredRule) void removeRule(coveredRule.id);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) scheduleRefresh();
  });
  await refresh();
}

function openOptions() {
  void chrome.runtime.openOptionsPage();
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, 150);
}

async function refresh() {
  try {
    state = await getState();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    currentHost = hostFromTab(tab);
    renderCurrent();
    renderRules();
    els.rulesError.hidden = true;
  } catch (err) {
    showLoadError(err);
  } finally {
    els.currentLoading.hidden = true;
    els.rulesLoading.hidden = true;
  }
}

function hostFromTab(tab) {
  try {
    const url = new URL(tab?.url || "");
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function renderCurrent() {
  const wasAddFormHidden = els.addForm.hidden;
  els.currentError.hidden = true;
  els.currentCovered.hidden = true;
  els.addForm.hidden = true;
  els.currentUnsupported.hidden = true;

  if (!currentHost) {
    els.currentUnsupported.hidden = false;
    coveredRule = null;
    return;
  }

  coveredRule =
    state.rules
      .filter((rule) => matchesDomain(currentHost, rule.domain))
      .sort((a, b) => b.domain.length - a.domain.length)[0] || null;

  if (coveredRule) {
    els.coveredDomain.textContent = coveredRule.domain;
    els.currentCovered.hidden = false;
    return;
  }

  // Only prefill when the form was hidden. This keeps whatever the user
  // typed if a background cleanup triggers a storage refresh.
  if (wasAddFormHidden) {
    els.addDomain.value = suggestDomain(currentHost);
    const parts = intervalParts(state.defaultIntervalMs);
    els.addInterval.value = String(parts.value);
    els.addUnit.value = parts.unit;
  }
  els.addForm.hidden = false;
}

function renderRules() {
  els.rulesList.replaceChildren();
  const rules = [...state.rules].sort((a, b) => a.createdAt - b.createdAt);
  els.rulesCount.textContent = rules.length ? `${rules.length} 条` : "";
  els.rulesEmpty.hidden = rules.length > 0;
  els.rulesList.hidden = rules.length === 0;

  for (const rule of rules) {
    const row = document.createElement("div");
    row.className = "rule";

    const main = document.createElement("div");
    main.className = "rule-main";

    const domain = document.createElement("div");
    domain.className = "rule-domain";
    domain.textContent = rule.domain;
    if (currentHost && matchesDomain(currentHost, rule.domain)) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "当前";
      domain.append(badge);
    }

    const meta = document.createElement("div");
    meta.className = "rule-meta";
    meta.textContent = `每 ${formatInterval(rule.intervalMs)} · 上次清理：${formatRelative(
      rule.lastRunAt,
    )} · 删除 ${rule.lastDeleted || 0} 条`;
    if (rule.lastError) {
      meta.textContent += ` · 错误：${rule.lastError}`;
      meta.classList.add("error-text");
    }

    main.append(domain, meta);

    const actions = document.createElement("div");
    actions.className = "rule-actions";

    const run = document.createElement("button");
    run.type = "button";
    run.className = "small";
    run.textContent = "清理";
    run.disabled = busy;
    run.addEventListener("click", () => void runRule(rule.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small danger";
    remove.textContent = "删除";
    remove.disabled = busy;
    remove.addEventListener("click", () => void removeRule(rule.id));

    actions.append(run, remove);
    row.append(main, actions);
    els.rulesList.append(row);
  }
}

async function onAdd(event) {
  event.preventDefault();
  if (busy) return;

  const domain = normalizeDomain(els.addDomain.value);
  if (!domain) {
    showStatus("请输入有效的域名", "error");
    return;
  }
  const intervalMs = intervalFromInput(
    els.addInterval.value,
    els.addUnit.value,
  );
  if (!intervalMs) {
    showStatus("周期必须在 1 小时到 180 天之间", "error");
    return;
  }

  setBusy(true);
  try {
    const res = await rpc("add-rule", { domain, intervalMs });
    showStatus(
      `已加入：${res.rule.domain}，每 ${formatInterval(
        res.rule.intervalMs,
      )}清理一次`,
      "ok",
    );
    await refresh();
  } catch (err) {
    showStatus(err.message || String(err), "error");
  } finally {
    setBusy(false);
  }
}

async function runRule(id) {
  if (busy) return;
  setBusy(true);
  showStatus("正在清理…", "");
  try {
    const res = await rpc("run-rule", { id });
    if (res.skipped) {
      showStatus("该规则正在清理中", "");
    } else if (res.error) {
      showStatus(
        `清理完成，删除 ${res.deleted} 条；部分失败：${res.error}`,
        "error",
      );
    } else {
      showStatus(`清理完成，删除 ${res.deleted} 条历史记录`, "ok");
    }
    await refresh();
  } catch (err) {
    showStatus(`清理失败：${err.message || err}`, "error");
  } finally {
    setBusy(false);
  }
}

async function removeRule(id) {
  if (busy) return;
  setBusy(true);
  try {
    await rpc("remove-rule", { id });
    showStatus("规则已移除", "ok");
    await refresh();
  } catch (err) {
    showStatus(err.message || String(err), "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(value) {
  busy = value;
  const submit = els.addForm.querySelector('button[type="submit"]');
  if (submit) submit.disabled = value;
  els.coveredRun.disabled = value;
  els.coveredRemove.disabled = value;
  for (const button of els.rulesList.querySelectorAll("button")) {
    button.disabled = value;
  }
}

function showStatus(message, kind) {
  els.currentStatus.textContent = message;
  els.currentStatus.className = `status ${kind || ""}`.trim();
  els.currentStatus.hidden = !message;
}

function showLoadError(err) {
  els.rulesError.textContent = `加载失败：${err.message || err}`;
  els.rulesError.hidden = false;
  els.currentLoading.hidden = true;
  els.rulesLoading.hidden = true;
}
