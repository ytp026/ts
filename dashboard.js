"use strict";

let dashboardData = { productions: [], awards: {} };
let productionDates = new Map();
let tonyAwardRows = [];
const productionAwardCache = new Map();
let selectedTheatre = "";
let selectedProduction = null;
let impactSort = { key: "nominations", direction: "desc" };

const searchInput = document.querySelector("#impact-filter");
const impactSortLabels = {
  show: "Show",
  theatre: "Theatre",
  totalGross: "Gross",
  capacity: "Capacity",
  wins: "Tony Wins",
  nominations: "Tony Nominations"
};

function createElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function formatCompact(value, currency = false) {
  if (!Number.isFinite(value)) return "N/A";
  const absolute = Math.abs(value);
  const prefix = currency ? "$" : "";
  if (absolute >= 1_000_000_000) return `${prefix}${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${prefix}${Math.round(value / 1_000_000)}M`;
  if (absolute >= 1_000) return `${prefix}${Math.round(value / 1_000)}K`;
  return `${prefix}${Math.round(value).toLocaleString("en-US")}`;
}

function formatCurrency(value) {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "N/A";
}

function formatMillions(value) {
  return Number.isFinite(value) ? `$${(value / 1_000_000).toFixed(1)}M` : "N/A";
}

function formatPercent(value, signed = false) {
  if (!Number.isFinite(value)) return "N/A";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function getShowFilteredProductions() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  return dashboardData.productions.filter((production) => (
    !query || production.show.toLocaleLowerCase().includes(query)
  ));
}

function getFilteredProductions() {
  return getShowFilteredProductions().filter((production) => (
    !selectedTheatre || production.theatre === selectedTheatre
  )).filter((production) => (
    !selectedProduction
    || (
      production.show === selectedProduction.show
      && production.theatre === selectedProduction.theatre
    )
  ));
}

function aggregateTotals(productions) {
  return productions.reduce((totals, production) => ({
    gross: totals.gross + production.totalGross,
    seats: totals.seats + production.totalSeats,
    availableSeats: totals.availableSeats + production.availableSeats
  }), { gross: 0, seats: 0, availableSeats: 0 });
}

function normalizeProductionName(value) {
  return value
    .toLocaleLowerCase()
    .replace(/samuel j\.|sam s\./g, "")
    .replace(/\btheater\b/g, "theatre")
    .replace(/[^a-z0-9]/g, "");
}

function productionKey(show, theatre) {
  return `${normalizeProductionName(show)}|${normalizeProductionName(theatre)}`;
}

function awardsForProduction(production) {
  const key = productionKey(production.show, production.theatre);
  if (productionAwardCache.has(key)) return productionAwardCache.get(key);

  const openings = productionDates.get(key) || [];
  const matchingAwards = new Map();

  openings.forEach((opening) => {
    const opened = new Date(`${opening}T00:00:00`);
    const eligibilityEnd = new Date(opened);
    eligibilityEnd.setFullYear(eligibilityEnd.getFullYear() + 1);

    tonyAwardRows.forEach((award) => {
      const awardDate = new Date(`${award.year}-06-15T00:00:00`);
      if (
        awardDate >= opened
        && awardDate <= eligibilityEnd
        && award.shows.some((show) => normalizeProductionName(show) === normalizeProductionName(production.show))
      ) {
        matchingAwards.set(award.key, award);
      }
    });
  });

  const awards = [...matchingAwards.values()];
  const result = {
    wins: awards.filter((award) => award.win).length,
    nominations: awards.length
  };
  productionAwardCache.set(key, result);
  return result;
}

function aggregateAwards(productions) {
  return productions.reduce((totals, production) => {
    const awards = awardsForProduction(production);
    totals.wins += awards.wins;
    totals.nominations += awards.nominations;
    return totals;
  }, { wins: 0, nominations: 0 });
}

function periodStats(productions, period) {
  const weeks = new Map();
  let seats = 0;
  let availableSeats = 0;

  productions.forEach((production) => {
    production.periods[period].forEach((entry) => {
      const week = weeks.get(entry.week) || 0;
      weeks.set(entry.week, week + entry.gross);
      seats += entry.seats;
      availableSeats += entry.availableSeats;
    });
  });

  const weeklyGrosses = [...weeks.values()];
  return {
    averageGross: weeklyGrosses.length
      ? weeklyGrosses.reduce((sum, value) => sum + value, 0) / weeklyGrosses.length
      : Number.NaN,
    capacity: availableSeats ? seats / availableSeats : Number.NaN
  };
}

