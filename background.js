import {
  TICK_ALARM,
  TICK_MINUTES,
  getState,
  setState,
  normalizeDomain,
  isValidDomain,
  isValidInterval,
  suggestDomain,
  matchesDomain,
  hostnameOf,
} from "./lib.js";

const MENU_ID = "add-current-site";
const ACTION_TITLE = "ForgetSite";
const running = new Set();
let badgeTimer = null;

// All state read-modify-write operations go through this chain so that a
// background cleanup cannot overwrite a rule added from the popup/options page.
let stateLock = Promise.resolve();
function withStateLock(fn) {
  const next = stateLock.then(fn, fn);
  stateLock = next.catch(() => {});
  return next;
}

function removeAllMenus() {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function searchHistory(query) {
  return new Promise((resolve, reject) => {
    chrome.history.search(query, (items) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(items || []);
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await removeAllMenus();
  chrome.contextMenus.create(
    {
      id: MENU_ID,
      title: "将当前网站加入定期清理列表",
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    },
    () => void chrome.runtime.lastError,
  );
  await ensureAlarm();
  await clearBadge();
  await runDueRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await clearBadge();
  await runDueRules();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  await runDueRules();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const result = await addRuleFromUrl(info.pageUrl || tab?.url);
  await showResultBadge(result);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "add-current-site") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const result = await addRuleFromUrl(tab?.url);
  await showResultBadge(result);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then((res) => sendResponse(res))
    .catch((err) =>
      sendResponse({ ok: false, error: String(err?.message || err) }),
    );
  return true;
});

async function ensureAlarm() {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) {
    await chrome.alarms.create(TICK_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: TICK_MINUTES,
    });
  }
}

async function clearBadge() {
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: ACTION_TITLE });
}

async function flashBadge(text, title, color) {
  if (badgeTimer) clearTimeout(badgeTimer);
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title: title || ACTION_TITLE });
  badgeTimer = setTimeout(() => {
    badgeTimer = null;
    void clearBadge();
  }, 3000);
}

async function showResultBadge(result) {
  if (result.ok) {
    if (result.existing) {
      await flashBadge(
        "=",
        `已在列表中：${result.rule.domain}`,
        "#6b7280",
      );
    } else {
      await flashBadge("✓", `已加入：${result.rule.domain}`, "#16a34a");
    }
  } else {
    await flashBadge("!", result.error || "加入失败", "#dc2626");
  }
}

