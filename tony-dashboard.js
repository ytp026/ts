"use strict";

const { createElement, formatPercent, populateDatalist, renderBars } = window.DashboardUtils;
const tonyYear = document.querySelector("#tony-year");
const tonyCategory = document.querySelector("#tony-category");
const tonyShow = document.querySelector("#tony-show");
const tonyYearGroup = document.querySelector("#tony-year-group");
let tonyRows = [];
let selectedTonyCategory = "";
let selectedTonyShow = "";
let selectedTonyRow = null;
let tonyImpactProductions = [];

function tonyBaseRows() {
  const categoryQuery = tonyCategory.value.trim().toLocaleLowerCase();
  const showQuery = tonyShow.value.trim().toLocaleLowerCase();
  return tonyRows.filter((row) => (
    (!tonyYear.value || row.year === tonyYear.value)
    && (!categoryQuery || row.category.toLocaleLowerCase().includes(categoryQuery))
    && (!showQuery || row.show.toLocaleLowerCase().includes(showQuery))
    && (!tonyYearGroup.value || row.yearGroup === tonyYearGroup.value)
  ));
}

function tonyMetricRows(baseRows) {
  return baseRows.filter((row) => (
    (!selectedTonyCategory || row.category === selectedTonyCategory)
    && (!selectedTonyShow || row.show === selectedTonyShow)
    && (!selectedTonyRow || (
      row.year === selectedTonyRow.year
      && row.category === selectedTonyRow.category
      && row.name === selectedTonyRow.name
      && row.show === selectedTonyRow.show
    ))
  ));
}

function awardKey(row) {
  return `${row.year}|${row.category}|${row.show}`;
}

function tonyMetrics(rows) {
  const nominations = rows.filter((row) => row.competitive && row.category).length;
  const wins = new Set(rows
    .filter((row) => row.competitive && row.win && row.show)
    .map(awardKey)).size;
  const people = new Set(rows.filter((row) => row.win && row.name).map((row) => row.name)).size;
  return { nominations, wins, people };
}

function tonyImpactPeriodStats(productions, period) {
  const weeks = new Map();
  let seats = 0;
  let availableSeats = 0;
  productions.forEach((production) => {
    production.periods[period].forEach((entry) => {
      weeks.set(entry.week, (weeks.get(entry.week) || 0) + entry.gross);
      seats += entry.seats;
      availableSeats += entry.availableSeats;
    });
  });
  const grossValues = [...weeks.values()];
  return {
    averageGross: grossValues.length
      ? grossValues.reduce((sum, value) => sum + value, 0) / grossValues.length
      : Number.NaN,
    capacity: availableSeats ? seats / availableSeats : Number.NaN
  };
}

function tonyProductionPeriodStats(production, period) {
  const entries = production.periods[period];
  const availableSeats = entries.reduce((sum, entry) => sum + entry.availableSeats, 0);
  return {
    averageGross: entries.length
      ? entries.reduce((sum, entry) => sum + entry.gross, 0) / entries.length
      : Number.NaN,
    capacity: availableSeats
      ? entries.reduce((sum, entry) => sum + entry.seats, 0) / availableSeats
      : Number.NaN
  };
}

function tonyImpactRows(awardRows) {
  const yearsByShow = new Map();
  awardRows.forEach((row) => {
    if (!row.show || !row.year) return;
    if (!yearsByShow.has(row.show)) yearsByShow.set(row.show, new Set());
    yearsByShow.get(row.show).add(row.year);
  });
  return tonyImpactProductions
    .filter((production) => yearsByShow.has(production.show))
    .map((production) => {
      const years = yearsByShow.get(production.show);
      return {
        ...production,
        periods: {
          before: production.periods.before.filter((entry) => years.has(entry.week.slice(0, 4))),
          after: production.periods.after.filter((entry) => years.has(entry.week.slice(0, 4)))
        }
      };
    })
    .filter((production) => production.periods.before.length || production.periods.after.length);
}

function formatTonyCurrency(value) {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "N/A";
}