function productionPeriodStats(production, period) {
  const entries = production.periods[period];
  return {
    averageGross: entries.length
      ? entries.reduce((sum, entry) => sum + entry.gross, 0) / entries.length
      : Number.NaN,
    capacity: entries.reduce((sum, entry) => sum + entry.availableSeats, 0)
      ? entries.reduce((sum, entry) => sum + entry.seats, 0)
        / entries.reduce((sum, entry) => sum + entry.availableSeats, 0)
      : Number.NaN
  };
}

function highestProduction(productions, period, metric) {
  return productions
    .map((production) => ({
      production,
      value: productionPeriodStats(production, period)[metric]
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => b.value - a.value
      || a.production.show.localeCompare(b.production.show)
      || a.production.theatre.localeCompare(b.production.theatre))[0];
}

function renderVenueChart(productions) {
  const venueTotals = new Map();
  productions.forEach((production) => {
    venueTotals.set(
      production.theatre,
      (venueTotals.get(production.theatre) || 0) + production.totalGross
    );
  });

  const venues = [...venueTotals]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 9);
  const maximum = venues[0]?.value || 1;
  const chart = document.querySelector("#venue-chart");

  const buttons = venues.map((venue) => {
    const button = createElement("button");
    button.type = "button";
    button.className = venue.name === selectedTheatre ? "selected" : "";
    button.setAttribute("aria-pressed", String(venue.name === selectedTheatre));
    button.title = `${venue.name}: ${formatCompact(venue.value, true)}`;

    const label = createElement("span", venue.name);
    const track = createElement("i");
    const bar = createElement("b");
    bar.style.width = `${(venue.value / maximum) * 100}%`;
    track.appendChild(bar);
    button.append(label, track);

    button.addEventListener("click", () => {
      selectedTheatre = selectedTheatre === venue.name ? "" : venue.name;
      selectedProduction = null;
      renderDashboard();
    });
    return button;
  });

  const axis = createElement("div", undefined, "venue-axis");
  axis.setAttribute("aria-hidden", "true");
  axis.appendChild(createElement("span"));
  const scale = createElement("div", undefined, "venue-axis-scale");
  const ticks = createElement("div", undefined, "venue-axis-ticks");
  [0, maximum / 2, maximum].forEach((value) => {
    ticks.appendChild(createElement("span", formatCompact(value, true)));
  });
  scale.append(ticks, createElement("strong", "Total Gross"));
  axis.appendChild(scale);
  chart.replaceChildren(...buttons, axis);
}

function renderComparison(containerId, values, maximum, color, scaleLabels) {
  const chart = document.querySelector(`#${containerId}`);
  const scale = createElement("div", undefined, "comparison-scale");
  scaleLabels.forEach((label) => scale.appendChild(createElement("span", label)));

  const bars = createElement("div", undefined, "comparison-bars");
  values.forEach((item) => {
    const column = createElement("div", undefined, "comparison-column");
    const value = createElement("strong", item.display);
    const bar = createElement("i");
    bar.style.height = `${Math.max(0, Math.min((item.value / maximum) * 100, 100))}%`;
    bar.style.background = color;
    const label = createElement("span", item.label.replace(" weeks ", " weeks\n"));
    column.append(value, bar, label);
    bars.appendChild(column);
  });
  chart.replaceChildren(scale, bars);
}

function renderHighestCards(productions) {
  const cards = [
    ["highest-gross-before", "before", "averageGross", formatCurrency],
    ["highest-gross-after", "after", "averageGross", formatCurrency],
    ["highest-capacity-before", "before", "capacity", formatPercent],
    ["highest-capacity-after", "after", "capacity", formatPercent]
  ];

  cards.forEach(([id, period, metric, formatter]) => {
    const highest = highestProduction(productions, period, metric);
    const text = highest
      ? `${highest.production.show}\n${highest.production.theatre} | ${formatter(highest.value)}`
      : "No matching data";
    setText(id, text);
  });
}

function renderInsight(grossChange, capacityChange) {
  if (!Number.isFinite(grossChange) || !Number.isFinite(capacityChange)) {
    setText("impact-insight", "There is not enough before-and-after data for this selection.");
    return;
  }

  const grossDirection = grossChange > 0 ? "increased" : grossChange < 0 ? "decreased" : "was unchanged";
  const capacityDirection = capacityChange > 0 ? "increased" : capacityChange < 0 ? "decreased" : "was unchanged";
  let interpretation = "No material directional change is visible.";

  if (grossChange > 0 && capacityChange > 0) {
    interpretation = "Both demand and revenue strengthened after the ceremony.";
  } else if (grossChange < 0 && capacityChange > 0) {
    interpretation = "Utilization improved while revenue weakened; pricing, performance count, and show mix may explain the divergence.";
  } else if (grossChange > 0 && capacityChange < 0) {
    interpretation = "Revenue improved despite lower utilization, which may reflect higher ticket prices or a different show mix.";
  } else if (grossChange < 0 && capacityChange < 0) {
    interpretation = "Both utilization and revenue weakened after the ceremony.";
  }

  setText(
    "impact-insight",
    `Average weekly gross ${grossDirection} ${formatPercent(Math.abs(grossChange))}, while weighted capacity ${capacityDirection} ${formatPercent(Math.abs(capacityChange))} percentage points. ${interpretation} This four-week comparison is descriptive, not proof of causation.`
  );
}

function renderTable(productions) {
  const rows = productions
    .map((production) => {
      const awards = awardsForProduction(production);
      return {
        ...production,
        capacity: production.availableSeats
          ? production.totalSeats / production.availableSeats
          : Number.NaN,
        wins: awards.wins,
        nominations: awards.nominations
      };
    });
  const direction = impactSort.direction === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const first = a[impactSort.key];
    const second = b[impactSort.key];
    const comparison = typeof first === "string"
      ? first.localeCompare(second)
      : (Number.isFinite(first) ? first : Number.NEGATIVE_INFINITY)
        - (Number.isFinite(second) ? second : Number.NEGATIVE_INFINITY);
    return comparison * direction
      || a.show.localeCompare(b.show)
      || a.theatre.localeCompare(b.theatre);
  });

  const body = document.querySelector("#impact-table-body");
  body.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    const isSelected = selectedProduction
      && row.show === selectedProduction.show
      && row.theatre === selectedProduction.theatre;
    tr.className = isSelected ? "selected" : "";
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(Boolean(isSelected)));
    tr.title = `Filter dashboard by ${row.show} at ${row.theatre}`;
    [
      row.show,
      row.theatre,
      formatCompact(row.totalGross, true),
      formatPercent(row.capacity),
      row.wins.toLocaleString("en-US"),
      row.nominations.toLocaleString("en-US")
    ].forEach((value) => tr.appendChild(createElement("td", value)));
    const selectRow = () => {
      selectedProduction = isSelected
        ? null
        : { show: row.show, theatre: row.theatre };
      renderDashboard();
    };
    tr.addEventListener("click", selectRow);
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRow();
      }
    });
    return tr;
  }));

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = createElement("td", "No matching records", "empty-table");
    td.colSpan = 6;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  document.querySelectorAll("[data-impact-sort-header]").forEach((header) => {
    const active = header.dataset.impactSortHeader === impactSort.key;
    header.setAttribute("aria-sort", active
      ? (impactSort.direction === "asc" ? "ascending" : "descending")
      : "none");
    header.querySelector("span").textContent = active
      ? (impactSort.direction === "asc" ? "\u25B2" : "\u25BC")
      : "";
  });
  const sortDescription = typeof rows[0]?.[impactSort.key] === "string"
    ? (impactSort.direction === "asc" ? "A to Z" : "Z to A")
    : (impactSort.direction === "asc" ? "lowest to highest" : "highest to lowest");
  const sortStatus = `Sorted by ${impactSortLabels[impactSort.key]}, ${sortDescription}.`;
  setText("table-filter-status", selectedProduction
    ? `${sortStatus} Filtering all visuals by ${selectedProduction.show} at ${selectedProduction.theatre}. Select the row again to clear.`
    : `${sortStatus} Select a row to filter every visual.`);
}

