"use strict";

const { createElement, formatCompact, formatPercent, populateDatalist, renderBars } = window.DashboardUtils;
const {
  canonicalizeRows, mergeTheatreMetadata, summarizeRun, theatreDetail, theatreLabel, theatreNote, theatreSearchText
} = window.TheatreData;
const theatreYear = document.querySelector("#theatre-year");
const theatreName = document.querySelector("#theatre-name");
const theatreShow = document.querySelector("#theatre-show");
const theatreMapLayer = document.querySelector("#theatre-map-layer");
const mapZoomIn = document.querySelector("#map-zoom-in");
const mapZoomOut = document.querySelector("#map-zoom-out");
const mapZoomStatus = document.querySelector("#map-zoom-status");
let theatreRows = [];
let theatreMetadata = new Map();
let selectedTheatreName = "";
let theatreMapZoom = 1;
const theatreSort = {
  summary: { key: "gross", direction: "desc" },
  productions: { key: "gross", direction: "desc" }
};
const theatreMapZoomMinimum = 1;
const theatreMapZoomMaximum = 2.5;
const theatreMapZoomStep = .25;

function setTheatreMapZoom(value) {
  theatreMapZoom = Math.min(theatreMapZoomMaximum, Math.max(theatreMapZoomMinimum, value));
  theatreMapLayer.style.transform = `scale(${theatreMapZoom})`;
  mapZoomStatus.value = `${Math.round(theatreMapZoom * 100)}%`;
  mapZoomIn.disabled = theatreMapZoom >= theatreMapZoomMaximum;
  mapZoomOut.disabled = theatreMapZoom <= theatreMapZoomMinimum;
}

function theatreBaseRows() {
  const showQuery = theatreShow.value.trim().toLocaleLowerCase();
  return theatreRows.filter((row) => (
    (!theatreYear.value || row.year === theatreYear.value)
    && (!showQuery || row.show.toLocaleLowerCase().includes(showQuery))
  ));
}

function theatreMetricRows(baseRows) {
  const theatreQuery = theatreName.value.trim().toLocaleLowerCase();
  return baseRows.filter((row) => (
    (!theatreQuery || theatreSearchText(row.theatre).includes(theatreQuery))
    && (!selectedTheatreName || row.theatre === selectedTheatreName)
  ));
}

function aggregateTheatres(rows) {
  const theatres = new Map();
  rows.forEach((row) => {
    const current = theatres.get(row.theatre) || {
      theatre: row.theatre,
      gross: 0,
      seats: 0,
      available: 0,
      shows: new Set()
    };
    current.gross += row.gross;
    current.seats += row.seats;
    current.available += row.available;
    current.shows.add(row.show);
    theatres.set(row.theatre, current);
  });
  return [...theatres.values()].sort((a, b) => b.gross - a.gross || a.theatre.localeCompare(b.theatre));
}

function aggregateProductions(rows) {
  const productions = new Map();
  rows.forEach((row) => {
    const current = productions.get(row.show) || { show: row.show, gross: 0, seats: 0, available: 0 };
    current.gross += row.gross;
    current.seats += row.seats;
    current.available += row.available;
    productions.set(row.show, current);
  });
  return [...productions.values()].sort((a, b) => b.gross - a.gross || a.show.localeCompare(b.show));
}

function selectTheatre(name) {
  selectedTheatreName = selectedTheatreName === name ? "" : name;
  renderTheatreDashboard();
}

function theatreSortValue(row, key) {
  if (key === "capacity") return row.available ? row.seats / row.available : Number.NEGATIVE_INFINITY;
  if (key === "shows") return row.shows.size;
  return row[key];
}

function sortTheatreRows(rows, table) {
  const { key, direction } = theatreSort[table];
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const first = theatreSortValue(a, key);
    const second = theatreSortValue(b, key);
    const comparison = typeof first === "string"
      ? first.localeCompare(second)
      : first - second;
    return comparison * multiplier
      || (a.theatre || a.show).localeCompare(b.theatre || b.show);
  });
}

