"use strict";

let memories = [];
let lastCsvText = "";

const list = document.querySelector("#memory-list");
const search = document.querySelector("#memory-search");
const year = document.querySelector("#memory-year");
const ratingFilter = document.querySelector("#memory-rating-filter");
const castFilter = document.querySelector("#memory-cast-filter");
const musicFilter = document.querySelector("#memory-music-filter");
const stageFilter = document.querySelector("#memory-stage-filter");
const storyFilter = document.querySelector("#memory-story-filter");
const priceSort = document.querySelector("#memory-price-sort");
const clearFilters = document.querySelector("#memory-clear-filters");
const filterStatus = document.querySelector("#memory-filter-status");
const empty = document.querySelector("#memory-empty");
const timelinePrevious = document.querySelector("#memory-timeline-previous");
const timelineNext = document.querySelector("#memory-timeline-next");
const timelineHelp = document.querySelector("#memory-timeline-help");
const reactionFilters = [ratingFilter, castFilter, musicFilter, stageFilter, storyFilter];

function reactionRange(filter) {
  const minimum = Number(filter.querySelector('[data-range-bound="min"]').value);
  const maximum = Number(filter.querySelector('[data-range-bound="max"]').value);
  return { minimum, maximum, active: minimum > 1 || maximum < 5 };
}

function resetReactionFilter(filter) {
  filter.querySelector('[data-range-bound="min"]').value = "1";
  filter.querySelector('[data-range-bound="max"]').value = "5";
}

function timelineEntries() {
  return [...list.querySelectorAll(".memory-entry")];
}

function updateTimelineNavigation() {
  const maximum = Math.max(0, list.scrollWidth - list.clientWidth);
  timelinePrevious.disabled = list.scrollLeft <= 2;
  timelineNext.disabled = list.scrollLeft >= maximum - 2;
}

function updateTimelineRail() {
  const rail = list.querySelector(".memory-timeline-rail");
  const entries = timelineEntries();
  if (!rail || !entries.length) {
    if (rail) rail.hidden = true;
    return;
  }
  const firstMarker = entries[0].offsetLeft + 22;
  const lastMarker = entries.at(-1).offsetLeft + 22;
  rail.hidden = false;
  rail.style.left = `${firstMarker}px`;
  rail.style.width = `${Math.max(4, lastMarker - firstMarker)}px`;
}

function scrollTimeline(direction) {
  list.scrollBy({ left: direction * Math.max(260, list.clientWidth * .82), behavior: "smooth" });
}

timelinePrevious.addEventListener("click", () => scrollTimeline(-1));
timelineNext.addEventListener("click", () => scrollTimeline(1));
list.addEventListener("scroll", updateTimelineNavigation, { passive: true });
window.addEventListener("resize", () => {
  updateTimelineNavigation();
  updateTimelineRail();
});
list.addEventListener("wheel", (event) => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollWidth <= list.clientWidth) return;
  list.scrollLeft += event.deltaY;
  event.preventDefault();
}, { passive: false });
list.addEventListener("keydown", (event) => {
  const entries = timelineEntries();
  const current = event.target.closest(".memory-entry");
  const currentIndex = Math.max(0, entries.indexOf(current));
  let nextIndex;
  if (event.key === "ArrowRight") nextIndex = Math.min(entries.length - 1, currentIndex + 1);
  if (event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = entries.length - 1;
  if (nextIndex !== undefined && entries[nextIndex]) {
    event.preventDefault();
    entries.forEach((entry, index) => { entry.tabIndex = index === nextIndex ? 0 : -1; });
    entries[nextIndex].focus();
    entries[nextIndex].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    return;
  }
  if (event.key === "PageDown" || event.key === "PageUp") {
    event.preventDefault();
    scrollTimeline(event.key === "PageDown" ? 1 : -1);
  }
});

function normalizeDate(value) {
  const text = value.trim();
  const usDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDate) {
    const [, month, day, year] = usDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function formatDate(value) {
  if (!value) return "Date not recorded";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

const usdRates = { "$": 1, "£": 1.35, "€": 1.1 };

function priceInUsd(value) {
  const match = value.match(/([£$€])\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return Number.NaN;
  const amount = Number(match[2].replaceAll(",", ""));
  return Number.isFinite(amount) ? amount * usdRates[match[1]] : Number.NaN;
}

function initials(show) {
  return show.split(/\s+/).filter(Boolean).slice(0, 3).map((word) => word[0]).join("");
}

const reactionLabels = {
  5: "Loved it",
  4: "Really liked it",
  3: "Liked it",
  2: "Mixed feelings",
  1: "Not for me"
};

const artworkPalettes = [
  ["#182a52", "#d65b4a", "#f5cf72"],
  ["#21453f", "#d69a45", "#f2ead8"],
  ["#4a214f", "#d86678", "#f4d58c"],
  ["#173f59", "#46a0a0", "#f3c969"],
  ["#4f261f", "#bb6547", "#f0dfbd"],
  ["#26384f", "#7b6fd0", "#f2c85b"],
  ["#3c2548", "#bc5f91", "#f0dfca"],
  ["#153e42", "#d97845", "#f1d897"]
];

function showHash(show) {
  return [...show].reduce((hash, character) => (
    ((hash << 5) - hash + character.charCodeAt(0)) | 0
  ), 0) >>> 0;
}

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;"
  })[character]);
}

function wrapArtworkText(value, maximumCharacters, maximumLines) {
  const words = value.split(/\s+/).flatMap((word) => {
    if (word.length <= maximumCharacters) return word;
    const parts = [];
    for (let index = 0; index < word.length; index += maximumCharacters) {
      parts.push(word.slice(index, index + maximumCharacters));
    }
    return parts;
  });
  const lines = [];
  words.forEach((word) => {
    const current = lines.at(-1);
    if (current && `${current} ${word}`.length <= maximumCharacters) {
      lines[lines.length - 1] = `${current} ${word}`;
    } else if (lines.length < maximumLines) {
      lines.push(word);
    } else {
      lines[maximumLines - 1] += ` ${word}`;
    }
  });
  return lines;
}

function artworkTitleLines(show) {
  return wrapArtworkText(show, 18, 4);
}

function artworkSubtitleLines(subtitle) {
  return wrapArtworkText(subtitle, 27, 2);
}

