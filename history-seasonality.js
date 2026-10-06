"use strict";

window.HistorySeasonality = {
  months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],

  category(index) {
    if (!Number.isFinite(index)) throw new Error("Seasonal category requires a finite index.");
    if (Math.abs(index - 100) <= 1e-9) return "average";
    return index > 100 ? "above" : "below";
  },

  summarize(rows) {
    if (!Array.isArray(rows)) throw new Error("Seasonality requires weekly history rows.");
    const years = new Map();
    rows.forEach((row) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || "")) {
        throw new Error("Seasonality contains an invalid reporting date.");
      }
      const date = new Date(`${row.date}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date
        || date.getUTCDay() !== 0) {
        throw new Error("Seasonality requires valid Sunday week-ending dates.");
      }
      if (!Number.isFinite(row.gross) || row.gross < 0
        || !Number.isFinite(row.available) || row.available < 0) {
        throw new Error("Seasonality contains invalid gross or available-seat data.");
      }
      const year = date.getUTCFullYear();
      const weekly = years.get(year) || new Map();
      const total = weekly.get(row.date) || { gross: 0, available: 0 };
      total.gross += row.gross;
      total.available += row.available;
      weekly.set(row.date, total);
      years.set(year, weekly);
    });

    const includedYears = [];
    const excludedYears = [];
    const contributions = this.months.map(() => []);
    const weeksByMonth = this.months.map(() => 0);
    [...years].sort(([left], [right]) => left - right).forEach(([year, weekly]) => {
      const expected = [];
      const date = new Date(Date.UTC(year, 0, 1));
      date.setUTCDate(1 + (7 - date.getUTCDay()) % 7);
      while (date.getUTCFullYear() === year) {
        expected.push(date.toISOString().slice(0, 10));
        date.setUTCDate(date.getUTCDate() + 7);
      }
      const missingWeeks = expected.filter((week) => !weekly.has(week)).length;
      const inactiveWeeks = [...weekly.values()]
        .filter((week) => week.gross <= 0 || week.available <= 0).length;
      if (missingWeeks || inactiveWeeks || weekly.size !== expected.length) {
        excludedYears.push({ year, missingWeeks, inactiveWeeks });
        return;
      }
      const baseline = [...weekly.values()].reduce((sum, week) => sum + week.gross, 0) / weekly.size;
      if (!Number.isFinite(baseline) || baseline <= 0) {
        throw new Error("Seasonality cannot normalize this year's gross.");
      }
      includedYears.push(year);
      const monthly = this.months.map(() => []);
      weekly.forEach((week, reportingDate) => {
        monthly[Number(reportingDate.slice(5, 7)) - 1].push((week.gross / baseline) * 100);
      });
      monthly.forEach((indices, month) => {
        contributions[month].push(indices.reduce((sum, value) => sum + value, 0) / indices.length);
        weeksByMonth[month] += indices.length;
      });
    });
    return {
      includedYears,
      excludedYears,
      months: this.months.map((month, index) => ({
        month,
        index: contributions[index].length
          ? contributions[index].reduce((sum, value) => sum + value, 0) / contributions[index].length
          : null,
        years: contributions[index].length,
        weeks: weeksByMonth[index]
      }))
    };
  }
};
