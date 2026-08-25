"use strict";

const { createElement, formatCompact, formatPercent, populateDatalist, renderBars } = window.DashboardUtils;
const svgNamespace = "http://www.w3.org/2000/svg";
const historyYear = document.querySelector("#history-year");
const historyShow = document.querySelector("#history-show");
let historyRows = [];
let historyAwards = {};
let selectedHistoryShow = "";
let selectedHistoryWeek = "";
let historySort = { key: "gross", direction: "desc" };
let historyZoom = { start: 0, end: 1 };

const historySortLabels = {
  show: "Show Title",
  gross: "Total Gross",
  seats: "Total Seats",
  capacity: "Average Capacity"
};

const historyPremises = {
  "& Juliet": "Shakespeare's heroine imagines a new path after the ending of Romeo and Juliet. Contemporary pop songs frame a playful story about identity, friendship, and choosing one's own future.",
  "42nd Street": "A young dancer gets an unexpected chance to become a star when she steps into the leading role of a Broadway musical. Set amid the pressure and glamour of a major production, the story celebrates hard work, second chances, and the exhilaration of putting on a show.",
  "A Chorus Line": "Broadway dancers reveal their ambitions and personal histories while competing for a place in a musical's ensemble. As the audition becomes increasingly personal, the performers consider what they have sacrificed for a life onstage.",
  "Avenue Q": "A recent graduate moves to a quirky New York neighborhood while trying to find work, love, and a sense of purpose. Puppets and human characters share an irreverent coming-of-age comedy.",
  Aladdin: "A resourceful young man discovers a magical lamp and must decide who he wants to become while pursuing love and freedom. Magic, mistaken identity, and a wish-granting Genie propel an adventure about honesty and seeing beyond appearances.",
  "Beauty and the Beast": "A young woman enters an enchanted castle where compassion may break a curse and restore its inhabitants. Her growing connection with its isolated master explores empathy, transformation, and the difference between appearance and character.",
  Beetlejuice: "A mischievous ghost offers to help a grieving teenager frighten away the new residents of her home. Their chaotic partnership becomes a darkly comic exploration of family and feeling alive.",
  "Billy Elliot: The Musical": "A boy in a struggling English mining town discovers an unexpected passion for ballet. His ambitions challenge family expectations and the pressures surrounding his community.",
  Cabaret: "Artists and outsiders gather at a Berlin nightclub as political extremism closes in around their private lives. The glittering performances of the Kit Kat Club contrast with relationships and ambitions becoming increasingly vulnerable outside its doors.",
  Cats: "A tribe of cats assembles for a yearly celebration in which one will be chosen to begin a new life. Through music, movement, and individual introductions, the community shares its personalities, histories, and rituals.",
  Chicago: "Two accused murderers compete for fame, sympathy, and acquittal in a justice system driven by celebrity. Vaudeville-inspired numbers turn scandal and courtroom strategy into a sharp satire of publicity, ambition, and public attention.",
  "Come From Away": "After diverted flights land in a small Newfoundland town, local residents welcome thousands of stranded travelers. The ensemble story follows the unlikely community created during a moment of crisis.",
  "Death Becomes Her": "Two longtime rivals discover a mysterious way to preserve their youth. Their competition escalates into a glamorous dark comedy about vanity, friendship, and reinvention.",
  "Dear Evan Hansen": "A lonely teenager becomes entangled in a lie that gives him belonging while deeply affecting a grieving family. The contemporary musical examines isolation, anxiety, online attention, and the human need to feel seen.",
  "Fiddler on the Roof": "A Jewish milkman in imperial Russia tries to preserve family traditions as his daughters pursue changing ideas about love. Social and political pressures test the village around them.",
  Frozen: "Two royal sisters are separated after one reveals an extraordinary power she cannot control. Their journey centers on fear, family, and the different forms that love can take.",
  "Funny Girl": "A determined young performer rises from vaudeville stages to major stardom while navigating a complicated romance. The musical follows her wit, ambition, and distinctive voice.",
  Grease: "Teenagers at a 1950s high school negotiate romance, friendship, and the pressure to fit in. A summer relationship becomes more complicated when the couple unexpectedly reunites at school.",
  Gypsy: "An ambitious stage mother pushes her daughters through the fading world of vaudeville in pursuit of success. The musical examines family, performance, and the cost of an unfulfilled dream.",
  Hadestown: "The myths of Orpheus and Eurydice and Hades and Persephone intertwine in a journey to and from the underworld. In a folk- and jazz-inflected world shaped by scarcity and industry, two love stories examine trust, hope, and the courage required to imagine a different future.",
  Hamilton: "The life and political legacy of Alexander Hamilton unfold through the founding conflicts of the United States. Hip-hop, R&B, and traditional musical-theatre forms frame a story about ambition, authorship, rivalry, and the struggle to shape how history remembers a person.",
  "Harry Potter and the Cursed Child": "Harry Potter and his son Albus confront family expectations and dangerous consequences after attempting to change the past. Their story focuses on an uneasy father-son relationship, an unexpected friendship, and the burden of inheriting a famous legacy.",
  Hairspray: "A dance-loving Baltimore teenager challenges the rules of a popular television program in the 1960s. Her pursuit of a place on the show grows into a campaign for inclusion.",
  "Hell's Kitchen": "A teenage girl in Manhattan searches for independence while discovering the discipline and possibility offered by music. The coming-of-age story is inspired by the songs and experiences of Alicia Keys.",
  "In the Heights": "Residents of a close-knit Washington Heights neighborhood pursue changing dreams over several summer days. Music, family, and questions of home connect their intersecting stories.",
  "Jersey Boys": "Four musicians navigate friendship, conflict, and fame as they become Frankie Valli and the Four Seasons. Told from multiple viewpoints, the jukebox musical traces the work, loyalty, and personal tensions behind their distinctive sound.",
  "Les Misérables": "An ex-convict seeks redemption while a relentless inspector pursues him through decades of upheaval in France. Interwoven lives of workers, students, families, and revolutionaries create an epic meditation on justice, mercy, sacrifice, and social change.",
  "Mamma Mia!": "A bride secretly invites three men from her mother's past to her Greek-island wedding in hopes of discovering her father. Songs by ABBA accompany a sunny ensemble comedy about family, friendship, romance, and the different ways people define home.",
  "Mary Poppins": "A mysterious nanny brings imagination and order to a London family that has lost sight of what matters most. Her magical lessons encourage children and adults alike to reconsider work, play, responsibility, and their relationships with one another.",
  "Matilda The Musical": "A brilliant young reader faces neglectful parents and an intimidating headmistress. With imagination, courage, and an encouraging teacher, she begins to shape her own story.",
  "Maybe Happy Ending": "Two obsolete helper robots living quietly in Seoul form an unexpected connection. A small journey invites them to consider memory, companionship, and what makes a life meaningful.",
  "Mean Girls": "A teenager raised abroad enters an American high school and becomes entangled with its most powerful social clique. Comedy and pop music explore identity, loyalty, and the damage caused by status.",
  "MJ The Musical": "Michael Jackson prepares for a major concert tour while pivotal moments in his life and creative process come into focus. Rehearsal-room scenes and musical memories highlight the precision, collaboration, and relentless standards behind his stagecraft.",
  "Monty Python's Spamalot": "King Arthur and his knights embark on a cheerfully absurd search for the Holy Grail. The musical transforms medieval legend into a self-aware comedy packed with theatrical detours.",
  "Moulin Rouge! The Musical": "A young writer and a celebrated performer fall in love inside a glamorous Paris nightclub threatened by money and power. A collage of popular songs creates an extravagant world where artists defend beauty, freedom, truth, and love against commercial pressure.",
  Newsies: "Young newspaper sellers in turn-of-the-century New York organize after powerful publishers raise the cost of their papers. Their fight becomes a story of solidarity and finding a public voice.",
  "Oh, Mary!": "Mary Todd Lincoln longs for a theatrical life while enduring an increasingly chaotic version of the White House. The comedy freely reimagines historical figures through camp and farce.",
  Rent: "Young artists in New York build community and pursue love and purpose amid poverty, loss, and the AIDS crisis. Rock music drives an ensemble portrait of friendship, creative identity, and the urgency of living meaningfully in uncertain circumstances.",
  "School of Rock - The Musical": "An unemployed musician poses as a substitute teacher and discovers that his students have remarkable musical talent. Preparing them to perform changes both the class and their unconventional teacher.",
  "SIX: The Musical": "The six wives of Henry VIII take the stage as a pop group and compete to tell the most compelling version of their lives. Their concert reframes familiar history around their individual voices.",
  "Sunset Boulevard": "A struggling screenwriter becomes involved with Norma Desmond, a silent-film star who dreams of returning to the screen. Their uneasy collaboration unfolds inside a world shaped by faded fame, ambition, and Hollywood illusion.",
  "Sweeney Todd": "A barber returns to Victorian London carrying a deep grievance and opens a shop above a struggling pie business. Dark humor and operatic suspense drive a story about obsession and a corrupt city.",
  "The Book of Mormon": "Two mismatched missionaries encounter challenges to their faith and partnership during an assignment in Uganda. Their sheltered expectations collide with a community facing serious problems in an irreverent satire about belief, storytelling, and cultural misunderstanding.",
  "The Color Purple": "A woman in the American South searches for dignity, independence, and connection across decades of hardship. Music and community help her recognize her own strength and capacity for joy.",
  "The Great Gatsby": "A mysterious millionaire pursues an idealized romance amid the wealth and restlessness of the Jazz Age. The spectacle surrounds a story about longing, reinvention, and the promises people make to themselves.",
  "The Lion King": "A young lion prince must face his past and reclaim his place after his uncle seizes the kingdom. Puppetry, dance, and African-influenced music expand his coming-of-age journey into a theatrical reflection on family, responsibility, and the cycle of life.",
  "The Music Man": "A charismatic salesman arrives in an Iowa town promising to organize a children's band despite having no intention of teaching one. His scheme is complicated by a skeptical librarian and the community he hoped to fool.",
  "The Outsiders": "Two rival groups of teenagers struggle with class divisions, loyalty, and the need to belong in 1960s Oklahoma. The story follows young people trying to imagine lives beyond the roles assigned to them.",
  "The Phantom of the Opera": "A masked musical genius becomes obsessed with a young soprano beneath the Paris Opera House. Gothic romance, theatrical spectacle, and soaring music surround a story about artistic mentorship, longing, fear, and the desire to be accepted.",
  "The Producers": "A struggling producer and an anxious accountant devise a scheme built around staging a guaranteed Broadway failure. Their deliberately disastrous musical becomes the center of an escalating backstage farce.",
  "To Kill A Mockingbird": "A lawyer in Depression-era Alabama defends a Black man falsely accused of a crime while his children confront the prejudices surrounding them. The stage adaptation examines justice, empathy, and moral courage.",
  Waitress: "A gifted pie maker in an unhappy marriage sees a baking contest as a possible route toward change. Friendship, creativity, and an unexpected relationship complicate her search for a more independent life.",
  "West Side Story": "Two young people from rival communities fall in love amid escalating conflict on New York's West Side. Dance and music transform a familiar tragedy into a story about belonging and prejudice.",
  Wicked: "The future witches of Oz form an unlikely friendship before power, prejudice, and public perception drive them apart. By revisiting a familiar world from their perspective, the musical explores identity, moral courage, political storytelling, and the lasting influence of friendship."
};

