"use strict";

let memories = [];

const list = document.querySelector("#memory-list");
const search = document.querySelector("#memory-search");
const year = document.querySelector("#memory-year");
const ratingFilter = document.querySelector("#memory-rating-filter");
const castFilter = document.querySelector("#memory-cast-filter");
const musicFilter = document.querySelector("#memory-music-filter");
const stageFilter = document.querySelector("#memory-stage-filter");
const storyFilter = document.querySelector("#memory-story-filter");
const clearFilters = document.querySelector("#memory-clear-filters");
const filterStatus = document.querySelector("#memory-filter-status");
const empty = document.querySelector("#memory-empty");

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

const sampleArtwork = {
  "Freak the Mighty": "assets/memory-art/freak-the-mighty.svg",
  "The Mousetrap": "assets/memory-art/the-mousetrap.svg",
  "Matilda The Musical": "assets/memory-art/matilda.svg",
  "Witness for the Prosecution": "assets/memory-art/witness-for-the-prosecution.svg",
  "Operation Mincemeat: A New Musical": "assets/memory-art/operation-mincemeat.svg"
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

function artworkTitleLines(show) {
  const words = show.split(/\s+/);
  const lines = [];
  words.forEach((word) => {
    const current = lines.at(-1);
    if (current && `${current} ${word}`.length <= 21) lines[lines.length - 1] = `${current} ${word}`;
    else if (lines.length < 3) lines.push(word);
    else lines[2] += ` ${word}`;
  });
  return lines;
}

const artworkConcepts = {
  "& Juliet": ["heart", "A NEW ENDING"],
  "Ain't Too Proud": ["microphone", "FIVE VOICES"],
  "Anastasia": ["crown", "A LOST PRINCESS"],
  "Back to the Future": ["clock", "TIME IN MOTION"],
  "Broadway in the Park": ["park", "THEATRE OUTDOORS"],
  "Cabaret": ["chair", "WELCOME TO THE CLUB"],
  "Carousel": ["carousel", "ROUND AND ROUND"],
  "Cats": ["cat", "EYES IN THE DARK"],
  "Chicago": ["skyline", "JAZZ AND JUSTICE"],
  "Come Alive": ["circus", "THE BIG TOP"],
  "Come From Away": ["airplane", "A MAP OF KINDNESS"],
  "Company": ["network", "LIVES CONNECTED"],
  "Dead Outlaw": ["western", "THE LAST RIDE"],
  "Dear Evan Hansen": ["letter", "WORDS ON A PAGE"],
  "Death Becomes Her": ["potion", "FOREVER FABULOUS"],
  "Disney's Frozen": ["snow", "WINTER MAGIC"],
  "Disney's Hercules": ["lightning", "A HERO RISES"],
  "Fiddler on the Roof": ["violin", "MUSIC ABOVE HOME"],
  "Gypsy": ["star", "BORN FOR THE SPOTLIGHT"],
  "Hamilton": ["quill", "HISTORY IN INK"],
  "Harry Potter and the Cursed Child": ["wand", "A CURSED CLOCK"],
  "Harry Potter and the Cursed Child: Part One": ["wand", "THE FIRST SPELL"],
  "Hugh Jackman: From New York, With Love": ["city-heart", "A LOVE LETTER TO NEW YORK"],
  "Hunchback of Notre Dame": ["bell", "BELLS ABOVE PARIS"],
  "Into The Woods": ["forest", "THE PATH BETWEEN TREES"],
  "Jesus Christ Superstar": ["sunburst", "LIGHT AND SHADOW"],
  "Just in Time": ["clock-note", "MUSIC ON THE CLOCK"],
  "Kinky Boots": ["boot", "STEP INTO YOUR TRUTH"],
  "Les Miserables": ["barricade", "A FLAG ABOVE THE STREETS"],
  "Life of Pi": ["boat", "A BOAT ON THE HORIZON"],
  "Little Shop of Horrors": ["plant", "FEED THE BLOOM"],
  "Mamma Mia!": ["island", "SUNSHINE AND SONG"],
  "Maybe Happy Ending": ["robot", "A SMALL MACHINE WITH HEART"],
  "Monty Python's Spamalot": ["castle", "A VERY SILLY QUEST"],
  "Moulin Rouge!": ["windmill", "THE RED WINDMILL"],
  "My Fair Lady": ["parasol", "FLOWERS AND FINERY"],
  "My Neighbor Totoro": ["leaf", "A FOREST FRIEND"],
  "Old Friends": ["chairs", "SEATS SAVED TOGETHER"],
  "Othello": ["moon", "TRUST IN SHADOW"],
  "Parade": ["banner", "A MARCH THROUGH MEMORY"],
  "Pirates! The Penzance Musical": ["ship", "SAIL INTO SONG"],
  "Real Women Have Curves": ["sewing", "CUT TO FIT REAL LIFE"],
  "Rent": ["key", "A CITY, A KEY, A YEAR"],
  "Romeo & Juliet": ["double-heart", "TWO HOUSES, ONE HEART"],
  "Sexual Misconduct of the Middle Classes": ["books", "LESSONS AND BOUNDARIES"],
  "Six": ["six-crowns", "SIX QUEENS, SIX VOICES"],
  "Sleep No More": ["mask", "BEHIND THE MASK"],
  "Some Like It Hot": ["sax", "BRASS UNDER PRESSURE"],
  "Spring Awakening": ["flower", "A SEASON BREAKS OPEN"],
  "Suffs": ["ballot", "VOICES FOR THE VOTE"],
  "Sunset Blvd.": ["sunset", "A CAMERA FACES WEST"],
  "The Great Gatsby": ["deco", "GOLD AFTER MIDNIGHT"],
  "The Lion King": ["lion", "THE SUN RISES"],
  "The Notebook": ["notebook", "LOVE BETWEEN THE LINES"],
  "Waitress": ["pie", "A SLICE OF A NEW LIFE"]
};

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
    heart: `<path d="M300 440C105 315 150 150 265 205c20 10 35 28 35 28s15-18 35-28c115-55 160 110-35 235z" ${line}/><path d="M225 300h150" ${thin}/>`,
    microphone: `<rect x="255" y="130" width="90" height="185" rx="45" fill="${accent}"/><path d="M210 275c0 125 180 125 180 0M300 395v80M245 475h110" ${line}/><circle cx="155" cy="300" r="18" fill="${highlight}"/><circle cx="445" cy="300" r="18" fill="${highlight}"/>`,
    crown: `<path d="M150 360l-35-180 115 78 70-135 70 135 115-78-35 180z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M155 400h290" ${line}/>`,
    clock: `<circle cx="300" cy="280" r="165" ${line}/><path d="M300 170v120l85 52M115 440h370" ${line}/><path d="M210 455l-45 45M390 455l45 45" ${thin}/>`,
    park: `<path d="M110 460h380M180 460V300M420 460V270" ${line}/><circle cx="180" cy="235" r="85" fill="${accent}"/><circle cx="420" cy="205" r="105" fill="${highlight}" opacity=".8"/><path d="M235 400h130v60H235z" ${thin}/>`,
    chair: `<path d="M220 210h160v165H220zM200 375h200M235 375v95M365 375v95" ${line}/><path d="M250 150h100" ${thin}/><circle cx="300" cy="150" r="22" fill="${accent}"/>`,
    carousel: `<path d="M125 240Q300 85 475 240M145 240h310M180 240v220M300 240v220M420 240v220M115 460h370" ${line}/><path d="M225 330c35-45 75-5 45 32l-25 30h-55zM375 330c35-45 75-5 45 32l-25 30h-55z" fill="${accent}"/>`,
    cat: `<path d="M175 385V210l70 55c35-18 75-18 110 0l70-55v175c0 80-250 80-250 0z" ${line}/><path d="M235 350l35 20-35 20M365 350l-35 20 35 20M300 390v25" ${thin}/><circle cx="245" cy="325" r="13" fill="${accent}"/><circle cx="355" cy="325" r="13" fill="${accent}"/>`,
    skyline: `<path d="M85 455h430M110 455V280h70v175M205 455V190h85v265M315 455V245h70v210M410 455V155h80v300" ${line}/><path d="M245 190v-55M450 155V95" ${thin}/>`,
    circus: `<path d="M95 455h410L430 210 300 105 170 210z" ${line}/><path d="M170 210h260M300 105v350M95 455l75-245M505 455l-75-245" ${thin}/><circle cx="300" cy="105" r="18" fill="${accent}"/>`,
    airplane: `<path d="M85 305l190-35 85-150 35 8-40 155 155 57-5 38-170-25-70 125-35-8 25-140-165 12z" fill="${highlight}"/><path d="M90 430c120 55 300 55 420-20" ${thin}/>`,
    network: `<circle cx="300" cy="280" r="44" fill="${highlight}"/><circle cx="155" cy="160" r="35" fill="${accent}"/><circle cx="445" cy="160" r="35" fill="${accent}"/><circle cx="145" cy="410" r="35" fill="${accent}"/><circle cx="455" cy="410" r="35" fill="${accent}"/><path d="M180 185l85 65M420 185l-85 65M175 390l90-80M425 390l-90-80" ${line}/>`,
    western: `<path d="M145 255c75-25 235-25 310 0l-65 65H210zM190 320h220c45 0 75 30 55 55H135c-20-25 10-55 55-55z" fill="${accent}" stroke="${highlight}" stroke-width="9"/><path d="M300 375v80M245 455h110" ${line}/>`,
    letter: `<path d="M110 155h380v290H110z" ${line}/><path d="M110 175l190 155 190-155M135 420l130-120M465 420L335 300" ${thin}/><path d="M210 115h180" ${line}/>`,
    potion: `<path d="M245 115h110M265 115v105l-95 205c-12 30 10 50 45 50h170c35 0 57-20 45-50l-95-205V115" ${line}/><path d="M205 350h190" ${thin}/><circle cx="260" cy="390" r="18" fill="${accent}"/><circle cx="335" cy="420" r="25" fill="${highlight}"/>`,
    snow: `<path d="M300 105v350M150 190l300 180M150 370l300-180M300 105l-35 45M300 105l35 45M150 190l60 5M150 190l25 55M450 190l-60 5M450 190l-25 55M150 370l60-5M150 370l25-55M450 370l-60-5M450 370l-25-55" ${line}/>`,
    lightning: `<path d="M335 80L175 310h120l-30 175 160-245H305z" fill="${highlight}" stroke="${accent}" stroke-width="10"/><path d="M120 455h100M380 455h100" ${thin}/>`,
    violin: `<path d="M300 105v185M280 290c-110-45-130 120-35 145 35 10 55-15 55-15s20 25 55 15c95-25 75-190-35-145z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M275 100h50M255 360h90" ${thin}/>`,
    star: `<path d="M300 85l48 135 143 4-113 88 41 137-119-80-119 80 41-137-113-88 143-4z" fill="${highlight}"/><circle cx="300" cy="280" r="175" ${thin}/>`,
    quill: `<path d="M130 440c145-18 235-130 330-320-155 30-285 115-310 285z" fill="${highlight}" opacity=".85"/><path d="M155 420L430 145M210 360l-35-85M270 300l-30-95M330 240l-20-75" ${line}/><path d="M100 465h350" ${thin}/>`,
    wand: `<path d="M145 440L430 145M390 115l15-45 15 45 45 15-45 15-15 45-15-45-45-15z" ${line}/><path d="M150 130l10-30 10 30 30 10-30 10-10 30-10-30-30-10z" fill="${accent}"/>`,
    "city-heart": `<path d="M95 455h410M130 455V270h75v185M235 455V175h95v280M360 455V240h90v215" ${line}/><path d="M300 305c-75-65-145 35 0 125 145-90 75-190 0-125z" fill="${accent}"/>`,
    bell: `<path d="M175 395h250l-40-55v-95c0-125-170-125-170 0v95z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><circle cx="300" cy="425" r="28" fill="${highlight}"/><path d="M300 105v55" ${line}/>`,
    forest: `<path d="M105 455l85-190h-50l95-170 95 170h-50l20 45 70-145 105 210h-55l40 80z" fill="${accent}" stroke="${highlight}" stroke-width="8"/><path d="M300 455c0-85 30-150 90-205" ${thin}/>`,
    sunburst: `<circle cx="300" cy="285" r="90" fill="${highlight}"/><path d="M300 95v65M300 410v65M110 285h65M425 285h65M165 150l45 45M390 375l45 45M435 150l-45 45M210 375l-45 45" ${line}/>`,
    "clock-note": `<circle cx="250" cy="285" r="145" ${line}/><path d="M250 185v105l70 45M370 145v220c0 65-95 75-95 15 0-45 55-60 95-35M370 145l95-35v210c0 65-95 75-95 15" ${thin}/>`,
    boot: `<path d="M205 110h135v230c0 55 110 35 165 90-25 70-195 60-315 35 35-75 15-225 15-355z" fill="${accent}" stroke="${highlight}" stroke-width="11"/><path d="M205 225h135M205 285h135" ${thin}/>`,
    barricade: `<path d="M80 430h440M120 430l65-190h230l65 190M160 310h280M135 375h330" ${line}/><path d="M300 240V90l125 55-125 55" fill="${accent}"/>`,
    boat: `<path d="M95 355h410c-25 95-115 125-205 125S120 450 95 355z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M300 355V105l140 180H300z" ${line}/><path d="M70 500c75-35 135 35 210 0s135 35 210 0" ${thin}/>`,
    plant: `<path d="M245 465h110l35-150H210z" fill="${accent}"/><path d="M300 315V175M300 230c-80-95-145-15-80 45 35 30 80 20 80 20M300 215c70-105 145-35 95 35-25 38-95 45-95 45" ${line}/><path d="M280 150l20-45 20 45" ${thin}/>`,
    island: `<circle cx="390" cy="175" r="70" fill="${highlight}"/><path d="M80 450h440M185 450c25-115 85-175 180-230M270 310c-45-75-105-75-150-35M285 290c55-70 125-60 170-10" ${line}/><path d="M125 495c80-40 130 35 210 0s130 35 210 0" ${thin}/>`,
    robot: `<rect x="185" y="170" width="230" height="220" rx="35" ${line}/><circle cx="250" cy="270" r="22" fill="${accent}"/><circle cx="350" cy="270" r="22" fill="${accent}"/><path d="M250 335h100M300 170v-65M275 105h50M215 390l-35 75M385 390l35 75" ${thin}/><path d="M300 320c-55-55-105 25 0 90 105-65 55-145 0-90z" fill="${highlight}" opacity=".8"/>`,
    castle: `<path d="M105 455V220h85v60h80V165h60v115h80v-60h85v235z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M255 455v-95c0-65 90-65 90 0v95M105 220l42-60 43 60M410 220l42-60 43 60" ${thin}/>`,
    windmill: `<circle cx="300" cy="270" r="38" fill="${accent}"/><path d="M300 232L210 85l-50 30 110 170M338 270l147-90-30-50-170 110M300 308l90 147 50-30-110-170M262 270l-147 90 30 50 170-110M245 455h110l-25-150h-60z" ${line}/>`,
    parasol: `<path d="M95 270Q300 70 505 270c-40-25-80-25-120 0-55-35-115-35-170 0-40-25-80-25-120 0zM300 175v210c0 95 100 95 100 15" ${line}/><path d="M125 445c85-65 135 25 220-30" ${thin}/>`,
    leaf: `<path d="M105 420c75-250 270-300 390-290-20 185-105 330-300 320z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M155 435L445 175M250 350l-15-115M320 285l90 15" ${line}/><path d="M300 450v-110" ${thin}/>`,
    chairs: `<path d="M95 275h180v120H95zM325 275h180v120H325zM120 395v70M250 395v70M350 395v70M480 395v70" ${line}/><path d="M185 275v-85M415 275v-85M185 190h230" ${thin}/>`,
    moon: `<path d="M395 110c-155 20-190 240-45 325-175 5-265-120-215-250 40-105 155-145 260-75z" fill="${highlight}"/><path d="M355 300l90 105M445 300l-90 105" ${thin}/>`,
    banner: `<path d="M105 455V125M115 145h365l-55 85 55 85H115" ${line}/><path d="M185 230h220M185 275h160" ${thin}/><circle cx="105" cy="105" r="25" fill="${accent}"/>`,
    ship: `<path d="M85 355h430c-25 95-120 130-215 130S110 450 85 355z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M300 355V95M300 115L125 300h175M300 150l155 150H300" ${line}/><path d="M300 95l90 35-90 35" fill="${accent}"/>`,
    sewing: `<path d="M300 105c-45 0-70 35-70 80 0 40 20 65 20 65l-85 210h270l-85-210s20-25 20-65c0-45-25-80-70-80z" ${line}/><path d="M215 330h170M180 415h240" ${thin}/><circle cx="125" cy="170" r="45" ${thin}/><path d="M125 125v90M80 170h90" ${thin}/>`,
    key: `<circle cx="205" cy="260" r="95" ${line}/><path d="M280 320l205 155M400 410l55-55M350 370l45-45" ${line}/><path d="M95 455h160" ${thin}/>`,
    "double-heart": `<path d="M220 430C70 320 105 180 195 220c18 8 25 22 25 22s8-14 25-22c90-40 125 100-25 210zM380 430c-150-110-115-250-25-210 18 8 25 22 25 22s8-14 25-22c90-40 125 100-25 210z" fill="${accent}" stroke="${highlight}" stroke-width="8"/><path d="M300 105v350" ${thin}/>`,
    books: `<path d="M95 405h410v70H95zM125 315h350v70H125zM85 225h430v70H85zM145 135h310v70H145z" fill="${accent}" stroke="${highlight}" stroke-width="8"/><path d="M185 135v70M400 225v70M220 315v70M420 405v70" ${thin}/>`,
    "six-crowns": `<path d="M70 220l25 95h70l25-95-45 30-25-55-25 55zM240 170l25 95h70l25-95-45 30-25-55-25 55zM410 220l25 95h70l25-95-45 30-25-55-25 55zM155 350l25 95h70l25-95-45 30-25-55-25 55zM325 350l25 95h70l25-95-45 30-25-55-25 55zM250 310l50-90 50 90z" fill="${accent}" stroke="${highlight}" stroke-width="7"/>`,
    mask: `<path d="M95 190c125-60 285-60 410 0l-45 185c-35 95-115 75-160-10-45 85-125 105-160 10z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M175 270c35-35 75-35 110 0M315 270c35-35 75-35 110 0" ${line}/>`,
    sax: `<path d="M330 105v215c0 95-120 105-155 25-35-85 55-155 105-85M330 105h105v65H330M180 390c30 75 145 100 220 20" ${line}/><circle cx="175" cy="335" r="28" fill="${accent}"/><path d="M405 385l40 70M440 370l55 55" ${thin}/>`,
    flower: `<circle cx="300" cy="270" r="48" fill="${highlight}"/><circle cx="300" cy="170" r="65" fill="${accent}"/><circle cx="395" cy="240" r="65" fill="${accent}"/><circle cx="360" cy="345" r="65" fill="${accent}"/><circle cx="240" cy="345" r="65" fill="${accent}"/><circle cx="205" cy="240" r="65" fill="${accent}"/><path d="M300 320v150M300 395c-65-60-115-15-85 35M300 405c65-60 115-15 85 35" ${line}/>`,
    ballot: `<path d="M120 235h360v240H120zM185 235l35-105h160l35 105" ${line}/><path d="M235 315l45 45 95-110" ${line}/><path d="M175 475h250" ${thin}/>`,
    sunset: `<circle cx="300" cy="310" r="135" fill="${highlight}"/><path d="M75 310h450M105 365h390M145 420h310M180 475h240" stroke="${accent}" stroke-width="13"/><path d="M135 135l55 55M465 135l-55 55M300 80v80" ${line}/>`,
    deco: `<path d="M300 75L105 460h390z" ${line}/><path d="M300 145L175 420h250zM300 220L240 370h120z" ${thin}/><circle cx="300" cy="320" r="35" fill="${accent}"/>`,
    lion: `<circle cx="300" cy="280" r="175" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M215 255l45-45 40 35 40-35 45 45v110c-45 80-125 80-170 0z" fill="${highlight}"/><circle cx="260" cy="300" r="12" fill="${accent}"/><circle cx="340" cy="300" r="12" fill="${accent}"/><path d="M260 365h80" ${thin}/>`,
    notebook: `<path d="M125 110h350v365H125zM300 110v365" fill="${highlight}" opacity=".16" stroke="${highlight}" stroke-width="10"/><path d="M155 175h110M155 230h110M155 285h110M335 175h110M335 230h110M335 285h110" ${thin}/><path d="M300 365c-85-75-155 45 0 130 155-85 85-205 0-130z" fill="${accent}"/>`,
    pie: `<path d="M105 230h390l-40 230H145z" fill="${accent}" stroke="${highlight}" stroke-width="10"/><path d="M125 230c30-110 120-140 175-55 55-85 145-55 175 55M165 305h270M180 365h240" ${line}/><path d="M250 150c0-50 45-70 45-110M340 150c0-50 45-70 45-110" ${thin}/>`
  };
  return scenes[scene] || scenes.star;
}

