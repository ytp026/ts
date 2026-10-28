"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const currentSnapshot = JSON.parse(fs.readFileSync("ticket-access-data.json", "utf8"));
const source = "https://playbill.com/article/broadway-rush-lottery-and-standing-room-only-policies-com-116003";
const snapshot = {
  checkedOn: "2026-10-27", source, scope: "Synthetic test directory",
  verification: "Some providers block automated access.",
  offers: [
    ["Wicked", "Lottery", "Digital Lottery", "$55"],
    ["Wicked", "Rush", "General Rush", "$45"],
    ["Hadestown", "Lottery", "Digital Lottery", "$49"],
    ["Hadestown", "SRO", "Standing Room", "$39"],
    ["Six: The Musical", "Lottery", "Digital Lottery", "$45"],
    ["Maybe Happy Ending", "Rush", "Digital Rush", "$49"],
    ["The Outsiders", "Rush", "$30 Under 30", "$30"],
    ["The Rocky Horror Show", "Lottery", "Digital Lottery", "$30"]
  ].map(([show, category, type, price]) => ({
    show, category, type, price, theatre: `${show} Theatre`, how: "Enter online",
    time: "9 AM", limit: "Limit 2", link: "https://tickets.example/entry",
    ...(show === "Hadestown" ? { source: "https://hadestown.com/tickets" } : {}),
    ...(show === "The Rocky Horror Show" ? { note: "Entry link returned 404", link: source } : {})
  }))
};
const clone = () => structuredClone(snapshot);

function element() {
  return {
    children: [], textContent: "", value: "", disabled: true, listeners: {},
    style: { setProperty(name, value) { this[name] = value; } },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(event, callback) { this.listeners[event] = callback; },
    querySelector() { return this.selected; }
  };
}

async function page(data = clone(), status = 200) {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    createElement: element
  };
  document.querySelector("#ticket-category").selected = { value: "All" };
  const requests = [];
  const errors = [];
  const context = {
    document, URL, Date,
    console: { error: (error) => errors.push(error) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: status === 200, status, json: async () => data };
    }
  };
  vm.runInNewContext(fs.readFileSync("rush.js", "utf8"), context);
  await new Promise(setImmediate);
  return { context, elements, requests, errors, get: (selector) => document.querySelector(selector) };
}

test("directory totals reconcile without pinning changing production counts or prices", async () => {
  const { context, get, errors } = await page();
  assert.equal(errors.length, 0);
  assert.equal(context.validateTicketData(snapshot), snapshot);
  assert.equal(context.validateTicketData(currentSnapshot), currentSnapshot);
  assert.equal(get("#ticket-total").textContent, 8);
  assert.equal(get("#ticket-show-total").textContent, 6);
  assert.equal(get("#ticket-rush-total").textContent, 3);
  assert.equal(get("#ticket-lottery-total").textContent, 4);
  assert.equal(get("#ticket-sro-total").textContent, 1);
  assert.equal(get("#ticket-rush-bar").style["--width"], "75%");
  assert.equal(get("#ticket-lottery-bar").style["--width"], "100%");
  assert.equal(get("#ticket-count").textContent, "8 offers");
  assert.equal(get("#ticket-filters").disabled, false);
});

test("rendering fixture distinguishes offer types and unavailable-provider caveats", () => {
  const offer = (show, type) => snapshot.offers.find((item) => item.show === show && item.type === type);
  assert.equal(offer("Hadestown", "Digital Lottery").price, "$49");
  assert.equal(offer("Six: The Musical", "Digital Lottery").price, "$45");
  assert.equal(offer("Wicked", "Digital Lottery").price, "$55");
  assert.doesNotMatch(offer("Wicked", "Digital Lottery").how, /students available/);
  assert.equal(offer("Maybe Happy Ending", "Digital Rush").price, "$49");
  assert.equal(offer("The Outsiders", "$30 Under 30").price, "$30");
  assert.match(offer("The Rocky Horror Show", "Digital Lottery").note, /404/);
  assert.equal(offer("The Rocky Horror Show", "Digital Lottery").link, snapshot.source);
  assert.match(snapshot.verification, /block automated access/);
});