function formatTonyMillions(value) {
  return Number.isFinite(value) ? `$${(value / 1_000_000).toFixed(1)}M` : "N/A";
}

function formatTonySignedPercent(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function formatTonySignedPoints(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
}

function renderTonyImpactComparison(containerId, values, maximum, color, scaleLabels) {
  const chart = document.querySelector(`#${containerId}`);
  const scale = createElement("div", undefined, "comparison-scale");
  scaleLabels.forEach((label) => scale.appendChild(createElement("span", label)));
  const bars = createElement("div", undefined, "comparison-bars");
  values.forEach((item) => {
    const column = createElement("div", undefined, "comparison-column");
    const bar = createElement("i");
    bar.style.height = `${Math.max(0, Math.min((item.value / maximum) * 100, 100))}%`;
    bar.style.background = color;
    column.append(
      createElement("strong", item.display),
      bar,
      createElement("span", item.label)
    );
    bars.appendChild(column);
  });
  chart.replaceChildren(scale, bars);
}

function renderTonyHighestCards(productions) {
  [
    ["tony-highest-gross-before", "before", "averageGross", formatTonyCurrency],
    ["tony-highest-gross-after", "after", "averageGross", formatTonyCurrency],
    ["tony-highest-capacity-before", "before", "capacity", formatPercent],
    ["tony-highest-capacity-after", "after", "capacity", formatPercent]
  ].forEach(([id, period, metric, formatter]) => {
    const highest = productions
      .map((production) => ({
        production,
        value: tonyProductionPeriodStats(production, period)[metric]
      }))
      .filter((item) => Number.isFinite(item.value))
      .sort((a, b) => b.value - a.value
        || a.production.show.localeCompare(b.production.show)
        || a.production.theatre.localeCompare(b.production.theatre))[0];
    const element = document.querySelector(`#${id}`);
    element.textContent = highest
      ? `${highest.production.show}\n${formatter(highest.value)}`
      : "No matching data";
    element.title = highest
      ? `${highest.production.theatre} | ${formatter(highest.value)}`
      : "";
  });
}

function tonyChangeRows(productions) {
  const byShow = new Map();
  productions.forEach((production) => {
    const current = byShow.get(production.show) || {
      show: production.show,
      periods: { before: [], after: [] }
    };
    current.periods.before.push(...production.periods.before);
    current.periods.after.push(...production.periods.after);
    byShow.set(production.show, current);
  });

  return [...byShow.values()].map((production) => {
    const before = tonyProductionPeriodStats(production, "before");
    const after = tonyProductionPeriodStats(production, "after");
    return {
      show: production.show,
      grossChange: Number.isFinite(before.averageGross) && before.averageGross && Number.isFinite(after.averageGross)
        ? (after.averageGross - before.averageGross) / before.averageGross
        : Number.NaN,
      capacityChange: Number.isFinite(before.capacity) && Number.isFinite(after.capacity)
        ? after.capacity - before.capacity
        : Number.NaN
    };
  });
}

function renderTonyChangeRanking(containerId, rows, metric) {
  const container = document.querySelector(`#${containerId}`);
  const ranked = rows
    .filter((row) => Number.isFinite(row[metric]))
    .sort((a, b) => b[metric] - a[metric] || a.show.localeCompare(b.show))
    .slice(0, 8);
  const maximum = Math.max(...ranked.map((row) => Math.abs(row[metric])), .01);

  container.replaceChildren(...ranked.map((row, index) => {
    const button = createElement("button");
    button.type = "button";
    button.className = row.show === selectedTonyShow ? "selected" : "";
    button.setAttribute("aria-pressed", String(row.show === selectedTonyShow));
    const heading = createElement("span");
    heading.append(
      createElement("i", `${index + 1}`),
      createElement("b", row.show),
      createElement("strong", metric === "capacityChange"
        ? formatTonySignedPoints(row[metric])
        : formatTonySignedPercent(row[metric]))
    );
    const track = createElement("span", undefined, "tony-change-track");
    const bar = createElement("i");
    bar.style.width = `${Math.max(3, (Math.abs(row[metric]) / maximum) * 100)}%`;
    bar.className = row[metric] >= 0 ? "positive" : "negative";
    track.appendChild(bar);
    button.append(heading, track);
    button.addEventListener("click", () => {
      selectedTonyShow = selectedTonyShow === row.show ? "" : row.show;
      selectedTonyRow = null;
      renderTonyDashboard();
    });
    return button;
  }));

  if (ranked.length === 0) {
    container.appendChild(createElement("p", "No matching before-and-after records."));
  }
}

function renderTonyTrendSummary(grossChange, capacityChange, changes) {
  const grossLeader = [...changes]
    .filter((row) => Number.isFinite(row.grossChange))
    .sort((a, b) => b.grossChange - a.grossChange)[0];
  const capacityLeader = [...changes]
    .filter((row) => Number.isFinite(row.capacityChange))
    .sort((a, b) => b.capacityChange - a.capacityChange)[0];
  const summary = document.querySelector("#tony-trend-summary");

  if (!Number.isFinite(grossChange) || !Number.isFinite(capacityChange)) {
    summary.textContent = "There is not enough before-and-after data to summarize this selection.";
    return;
  }

  const grossDirection = grossChange > 0 ? "rose" : grossChange < 0 ? "fell" : "held steady";
  const capacityDirection = capacityChange > 0 ? "increased" : capacityChange < 0 ? "decreased" : "held steady";
  const leaders = [
    grossLeader ? `${grossLeader.show} had the largest gross increase (${formatTonySignedPercent(grossLeader.grossChange)})` : "",
    capacityLeader ? `${capacityLeader.show} led capacity change (${formatTonySignedPoints(capacityLeader.capacityChange)})` : ""
  ].filter(Boolean).join(", while ");
  const grossMagnitude = `${(Math.abs(grossChange) * 100).toFixed(1)}%`;
  const capacityMagnitude = `${(Math.abs(capacityChange) * 100).toFixed(1)} points`;
  summary.textContent = `Across the current selection, average weekly gross ${grossDirection} ${grossMagnitude} after the ceremony and capacity ${capacityDirection} ${capacityMagnitude}. ${leaders ? `${leaders}. ` : ""}These comparisons describe timing around the Tony Awards and do not prove that awards caused the changes.`;
}

function renderTonyImpact(rows) {
  const productions = tonyImpactRows(rows);
  const before = tonyImpactPeriodStats(productions, "before");
  const after = tonyImpactPeriodStats(productions, "after");
  const grossChange = Number.isFinite(before.averageGross) && before.averageGross
    ? (after.averageGross - before.averageGross) / before.averageGross
    : Number.NaN;
  const capacityChange = after.capacity - before.capacity;
  const grossMaximum = Math.max(before.averageGross || 0, after.averageGross || 0, 1);
  const grossScale = Math.ceil(grossMaximum / 5_000_000) * 5_000_000;

  renderTonyImpactComparison(
    "tony-impact-gross-comparison",
    [
      { label: "4 weeks\nbefore", value: before.averageGross || 0, display: formatTonyMillions(before.averageGross) },
      { label: "4 weeks\nafter", value: after.averageGross || 0, display: formatTonyMillions(after.averageGross) }
    ],
    grossScale,
    "#db9148",
    [formatTonyMillions(grossScale), formatTonyMillions(grossScale / 2), "$0"]
  );
  renderTonyImpactComparison(
    "tony-impact-capacity-comparison",
    [
      { label: "4 weeks\nbefore", value: before.capacity || 0, display: formatPercent(before.capacity) },
      { label: "4 weeks\nafter", value: after.capacity || 0, display: formatPercent(after.capacity) }
    ],
    1,
    "#65a29a",
    ["100%", "50%", "0%"]
  );
  renderTonyHighestCards(productions);
  document.querySelector("#tony-gross-change").textContent = formatTonySignedPercent(grossChange);
  document.querySelector("#tony-capacity-change").textContent = formatTonySignedPoints(capacityChange);
  const changes = tonyChangeRows(productions);
  renderTonyChangeRanking("tony-gross-change-ranking", changes, "grossChange");
  renderTonyChangeRanking("tony-capacity-change-ranking", changes, "capacityChange");
  renderTonyTrendSummary(grossChange, capacityChange, changes);
}

function aggregateTony(rows, keyName) {
  const groups = new Map();
  rows.filter((row) => row[keyName]).forEach((row) => {
    const key = row[keyName];
    const current = groups.get(key) || { label: key, nominations: 0, winKeys: new Set(), years: new Set() };
    if (row.competitive) current.nominations += 1;
    if (row.competitive && row.win) {
      current.winKeys.add(awardKey(row));
      current.years.add(row.year);
    }
    groups.set(key, current);
  });
  return [...groups.values()].map((group) => ({
    ...group,
    wins: group.winKeys.size,
    winningYears: group.years.size
  }));
}

function renderDualBars(containerId, rows, primaryName, primaryColor) {
  const container = document.querySelector(`#${containerId}`);
  const maximum = Math.max(...rows.map((row) => row.primary), 1);
  container.replaceChildren(...rows.map((row) => {
    const button = createElement("button");
    button.type = "button";
    button.className = row.selected ? "selected" : "";
    button.setAttribute("aria-pressed", String(Boolean(row.selected)));

    const label = createElement("span", row.label);
    const tracks = createElement("div", undefined, "dual-track");
    const primaryTrack = createElement("i");
    const primaryFill = createElement("b");
    primaryFill.style.width = `${(row.primary / maximum) * 100}%`;
    primaryFill.style.background = primaryColor;
    primaryTrack.title = `${primaryName}: ${row.primary}`;
    primaryTrack.appendChild(primaryFill);
    const yearTrack = createElement("i");
    const yearFill = createElement("b");
    yearFill.style.width = `${(row.winningYears / Math.max(row.primary, 1)) * (row.primary / maximum) * 100}%`;
    yearFill.style.background = row.winningYears >= 2 ? "#14b8a6" : "#f4b942";
    yearTrack.title = `Winning years: ${row.winningYears}`;
    yearTrack.appendChild(yearFill);
    tracks.append(primaryTrack, yearTrack);

    const value = createElement("strong", `${row.primary} | ${row.winningYears} yr`);
    button.append(label, tracks, value);
    button.addEventListener("click", row.onSelect);
    return button;
  }));
}

function renderTonyTable(rows) {
  const body = document.querySelector("#tony-table-body");
  const sorted = [...rows].sort((a, b) => b.year.localeCompare(a.year)
    || a.category.localeCompare(b.category)
    || a.name.localeCompare(b.name));
  const visible = sorted.slice(0, 500);
  body.replaceChildren(...visible.map((row) => {
    const tr = document.createElement("tr");
    const selected = selectedTonyRow
      && row.year === selectedTonyRow.year
      && row.category === selectedTonyRow.category
      && row.name === selectedTonyRow.name
      && row.show === selectedTonyRow.show;
    tr.className = [row.win ? "winner-row" : "", selected ? "selected" : ""].filter(Boolean).join(" ");
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(Boolean(selected)));
    [row.year, row.category, row.name, row.show, row.win ? "Yes" : "No"]
      .forEach((value) => tr.appendChild(createElement("td", value)));
    const select = () => {
      selectedTonyRow = selected ? null : {
        year: row.year,
        category: row.category,
        name: row.name,
        show: row.show
      };
      renderTonyDashboard();
    };
    tr.addEventListener("click", select);
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    return tr;
  }));
  document.querySelector("#tony-table-status").textContent = selectedTonyRow
    ? `Filtering every visual by ${selectedTonyRow.name}. Select the row again to clear.`
    : `Select a row to filter every visual. Showing ${visible.length.toLocaleString("en-US")} of ${sorted.length.toLocaleString("en-US")} records.`;
}

