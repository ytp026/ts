const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const TheatreData = require(path.join(root, "theatre-data.js"));
const data = JSON.parse(fs.readFileSync(path.join(root, "theatres-dashboard-data.json"), "utf8"));
const rows = data.rows.map(([year, show, theatre, gross, seats, available]) => (
  { year, show, theatre, gross, seats, available }
));

const CURRENT_BROADWAY = [
  "Al Hirschfeld Theatre", "Ambassador Theatre", "August Wilson Theatre", "Belasco Theatre",
  "Bernard B. Jacobs Theatre", "Booth Theatre", "Broadhurst Theatre", "Broadway Theatre",
  "Circle in the Square Theatre", "Ethel Barrymore Theatre", "Eugene O'Neill Theatre",
  "Gerald Schoenfeld Theatre", "Gershwin Theatre", "Hayes Theater", "Hudson Theatre",
  "Imperial Theatre", "James Earl Jones Theatre", "John Golden Theatre", "Lena Horne Theatre",
  "Longacre Theatre", "Lunt-Fontanne Theatre", "Lyceum Theatre", "Lyric Theatre",
  "Majestic Theatre", "Marquis Theatre", "Minskoff Theatre", "Music Box Theatre",
  "Nederlander Theatre", "Neil Simon Theatre", "New Amsterdam Theatre", "Palace Theatre",
  "Richard Rodgers Theatre", "Samuel J. Friedman Theatre", "Shubert Theatre",
  "St. James Theatre", "Stephen Sondheim Theatre", "Studio 54", "Todd Haimes Theatre",
  "Vivian Beaumont Theater", "Walter Kerr Theatre", "Winter Garden Theatre"
];

test("renamed theatres map to their current building name", () => {
  const expected = {
    "Cort Theatre": "James Earl Jones Theatre",
    "Ford Center for the Performing Arts": "Lyric Theatre",
    "Hilton Theatre": "Lyric Theatre",
    "Foxwoods Theatre": "Lyric Theatre",
    "Virginia Theatre": "August Wilson Theatre",
    "Kit Kat Klub": "August Wilson Theatre",
    "Brooks Atkinson Theatre": "Lena Horne Theatre",
    "Helen Hayes Theatre": "Hayes Theater",
    "Helen Hayes Theater": "Hayes Theater",
    "Sam S. Shubert Theatre": "Shubert Theatre",
    "American Airlines Theatre": "Todd Haimes Theatre",
    "Henry Miller's Theatre": "Stephen Sondheim Theatre"
  };
  for (const [alias, canonical] of Object.entries(expected)) {
    assert.equal(TheatreData.canonicalTheatre(alias), canonical, alias);
  }
  assert.equal(TheatreData.canonicalTheatre("Lyric Theatre"), "Lyric Theatre");
  assert.equal(TheatreData.canonicalTheatre("Mark Hellinger Theatre"), "Mark Hellinger Theatre");
});

test("every alias targets one of the 41 current Broadway houses", () => {
  assert.equal(CURRENT_BROADWAY.length, 41);
  for (const [alias, canonical] of TheatreData.THEATRE_ALIASES) {
    assert.ok(CURRENT_BROADWAY.includes(canonical), `${alias} -> ${canonical}`);
    assert.ok(!CURRENT_BROADWAY.includes(alias), `${alias} is itself a current name`);
  }
});

test("labels show former names and former venues", () => {
  assert.equal(TheatreData.theatreLabel("Lyric Theatre"), "Lyric Theatre (formerly Ford Center / Hilton / Foxwoods)");
  assert.equal(TheatreData.theatreLabel("Hilton Theatre"), "Lyric Theatre (formerly Ford Center / Hilton / Foxwoods)");
  assert.equal(TheatreData.theatreLabel("Hayes Theater"), "Hayes Theater (formerly Helen Hayes)");
  assert.equal(TheatreData.theatreLabel("Edison Theatre"), "Edison Theatre (former venue)");
  assert.equal(TheatreData.theatreLabel("Majestic Theatre"), "Majestic Theatre");
  assert.match(TheatreData.theatreSearchText("James Earl Jones Theatre"), /cort/);
});

test("canonicalizing the data leaves 41 current houses plus 4 former venues", () => {
  const raw = new Set(rows.map((row) => row.theatre));
  const canonicalRows = TheatreData.canonicalizeRows(rows);
  const canonical = new Set(canonicalRows.map((row) => row.theatre));
  assert.equal(raw.size, 63);
  assert.equal(canonical.size, 45);
  const former = [...canonical].filter((name) => !CURRENT_BROADWAY.includes(name));
  assert.deepEqual(former.sort(), Object.keys(TheatreData.FORMER_VENUES).sort());
  assert.deepEqual(CURRENT_BROADWAY.filter((name) => !canonical.has(name)), []);
  const sum = (list) => list.reduce((total, row) => total + row.gross, 0);
  assert.equal(sum(canonicalRows), sum(rows));
});

test("merged metadata uses the geocoded Cort row for James Earl Jones", () => {
  const merged = TheatreData.mergeTheatreMetadata(data.theatres);
  const cort = data.theatres.find(([name]) => name === "Cort Theatre");
  const jej = merged.get("James Earl Jones Theatre");
  assert.equal(jej.x, cort[3]);
  assert.equal(jej.y, cort[4]);
  assert.ok(!merged.has("Cort Theatre"));
});

test("Hamilton hero figures come from the Richard Rodgers rows", () => {
  const run = TheatreData.summarizeRun(rows, "Hamilton", "Richard Rodgers Theatre");
  assert.equal(run.firstYear, "2015");
  assert.ok(Math.abs(run.capacity - 1.0031) < 0.0005, String(run.capacity));
  assert.ok(Math.abs(run.gross - 1.2237e9) < 0.01e9, String(run.gross));
  assert.equal(run.seats, run.byYear.reduce((total, year) => total + year.seats, 0));
});
