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

  easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(year, month - 1, day);
  },

  shortDate(iso) {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US",
      { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  },

  // Christmas and Easter peaks plus weeks where the source data is incomplete.
  // One peak per holiday per year; gap weeks are returned as ranges so the chart can blank them.
  marketNotes(rows) {
    const values = rows.map((r) => r.actual);
    const around = (i) => {
      const near = values.slice(Math.max(0, i - 6), Math.max(0, i - 1))
        .concat(values.slice(i + 2, i + 7)).filter(Number.isFinite).sort((a, b) => a - b);
      return near.length ? near[Math.floor(near.length / 2)] : NaN;
    };
    const peaks = {};
    const gaps = [];
    const keep = (key, i, label) => {
      if (!peaks[key] || values[i] > values[peaks[key].index]) peaks[key] = { index: i, kind: "peak", label };
    };
    const keepLow = (key, i) => {
      if (!peaks[key] || values[i] < values[peaks[key].index]) peaks[key] = { index: i, kind: "low", label: "Winter low" };
    };
    rows.forEach((row, i) => {
      if (!Number.isFinite(row.actual)) return;
      const time = Date.parse(`${row.label}T00:00:00Z`);
      const date = new Date(time);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;
      const day = date.getUTCDate();
      const ratio = row.actual / around(i);
      const sinceEaster = (time - this.easterSunday(year)) / 864e5;
      if ((month === 12 && day >= 26) || (month === 1 && day <= 3)) {
        keep(`xmas-${month === 1 ? year - 1 : year}`, i, "Christmas");
      } else if (ratio < 0.7) {
        const last = gaps[gaps.length - 1];
        if (last && last.end === i - 1) last.end = i;
        else gaps.push({ index: i, end: i, kind: "gap", label: "Missing data" });
      } else if (month <= 2) {
        keepLow(`low-${year}`, i);
      } else if (sinceEaster >= 0 && sinceEaster <= 7 && ratio > 1.08) {
        keep(`easter-${year}`, i, "Easter");
      }
    });
    return Object.values(peaks).concat(gaps).sort((a, b) => a.index - b.index).map((note) => {
      const start = rows[note.index];
      const end = rows[note.end ?? note.index];
      const when = note.end != null && note.end !== note.index
        ? `${this.shortDate(start.label)} – ${this.shortDate(end.label)}` : this.shortDate(start.label);
      return { ...note, when, value: start.actual };
    });
  },

  // Blank every series in data-gap weeks so the lines break instead of plunging.
  withoutGaps(rows, notes, keys) {
    const blank = new Set();
    notes.filter((n) => n.kind === "gap").forEach((n) => {
      for (let i = n.index; i <= n.end; i += 1) blank.add(i);
    });
    return rows.map((row, i) => (blank.has(i)
      ? { ...row, ...Object.fromEntries(keys.map((k) => [k, NaN])) } : row));
  },

  chartScroll(content, width) {
    return `<div class="ml-chart-scroll" style="--chart-min-width:${width}px" tabindex="0" role="region" aria-label="Chart; scroll horizontally on smaller screens">${content}</div><p class="chart-scroll-hint">Scroll sideways on smaller screens to see the full chart.</p>`;
  },

  lineChart(rows, lines, { width = 760, height = 280, format = (v) => v, notes = [] } = {}) {
    if (!rows.length) return '<p class="ml-empty">No data yet.</p>';
    const pad = { left: 80, right: 16, top: notes.length ? 34 : 16, bottom: 30 };
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
    const step = rows.length > 1 ? (x(1) - x(0)) / 2 : 4;
    const anchor = (cx) => (cx < pad.left + 50 ? "start" : cx > width - pad.right - 50 ? "end" : "middle");
    const payload = rows.map((row, i) => ({
      label: row.label,
      x: Number(x(i).toFixed(1)),
      values: lines.map((line) => ({
        label: line.label,
        className: line.className,
        value: Number.isFinite(row[line.key]) ? row[line.key] : null,
        y: Number.isFinite(row[line.key]) ? Number(y(row[line.key]).toFixed(1)) : null,
      })),
    }));
    const marks = notes.map((note) => {
      const cx = x(note.index);
      const when = `${note.when}: ${note.label}`;
      if (note.kind === "gap") {
        const x0 = cx - step, x1 = x(note.end) + step;
        return `<g class="ml-mark gap"><rect x="${x0.toFixed(1)}" y="${pad.top}" width="${(x1 - x0).toFixed(1)}" height="${height - pad.bottom - pad.top}"></rect><text x="${((x0 + x1) / 2).toFixed(1)}" y="${pad.top - 6}" text-anchor="${anchor((x0 + x1) / 2)}">${this.escape(note.label)}</text><title>${this.escape(`${when} (fewer shows reported; weeks left out)`)}</title></g>`;
      }
      if (!Number.isFinite(note.value)) return "";
      const cy = y(note.value);
      if (note.kind === "low") {
        return `<g class="ml-mark low"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4"></circle><text x="${cx.toFixed(1)}" y="${Math.min(cy + 18, height - pad.bottom - 4).toFixed(1)}" text-anchor="${anchor(cx)}">${this.escape(note.label)} ${this.escape(this.money(note.value))}</text><title>${this.escape(when)}</title></g>`;
      }
      return `<g class="ml-mark peak"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4"></circle><text x="${cx.toFixed(1)}" y="${Math.max(cy - 9, 12).toFixed(1)}" text-anchor="${anchor(cx)}">${this.escape(note.label)} ${this.escape(this.money(note.value))}</text><title>${this.escape(when)}</title></g>`;
    }).join("");
    const hover = `<g class="ml-hover" visibility="hidden"><line class="ml-hover-guide" y1="${pad.top}" y2="${height - pad.bottom}"></line>${lines.map((line) => `<circle class="ml-hover-dot ${line.className}" r="4.5"></circle>`).join("")}</g>`;
    const hit = `<rect class="ml-hover-hit" x="${pad.left}" y="${pad.top}" width="${width - pad.right - pad.left}" height="${height - pad.bottom - pad.top}" fill="transparent"></rect>`;
    const data = JSON.stringify(payload).replace(/</g, "\\u003c");
    const label = this.escape(lines.map((l) => l.label).join(" vs "));
    return `${this.chartScroll(`<div class="ml-chart-wrap"><svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}" tabindex="0">${ticks}${labels}${paths}${marks}${hover}${hit}</svg><div class="ml-tooltip" hidden></div><script type="application/json" class="ml-hover-data">${data}</script></div>`, width)}<div class="ml-legend">${legend}</div>`;
  },

  bindChartHover(node) {
    if (!node || typeof node.querySelectorAll !== "function") return;
    node.querySelectorAll(".ml-chart-wrap").forEach((wrap) => {
      if (wrap.dataset.bound) return;
      const raw = wrap.querySelector(".ml-hover-data");
      const svg = wrap.querySelector("svg");
      const hit = wrap.querySelector(".ml-hover-hit");
      const tip = wrap.querySelector(".ml-tooltip");
      const hover = wrap.querySelector(".ml-hover");
      const guide = wrap.querySelector(".ml-hover-guide");
      if (!raw || !svg || !hit || !tip || !hover || !guide) return;
      let points;
      try { points = JSON.parse(raw.textContent); } catch (error) { return; }
      if (!points.length) return;
      wrap.dataset.bound = "1";
      const dots = [...hover.querySelectorAll(".ml-hover-dot")];
      let active = 0;
      const showIndex = (index, clientX, clientY) => {
        active = Math.max(0, Math.min(points.length - 1, index));
        const row = points[active];
        hover.removeAttribute("visibility");
        guide.setAttribute("x1", row.x);
        guide.setAttribute("x2", row.x);
        dots.forEach((dot, i) => {
          const point = row.values[i];
          if (!point || point.y == null) {
            dot.setAttribute("visibility", "hidden");
            return;
          }
          dot.removeAttribute("visibility");
          dot.setAttribute("cx", row.x);
          dot.setAttribute("cy", point.y);
        });
        tip.hidden = false;
        tip.innerHTML = `<strong>${this.escape(this.shortDate(row.label))}</strong>${row.values.map((point) => {
          const text = point.value == null ? "–" : this.money(point.value);
          return `<span class="${this.escape(point.className)}"><i></i>${this.escape(point.label)} <b>${this.escape(text)}</b></span>`;
        }).join("")}`;
        if (clientX == null) return;
        const bounds = wrap.getBoundingClientRect();
        const viewport = (wrap.closest(".ml-chart-scroll") || wrap).getBoundingClientRect();
        tip.style.minWidth = `${Math.min(196, viewport.width - 16)}px`;
        tip.style.maxWidth = `${viewport.width - 16}px`;
        const left = Math.max(8, viewport.left - bounds.left + 8);
        const right = Math.min(bounds.right, viewport.right) - bounds.left - tip.offsetWidth - 8;
        const bottom = Math.min(bounds.bottom, viewport.bottom) - bounds.top - tip.offsetHeight - 8;
        tip.style.left = `${Math.max(left, Math.min(clientX - bounds.left + 14, right))}px`;
        tip.style.top = `${Math.max(8, Math.min(clientY - bounds.top - 8, bottom))}px`;
      };
      const hide = () => {
        hover.setAttribute("visibility", "hidden");
        tip.hidden = true;
      };
      const nearest = (event) => {
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const matrix = svg.getScreenCTM();
        if (!matrix) return active;
        const loc = point.matrixTransform(matrix.inverse());
        let best = 0;
        let bestDist = Infinity;
        points.forEach((row, i) => {
          const dist = Math.abs(row.x - loc.x);
          if (dist < bestDist) { best = i; bestDist = dist; }
        });
        return best;
      };
      hit.addEventListener("pointermove", (event) => showIndex(nearest(event), event.clientX, event.clientY));
      hit.addEventListener("pointerleave", hide);
      svg.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = Math.max(0, Math.min(points.length - 1, active + (event.key === "ArrowRight" ? 1 : -1)));
        const scroller = wrap.closest(".ml-chart-scroll");
        if (scroller) {
          const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
          scroller.scrollLeft = Math.max(0, points[index].x * scale - scroller.clientWidth / 2);
        }
        const bounds = (scroller || svg).getBoundingClientRect();
        showIndex(index, bounds.left + bounds.width / 2, bounds.top + 28);
      });
      svg.addEventListener("blur", hide);
    });
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
    const axis = [Math.min(...weeks), 0, Math.max(...weeks)].map((week, index) =>
      `<text class="ml-axis" x="${x(week).toFixed(1)}" y="${height - 10}" text-anchor="${["start", "middle", "end"][index]}">${week === 0 ? "Tony night" : `Week ${week}`}</text>`).join("");
    const yTicks = [low, high].map((value) =>
      `<text class="ml-axis" x="${pad.left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${this.percent(value, 0, true)}</text>`).join("");
    return this.chartScroll(`<svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Event study: winners versus losing nominees by week">${zero}${ceremony}${marks}${axis}${yTicks}</svg>`, width);
  },

  async load(name) {
    const response = await fetch(`ml/${name}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  },

  set(doc, id, html) {
    const node = doc.getElementById(id);
    if (!node) return;
    node.innerHTML = html;
    this.bindChartHover(node);
  },

  card(title, value, detail, tone = "") {
    return `<article class="ml-card ${tone}"><h3>${this.escape(title)}</h3><strong>${this.escape(value)}</strong><p>${this.escape(detail)}</p></article>`;
  },

  renderMetrics(doc, metrics) {
    if (metrics.dataThrough) this.set(doc, "ml-data-through", this.escape(metrics.dataThrough));
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
    this.set(doc, "ml-features", metrics.topGrossFeatures.slice(0, 5).map((f) =>
      `<li><div><strong>${this.escape(this.featureLabel(f.feature))}</strong><small>${this.escape(this.featureDescription(f.feature))}</small></div><b><span>R² drop</span>${this.number(f.importance, 4)}</b></li>`).join(""));
  },

  featureLabels: {
    log_gross: "This week's gross",
    log_gross_l1: "Gross 1 week ago",
    log_gross_l2: "Gross 2 weeks ago",
    log_gross_l3: "Gross 3 weeks ago",
    chg_1: "Week-to-week momentum",
    chg_4: "Four-week momentum",
    roll4: "Average gross, last 4 weeks",
    roll8: "Average gross, last 8 weeks",
    std8: "How bumpy gross has been (8 weeks)",
    from_peak: "Distance below the show's peak",
    capacity: "Share of seats filled",
    capacity_l1: "Seats filled last week",
    capacity_chg4: "Change in seats filled, 4 weeks",
    avg_ticket: "Average ticket price",
    log_available: "Seats available for sale",
    log_run_age: "How long it has run",
    target_woy: "Season and calendar week",
    market_log_gross: "Whole-Broadway gross this week",
    market_chg_1: "Whole-Broadway change since last week",
    shows_running: "Number of shows running",
    tony_noms: "Tony nominations",
    tony_wins: "Tony wins",
    weeks_since_tony: "Weeks since Tony night",
  },

  featureLabel(name) {
    return this.featureLabels[name] || String(name).replace(/_/g, " ");
  },

  featureDescriptions: {
    target_woy: "Holiday, tourism, and seasonal patterns shift demand across the year.",
    log_available: "House size × scheduled performances sets the maximum sales capacity.",
    chg_1: "A recent acceleration or slowdown signals the direction of demand.",
    chg_4: "The four-week trend is less sensitive to one unusually strong or weak week.",
    from_peak: "Distance from the show's best week helps distinguish a dip from a sustained decline.",
  },

  featureDescription(name) {
    return this.featureDescriptions[name] || "A recent input used to estimate next week's gross.";
  },

  renderBacktest(doc, backtest) {
    const rows = backtest.market.map((r) => ({ label: r.week, actual: r.actual, model: r.model, baseline: r.baseline }));
    const lines = [
      { key: "actual", label: "Actual", className: "actual" },
      { key: "model", label: "Model forecast", className: "model" },
      { key: "baseline", label: "Seasonal baseline", className: "baseline" },
    ];
    const notes = this.marketNotes(rows);
    this.set(doc, "ml-market-chart", this.lineChart(this.withoutGaps(rows, notes, ["actual", "model", "baseline"]), lines,
      { format: (v) => this.money(v), notes }));
    const select = doc.getElementById("ml-show-select");
    if (!select) return;
    const shows = Object.keys(backtest.shows);
    select.innerHTML = shows.map((s) => `<option>${this.escape(s)}</option>`).join("");
    if (shows.includes("Wicked")) select.value = "Wicked";
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
    this.set(doc, "ml-predictions", predictions.predictions.map((p, index) => {
      const risk = Math.round(100 * p.closeProbability);
      return `<tr class="ml-risk-row" data-risk-show="${this.escape(p.show.toLocaleLowerCase())}" data-risk="${p.closeProbability}" data-capacity="${p.capacity}">
        <td class="ml-risk-rank">${String(index + 1).padStart(2, "0")}</td>
        <th scope="row"><strong>${this.escape(p.show)}</strong></th>
        <td class="ml-risk-cell">
          <strong>${this.percent(100 * p.closeProbability, 0)}</strong>
          <div class="ml-risk-meter" aria-hidden="true"><i style="--risk:${risk}%"></i></div>
        </td>
        <td class="ml-risk-capacity"><strong>${this.percent(100 * p.capacity, 0)}</strong><span>occupied</span></td>
        <td>${this.riskReasons(p.riskDrivers)}</td>
      </tr>`;
    }).join(""));
    this.bindPredictionControls(doc, predictions.predictions.length);
  },

  bindPredictionControls(doc, total) {
    const list = doc.getElementById("ml-predictions");
    const search = doc.getElementById("ml-risk-search");
    const toggle = doc.getElementById("ml-risk-toggle");
    const status = doc.getElementById("ml-risk-count");
    if (!list || !search || !toggle || !status) return;
    const rows = [...list.querySelectorAll(".ml-risk-row")];
    const sortButtons = [...doc.querySelectorAll("[data-risk-sort]")];
    let expanded = false;
    let sortState = { key: "risk", direction: "desc" };
    const previewLimit = 10;
    const update = () => {
      const query = search.value.trim().toLocaleLowerCase();
      let matched = 0;
      rows.forEach((row) => {
        const matches = !query || row.dataset.riskShow.includes(query);
        if (matches) matched += 1;
        row.hidden = !matches || (!query && !expanded && matched > previewLimit);
      });
      const shown = rows.filter((row) => !row.hidden).length;
      status.textContent = query
        ? `${shown} of ${total} productions match`
        : `Showing ${shown} of ${total} productions`;
      toggle.hidden = Boolean(query) || total <= previewLimit;
      toggle.textContent = expanded ? `Show top ${previewLimit}` : `Show all ${total}`;
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    };
    const sort = (key) => {
      if (sortState.key === key) {
        sortState.direction = sortState.direction === "desc" ? "asc" : "desc";
      } else {
        sortState = { key, direction: "desc" };
      }
      rows.sort((a, b) => {
        const difference = Number(a.dataset[key]) - Number(b.dataset[key]);
        return sortState.direction === "asc" ? difference : -difference;
      }).forEach((row) => list.append(row));
      rows.forEach((row, index) => {
        row.querySelector(".ml-risk-rank").textContent = String(index + 1).padStart(2, "0");
      });
      sortButtons.forEach((button) => {
        const header = button.closest("th");
        const active = button.dataset.riskSort === sortState.key;
        header.setAttribute("aria-sort", active ? (sortState.direction === "desc" ? "descending" : "ascending") : "none");
        button.querySelector("span").textContent = active ? (sortState.direction === "desc" ? "▼" : "▲") : "";
      });
      update();
    };
    search.addEventListener("input", update);
    toggle.addEventListener("click", () => { expanded = !expanded; update(); });
    sortButtons.forEach((button) => button.addEventListener("click", () => sort(button.dataset.riskSort)));
    update();
  },

  riskReasons(drivers) {
    if (!drivers || !drivers.length) return '<span class="ml-reason-none">No single input moves the estimate far from a typical running show.</span>';
    return `<ul class="ml-reasons">${drivers.map((d) => {
      const up = d.direction === "raises";
      return `<li class="${up ? "up" : "down"}"><b aria-label="${up ? "raises" : "lowers"} risk">${up ? "&uarr;" : "&darr;"}</b> ${this.escape(d.text)} <small>${up ? "+" : "&minus;"}${Math.abs(Math.round(d.points))} pts</small></li>`;
    }).join("")}</ul>`;
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

  pct(effect) {
    return Number.isFinite(effect?.percent) ? effect.percent : NaN;
  },

  rangeValues(ci, digits = 1, unit = "%", sep = " and ") {
    if (!Array.isArray(ci) || !ci.every(Number.isFinite)) return "unavailable";
    const signed = ci.some((v) => v < 0);
    const f = (v) => `${signed && v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;
    return `${f(ci[0])}${sep}${f(ci[1])}`;
  },

  range(ci, digits = 1, unit = "%") {
    return `best single estimate; the real value could be anywhere from ${this.rangeValues(ci, digits, unit, " to ")}`;
  },

  example(percent, base = 1e6) {
    return `${this.money(base)} → ${this.money(base * (1 + percent / 100))}`;
  },

  nullCheck(effect, what) {
    if (!effect) return "";
    return this.excludesZero(effect.percentCi95)
      ? `It was not near zero (${this.range(effect.percentCi95)}), so treat the ${what} result with extra caution.`
      : `It came out near zero (${this.range(effect.percentCi95)}, which includes 0), which is what we want.`;
  },

  groups: [["notNominated", "Not nominated", "g-not"], ["nominatedLost", "Nominated, didn't win", "g-lost"], ["won", "Won", "g-won"]],

  pValue(p) {
    if (!Number.isFinite(p)) return "–";
    return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`;
  },

  causalBullets(causal) {
    const win = causal.effects.weeklyGross;
    const nom = causal.nomination?.effects?.weeklyGross;
    const runs = causal.nomination?.runLength;
    const rows = [];
    if (nom) {
      rows.push(["Nomination day", `Weekly gross grew <b>${this.percent(this.pct(nom), 0, true)}</b> more than same-season shows that weren't nominated.`,
        `${this.money(5e5)} → <b>${this.money(5e5 * (1 + this.pct(nom) / 100))}</b> a week`]);
    }
    rows.push(["Tony night: win", `In the 8 weeks after, winners took in <b>${this.percent(this.pct(win), 0, true)}</b> more per week than nominees that lost.`,
      `${this.money(1e6)} → <b>${this.money(1e6 * (1 + this.pct(win) / 100))}</b> a week`]);
    const g = runs?.groups;
    const fit = runs?.winnersVsLosers?.["26"]?.won;
    if (g && fit) {
      rows.push(["Run length", `Half of winners were still running <b>${g.won.medianWeeksAfterTony} weeks</b> after Tony night. Half of nominees that lost closed within <b>${g.nominatedLost.medianWeeksAfterTony} weeks</b>; shows not nominated within <b>${g.notNominated.medianWeeksAfterTony} weeks</b>.`,
        `Winners <b>${this.signed(fit.points, 0)} pts</b> more likely to be open at 6 months (vs. losers with similar sales)`]);
    }
    const cat = causal.categories?.byGroup?.afterTonySales;
    const prod = cat?.won_production;
    if (prod && Number.isFinite(prod.percent)) {
      const others = [["acting", cat.won_acting], ["creative", cat.won_creative]].filter(([, e]) => e && Number.isFinite(e.percent))
        .map(([name, e]) => `${name} wins <b>${this.percent(e.percent, 0, true)}</b>`).join(", ");
      rows.push(["Which award", `Winning a production award (Best Play, Musical or Revival) added <b>${this.percent(prod.percent, 0, true)}</b> (95% range ${this.range(prod.percentCi95)})${others ? `; ${others}` : ""}.`,
        `${this.money(1e6)} → <b>${this.money(1e6 * (1 + prod.percent / 100))}</b> a week for a top-prize winner`]);
    }
    const body = rows.map(([moment, saw, money]) => `<tr><th scope="row">${moment}</th><td>${saw}</td><td>${money}</td></tr>`).join("");
    return `<table class="ml-table ml-findings"><thead><tr><th>Moment</th><th>What we found</th><th>What it means for a typical show</th></tr></thead><tbody>${body}</tbody></table>`;
  },

  lifecycleChart(lifecycle, { width = 760, height = 320 } = {}) {
    if (!lifecycle) return '<p class="ml-empty">No lifecycle data yet.</p>';
    const pad = { left: 48, right: 16, top: 20, bottom: 44 };
    const phases = [["beforeNomination", "Before nomination"], ["afterNomination", "Nomination → Tony night"], ["afterTony", "8 weeks after Tony night"]];
    const spreads = this.groups.flatMap(([key]) => ["afterNomination", "afterTony"].map((p) => lifecycle[key]?.[`${p}Spread`]).filter(Boolean));
    const values = spreads.flatMap((s) => [s.p10, s.p90]).filter(Number.isFinite).concat([100]);
    const low = Math.floor(Math.min(...values) / 25) * 25;
    const high = Math.ceil(Math.max(...values) / 25) * 25;
    const y = this.scale([low, high], [height - pad.bottom, pad.top]);
    const x = this.scale([0, phases.length - 1], [pad.left + 70, width - pad.right - 70]);
    const offset = (i) => (i - 1) * 34;
    const ticks = [];
    for (let v = low; v <= high; v += 25) {
      ticks.push(`<g class="ml-tick"><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"></line><text x="${pad.left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text></g>`);
    }
    const base = `<line class="ml-baseline" x1="${pad.left}" x2="${width - pad.right}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}"></line>`;
    const marks = this.groups.map(([key, label, cls], i) => {
      const g = lifecycle[key];
      if (!g) return "";
      const points = phases.map(([p], j) => [x(j) + offset(i), j === 0 ? 100 : g[p]]).filter(([, v]) => Number.isFinite(v));
      const path = points.map(([px, v], j) => `${j ? "L" : "M"}${px.toFixed(1)},${y(v).toFixed(1)}`).join("");
      const boxes = phases.slice(1).map(([p], j) => {
        const s = g[`${p}Spread`];
        if (!s) return "";
        const cx = x(j + 1) + offset(i);
        const shows = g[`${p}Shows`];
        return `<g class="ml-box ${cls}"><title>${this.escape(label)}, ${this.escape(phases[j + 1][1])}: median ${s.p50} (middle half ${s.p25}–${s.p75}), ${shows} shows</title><line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(s.p10).toFixed(1)}" y2="${y(s.p90).toFixed(1)}"></line><rect x="${(cx - 11).toFixed(1)}" y="${y(s.p75).toFixed(1)}" width="22" height="${Math.max(1, y(s.p25) - y(s.p75)).toFixed(1)}" rx="3"></rect><line class="ml-median" x1="${(cx - 11).toFixed(1)}" x2="${(cx + 11).toFixed(1)}" y1="${y(s.p50).toFixed(1)}" y2="${y(s.p50).toFixed(1)}"></line><text x="${cx.toFixed(1)}" y="${(y(s.p90) - 6).toFixed(1)}" text-anchor="middle">${Math.round(s.p50)}</text></g>`;
      }).join("");
      return `<g class="ml-track ${cls}"><path d="${path}"></path><circle cx="${(x(0) + offset(i)).toFixed(1)}" cy="${y(100).toFixed(1)}" r="5"></circle></g>${boxes}`;
    }).join("");
    const axis = phases.map(([, label], j) => `<text class="ml-axis" x="${x(j).toFixed(1)}" y="${height - 14}" text-anchor="middle">${this.escape(label)}</text>`).join("");
    const legendLabels = { notNominated: "Not nominated", nominatedLost: "Nominated, no win", won: "Nominated and won" };
    const legend = this.groups.map(([key, , cls]) => `<span class="ml-legend-item ${cls}">${this.escape(legendLabels[key])} (${lifecycle[key]?.shows ?? 0} records)</span>`).join("");
    const note = '<p class="ml-note"><strong>What is counted?</strong> One record is one show production in one Tony season, not one season or one award. The two nominated groups together make up all nominees in this chart; winners are a subset of nominees, not an additional group outside them. Here, nomination and win refer to production awards (Best Play, Musical or Revival); shows nominated only in other categories are excluded. These are records in the filtered study sample, not the complete Tony nominee and winner totals.</p>';
    return `${this.chartScroll(`<svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly gross index by Tony outcome over three moments">${ticks.join("")}${base}${marks}${axis}</svg>`, width)}<div class="ml-legend">${legend}</div>${note}`;
  },

  runChart(runLength, { width = 760, height = 280 } = {}) {
    const groups = runLength?.groups;
    if (!groups) return '<p class="ml-empty">No run-length data yet.</p>';
    const pad = { left: 48, right: 16, top: 16, bottom: 36 };
    const weeks = Math.max(...this.groups.map(([key]) => (groups[key]?.curve.length || 1) - 1));
    const x = this.scale([0, weeks], [pad.left, width - pad.right]);
    const y = this.scale([0, 100], [height - pad.bottom, pad.top]);
    const ticks = [0, 50, 100].map((v) => `<g class="ml-tick"><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}"></line><text x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text></g>`).join("");
    const marks = (runLength.horizons || []).map((h) => `<g class="ml-horizon"><line x1="${x(h).toFixed(1)}" x2="${x(h).toFixed(1)}" y1="${pad.top}" y2="${height - pad.bottom}"></line><text x="${x(h).toFixed(1)}" y="${height - 12}" text-anchor="middle">${h === 13 ? "3 mo" : h === 26 ? "6 mo" : h === 52 ? "1 yr" : `${h} wk`}</text></g>`).join("");
    const lines = this.groups.map(([key, label, cls]) => {
      const curve = groups[key]?.curve || [];
      let d = "";
      curve.forEach((v, w) => { d += w ? `H${x(w).toFixed(1)}V${y(v).toFixed(1)}` : `M${x(0).toFixed(1)},${y(v).toFixed(1)}`; });
      return `<path class="ml-km ${cls}" d="${d}"><title>${this.escape(label)}: median ${groups[key]?.medianWeeksAfterTony ?? "–"} weeks</title></path>`;
    }).join("");
    const start = `<text class="ml-axis" x="${pad.left}" y="${height - 12}">Tony night</text><text class="ml-axis" x="${width - pad.right}" y="${height - 12}" text-anchor="end">2 years</text>`;
    const legend = this.groups.map(([key, label, cls]) => `<span class="ml-legend-item ${cls}">${this.escape(label)}: half closed by week ${groups[key]?.medianWeeksAfterTony ?? "–"} (${groups[key]?.shows ?? 0} shows)</span>`).join("");
    return `${this.chartScroll(`<svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Share of shows still running after Tony night, by Tony outcome">${ticks}${marks}${lines}${start}</svg>`, width)}<div class="ml-legend">${legend}</div>`;
  },

  runBullets(runLength, closed) {
    if (!runLength) return "";
    const p = runLength.logRankP || {};
    const reg = runLength.regression || {};
    const wl = runLength.winnersVsLosers || {};
    const plays = runLength.playsOnly || {};
    const pts = (fit) => `<b>${this.signed(fit.points, 0)} pts</b><small>${this.number(fit.ci95[0], 0)} to ${this.number(fit.ci95[1], 0)}</small>`;
    const horizon = { 13: "3 months", 26: "6 months", 52: "1 year" };
    const rows = runLength.horizons.map((h) => {
      const r = reg[h], w = wl[h]?.won, pl = plays[h]?.won;
      return r && w ? `<tr><th scope="row">${horizon[h] || `${h} weeks`}</th><td>${pts(r.won)}</td><td>${pts(r.nominatedLost)}</td><td>${pts(w)}</td><td>${pl ? pts(pl) : "–"}</td></tr>` : "";
    }).join("");
    const bullets = [
      `<b>Without adjusting for anything:</b> winners' curve is clearly different from losing nominees' (${this.pValue(p.wonVsLost)}). Losing nominees and shows that weren't nominated look much closer (${this.pValue(p.lostVsNotNominated)}, not a clear difference).`,
      "<b>With adjustments:</b> a linear regression of \"still open after 3 months / 6 months / 1 year\" on Tony outcome, holding equal each show's sales and seats filled before nominations, how long it had already been running on Tony night, and the season. The table shows the result.",
      "<b>Contracts matter.</b> Many plays and star vehicles open as limited engagements with a closing date set in advance, so a short run isn't always a flop. We can't see contracts in the data. Show age and pre-nomination sales partly account for differences; the plays-only column is a sensitivity check, not a direct control for contracts. Read its confidence intervals rather than assuming the difference disappears.",
    ];
    if (closed) {
      bullets.push(`<b>Another check:</b> comparing winners and losing nominees with similar sales in the 8 weeks <em>right before</em> Tony night gives ${this.signed(-100 * closed.estimate, 0)} points still open at 6 months (${this.range(closed.ci95.map((v) => -100 * v).reverse(), 0, "")} points). ${this.excludesZero(closed.ci95) ? "This interval excludes zero." : "This interval includes zero, so the difference is uncertain."} This is an association, not proof that the award extended the run.`);
    }
    return `<div class="ml-table-wrap"><p class="ml-note">Extra chance of still being open, in percentage points. Small numbers give the 95% confidence interval; if it includes 0, the difference isn't clear.</p><table class="ml-table ml-runs"><thead><tr><th>Still open after</th><th>Won vs. not nominated</th><th>Lost vs. not nominated</th><th>Won vs. lost</th><th>Won vs. lost, plays only</th></tr></thead><tbody>${rows}</tbody></table></div><ul class="ml-list ml-bullets">${bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`;
  },

  modelTable(comparison) {
    if (!comparison?.won?.length) return "";
    const cell = (row) => row ? `<b>${this.percent(row.percent, 0, true)}</b><small>${this.rangeValues(row.percentCi95, 0)}</small>` : "–";
    const find = (key, model) => (comparison[key] || []).find((r) => r.model === model);
    const rows = comparison.won.map((r) => `<tr><th scope="row">${this.escape(r.model)}</th><td>${cell(find("nominated", r.model))}</td><td>${cell(r)}</td><td>${cell(find("wonPlacebo", r.model))}</td></tr>`).join("");
    const all = ["won", "nominated"].map((k) => comparison[k].map((r) => r.percent));
    const span = (v) => `${this.number(Math.min(...v), 0)}% to ${this.number(Math.max(...v), 0)}%`;
    return `<table class="ml-table ml-runs"><thead><tr><th>Method</th><th>Nominated vs. not</th><th>Won vs. lost</th><th>Fake-date check (win)</th></tr></thead><tbody>${rows}</tbody></table><ul class="ml-list ml-bullets"><li><b>Same answer every way.</b> Winning: ${span(all[0])}. Nomination: ${span(all[1])}. All ranges overlap, so the result doesn't depend on the linear model.</li><li><b>Why not pick the biggest number?</b> These methods don't compete on size. They all estimate the same gap, and checking that they agree is the point. Choosing the largest would overstate the effect.</li><li><b>Why not plain lasso or XGBoost?</b> Plain lasso shrinks the Tony coefficient toward zero, and a boosted tree gives predictions, not one effect size. So lasso is used only to choose controls, and the tree models only to strip out the controls' effect before the Tony gap is measured (double machine learning).</li><li><b>Fake-date check:</b> the tree models find a small gap on the fake date (up to ${this.percent(Math.max(...comparison.wonPlacebo.map((r) => r.percent)), 0, true)}), a hint that part of the win gap is winners' head start.</li></ul>`;
  },

  categoryTakeaways(categories) {
    const g = categories?.byGroup;
    if (!g) return "";
    const pct = (e) => this.percent(e.percent, 0, true);
    const pts = (e) => `${this.signed(e.points, 0)} pts`;
    const clear = (e, unit) => this.excludesZero(e[`${unit}Ci95`]);
    const actNom = g.nominationSales.nom_acting;
    const actWin = g.afterTonySales.won_acting;
    const actRun = g.stillOpen26.won_acting;
    const items = [
      ["production", "Best Musical / Play / Revival wins move sales the most",
        `${pct(g.afterTonySales.won_production)} weekly gross after a production win, vs ${pct(actWin)} for acting and ${pct(g.afterTonySales.won_creative)} for creative.`],
      ["creative", "Creative & design wins go with longer runs",
        `${pts(g.stillOpen26.won_creative)} more likely to still be open at 6 months. A production win alone: ${pts(g.stillOpen26.won_production)}${clear(g.stillOpen26.won_production, "points") ? "" : " (not clear)"}.`],
      ["acting", "Acting awards: sales and run-length associations",
        `Nomination ${pct(actNom)}${clear(actNom, "percent") ? "" : " (not clear)"}; a win is associated with ${pct(actWin)} in sales and ${pts(actRun)}${clear(actRun, "points") ? "" : " (not clear)"} on run length.`],
    ];
    return `<ol class="ml-takeaways">${items.map(([k, title, text]) =>
      `<li class="${k}"><b>${this.escape(title)}</b><span>${this.escape(text)}</span></li>`).join("")}</ol>`;
  },

  // Dot-and-range chart: one panel per outcome, one row per category group.
  categoryChart(categories) {
    const g = categories?.byGroup;
    if (!g) return "";
    const groups = [["production", "Production"], ["acting", "Acting"], ["creative", "Creative & design"]];
    const panels = [
      ["Sales after nomination", "percent", (k) => g.nominationSales[`nom_${k}`]],
      ["Extra sales after winning", "percent", (k) => g.afterTonySales[`won_${k}`]],
      ["Still open at 6 months, if won", "points", (k) => g.stillOpen26[`won_${k}`]],
    ];
    const width = 300, rowH = 44;
    const pad = { left: 104, right: 18, top: 10, bottom: 26 };
    const height = pad.top + rowH * groups.length + pad.bottom;
    const fmt = (v, unit) => unit === "percent" ? this.percent(v, 0, true) : `${this.signed(v, 0)} pts`;
    const svgs = panels.map(([title, unit, pick]) => {
      const rows = groups.map(([k, name]) => ({ k, name, e: pick(k) })).filter((r) => r.e);
      const ext = rows.flatMap((r) => r.e[`${unit}Ci95`] || [r.e[unit]]).concat([0]);
      const lo = Math.floor(Math.min(...ext) / 10) * 10;
      const hi = Math.ceil(Math.max(...ext) / 10) * 10;
      const x = this.scale([lo, hi], [pad.left, width - pad.right]);
      const best = rows.filter((r) => this.excludesZero(r.e[`${unit}Ci95`]))
        .reduce((a, b) => (!a || b.e[unit] > a.e[unit] ? b : a), null);
      const marks = rows.map((r, i) => {
        const cy = pad.top + rowH * i + rowH / 2;
        const [a, b] = r.e[`${unit}Ci95`] || [r.e[unit], r.e[unit]];
        const clear = this.excludesZero([a, b]);
        const cls = !clear ? "unclear" : r === best ? "best" : "clear";
        const dml = r.e.doubleML?.[unit];
        const tip = `${r.name}: ${fmt(r.e[unit], unit)} (95% range ${fmt(a, unit)} to ${fmt(b, unit)})${Number.isFinite(dml) ? `; gradient boosting ${fmt(dml, unit)}` : ""}${clear ? "" : " · not clearly different from zero"}`;
        const dmlMark = Number.isFinite(dml)
          ? `<path class="ml-cat-dml" d="M${x(dml).toFixed(1)},${(cy - 5).toFixed(1)}l5,5l-5,5l-5,-5z"></path>` : "";
        return `<g class="ml-cat ${cls}"><title>${this.escape(tip)}</title><text class="ml-cat-name" x="${pad.left - 10}" y="${(cy + 4).toFixed(1)}" text-anchor="end">${this.escape(r.name)}</text><line x1="${x(a).toFixed(1)}" x2="${x(b).toFixed(1)}" y1="${cy}" y2="${cy}"></line>${dmlMark}<circle cx="${x(r.e[unit]).toFixed(1)}" cy="${cy}" r="6"></circle><text class="ml-cat-value" x="${x(r.e[unit]).toFixed(1)}" y="${(cy - 11).toFixed(1)}" text-anchor="middle">${this.escape(fmt(r.e[unit], unit))}</text></g>`;
      }).join("");
      const zero = `<line class="ml-zero" x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="${pad.top}" y2="${height - pad.bottom}"></line>`;
      const axis = [lo, 0, hi].filter((v, i, all) => all.indexOf(v) === i).map((v) =>
        `<text class="ml-axis" x="${x(v).toFixed(1)}" y="${height - 8}" text-anchor="middle">${this.escape(fmt(v, unit))}</text>`).join("");
      return `<figure class="ml-cat-panel"><figcaption>${this.escape(title)}</figcaption>${this.chartScroll(`<svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.escape(title)} by category group">${zero}${marks}${axis}</svg>`, width)}</figure>`;
    }).join("");
    return `<div class="ml-cat-grid">${svgs}</div><p class="ml-legend ml-cat-legend"><span class="ml-cat-key best">Biggest clear effect</span><span class="ml-cat-key clear">Clear effect</span><span class="ml-cat-key unclear">Not clearly different from zero</span><span class="ml-cat-key dml">Same effect from gradient boosting</span><span>Line = 95% range</span></p>`;
  },

  // Box plots of per-show outcomes: not nominated vs nominated/lost/won within each category group.
  categoryBoxChart(boxes, { width = 760, height = 290 } = {}) {
    if (!boxes?.afterTonySales) return "";
    const groupName = { none: "Not nominated", production: "Production", acting: "Acting", creative: "Creative & design" };
    const statusName = { none: "any category", nominated: "nominated", lost: "nominated, lost", won: "won" };
    const pct = (v) => this.percent(v, 0, true);
    const wks = (v) => `${this.number(v, 0)} wk`;
    const cap = boxes.weeksCap || 52;
    const panels = [
      ["Being nominated: change in weekly gross, nomination → Tony night", boxes.nominationSales, pct, true],
      ["Winning: change in weekly gross, 8 weeks after vs. before Tony night", boxes.afterTonySales, pct, true],
      [`Winning: weeks still running after Tony night (capped at ${cap})`, boxes.weeksOpen, wks, false],
    ];
    return panels.map(([title, rows, fmt, signed]) => {
      rows = (rows || []).filter((b) => b.shows > 0);
      if (!rows.length) return "";
      const pad = { left: 56, right: 12, top: 22, bottom: 50 };
      const values = rows.flatMap((b) => [b.p10, b.p90]).concat([0]);
      const tick = signed ? 10 : 13;
      const low = Math.floor(Math.min(...values) / tick) * tick;
      const high = Math.ceil(Math.max(...values) / tick) * tick;
      const y = this.scale([low, high], [height - pad.bottom, pad.top]);
      const ticks = [];
      for (let v = low; v <= high; v += tick * (high - low > 60 ? 2 : 1)) {
        ticks.push(`<g class="ml-tick"><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"></line><text x="${pad.left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${this.escape(signed ? pct(v) : this.number(v, 0))}</text></g>`);
      }
      const zero = signed ? `<line class="ml-zero" x1="${pad.left}" x2="${width - pad.right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"></line>` : "";
      // Slots: boxes of the same group sit together, with a gap between groups.
      const slots = [];
      rows.forEach((b, i) => {
        if (i && rows[i - 1].group !== b.group) slots.push(null);
        slots.push(b);
      });
      const step = (width - pad.left - pad.right) / slots.length;
      const w = Math.min(46, step * 0.62);
      const groupLabels = [];
      const shapes = slots.map((b, i) => {
        if (!b) return "";
        const cx = pad.left + step * (i + 0.5);
        const cls = b.status === "none" ? "g-not" : b.status === "won" ? "g-won" : "g-lost";
        const first = slots[i - 1]?.group !== b.group;
        if (first) {
          const n = slots.slice(i).findIndex((s, k) => k && (!s || s.group !== b.group));
          const span = n === -1 ? slots.length - i : n;
          groupLabels.push(`<text class="ml-axis ml-box-group" x="${(cx + step * (span - 1) / 2).toFixed(1)}" y="${height - 10}" text-anchor="middle">${this.escape(groupName[b.group])}</text>`);
        }
        const tip = `${groupName[b.group]}, ${statusName[b.status]} (${b.shows} shows): median ${fmt(b.p50)}, middle half ${fmt(b.p25)} to ${fmt(b.p75)}`;
        return `<g class="ml-box ${cls}"><title>${this.escape(tip)}</title><line x1="${cx}" x2="${cx}" y1="${y(b.p10).toFixed(1)}" y2="${y(b.p90).toFixed(1)}"></line><rect x="${(cx - w / 2).toFixed(1)}" y="${y(b.p75).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, y(b.p25) - y(b.p75)).toFixed(1)}"></rect><line class="ml-box-median" x1="${(cx - w / 2).toFixed(1)}" x2="${(cx + w / 2).toFixed(1)}" y1="${y(b.p50).toFixed(1)}" y2="${y(b.p50).toFixed(1)}"></line><text class="ml-box-label" x="${cx}" y="${(y(b.p90) - 6).toFixed(1)}" text-anchor="middle">${this.escape(fmt(b.p50))}</text><text class="ml-axis" x="${cx}" y="${height - 30}" text-anchor="middle">${this.escape(b.status === "none" ? "" : b.status === "lost" ? "lost" : b.status)} (${b.shows})</text></g>`;
      }).join("");
      return `<figure class="ml-box-panel"><figcaption>${this.escape(title)}</figcaption>${this.chartScroll(`<svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.escape(title)}, by Tony category group">${ticks.join("")}${zero}${shapes}${groupLabels.join("")}</svg>`, width)}</figure>`;
    }).join("") + `<p class="ml-legend ml-cat-legend"><span class="ml-cat-key g-not">Not nominated</span><span class="ml-cat-key g-lost">Nominated (lost)</span><span class="ml-cat-key g-won">Won</span><span>Box = middle half of shows · whiskers = 80% · number = median show · (n) = shows</span></p>`;
  },

  categoryTable(categories) {
    const g = categories?.byGroup;
    if (!g) return "";
    const label = { production: "Production (Best Musical, Play, Revival)", acting: "Acting (Actor / Actress)", creative: "Creative & design" };
    const cell = (e, unit) => {
      if (!e) return "–";
      const v = e[unit];
      const dml = e.doubleML?.[unit];
      const fmt = (x) => unit === "percent" ? this.percent(x, 0, true) : `${this.signed(x, 0)} pts`;
      const clear = this.excludesZero(e[`${unit}Ci95`]);
      return `<b class="${clear ? "" : "ml-muted"}">${fmt(v)}</b><small>Gradient boosting: ${fmt(dml)}${clear ? "" : " · not clear"}</small>`;
    };
    const rows = ["production", "acting", "creative"].map((k) => `<tr><th scope="row">${label[k]}</th><td>${cell(g.nominationSales[`nom_${k}`], "percent")}</td><td>${cell(g.afterTonySales[`won_${k}`], "percent")}</td><td>${cell(g.stillOpen26[`won_${k}`], "points")}</td></tr>`).join("");
    return `<table class="ml-table ml-runs"><thead><tr><th>Category group</th><th>Sales after nomination</th><th>Extra sales after winning</th><th>Extra chance still open at 6 months, if won</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  categoryBullets(categories) {
    const g = categories?.byGroup;
    const s = categories?.byGender;
    if (!g || !s) return "";
    const pct = (e) => this.percent(e.percent, 0, true);
    const pts = (e) => `${this.signed(e.points, 0)} points`;
    const bullets = [
      `<b>Winning Best Musical/Play/Revival moves sales the most.</b> Winning a production award adds about ${pct(g.afterTonySales.won_production)} to weekly gross in the 8 weeks after Tony night, versus ${pct(g.afterTonySales.won_acting)} for an acting win and ${pct(g.afterTonySales.won_creative)} for a creative/design win (production vs. creative p = ${this.number(g.afterTonySales.won_production_vs_won_creative_p, 2)}).`,
      `<b>Creative and design wins go with longer runs.</b> Shows that won a direction, score, book, choreography or design Tony were ${pts(g.stillOpen26.won_creative)} more likely to still be open 6 months later. A production win alone showed no clear extra run (${pts(g.stillOpen26.won_production)}). Likely reading: a full sweep of creative awards marks the shows audiences keep coming back to.`,
      `<b>Nominations: production and creative count, acting less so.</b> Sales grew ${pct(g.nominationSales.nom_production)} with a production nomination and ${pct(g.nominationSales.nom_creative)} with a creative one, but only ${pct(g.nominationSales.nom_acting)} (not clear) with an acting nomination.`,
      `<b>Actor vs. actress: no real difference.</b> An Actor win went with ${pct(s.afterTonySales.won_actor)} in sales and an Actress win with ${pct(s.afterTonySales.won_actress)}; the gap could easily be chance (p = ${this.number(s.afterTonySales.won_actor_vs_won_actress_p, 2)}). Same for staying open (p = ${this.number(s.stillOpen26.won_actor_vs_won_actress_p, 2)}).`,
      `<b>Linear regression and gradient boosting agree.</b> Every effect was estimated twice: a linear regression, and double machine learning where gradient boosting first strips out earlier sales, seats filled, show age and season. The numbers stay close, so the findings don't depend on the linear model.`,
    ];
    return `<ul class="ml-list ml-bullets">${bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`;
  },

  genderBoxChart(boxes, { width = 760, height = 300 } = {}) {
    const rows = (boxes || []).filter((b) => b.shows > 0);
    if (!rows.length) return '<p class="ml-empty">No data yet.</p>';
    const pad = { left: 56, right: 16, top: 24, bottom: 48 };
    const values = rows.flatMap((b) => [b.p10, b.p90]).concat([0]);
    const low = Math.floor(Math.min(...values) / 10) * 10;
    const high = Math.ceil(Math.max(...values) / 10) * 10;
    const y = this.scale([low, high], [height - pad.bottom, pad.top]);
    const step = (width - pad.left - pad.right) / rows.length;
    const ticks = [];
    for (let v = low; v <= high; v += 10) {
      ticks.push(`<g class="ml-tick"><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"></line><text x="${pad.left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${this.percent(v, 0, true)}</text></g>`);
    }
    const zero = `<line class="ml-zero" x1="${pad.left}" x2="${width - pad.right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"></line>`;
    const shapes = rows.map((b, i) => {
      const cx = pad.left + step * (i + 0.5);
      const w = Math.min(56, step * 0.45);
      const cls = b.key === "none" ? "g-not" : b.key.endsWith("Won") ? "g-won" : "g-lost";
      const tip = `${b.label} (${b.shows} shows): median ${this.percent(b.p50, 0, true)}, middle half ${this.percent(b.p25, 0, true)} to ${this.percent(b.p75, 0, true)}`;
      const [name, status] = b.key === "none" ? ["No acting", "nomination"] : [b.key.startsWith("actress") ? "Actress" : "Actor", b.key.endsWith("Won") ? "won" : "nominated, lost"];
      return `<g class="ml-box ${cls}"><title>${this.escape(tip)}</title><line x1="${cx}" x2="${cx}" y1="${y(b.p10).toFixed(1)}" y2="${y(b.p90).toFixed(1)}"></line><rect x="${(cx - w / 2).toFixed(1)}" y="${y(b.p75).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(b.p25) - y(b.p75)).toFixed(1)}"></rect><line class="ml-box-median" x1="${(cx - w / 2).toFixed(1)}" x2="${(cx + w / 2).toFixed(1)}" y1="${y(b.p50).toFixed(1)}" y2="${y(b.p50).toFixed(1)}"></line><text class="ml-box-label" x="${cx}" y="${(y(b.p90) - 6).toFixed(1)}" text-anchor="middle">${this.percent(b.p50, 0, true)}</text><text class="ml-axis" x="${cx}" y="${height - 26}" text-anchor="middle">${name}</text><text class="ml-axis" x="${cx}" y="${height - 10}" text-anchor="middle">${this.escape(status)} (${b.shows})</text></g>`;
    }).join("");
    return this.chartScroll(`<svg class="ml-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Change in weekly gross after Tony night by acting nomination and gender">${ticks.join("")}${zero}${shapes}</svg>`, width);
  },
  eventCaption(causal) {
    const coefs = causal.eventStudy?.coefficients || [];
    const pct = (v) => 100 * Math.expm1(v);
    const mean = (lo, hi) => {
      const values = coefs.filter((c) => c.week >= lo && c.week <= hi).map((c) => pct(c.estimate));
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
    };
    const post = coefs.filter((c) => c.week > 0);
    if (!post.length) return "";
    const peak = post.reduce((a, b) => (b.estimate > a.estimate ? b : a));
    const raw = causal.rawDifferenceInDifferences || {};
    const rawText = Number.isFinite(raw.winnersLogGrossChange)
      ? ` Winners' own weekly grosses changed ${this.percent(pct(raw.winnersLogGrossChange), 1, true)} (weeks 1–8 vs the 8 weeks before), while losing nominees changed ${this.percent(pct(raw.losersLogGrossChange), 1, true)}.`
      : "";
    return `Each dot shows the winner/non-winner gross gap relative to Tony week (set to 0%). Week 1: ${this.percent(mean(1, 1), 0, true)}; highest post-ceremony estimate: ${this.percent(pct(peak.estimate), 0, true)} in week ${peak.week}; average in weeks 9–12: ${this.percent(mean(9, 12), 0, true)}.${rawText} Year-by-event-week controls account for shared timing shocks, but cannot guarantee equal seasonal responses. The pre-ceremony average in weeks −4 to −1 is ${this.percent(mean(-4, -1), 0, true)}; the pre-trend test is ${this.pValue(causal.eventStudy.preTrendJointPValue)}. These checks do not establish causation.`;
  },

  renderCausal(doc, causal) {
    if (causal.dataThrough) this.set(doc, "ml-data-through", this.escape(causal.dataThrough));
    const effects = causal.effects;
    const gross = effects.weeklyGross;
    const capacity = effects.capacityPoints;
    const placebo = effects.placeboWeeklyGross;
    const sample = causal.sample;
    const nomination = causal.nomination;
    this.set(doc, "win-kpi", this.percent(this.pct(gross), 1, true));
    if (nomination) {
      this.set(doc, "nomination-kpi", this.percent(this.pct(nomination.effects.weeklyGross), 1, true));
      const runs = nomination.runLength?.groups;
      if (runs) this.set(doc, "run-kpi", `${runs.won.medianWeeksAfterTony} <small>vs.</small> ${runs.nominatedLost.medianWeeksAfterTony}`);
    }
    this.set(doc, "causal-headline", this.causalBullets(causal));
    if (nomination) {
      const n = nomination.effects;
      this.set(doc, "nomination-cards", [
        this.card("Nominated vs. not nominated", this.percent(this.pct(n.weeklyGross), 1, true),
          `Extra growth in weekly gross from the 4 weeks before the announcement to Tony night. Example: if a show that wasn't nominated stayed at $500K a week, a similar nominated show would typically reach ${this.money(5e5 * (1 + this.pct(n.weeklyGross) / 100))}. Could be anywhere from ${this.rangeValues(n.weeklyGross.percentCi95, 1, "%", " to ")}.`, "blue"),
        this.card("Fake-date check", this.percent(this.pct(n.placeboWeeklyGross), 1, true),
          `We pretended nominations were announced 5 weeks earlier, when nothing actually happened, and ran the same comparison. ${this.nullCheck(n.placeboWeeklyGross, "nomination")}`, "teal"),
        this.card("Confirmed dates only", this.percent(this.pct(n.verifiedDatesOnly), 1, true),
          `Same comparison using only the ${nomination.sample.verifiedDateSeasons} seasons whose exact announcement date we confirmed. Could be anywhere from ${this.rangeValues(n.verifiedDatesOnly?.percentCi95, 1, "%", " to ")}.`, "purple"),
      ].join(""));
      this.set(doc, "causal-lifecycle", this.lifecycleChart(nomination.lifecycle));
      this.set(doc, "run-chart", this.runChart(nomination.runLength));
      this.set(doc, "run-results", this.runBullets(nomination.runLength, effects.closedWithin26Weeks));
    }
    this.set(doc, "causal-cards", [
      this.card("Weekly gross: winners vs. losing nominees", this.percent(this.pct(gross), 1, true),
        `Average over the 8 weeks after Tony night. Example: ${this.example(this.pct(gross))} a week, if the losing show stays at ${this.money(1e6)}. Could be anywhere from ${this.rangeValues(gross.percentCi95, 1, "%", " to ")}.`, "blue"),
      this.card("Seats filled", `${this.signed(capacity.estimate, 1)} pts`,
        `Winners filled about ${this.number(capacity.estimate, 1)} more seats out of every 100. Example: a theatre that was 80% full would be about ${(80 + capacity.estimate).toFixed(0)}% full. Could be anywhere from ${this.rangeValues(capacity.ci95, 1, " pts", " to ")}.`, "purple"),
      this.card("Fake-date check", this.percent(this.pct(placebo), 1, true),
        `Not the "didn't win" group. We pretended Tony night was 8 weeks earlier, when nothing happened, and reran the comparison. ${this.nullCheck(placebo, "winning")}`, "teal"),
    ].join(""));
    this.set(doc, "causal-event-chart", this.eventChart(causal.eventStudy.coefficients));
    this.set(doc, "model-comparison", this.modelTable(causal.modelComparison));
    if (causal.categories) {
      this.set(doc, "category-takeaways", this.categoryTakeaways(causal.categories));
      this.set(doc, "category-chart", this.categoryBoxChart(causal.categories.byGroup?.boxes) || this.categoryChart(causal.categories));
      this.set(doc, "category-table", this.categoryTable(causal.categories));
      this.set(doc, "category-results", this.categoryBullets(causal.categories));
      this.set(doc, "gender-box", this.genderBoxChart(causal.categories.byGender.afterTonyBox));
    }
    this.set(doc, "causal-event-caption", this.escape(this.eventCaption(causal)));
    const p = causal.eventStudy.preTrendJointPValue;
    const types = effects.byType || {};
    const checks = [
      `<b>Who is included.</b> Winning: ${sample.analyzed} nominated shows still running on Tony night (${sample.winners} winners, ${sample.losingNominees} that lost) across ${sample.ceremonies} ceremonies, ${sample.firstCeremony}–${sample.lastCeremony}.${nomination ? ` Nomination: ${nomination.sample.analyzed} new shows of the season (${nomination.sample.nominated} nominated, ${nomination.sample.notNominated} not nominated in any category).` : ""}`,
      `<b>Were winners already pulling ahead?</b> A statistical test of the weeks before Tony night gives ${this.pValue(p)}. Anything below 0.05 would mean winners and losers were clearly drifting apart before the ceremony; ${Number.isFinite(p) && p >= 0.05 ? "this is above 0.05, so no clear drift was detected (but a small head start is still visible in the chart)" : "this is below 0.05, so the groups were already drifting apart"}.`,
      "<b>Fake-date checks.</b> We rerun each comparison at a made-up date when nothing happened. If the method were only picking up differences that already existed, it would \"find\" an effect there too. Near-zero results mean it doesn't.",
    ];
    if (types.musicals && types.plays) {
      checks.push(`<b>Musicals vs. plays.</b> Winning musicals gained about ${this.percent(this.pct(types.musicals), 0, true)} (${this.range(types.musicals.percentCi95, 0)}); winning plays about ${this.percent(this.pct(types.plays), 0, true)} (${this.range(types.plays.percentCi95, 0)}). The plays range is very wide because there are fewer plays, so we can't say plays benefit more than musicals.`);
    }
    if (nomination) checks.push(`<b>Nomination dates.</b> ${this.escape(nomination.design.dates)}.`);
    this.set(doc, "causal-sample", checks.map((c) => `<li>${c}</li>`).join(""));
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