function generatedArtwork(show) {
  const hash = showHash(show);
  const [background, accent, highlight] = artworkPalettes[hash % artworkPalettes.length];
  const [scene, concept] = artworkConcepts[show] || ["star", "A NIGHT AT THE THEATRE"];
  const titleLines = artworkTitleLines(show);
  const titleSize = titleLines.some((line) => line.length > 24) ? 28 : titleLines.length > 2 ? 32 : 38;
  const titleMarkup = titleLines.map((line, index) => (
    `<tspan x="300" y="${635 + index * 43}">${escapeXml(line)}</tspan>`
  )).join("");
  const dotX = 80 + (hash % 420);
  const dotY = 80 + ((hash >>> 8) % 390);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" role="img" aria-label="${escapeXml(show)} original memory illustration">
    <rect width="600" height="800" fill="${background}"/>
    ${artworkBackdrop(hash, accent, highlight)}
    ${artworkScene(scene, accent, highlight)}
    <circle cx="${dotX}" cy="${dotY}" r="10" fill="${accent}" opacity=".75"/>
    <circle cx="${600 - dotX}" cy="${510 - dotY / 2}" r="6" fill="${highlight}" opacity=".65"/>
    <text x="300" y="565" text-anchor="middle" fill="${accent}" font-family="Aptos,Segoe UI,sans-serif" font-size="16" font-weight="700" letter-spacing="4">${escapeXml(concept)}</text>
    <text text-anchor="middle" fill="#fff" font-family="Georgia,serif" font-size="${titleSize}" font-weight="700">${titleMarkup}</text>
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
  return value && !/^[A-Za-z]:\\/.test(value) ? value : "";
}