function renderHistoryPremise() {
  const title = document.querySelector("#history-premise-title");
  const premise = document.querySelector("#history-premise");
  if (!selectedHistoryShow) {
    title.textContent = "Choose a production";
    premise.textContent = "Select a row in the table to read a short premise for that show.";
    return;
  }
  title.textContent = selectedHistoryShow;
  premise.textContent = historyPremises[selectedHistoryShow]
    || "A verified premise for this production is not yet included in the local dashboard data.";
}

function historyBaseRows() {
  const query = historyShow.value.trim().toLocaleLowerCase();
  return historyRows.filter((row) => (
    (!historyYear.value || row.year === historyYear.value)
    && (!query || row.show.toLocaleLowerCase().includes(query))
  ));
}

function historyWeekRows(rows) {
  return selectedHistoryWeek
    ? rows.filter((row) => row.date === selectedHistoryWeek)
    : rows;
}

function historyMetricRows(baseRows) {
  const rows = historyWeekRows(baseRows);
  return selectedHistoryShow
    ? rows.filter((row) => row.show === selectedHistoryShow)
    : rows;
}

function historyLineRows(baseRows) {
  return selectedHistoryShow
    ? baseRows.filter((row) => row.show === selectedHistoryShow)
    : baseRows;
}

function historyTotals(rows) {
  return rows.reduce((totals, row) => {
    totals.gross += row.gross;
    totals.seats += row.seats;
    totals.available += row.available;
    totals.ticketSum += row.ticketSum;
    totals.ticketCount += row.ticketCount;
    totals.shows.add(row.show);
    return totals;
  }, { gross: 0, seats: 0, available: 0, ticketSum: 0, ticketCount: 0, shows: new Set() });
}

