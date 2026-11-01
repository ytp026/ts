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

test("formatters handle money, percents, signs and missing values", () => {
  assert.equal(ml.money(1234567), "$1.23M");
  assert.equal(ml.money(45600), "$46K");
  assert.equal(ml.money(NaN), "–");
  assert.equal(ml.percent(12.345, 1, true), "+12.3%");
  assert.equal(ml.percent(-4, 0, true), "-4%");
  assert.equal(ml.signed(0.0123), "+0.012");
  assert.equal(ml.number(null), "–");
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

test("causal renderer reads the tony_causal.py output schema", () => {
  const effect = (estimate, ci) => ({ estimate, ci95: ci, percent: 100 * estimate, percentCi95: ci.map((v) => 100 * v) });
  const doc = fakeDoc(["causal-headline", "causal-cards", "causal-event-chart", "causal-sample", "causal-limits"]);
  ml.renderCausal(doc, {
    sample: { analyzed: 40, winners: 10, losingNominees: 30, ceremonies: 10, firstCeremony: 2010, lastCeremony: 2019 },
    effects: {
      weeklyGross: effect(0.1, [0.02, 0.18]), capacityPoints: { estimate: 3, ci95: [1, 5] },
      closedWithin26Weeks: { estimate: -0.1, ci95: [-0.3, 0.1] }, placeboWeeklyGross: effect(0.01, [-0.03, 0.05]),
      byType: { musicals: effect(0.12, [0, 0.2]), plays: effect(0.05, [-0.1, 0.2]) },
    },
    eventStudy: { preTrendJointPValue: 0.42, coefficients: [{ week: 0, estimate: 0, ci95: [0, 0] }] },
    limitations: ["Few ceremonies"],
  });
  assert.match(doc.nodes["causal-headline"].innerHTML, /10\.0% higher/);
  assert.match(doc.nodes["causal-headline"].innerHTML, /association/);
  assert.equal((doc.nodes["causal-cards"].innerHTML.match(/ml-card/g) || []).length, 4);
  assert.match(doc.nodes["causal-sample"].innerHTML, /p = 0\.420/);
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

test("causal headline prefers the pipeline's interpretation summary", () => {
  const doc = fakeDoc(["causal-headline", "causal-cards"]);
  const effect = { estimate: 0.1, ci95: [0, 0.2], percent: 10, percentCi95: [0, 20] };
  try {
    ml.renderCausal(doc, { interpretation: { summary: "Winning is associated with <b>x</b>" },
      effects: { weeklyGross: effect, capacityPoints: effect, closedWithin26Weeks: effect, placeboWeeklyGross: effect } });
  } catch { /* later sections need fields this fixture omits */ }
  assert.equal(doc.nodes["causal-headline"].innerHTML, "Winning is associated with &lt;b&gt;x&lt;/b&gt;");
});