const artworkConcepts = {
  "& Juliet": ["heart", "A NEW ENDING"],
  "Ain't Too Proud": ["microphone", "FIVE VOICES"],
  "Anastasia": ["crown", "A LOST PRINCESS"],
  "Back to the Future": ["clock", "TIME IN MOTION"],
  "Broadway in the Park": ["park", "THEATRE OUTDOORS"],
  "Cabaret": ["cabaret-hat-cane", "WELCOME TO THE CLUB"],
  "Carousel": ["carousel", "ROUND AND ROUND"],
  "Cats": ["cat", "EYES IN THE DARK"],
  "Charlie and the Chocolate Factory": ["chocolate-factory", "THE GOLDEN TICKET"],
  "Chicago": ["jazz-justice", "JAZZ AND JUSTICE"],
  "Come Alive": ["circus", "THE BIG TOP"],
  "Come Alive! The Greatest Showman Circus Spectacular": ["circus", "THE BIG TOP"],
  "Come From Away": ["airplane", "A MAP OF KINDNESS"],
  "Company": ["network", "LIVES CONNECTED"],
  "Dead Outlaw": ["coffin-hat", "THE LAST RIDE"],
  "Dear Evan Hansen": ["letter", "WORDS ON A PAGE"],
  "Death Becomes Her": ["potion", "FOREVER FABULOUS"],
  "Disney's Frozen": ["snow", "WINTER MAGIC"],
  "Disney's Hercules": ["lightning", "A HERO RISES"],
  "Fiddler on the Roof": ["rooftop-violin", "MUSIC ABOVE HOME"],
  "Gypsy": ["vanity-mirror", "BORN FOR THE SPOTLIGHT"],
  "Hamilton": ["quill", "HISTORY IN INK"],
  "Harry Potter and the Cursed Child": ["wand", "A CURSED CLOCK"],
  "Harry Potter and the Cursed Child: Part One": ["wand", "THE FIRST SPELL"],
  "Hugh Jackman: From New York, With Love": ["city-heart", "A LOVE LETTER TO NEW YORK"],
  "Hunchback of Notre Dame": ["bell", "BELLS ABOVE PARIS"],
  "Into The Woods": ["forest", "THE PATH BETWEEN TREES"],
  "Jesus Christ Superstar": ["rock-cross", "LIGHT AND SHADOW"],
  "Just in Time": ["clock-note", "MUSIC ON THE CLOCK"],
  "Kinky Boots": ["boot", "STEP INTO YOUR TRUTH"],
  "Les Miserables": ["revolution-barricade", "MERCY, REVOLUTION, REDEMPTION"],
  "Life of Pi": ["boat", "A BOAT ON THE HORIZON"],
  "Little Shop of Horrors": ["plant", "FEED THE BLOOM"],
  "Mamma Mia!": ["island-wedding", "THREE LETTERS, ONE WEDDING"],
  "Maybe Happy Ending": ["robot", "A SMALL MACHINE WITH HEART"],
  "Matilda The Musical": ["telekinetic-book", "BOOKS AND BRAVERY"],
  "Monty Python's Spamalot": ["castle", "A VERY SILLY QUEST"],
  "Moulin Rouge!": ["windmill", "THE RED WINDMILL"],
  "My Fair Lady": ["phonetics-flowers", "FLOWERS AND FINERY"],
  "My Neighbor Totoro": ["leaf", "A FOREST FRIEND"],
  "Old Friends": ["songbook-duet", "SONDHEIM SONGS, SHARED AGAIN"],
  "Operation Mincemeat": ["secret-file", "A SECRET MISSION"],
  "Operation Mincemeat: A New Musical": ["secret-file", "A SECRET MISSION"],
  "Othello": ["moon", "TRUST IN SHADOW"],
  "Parade": ["factory-justice", "LOVE STANDS AGAINST INJUSTICE"],
  "Pirates! The Penzance Musical": ["ship", "SAIL INTO SONG"],
  "Real Women Have Curves": ["sewing", "CUT TO FIT REAL LIFE"],
  "Rent": ["camera-guitar", "ONE YEAR, ART, AND FOUND FAMILY"],
  "Romeo & Juliet": ["double-heart", "TWO HOUSES, ONE HEART"],
  "Sexual Misconduct of the Middle Classes": ["lecture-boundary", "LESSONS AND BOUNDARIES"],
  "Six": ["six-crowns", "SIX QUEENS, SIX VOICES"],
  "Sleep No More": ["mask", "BEHIND THE MASK"],
  "Some Like It Hot": ["sax", "BRASS UNDER PRESSURE"],
  "Spring Awakening": ["flower", "A SEASON BREAKS OPEN"],
  "Suffs": ["march-signs", "VOICES FOR THE VOTE"],
  "Sunset Blvd.": ["sunset", "A CAMERA FACES WEST"],
  "The Great Gatsby": ["deco", "GOLD AFTER MIDNIGHT"],
  "The Lion King": ["lion", "THE SUN RISES"],
  "The Mousetrap": ["keyhole-eyes", "EYES IN THE DARK"],
  "The Notebook": ["notebook", "LOVE BETWEEN THE LINES"],
  "Waitress": ["pie", "A SLICE OF A NEW LIFE"]
};

const inferredArtworkConcepts = [
  [/\bwicked|witch|magic|spell\b/i, "wand", "MAGIC IN THE AIR"],
  [/\bhades|hadestown|underworld|outlaw\b/i, "key", "A JOURNEY BELOW"],
  [/\bchristmas|holiday|frozen|snow\b/i, "snow", "A WINTER SPECTACLE"],
  [/\bchocolate|candy|waitress|pie\b/i, "pie", "SOMETHING SWEET"],
  [/\bking|queen|prince|princess|crown\b/i, "crown", "ROYAL SPOTLIGHT"],
  [/\blion\b/i, "lion", "THE CIRCLE RISES"],
  [/\bcat|mousetrap|mouse\b/i, "cat", "EYES IN THE DARK"],
  [/\bwoods?|forest|tree|totoro\b/i, "forest", "INTO THE FOREST"],
  [/\bpirate|ship|ocean|sea\b/i, "ship", "SAIL INTO THE STORY"],
  [/\btime|future|clock\b/i, "clock", "TIME IN MOTION"],
  [/\blove|heart|romeo|juliet\b/i, "double-heart", "TWO HEARTS ON STAGE"],
  [/\bpotter|curse|wizard\b/i, "wand", "A SPELLBOUND NIGHT"],
  [/\bmusic|song|rock|concert\b/i, "microphone", "THE SOUND TAKES CENTER STAGE"],
  [/\bcity|new york|broadway\b/i, "skyline", "LIGHTS ABOVE THE CITY"]
];

const fallbackArtworkScenes = [
  "star", "sunburst", "mask", "microphone", "city-heart",
  "books", "banner", "clock", "flower", "moon"
];

function resolveArtworkConcept(memory, hash) {
  if (artworkConcepts[memory.show]) return artworkConcepts[memory.show];
  const inferred = inferredArtworkConcepts.find(([pattern]) => pattern.test(memory.show));
  if (inferred) return inferred.slice(1);
  return [
    fallbackArtworkScenes[hash % fallbackArtworkScenes.length],
    "A NEW THEATRE MEMORY"
  ];
}

function artworkColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
}

function artworkBackdrop(hash, accent, highlight) {
  const variant = hash % 4;
  if (variant === 0) {
    return `<path d="M40 70h520M40 130h520M40 190h520M40 250h520M40 310h520M40 370h520M40 430h520" stroke="${highlight}" opacity=".08" stroke-width="3"/>`;
  }
  if (variant === 1) {
    return `<circle cx="300" cy="285" r="225" fill="none" stroke="${highlight}" opacity=".12" stroke-width="4"/><circle cx="300" cy="285" r="175" fill="none" stroke="${accent}" opacity=".16" stroke-width="3"/>`;
  }
  if (variant === 2) {
    return `<path d="M40 470L210 70h180l170 400" fill="${highlight}" opacity=".07"/><path d="M85 470L240 110h120l155 360" fill="none" stroke="${accent}" opacity=".18" stroke-width="5"/>`;
  }
  return `<path d="M40 85l520 360M560 85L40 445" stroke="${highlight}" opacity=".1" stroke-width="5"/><circle cx="300" cy="265" r="195" fill="${accent}" opacity=".07"/>`;
}