function updateTheatreSortHeaders() {
  document.querySelectorAll("[data-theatre-sort-header]").forEach((header) => {
    const [table, key] = header.dataset.theatreSortHeader.split(":");
    const active = theatreSort[table].key === key;
    header.setAttribute("aria-sort", active
      ? (theatreSort[table].direction === "asc" ? "ascending" : "descending")
      : "none");
    header.querySelector("span").textContent = active
      ? (theatreSort[table].direction === "asc" ? "\u25B2" : "\u25BC")
      : "";
  });
}

function renderTheatreMap(rows) {
  theatreMapLayer.querySelectorAll(".map-point, .map-point-label").forEach((element) => element.remove());
  const maximum = Math.max(...rows.map((row) => row.gross), 1);

  rows.filter((row) => theatreMetadata.has(row.theatre)).forEach((row) => {
    const metadata = theatreMetadata.get(row.theatre);
    const point = createElement("button", undefined, "map-point");
    point.type = "button";
    point.classList.toggle("selected", row.theatre === selectedTheatreName);
    point.setAttribute("aria-pressed", String(row.theatre === selectedTheatreName));
    point.setAttribute("aria-label", `${theatreLabel(row.theatre)}, ${formatCompact(row.gross, true)}`);
    point.title = [theatreLabel(row.theatre), metadata.address, formatCompact(row.gross, true)].join("\n");
    const size = 10 + Math.sqrt(row.gross / maximum) * 24;
    point.style.width = `${size}px`;
    point.style.height = `${size}px`;
    point.style.left = `${12 + metadata.x * 76}%`;
    point.style.top = `${10 + metadata.y * 76}%`;
    point.addEventListener("click", () => selectTheatre(row.theatre));
    theatreMapLayer.appendChild(point);
    if (row.theatre === selectedTheatreName) {
      const label = createElement("span", row.theatre, "map-point-label");
      label.id = "selected-theatre-map-label";
      label.setAttribute("role", "status");
      label.style.left = point.style.left;
      label.style.top = point.style.top;
      if (metadata.y < .2) label.classList.add("label-below");
      point.setAttribute("aria-describedby", label.id);
      theatreMapLayer.appendChild(label);
    }
  });
}

function renderTheatreSummary(rows) {
  const body = document.querySelector("#theatre-summary-body");
  body.replaceChildren(...sortTheatreRows(rows, "summary").map((row) => {
    const tr = document.createElement("tr");
    const selected = row.theatre === selectedTheatreName;
    tr.className = selected ? "selected" : "";
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(selected));
    const nameCell = createElement("td", row.theatre);
    const detail = theatreDetail(row.theatre);
    if (detail) {
      const small = createElement("small", ` (${detail})`, "theatre-former-names");
      const note = theatreNote(row.theatre);
      if (note) small.title = note;
      nameCell.appendChild(small);
    }
    tr.appendChild(nameCell);
    [
      formatCompact(row.gross, true),
      row.shows.size.toLocaleString("en-US"),
      formatPercent(row.available ? row.seats / row.available : Number.NaN)
    ].forEach((value) => tr.appendChild(createElement("td", value)));
    const select = () => selectTheatre(row.theatre);
    tr.addEventListener("click", select);
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    return tr;
  }));
}

function renderProductionTable(rows) {
  const body = document.querySelector("#theatre-production-body");
  body.replaceChildren(...sortTheatreRows(rows, "productions").map((row) => {
    const tr = document.createElement("tr");
    [
      row.show,
      formatCompact(row.gross, true),
      formatPercent(row.available ? row.seats / row.available : Number.NaN)
    ].forEach((value) => tr.appendChild(createElement("td", value)));
    return tr;
  }));
}

