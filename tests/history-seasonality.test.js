"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const context = { window: {} };
vm.runInNewContext(fs.readFileSync("history-seasonality.js", "utf8"), context);
const seasonality = context.window.HistorySeasonality;
const summarize = (rows) => JSON.parse(JSON.stringify(seasonality.summarize(rows)));

function yearRows(year, gross = () => 100) {
  const date = new Date(Date.UTC(year, 0, 1));
  date.setUTCDate(1 + (7 - date.getUTCDay()) % 7);
  const rows = [];
  while (date.getUTCFullYear() === year) {
    rows.push({ date: date.toISOString().slice(0, 10), show: "Test show",
      gross: gross(date.getUTCMonth()), available: 1000 });
    date.setUTCDate(date.getUTCDate() + 7);
  }
  return rows;
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);
}

test("constant weekly gross normalizes all twelve months to 100", () => {
  const summary = summarize(yearRows(2024));
  assert.deepEqual(summary.includedYears, [2024]);
  assert.deepEqual(summary.excludedYears, []);
  assert.equal(summary.months.length, 12);
  summary.months.forEach((month) => {
    close(month.index, 100);
    assert.equal(month.years, 1);
    assert.ok(month.weeks >= 4);
  });
});

test("calendar month comes from the Sunday week-ending date without shifting", () => {
  const rows = yearRows(2023, (month) => month === 0 ? 200 : 100);
  const summary = summarize(rows);
  const baseline = rows.reduce((sum, row) => sum + row.gross, 0) / rows.length;
  assert.equal(summary.months[0].month, "Jan");
  assert.equal(summary.months[0].weeks, 5);
  assert.equal(summary.months[1].weeks, 4);
  close(summary.months[0].index, 200 / baseline * 100);
  close(summary.months[1].index, 100 / baseline * 100);
  close(summary.months.reduce((sum, month) => sum + month.index * month.weeks, 0)
    / rows.length, 100);
});

test("production gross is additive by week before the annual baseline", () => {
  const first = yearRows(2024, (month) => month === 11 ? 200 : 100);
  const second = yearRows(2024, (month) => month === 11 ? 100 : 400)
    .map((row) => ({ ...row, show: "Second show" }));
  const combined = first.map((row, index) => ({
    ...row, gross: row.gross + second[index].gross,
    available: row.available + second[index].available
  }));
  assert.deepEqual(summarize([...first, ...second]), summarize(combined));
});

test("each year has equal weight regardless of dollar scale or 52/53-week coverage", () => {
  const first = yearRows(2023, (month) => month === 0 ? 200 : 100);
  const second = yearRows(2024, (month) => month === 0 ? 100000 : 200000);
  assert.equal(first.length, 53);
  assert.equal(second.length, 52);
  const firstSummary = summarize(first);
  const secondSummary = summarize(second);
  const combined = summarize([...second, ...first]);
  assert.deepEqual(combined.includedYears, [2023, 2024]);
  combined.months.forEach((month, index) => {
    close(month.index, (firstSummary.months[index].index + secondSummary.months[index].index) / 2);
    assert.equal(month.years, 2);
  });
  const pooledJanuary = (firstSummary.months[0].index * 5 + secondSummary.months[0].index * 4) / 9;
  assert.ok(Math.abs(combined.months[0].index - pooledJanuary) > 1);
});

test("missing weeks, partial years and inactive weeks exclude whole years", () => {
  const complete = yearRows(2022);
  const missing = yearRows(2023).slice(1);
  const zero = yearRows(2024).map((row, index) => index === 5 ? { ...row, gross: 0 } : row);
  const noPerformance = yearRows(2025)
    .map((row, index) => index === 5 ? { ...row, available: 0 } : row);
  const partial = yearRows(2026).slice(0, 40);
  const summary = summarize([...complete, ...missing, ...zero, ...noPerformance, ...partial]);
  assert.deepEqual(summary.includedYears, [2022]);
  assert.deepEqual(summary.excludedYears, [
    { year: 2023, missingWeeks: 1, inactiveWeeks: 0 },
    { year: 2024, missingWeeks: 0, inactiveWeeks: 1 },
    { year: 2025, missingWeeks: 0, inactiveWeeks: 1 },
    { year: 2026, missingWeeks: 12, inactiveWeeks: 0 }
  ]);
  assert.deepEqual(summary.months, summarize(complete).months);
});

test("empty selections and no complete years return explicit absent indices", () => {
  for (const rows of [[], yearRows(2024).slice(0, 10), yearRows(2024, () => 0)]) {
    const summary = summarize(rows);
    assert.deepEqual(summary.includedYears, []);
    summary.months.forEach((month) => {
      assert.equal(month.index, null);
      assert.equal(month.years, 0);
      assert.equal(month.weeks, 0);
    });
  }
});