function artworkScene(scene, accent, highlight) {
  const line = `fill="none" stroke="${highlight}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"`;
  const thin = `fill="none" stroke="${accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"`;
  const scenes = {
    "secret-file": `<path d="M115 185h145l35-55h190v320H115z" fill="${accent}" opacity=".3" stroke="${highlight}" stroke-width="11"/><path d="M155 225h290v185H155z" fill="${highlight}" opacity=".92"/><path d="M195 265h210M195 305h150M195 345h180" fill="none" stroke="${accent}" stroke-width="9" stroke-linecap="round"/><rect x="205" y="245" width="190" height="120" rx="8" fill="none" stroke="${accent}" stroke-width="8" transform="rotate(-8 300 305)"/><text x="300" y="320" text-anchor="middle" fill="${accent}" font-family="Aptos,Segoe UI,sans-serif" font-size="30" font-weight="900" letter-spacing="3" transform="rotate(-8 300 305)">TOP SECRET</text><path d="M105 470h390M165 450l-35 55M435 450l35 55" ${line}/>`,
    "chocolate-factory": `<path d="M115 445V250h85v-95h75v95h55V125h80v125h75v195z" fill="${accent}" opacity=".32" stroke="${highlight}" stroke-width="10"/><path d="M165 250v-70M370 125V70M455 250v-95M95 445h410" ${line}/><path d="M185 330c0-48 78-48 78 0s-78 48-78 0zm152 12c0-58 95-58 95 0s-95 58-95 0z" fill="${highlight}"/><path d="M225 155c-35-55 38-92 70-45 34-48 108-8 70 47-35 50-69 65-70 65-1 0-36-16-70-67z" fill="${highlight}" opacity=".9"/><path d="M125 485h350" ${thin}/>`,
    heart: `<path d="M300 440C105 315 150 150 265 205c20 10 35 28 35 28s15-18 35-28c115-55 160 110-35 235z" ${line}/><path d="M225 300h150" ${thin}/>`,
    microphone: `<rect x="255" y="130" width="90" height="185" rx="45" fill="${accent}"/><path d="M210 275c0 125 180 125 180 0M300 395v80M245 475h110" ${line}/><circle cx="155" cy="300" r="18" fill="${highlight}"/><circle cx="445" cy="300" r="18" fill="${highlight}"/>`,
    crown: `<path d="M150 360l-35-180 115 78 70-135 70 135 115-78-35 180z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M155 400h290" ${line}/>`,
    clock: `<circle cx="300" cy="280" r="165" ${line}/><path d="M300 170v120l85 52M115 440h370" ${line}/><path d="M210 455l-45 45M390 455l45 45" ${thin}/>`,
    park: `<path d="M110 460h380M180 460V300M420 460V270" ${line}/><circle cx="180" cy="235" r="85" fill="${accent}"/><circle cx="420" cy="205" r="105" fill="${highlight}" opacity=".8"/><path d="M235 400h130v60H235z" ${thin}/>`,
    chair: `<path d="M220 210h160v165H220zM200 375h200M235 375v95M365 375v95" ${line}/><path d="M250 150h100" ${thin}/><circle cx="300" cy="150" r="22" fill="${accent}"/>`,
    "cabaret-mic": `<path d="M255 145c0-70 90-70 90 0v145c0 70-90 70-90 0zM300 360v105M235 465h130" ${line}/><path d="M270 185h60M270 225h60M270 265h60M170 120l70 75M430 120l-70 75" ${thin}/><path d="M95 455L220 95h160l125 360" fill="${accent}" opacity=".18"/>`,
    "cabaret-hat-cane": `<path d="M90 110l155 245M510 110L355 355" stroke="${highlight}" stroke-width="18" opacity=".2" stroke-linecap="round"/><g transform="rotate(-9 260 270)"><path d="M145 285h245M190 280c12-88 42-130 92-130s80 42 92 130z" fill="${accent}" stroke="${highlight}" stroke-width="11"/><path d="M205 225h140" ${thin}/></g><path d="M405 165c55 15 35 85-5 65-20-10-12-42 12-42v245M412 432c0 40-58 52-78 15" ${line}/><path d="M105 420l28 8 8 28 8-28 28-8-28-8-8-28-8 28z" fill="${highlight}"/>`,
    carousel: `<path d="M125 240Q300 85 475 240M145 240h310M180 240v220M300 240v220M420 240v220M115 460h370" ${line}/><path d="M225 330c35-45 75-5 45 32l-25 30h-55zM375 330c35-45 75-5 45 32l-25 30h-55z" fill="${accent}"/>`,
    cat: `<path d="M175 385V210l70 55c35-18 75-18 110 0l70-55v175c0 80-250 80-250 0z" ${line}/><path d="M235 350l35 20-35 20M365 350l-35 20 35 20M300 390v25" ${thin}/><circle cx="245" cy="325" r="13" fill="${accent}"/><circle cx="355" cy="325" r="13" fill="${accent}"/>`,
    skyline: `<path d="M85 455h430M110 455V280h70v175M205 455V190h85v265M315 455V245h70v210M410 455V155h80v300" ${line}/><path d="M245 190v-55M450 155V95" ${thin}/>`,
    "jazz-justice": `<path d="M300 115v340M185 175h230M215 175l-85 175M385 175l85 175M95 350h140c-10 70-130 70-140 0zM365 350h140c-10 70-130 70-140 0zM225 455h150" ${line}/><path d="M120 145v100c0 45-65 55-65 12 0-30 35-42 65-28M480 115v105c0 45-65 55-65 12 0-30 35-42 65-28M120 145l65-20M480 115l55-18" ${thin}/>`,
    circus: `<path d="M95 455h410L430 210 300 105 170 210z" ${line}/><path d="M170 210h260M300 105v350M95 455l75-245M505 455l-75-245" ${thin}/><circle cx="300" cy="105" r="18" fill="${accent}"/>`,
    airplane: `<path d="M85 305l190-35 85-150 35 8-40 155 155 57-5 38-170-25-70 125-35-8 25-140-165 12z" fill="${highlight}"/><path d="M90 430c120 55 300 55 420-20" ${thin}/>`,
    network: `<circle cx="300" cy="280" r="44" fill="${highlight}"/><circle cx="155" cy="160" r="35" fill="${accent}"/><circle cx="445" cy="160" r="35" fill="${accent}"/><circle cx="145" cy="410" r="35" fill="${accent}"/><circle cx="455" cy="410" r="35" fill="${accent}"/><path d="M180 185l85 65M420 185l-85 65M175 390l90-80M425 390l-90-80" ${line}/>`,
    western: `<path d="M145 255c75-25 235-25 310 0l-65 65H210zM190 320h220c45 0 75 30 55 55H135c-20-25 10-55 55-55z" fill="${accent}" stroke="${highlight}" stroke-width="9"/><path d="M300 375v80M245 455h110" ${line}/>`,
    "wanted-poster": `<path d="M135 105h330v365H135z" fill="${accent}" opacity=".18" stroke="${highlight}" stroke-width="11"/><path d="M185 165h230M215 220h170M205 405h190" ${line}/><circle cx="300" cy="315" r="72" fill="${highlight}" opacity=".9"/><path d="M300 245l20 43 48 6-35 33 9 48-42-23-42 23 9-48-35-33 48-6z" fill="${accent}"/><path d="M105 485l75-55M495 485l-75-55" ${thin}/>`,
    "coffin-hat": `<path d="M115 290l80-85h235l70 85-55 175H165z" fill="${accent}" opacity=".35" stroke="${highlight}" stroke-width="11"/><path d="M190 420l235-160M155 290h315" ${thin}/><g transform="rotate(-10 300 245)"><path d="M205 240c28-55 62-82 102-82s72 27 96 82c-60 28-138 28-198 0z" fill="${highlight}" stroke="${accent}" stroke-width="9"/><path d="M150 255c85 28 215 28 300 0" ${line}/><path d="M245 205h120" ${thin}/></g><circle cx="90" cy="440" r="28" ${thin}/><path d="M62 440h56M90 412v56M70 420l40 40M110 420l-40 40" ${thin}/>` ,
    letter: `<path d="M110 155h380v290H110z" ${line}/><path d="M110 175l190 155 190-155M135 420l130-120M465 420L335 300" ${thin}/><path d="M210 115h180" ${line}/>`,
    potion: `<path d="M245 115h110M265 115v105l-95 205c-12 30 10 50 45 50h170c35 0 57-20 45-50l-95-205V115" ${line}/><path d="M205 350h190" ${thin}/><circle cx="260" cy="390" r="18" fill="${accent}"/><circle cx="335" cy="420" r="25" fill="${highlight}"/>`,
    snow: `<path d="M300 105v350M150 190l300 180M150 370l300-180M300 105l-35 45M300 105l35 45M150 190l60 5M150 190l25 55M450 190l-60 5M450 190l-25 55M150 370l60-5M150 370l25-55M450 370l-60-5M450 370l-25-55" ${line}/>`,
    lightning: `<path d="M335 80L175 310h120l-30 175 160-245H305z" fill="${highlight}" stroke="${accent}" stroke-width="10"/><path d="M120 455h100M380 455h100" ${thin}/>`,
    violin: `<path d="M300 105v185M280 290c-110-45-130 120-35 145 35 10 55-15 55-15s20 25 55 15c95-25 75-190-35-145z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M275 100h50M255 360h90" ${thin}/>`,
    "rooftop-violin": `<path d="M70 430l230-190 230 190M125 430h350M165 430v65M435 430v65" ${line}/><path d="M300 80v155M280 235c-95-35-110 95-30 120 30 8 50-15 50-15s20 23 50 15c80-25 65-155-30-120z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M275 75h50M255 290h90M155 105l290 250" ${thin}/>`,
    star: `<path d="M300 85l48 135 143 4-113 88 41 137-119-80-119 80 41-137-113-88 143-4z" fill="${highlight}"/><circle cx="300" cy="280" r="175" ${thin}/>`,
    "vaudeville-fan": `<path d="M300 430C145 350 120 215 170 145c70 20 115 75 130 150 15-75 60-130 130-150 50 70 25 205-130 285z" fill="${accent}" opacity=".75" stroke="${highlight}" stroke-width="10"/><path d="M300 430L170 145M300 430L235 125M300 430V105M300 430l65-305M300 430l130-285" ${line}/><path d="M95 475h410" ${thin}/><circle cx="145" cy="475" r="18" fill="${highlight}"/><circle cx="225" cy="475" r="18" fill="${highlight}"/><circle cx="305" cy="475" r="18" fill="${highlight}"/><circle cx="385" cy="475" r="18" fill="${highlight}"/><circle cx="465" cy="475" r="18" fill="${highlight}"/>`,
    "vanity-mirror": `<path d="M155 455h290M195 455l18-58h174l18 58" ${line}/><rect x="165" y="95" width="270" height="305" rx="65" fill="${accent}" opacity=".22" stroke="${highlight}" stroke-width="13"/><rect x="205" y="135" width="190" height="225" rx="46" fill="none" stroke="${accent}" stroke-width="8"/><path d="M300 190l17 38 42 5-31 29 8 41-36-20-36 20 8-41-31-29 42-5z" fill="${highlight}" opacity=".85"/><path d="M245 330c35-18 75-18 110 0" ${thin}/>${[[165,145],[165,230],[165,315],[435,145],[435,230],[435,315],[235,95],[300,95],[365,95]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="11" fill="${highlight}"/>`).join("")}`,
    quill: `<path d="M130 440c145-18 235-130 330-320-155 30-285 115-310 285z" fill="${highlight}" opacity=".85"/><path d="M155 420L430 145M210 360l-35-85M270 300l-30-95M330 240l-20-75" ${line}/><path d="M100 465h350" ${thin}/>`,
    wand: `<path d="M145 440L430 145M390 115l15-45 15 45 45 15-45 15-15 45-15-45-45-15z" ${line}/><path d="M150 130l10-30 10 30 30 10-30 10-10 30-10-30-30-10z" fill="${accent}"/>`,
    "city-heart": `<path d="M95 455h410M130 455V270h75v185M235 455V175h95v280M360 455V240h90v215" ${line}/><path d="M300 305c-75-65-145 35 0 125 145-90 75-190 0-125z" fill="${accent}"/>`,
    bell: `<path d="M175 395h250l-40-55v-95c0-125-170-125-170 0v95z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><circle cx="300" cy="425" r="28" fill="${highlight}"/><path d="M300 105v55" ${line}/>`,
    forest: `<path d="M105 455l85-190h-50l95-170 95 170h-50l20 45 70-145 105 210h-55l40 80z" fill="${accent}" stroke="${highlight}" stroke-width="8"/><path d="M300 455c0-85 30-150 90-205" ${thin}/>`,
    sunburst: `<circle cx="300" cy="285" r="90" fill="${highlight}"/><path d="M300 95v65M300 410v65M110 285h65M425 285h65M165 150l45 45M390 375l45 45M435 150l-45 45M210 375l-45 45" ${line}/>`,
    "rock-cross": `<circle cx="300" cy="275" r="175" fill="${accent}" opacity=".18"/><path d="M300 95v355M185 215h230" ${line}/><path d="M125 390l75-75M475 390l-75-75M115 205l85 35M485 205l-85 35" ${thin}/><circle cx="300" cy="275" r="115" fill="none" stroke="${highlight}" stroke-width="5" opacity=".55"/>`,
    "clock-note": `<circle cx="250" cy="285" r="145" ${line}/><path d="M250 185v105l70 45M370 145v220c0 65-95 75-95 15 0-45 55-60 95-35M370 145l95-35v210c0 65-95 75-95 15" ${thin}/>`,
    boot: `<path d="M205 110h135v230c0 55 110 35 165 90-25 70-195 60-315 35 35-75 15-225 15-355z" fill="${accent}" stroke="${highlight}" stroke-width="11"/><path d="M205 225h135M205 285h135" ${thin}/>`,
    barricade: `<path d="M80 430h440M120 430l65-190h230l65 190M160 310h280M135 375h330" ${line}/><path d="M300 240V90l125 55-125 55" fill="${accent}"/>`,
    "revolution-barricade": `<path d="M65 455h470M105 455l82-205h230l78 205M130 365h340M165 295h270M210 250l-55-82M390 250l55-82" ${line}/><path d="M300 250V75l150 62-150 68z" fill="${accent}" stroke="${highlight}" stroke-width="9"/><path d="M85 250l48-48M515 250l-48-48M120 125l65 55M480 125l-65 55M300 45V15" ${thin}/><path d="M235 430v-68l22-28 18 22 25-42 26 42 18-22 22 28v68" fill="${highlight}" opacity=".72"/>`,
    "candlesticks-chain": `<path d="M155 405h110M180 405l18-55h24l18 55M210 350V180M175 180h70M185 180c0-45 50-70 50-115 0 45 35 70 35 115M335 405h110M360 405l18-55h24l18 55M390 350V180M355 180h70M365 180c0-45 50-70 50-115 0 45 35 70 35 115" ${line}/><path d="M130 285c45-45 90-45 135 0M335 285c45-45 90-45 135 0" ${thin}/><path d="M265 285l40 34M335 285l-40 34" ${line}/><circle cx="265" cy="285" r="31" fill="none" stroke="${accent}" stroke-width="12"/><circle cx="335" cy="285" r="31" fill="none" stroke="${accent}" stroke-width="12"/>`,
    "prison-number-flag": `<rect x="105" y="185" width="300" height="145" rx="12" fill="${accent}" opacity=".18" stroke="${highlight}" stroke-width="11"/><text x="255" y="285" text-anchor="middle" fill="${highlight}" font-family="Georgia,serif" font-size="72" font-weight="700" letter-spacing="8">24601</text><path d="M430 105v315M430 120l115 55-115 55" fill="${accent}" stroke="${highlight}" stroke-width="9" stroke-linejoin="round"/><path d="M115 405c50-55 100-55 150 0M335 405c50-55 100-55 150 0" ${thin}/><circle cx="265" cy="405" r="34" fill="none" stroke="${accent}" stroke-width="13"/><circle cx="335" cy="405" r="34" fill="none" stroke="${accent}" stroke-width="13"/><path d="M283 382l-25-42M317 382l25-42" ${line}/>`,
    boat: `<path d="M95 355h410c-25 95-115 125-205 125S120 450 95 355z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M300 355V105l140 180H300z" ${line}/><path d="M70 500c75-35 135 35 210 0s135 35 210 0" ${thin}/>`,
    plant: `<path d="M245 465h110l35-150H210z" fill="${accent}"/><path d="M300 315V175M300 230c-80-95-145-15-80 45 35 30 80 20 80 20M300 215c70-105 145-35 95 35-25 38-95 45-95 45" ${line}/><path d="M280 150l20-45 20 45" ${thin}/>`,
    island: `<circle cx="390" cy="175" r="70" fill="${highlight}"/><path d="M80 450h440M185 450c25-115 85-175 180-230M270 310c-45-75-105-75-150-35M285 290c55-70 125-60 170-10" ${line}/><path d="M125 495c80-40 130 35 210 0s130 35 210 0" ${thin}/>`,
    "island-wedding": `<path d="M150 455V300c0-185 300-185 300 0v155M110 455h380" ${line}/><circle cx="300" cy="205" r="42" fill="${accent}"/><path d="M275 205l25-28 25 28-25 28z" fill="${highlight}"/><path d="M85 145h120v90H85zM240 95h120v90H240zM395 145h120v90H395zM85 145l60 50 60-50M240 95l60 50 60-50M395 145l60 50 60-50" ${thin}/><path d="M90 500c70-35 125 35 195 0s125 35 195 0" ${thin}/>`,
    robot: `<rect x="185" y="170" width="230" height="220" rx="35" ${line}/><circle cx="250" cy="270" r="22" fill="${accent}"/><circle cx="350" cy="270" r="22" fill="${accent}"/><path d="M250 335h100M300 170v-65M275 105h50M215 390l-35 75M385 390l35 75" ${thin}/><path d="M300 320c-55-55-105 25 0 90 105-65 55-145 0-90z" fill="${highlight}" opacity=".8"/>`,
    castle: `<path d="M105 455V220h85v60h80V165h60v115h80v-60h85v235z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M255 455v-95c0-65 90-65 90 0v95M105 220l42-60 43 60M410 220l42-60 43 60" ${thin}/>`,
    windmill: `<circle cx="300" cy="270" r="38" fill="${accent}"/><path d="M300 232L210 85l-50 30 110 170M338 270l147-90-30-50-170 110M300 308l90 147 50-30-110-170M262 270l-147 90 30 50 170-110M245 455h110l-25-150h-60z" ${line}/>`,
    parasol: `<path d="M95 270Q300 70 505 270c-40-25-80-25-120 0-55-35-115-35-170 0-40-25-80-25-120 0zM300 175v210c0 95 100 95 100 15" ${line}/><path d="M125 445c85-65 135 25 220-30" ${thin}/>`,
    "phonetics-flowers": `<path d="M95 115h330v220H235l-80 75 18-75H95z" fill="${accent}" opacity=".2" stroke="${highlight}" stroke-width="11"/><text x="260" y="250" text-anchor="middle" fill="${highlight}" font-family="Georgia,serif" font-size="72" font-weight="700">A E I</text><path d="M350 455h150l-25-130H375zM390 325l-55-75M425 325v-95M460 325l55-75" ${line}/><circle cx="335" cy="245" r="38" fill="${accent}"/><circle cx="425" cy="220" r="42" fill="${highlight}"/><circle cx="515" cy="245" r="38" fill="${accent}"/>`,
    leaf: `<path d="M105 420c75-250 270-300 390-290-20 185-105 330-300 320z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M155 435L445 175M250 350l-15-115M320 285l90 15" ${line}/><path d="M300 450v-110" ${thin}/>`,
    chairs: `<path d="M95 275h180v120H95zM325 275h180v120H325zM120 395v70M250 395v70M350 395v70M480 395v70" ${line}/><path d="M185 275v-85M415 275v-85M185 190h230" ${thin}/>`,
    "songbook-duet": `<path d="M95 155h185c45 0 70 25 70 65v235c-35-30-70-40-115-40H95zM505 155H320c-45 0-70 25-70 65v235c35-30 70-40 115-40h140z" fill="${accent}" opacity=".22" stroke="${highlight}" stroke-width="10"/><path d="M145 230h95M145 285h95M360 230h95M360 285h95M300 180v275" ${thin}/><path d="M125 445V330c0-45 70-45 70 0v115M405 445V330c0-45 70-45 70 0v115" ${line}/><circle cx="160" cy="300" r="35" fill="${highlight}"/><circle cx="440" cy="300" r="35" fill="${highlight}"/>`,
    moon: `<path d="M395 110c-155 20-190 240-45 325-175 5-265-120-215-250 40-105 155-145 260-75z" fill="${highlight}"/><path d="M355 300l90 105M445 300l-90 105" ${thin}/>`,
    banner: `<path d="M105 455V125M115 145h365l-55 85 55 85H115" ${line}/><path d="M185 230h220M185 275h160" ${thin}/><circle cx="105" cy="105" r="25" fill="${accent}"/>`,
    "factory-justice": `<path d="M85 455V285l105-65v65l110-65v65l110-65v65h105v170zM420 220V105h55v150" fill="${accent}" opacity=".28" stroke="${highlight}" stroke-width="10"/><path d="M300 105v300M185 165h230M215 165l-80 165M385 165l80 165M95 330h80c-8 55-72 55-80 0zM425 330h80c-8 55-72 55-80 0zM235 405h130" ${line}/><path d="M120 405h70M410 405h70" ${thin}/>`,
    ship: `<path d="M85 355h430c-25 95-120 130-215 130S110 450 85 355z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M300 355V95M300 115L125 300h175M300 150l155 150H300" ${line}/><path d="M300 95l90 35-90 35" fill="${accent}"/>`,
    sewing: `<path d="M300 105c-45 0-70 35-70 80 0 40 20 65 20 65l-85 210h270l-85-210s20-25 20-65c0-45-25-80-70-80z" ${line}/><path d="M215 330h170M180 415h240" ${thin}/><circle cx="125" cy="170" r="45" ${thin}/><path d="M125 125v90M80 170h90" ${thin}/>`,
    key: `<circle cx="205" cy="260" r="95" ${line}/><path d="M280 320l205 155M400 410l55-55M350 370l45-45" ${line}/><path d="M95 455h160" ${thin}/>`,
    "camera-guitar": `<path d="M85 145h430v310H85zM300 145v310M85 300h430" ${line}/><rect x="125" y="205" width="155" height="110" rx="16" fill="${accent}" stroke="${highlight}" stroke-width="9"/><circle cx="200" cy="260" r="38" fill="none" stroke="${highlight}" stroke-width="9"/><path d="M280 230l65-35v130l-65-35z" fill="${highlight}"/><path d="M405 190v180M405 220c-70 10-75 90-20 100 65 12 85-75 20-100zM385 370l-45 90M425 370l45 90" ${line}/><path d="M405 190l55-35" ${thin}/>`,
    "double-heart": `<path d="M220 430C70 320 105 180 195 220c18 8 25 22 25 22s8-14 25-22c90-40 125 100-25 210zM380 430c-150-110-115-250-25-210 18 8 25 22 25 22s8-14 25-22c90-40 125 100-25 210z" fill="${accent}" stroke="${highlight}" stroke-width="8"/><path d="M300 105v350" ${thin}/>`,
    books: `<path d="M95 405h410v70H95zM125 315h350v70H125zM85 225h430v70H85zM145 135h310v70H145z" fill="${accent}" stroke="${highlight}" stroke-width="8"/><path d="M185 135v70M400 225v70M220 315v70M420 405v70" ${thin}/>`,
    "telekinetic-book": `<path d="M75 410c75-25 150-10 225 45 75-55 150-70 225-45v85c-75-28-150-12-225 38-75-50-150-66-225-38z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M300 455v78M110 440c60-10 115 5 165 42M490 440c-60-10-115 5-165 42" ${thin}/><text x="130" y="260" fill="${highlight}" font-family="Georgia,serif" font-size="74" font-weight="900" transform="rotate(-12 130 260)">A</text><text x="390" y="220" fill="${highlight}" font-family="Georgia,serif" font-size="66" font-weight="900" transform="rotate(9 390 220)">B</text><path d="M245 285h75v55h-75zM330 120h65v90h-65z" fill="none" stroke="${accent}" stroke-width="9"/><path d="M282 285v55M350 120v90M95 325l35-18 18 35M475 300l-28-25-24 32M210 145l20-38 22 35" ${line}/><path d="M165 340c55-65 115-90 180-75M330 260c55-45 105-55 150-25" ${thin}/>` ,
    "keyhole-eyes": `<path d="M300 75c-95 0-160 68-160 155 0 55 25 95 65 122l-42 128h274l-42-128c40-27 65-67 65-122 0-87-65-155-160-155z" fill="${accent}" opacity=".26" stroke="${highlight}" stroke-width="12"/><path d="M300 135c-55 0-92 40-92 92 0 37 18 66 48 82l-24 95h136l-24-95c30-16 48-45 48-82 0-52-37-92-92-92z" fill="#122f35" opacity=".92"/><path d="M235 240c28-30 62-30 90 0-28 30-62 30-90 0zM325 240c28-30 62-30 90 0-28 30-62 30-90 0z" fill="${highlight}"/><circle cx="280" cy="240" r="12" fill="${accent}"/><circle cx="370" cy="240" r="12" fill="${accent}"/><path d="M70 230h45M485 230h45M105 130l38 28M495 130l-38 28M300 25v35" ${thin}/>` ,
    "lecture-boundary": `<path d="M95 165h190v245H95zM130 410v65M250 410v65M355 315h150v95H355zM380 410v65M480 410v65" ${line}/><path d="M125 220h130M125 275h95M385 345h90M300 95v390" ${thin}/><circle cx="190" cy="130" r="35" fill="${accent}"/><circle cx="430" cy="270" r="35" fill="${highlight}"/><path d="M285 450L335 120" stroke="${accent}" stroke-width="16" stroke-linecap="round"/>`,
    "six-crowns": `<path d="M55 150l18 78h74l18-78-38 27-17-52-17 52zM215 150l18 78h74l18-78-38 27-17-52-17 52zM375 150l18 78h74l18-78-38 27-17-52-17 52zM55 330l18 78h74l18-78-38 27-17-52-17 52zM215 330l18 78h74l18-78-38 27-17-52-17 52zM375 330l18 78h74l18-78-38 27-17-52-17 52z" fill="${accent}" stroke="${highlight}" stroke-width="7"/>`,
    mask: `<path d="M95 190c125-60 285-60 410 0l-45 185c-35 95-115 75-160-10-45 85-125 105-160 10z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M175 270c35-35 75-35 110 0M315 270c35-35 75-35 110 0" ${line}/>`,
    sax: `<path d="M330 105v215c0 95-120 105-155 25-35-85 55-155 105-85M330 105h105v65H330M180 390c30 75 145 100 220 20" ${line}/><circle cx="175" cy="335" r="28" fill="${accent}"/><path d="M405 385l40 70M440 370l55 55" ${thin}/>`,
    flower: `<circle cx="300" cy="270" r="48" fill="${highlight}"/><circle cx="300" cy="170" r="65" fill="${accent}"/><circle cx="395" cy="240" r="65" fill="${accent}"/><circle cx="360" cy="345" r="65" fill="${accent}"/><circle cx="240" cy="345" r="65" fill="${accent}"/><circle cx="205" cy="240" r="65" fill="${accent}"/><path d="M300 320v150M300 395c-65-60-115-15-85 35M300 405c65-60 115-15 85 35" ${line}/>`,
    ballot: `<path d="M120 235h360v240H120zM185 235l35-105h160l35 105" ${line}/><path d="M235 315l45 45 95-110" ${line}/><path d="M175 475h250" ${thin}/>`,
    "march-signs": `<path d="M95 145h145v170H95zM355 145h150v170H355zM205 245h190v175H205zM168 315v150M430 315v150M300 420v70" ${line}/><path d="M125 205h85M125 250h85M385 205h90M385 250h90M245 310h110M245 355h110" ${thin}/><path d="M120 465l-35-55M480 465l35-55M240 485l-25-60M360 485l25-60" ${thin}/>`,
    sunset: `<circle cx="300" cy="310" r="135" fill="${highlight}"/><path d="M75 310h450M105 365h390M145 420h310M180 475h240" stroke="${accent}" stroke-width="13"/><path d="M135 135l55 55M465 135l-55 55M300 80v80" ${line}/>`,
    deco: `<path d="M300 75L105 460h390z" ${line}/><path d="M300 145L175 420h250zM300 220L240 370h120z" ${thin}/><circle cx="300" cy="320" r="35" fill="${accent}"/>`,
    lion: `<circle cx="300" cy="280" r="175" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M215 255l45-45 40 35 40-35 45 45v110c-45 80-125 80-170 0z" fill="${highlight}"/><circle cx="260" cy="300" r="12" fill="${accent}"/><circle cx="340" cy="300" r="12" fill="${accent}"/><path d="M260 365h80" ${thin}/>`,
    notebook: `<path d="M125 110h350v365H125zM300 110v365" fill="${highlight}" opacity=".16" stroke="${highlight}" stroke-width="10"/><path d="M155 175h110M155 230h110M155 285h110M335 175h110M335 230h110M335 285h110" ${thin}/><path d="M300 365c-85-75-155 45 0 130 155-85 85-205 0-130z" fill="${accent}"/>`,
    pie: `<circle cx="285" cy="275" r="165" fill="${accent}" stroke="${highlight}" stroke-width="13"/><circle cx="285" cy="275" r="135" fill="none" stroke="${highlight}" stroke-width="7" stroke-dasharray="16 12"/><path d="M175 190l195 170M140 250l165 145M220 135l175 155M395 190L205 365M430 250L265 395M350 135L175 290" ${line}/><path d="M390 355l125 55-105 75-55-105z" fill="${accent}" stroke="${highlight}" stroke-width="11"/><path d="M390 355l20 130" ${thin}/><path d="M245 80c0-40 35-55 35-90M330 80c0-40 35-55 35-90" ${thin}/>`
  };
  return scenes[scene] || scenes.star;
}