function renderPhoto(memory) {
  const source = browserPhotoSource(memory.photo)
    || sampleArtwork[memory.show]
    || generatedArtwork(memory.show);
  if (source) {
    const image = document.createElement("img");
    image.src = source;
    image.alt = `${memory.show} memory`;
    image.loading = "lazy";
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
  if (!filter.value) return true;
  const score = reactionScore(value);
  return Number.isFinite(score) && Math.round(score) === Number(filter.value);
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
  ));

  list.replaceChildren(...filtered.map((memory, index) => {
    const article = document.createElement("article");
    article.className = `memory-entry ${index % 2 ? "memory-right" : "memory-left"}`;
    article.style.setProperty("--memory-color", memory.color);

    const marker = document.createElement("div");
    marker.className = "memory-marker";
    marker.setAttribute("aria-hidden", "true");

    const card = document.createElement("div");
    card.className = "memory-card";
    const media = document.createElement("div");
    media.className = "memory-photo";
    media.appendChild(renderPhoto(memory));
    const copy = document.createElement("div");
    copy.className = "memory-copy";
    const date = document.createElement("time");
    date.dateTime = memory.date;
    date.textContent = formatDate(memory.date);
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
    copy.append(date, title, venue);
    if (memory.seat) {
      const seat = document.createElement("p");
      seat.className = "memory-seat";
      seat.textContent = memory.seat;
      copy.appendChild(seat);
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
    article.append(marker, card);
    return article;
  }));
  empty.hidden = filtered.length > 0;
  filterStatus.textContent = `Showing ${filtered.length.toLocaleString("en-US")} of ${memories.length.toLocaleString("en-US")} theatre memories. Filters combine.`;
  clearFilters.disabled = !search.value && !year.value
    && !ratingFilter.value && !castFilter.value && !musicFilter.value
    && !stageFilter.value && !storyFilter.value;
}