function renderTheatreDashboard() {
  const baseRows = theatreBaseRows();
  const metricRows = theatreMetricRows(baseRows);
  const baseTheatres = aggregateTheatres(baseRows);
  const filteredTheatres = aggregateTheatres(metricRows);
  const productions = aggregateProductions(metricRows);
  const totals = metricRows.reduce((result, row) => {
    result.gross += row.gross;
    result.seats += row.seats;
    result.available += row.available;
    return result;
  }, { gross: 0, seats: 0, available: 0 });
  const mappedNames = new Set(theatreMetadata.keys());
  const mappedGross = metricRows
    .filter((row) => mappedNames.has(row.theatre))
    .reduce((sum, row) => sum + row.gross, 0);

  document.querySelector("#theatre-count").textContent = filteredTheatres.length.toLocaleString("en-US");
  document.querySelector("#theatre-total-gross").textContent = formatCompact(mappedGross, true);
  document.querySelector("#theatre-capacity").textContent = formatPercent(totals.available ? totals.seats / totals.available : Number.NaN);

  renderTheatreMap(baseTheatres);
  renderBars("theatre-bars", baseTheatres.slice(0, 10).map((row) => ({
    label: row.theatre,
    value: row.gross,
    display: formatCompact(row.gross, true),
    selected: row.theatre === selectedTheatreName,
    onSelect: () => selectTheatre(row.theatre)
  })));
  renderTheatreSummary(baseTheatres);
  renderProductionTable(productions);
  updateTheatreSortHeaders();
}

function renderHeroRun(rows, latestWeek) {
  const run = summarizeRun(rows, "Hamilton", "Richard Rodgers Theatre");
  if (!run.byYear.length) return;
  const latestYear = latestWeek ? latestWeek.slice(0, 4) : "";
  const yearLabel = (year) => (year === latestYear ? `${year} YTD` : year);
  const list = document.querySelector("#hero-capacity-list");
  list.replaceChildren(...run.byYear.slice(-3).map((year) => {
    const item = document.createElement("div");
    const track = createElement("i");
    const fill = createElement("b");
    fill.style.setProperty("--width", `${Math.min(100, Math.max(0, year.capacity * 100))}%`);
    track.appendChild(fill);
    item.append(createElement("span", yearLabel(year.year)), track, createElement("strong", formatPercent(year.capacity)));
    return item;
  }));
  document.querySelector("#hero-capacity").textContent = formatPercent(run.capacity);
  document.querySelector("#hero-gross").textContent = formatCompact(run.gross, true);
  document.querySelector("#hero-source").textContent = `Seats sold \u00F7 seats available, Playbill weekly grosses ${run.firstYear}\u2013${yearLabel(run.lastYear)} `
    + `(${Math.round(run.seats).toLocaleString("en-US")} seats sold). Above 100% reflects standing room.`;
}

theatreYear.addEventListener("change", () => {
  selectedTheatreName = "";
  renderTheatreDashboard();
});
theatreName.addEventListener("input", () => {
  selectedTheatreName = "";
  renderTheatreDashboard();
});
theatreShow.addEventListener("input", () => {
  selectedTheatreName = "";
  renderTheatreDashboard();
});
mapZoomIn.addEventListener("click", () => setTheatreMapZoom(theatreMapZoom + theatreMapZoomStep));
mapZoomOut.addEventListener("click", () => setTheatreMapZoom(theatreMapZoom - theatreMapZoomStep));
document.querySelectorAll("[data-theatre-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    const table = button.dataset.theatreSortTable;
    const key = button.dataset.theatreSort;
    const current = theatreSort[table];
    theatreSort[table] = current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "theatre" || key === "show" ? "asc" : "desc" };
    renderTheatreDashboard();
  });
});
setTheatreMapZoom(theatreMapZoom);

BroadwayData.fetch("theatres-dashboard-data.json")
  .then((response) => {
    if (!response.ok) throw new Error(`Theatre data request failed: ${response.status}`);
    return response.json();
  })
  .then((data) => {
    BroadwayData.freshness(data);
    theatreRows = canonicalizeRows(data.rows.map(([year, show, theatre, gross, seats, available]) => (
      { year, show, theatre, gross, seats, available }
    )));
    theatreMetadata = mergeTheatreMetadata(data.theatres);
    renderHeroRun(theatreRows, data.latestWeek);
    [...new Set(theatreRows.map((row) => row.year))]
      .sort((a, b) => b.localeCompare(a))
      .forEach((year) => theatreYear.appendChild(createElement("option", year)));
    populateDatalist("theatre-names", theatreRows.map((row) => row.theatre));
    populateDatalist("theatre-shows", theatreRows.map((row) => row.show));
    renderTheatreDashboard();
  })
  .catch((error) => {
    BroadwayData.error(error);
    console.error(error);
  });
