"use strict";

window.BroadwayData = {
  status(message, error = false) {
    let status = document.querySelector("#broadway-data-status");
    if (!status) {
      status = document.createElement("p");
      status.id = "broadway-data-status";
      status.className = "dashboard-note";
      status.setAttribute("role", "status");
      document.querySelector("main").prepend(status);
    }
    status.textContent = message;
    status.classList.toggle("is-error", error);
  },

  freshness(data, now = new Date()) {
    const week = data.latestWeek;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week || "")) {
      this.status("Gross data freshness is unavailable. This may be a historical snapshot.", true);
      return;
    }
    const age = (now - new Date(`${week}T00:00:00Z`)) / 86400000;
    const stale = !Number.isFinite(age) || age > 14 || age < -1;
    this.status(
      `Gross data through week ending ${week}. ${stale ? "Updates are overdue; " : ""}`
      + "Reported box-office gross, not profit. Tony awards and opening dates are separate historical datasets.",
      stale
    );
  },

  async fetch(url) {
    const response = await window.fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} request failed: ${response.status}`);
    return response;
  },

  error(error) {
    this.status(`Broadway data could not be loaded: ${error.message}`, true);
  }
};