function mostFrequent(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || ["-", 0];
}

function labelReactionOptions(filter, values) {
  const counts = new Map();
  values.forEach((value) => {
    const score = reactionScore(value);
    if (!Number.isFinite(score)) return;
    const rounded = Math.round(score);
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  });
  [...filter.options].slice(1).forEach((option) => {
    const count = counts.get(Number(option.value)) || 0;
    option.textContent = `${reactionLabels[Number(option.value)]} (${count})`;
    option.disabled = count === 0;
  });
}

function initializeMemories() {
  const years = [...new Set(memories.map((memory) => memory.date.slice(0, 4)))]
    .sort((a, b) => b.localeCompare(a));
  years.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    year.appendChild(option);
  });
  document.querySelector("#memory-show-count").textContent = memories.length.toLocaleString("en-US");
  document.querySelector("#memory-theatre-count").textContent = new Set(
    memories.map((memory) => memory.theatre).filter(Boolean)
  ).size.toLocaleString("en-US");
  document.querySelector("#memory-first-year").textContent = years.at(-1) || "-";
  document.querySelector("#memory-latest-year").textContent = years[0] || "-";
  const cities = memories.map((memory) => memory.city).filter(Boolean);
  const [topCity, topCityCount] = mostFrequent(cities);
  const [topShow, topShowCount] = mostFrequent(memories.map((memory) => memory.show));
  const [busiestYear, busiestYearCount] = mostFrequent(memories.map((memory) => memory.date.slice(0, 4)));
  const rated = memories.filter((memory) => Number.isFinite(memory.rating));
  const averageRating = rated.length
    ? rated.reduce((sum, memory) => sum + memory.rating, 0) / rated.length
    : Number.NaN;
  document.querySelector("#memory-city-count").textContent = new Set(cities).size.toLocaleString("en-US");
  document.querySelector("#memory-top-city").textContent = `${topCity} (${topCityCount})`;
  document.querySelector("#memory-top-show").textContent = `${topShow} (${topShowCount})`;
  document.querySelector("#memory-busiest-year").textContent = `${busiestYear} (${busiestYearCount})`;
  document.querySelector("#memory-average-rating").textContent = Number.isFinite(averageRating)
    ? `${averageRating.toFixed(2)} / 5`
    : "-";
  document.querySelector("#memory-loved-count").textContent = rated
    .filter((memory) => Math.round(memory.rating) === 5)
    .length.toLocaleString("en-US");
  labelReactionOptions(ratingFilter, memories.map((memory) => memory.rating));
  labelReactionOptions(castFilter, memories.map((memory) => memory.castVibe));
  labelReactionOptions(musicFilter, memories.map((memory) => memory.musicVibe));
  labelReactionOptions(stageFilter, memories.map((memory) => memory.stageMagic));
  labelReactionOptions(storyFilter, memories.map((memory) => memory.storyFeel));
  renderMemories();
}