function generatedArtwork(memory) {
  const hash = showHash(memory.show);
  const [background, paletteAccent, highlight] = artworkPalettes[hash % artworkPalettes.length];
  const accent = artworkColor(memory.color, paletteAccent);
  const [scene, subtitle] = resolveArtworkConcept(memory, hash);
  const titleLines = artworkTitleLines(memory.show);
  const subtitleLines = artworkSubtitleLines(subtitle);
  const longestTitleLine = Math.max(...titleLines.map((line) => line.length));
  const preferredTitleSize = [31, 31, 27, 23, 20][titleLines.length] || 20;
  const titleSize = Math.max(18, Math.min(
    preferredTitleSize,
    Math.floor(245 / (Math.max(longestTitleLine, 1) * .6))
  ));
  const titleLineHeight = titleSize + 3;
  const titleStart = 124 - ((titleLines.length - 1) * titleLineHeight) / 2;
  const titleMarkup = titleLines.map((line, index) => (
    `<tspan x="448" y="${titleStart + index * titleLineHeight}">${escapeXml(line)}</tspan>`
  )).join("");
  const subtitleStart = 205 - ((subtitleLines.length - 1) * 17) / 2;
  const subtitleMarkup = subtitleLines.map((line, index) => (
    `<tspan x="448" y="${subtitleStart + index * 17}">${escapeXml(line)}</tspan>`
  )).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" role="img" aria-label="${escapeXml(memory.show)} original memory illustration">
    <rect width="600" height="300" fill="${background}"/>
    <g opacity=".5">${artworkBackdrop(hash, accent, highlight)}</g>
    <rect x="310" width="290" height="300" fill="#000" opacity=".2"/>
    <path d="M310 34v232" stroke="${accent}" stroke-width="3" opacity=".8"/>
    <g transform="translate(5 18) scale(.5)">${artworkScene(scene, accent, highlight)}</g>
    <text text-anchor="middle" fill="#fff" font-family="Georgia,serif" font-size="${titleSize}" font-weight="700">${titleMarkup}</text>
    <text text-anchor="middle" fill="${highlight}" font-family="Aptos,Segoe UI,sans-serif" font-size="15" font-weight="800" letter-spacing=".7">${subtitleMarkup}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function reactionScore(value) {
  const score = Number.parseFloat(value);
  return Number.isFinite(score) && score >= 1 && score <= 5 ? score : Number.NaN;
}

function reactionLabel(value) {
  const score = reactionScore(value);
  return Number.isFinite(score)
    ? reactionLabels[Math.max(1, Math.min(5, Math.round(score)))]
    : "Not rated";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === "\"" && source[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === "\"") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some(Boolean)) rows.push(row);
  }

  const headers = rows.shift() || [];
  return rows.map((values) => headers.reduce((record, header, index) => {
    const value = values[index] || "";
    if (!(header in record) || (!record[header] && value)) record[header] = value;
    return record;
  }, {}));
}