test("metadata, dates, missing prices, unsafe URLs and duplicate offers are rejected", async () => {
  const { context } = await page();
  for (const change of [
    (data) => { data.checkedOn = "2026-02-30"; },
    (data) => { data.scope = ""; },
    (data) => { data.source = "javascript:alert(1)"; },
    (data) => { data.offers[0].price = ""; },
    (data) => { data.offers[0].category = "Unknown"; },
    (data) => { data.offers[0].link = "javascript:alert(1)"; },
    (data) => { data.offers.push({ ...data.offers[0] }); }
  ]) {
    const data = clone();
    change(data);
    assert.throws(() => context.validateTicketData(data), /Invalid|Duplicate/);
  }
  assert.throws(() => context.validateTicketData([]), /Invalid/);
});

test("review date is stable, stale guides are flagged, future dates rejected", async () => {
  const { context } = await page();
  assert.equal(context.ticketFreshness("2026-10-27", new Date("2026-10-27T23:59:00Z")),
    "Guide reviewed October 27, 2026.");
  assert.doesNotMatch(context.ticketFreshness("2026-10-27", new Date("2026-11-26T00:00:00Z")), /overdue/);
  assert.match(context.ticketFreshness("2026-10-27", new Date("2026-11-27T00:00:00Z")), /overdue/);
  assert.throws(() => context.ticketFreshness("2026-10-27", new Date("2026-10-26T00:00:00Z")), /future/);
});

test("case-insensitive search and category filters preserve directory-wide counts", async () => {
  const { get } = await page();
  get("#ticket-search").value = "  WICKED ";
  get("#ticket-search").listeners.input();
  assert.equal(get("#ticket-count").textContent, "2 offers");
  get("#ticket-category").selected.value = "Lottery";
  get("#ticket-category").listeners.change();
  assert.equal(get("#ticket-count").textContent, "1 offer");
  assert.equal(get("#ticket-list").children[0].children[0].children[1].textContent, "$55");
  assert.equal(get("#ticket-total").textContent, 8);
  get("#ticket-search").value = "nonexistent show";
  get("#ticket-search").listeners.input();
  assert.equal(get("#ticket-count").textContent, "0 offers");
  assert.match(get("#ticket-list").children[0].textContent, /No offers match/);
});

test("HTTP and malformed-data failures show an explicit error and keep filters disabled", async () => {
  for (const [data, status] of [[clone(), 503], [{ offers: [] }, 200]]) {
    const { get, errors } = await page(data, status);
    assert.equal(errors.length, 1);
    assert.equal(get("#ticket-count").textContent, "Ticket information unavailable");
    assert.match(get("#ticket-list").children[0].textContent, /could not be loaded/);
    assert.equal(get("#ticket-freshness").textContent, "Review date unavailable.");
    assert.equal(get("#ticket-search").disabled, true);
    assert.equal(get("#ticket-filters").disabled, true);
  }
});

test("valid empty directory differs from a failed load or unmatched filter", async () => {
  const data = clone();
  data.offers = [];
  const { get, errors } = await page(data);
  assert.equal(errors.length, 0);
  assert.equal(get("#ticket-total").textContent, 0);
  assert.equal(get("#ticket-rush-bar").style["--width"], "0%");
  assert.match(get("#ticket-list").children[0].textContent, /No offers are currently listed/);
});

test("requests bypass cache and cards retain provider notes and source links", async () => {
  const { get, requests } = await page();
  assert.equal(requests[0].options.cache, "no-store");
  get("#ticket-search").value = "hadestown";
  get("#ticket-search").listeners.input();
  const disclosure = get("#ticket-list").children[0].children.at(-1);
  assert.equal(disclosure.children.at(-1).textContent, "Policy source →");
  assert.equal(disclosure.children.at(-1).href, "https://hadestown.com/tickets");
  assert.equal(disclosure.children.at(-1).rel, "noopener");
});

test("automatic checks show a 14-day due date and flag missed checks", async () => {
  const data = clone();
  data.automation = { intervalDays: 14, nextCheckOn: "2026-11-10" };
  const { context, get, errors } = await page(data);
  assert.equal(errors.length, 0);
  assert.match(get("#ticket-freshness").textContent, /automatically checked October 27, 2026/);
  assert.match(get("#ticket-freshness").textContent, /Next check due November 10, 2026/);
  assert.doesNotMatch(context.ticketFreshness(data.checkedOn, new Date("2026-11-10T00:00:00Z"), data.automation), /overdue/);
  assert.match(context.ticketFreshness(data.checkedOn, new Date("2026-11-11T00:00:00Z"), data.automation), /Check overdue/);
  data.automation.nextCheckOn = "2026-11-24";
  assert.throws(() => context.validateTicketData(data), /Invalid ticket check schedule/);
});