search.addEventListener("input", renderMemories);
year.addEventListener("change", renderMemories);
[ratingFilter, castFilter, musicFilter, stageFilter, storyFilter]
  .forEach((filter) => filter.addEventListener("change", renderMemories));
clearFilters.addEventListener("click", () => {
  search.value = "";
  year.value = "";
  [ratingFilter, castFilter, musicFilter, stageFilter, storyFilter]
    .forEach((filter) => { filter.value = ""; });
  renderMemories();
  search.focus();
});

fetch("back-to-the-future-timeline.csv?v=5")
  .then((response) => {
    if (!response.ok) throw new Error(`Timeline data request failed: ${response.status}`);
    return response.text();
  })
  .then((text) => {
    memories = parseCsv(text)
      .map((memory) => ({
        ...memory,
        date: normalizeDate(memory.date),
        rating: reactionScore(memory.rating),
        castVibe: memory.cast_vibe.trim(),
        musicVibe: memory.music_vibe.trim(),
        stageMagic: memory.stage_magic.trim(),
        storyFeel: memory.story_feel.trim(),
        color: memory.color || "#315bcf"
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.show.localeCompare(b.show));
    initializeMemories();
  })
  .catch((error) => {
    console.error(error);
    empty.hidden = false;
    empty.textContent = "The timeline data could not be loaded.";
  });
