import {
  STORAGE_KEY,
  getState,
  rpc,
  normalizeDomain,
  intervalFromInput,
  intervalParts,
  formatInterval,
  formatRelative,
} from "./lib.js";

const els = {
  runAll: document.getElementById("run-all"),
  addForm: document.getElementById("add-form"),
  addDomain: document.getElementById("add-domain"),
  addInterval: document.getElementById("add-interval"),
  addUnit: document.getElementById("add-unit"),
  addStatus: document.getElementById("add-status"),
  rulesLoading: document.getElementById("rules-loading"),
  rulesEmpty: document.getElementById("rules-empty"),
  rulesError: document.getElementById("rules-error"),
  rulesList: document.getElementById("rules-list"),
  rulesStatus: document.getElementById("rules-status"),
  rulesCount: document.getElementById("rules-count"),
  defaultForm: document.getElementById("default-form"),
  defaultInterval: document.getElementById("default-interval"),
  defaultUnit: document.getElementById("default-unit"),
  defaultStatus: document.getElementById("default-status"),
};

let state = null;
let busy = false;
let addFormInitialized = false;
let defaultInitialized = false;
let refreshTimer = null;

void init();

async function init() {
  els.addForm.addEventListener("submit", onAdd);
  els.defaultForm.addEventListener("submit", onSaveDefault);
  els.runAll.addEventListener("click", () => void onRunAll());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    if (isEditingRule()) return;
    scheduleRefresh();
  });
  await refresh();
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, 150);
}

function isEditingRule() {
  const el = document.activeElement;
  return Boolean(
    el &&
      (el.tagName === "INPUT" || el.tagName === "SELECT") &&
      els.rulesList.contains(el),
  );
}

async function refresh() {
  try {
    state = await getState();
    renderAddDefaults();
    renderDefault();
    renderRules();
    els.rulesError.hidden = true;
  } catch (err) {
    showLoadError(err);
  } finally {
    els.rulesLoading.hidden = true;
  }
}

function renderAddDefaults() {
  if (addFormInitialized) return;
  const parts = intervalParts(state.defaultIntervalMs);
  els.addInterval.value = String(parts.value);
  els.addUnit.value = parts.unit;
  addFormInitialized = true;
}

function renderDefault() {
  if (defaultInitialized) return;
  const parts = intervalParts(state.defaultIntervalMs);
  els.defaultInterval.value = String(parts.value);
  els.defaultUnit.value = parts.unit;
  defaultInitialized = true;
}

function renderRules() {
  els.rulesList.replaceChildren();
  const rules = [...state.rules].sort((a, b) => a.createdAt - b.createdAt);
  els.rulesCount.textContent = rules.length ? `${rules.length} 条` : "";
  els.rulesEmpty.hidden = rules.length > 0;

  for (const rule of rules) {
    const row = document.createElement("div");
    row.className = "rule";
    row.dataset.id = rule.id;

    const domainField = document.createElement("label");
    domainField.className = "field";
    const domainLabel = document.createElement("span");
    domainLabel.textContent = "域名";
    const domainInput = document.createElement("input");
    domainInput.type = "text";
    domainInput.value = rule.domain;
    domainInput.autocomplete = "off";
    domainInput.spellcheck = false;
    domainField.append(domainLabel, domainInput);

    const intervalField = document.createElement("label");
    intervalField.className = "field";
    const intervalLabel = document.createElement("span");
    intervalLabel.textContent = "周期";
    const intervalWrap = document.createElement("div");
    intervalWrap.className = "interval-input";
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.min = "1";
    intervalInput.step = "1";
    const parts = intervalParts(rule.intervalMs);
    intervalInput.value = String(parts.value);
    const unitSelect = document.createElement("select");
    unitSelect.append(option("h", "小时"), option("d", "天"));
    unitSelect.value = parts.unit;
    intervalWrap.append(intervalInput, unitSelect);
    intervalField.append(intervalLabel, intervalWrap);

    const meta = document.createElement("div");
    meta.className = "rule-meta";
    const line1 = document.createElement("div");
    line1.textContent = `每 ${formatInterval(rule.intervalMs)}清理`;
    const line2 = document.createElement("div");
    line2.textContent = `上次：${formatRelative(rule.lastRunAt)} · 删除 ${
      rule.lastDeleted || 0
    } 条`;
    if (rule.lastError) {
      line2.textContent += ` · 错误：${rule.lastError}`;
      line2.classList.add("error-text");
    }
    meta.append(line1, line2);

    const actions = document.createElement("div");
    actions.className = "rule-actions";
    const save = makeButton("保存", "secondary small", () => {
      void saveRule(rule.id, domainInput, intervalInput, unitSelect);
    });
    const run = makeButton("清理", "small", () => {
      void runRule(rule.id);
    });
    const remove = makeButton("删除", "danger small", () => {
      void deleteRule(rule.id);
    });
    actions.append(save, run, remove);

    row.append(domainField, intervalField, meta, actions);
    els.rulesList.append(row);
  }
}

function option(value, text) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = text;
  return el;
}

function makeButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.disabled = busy;
  button.addEventListener("click", handler);
  return button;
}