function browserPhotoSource(value) {
  if (!value || /^[A-Za-z]:\\/.test(value)) return "";
  if (/^data:image\/svg\+xml/i.test(value) || /^assets[\\/]memory-art[\\/]/i.test(value)) return "";
  return value;
}

function renderPhoto(memory) {
  const photoSource = browserPhotoSource(memory.photo);
  const source = photoSource || generatedArtwork(memory);
  if (source) {
    const image = document.createElement("img");
    image.src = source;
    image.className = photoSource ? "memory-photo-source" : "memory-artwork-source";
    image.alt = photoSource
      ? `${memory.show} theatre memory photo`
      : `${memory.show} inspired illustration`;
    image.loading = "lazy";
    image.addEventListener("error", () => {
      image.className = "memory-artwork-source";
      image.src = generatedArtwork(memory);
    }, { once: true });
    return image;
  }
  const placeholder = document.createElement("div");
  placeholder.className = "memory-photo-placeholder";
  placeholder.style.setProperty("--memory-color", memory.color);
  const monogram = document.createElement("span");
  monogram.textContent = initials(memory.show);
  const label = document.createElement("small");
  label.textContent = "Playbill archive";
  placeholder.append(monogram, label);
  return placeholder;
}

function matchesReaction(value, filter) {
  const range = reactionRange(filter);
  if (!range.active) return true;
  return meetsReactionRange(value, range);
}