test("invalid dates, non-Sundays, negative and nonfinite measures fail explicitly", () => {
  for (const patch of [
    { date: "invalid" }, { date: "2024-02-31" }, { date: "2024-01-01" },
    { gross: -1 }, { gross: Infinity }, { available: -1 }, { available: NaN }
  ]) {
    assert.throws(() => summarize([{ ...yearRows(2024)[0], ...patch }]), /Seasonality/);
  }
  assert.throws(() => summarize(null), /Seasonality/);
});

test("real coverage through October 4, 2026 excludes incomplete and closure/reopening years", () => {
  const data = JSON.parse(fs.readFileSync("history-dashboard-data.json", "utf8"));
  const rows = data.rows.filter(([date]) => date <= "2026-10-04")
    .map(([date, , show, gross, , available]) => ({ date, show, gross, available }));
  const summary = summarize(rows);
  assert.equal(summary.includedYears.length, 38);
  assert.deepEqual(summary.excludedYears.map(({ year }) => year), [1985, 2020, 2021, 2026]);
  assert.equal(summary.includedYears[0], 1986);
  assert.equal(summary.includedYears.at(-1), 2025);
  summary.months.forEach((month) => {
    assert.equal(month.years, 38);
    assert.ok(Number.isFinite(month.index) && month.index > 0);
  });
});

test("page adds one seasonal chart immediately beneath the weekly chart", () => {
  const markup = fs.readFileSync("history.html", "utf8");
  assert.equal((markup.match(/id="history-seasonality-chart"/g) || []).length, 1);
  assert.ok(markup.indexOf('id="history-line-chart"') < markup.indexOf('id="history-seasonality-chart"'));
  assert.ok(markup.indexOf('id="history-seasonality-chart"') < markup.indexOf("Longest-Running Shows"));
  const helperIndex = markup.indexOf('src="history-seasonality.js?');
  assert.ok(helperIndex >= 0 && helperIndex < markup.indexOf('src="history-dashboard.js?'));
  const dashboard = fs.readFileSync("history-dashboard.js", "utf8");
  assert.match(dashboard, /^function renderHistorySeasonality\(rows\)/m);
  assert.match(dashboard, /renderHistorySeasonality\(historyLineRows\(baseRows\)\)/);
});

function rendered(rows) {
  const elements = new Map();
  function element(attributes = {}) {
    return {
      attributes, children: [], listeners: {}, textContent: "", hidden: false,
      classes: new Set(),
      classList: {
        remove(name) { elements.get("#history-seasonality-coverage").classes.delete(name); },
        add(name) { elements.get("#history-seasonality-coverage").classes.add(name); }
      },
      replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); },
      addEventListener(name, listener) { this.listeners[name] = listener; }
    };
  }
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    }
  };
  const renderContext = { window: {}, document };
  vm.runInNewContext(fs.readFileSync("dashboard-utils.js", "utf8"), renderContext);
  renderContext.HistorySeasonality = seasonality;
  renderContext.svgElement = (tag, attributes, text) => {
    const node = element(attributes);
    node.textContent = text;
    return node;
  };
  const source = fs.readFileSync("history-dashboard.js", "utf8").match(
    /function renderHistorySeasonality\(rows\) \{[\s\S]*?(?=\nfunction renderHistoryLine)/
  )[0];
  vm.runInNewContext(source, renderContext);
  renderContext.renderHistorySeasonality(rows);
  return elements;
}

