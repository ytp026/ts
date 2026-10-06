"use strict";

window.DashboardUtils = {
  createElement(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  },

  formatCompact(value, currency = false) {
    if (!Number.isFinite(value)) return "N/A";
    const absolute = Math.abs(value);
    const prefix = currency ? "$" : "";
    if (absolute >= 1_000_000_000) return `${prefix}${(value / 1_000_000_000).toFixed(2)}B`;
    if (absolute >= 1_000_000) return `${prefix}${Math.round(value / 1_000_000)}M`;
    if (absolute >= 1_000) return `${prefix}${Math.round(value / 1_000)}K`;
    return `${prefix}${Math.round(value).toLocaleString("en-US")}`;
  },

  formatPercent(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "N/A";
  },

  formatYearRuns(years) {
    if (!Array.isArray(years) || years.some((year) => !Number.isInteger(year) || year < 1 || year > 9999)) {
      throw new Error("Year ranges require valid calendar years.");
    }
    const sorted = [...new Set(years)].sort((left, right) => left - right);
    const runs = [];
    sorted.forEach((year) => {
      const current = runs.at(-1);
      if (current && year === current.end + 1) {
        current.end = year;
      } else {
        runs.push({ start: year, end: year });
      }
    });
    return runs.map(({ start, end }) => start === end ? String(start) : `${start}\u2013${end}`).join(", ");
  },

  formatRunPeriods(segments, exact = false) {
    if (!Array.isArray(segments)) throw new Error("Reported runs require date segments.");
    segments.forEach(({ start, end }, index) => {
      for (const value of [start, end]) {
        const date = new Date(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || !Number.isFinite(date.getTime())
          || date.toISOString().slice(0, 10) !== value) {
          throw new Error("Reported runs contain invalid dates.");
        }
      }
      if (start > end || (index > 0 && start <= segments[index - 1].end)) {
        throw new Error("Reported runs must be ordered, nonoverlapping date segments.");
      }
    });
    const overlappingYears = segments.some((segment, index) => index > 0
      && segment.start.slice(0, 4) === segments[index - 1].end.slice(0, 4));
    const monthYear = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short", year: "numeric", timeZone: "UTC"
    });
    return segments.map(({ start, end }) => {
      if (exact) return start === end ? start : `${start}\u2013${end}`;
      if (overlappingYears) {
        const first = monthYear(start);
        const last = monthYear(end);
        return first === last ? first : `${first}\u2013${last}`;
      }
      const first = start.slice(0, 4);
      const last = end.slice(0, 4);
      return first === last ? first : `${first}\u2013${last}`;
    }).join(", ");
  },

  populateDatalist(id, values) {
    const list = document.querySelector(`#${id}`);
    list.replaceChildren(...[...new Set(values)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => {
        const option = document.createElement("option");
        option.value = value;
        return option;
      }));
  },

  renderBars(containerId, rows, options = {}) {
    const container = document.querySelector(`#${containerId}`);
    const maximum = Math.max(...rows.map((row) => row.value), 1);
    container.replaceChildren(...rows.map((row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = row.selected ? "selected" : "";
      button.setAttribute("aria-pressed", String(Boolean(row.selected)));
      button.title = row.title || `${row.label}: ${row.display}`;

      const label = window.DashboardUtils.createElement("span", row.label);
      const track = window.DashboardUtils.createElement("i");
      const fill = window.DashboardUtils.createElement("b");
      fill.style.width = `${Math.max(0, (row.value / maximum) * 100)}%`;
      fill.style.background = row.color || options.color || "#356be8";
      track.appendChild(fill);
      const value = window.DashboardUtils.createElement("strong", row.display);
      button.append(label, track, value);
      if (row.onSelect) button.addEventListener("click", row.onSelect);
      return button;
    }));
  }
};
