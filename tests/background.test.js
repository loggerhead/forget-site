import test from "node:test";
import assert from "node:assert/strict";

import { HOUR, DAY, MAX_INTERVAL } from "../lib.js";

function makeChromeMock() {
  const store = new Map();
  const listeners = {
    installed: [],
    startup: [],
    alarm: [],
    message: [],
    command: [],
    menu: [],
  };
  const deleted = [];
  const menus = [];
  const badge = { text: "", title: "" };
  let alarm = null;
  let historyItems = [];
  let activeTab = { id: 1, url: "https://www.example.com/page" };

  const chrome = {
    runtime: {
      lastError: undefined,
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    contextMenus: {
      removeAll: (cb) => {
        menus.length = 0;
        cb?.();
      },
      create: (item, cb) => {
        menus.push(item);
        cb?.();
      },
      onClicked: { addListener: (fn) => listeners.menu.push(fn) },
    },
    alarms: {
      get: async (name) =>
        alarm && alarm.name === name ? alarm : undefined,
      create: async (name, info) => {
        alarm = { name, ...info };
      },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    commands: {
      onCommand: { addListener: (fn) => listeners.command.push(fn) },
    },
    tabs: {
      query: async () => [activeTab],
    },
    action: {
      setBadgeText: async ({ text }) => {
        badge.text = text;
      },
      setTitle: async ({ title }) => {
        badge.title = title;
      },
      setBadgeBackgroundColor: async () => {},
    },
    history: {
      search: (_query, cb) => cb(historyItems),
      deleteUrl: ({ url }, cb) => {
        deleted.push(url);
        historyItems = historyItems.filter((item) => item.url !== url);
        cb?.();
      },
    },
    storage: {
      local: {
        get: async (key) =>
          store.has(key) ? { [key]: store.get(key) } : {},
        set: async (obj) => {
          for (const [key, value] of Object.entries(obj)) {
            store.set(key, value);
          }
        },
      },
    },
  };

  return {
    chrome,
    listeners,
    deleted,
    menus,
    badge,
    getAlarm: () => alarm,
    getHistory: () => historyItems,
    setHistory: (items) => {
      historyItems = items;
    },
    setActiveTab: (url) => {
      activeTab = { id: 1, url };
    },
  };
}

function sendMessage(mock, msg) {
  return new Promise((resolve) => {
    const listener = mock.listeners.message[0];
    const returned = listener(msg, {}, resolve);
    assert.equal(returned, true);
  });
}

test("service worker: install, cleanup, CRUD, commands and context menu", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const mock = makeChromeMock();
  globalThis.chrome = mock.chrome;

  const moduleUrl = new URL("../background.js", import.meta.url);
  moduleUrl.searchParams.set("test", String(Date.now()));
  await import(moduleUrl.href);

  await mock.listeners.installed[0]();
  assert.equal(mock.menus.length, 1);
  assert.equal(mock.menus[0].id, "add-current-site");
  assert.equal(mock.getAlarm().name, "purge-tick");
  assert.equal(mock.badge.text, "");

  await mock.chrome.storage.local.set({
    purgeState: {
      rules: [
        {
          id: "r1",
          domain: "example.com",
          intervalMs: HOUR,
          createdAt: Date.now(),
          lastRunAt: null,
          lastDeleted: 0,
          lastError: null,
        },
      ],
      defaultIntervalMs: DAY,
    },
  });

  mock.setHistory([
    { url: "https://example.com/a" },
    { url: "https://www.example.com/b" },
    { url: "https://notexample.com/c" },
    { url: "https://example.com.evil.com/d" },
    { url: "https://other.com/?q=example.com" },
  ]);

  await mock.listeners.alarm[0]({ name: "purge-tick" });
  assert.deepEqual(mock.deleted.sort(), [
    "https://example.com/a",
    "https://www.example.com/b",
  ]);
  assert.equal(mock.getHistory().length, 3);

  let saved = (await mock.chrome.storage.local.get("purgeState")).purgeState;
  assert.equal(saved.rules[0].lastDeleted, 2);
  assert.equal(saved.rules[0].lastError, null);
  assert.equal(typeof saved.rules[0].lastRunAt, "number");

  const add = await sendMessage(mock, {
    type: "add-rule",
    domain: "https://www.example.org/path",
    intervalMs: 2 * HOUR,
  });
  assert.equal(add.ok, true);
  assert.equal(add.rule.domain, "www.example.org");
  assert.equal(add.rule.intervalMs, 2 * HOUR);

  const duplicate = await sendMessage(mock, {
    type: "add-rule",
    domain: "www.example.org",
    intervalMs: HOUR,
  });
  assert.equal(duplicate.ok, false);

  const invalid = await sendMessage(mock, {
    type: "add-rule",
    domain: "bad.example",
    intervalMs: 1000,
  });
  assert.equal(invalid.ok, false);

  const update = await sendMessage(mock, {
    type: "update-rule",
    id: add.rule.id,
    domain: "example.org",
    intervalMs: MAX_INTERVAL,
  });
  assert.equal(update.ok, true);
  assert.equal(update.rule.domain, "example.org");
  assert.equal(update.rule.intervalMs, MAX_INTERVAL);

  const settings = await sendMessage(mock, {
    type: "update-settings",
    defaultIntervalMs: 6 * HOUR,
  });
  assert.equal(settings.ok, true);
  saved = (await mock.chrome.storage.local.get("purgeState")).purgeState;
  assert.equal(saved.defaultIntervalMs, 6 * HOUR);

  mock.setHistory([
    { url: "https://example.org/x" },
    { url: "https://sub.example.org/y" },
    { url: "https://example.net/z" },
  ]);
  const runAll = await sendMessage(mock, { type: "run-all" });
  assert.equal(runAll.ok, true);
  assert.equal(runAll.deleted, 2);
  assert.equal(runAll.failed, 0);
  assert.equal(mock.getHistory().length, 1);

  mock.setActiveTab("https://www.example.net/article");
  await mock.listeners.command[0]("add-current-site");
  assert.equal(mock.badge.text, "✓");
  saved = (await mock.chrome.storage.local.get("purgeState")).purgeState;
  assert.ok(saved.rules.some((rule) => rule.domain === "example.net"));

  await mock.listeners.menu[0](
    {
      menuItemId: "add-current-site",
      pageUrl: "https://blog.example.net/post",
    },
    {},
  );
  assert.equal(mock.badge.text, "=");

  t.mock.timers.tick(3000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mock.badge.text, "");

  const removed = await sendMessage(mock, {
    type: "remove-rule",
    id: add.rule.id,
  });
  assert.equal(removed.ok, true);
  saved = (await mock.chrome.storage.local.get("purgeState")).purgeState;
  assert.ok(!saved.rules.some((rule) => rule.id === add.rule.id));
});
