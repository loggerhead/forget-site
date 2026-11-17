import test from "node:test";
import assert from "node:assert/strict";

import {
  HOUR,
  DAY,
  MIN_INTERVAL,
  MAX_INTERVAL,
  normalizeDomain,
  isValidDomain,
  suggestDomain,
  matchesDomain,
  intervalFromInput,
  intervalParts,
  formatInterval,
  isValidInterval,
} from "../lib.js";

test("normalizeDomain strips scheme, path, port and trailing dot", () => {
  assert.equal(
    normalizeDomain("https://www.Example.com/path?q=1"),
    "www.example.com",
  );
  assert.equal(normalizeDomain("example.com:8080/x"), "example.com");
  assert.equal(normalizeDomain("  example.com.  "), "example.com");
  assert.equal(normalizeDomain("http://[::1]:8080/"), "[::1]");
  assert.equal(normalizeDomain("chrome://history"), "");
  assert.equal(normalizeDomain("ftp://example.com"), "");
  assert.equal(normalizeDomain(""), "");
});

test("isValidDomain accepts normal hostnames and rejects malformed ones", () => {
  assert.equal(isValidDomain("example.com"), true);
  assert.equal(isValidDomain("sub.example.co.uk"), true);
  assert.equal(isValidDomain("localhost"), true);
  assert.equal(isValidDomain("[::1]"), true);
  assert.equal(isValidDomain("bad domain.com"), false);
  assert.equal(isValidDomain("bad_domain.com"), false);
  assert.equal(isValidDomain("-bad.com"), false);
  assert.equal(isValidDomain("bad-.com"), false);
  assert.equal(isValidDomain("bad..com"), false);
});

test("suggestDomain strips common subdomain prefixes", () => {
  assert.equal(suggestDomain("www.example.com"), "example.com");
  assert.equal(suggestDomain("m.example.com"), "example.com");
  assert.equal(suggestDomain("mobile.example.com"), "example.com");
  assert.equal(suggestDomain("www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(suggestDomain("a.b.example.com"), "a.b.example.com");
  assert.equal(suggestDomain("example.com"), "example.com");
});

test("matchesDomain matches exact hosts and subdomains only", () => {
  assert.equal(matchesDomain("example.com", "example.com"), true);
  assert.equal(matchesDomain("www.example.com", "example.com"), true);
  assert.equal(matchesDomain("a.b.example.com", "example.com"), true);
  assert.equal(matchesDomain("notexample.com", "example.com"), false);
  assert.equal(matchesDomain("example.com.evil.com", "example.com"), false);
  assert.equal(matchesDomain("www.example.com", "www.example.com"), true);
  assert.equal(matchesDomain("example.com", "www.example.com"), false);
});

test("intervalFromInput enforces 1 hour to 180 days", () => {
  assert.equal(intervalFromInput(1, "h"), HOUR);
  assert.equal(intervalFromInput(24, "h"), DAY);
  assert.equal(intervalFromInput(180, "d"), MAX_INTERVAL);
  assert.equal(intervalFromInput(4320, "h"), MAX_INTERVAL);
  assert.equal(intervalFromInput(0, "h"), null);
  assert.equal(intervalFromInput(181, "d"), null);
  assert.equal(intervalFromInput(4321, "h"), null);
  assert.equal(intervalFromInput(1.5, "h"), null);
});

test("isValidInterval checks the inclusive range", () => {
  assert.equal(isValidInterval(MIN_INTERVAL), true);
  assert.equal(isValidInterval(MAX_INTERVAL), true);
  assert.equal(isValidInterval(MIN_INTERVAL - 1), false);
  assert.equal(isValidInterval(MAX_INTERVAL + 1), false);
  assert.equal(isValidInterval(Number.NaN), false);
});

test("intervalParts and formatInterval render sensible units", () => {
  assert.deepEqual(intervalParts(24 * HOUR), { value: 1, unit: "d" });
  assert.deepEqual(intervalParts(2 * DAY), { value: 2, unit: "d" });
  assert.deepEqual(intervalParts(36 * HOUR), { value: 36, unit: "h" });
  assert.equal(formatInterval(24 * HOUR), "1 天");
  assert.equal(formatInterval(6 * HOUR), "6 小时");
  assert.equal(formatInterval(36 * HOUR), "36 小时");
  assert.equal(formatInterval(180 * DAY), "180 天");
});