function renderTonyDashboard() {
  const baseRows = tonyBaseRows();
  const metricRows = tonyMetricRows(baseRows);
  const metrics = tonyMetrics(metricRows);
  const categories = aggregateTony(baseRows, "category")
    .sort((a, b) => b.wins - a.wins || a.label.localeCompare(b.label))
    .slice(0, 10);
  const productions = aggregateTony(baseRows, "show")
    .sort((a, b) => b.wins - a.wins || a.label.localeCompare(b.label))
    .slice(0, 10);
  const nominations = aggregateTony(baseRows, "show")
    .sort((a, b) => b.nominations - a.nominations || a.label.localeCompare(b.label))
    .slice(0, 8);

  document.querySelector("#tony-nominees").textContent = metrics.nominations.toLocaleString("en-US");
  document.querySelector("#tony-total-wins").textContent = metrics.wins.toLocaleString("en-US");
  document.querySelector("#tony-win-rate").textContent = formatPercent(metrics.nominations ? metrics.wins / metrics.nominations : Number.NaN);
  document.querySelector("#tony-winning-people").textContent = metrics.people.toLocaleString("en-US");

  renderTonyImpact(metricRows);
  renderBars("tony-category-bars", categories.map((row) => ({
    label: row.label,
    value: row.wins,
    display: row.wins.toLocaleString("en-US"),
    selected: row.label === selectedTonyCategory,
    onSelect: () => {
      selectedTonyCategory = selectedTonyCategory === row.label ? "" : row.label;
      selectedTonyRow = null;
      renderTonyDashboard();
    }
  })));
  renderDualBars("tony-production-bars", productions.map((row) => ({
    label: row.label,
    primary: row.wins,
    winningYears: row.winningYears,
    selected: row.label === selectedTonyShow,
    onSelect: () => {
      selectedTonyShow = selectedTonyShow === row.label ? "" : row.label;
      selectedTonyRow = null;
      renderTonyDashboard();
    }
  })), "Tony wins", "#356be8");
  renderDualBars("tony-nomination-bars", nominations.map((row) => ({
    label: row.label,
    primary: row.nominations,
    winningYears: row.winningYears,
    selected: row.label === selectedTonyShow,
    onSelect: () => {
      selectedTonyShow = selectedTonyShow === row.label ? "" : row.label;
      selectedTonyRow = null;
      renderTonyDashboard();
    }
  })), "Nominations", "#6b5bef");
  renderTonyTable(metricRows);
}

