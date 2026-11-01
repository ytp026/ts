"use strict";

window.MlSite = {
  escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  money(value) {
    if (!Number.isFinite(value)) return "–";
    const abs = Math.abs(value);
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${Math.round(value / 1e3)}K`;
    return `$${Math.round(value)}`;
  },

  number(value, digits = 3) {
    return Number.isFinite(value) ? value.toFixed(digits) : "–";
  },

  percent(value, digits = 1, signed = false) {
    if (!Number.isFinite(value)) return "–";
    const text = `${value.toFixed(digits)}%`;
    return signed && value > 0 ? `+${text}` : text;
  },

  signed(value, digits = 3) {
    if (!Number.isFinite(value)) return "–";
    return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
  },

  interval(ci, format) {
    if (!Array.isArray(ci) || !ci.every(Number.isFinite)) return "CI unavailable";
    return `95% CI ${format(ci[0])} to ${format(ci[1])}`;
  },

  excludesZero(ci) {
    return Array.isArray(ci) && ci.every(Number.isFinite) && (ci[0] > 0 || ci[1] < 0);
  },

  effectSentence(effect, label) {
    if (!effect || !Number.isFinite(effect.percent)) return `${label}: not enough data.`;
    const ci = this.interval(effect.percentCi95, (v) => this.percent(v, 1, true));
    if (!this.excludesZero(effect.percentCi95)) {
      return `${label}: ${this.percent(effect.percent, 1, true)} (${ci}); not statistically distinguishable from zero.`;
    }
    const direction = effect.percent > 0 ? "higher" : "lower";
    return `${label}: ${this.percent(Math.abs(effect.percent), 1)} ${direction} (${ci}).`;
  },

  driftLevel(psi) {
    if (!Number.isFinite(psi)) return "unknown";
    if (psi >= 0.25) return "major";
    return psi >= 0.1 ? "moderate" : "stable";
  },

  scale(domain, range) {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = d1 - d0 || 1;
    return (value) => r0 + ((value - d0) / span) * (r1 - r0);
  },

  path(values, x, y) {
    let text = "";
    let pen = "M";
    values.forEach((value, index) => {
      if (!Number.isFinite(value)) { pen = "M"; return; }
      text += `${pen}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      pen = "L";
    });
    return text;
  },

  lineChart(rows, lines, { width = 760, height = 280, format = (v) => v } = {}) {
    if (!rows.length) return '<p class="ml-empty">No data yet.</p>';
    const pad = { left: 64, right: 16, top: 16, bottom: 30 };
    const values = rows.flatMap((row) => lines.map((line) => row[line.key]))
      .filter(Number.isFinite);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const x = this.scale([0, rows.length - 1], [pad.left, width - pad.right]);
    const y = this.scale([low, high], [height - pad.bottom, pad.top]);
    const ticks = [low, (low + high) / 2, high].map((value) =>
      `<g class="ml-tick"><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"></line><text x="${pad.left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${this.escape(format(value))}</text></g>`).join("");
    const labels = [0, rows.length - 1].map((index) =>
      `<text class="ml-axis" x="${x(index).toFixed(1)}" y="${height - 8}" text-anchor="${index ? "end" : "start"}">${this.escape(rows[index].label)}</text>`).join("");
    const paths = lines.map((line) =>
      `<path class="ml-line ${line.className}" d="${this.path(rows.map((row) => row[line.key]), x, y)}"></path>`).join("");
    const legend = lines.map((line) =>
      `<span class="ml-legend-item ${line.className}">${this.escape(line.label)}</span>`).join("");
    return `<svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.escape(lines.map((l) => l.label).join(" vs "))}">${ticks}${labels}${paths}</svg><div class="ml-legend">${legend}</div>`;
  },

  eventChart(coefficients, { width = 760, height = 260 } = {}) {
    if (!coefficients || !coefficients.length) return '<p class="ml-empty">No event study yet.</p>';
    const pad = { left: 56, right: 16, top: 16, bottom: 34 };
    const pct = (v) => 100 * Math.expm1(v);
    const values = coefficients.flatMap((c) => [pct(c.ci95[0]), pct(c.ci95[1]), pct(c.estimate)])
      .filter(Number.isFinite).concat([0]);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const weeks = coefficients.map((c) => c.week);
    const x = this.scale([Math.min(...weeks), Math.max(...weeks)], [pad.left, width - pad.right]);
    const y = this.scale([low, high], [height - pad.bottom, pad.top]);
    const zero = `<line class="ml-zero" x1="${pad.left}" x2="${width - pad.right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"></line>`;
    const ceremony = `<line class="ml-ceremony" x1="${x(0.5).toFixed(1)}" x2="${x(0.5).toFixed(1)}" y1="${pad.top}" y2="${height - pad.bottom}"></line>`;
    const marks = coefficients.map((c) => {
      const cx = x(c.week).toFixed(1);
      const post = c.week > 0 ? " post" : "";
      return `<g class="ml-event${post}"><line x1="${cx}" x2="${cx}" y1="${y(pct(c.ci95[0])).toFixed(1)}" y2="${y(pct(c.ci95[1])).toFixed(1)}"></line><circle cx="${cx}" cy="${y(pct(c.estimate)).toFixed(1)}" r="4"><title>Week ${c.week}: ${this.percent(pct(c.estimate), 1, true)}</title></circle></g>`;
    }).join("");
    const axis = [Math.min(...weeks), 0, Math.max(...weeks)].map((week) =>
      `<text class="ml-axis" x="${x(week).toFixed(1)}" y="${height - 10}" text-anchor="middle">${week === 0 ? "Tony night" : `Week ${week}`}</text>`).join("");
    const yTicks = [low, high].map((value) =>
      `<text class="ml-axis" x="${pad.left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${this.percent(value, 0, true)}</text>`).join("");
    return `<svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Event study: winners versus losing nominees by week">${zero}${ceremony}${marks}${axis}${yTicks}</svg>`;
  },

  async load(name) {
    const response = await fetch(`ml/${name}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  },

  set(doc, id, html) {
    const node = doc.getElementById(id);
    if (node) node.innerHTML = html;
  },

  card(title, value, detail, tone = "") {
    return `<article class="ml-card ${tone}"><h3>${this.escape(title)}</h3><strong>${this.escape(value)}</strong><p>${this.escape(detail)}</p></article>`;
  },

  renderMetrics(doc, metrics) {
    const gross = metrics.nextWeekGross;
    const close = metrics.closingWithin8Weeks;
    const mapeCi = (ci) => this.interval(ci, (v) => this.signed(v, 2));
    this.set(doc, "ml-metric-cards", [
      this.card("Next-week gross MAPE", this.percent(gross.model.mape, 2),
        `Persistence ${this.percent(gross.persistence.mape, 2)} · seasonal ${this.percent(gross.seasonalPersistence.mape, 2)}`, "blue"),
      this.card("MAPE vs seasonal baseline", `${this.signed(gross.model.mape - gross.seasonalPersistence.mape, 2)} pts`,
        mapeCi(gross.mapeDiffVsSeasonalCi95), "purple"),
      this.card("Closing-risk ROC AUC", this.number(close.model.rocAuc),
        `Logistic baseline ${this.number(close.logisticBaseline.rocAuc)} · capacity rule ${this.number(close.lowCapacityRule.rocAuc)}`, "red"),
      this.card("AUC vs logistic baseline", this.signed(close.model.rocAuc - close.logisticBaseline.rocAuc),
        this.interval(close.aucDiffVsLogisticCi95, (v) => this.signed(v)), "teal"),
    ].join(""));
    const split = metrics.split;
    this.set(doc, "ml-split", `Trained before ${this.escape(split.trainBefore)}, tuned on ${this.escape(split.validation)}, tested on ${this.escape(gross.rows.toLocaleString("en-US"))} show-weeks from ${this.escape(split.testFrom)} to ${this.escape(split.testThrough)}. Closing test: ${close.rows.toLocaleString("en-US")} show-weeks across ${close.shows} shows (${this.percent(100 * close.positiveRate, 1)} close within 8 weeks). Model: ${this.escape(metrics.model)}.`);
    this.set(doc, "ml-features", metrics.topGrossFeatures.map((f) =>
      `<li><span>${this.escape(f.feature)}</span><b>${this.number(f.importance, 4)}</b></li>`).join(""));
  },

  renderBacktest(doc, backtest) {
    const rows = backtest.market.map((r) => ({ label: r.week, actual: r.actual, model: r.model, baseline: r.baseline }));
    const lines = [
      { key: "actual", label: "Actual", className: "actual" },
      { key: "model", label: "Model forecast", className: "model" },
      { key: "baseline", label: "Seasonal baseline", className: "baseline" },
    ];
    this.set(doc, "ml-market-chart", this.lineChart(rows, lines, { format: (v) => this.money(v) }));
    const select = doc.getElementById("ml-show-select");
    if (!select) return;
    const shows = Object.keys(backtest.shows);
    select.innerHTML = shows.map((s) => `<option>${this.escape(s)}</option>`).join("");
    const draw = () => {
      const series = backtest.shows[select.value] || [];
      this.set(doc, "ml-show-chart", this.lineChart(
        series.map(([week, actual, model]) => ({ label: week, actual, model })),
        lines.slice(0, 2), { height: 220, format: (v) => this.money(v) }));
    };
    select.addEventListener("change", draw);
    draw();
  },

  renderPredictions(doc, predictions) {
    this.set(doc, "ml-target-week", this.escape(predictions.targetWeek));
    this.set(doc, "ml-predictions", predictions.predictions.map((p) => `<tr><td>${this.escape(p.show)}</td><td>${this.money(p.lastGross)}</td><td>${this.money(p.predictedGross)}</td><td>${this.percent(100 * p.capacity, 0)}</td><td><span class="ml-risk" style="--risk:${Math.round(100 * p.closeProbability)}%">${this.percent(100 * p.closeProbability, 0)}</span></td></tr>`).join(""));
  },

  renderMonitoring(doc, monitoring, metrics) {
    const rows = monitoring.drift.map((d) => `<tr><td>${this.escape(d.feature)}${d.note ? `<div class="ml-note">${this.escape(d.note)}</div>` : ""}</td><td>${this.number(d.psi)}</td><td><span class="ml-status ${this.driftLevel(d.psi)}">${this.driftLevel(d.psi)}</span></td></tr>`);
    const market = monitoring.marketCheck;
    if (market && market.percentChange !== null && market.percentChange !== undefined) {
      rows.push(`<tr><td>market gross<div class="ml-note">Weekly market total vs the same ${market.weeks} weeks last year (change %, not PSI; one value per week, so row-level PSI would be misleading).</div></td><td>${this.percent(market.percentChange, 1, true)}</td><td><span class="ml-status ${this.escape(market.status)}">${this.escape(market.status)}</span></td></tr>`);
    }
    this.set(doc, "ml-drift", rows.join(""));
    const live = monitoring.liveForecasts;
    const liveText = live.maturedForecasts
      ? `${live.maturedForecasts} forecasts have matured: live MAPE ${this.percent(live.modelMape, 2)} vs persistence ${this.percent(live.persistenceMape, 2)} (backtest ${this.percent(monitoring.backtestMape, 2)}).`
      : "Forecasts are logged weekly; live accuracy appears once their target weeks are reported.";
    const alerts = monitoring.alerts.length
      ? `<ul>${monitoring.alerts.map((a) => `<li>${this.escape(a)}</li>`).join("")}</ul>` : "<p>No active alerts.</p>";
    const snapshot = monitoring.trainingSnapshot;
    const run = metrics.mlflowRunId ? ` MLflow run <code>${this.escape(metrics.mlflowRunId)}</code>.` : "";
    this.set(doc, "ml-live", `<p>${liveText}</p>${alerts}<p class="ml-note">Training snapshot <code>${this.escape(snapshot.file)}</code> (${snapshot.rows.toLocaleString("en-US")} show-weeks through ${this.escape(snapshot.through)}). Drift compares ${this.escape(monitoring.driftWindow.toLowerCase())} with ${this.escape(monitoring.driftReference.toLowerCase())}; new weeks are never added to training.${run}</p>`);
  },

  renderNlp(doc, nlp) {
    const close = nlp.closingWithin8Weeks;
    const gross = nlp.nextWeekGross;
    this.set(doc, "ml-nlp-cards", [
      this.card("Closing AUC, numeric only", this.number(close.numericOnly.rocAuc), `${close.shows} shows with review sentiment`, "blue"),
      this.card("Closing AUC, + sentiment", this.number(close.withSentiment.rocAuc),
        `Lift ${this.signed(close.aucLift)} · ${this.interval(close.aucLiftCi95, (v) => this.signed(v))}`, "purple"),
      this.card("Gross MAPE change", `${this.signed(gross.mapeChange, 2)} pts`,
        `${this.percent(gross.numericOnly.mape, 2)} → ${this.percent(gross.withSentiment.mape, 2)} · ${this.interval(gross.mapeChangeCi95, (v) => this.signed(v, 2))}`, "teal"),
    ].join(""));
    const verdict = this.excludesZero(close.aucLiftCi95)
      ? (close.aucLift > 0 ? "Sentiment adds a measurable improvement to closing-risk ranking." : "Sentiment makes closing-risk ranking measurably worse.")
      : "Sentiment does not measurably improve closing-risk ranking; the confidence interval includes zero.";
    this.set(doc, "ml-nlp-verdict", `${verdict} Coverage: ${nlp.coverage.showsWithSentiment} of ${nlp.coverage.showsSince1996} shows since 1996.`);
    this.set(doc, "ml-nlp-limits", nlp.limitations.map((l) => `<li>${this.escape(l)}</li>`).join(""));
  },

  renderCausal(doc, causal) {
    const effects = causal.effects;
    const gross = effects.weeklyGross;
    const capacity = effects.capacityPoints;
    const closed = effects.closedWithin26Weeks;
    const sample = causal.sample;
    const headline = causal.interpretation?.summary
      || this.effectSentence(gross, "Weekly gross for winners vs losing nominees, weeks 1–8 (association)");
    this.set(doc, "causal-headline", this.escape(headline));
    this.set(doc, "causal-cards", [
      this.card("Weekly gross gap, weeks 1–8", this.percent(gross.percent, 1, true), this.interval(gross.percentCi95, (v) => this.percent(v, 1, true)), "blue"),
      this.card("Capacity gap", `${this.signed(capacity.estimate, 1)} pts`, this.interval(capacity.ci95, (v) => this.signed(v, 1)), "purple"),
      this.card("Closed within 26 weeks", `${this.signed(100 * closed.estimate, 1)} pts`, this.interval(closed.ci95, (v) => this.signed(100 * v, 1)), "red"),
      this.card("Placebo (fake ceremony)", this.percent(effects.placeboWeeklyGross.percent, 1, true), this.interval(effects.placeboWeeklyGross.percentCi95, (v) => this.percent(v, 1, true)), "teal"),
    ].join(""));
    this.set(doc, "causal-event-chart", this.eventChart(causal.eventStudy.coefficients));
    this.set(doc, "causal-sample", `${sample.analyzed} nominated productions running on Tony night (${sample.winners} winners, ${sample.losingNominees} losing nominees) across ${sample.ceremonies} ceremonies, ${sample.firstCeremony}–${sample.lastCeremony}. Pre-trend joint test p = ${this.number(causal.eventStudy.preTrendJointPValue)}. Musicals: ${this.percent(effects.byType.musicals.percent, 1, true)}; plays: ${this.percent(effects.byType.plays.percent, 1, true)}.`);
    this.set(doc, "causal-limits", causal.limitations.map((l) => `<li>${this.escape(l)}</li>`).join(""));
  },

  async init(doc) {
    const tasks = [];
    const guard = (id, promise) => tasks.push(promise.catch((error) => {
      this.set(doc, id, `<p class="ml-empty">Results are not available yet (${this.escape(error.message)}).</p>`);
    }));
    if (doc.getElementById("causal-results")) {
      guard("causal-cards", this.load("tony-causal-results.json").then((c) => this.renderCausal(doc, c)));
    }
    if (doc.getElementById("ml-metric-cards")) {
      guard("ml-metric-cards", Promise.all([this.load("forecast-metrics.json"), this.load("monitoring.json")])
        .then(([metrics, monitoring]) => {
          this.renderMetrics(doc, metrics);
          this.renderMonitoring(doc, monitoring, metrics);
        }));
      guard("ml-market-chart", this.load("forecast-backtest.json").then((b) => this.renderBacktest(doc, b)));
      guard("ml-predictions", this.load("forecast-predictions.json").then((p) => this.renderPredictions(doc, p)));
      guard("ml-nlp-cards", this.load("nlp-lift.json").then((n) => this.renderNlp(doc, n)));
    }
    await Promise.all(tasks);
  },
};

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => window.MlSite.init(document));
}
