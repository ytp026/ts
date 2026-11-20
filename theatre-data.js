"use strict";

// Playbill reports each week under the venue's name at the time, so one building can
// appear under several names. Every alias below is the same physical building as its
// current (canonical) name; listed oldest name first so "formerly" labels read in order.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TheatreData = api;
}(typeof window !== "undefined" ? window : globalThis, () => {
  const THEATRE_ALIASES = [
    // [name in Playbill data, current building name, short label for "formerly ..."]
    ["Alvin Theatre", "Neil Simon Theatre", "Alvin"],
    ["46th Street Theatre", "Richard Rodgers Theatre", "46th Street"],
    ["Ritz Theatre", "Walter Kerr Theatre", "Ritz"],
    ["Helen Hayes Theatre", "Hayes Theater", "Helen Hayes"],
    ["Helen Hayes Theater", "Hayes Theater", "Helen Hayes"],
    ["Ford Center for the Performing Arts", "Lyric Theatre", "Ford Center"],
    ["Hilton Theatre", "Lyric Theatre", "Hilton"],
    ["Foxwoods Theatre", "Lyric Theatre", "Foxwoods"],
    ["Martin Beck Theatre", "Al Hirschfeld Theatre", "Martin Beck"],
    ["Virginia Theatre", "August Wilson Theatre", "Virginia"],
    ["Kit Kat Klub", "August Wilson Theatre", "Kit Kat Klub"],
    ["Plymouth Theatre", "Gerald Schoenfeld Theatre", "Plymouth"],
    ["Royale Theatre", "Bernard B. Jacobs Theatre", "Royale"],
    ["Biltmore Theatre", "Samuel J. Friedman Theatre", "Biltmore"],
    ["Henry Miller's Theatre", "Stephen Sondheim Theatre", "Henry Miller's"],
    ["Sam S. Shubert Theatre", "Shubert Theatre", "Sam S. Shubert"],
    ["Brooks Atkinson Theatre", "Lena Horne Theatre", "Brooks Atkinson"],
    ["Cort Theatre", "James Earl Jones Theatre", "Cort"],
    ["American Airlines Theatre", "Todd Haimes Theatre", "American Airlines"]
  ];

  const THEATRE_NOTES = {
    "August Wilson Theatre": "Kit Kat Klub is Cabaret's 2024 immersive conversion of this house.",
    "Stephen Sondheim Theatre": "Rebuilt behind the preserved Henry Miller's facade on the same site (reopened 2009)."
  };

  // Venues in the data that are no longer Broadway houses and have no successor building.
  const FORMER_VENUES = {
    "Mark Hellinger Theatre": "Former Broadway venue; Times Square Church since 1991.",
    "Edison Theatre": "Former Broadway venue; no longer a Broadway house.",
    "Criterion Center Stage Right": "Former Broadway venue at 1530 Broadway; closed 1999.",
    "Jack Lawrence Theatre": "Former Broadway venue; no longer a Broadway house."
  };

  // The James Earl Jones row in the address source carries placeholder coordinates;
  // the Cort row geocodes the same 138 West 48th Street building.
  const METADATA_SOURCE = { "James Earl Jones Theatre": "Cort Theatre" };

  const canonicalByAlias = new Map(THEATRE_ALIASES.map(([alias, canonical]) => [alias, canonical]));
  const formerLabels = new Map();
  THEATRE_ALIASES.forEach(([, canonical, label]) => {
    const labels = formerLabels.get(canonical) || [];
    if (!labels.includes(label)) labels.push(label);
    formerLabels.set(canonical, labels);
  });

  function canonicalTheatre(name) {
    return canonicalByAlias.get(name) || name;
  }

  function formerNames(name) {
    return [...(formerLabels.get(canonicalTheatre(name)) || [])];
  }

  function isFormerVenue(name) {
    return Object.prototype.hasOwnProperty.call(FORMER_VENUES, name);
  }

  function theatreDetail(name) {
    const canonical = canonicalTheatre(name);
    if (isFormerVenue(canonical)) return "former venue";
    const former = formerNames(canonical);
    return former.length ? `formerly ${former.join(" / ")}` : "";
  }

  function theatreLabel(name) {
    const canonical = canonicalTheatre(name);
    const detail = theatreDetail(canonical);
    return detail ? `${canonical} (${detail})` : canonical;
  }

  function theatreNote(name) {
    const canonical = canonicalTheatre(name);
    return FORMER_VENUES[canonical] || THEATRE_NOTES[canonical] || "";
  }

  // Lowercased text a theatre filter can match, so typing an old name still finds the building.
  function theatreSearchText(name) {
    const canonical = canonicalTheatre(name);
    return [canonical, ...THEATRE_ALIASES.filter(([, current]) => current === canonical)
      .map(([alias]) => alias)].join(" | ").toLocaleLowerCase();
  }

  function canonicalizeRows(rows) {
    return rows.map((row) => ({ ...row, sourceTheatre: row.theatre, theatre: canonicalTheatre(row.theatre) }));
  }

  // entries: [name, address, current, x, y] from theatres-dashboard-data.json.
  function mergeTheatreMetadata(entries) {
    const byName = new Map(entries.map(([name, address, current, x, y]) => [name, { address, current, x, y }]));
    const merged = new Map();
    entries.forEach(([name]) => {
      const canonical = canonicalTheatre(name);
      if (merged.has(canonical)) return;
      const preferred = byName.get(METADATA_SOURCE[canonical])
        || byName.get(canonical)
        || byName.get(name);
      merged.set(canonical, { ...preferred });
    });
    return merged;
  }

  function summarizeRun(rows, show, theatre) {
    const canonical = canonicalTheatre(theatre);
    const years = new Map();
    const totals = { gross: 0, seats: 0, available: 0 };
    rows.filter((row) => row.show === show && canonicalTheatre(row.theatre) === canonical).forEach((row) => {
      const year = years.get(row.year) || { year: row.year, gross: 0, seats: 0, available: 0 };
      ["gross", "seats", "available"].forEach((key) => {
        year[key] += row[key];
        totals[key] += row[key];
      });
      years.set(row.year, year);
    });
    const byYear = [...years.values()]
      .sort((a, b) => a.year.localeCompare(b.year))
      .map((year) => ({ ...year, capacity: year.available ? year.seats / year.available : Number.NaN }));
    return {
      show,
      theatre: canonical,
      ...totals,
      capacity: totals.available ? totals.seats / totals.available : Number.NaN,
      firstYear: byYear.length ? byYear[0].year : "",
      lastYear: byYear.length ? byYear[byYear.length - 1].year : "",
      byYear
    };
  }

  return {
    THEATRE_ALIASES,
    FORMER_VENUES,
    canonicalTheatre,
    canonicalizeRows,
    formerNames,
    isFormerVenue,
    mergeTheatreMetadata,
    summarizeRun,
    theatreDetail,
    theatreLabel,
    theatreNote,
    theatreSearchText
  };
}));