function renderDashboard() {
  const showFiltered = getShowFilteredProductions();
  const tableProductions = showFiltered.filter((production) => (
    !selectedTheatre || production.theatre === selectedTheatre
  ));
  const productions = getFilteredProductions();
  const totals = aggregateTotals(productions);
  const awards = aggregateAwards(productions);
  const before = periodStats(productions, "before");
  const after = periodStats(productions, "after");
  const grossChange = Number.isFinite(before.averageGross) && before.averageGross
    ? (after.averageGross - before.averageGross) / before.averageGross
    : Number.NaN;
  const capacityChange = after.capacity - before.capacity;
  const grossMaximum = Math.max(before.averageGross || 0, after.averageGross || 0, 1);
  const grossScale = Math.ceil(grossMaximum / 5_000_000) * 5_000_000;

  renderVenueChart(showFiltered);
  renderComparison(
    "gross-comparison",
    [
      { label: "4 weeks before", value: before.averageGross || 0, display: formatMillions(before.averageGross) },
      { label: "4 weeks after", value: after.averageGross || 0, display: formatMillions(after.averageGross) }
    ],
    grossScale,
    "#db9148",
    [formatCompact(grossScale, true), formatCompact(grossScale / 2, true), "$0"]
  );
  renderComparison(
    "capacity-comparison",
    [
      { label: "4 weeks before", value: before.capacity || 0, display: formatPercent(before.capacity) },
      { label: "4 weeks after", value: after.capacity || 0, display: formatPercent(after.capacity) }
    ],
    1,
    "#65a29a",
    ["100%", "50%", "0%"]
  );

  renderHighestCards(productions);
  renderInsight(grossChange, capacityChange);
  renderTable(tableProductions);

  setText("gross-change", formatPercent(grossChange, true));
  setText("capacity-change", formatPercent(capacityChange, true));
  setText("total-gross", formatCompact(totals.gross, true));
  setText("tony-wins", awards.wins.toLocaleString("en-US"));
  setText("total-seats", formatCompact(totals.seats));
  setText("table-total-gross", formatCompact(totals.gross, true));
  setText("table-total-capacity", formatPercent(totals.availableSeats ? totals.seats / totals.availableSeats : Number.NaN));
  setText("table-total-wins", awards.wins.toLocaleString("en-US"));
  setText("table-total-nominations", awards.nominations.toLocaleString("en-US"));
}

