"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const context = { window: {} };
vm.runInNewContext(fs.readFileSync("models.js", "utf8"), context);
const ml = context.window.MlSite;

function fakeDoc(ids) {
  const nodes = Object.fromEntries(ids.map((id) => [id, { innerHTML: "" }]));
  return { nodes, getElementById: (id) => nodes[id] || null };
}

test("chart frames preserve label scale and support keyboard scrolling", () => {
  const chart = ml.lineChart(
    [{ label: "Week one", actual: 10 }, { label: "Week two", actual: 20 }],
    [{ key: "actual", label: "Actual", className: "actual" }],
  );
  assert.match(chart, /class="ml-chart-scroll" style="--chart-min-width:760px" tabindex="0" role="region"/);
  assert.match(chart, /viewBox="0 0 760 280"/);
  assert.match(chart, /class="chart-scroll-hint"/);
  assert.match(chart, /<\/p><div class="ml-legend">/);
  const narrow = ml.lineChart(
    [{ label: "Week one", actual: 10 }],
    [{ key: "actual", label: "Actual", className: "actual" }],
    { width: 400 },
  );
  assert.match(narrow, /--chart-min-width:400px/);
  assert.match(narrow, /viewBox="0 0 400 280"/);
});

test("corrected Tony output renders matching counts, KPIs and caveats", () => {
  const results = JSON.parse(fs.readFileSync("ml/tony-causal-results.json", "utf8"));
  const doc = fakeDoc(["causal-lifecycle", "win-kpi", "nomination-kpi", "run-kpi",
    "causal-sample", "causal-limits"]);
  ml.renderCausal(doc, results);
  for (const [key, label] of [["notNominated", "Not nominated"],
    ["nominatedLost", "Nominated, no win"], ["won", "Nominated and won"]]) {
    assert.ok(doc.nodes["causal-lifecycle"].innerHTML.includes(
      `${label} (${results.nomination.lifecycle[key].shows} records)`));
  }
  assert.equal(doc.nodes["win-kpi"].innerHTML,
    ml.percent(results.effects.weeklyGross.percent, 1, true));
  assert.equal(doc.nodes["nomination-kpi"].innerHTML,
    ml.percent(results.nomination.effects.weeklyGross.percent, 1, true));
  assert.doesNotMatch(doc.nodes["causal-limits"].innerHTML, /jointly insignificant/);
  assert.match(doc.nodes["causal-sample"].innerHTML, /p < 0\.001/);
});

