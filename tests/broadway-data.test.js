"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function helper(fetch = async () => ({ ok: true })) {
  const context = { window: { fetch } };
  vm.runInNewContext(fs.readFileSync("broadway-data.js", "utf8"), context);
  const messages = [];
  context.window.BroadwayData.status = (message, error) => messages.push({ message, error });
  return { data: context.window.BroadwayData, messages };
}

test("fresh, overdue, future and unknown gross dates are visible", () => {
  const { data, messages } = helper();
  const now = new Date("2026-10-06T20:00:00Z");
  data.freshness({ latestWeek: "2026-10-04" }, now);
  assert.equal(messages.at(-1).error, false);
  assert.match(messages.at(-1).message, /not profit/);
  data.freshness({ latestWeek: "2026-08-23" }, now);
  assert.equal(messages.at(-1).error, true);
  assert.match(messages.at(-1).message, /overdue/);
  data.freshness({ latestWeek: "2026-10-18" }, now);
  assert.equal(messages.at(-1).error, true);
  data.freshness({}, now);
  assert.match(messages.at(-1).message, /unavailable/);
});

test("data requests bypass cache and reject HTTP failures", async () => {
  let options;
  const { data } = helper(async (url, input) => {
    options = input;
    return { ok: false, status: 503 };
  });
  await assert.rejects(data.fetch("gross.json"), /503/);
  assert.equal(options.cache, "no-store");
});

test("loading errors have user-facing details", () => {
  const { data, messages } = helper();
  data.error(new Error("Missing file"));
  assert.equal(messages[0].error, true);
  assert.match(messages[0].message, /Missing file/);
});

test("status is inserted once and error styling resets on recovery", () => {
  const elements = [];
  const classes = new Map();
  const main = { prepend: (element) => elements.unshift(element) };
  const document = {
    querySelector: (selector) => selector === "main" ? main : elements[0],
    createElement: () => ({
      setAttribute(name, value) { this[name] = value; },
      classList: { toggle: (name, enabled) => classes.set(name, enabled) }
    })
  };
  const context = { window: {}, document };
  vm.runInNewContext(fs.readFileSync("broadway-data.js", "utf8"), context);
  const data = context.window.BroadwayData;
  data.error(new Error("503"));
  assert.equal(elements.length, 1);
  assert.equal(elements[0].role, "status");
  assert.equal(classes.get("is-error"), true);
  data.freshness({ latestWeek: "2026-10-04" }, new Date("2026-10-06T00:00:00Z"));
  assert.equal(elements.length, 1);
  assert.equal(classes.get("is-error"), false);
  assert.match(elements[0].textContent, /2026-10-04/);
});

test("all five consumers load the helper before accessing gross data", () => {
  for (const [html, script] of [
    ["index.html", "dashboard.js"], ["history.html", "history-dashboard.js"],
    ["theatres.html", "theatres-dashboard.js"], ["tony-awards.html", "tony-dashboard.js"],
    ["game.html", "game.js"]
  ]) {
    const markup = fs.readFileSync(html, "utf8");
    const helperIndex = markup.indexOf('src="broadway-data.js"');
    const consumerIndex = markup.indexOf(`src="${script}?`);
    assert.ok(helperIndex >= 0 && consumerIndex > helperIndex);
    const code = fs.readFileSync(script, "utf8");
    assert.match(code, /BroadwayData\.fetch/);
    assert.match(code, /BroadwayData\.freshness/);
    assert.match(code, /BroadwayData\.error/);
  }
});