function hostFromUrl(url) {
  try {
    const parsed = new URL(url || "");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function addRuleFromUrl(url) {
  const host = hostFromUrl(url);
  if (!host) {
    return { ok: false, error: "当前页面不是 http/https 页面" };
  }
  const domain = suggestDomain(host);
  const state = await getState();
  const covering = state.rules
    .filter((rule) => matchesDomain(host, rule.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
  if (covering) {
    return { ok: true, existing: true, rule: covering };
  }
  return addRule(domain, state.defaultIntervalMs);
}

function addRule(domainInput, intervalMs) {
  return withStateLock(async () => {
    const domain = normalizeDomain(domainInput);
    if (!isValidDomain(domain)) {
      return { ok: false, error: "域名格式不正确" };
    }
    if (!isValidInterval(intervalMs)) {
      return { ok: false, error: "周期必须在 1 小时到 180 天之间" };
    }
    const state = await getState();
    if (state.rules.some((rule) => rule.domain === domain)) {
      return { ok: false, error: "该域名已在列表中" };
    }
    const rule = {
      id: crypto.randomUUID(),
      domain,
      intervalMs,
      createdAt: Date.now(),
      lastRunAt: Date.now(),
      lastDeleted: 0,
      lastError: null,
    };
    state.rules.push(rule);
    await setState(state);
    return { ok: true, rule };
  });
}

function updateRule(id, domainInput, intervalMs) {
  return withStateLock(async () => {
    const domain = normalizeDomain(domainInput);
    if (!isValidDomain(domain)) {
      return { ok: false, error: "域名格式不正确" };
    }
    if (!isValidInterval(intervalMs)) {
      return { ok: false, error: "周期必须在 1 小时到 180 天之间" };
    }
    const state = await getState();
    const rule = state.rules.find((item) => item.id === id);
    if (!rule) return { ok: false, error: "规则不存在" };
    if (
      state.rules.some(
        (item) => item.id !== id && item.domain === domain,
      )
    ) {
      return { ok: false, error: "该域名已在列表中" };
    }
    rule.domain = domain;
    rule.intervalMs = intervalMs;
    await setState(state);
    return { ok: true, rule };
  });
}

function removeRule(id) {
  return withStateLock(async () => {
    const state = await getState();
    const before = state.rules.length;
    state.rules = state.rules.filter((rule) => rule.id !== id);
    if (state.rules.length === before) {
      return { ok: false, error: "规则不存在" };
    }
    await setState(state);
    return { ok: true };
  });
}

function updateSettings(defaultIntervalMs) {
  return withStateLock(async () => {
    if (!isValidInterval(defaultIntervalMs)) {
      return { ok: false, error: "默认周期必须在 1 小时到 180 天之间" };
    }
    const state = await getState();
    state.defaultIntervalMs = defaultIntervalMs;
    await setState(state);
    return { ok: true };
  });
}

async function runRuleById(id) {
  const state = await getState();
  const rule = state.rules.find((item) => item.id === id);
  if (!rule) return { ok: false, error: "规则不存在" };
  const result = await purgeRule(rule);
  return { ok: true, ...result, rule };
}

async function runAllRules() {
  const state = await getState();
  let deleted = 0;
  let failed = 0;
  for (const rule of state.rules) {
    const result = await purgeRule(rule);
    deleted += result.deleted;
    if (result.error) failed += 1;
  }
  return {
    ok: true,
    deleted,
    failed,
    total: state.rules.length,
  };
}

async function runDueRules() {
  const state = await getState();
  const now = Date.now();
  const due = state.rules.filter(
    (rule) =>
      !rule.lastRunAt || now - rule.lastRunAt >= rule.intervalMs,
  );
  for (const rule of due) {
    await purgeRule(rule);
  }
}

async function purgeRule(rule) {
  if (running.has(rule.id)) {
    return { deleted: 0, skipped: true, error: null };
  }
  running.add(rule.id);
  let deleted = 0;
  let error = null;
  try {
    // text filters in Chrome's history index; the hostname check below
    // guarantees we never delete an unrelated URL that merely contains
    // the domain in its path or query string.
    const items = await searchHistory({
      text: rule.domain,
      startTime: 0,
      maxResults: 100000,
    });
    const targets = items.filter((item) =>
      matchesDomain(hostnameOf(item.url), rule.domain),
    );
    const chunkSize = 25;
    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        chunk.map((item) => chrome.history.deleteUrl({ url: item.url })),
      );
      deleted += results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const rejected = results.find(
        (result) => result.status === "rejected",
      );
      if (rejected) {
        error = String(
          rejected.reason?.message || rejected.reason || "部分删除失败",
        );
      }
    }
  } catch (err) {
    error = String(err?.message || err);
  } finally {
    running.delete(rule.id);
    await markRuleRun(rule.id, deleted, error);
  }
  return { deleted, error };
}

function markRuleRun(id, deleted, error) {
  return withStateLock(async () => {
    const state = await getState();
    const rule = state.rules.find((item) => item.id === id);
    if (!rule) return;
    rule.lastRunAt = Date.now();
    rule.lastDeleted = deleted;
    rule.lastError = error;
    await setState(state);
  });
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") {
    return { ok: false, error: "无效请求" };
  }
  switch (msg.type) {
    case "get-state":
      return { ok: true, state: await getState() };
    case "add-rule":
      return addRule(msg.domain, msg.intervalMs);
    case "update-rule":
      return updateRule(msg.id, msg.domain, msg.intervalMs);
    case "remove-rule":
      return removeRule(msg.id);
    case "update-settings":
      return updateSettings(msg.defaultIntervalMs);
    case "run-rule":
      return runRuleById(msg.id);
    case "run-all":
      return runAllRules();
    default:
      return { ok: false, error: "未知操作" };
  }
}
