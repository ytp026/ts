"use strict";

const searchInput = document.querySelector("#ticket-search");
const categoryFilter = document.querySelector("#ticket-category");
const ticketList = document.querySelector("#ticket-list");
const ticketCount = document.querySelector("#ticket-count");

let ticketOptions = [];

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
  disclosure.appendChild(details);

  const link = addTextElement(disclosure, "a", "Check current policy →", "ticket-link");
  link.href = option.link;
  link.target = "_blank";
  link.rel = "noopener";
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
      "No offers match that search. Try another show or select all offer types.",
      "empty-state"
    );
  }
}

searchInput.addEventListener("input", renderTickets);
categoryFilter.addEventListener("change", renderTickets);

fetch("ticket-access-data.json")
  .then((response) => {
    if (!response.ok) throw new Error(`Ticket data request failed: ${response.status}`);
    return response.json();
  })
  .then((data) => {
    ticketOptions = data;
    renderTickets();
  })
  .catch((error) => {
    ticketCount.textContent = "Ticket information unavailable";
    addTextElement(
      ticketList,
      "p",
      "The ticket directory could not be loaded. Please use the Playbill source link above.",
      "empty-state"
    );
    console.error(error);
  });