function meetsReactionRange(value, range) {
  const score = reactionScore(value);
  return Number.isFinite(score) && score >= range.minimum && score <= range.maximum;
}

function renderMemories() {
  const query = search.value.trim().toLocaleLowerCase();
  const filtered = memories.filter((memory) => (
    (!year.value || memory.date.startsWith(year.value))
    && matchesReaction(memory.rating, ratingFilter)
    && matchesReaction(memory.castVibe, castFilter)
    && matchesReaction(memory.musicVibe, musicFilter)
    && matchesReaction(memory.stageMagic, stageFilter)
    && matchesReaction(memory.storyFeel, storyFilter)
    && (!query || [memory.show, memory.theatre, memory.city, memory.seat]
      .some((value) => value.toLocaleLowerCase().includes(query)))
  )).sort((left, right) => {
    if (!priceSort.value) return left.date.localeCompare(right.date);
    const leftPrice = priceInUsd(left.price);
    const rightPrice = priceInUsd(right.price);
    if (!Number.isFinite(leftPrice)) return Number.isFinite(rightPrice) ? 1 : 0;
    if (!Number.isFinite(rightPrice)) return -1;
    const direction = priceSort.value === "price-asc" ? 1 : -1;
    return (leftPrice - rightPrice) * direction || right.date.localeCompare(left.date);
  });
  const priceSorted = Boolean(priceSort.value);
  const initialFocusIndex = priceSorted ? 0 : filtered.length - 1;

  const rail = document.createElement("div");
  rail.className = "memory-timeline-rail";
  rail.setAttribute("aria-hidden", "true");
  rail.setAttribute("role", "presentation");
  const renderedEntries = filtered.map((memory, index) => {
    const article = document.createElement("article");
    article.className = `memory-entry ${index % 2 ? "memory-right" : "memory-left"}`;
    article.style.setProperty("--memory-color", memory.color);
    article.setAttribute("role", "listitem");
    article.setAttribute("aria-label", `${formatDate(memory.date)}: ${memory.show}`);
    article.tabIndex = index === initialFocusIndex ? 0 : -1;

    const marker = document.createElement("div");
    marker.className = "memory-marker";
    marker.setAttribute("aria-hidden", "true");

    const date = document.createElement("time");
    date.className = "memory-rail-date";
    date.dateTime = memory.date;
    date.textContent = formatDate(memory.date);

    const card = document.createElement("div");
    card.className = "memory-card";
    const media = document.createElement("div");
    media.className = "memory-photo";
    media.appendChild(renderPhoto(memory));
    const copy = document.createElement("div");
    copy.className = "memory-copy";
    const title = document.createElement("h3");
    title.textContent = memory.show;
    const venue = document.createElement("p");
    venue.className = "memory-venue";
    venue.appendChild(document.createTextNode(memory.theatre || "Theatre not recorded"));
    if (memory.city) {
      venue.append(
        Object.assign(document.createElement("span"), { textContent: " | " }),
        document.createTextNode(memory.city)
      );
    }
    copy.append(title, venue);
    if (memory.seat || memory.price) {
      const seat = document.createElement("p");
      seat.className = "memory-seat";
      const seatLabel = document.createElement("span");
      seatLabel.textContent = memory.seat || "Seat not recorded";
      seat.appendChild(seatLabel);
      if (memory.price) {
        const price = document.createElement("strong");
        price.className = "memory-price";
        price.textContent = memory.price;
        seat.appendChild(price);
      }
      copy.appendChild(seat);
    }
    if (memory.note) {
      const note = document.createElement("p");
      note.className = "memory-note";
      note.textContent = memory.note;
      copy.appendChild(note);
    }
    if (Number.isFinite(memory.rating)) {
      const review = document.createElement("div");
      review.className = "memory-review";
      const overall = document.createElement("div");
      overall.className = "memory-rating";
      const overallLabel = document.createElement("strong");
      overallLabel.textContent = reactionLabel(memory.rating);
      const overallScore = document.createElement("span");
      overallScore.textContent = `${memory.rating.toLocaleString("en-US", { maximumFractionDigits: 2 })} / 5`;
      overall.append(overallLabel, overallScore);
      overall.setAttribute("aria-label", `Overall reaction: ${overallLabel.textContent}, ${overallScore.textContent}`);
      review.appendChild(overall);

      const categoryLabels = [
        ["Cast", memory.castVibe],
        ["Music", memory.musicVibe],
        ["Stage", memory.stageMagic],
        ["Story", memory.storyFeel]
      ];
      const categories = document.createElement("div");
      categories.className = "memory-reactions";
      categoryLabels.forEach(([label, value]) => {
        const score = reactionScore(value);
        const reaction = document.createElement("div");
        reaction.className = Number.isFinite(score) ? "memory-reaction" : "memory-reaction is-unrated";
        const category = document.createElement("b");
        category.textContent = label;
        const response = document.createElement("span");
        response.textContent = reactionLabel(value);
        reaction.append(category, response);
        if (Number.isFinite(score)) {
          const scoreText = document.createElement("small");
          scoreText.textContent = `${score.toLocaleString("en-US", { maximumFractionDigits: 2 })}/5`;
          reaction.appendChild(scoreText);
        }
        categories.appendChild(reaction);
      });
      if (categories.childElementCount) review.appendChild(categories);
      copy.appendChild(review);
    }
    card.append(media, copy);
    article.append(date, marker, card);
    return article;
  });
  list.replaceChildren(rail, ...renderedEntries);
  window.requestAnimationFrame(() => {
    const inlineScrollBehavior = list.style.scrollBehavior;
    list.style.scrollBehavior = "auto";
    list.scrollLeft = priceSorted ? 0 : list.scrollWidth;
    list.style.scrollBehavior = inlineScrollBehavior;
    updateTimelineRail();
    updateTimelineNavigation();
  });
  empty.hidden = filtered.length > 0;
  const activeCriteria = [
    search.value.trim() ? `search "${search.value.trim()}"` : "",
    year.value ? `year ${year.value}` : "",
    reactionRange(ratingFilter).active ? `Overall ${reactionRangeLabel(reactionRange(ratingFilter))}` : "",
    reactionRange(castFilter).active ? `Cast ${reactionRangeLabel(reactionRange(castFilter))}` : "",
    reactionRange(musicFilter).active ? `Music ${reactionRangeLabel(reactionRange(musicFilter))}` : "",
    reactionRange(stageFilter).active ? `Stage ${reactionRangeLabel(reactionRange(stageFilter))}` : "",
    reactionRange(storyFilter).active ? `Story ${reactionRangeLabel(reactionRange(storyFilter))}` : ""
  ].filter(Boolean);
  empty.textContent = activeCriteria.length
    ? `No memories match ${activeCriteria.join(", ")}. Try clearing one or more filters.`
    : "No theatre memories are available.";
  filterStatus.textContent = `Showing ${filtered.length.toLocaleString("en-US")} of ${memories.length.toLocaleString("en-US")} theatre memories. Filters combine.`;
  list.setAttribute("aria-label", priceSorted
    ? `Theatre memories sorted by ticket price, ${priceSort.value === "price-asc" ? "low to high" : "high to low"}`
    : "Theatre memories, oldest to newest; opens at latest");
  timelineHelp.textContent = priceSorted
    ? "Sorted by ticket price. Swipe, scroll, or use the arrow keys to move through the results."
    : "Oldest to newest; opens at latest. Swipe, scroll, or use the arrow keys to travel through time.";
  clearFilters.disabled = !search.value && !year.value
    && reactionFilters.every((filter) => !reactionRange(filter).active)
    && !priceSort.value;
}