[tonyYear, tonyCategory, tonyShow, tonyYearGroup].forEach((control) => {
  control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
    selectedTonyCategory = "";
    selectedTonyShow = "";
    selectedTonyRow = null;
    renderTonyDashboard();
  });
});

Promise.all([
  fetch("tony-dashboard-data.json"),
  fetch("broadway-overview-data.json")
])
  .then(async ([tonyResponse, impactResponse]) => {
    if (!tonyResponse.ok) throw new Error(`Tony data request failed: ${tonyResponse.status}`);
    if (!impactResponse.ok) throw new Error(`Tony impact data request failed: ${impactResponse.status}`);
    return [await tonyResponse.json(), await impactResponse.json()];
  })
  .then(([data, impactData]) => {
    tonyImpactProductions = impactData.productions;
    tonyRows = data.rows
      .filter(([year]) => /^(19|20)\d{2}$/.test(String(year)))
      .map(([year, category, name, show, win, competitive, winningYears, yearGroup]) => ({
        year,
        category,
        name,
        show,
        win: Boolean(win),
        competitive: Boolean(competitive),
        winningYears,
        yearGroup
      }));
    [...new Set(tonyRows.map((row) => row.year))]
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))
      .forEach((year) => tonyYear.appendChild(createElement("option", year)));
    populateDatalist("tony-categories", tonyRows.map((row) => row.category));
    populateDatalist("tony-shows", tonyRows.map((row) => row.show));
    renderTonyDashboard();
  })
  .catch((error) => console.error(error));