async function onAdd(event) {
  event.preventDefault();
  if (busy) return;

  const domain = normalizeDomain(els.addDomain.value);
  if (!domain) {
    showStatus(els.addStatus, "请输入有效的域名", "error");
    return;
  }
  const intervalMs = intervalFromInput(
    els.addInterval.value,
    els.addUnit.value,
  );
  if (!intervalMs) {
    showStatus(els.addStatus, "周期必须在 1 小时到 180 天之间", "error");
    return;
  }

  setBusy(true);
  try {
    const res = await rpc("add-rule", { domain, intervalMs });
    showStatus(
      els.addStatus,
      `已添加：${res.rule.domain}，每 ${formatInterval(
        res.rule.intervalMs,
      )}清理一次`,
      "ok",
    );
    els.addDomain.value = "";
    await refresh();
  } catch (err) {
    showStatus(els.addStatus, err.message || String(err), "error");
  } finally {
    setBusy(false);
  }
}

async function saveRule(id, domainInput, intervalInput, unitSelect) {
  if (busy) return;
  const domain = normalizeDomain(domainInput.value);
  if (!domain) {
    showStatus(els.rulesStatus, "域名格式不正确", "error");
    return;
  }
  const intervalMs = intervalFromInput(
    intervalInput.value,
    unitSelect.value,
  );
  if (!intervalMs) {
    showStatus(els.rulesStatus, "周期必须在 1 小时到 180 天之间", "error");
    return;
  }

  setBusy(true);
  try {
    await rpc("update-rule", { id, domain, intervalMs });
    showStatus(els.rulesStatus, "规则已保存", "ok");
    await refresh();
  } catch (err) {
    showStatus(els.rulesStatus, err.message || String(err), "error");
  } finally {
    setBusy(false);
  }
}

async function runRule(id) {
  if (busy) return;
  setBusy(true);
  showStatus(els.rulesStatus, "正在清理…", "");
  try {
    const res = await rpc("run-rule", { id });
    if (res.skipped) {
      showStatus(els.rulesStatus, "该规则正在清理中", "");
    } else if (res.error) {
      showStatus(
        els.rulesStatus,
        `清理完成，删除 ${res.deleted} 条；部分失败：${res.error}`,
        "error",
      );
    } else {
      showStatus(
        els.rulesStatus,
        `清理完成，删除 ${res.deleted} 条历史记录`,
        "ok",
      );
    }
    await refresh();
  } catch (err) {
    showStatus(els.rulesStatus, `清理失败：${err.message || err}`, "error");
  } finally {
    setBusy(false);
  }
}

async function deleteRule(id) {
  if (busy) return;
  if (!confirm("确定删除这条规则？不会删除已有历史记录。")) return;
  setBusy(true);
  try {
    await rpc("remove-rule", { id });
    showStatus(els.rulesStatus, "规则已删除", "ok");
    await refresh();
  } catch (err) {
    showStatus(els.rulesStatus, err.message || String(err), "error");
  } finally {
    setBusy(false);
  }
}

async function onRunAll() {
  if (busy || !state) return;
  if (state.rules.length === 0) {
    showStatus(els.rulesStatus, "还没有规则", "error");
    return;
  }
  if (!confirm(`立即清理全部 ${state.rules.length} 条规则？`)) return;

  setBusy(true);
  showStatus(els.rulesStatus, "正在清理…", "");
  try {
    const res = await rpc("run-all");
    const suffix = res.failed ? `，${res.failed} 条规则失败` : "";
    showStatus(
      els.rulesStatus,
      `清理完成：共删除 ${res.deleted} 条历史记录${suffix}`,
      res.failed ? "error" : "ok",
    );
    await refresh();
  } catch (err) {
    showStatus(els.rulesStatus, `清理失败：${err.message || err}`, "error");
  } finally {
    setBusy(false);
  }
}

async function onSaveDefault(event) {
  event.preventDefault();
  if (busy) return;
  const intervalMs = intervalFromInput(
    els.defaultInterval.value,
    els.defaultUnit.value,
  );
  if (!intervalMs) {
    showStatus(els.defaultStatus, "周期必须在 1 小时到 180 天之间", "error");
    return;
  }

  setBusy(true);
  try {
    await rpc("update-settings", { defaultIntervalMs: intervalMs });
    showStatus(els.defaultStatus, "默认周期已保存", "ok");
    addFormInitialized = false;
    defaultInitialized = false;
    await refresh();
  } catch (err) {
    showStatus(els.defaultStatus, err.message || String(err), "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(value) {
  busy = value;
  els.runAll.disabled = value;
  const addSubmit = els.addForm.querySelector('button[type="submit"]');
  const defaultSubmit = els.defaultForm.querySelector('button[type="submit"]');
  if (addSubmit) addSubmit.disabled = value;
  if (defaultSubmit) defaultSubmit.disabled = value;
  for (const button of els.rulesList.querySelectorAll("button")) {
    button.disabled = value;
  }
}

function showStatus(el, message, kind) {
  el.textContent = message;
  el.className = `status ${kind || ""}`.trim();
  el.hidden = !message;
}

function showLoadError(err) {
  els.rulesError.textContent = `加载失败：${err.message || err}`;
  els.rulesError.hidden = false;
  els.rulesLoading.hidden = true;
}