searchInput.addEventListener("input", () => {
  selectedTheatre = "";
  selectedProduction = null;
  renderDashboard();
});
document.querySelectorAll("[data-impact-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.impactSort;
    impactSort = impactSort.key === key
      ? { key, direction: impactSort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "show" || key === "theatre" ? "asc" : "desc" };
    renderDashboard();
  });
});

Promise.all([
  fetch("broadway-overview-data.json"),
  fetch("broadway-production-dates.json"),
  fetch("tony-dashboard-data.json")
])
  .then(async ([dashboardResponse, datesResponse, tonyResponse]) => {
    if (!dashboardResponse.ok) throw new Error(`Dashboard data request failed: ${dashboardResponse.status}`);
    if (!datesResponse.ok) throw new Error(`Production dates request failed: ${datesResponse.status}`);
    if (!tonyResponse.ok) throw new Error(`Tony data request failed: ${tonyResponse.status}`);
    return Promise.all([
      dashboardResponse.json(),
      datesResponse.json(),
      tonyResponse.json()
    ]);
  })
  .then(([data, datesData, tonyData]) => {
    dashboardData = data;
    productionDates = new Map(Object.entries(datesData.productions));
    tonyAwardRows = tonyData.rows
      .filter(([year, category, , show, , competitive]) => (
        /^(19|20)\d{2}$/.test(String(year))
        && category
        && show
        && Boolean(competitive)
      ))
      .map(([year, category, name, show, win]) => ({
        year: String(year),
        shows: show.split("|").map((value) => value.trim()).filter(Boolean),
        win: Boolean(win),
        key: `${year}|${category}|${name}|${show}`
      }));
    const dataList = document.querySelector("#impact-shows");
    const shows = [...new Set(data.productions.map((production) => production.show))]
      .sort((a, b) => a.localeCompare(b));
    dataList.replaceChildren(...shows.map((show) => {
      const option = document.createElement("option");
      option.value = show;
      return option;
    }));
    renderDashboard();
  })
  .catch((error) => {
    setText("impact-insight", "The dashboard data could not be loaded.");
    console.error(error);
  });