test("market notes label Christmas and Easter peaks and blank data gaps", () => {
  const weeks = [];
  for (let t = Date.UTC(2024, 9, 6); t <= Date.UTC(2025, 8, 28); t += 7 * 864e5) {
    weeks.push(new Date(t).toISOString().slice(0, 10));
  }
  const base = { "2024-12-29": 56, "2025-01-26": 26, "2025-04-20": 50, "2025-07-27": 19, "2025-08-03": 18 };
  const rows = weeks.map((label) => ({ label, actual: (base[label] || 35) * 1e6 }));
  const notes = ml.marketNotes(rows);
  const kinds = [...notes].map((n) => `${n.kind}:${rows[n.index].label}`);
  assert.deepEqual([...kinds], ["peak:2024-12-29", "low:2025-01-26", "peak:2025-04-20", "gap:2025-07-27"]);
  assert.deepEqual(Array.from(notes, (n) => n.label), ["Christmas", "Winter low", "Easter", "Missing data"]);
  assert.equal(notes[3].when, "Jul 27, 2025 – Aug 3, 2025");
  const clean = ml.withoutGaps(rows, notes, ["actual"]);
  assert.equal(clean.filter((r) => !Number.isFinite(r.actual)).length, 2);
  const svg = ml.lineChart(clean, [{ key: "actual", label: "Actual", className: "actual" }], { notes });
  assert.equal((svg.match(/class="ml-mark /g) || []).length, 4);
  assert.match(svg, /Christmas \$56\.00M/);
  assert.match(svg, /class="ml-mark low"[^]*Winter low \$26\.00M/);
  assert.match(svg, /<rect [^>]*><\/rect><text[^>]*>Missing data/);
  assert.doesNotMatch(svg, /ml-chart-notes/);
  assert.match(svg, /class="ml-hover-hit"/);
  assert.match(svg, /"label":"2024-12-29"/);
});

test("formatters handle money, percents, signs and missing values", () => {
  assert.equal(ml.money(1234567), "$1.23M");
  assert.equal(ml.money(45600), "$46K");
  assert.equal(ml.money(NaN), "–");
  assert.equal(ml.percent(12.345, 1, true), "+12.3%");
  assert.equal(ml.percent(-4, 0, true), "-4%");
  assert.equal(ml.signed(0.0123), "+0.012");
  assert.equal(ml.number(null), "–");
});

test("model comparison table lists every method and the agreement span", () => {
  const row = (model, percent, lo, hi) => ({ model, percent, percentCi95: [lo, hi] });
  const html = ml.modelTable({
    won: [row("Linear regression (OLS)", 30.8, 19.6, 43.1), row("Lasso (double selection)", 23.1, 15.2, 31.6)],
    nominated: [row("Linear regression (OLS)", 26.6, 19.8, 33.9), row("Lasso (double selection)", 26.3, 19.5, 33.5)],
    wonPlacebo: [row("Linear regression (OLS)", 3.6, -4.9, 13.0), row("Lasso (double selection)", 2.3, -5.4, 10.6)],
  });
  assert.equal((html.match(/<tr><th scope="row">/g) || []).length, 2);
  assert.match(html, /Winning: 23% to 31%/);
  assert.match(html, /Nomination: 26% to 27%/);
  assert.match(html, /up to \+4%/);
  assert.equal(ml.modelTable(undefined), "");
});

test("escape neutralizes HTML from data files", () => {
  assert.equal(ml.escape('<b a="1">&\'</b>'), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;");
});

test("effect sentences only claim an effect when the CI excludes zero", () => {
  const significant = ml.effectSentence({ percent: 12.5, percentCi95: [4.1, 21.6] }, "Gross");
  assert.match(significant, /12\.5% higher/);
  assert.doesNotMatch(significant, /not statistically/);
  const null_ = ml.effectSentence({ percent: 3, percentCi95: [-2, 8] }, "Gross");
  assert.match(null_, /not statistically distinguishable from zero/);
  const negative = ml.effectSentence({ percent: -6, percentCi95: [-9, -1] }, "Gross");
  assert.match(negative, /6\.0% lower/);
  assert.match(ml.effectSentence(null, "Gross"), /not enough data/);
});

test("drift levels follow PSI thresholds", () => {
  assert.equal(ml.driftLevel(0.05), "stable");
  assert.equal(ml.driftLevel(0.1), "moderate");
  assert.equal(ml.driftLevel(0.3), "major");
  assert.equal(ml.driftLevel(NaN), "unknown");
});

test("chart paths break at missing values and map to the plot range", () => {
  const x = ml.scale([0, 2], [0, 100]);
  const y = ml.scale([0, 10], [100, 0]);
  assert.equal(ml.path([0, 10, 5], x, y), "M0.0,100.0L50.0,0.0L100.0,50.0");
  assert.equal(ml.path([0, null, 5], x, y), "M0.0,100.0M100.0,50.0");
});

test("line and event charts render SVG with one path per series", () => {
  const rows = [{ label: "2024-01-07", a: 1, b: 2 }, { label: "2024-01-14", a: 3, b: 2 }];
  const svg = ml.lineChart(rows, [{ key: "a", label: "A", className: "actual" },
    { key: "b", label: "B", className: "model" }]);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.match(ml.lineChart([], []), /No data/);
  const events = ml.eventChart([{ week: -1, estimate: 0.01, ci95: [-0.02, 0.04] },
    { week: 0, estimate: 0, ci95: [0, 0] }, { week: 1, estimate: 0.1, ci95: [0.05, 0.15] }]);
  assert.equal((events.match(/<circle /g) || []).length, 3);
  assert.equal((events.match(/ml-event post/g) || []).length, 1);
});

test("causal renderer explains results in plain language", () => {
  const effect = (estimate, ci) => ({ estimate, ci95: ci, percent: 100 * estimate, percentCi95: ci.map((v) => 100 * v) });
  const ids = ["causal-headline", "causal-cards", "causal-event-chart", "causal-event-caption", "causal-sample",
    "causal-limits", "nomination-cards", "causal-lifecycle", "run-chart", "run-results"];
  const doc = fakeDoc(ids);
  ml.renderCausal(doc, {
    sample: { analyzed: 40, winners: 10, losingNominees: 30, ceremonies: 10, firstCeremony: 2010, lastCeremony: 2019 },
    effects: {
      weeklyGross: effect(0.1, [0.02, 0.18]), capacityPoints: { estimate: 3, ci95: [1, 5] },
      closedWithin26Weeks: { estimate: -0.1, ci95: [-0.3, 0.1] }, placeboWeeklyGross: effect(0.01, [-0.03, 0.05]),
      byType: { musicals: effect(0.12, [0, 0.2]), plays: effect(0.05, [-0.1, 0.2]) },
    },
    rawDifferenceInDifferences: { winnersLogGrossChange: 0.2, losersLogGrossChange: -0.01 },
    eventStudy: { preTrendJointPValue: 0.42, coefficients: [-1, 0, 1, 2, 9].map((week) =>
      ({ week, estimate: week > 0 ? 0.1 : week < 0 ? -0.02 : 0, ci95: [-0.05, 0.15] })) },
    nomination: {
      sample: { analyzed: 60, nominated: 30, notNominated: 30, verifiedDateSeasons: 5 },
      design: { dates: "5 dates verified" },
      effects: { weeklyGross: effect(0.2, [0.1, 0.3]), placeboWeeklyGross: effect(0.12, [0.02, 0.2]),
        verifiedDatesOnly: effect(0.18, [0.05, 0.3]) },
      lifecycle: {
        notNominated: { shows: 9, beforeNomination: 100, afterNomination: 98, afterNominationShows: 8, afterTony: 90, afterTonyShows: 5,
          afterNominationSpread: { p10: 80, p25: 90, p50: 98, p75: 110, p90: 120 }, afterTonySpread: { p10: 80, p25: 90, p50: 90, p75: 110, p90: 120 } },
        won: { shows: 4, beforeNomination: 100, afterNomination: 130, afterNominationShows: 4, afterTony: 150, afterTonyShows: 4,
          afterNominationSpread: { p10: 100, p25: 115, p50: 130, p75: 140, p90: 160 }, afterTonySpread: { p10: 110, p25: 130, p50: 150, p75: 170, p90: 210 } },
      },
      runLength: {
        horizons: [13, 26],
        groups: {
          notNominated: { shows: 9, medianWeeksAfterTony: 8, curve: [100, 80, 60, 40] },
          nominatedLost: { shows: 6, medianWeeksAfterTony: 11, curve: [100, 90, 70, 50] },
          won: { shows: 4, medianWeeksAfterTony: 52, curve: [100, 100, 90, 80] },
        },
        logRankP: { allGroups: 0.00001, wonVsLost: 0.0004, lostVsNotNominated: 0.14 },
        regression: { 13: { n: 19, won: { points: 33, ci95: [20, 45] }, nominatedLost: { points: 20, ci95: [3, 37] } },
          26: { n: 19, won: { points: 33, ci95: [20, 45] }, nominatedLost: { points: 20, ci95: [4, 36] } } },
        winnersVsLosers: { 13: { n: 10, won: { points: 18, ci95: [2, 33] } }, 26: { n: 10, won: { points: 17, ci95: [1, 33] } } },
        playsOnly: { 26: { n: 5, won: { points: 15, ci95: [-16, 47] } } },
      },
    },
    limitations: ["Few ceremonies"],
  });
  const headline = doc.nodes["causal-headline"].innerHTML;
  assert.equal((headline.match(/<tr>/g) || []).length, 4);
  assert.match(headline, /<th>What it means for a typical show<\/th><\/tr>/);
  assert.doesNotMatch(headline, /Confidence/);
  assert.match(headline, /winners took in <b>\+10%<\/b> more per week/);
  assert.match(headline, /\$1\.00M → <b>\$1\.10M<\/b> a week/);
  assert.match(headline, /Half of winners were still running <b>52 weeks<\/b> after Tony night\. Half of nominees that lost closed within <b>11 weeks<\/b>.* within <b>8 weeks<\/b>/);
  assert.match(headline, /Winners <b>\+17 pts<\/b> more likely to be open at 6 months/);
  assert.equal((doc.nodes["causal-cards"].innerHTML.match(/ml-card/g) || []).length, 3);
  assert.match(doc.nodes["causal-cards"].innerHTML, /Not the &quot;didn&#39;t win&quot; group/);
  assert.match(doc.nodes["causal-cards"].innerHTML, /near zero/);
  assert.match(doc.nodes["causal-cards"].innerHTML, /about 83% full/);
  assert.match(doc.nodes["nomination-cards"].innerHTML, /extra caution/);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /Nomination → Tony night/);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /Before nomination/);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /<svg class="ml-chart"/);
  assert.equal((doc.nodes["causal-lifecycle"].innerHTML.match(/class="ml-box /g) || []).length, 4);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /median 150 \(middle half 130–170\), 4 shows/);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /Not nominated \(9 records\)/);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /Nominated, no win \(0 records\)/);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /Nominated and won \(4 records\)/);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /One record is one show production in one Tony season/);
  assert.match(doc.nodes["causal-lifecycle"].innerHTML, /winners are a subset of nominees/);
  assert.doesNotMatch(doc.nodes["causal-lifecycle"].innerHTML, /show-seasons|counted once per season, so/);
  const runs = doc.nodes["run-chart"].innerHTML;
  assert.equal((runs.match(/class="ml-km /g) || []).length, 3);
  assert.match(runs, /Won: half closed by week 52/);
  const runText = doc.nodes["run-results"].innerHTML;
  assert.match(runText, /p = 0\.0004|p &lt; 0\.001|p < 0\.001/);
  assert.match(runText, /p = 0\.14/);
  assert.match(runText, /limited engagements/);
  assert.match(runText, /\+10 points still open/);
  assert.match(runText, /<th scope="row">6 months<\/th><td><b>\+33 pts<\/b><small>20 to 45/);
  assert.match(doc.nodes["causal-event-caption"].innerHTML, /highest post-ceremony estimate/);
  assert.match(doc.nodes["causal-event-caption"].innerHTML, /cannot guarantee equal seasonal responses/);
  assert.match(doc.nodes["causal-event-caption"].innerHTML, /do not establish causation/);
  assert.match(doc.nodes["causal-sample"].innerHTML, /p = 0\.42/);
  assert.match(doc.nodes["causal-sample"].innerHTML, /no clear drift/);
  assert.match(doc.nodes["causal-sample"].innerHTML, /can&#39;t say plays benefit more|can't say plays benefit more/);
  assert.match(doc.nodes["causal-limits"].innerHTML, /Few ceremonies/);
});

test("NLP renderer reports no lift when the CI includes zero", () => {
  const doc = fakeDoc(["ml-nlp-cards", "ml-nlp-verdict", "ml-nlp-limits"]);
  ml.renderNlp(doc, {
    closingWithin8Weeks: { shows: 50, numericOnly: { rocAuc: 0.8 }, withSentiment: { rocAuc: 0.81 },
      aucLift: 0.01, aucLiftCi95: [-0.02, 0.04] },
    nextWeekGross: { numericOnly: { mape: 8 }, withSentiment: { mape: 8.1 }, mapeChange: 0.1, mapeChangeCi95: [-0.1, 0.3] },
    coverage: { showsWithSentiment: 50, showsSince1996: 400 },
    limitations: ["Hindsight"],
  });
  assert.match(doc.nodes["ml-nlp-verdict"].innerHTML, /does not measurably improve/);
  assert.match(doc.nodes["ml-nlp-verdict"].innerHTML, /50 of 400/);
});

test("causal renderer works without the nomination block", () => {
  const doc = fakeDoc(["causal-headline", "causal-cards", "nomination-cards"]);
  const effect = { estimate: 0.1, ci95: [0, 0.2], percent: 10, percentCi95: [0, 20] };
  try {
    ml.renderCausal(doc, { effects: { weeklyGross: effect, capacityPoints: effect, closedWithin26Weeks: effect, placeboWeeklyGross: effect } });
  } catch { /* later sections need fields this fixture omits */ }
  assert.equal((doc.nodes["causal-headline"].innerHTML.match(/<th scope="row">/g) || []).length, 1);
  assert.equal(doc.nodes["nomination-cards"].innerHTML, "");
});

test("category table and bullets show both methods and flag unclear effects", () => {
  const e = (unit, v, lo, hi, dml) => ({ [unit]: v, [`${unit}Ci95`]: [lo, hi], doubleML: { [unit]: dml } });
  const categories = {
    byGroup: {
      nominationSales: { nom_production: e("percent", 11.1, 7, 15.3, 10.2), nom_acting: e("percent", 4.5, -0.4, 9.6, 4.4), nom_creative: e("percent", 12.9, 8.1, 17.8, 11.1) },
      afterTonySales: { won_production: e("percent", 18.9, 9.6, 29, 16.4), won_acting: e("percent", 5.5, 1.1, 10.1, 7.9), won_creative: e("percent", 5.5, 0.7, 10.4, 5.1), won_production_vs_won_creative_p: 0.02 },
      stillOpen26: { won_production: e("points", -2.9, -14, 8, 3), won_acting: e("points", 7.2, -3, 17, 6), won_creative: e("points", 22.2, 11.8, 32.6, 18.7) },
    },
    byGender: {
      afterTonySales: { won_actor: e("percent", 4.9, 0, 10, 5.6), won_actress: e("percent", 1.6, -3, 6, 3.7), won_actor_vs_won_actress_p: 0.34 },
      stillOpen26: { won_actor_vs_won_actress_p: 0.58 },
    },
  };
  const table = ml.categoryTable(categories);
  assert.match(table, /Production \(Best Musical, Play, Revival\)/);
  assert.match(table, /\+19%<\/b><small>Gradient boosting: \+16%<\/small>/);
  assert.match(table, /ml-muted">\+5%<\/b><small>Gradient boosting: \+4% · not clear/);
  assert.match(table, /\+22 pts/);
  const bullets = ml.categoryBullets(categories);
  assert.match(bullets, /no real difference/);
  assert.match(bullets, /p = 0\.34/);
  assert.equal(ml.categoryTable({}), "");
  const chart = ml.categoryChart(categories);
  assert.equal((chart.match(/<figure class="ml-cat-panel"/g) || []).length, 3);
  assert.match(chart, /ml-cat best"><title>Production: \+19%/);
  assert.match(chart, /ml-cat best"><title>Creative &amp; design: \+22 pts/);
  assert.match(chart, /ml-cat unclear"><title>Acting: \+5%/);
  assert.match(chart, /class="ml-cat-dml"/);
  const takeaways = ml.categoryTakeaways(categories);
  assert.match(takeaways, /Best Musical \/ Play \/ Revival wins move sales the most/);
  assert.match(takeaways, /Nomination \+5% \(not clear\)/);
  assert.equal(ml.categoryChart({}), "");
});

test("feature labels are plain English with a readable fallback", () => {
  assert.equal(ml.featureLabel("log_run_age"), "How long it has run");
  assert.equal(ml.featureLabel("target_woy"), "Season and calendar week");
  assert.match(ml.featureDescription("target_woy"), /Holiday/);
  assert.equal(ml.featureLabel("new_thing"), "new thing");
});

test("gender box chart draws one box per non-empty group with median labels", () => {
  const box = (key, label, shows, p50) => ({ key, label, shows, p10: p50 - 20, p25: p50 - 8, p50, p75: p50 + 8, p90: p50 + 20 });
  const svg = ml.genderBoxChart([box("none", "None", 124, 0.5), box("actorWon", "Actor won", 107, 13.1), { key: "actressWon", label: "x", shows: 0 }]);
  assert.equal((svg.match(/class="ml-box /g) || []).length, 2);
  assert.match(svg, /ml-box g-won/);
  assert.match(svg, />\+13%</);
  assert.match(svg, /won \(107\)/);
  assert.match(ml.genderBoxChart([]), /No data yet/);
});
test("risk reasons show direction, text and points, or a neutral note", () => {
  const html = ml.riskReasons([
    { direction: "raises", points: 58.4, text: "Small house: 5.1K seats" },
    { direction: "lowers", points: -3.8, text: "Tony-nominated <b>" },
  ]);
  assert.match(html, /class="up".*&uarr;.*Small house: 5\.1K seats.*\+58 pts/);
  assert.match(html, /class="down".*&darr;.*&lt;b&gt;.*&minus;4 pts/);
  assert.match(ml.riskReasons([]), /typical running show/);
});