function mostFrequent(values) {
  return frequencyRanking(values)[0] || ["-", 0];
}

function frequencyRanking(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function reactionRangeLabel(range) {
  return range.active ? `${range.minimum}–${range.maximum}` : "Any";
}

function updateReactionRange(filter, values, changedBound = "") {
  const minimumInput = filter.querySelector('[data-range-bound="min"]');
  const maximumInput = filter.querySelector('[data-range-bound="max"]');
  if (Number(minimumInput.value) > Number(maximumInput.value)) {
    if (changedBound === "min") maximumInput.value = minimumInput.value;
    else minimumInput.value = maximumInput.value;
  }
  const range = reactionRange(filter);
  const count = range.active
    ? values.filter((value) => meetsReactionRange(value, range)).length
    : values.length;
  const rangeElement = filter.querySelector(".memory-rating-range");
  filter.classList.toggle("is-active", range.active);
  rangeElement.style.setProperty("--range-min", `${((range.minimum - 1) / 4) * 100}%`);
  rangeElement.style.setProperty("--range-max", `${((range.maximum - 1) / 4) * 100}%`);
  filter.querySelector("output").textContent = `${reactionRangeLabel(range)} · ${count.toLocaleString("en-US")}`;
  minimumInput.setAttribute("aria-valuetext", `Minimum ${range.minimum} of 5`);
  maximumInput.setAttribute("aria-valuetext", `Maximum ${range.maximum} of 5`);
}

function initializeMemories() {
  const selectedYear = year.value;
  const years = [...new Set(memories.map((memory) => memory.date.slice(0, 4)))]
    .sort((a, b) => b.localeCompare(a));
  year.replaceChildren(Object.assign(document.createElement("option"), {
    value: "",
    textContent: "All years"
  }));
  years.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    year.appendChild(option);
  });
  if (years.includes(selectedYear)) year.value = selectedYear;
  document.querySelector("#memory-encore-show-count").textContent = memories.length.toLocaleString("en-US");
  document.querySelector("#memory-encore-theatre-count").textContent = new Set(
    memories.map((memory) => memory.theatre).filter(Boolean)
  ).size.toLocaleString("en-US");
  document.querySelector("#memory-encore-first-year").textContent = years.at(-1) || "-";
  document.querySelector("#memory-encore-latest-year").textContent = years[0] || "-";
  const cities = memories.map((memory) => memory.city).filter(Boolean);
  const [topCity, topCityCount] = mostFrequent(cities);
  const spendByMonth = new Map();
  let totalSpend = 0;
  let pricedCount = 0;
  memories.forEach((memory) => {
    const amountUsd = priceInUsd(memory.price);
    if (!Number.isFinite(amountUsd)) return;
    totalSpend += amountUsd;
    pricedCount += 1;
    const monthKey = memory.date.slice(0, 7);
    spendByMonth.set(monthKey, (spendByMonth.get(monthKey) || 0) + amountUsd);
  });
  const formatUsd = (amount, digits = 0) => amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  const recordedMonthKeys = [...spendByMonth.keys()].sort();
  const monthlySeries = [];
  if (recordedMonthKeys.length) {
    const [startYear, startMonth] = recordedMonthKeys[0].split("-").map(Number);
    const [endYear, endMonth] = recordedMonthKeys.at(-1).split("-").map(Number);
    const cursor = new Date(startYear, startMonth - 1, 1);
    const end = new Date(endYear, endMonth - 1, 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      monthlySeries.push({
        key,
        date: new Date(cursor),
        amount: spendByMonth.get(key) || 0
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  const chartMaximum = Math.max(...monthlySeries.map(({ amount }) => amount), 1);
  const spendPoints = monthlySeries.map(({ amount, date }, index) => {
    const x = index * (320 / Math.max(monthlySeries.length - 1, 1));
    const y = 67 - (amount / chartMaximum) * 55;
    return { amount, date, x, y };
  });
  const spendPointText = spendPoints.length
    ? spendPoints.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
    : "0,67 320,67";
  const topSpendMonth = monthlySeries.find(({ amount }) => amount === chartMaximum);
  const formatChartMonth = (item) => item
    ? item.date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    : "-";
  const [busiestYear, busiestYearCount] = mostFrequent(memories.map((memory) => memory.date.slice(0, 4)));
  const [topTheatre, topTheatreCount] = mostFrequent(memories.map((memory) => memory.theatre));
  const [topMonth, topMonthCount] = mostFrequent(memories.map((memory) => (
    new Date(`${memory.date}T12:00:00`).toLocaleDateString("en-US", { month: "long" })
  )));
  const strongestDimension = [
    ["Cast", "castVibe"],
    ["Music", "musicVibe"],
    ["Stage", "stageMagic"],
    ["Story", "storyFeel"]
  ].map(([label, key]) => {
    const scores = memories.map((memory) => reactionScore(memory[key])).filter(Number.isFinite);
    return {
      label,
      average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : Number.NaN
    };
  }).filter((item) => Number.isFinite(item.average))
    .sort((a, b) => b.average - a.average || a.label.localeCompare(b.label))[0];
  const rated = memories.filter((memory) => Number.isFinite(memory.rating));
  const averageRating = rated.length
    ? rated.reduce((sum, memory) => sum + memory.rating, 0) / rated.length
    : Number.NaN;
  const infographic = document.querySelector(".encore-infographic");
  infographic.style.setProperty(
    "--average-rating",
    Number.isFinite(averageRating) ? `${(averageRating / 5) * 100}%` : "0%"
  );
  document.querySelector("#memory-city-count").textContent = new Set(cities).size.toLocaleString("en-US");
  document.querySelector("#memory-top-city").textContent = `${topCity} (${topCityCount})`;
  document.querySelector("#memory-total-spend").textContent = pricedCount ? formatUsd(totalSpend) : "-";
  document.querySelector("#memory-average-ticket").textContent = pricedCount
    ? formatUsd(totalSpend / pricedCount, 2)
    : "-";
  document.querySelector("#memory-spend-line").setAttribute("points", spendPointText);
  document.querySelector("#memory-spend-area").setAttribute(
    "d",
    `M 0 67 L ${spendPointText.replaceAll(" ", " L ")} L 320 67 Z`
  );
  document.querySelector("#memory-spend-points").replaceChildren(...spendPoints
    .filter(({ amount }) => amount > 0)
    .map(({ x, y }) => {
    const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    point.setAttribute("cx", x.toFixed(1));
    point.setAttribute("cy", y.toFixed(1));
    point.setAttribute("r", "2.2");
    return point;
  }));
  document.querySelector("#memory-top-spend-month").textContent = topSpendMonth
    ? `${formatChartMonth(topSpendMonth)} · ${formatUsd(chartMaximum)}`
    : "-";
  document.querySelector("#memory-spend-start").textContent = formatChartMonth(monthlySeries[0]);
  document.querySelector("#memory-spend-middle").textContent = formatChartMonth(
    monthlySeries[Math.floor((monthlySeries.length - 1) / 2)]
  );
  document.querySelector("#memory-spend-end").textContent = formatChartMonth(monthlySeries.at(-1));
  document.querySelector("#memory-busiest-year").textContent = `${busiestYear} (${busiestYearCount})`;
  document.querySelector("#memory-average-rating").textContent = Number.isFinite(averageRating)
    ? `${averageRating.toFixed(2)} / 5`
    : "-";
  document.querySelector("#memory-loved-count").textContent = rated
    .filter((memory) => Math.round(memory.rating) === 5)
    .length.toLocaleString("en-US");
  document.querySelector("#memory-top-theatre").textContent = `${topTheatre} (${topTheatreCount})`;
  document.querySelector("#memory-top-month").textContent = `${topMonth} (${topMonthCount})`;
  document.querySelector("#memory-top-dimension").textContent = strongestDimension
    ? `${strongestDimension.label} (${strongestDimension.average.toFixed(2)}/5)`
    : "-";
  updateReactionRange(ratingFilter, memories.map((memory) => memory.rating));
  updateReactionRange(castFilter, memories.map((memory) => memory.castVibe));
  updateReactionRange(musicFilter, memories.map((memory) => memory.musicVibe));
  updateReactionRange(stageFilter, memories.map((memory) => memory.stageMagic));
  updateReactionRange(storyFilter, memories.map((memory) => memory.storyFeel));
  renderMemories();
}

search.addEventListener("input", renderMemories);
year.addEventListener("change", renderMemories);
const reactionValues = new Map([
  [ratingFilter, () => memories.map((memory) => memory.rating)],
  [castFilter, () => memories.map((memory) => memory.castVibe)],
  [musicFilter, () => memories.map((memory) => memory.musicVibe)],
  [stageFilter, () => memories.map((memory) => memory.stageMagic)],
  [storyFilter, () => memories.map((memory) => memory.storyFeel)]
]);
reactionFilters.forEach((filter) => filter.addEventListener("input", (event) => {
  updateReactionRange(filter, reactionValues.get(filter)(), event.target.dataset.rangeBound);
  renderMemories();
}));
priceSort.addEventListener("change", renderMemories);
clearFilters.addEventListener("click", () => {
  search.value = "";
  year.value = "";
  priceSort.value = "";
  reactionFilters.forEach(resetReactionFilter);
  reactionFilters.forEach((filter) => updateReactionRange(filter, reactionValues.get(filter)()));
  renderMemories();
  search.focus();
});

function normalizeMemoryRows(rows) {
  return rows
    .map((memory) => {
      const show = (memory.show || "").trim();
      const paletteAccent = artworkPalettes[showHash(show) % artworkPalettes.length][1];
      const dimensionScores = [
        memory.cast_vibe,
        memory.music_vibe,
        memory.stage_magic,
        memory.story_feel
      ].map(reactionScore).filter(Number.isFinite);
      const castVibe = reactionScore(memory.cast_vibe);
      const musicVibe = reactionScore(memory.music_vibe);
      const stageMagic = reactionScore(memory.stage_magic);
      const storyFeel = reactionScore(memory.story_feel);
      const rating = dimensionScores.length
        ? dimensionScores.reduce((sum, score) => sum + score, 0) / dimensionScores.length
        : Number.NaN;
      return {
        ...memory,
        date: normalizeDate(memory.date || ""),
        rating,
        show,
        theatre: (memory.theatre || "").trim(),
        city: (memory.city || "").trim(),
        seat: (memory.seat || "").trim(),
        price: (memory.price || "").trim(),
        note: (memory.note || "").trim(),
        photo: (memory.photo || "").trim(),
        castVibe,
        musicVibe,
        stageMagic,
        storyFeel,
        color: artworkColor(memory.color, paletteAccent)
      };
    })
    .filter((memory) => memory.date && memory.show)
    .sort((a, b) => b.date.localeCompare(a.date) || a.show.localeCompare(b.show));
}

async function loadCsvFallback() {
  const csvUrl = new URL("back-to-the-future-timeline.csv", window.location.href);
  csvUrl.searchParams.set("updated", Date.now().toString());
  const response = await fetch(csvUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Timeline data request failed: ${response.status}`);
  const text = await response.text();
  return { fingerprint: text, rows: parseCsv(text) };
}

async function loadMemories() {
  try {
    const databaseRows = await fetchTimelineRows();
    const source = databaseRows === null
      ? await loadCsvFallback()
      : { fingerprint: JSON.stringify(databaseRows), rows: databaseRows };
    if (source.fingerprint === lastCsvText) return;
    lastCsvText = source.fingerprint;
    memories = normalizeMemoryRows(source.rows);
    initializeMemories();
  } catch (error) {
    console.error(error);
    if (!memories.length) {
      empty.hidden = false;
      empty.textContent = "The timeline data could not be loaded.";
    }
  }
}

loadMemories();
const unsubscribeTimeline = subscribeToTimelineRows(loadMemories);
window.setInterval(loadMemories, 30000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadMemories();
});
if (unsubscribeTimeline) {
  window.addEventListener("pagehide", unsubscribeTimeline, { once: true });
}
