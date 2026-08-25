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
