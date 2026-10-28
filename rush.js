"use strict";

const searchInput = document.querySelector("#ticket-search");
const categoryFilter = document.querySelector("#ticket-category");
const ticketList = document.querySelector("#ticket-list");
const ticketCount = document.querySelector("#ticket-count");

let ticketOptions = [];

function validateTicketData(data) {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data.checkedOn) ||
      !Number.isFinite(Date.parse(data.checkedOn)) ||
      new Date(data.checkedOn).toISOString().slice(0, 10) !== data.checkedOn ||
      typeof data.scope !== "string" || !data.scope.trim() ||
      typeof data.verification !== "string" || !data.verification.trim() ||
      !Array.isArray(data.offers)) {
    throw new Error("Invalid ticket directory or review date");
  }
  const keys = new Set();
  const isHttps = (value) => {
    try { return new URL(value).protocol === "https:"; }
    catch { return false; }
  };
  if (!isHttps(data.source)) throw new Error("Invalid ticket policy source");
  if (data.automation) {
    const next = new Date(Date.parse(data.checkedOn) + 14 * 86400000).toISOString().slice(0, 10);
    if (data.automation.intervalDays !== 14 || data.automation.nextCheckOn !== next) {
      throw new Error("Invalid ticket check schedule");
    }
  }
  for (const offer of data.offers) {
    if (!offer || !["Rush", "Lottery", "SRO"].includes(offer.category) ||
        !["show", "theatre", "type", "price", "how", "time", "limit", "link"]
          .every((field) => typeof offer[field] === "string" && offer[field].trim()) ||
        !isHttps(offer.link) || (offer.source && !isHttps(offer.source))) {
      throw new Error("Invalid or incomplete ticket offer");
    }
    const key = `${offer.show}|${offer.category}|${offer.type}`.toLowerCase();
    if (keys.has(key)) throw new Error(`Duplicate ticket offer: ${offer.show} ${offer.type}`);
    keys.add(key);
  }
  return data;
}

function ticketFreshness(checkedOn, now = new Date(), automation = null) {
  const date = new Date(`${checkedOn}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = (today - date.getTime()) / 86400000;
  if (ageDays < 0) throw new Error("Ticket review date is in the future");
  const label = date.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC"
  });
  if (automation) {
    const next = new Date(`${automation.nextCheckOn}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric", timeZone: "UTC"
    });
    return `Guide automatically checked ${label}. Next check due ${next}.${ageDays > 14
      ? " Check overdue; confirm every offer with its provider." : ""}`;
  }
  return `Guide reviewed ${label}.${ageDays > 30 ? " Review overdue; confirm every offer with its provider." : ""}`;
}

function renderTicketTotals(offers) {
  document.querySelector("#ticket-total").textContent = offers.length;
  document.querySelector("#ticket-show-total").textContent = new Set(offers.map((offer) => offer.show)).size;
  const counts = ["Rush", "Lottery", "SRO"].map((category) =>
    offers.filter((offer) => offer.category === category).length);
  const maximum = Math.max(1, ...counts);
  ["rush", "lottery", "sro"].forEach((category, index) => {
    document.querySelector(`#ticket-${category}-total`).textContent = counts[index];
    document.querySelector(`#ticket-${category}-bar`).style.setProperty("--width", `${counts[index] / maximum * 100}%`);
  });
}

function addTextElement(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function addDetail(list, label, value) {
  if (!value || value === "N/A") return;
  const wrapper = document.createElement("div");
  addTextElement(wrapper, "dt", label);
  addTextElement(wrapper, "dd", value);
  list.appendChild(wrapper);
}

function buildTicketCard(option) {
  const article = document.createElement("article");
  article.className = "ticket-card";

  const top = document.createElement("div");
  top.className = "ticket-card-top";
  addTextElement(top, "span", option.category, `ticket-badge badge-${option.category.toLowerCase()}`);
  addTextElement(top, "strong", option.price, "ticket-price");
  article.appendChild(top);

  addTextElement(article, "h3", option.show);
  addTextElement(article, "p", option.theatre || option.where, "ticket-theatre");
  addTextElement(article, "p", option.type, "ticket-method");

  const disclosure = document.createElement("details");
  disclosure.className = "ticket-details";
  addTextElement(disclosure, "summary", "View ticket details");

  const details = document.createElement("dl");
  addDetail(details, "When", option.time);
  addDetail(details, "How", option.how);
  addDetail(details, "Where", option.where);
  addDetail(details, "ID", option.id);
  addDetail(details, "Limit", option.limit);
  addDetail(details, "Pay", option.payment);
  addDetail(details, "Seats", option.seating);
  addDetail(details, "Supply", option.availability);
  addDetail(details, "Note", option.note);
  disclosure.appendChild(details);

  const link = addTextElement(disclosure, "a", "Check current policy →", "ticket-link");
  link.href = option.link;
  link.target = "_blank";
  link.rel = "noopener";
  if (option.source && option.source !== option.link) {
    const source = addTextElement(disclosure, "a", "Policy source →", "ticket-link");
    source.href = option.source;
    source.target = "_blank";
    source.rel = "noopener";
  }
  article.appendChild(disclosure);

  return article;
}

function renderTickets() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  const category = categoryFilter.querySelector("input:checked").value;
  const filtered = ticketOptions.filter((option) => {
    const matchesCategory = category === "All" || option.category === category;
    const searchable = `${option.show} ${option.theatre} ${option.type}`.toLocaleLowerCase();
    return matchesCategory && searchable.includes(query);
  });

  ticketList.replaceChildren(...filtered.map(buildTicketCard));
  ticketCount.textContent = `${filtered.length} ${filtered.length === 1 ? "offer" : "offers"}`;

  if (filtered.length === 0) {
    addTextElement(
      ticketList,
      "p",
      ticketOptions.length
        ? "No offers match that search. Try another show or select all offer types."
        : "No offers are currently listed. Check the Playbill source for the latest policies.",
      "empty-state"
    );
  }
}

searchInput.addEventListener("input", renderTickets);
categoryFilter.addEventListener("change", renderTickets);

fetch("ticket-access-data.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`Ticket data request failed: ${response.status}`);
    return response.json();
  })
  .then((data) => {
    validateTicketData(data);
    document.querySelector("#ticket-freshness").textContent = ticketFreshness(data.checkedOn, new Date(), data.automation);
    document.querySelector("#ticket-source-note").textContent = `${data.scope} ${data.verification}`;
    ticketOptions = data.offers.slice().sort((a, b) => a.show.localeCompare(b.show));
    renderTicketTotals(ticketOptions);
    searchInput.disabled = false;
    document.querySelector("#ticket-filters").disabled = false;
    renderTickets();
  })
  .catch((error) => {
    ticketCount.textContent = "Ticket information unavailable";
    ticketOptions = [];
    renderTicketTotals([]);
    for (const id of ["total", "show-total", "rush-total", "lottery-total", "sro-total"]) {
      document.querySelector(`#ticket-${id}`).textContent = "—";
    }
    document.querySelector("#ticket-freshness").textContent = "Review date unavailable.";
    document.querySelector("#ticket-source-note").textContent = "Directory data could not be loaded. Use the Playbill source link above.";
    ticketList.replaceChildren();
    addTextElement(
      ticketList,
      "p",
      "The ticket directory could not be loaded. Please use the Playbill source link above.",
      "empty-state"
    );
    console.error(error);
  });
