export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const MIN_INTERVAL = HOUR;
export const MAX_INTERVAL = 180 * DAY;
export const DEFAULT_INTERVAL = 24 * HOUR;

export const STORAGE_KEY = "purgeState";
export const TICK_ALARM = "purge-tick";
export const TICK_MINUTES = 5;

export function defaultState() {
  return { rules: [], defaultIntervalMs: DEFAULT_INTERVAL };
}

export function isValidInterval(ms) {
  return Number.isFinite(ms) && ms >= MIN_INTERVAL && ms <= MAX_INTERVAL;
}

export function normalizeDomain(input) {
  if (typeof input !== "string") return "";
  const raw = input.trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

export function isValidDomain(domain) {
  if (!domain || domain.length > 253) return false;
  if (domain.startsWith("[")) {
    return /^\[[0-9a-f:.]+\]$/i.test(domain);
  }
  if (domain.includes("..") || domain.startsWith(".") || domain.endsWith(".")) {
    return false;
  }
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(
    domain,
  );
}

const COMMON_SUBDOMAINS = new Set(["www", "m", "mobile", "amp", "wap"]);

export function suggestDomain(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/\.$/, "");
  const parts = host.split(".");
  if (parts.length >= 3 && COMMON_SUBDOMAINS.has(parts[0])) {
    return parts.slice(1).join(".");
  }
  return host;
}

export function matchesDomain(hostname, ruleDomain) {
  if (!hostname || !ruleDomain) return false;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const domain = ruleDomain.toLowerCase().replace(/\.$/, "");
  return host === domain || host.endsWith(`.${domain}`);
}

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function intervalFromInput(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  const ms = unit === "d" ? n * DAY : n * HOUR;
  return isValidInterval(ms) ? ms : null;
}

export function intervalParts(ms) {
  if (Number.isFinite(ms) && ms % DAY === 0) {
    return { value: ms / DAY, unit: "d" };
  }
  return { value: Math.max(1, Math.round(ms / HOUR)), unit: "h" };
}

export function formatInterval(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms % DAY === 0) return `${ms / DAY} 天`;
  if (ms % HOUR === 0) return `${ms / HOUR} 小时`;
  return `${Math.round(ms / HOUR)} 小时`;
}

export function formatRelative(ts) {
  if (!ts) return "从未";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < HOUR) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function formatDateTime(ts) {
  if (!ts) return "从未";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function sanitizeRule(rule) {
  if (!rule || typeof rule !== "object") return null;
  if (typeof rule.id !== "string" || rule.id.length === 0) return null;
  if (typeof rule.domain !== "string" || !isValidDomain(rule.domain)) {
    return null;
  }
  if (!isValidInterval(rule.intervalMs)) return null;
  return {
    id: rule.id,
    domain: rule.domain,
    intervalMs: rule.intervalMs,
    createdAt: Number.isFinite(rule.createdAt) ? rule.createdAt : Date.now(),
    lastRunAt: Number.isFinite(rule.lastRunAt) ? rule.lastRunAt : null,
    lastDeleted: Number.isFinite(rule.lastDeleted) ? rule.lastDeleted : 0,
    lastError: typeof rule.lastError === "string" ? rule.lastError : null,
  };
}

export async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const raw = data[STORAGE_KEY];
  if (!raw || typeof raw !== "object") return defaultState();
  return {
    rules: Array.isArray(raw.rules)
      ? raw.rules.map(sanitizeRule).filter(Boolean)
      : [],
    defaultIntervalMs: isValidInterval(raw.defaultIntervalMs)
      ? raw.defaultIntervalMs
      : DEFAULT_INTERVAL,
  };
}

export async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function rpc(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res || !res.ok) {
    throw new Error(res?.error || "操作失败");
  }
  return res;
}
