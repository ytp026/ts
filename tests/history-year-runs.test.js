"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const context = { window: {} };
vm.runInNewContext(fs.readFileSync("dashboard-utils.js", "utf8"), context);
const format = context.window.DashboardUtils.formatYearRuns;
const dashboard = fs.readFileSync("history-dashboard.js", "utf8");
const aggregateSource = dashboard.match(
  /function aggregateHistoryRunningWeeks\(rows\) \{[\s\S]*?(?=\nfunction aggregateHistoryRuns)/
)[0];
vm.runInNewContext(aggregateSource, context);
const aggregate = (rows) => JSON.parse(JSON.stringify(context.aggregateHistoryRunningWeeks(rows)));

test("continuous years form one range and singletons remain individual years", () => {
  assert.equal(format([1988, 1989, 1990, 1991]), "1988\u20131991");
  assert.equal(format([2023]), "2023");
  assert.equal(format([]), "");
});

test("multiple gaps are separated without inferring missing years", () => {
  assert.equal(format([1988, 1989, 1990, 1993, 1995, 1996, 2023]),
    "1988\u20131990, 1993, 1995\u20131996, 2023");
});

test("duplicate and unsorted years yield the same chronological runs", () => {
  assert.equal(format([2023, 1989, 1988, 2023, 1989, 2021, 2020]),
    "1988\u20131989, 2020\u20132021, 2023");
});

test("year coverage and week counts come from the same filtered weekly records", () => {
  const rows = [
    { show: "Show", date: "2019-12-29" },
    { show: "Show", date: "2020-01-05" },
    { show: "Show", date: "2020-01-05" },
    { show: "Show", date: "2022-01-02" },
    { show: "Other", date: "2021-01-03" }
  ];
  const full = aggregate(rows).find((row) => row.show === "Show");
  assert.equal(full.runPeriods, "2019\u20132020, 2022");
  assert.equal(full.runDates, "2019-12-29\u20132020-01-05, 2022-01-02");
  assert.equal(full.weeks, 3);
  const filtered = aggregate(rows.filter((row) => row.date.startsWith("2022")));
  assert.equal(filtered[0].runPeriods, "2022");
  assert.equal(filtered[0].weeks, 1);
  assert.deepEqual(aggregate([]), []);
});

test("every longevity subtitle and row tooltip uses the plotted reporting segments", () => {
  const render = dashboard.match(
    /function renderHistoryLongevity\(rows, selectShow\) \{[\s\S]*?(?=\nfunction renderHistoryRunStairs)/
  )[0];
  assert.match(render, /button\.title = `\$\{row\.show\}: reported periods \$\{row\.runDates\}/);
  assert.match(render, /createElement\("small", `\$\{row\.runPeriods\}/);
  assert.doesNotMatch(render, /row\.start\.slice|row\.end\.slice/);
});

test("real Phantom shutdown gap stays separate despite observations in both endpoint years", () => {
  const rows = JSON.parse(fs.readFileSync("history-dashboard-data.json", "utf8")).rows
    .filter(([, , show]) => show === "The Phantom of the Opera")
    .map(([date, , show]) => ({ date, show }));
  const row = aggregate(rows)[0];
  assert.equal(row.segments.length, 2);
  assert.equal(row.weeks, 1753);
  assert.equal(row.runPeriods, "1988\u20132020, 2021\u20132023");
  assert.equal(row.runDates, "1988-01-10\u20132020-03-08, 2021-10-24\u20132023-04-16");
  assert.notEqual(row.runPeriods, "1988\u20132023");
});

test("separate runs sharing a year retain month boundaries instead of merging", () => {
  const segments = [
    { start: "2019-01-06", end: "2020-03-08" },
    { start: "2020-11-01", end: "2021-12-26" }
  ];
  assert.equal(context.window.DashboardUtils.formatRunPeriods(segments),
    "Jan 2019\u2013Mar 2020, Nov 2020\u2013Dec 2021");
  assert.equal(context.window.DashboardUtils.formatRunPeriods(segments, true),
    "2019-01-06\u20132020-03-08, 2020-11-01\u20132021-12-26");
  assert.equal(context.window.DashboardUtils.formatRunPeriods([]), "");
});

test("invalid calendar years are rejected rather than silently omitted", () => {
  for (const years of [[2020.5], [NaN], [0], ["2020"], null]) {
    assert.throws(() => format(years), /valid calendar years/);
  }
});