test("leadership copy uses live percentages and compact year ranges with detailed exclusions retained", () => {
  const rows = JSON.parse(fs.readFileSync("history-dashboard-data.json", "utf8")).rows
    .filter(([date]) => date <= "2026-10-04")
    .map(([date, , show, gross, , available]) => ({ date, show, gross, available }));
  const elements = rendered(rows);
  assert.equal(elements.get("#history-seasonality-coverage").textContent,
    "Based on 38 complete years (1986\u20132019, 2022\u20132025).");
  const highlights = elements.get("#history-seasonality-highlights").textContent;
  assert.match(highlights, /Dec \(\+19\.2%\)/);
  assert.match(highlights, /Apr \(\+11\.4%\)/);
  assert.doesNotMatch(highlights, /Sep|holiday|caused/);
  assert.match(elements.get("#history-seasonality-definition").textContent, /each year's average weekly gross/);
  assert.match(elements.get("#history-seasonality-definition").textContent, /not ticket counts/);
  assert.match(elements.get("#history-seasonality-exclusions").textContent, /2020 \(42 missing weeks\)/);
  assert.match(elements.get("#history-seasonality-methodology").textContent, /equal weight/);
  assert.equal(elements.get("#history-seasonality-dec-context").hidden, false);
  const groups = elements.get("#history-seasonality-chart").children
    .filter((node) => node.attributes.class === "history-seasonality-month");
  assert.equal(groups.length, 12);
  groups.at(-1).listeners.focus();
  assert.match(elements.get("#history-seasonality-detail").textContent,
    /Dec: 19\.2% above average weekly gross\. Index 119\.2; 38 years, 169 reported weeks/);
});

test("changed filters change highlights and do not force holiday context onto below-baseline months", () => {
  const elements = rendered(yearRows(2024, (month) => month === 8 ? 200 : 100));
  assert.match(elements.get("#history-seasonality-highlights").textContent, /^Above average: Sep /);
  assert.equal(elements.get("#history-seasonality-dec-context").hidden, true);
  assert.equal(elements.get("#history-seasonality-apr-context").hidden, true);
  assert.equal(elements.get("#history-seasonality-legend").hidden, false);
  const uniform = rendered(yearRows(2024));
  assert.match(uniform.get("#history-seasonality-highlights").textContent, /No month is above/);
});

test("empty coverage and invalid source data clear chart and show explicit states", () => {
  const empty = rendered([]);
  assert.match(empty.get("#history-seasonality-coverage").textContent, /No complete years/);
  assert.equal(empty.get("#history-seasonality-legend").hidden, true);
  assert.equal(empty.get("#history-seasonality-chart").children.length, 0);
  const invalid = rendered([{ ...yearRows(2024)[0], gross: NaN }]);
  assert.match(invalid.get("#history-seasonality-coverage").textContent, /could not be calculated/);
  assert.equal(invalid.get("#history-seasonality-coverage").classes.has("is-error"), true);
});

test("full methodology and sourced hypotheses are accessible but collapsed by default", () => {
  const markup = fs.readFileSync("history.html", "utf8");
  const details = markup.match(/<details[^>]*id="history-seasonality-method"[^>]*>/)[0];
  assert.doesNotMatch(details, /\bopen\b/);
  assert.match(markup, /<summary>How this is calculated<\/summary>/);
  assert.match(markup, /may be a contributor/);
  assert.match(markup, /not an explanation proven by these data/);
});

test("modern seasonal bars and legend share scoped color tokens", () => {
  const css = fs.readFileSync("styles.css", "utf8");
  for (const [category, color] of [["above", "#6366f1"], ["below", "#94a3b8"], ["average", "#e2e8f0"]]) {
    assert.ok(css.includes(`--seasonality-${category}: ${color};`));
    assert.ok(css.includes(`#history-seasonality-chart .history-seasonality-${category} { fill: var(--seasonality-${category}); }`));
    assert.ok(css.includes(`#history-seasonality-legend .history-seasonality-${category}-key { background: var(--seasonality-${category}); }`));
  }
  assert.match(css, /history-seasonality-month:focus rect/);
});

test("exact and effectively equal 100 indices are neutral, not below average", () => {
  assert.equal(seasonality.category(100), "average");
  assert.equal(seasonality.category(100 + 5e-10), "average");
  assert.equal(seasonality.category(100 - 5e-10), "average");
  assert.equal(seasonality.category(100 + 2e-9), "above");
  assert.equal(seasonality.category(100 - 2e-9), "below");
  assert.throws(() => seasonality.category(NaN), /finite index/);
  const elements = rendered(yearRows(2024));
  assert.equal(elements.get("#history-seasonality-average-legend").hidden, false);
  const groups = elements.get("#history-seasonality-chart").children
    .filter((node) => node.attributes.class === "history-seasonality-month");
  groups.forEach((group) => {
    assert.equal(group.children[1].attributes.class, "history-seasonality-average");
    assert.match(group.attributes["aria-label"], /at the yearly average/);
    assert.doesNotMatch(group.attributes["aria-label"], /below/);
  });
});

test("legend thresholds and baseline label agree with real bar categories", () => {
  const markup = fs.readFileSync("history.html", "utf8");
  assert.match(markup, /Above average \(&gt;100\)/);
  assert.match(markup, /Below average \(&lt;100\)/);
  assert.match(markup, /Average \(=100\)/);
  const elements = rendered(yearRows(2024, (month) => month === 0 ? 200 : 100));
  assert.equal(elements.get("#history-seasonality-average-legend").hidden, true);
  const children = elements.get("#history-seasonality-chart").children;
  assert.equal(children.filter((node) => node.textContent === "Average = 100").length, 1);
  const groups = children.filter((node) => node.attributes.class === "history-seasonality-month");
  assert.equal(groups[0].children[1].attributes.class, "history-seasonality-above");
  groups.slice(1).forEach((group) => {
    assert.equal(group.children[1].attributes.class, "history-seasonality-below");
    assert.match(group.attributes["aria-label"], /below average/);
  });
});

test("small nonzero differences are not presented as zero percent", () => {
  const elements = rendered(yearRows(2024, (month) => month === 0 ? 100.0001 : 100));
  const highlights = elements.get("#history-seasonality-highlights").textContent;
  assert.match(highlights, /Jan \(<0\.1% above\)/);
  assert.doesNotMatch(highlights, /\+0\.0%/);
  const group = elements.get("#history-seasonality-chart").children
    .find((node) => node.attributes.class === "history-seasonality-month");
  assert.match(group.attributes["aria-label"], /less than 0\.1% above average/);
});