function historyAwardTotals(shows) {
  return [...shows].reduce((totals, show) => {
    const awards = historyAwards[show] || { wins: 0, nominations: 0 };
    totals.wins += awards.wins;
    totals.nominations += awards.nominations;
    return totals;
  }, { wins: 0, nominations: 0 });
}

function svgElement(tag, attributes, text) {
  const element = document.createElementNS(svgNamespace, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderHistoryLine(rows) {
  const weekly = new Map();
  rows.forEach((row) => weekly.set(row.date, (weekly.get(row.date) || 0) + row.gross));
  const allValues = [...weekly].sort((a, b) => a[0].localeCompare(b[0]));
  const svg = document.querySelector("#history-line-chart");
  svg.replaceChildren();
  if (allValues.length === 0) return;

  const firstIndex = Math.floor(historyZoom.start * Math.max(allValues.length - 1, 0));
  const lastIndex = Math.ceil(historyZoom.end * Math.max(allValues.length - 1, 0));
  const values = allValues.slice(firstIndex, lastIndex + 1);

  const width = 700;
  const height = 245;
  const margin = { left: 62, right: 18, top: 18, bottom: 34 };
  const maximum = Math.max(...values.map(([, value]) => value), 1);
  const x = (index) => margin.left + (index / Math.max(values.length - 1, 1)) * (width - margin.left - margin.right);
  const y = (value) => margin.top + (1 - value / maximum) * (height - margin.top - margin.bottom);

  [0, .5, 1].forEach((position) => {
    const yPosition = margin.top + position * (height - margin.top - margin.bottom);
    svg.appendChild(svgElement("line", { x1: margin.left, x2: width - margin.right, y1: yPosition, y2: yPosition, class: "pbi-grid-line" }));
    svg.appendChild(svgElement("text", { x: margin.left - 8, y: yPosition + 4, "text-anchor": "end", class: "pbi-axis-text" }, formatHistoryGross(maximum * (1 - position))));
  });

  const path = values.map(([, value], index) => `${index ? "L" : "M"} ${x(index)} ${y(value)}`).join(" ");
  svg.appendChild(svgElement("path", { d: path, class: "pbi-line" }));

  [0, Math.floor((values.length - 1) / 2), values.length - 1].forEach((index) => {
    const date = new Date(`${values[index][0]}T00:00:00`);
    svg.appendChild(svgElement("text", { x: x(index), y: height - 8, "text-anchor": index === 0 ? "start" : index === values.length - 1 ? "end" : "middle", class: "pbi-axis-text" }, date.getFullYear()));
  });

  const hoverLayer = svgElement("g", { class: "history-line-hover", visibility: "hidden" });
  const guide = svgElement("line", {
    y1: margin.top,
    y2: height - margin.bottom,
    class: "history-hover-guide"
  });
  const point = svgElement("circle", { r: 5, class: "history-hover-point" });
  const tooltip = svgElement("g", { class: "history-chart-tooltip" });
  const tooltipBox = svgElement("rect", { width: 156, height: 45, rx: 6 });
  const tooltipDate = svgElement("text", { x: 10, y: 17 });
  const tooltipGross = svgElement("text", { x: 10, y: 35, class: "history-tooltip-value" });
  tooltip.append(tooltipBox, tooltipDate, tooltipGross);
  hoverLayer.append(guide, point, tooltip);
  svg.appendChild(hoverLayer);

  const showWeek = (index) => {
    const [dateValue, gross] = values[index];
    const xPosition = x(index);
    const yPosition = y(gross);
    const date = new Date(`${dateValue}T00:00:00`);
    const tooltipX = Math.min(Math.max(xPosition - 78, margin.left), width - margin.right - 156);
    const tooltipY = Math.max(margin.top, yPosition - 55);
    guide.setAttribute("x1", xPosition);
    guide.setAttribute("x2", xPosition);
    point.setAttribute("cx", xPosition);
    point.setAttribute("cy", yPosition);
    tooltip.setAttribute("transform", `translate(${tooltipX} ${tooltipY})`);
    tooltipDate.textContent = `Week of ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    tooltipGross.textContent = formatHistoryGross(gross);
    hoverLayer.setAttribute("visibility", "visible");
  };

  const selectWeek = (index) => {
    const dateValue = values[index][0];
    selectedHistoryWeek = selectedHistoryWeek === dateValue ? "" : dateValue;
    renderHistoryDashboard();
  };

  const interactionLayer = svgElement("rect", {
    x: margin.left,
    y: margin.top,
    width: width - margin.left - margin.right,
    height: height - margin.top - margin.bottom,
    class: "history-chart-interaction",
    tabindex: 0,
    role: "button",
    "aria-label": "Choose a week to filter the dashboard. Use the arrow keys to inspect weeks, then press Enter to select.",
    "aria-pressed": String(Boolean(selectedHistoryWeek))
  });
  interactionLayer.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * width;
    const index = Math.round(
      ((pointerX - margin.left) / (width - margin.left - margin.right)) * (values.length - 1)
    );
    keyboardIndex = Math.max(0, Math.min(index, values.length - 1));
    showWeek(keyboardIndex);
  });
  interactionLayer.addEventListener("wheel", (event) => {
    event.preventDefault();
    const bounds = svg.getBoundingClientRect();
    const pointerPosition = Math.max(0, Math.min(
      (event.clientX - bounds.left) / bounds.width,
      1
    ));
    const currentSpan = historyZoom.end - historyZoom.start;
    const minimumSpan = Math.max(8 / Math.max(allValues.length - 1, 8), .01);
    const nextSpan = Math.max(minimumSpan, Math.min(1, currentSpan * (event.deltaY < 0 ? .65 : 1.5)));
    const center = historyZoom.start + pointerPosition * currentSpan;
    let start = center - pointerPosition * nextSpan;
    let end = start + nextSpan;
    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > 1) {
      start -= end - 1;
      end = 1;
    }
    historyZoom = { start: Math.max(0, start), end: Math.min(1, end) };
    renderHistoryDashboard();
  }, { passive: false });
  interactionLayer.addEventListener("pointerleave", () => {
    const selectedIndex = values.findIndex(([date]) => date === selectedHistoryWeek);
    if (selectedIndex >= 0) showWeek(selectedIndex);
    else hoverLayer.setAttribute("visibility", "hidden");
  });
  interactionLayer.addEventListener("click", () => selectWeek(keyboardIndex));
  const initialSelectedIndex = values.findIndex(([date]) => date === selectedHistoryWeek);
  let keyboardIndex = initialSelectedIndex >= 0 ? initialSelectedIndex : values.length - 1;
  interactionLayer.addEventListener("focus", () => showWeek(keyboardIndex));
  interactionLayer.addEventListener("blur", () => {
    const selectedIndex = values.findIndex(([date]) => date === selectedHistoryWeek);
    if (selectedIndex >= 0) showWeek(selectedIndex);
    else hoverLayer.setAttribute("visibility", "hidden");
  });
  interactionLayer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      keyboardIndex = Math.max(0, Math.min(
        keyboardIndex + (event.key === "ArrowRight" ? 1 : -1),
        values.length - 1
      ));
      showWeek(keyboardIndex);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectWeek(keyboardIndex);
    } else if (event.key === "Escape" && selectedHistoryWeek) {
      event.preventDefault();
      selectedHistoryWeek = "";
      renderHistoryDashboard();
    }
  });
  svg.appendChild(interactionLayer);
  const selectedIndex = values.findIndex(([date]) => date === selectedHistoryWeek);
  if (selectedIndex >= 0) showWeek(selectedIndex);
}

function aggregateHistoryShows(rows) {
  const shows = new Map();
  rows.forEach((row) => {
    const current = shows.get(row.show) || { show: row.show, gross: 0, seats: 0, available: 0 };
    current.gross += row.gross;
    current.seats += row.seats;
    current.available += row.available;
    shows.set(row.show, current);
  });
  return [...shows.values()].sort((a, b) => b.gross - a.gross || a.show.localeCompare(b.show));
}

function historySortValue(row, key) {
  if (key === "capacity") return row.available ? row.seats / row.available : Number.NEGATIVE_INFINITY;
  return row[key];
}

function formatHistoryGross(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function sortHistoryShows(rows) {
  const direction = historySort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const first = historySortValue(a, historySort.key);
    const second = historySortValue(b, historySort.key);
    const comparison = typeof first === "string"
      ? first.localeCompare(second)
      : first - second;
    return comparison * direction || a.show.localeCompare(b.show);
  });
}

function updateHistorySortHeaders() {
  document.querySelectorAll("[data-history-sort-header]").forEach((header) => {
    const active = header.dataset.historySortHeader === historySort.key;
    header.setAttribute("aria-sort", active
      ? (historySort.direction === "asc" ? "ascending" : "descending")
      : "none");
    header.querySelector("span").textContent = active
      ? (historySort.direction === "asc" ? "\u25B2" : "\u25BC")
      : "";
  });
}

function renderHistoryTable(rows) {
  const body = document.querySelector("#history-table-body");
  body.replaceChildren(...sortHistoryShows(rows).map((row) => {
    const tr = document.createElement("tr");
    const selected = row.show === selectedHistoryShow;
    tr.className = selected ? "selected" : "";
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(selected));
    [row.show, formatHistoryGross(row.gross), formatCompact(row.seats), formatPercent(row.available ? row.seats / row.available : Number.NaN)]
      .forEach((value) => tr.appendChild(createElement("td", value)));
    const select = () => {
      selectedHistoryShow = selected ? "" : row.show;
      renderHistoryDashboard();
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
  updateHistorySortHeaders();
  const sortDescription = historySort.key === "show"
    ? (historySort.direction === "asc" ? "A to Z" : "Z to A")
    : (historySort.direction === "asc" ? "lowest to highest" : "highest to lowest");
  const weekDescription = selectedHistoryWeek
    ? ` for the week of ${new Date(`${selectedHistoryWeek}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "";
  document.querySelector("#history-table-status").textContent = selectedHistoryShow
    ? `Sorted by ${historySortLabels[historySort.key]}, ${sortDescription}. Filtering every visual by ${selectedHistoryShow}${weekDescription}. Select the row again to clear the production.`
    : `Sorted by ${historySortLabels[historySort.key]}, ${sortDescription}${weekDescription}. Select a row to filter every visual.`;
}

function renderHistoryDashboard() {
  const baseRows = historyBaseRows();
  const metricRows = historyMetricRows(baseRows);
  const totals = historyTotals(metricRows);
  const awards = historyAwardTotals(totals.shows);
  const showRows = aggregateHistoryShows(historyWeekRows(baseRows));

  document.querySelector("#history-total-gross").textContent = formatCompact(totals.gross, true);
  document.querySelector("#history-total-seats").textContent = formatCompact(totals.seats);
  document.querySelector("#history-total-shows").textContent = totals.shows.size.toLocaleString("en-US");
  document.querySelector("#history-win-rate").textContent = formatPercent(awards.nominations ? awards.wins / awards.nominations : Number.NaN);
  document.querySelector("#history-tony-wins").textContent = awards.wins.toLocaleString("en-US");
  document.querySelector("#history-nominations").textContent = awards.nominations.toLocaleString("en-US");
  document.querySelector("#history-ticket-price").textContent = totals.ticketCount
    ? (totals.ticketSum / totals.ticketCount).toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "N/A";
  document.querySelector("#history-capacity").textContent = formatPercent(totals.available ? totals.seats / totals.available : Number.NaN);
  renderHistoryPremise();

  renderHistoryLine(historyLineRows(baseRows));
  renderBars("history-production-bars", showRows.slice(0, 9).map((row) => ({
    label: row.show,
    value: row.gross,
    display: formatCompact(row.gross, true),
    selected: row.show === selectedHistoryShow,
    onSelect: () => {
      selectedHistoryShow = selectedHistoryShow === row.show ? "" : row.show;
      renderHistoryDashboard();
    }
  })));
  renderHistoryTable(showRows);
}

historyYear.addEventListener("change", () => {
  selectedHistoryShow = "";
  selectedHistoryWeek = "";
  historyZoom = { start: 0, end: 1 };
  renderHistoryDashboard();
});
historyShow.addEventListener("input", () => {
  selectedHistoryShow = "";
  selectedHistoryWeek = "";
  historyZoom = { start: 0, end: 1 };
  renderHistoryDashboard();
});
document.querySelector("#history-zoom-in").addEventListener("click", () => {
  const center = (historyZoom.start + historyZoom.end) / 2;
  const span = Math.max(.01, (historyZoom.end - historyZoom.start) * .6);
  historyZoom = { start: Math.max(0, center - span / 2), end: Math.min(1, center + span / 2) };
  renderHistoryDashboard();
});
document.querySelector("#history-zoom-out").addEventListener("click", () => {
  const center = (historyZoom.start + historyZoom.end) / 2;
  const span = Math.min(1, (historyZoom.end - historyZoom.start) * 1.67);
  let start = center - span / 2;
  let end = center + span / 2;
  if (start < 0) {
    end -= start;
    start = 0;
  }
  if (end > 1) {
    start -= end - 1;
    end = 1;
  }
  historyZoom = { start: Math.max(0, start), end: Math.min(1, end) };
  renderHistoryDashboard();
});
document.querySelector("#history-zoom-reset").addEventListener("click", () => {
  historyZoom = { start: 0, end: 1 };
  renderHistoryDashboard();
});
document.querySelectorAll("[data-history-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.historySort;
    historySort = historySort.key === key
      ? { key, direction: historySort.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "show" ? "asc" : "desc" };
    renderHistoryDashboard();
  });
});

fetch("history-dashboard-data.json")
  .then((response) => {
    if (!response.ok) throw new Error(`History data request failed: ${response.status}`);
    return response.json();
  })
  .then((data) => {
    historyRows = data.rows.map(([date, year, show, gross, seats, available, ticketSum, ticketCount]) => (
      { date, year, show, gross, seats, available, ticketSum, ticketCount }
    ));
    historyAwards = data.awards;
    [...new Set(historyRows.map((row) => row.year))]
      .sort((a, b) => b.localeCompare(a))
      .forEach((year) => historyYear.appendChild(createElement("option", year)));
    populateDatalist("history-shows", historyRows.map((row) => row.show));
    renderHistoryDashboard();
  })
  .catch((error) => console.error(error));
