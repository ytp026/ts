"use strict";

const roundLimit = 10;
let productions = [];
let round = 1;
let score = 0;
let streak = 0;
let correctAnswers = 0;
let target = null;
let clues = [];
let cluesShown = 1;
let answered = false;
let previousFirstClue = "";
let gameComplete = false;
let answerDeck = [];
let lastAnswer = "";
let recentDistractorRounds = [];
let previousChoiceOrder = "";

const roundElement = document.querySelector("#game-round");
const scoreElement = document.querySelector("#game-score");
const streakElement = document.querySelector("#game-streak");
const cluesElement = document.querySelector("#game-clues");
const choicesElement = document.querySelector("#game-choices");
const feedbackElement = document.querySelector("#game-feedback");
const revealButton = document.querySelector("#reveal-clue");
const nextButton = document.querySelector("#next-round");
const resultElement = document.querySelector("#game-result");
const resultTitle = document.querySelector("#game-result-title");
const resultCopy = document.querySelector("#game-result-copy");

function formatGross(value) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  });
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = Math.floor(Math.random() * (index + 1));
    [result[index], result[random]] = [result[random], result[index]];
  }
  return result;
}

function normalizeShow(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function longestWeeklyStreak(values) {
  const week = 7 * 24 * 60 * 60 * 1000;
  const dates = [...new Set(values)]
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .map((value) => ({ value, time: Date.parse(`${value}T00:00:00Z`) }))
    .filter(({ time }) => Number.isFinite(time))
    .sort((left, right) => left.time - right.time);
  if (!dates.length) return { weeks: 0, start: "", end: "" };

  let runStart = 0;
  let bestStart = 0;
  let bestEnd = 0;
  for (let index = 1; index < dates.length; index += 1) {
    if (dates[index].time - dates[index - 1].time !== week) runStart = index;
    if (index - runStart > bestEnd - bestStart) {
      bestStart = runStart;
      bestEnd = index;
    }
  }
  return {
    weeks: bestEnd - bestStart + 1,
    start: dates[bestStart].value,
    end: dates[bestEnd].value
  };
}

function refillAnswerDeck() {
  answerDeck = shuffle(productions);
  if (answerDeck.length > 1 && answerDeck[0].show === lastAnswer) {
    [answerDeck[0], answerDeck[1]] = [answerDeck[1], answerDeck[0]];
  }
}

function drawNextTarget() {
  if (!answerDeck.length) refillAnswerDeck();
  const next = answerDeck.shift();
  lastAnswer = next.show;
  return next;
}

function distractorDistance(candidate, answer) {
  const grossDistance = Math.abs(Math.log10(candidate.gross) - Math.log10(answer.gross));
  const capacityDistance = Math.abs(candidate.capacity - answer.capacity) * 4;
  const eraDistance = Math.abs(candidate.firstYear - answer.firstYear) / 20;
  return grossDistance + capacityDistance + eraDistance;
}

function selectDistractors(answer) {
  const recent = new Set(recentDistractorRounds.flat());
  let candidates = productions.filter((item) => item.show !== answer.show && !recent.has(item.show));
  if (candidates.length < 3) candidates = productions.filter((item) => item.show !== answer.show);
  const plausible = candidates
    .map((item) => ({ item, score: distractorDistance(item, answer) + Math.random() * .35 }))
    .sort((left, right) => left.score - right.score)
    .slice(0, Math.min(15, candidates.length))
    .map(({ item }) => item);
  const selected = shuffle(plausible).slice(0, 3);
  recentDistractorRounds.push(selected.map((item) => item.show));
  if (recentDistractorRounds.length > 4) recentDistractorRounds.shift();
  return selected;
}

function randomizedChoices(answer, alternatives) {
  let choices = shuffle([answer, ...alternatives]);
  let signature = choices.map((choice) => choice.show).join("|");
  if (signature === previousChoiceOrder) {
    choices = [...choices.slice(1), choices[0]];
    signature = choices.map((choice) => choice.show).join("|");
  }
  previousChoiceOrder = signature;
  return choices;
}

const gameFacts = new Map(Object.entries({
  Wicked: {
    credits: "Music and lyrics by Stephen Schwartz · Book by Winnie Holzman",
    cast: "Original Broadway cast: Idina Menzel and Kristin Chenoweth",
    premiere: "Broadway premiere: October 30, 2003",
    song: "Defying Gravity"
  },
  Hamilton: {
    credits: "Book, music, and lyrics by Lin-Manuel Miranda",
    cast: "Original Broadway cast: Lin-Manuel Miranda and Leslie Odom Jr.",
    premiere: "Broadway premiere: August 6, 2015",
    song: "My Shot"
  },
  "The Lion King": {
    credits: "Principal songs: music by Elton John and lyrics by Tim Rice · Book by Roger Allers and Irene Mecchi",
    cast: "Original Broadway cast: Samuel E. Wright and Heather Headley",
    premiere: "Broadway premiere: November 13, 1997",
    song: "Circle of Life"
  },
  "The Phantom of the Opera": {
    credits: "Music by Andrew Lloyd Webber · Lyrics by Charles Hart, with additional lyrics by Richard Stilgoe · Book by Richard Stilgoe and Andrew Lloyd Webber",
    cast: "Original Broadway cast: Michael Crawford and Sarah Brightman",
    premiere: "Broadway premiere: January 26, 1988",
    song: "The Music of the Night"
  },
  Chicago: {
    credits: "Music by John Kander · Lyrics by Fred Ebb · Book by Fred Ebb and Bob Fosse",
    cast: "Original Broadway cast: Gwen Verdon and Chita Rivera",
    premiere: "Broadway premiere: June 3, 1975",
    song: "Cell Block Tango"
  },
  Cats: {
    credits: "Music by Andrew Lloyd Webber · Text adapted from T. S. Eliot, with additional lyrics by Trevor Nunn and Richard Stilgoe · No traditional book credit",
    cast: "Original Broadway cast: Betty Buckley and Terrence Mann",
    premiere: "Broadway premiere: October 7, 1982",
    song: "Memory"
  },
  "Les Misérables": {
    credits: "Music by Claude-Michel Schönberg · English lyrics by Herbert Kretzmer · Book by Alain Boublil and Claude-Michel Schönberg",
    cast: "Original Broadway cast: Colm Wilkinson and Patti LuPone",
    premiere: "Broadway premiere: March 12, 1987",
    song: "One Day More"
  },
  Rent: {
    credits: "Book, music, and lyrics by Jonathan Larson",
    cast: "Original Broadway cast: Adam Pascal and Idina Menzel",
    premiere: "Broadway premiere: April 29, 1996",
    song: "Seasons of Love"
  },
  Hairspray: {
    credits: "Music by Marc Shaiman · Lyrics by Marc Shaiman and Scott Wittman · Book by Mark O'Donnell and Thomas Meehan",
    cast: "Original Broadway cast: Marissa Jaret Winokur and Harvey Fierstein",
    premiere: "Broadway premiere: August 15, 2002",
    song: "You Can't Stop the Beat"
  },
  Hadestown: {
    credits: "Book, music, and lyrics by Anaïs Mitchell",
    cast: "Original Broadway cast: Reeve Carney and Eva Noblezada",
    premiere: "Broadway premiere: April 17, 2019",
    song: "Wait for Me"
  },
  "The Book of Mormon": {
    credits: "Book, music, and lyrics by Trey Parker, Robert Lopez, and Matt Stone",
    cast: "Original Broadway cast: Andrew Rannells and Josh Gad",
    premiere: "Broadway premiere: March 24, 2011",
    song: "I Believe"
  },
  Waitress: {
    credits: "Music and lyrics by Sara Bareilles · Book by Jessie Nelson",
    cast: "Original Broadway cast: Jessie Mueller and Keala Settle",
    premiere: "Broadway premiere: April 24, 2016",
    song: "She Used to Be Mine"
  },
  "SIX: The Musical": {
    credits: "Book, music, and lyrics by Toby Marlow and Lucy Moss",
    cast: "Original Broadway cast: Adrianna Hicks and Andrea Macasaet",
    premiere: "Broadway premiere: October 3, 2021",
    song: "Ex-Wives"
  },
  "Come From Away": {
    credits: "Book, music, and lyrics by Irene Sankoff and David Hein",
    cast: "Original Broadway cast: Jenn Colella and Joel Hatch",
    premiere: "Broadway premiere: March 12, 2017",
    song: "Me and the Sky"
  },
  "Dear Evan Hansen": {
    credits: "Music and lyrics by Benj Pasek and Justin Paul · Book by Steven Levenson",
    cast: "Original Broadway cast: Ben Platt and Rachel Bay Jones",
    premiere: "Broadway premiere: December 4, 2016",
    song: "Waving Through a Window"
  },
  "Kinky Boots": {
    credits: "Music and lyrics by Cyndi Lauper · Book by Harvey Fierstein",
    cast: "Original Broadway cast: Stark Sands and Billy Porter",
    premiere: "Broadway premiere: April 4, 2013",
    song: "Raise You Up"
  },
  "Fiddler on the Roof": {
    credits: "Music by Jerry Bock · Lyrics by Sheldon Harnick · Book by Joseph Stein",
    cast: "Original Broadway cast: Zero Mostel and Maria Karnilova",
    premiere: "Broadway premiere: September 22, 1964",
    song: "If I Were a Rich Man"
  },
  "West Side Story": {
    credits: "Music by Leonard Bernstein · Lyrics by Stephen Sondheim · Book by Arthur Laurents",
    cast: "Original Broadway cast: Carol Lawrence and Chita Rivera",
    premiere: "Broadway premiere: September 26, 1957",
    song: "Tonight"
  },
  "Into the Woods": {
    credits: "Music and lyrics by Stephen Sondheim · Book by James Lapine",
    cast: "Original Broadway cast: Joanna Gleason and Bernadette Peters",
    premiere: "Broadway premiere: November 5, 1987",
    song: "No One Is Alone"
  },
  "Matilda The Musical": {
    credits: "Music and lyrics by Tim Minchin · Book by Dennis Kelly",
    cast: "Original Broadway cast: Bertie Carvel and Lauren Ward",
    premiere: "Broadway premiere: April 11, 2013",
    song: "Naughty"
  },
  "Harry Potter and the Cursed Child": {
    credits: "Play by Jack Thorne · Story by J. K. Rowling, Jack Thorne, and John Tiffany",
    cast: "Original Broadway cast: Jamie Parker and Noma Dumezweni",
    premiere: "Broadway premiere: April 22, 2018",
    playClue: "Not a musical: the story begins nineteen years after the final Harry Potter novel"
  },
  "To Kill A Mockingbird": {
    credits: "Stage adaptation by Aaron Sorkin · Based on Harper Lee's novel",
    cast: "Original Broadway cast: Jeff Daniels and Celia Keenan-Bolger",
    premiere: "Broadway premiere: December 13, 2018",
    playClue: "Not a musical: a stage adaptation of Harper Lee's novel"
  },
  Othello: {
    credits: "Play by William Shakespeare",
    cast: "2025 Broadway cast: Denzel Washington and Jake Gyllenhaal",
    premiere: "The 2025 Broadway revival opened March 23",
    playClue: "Not a musical: Shakespeare's tragedy turns on jealousy and manipulation"
  },
  "Oh, Mary!": {
    credits: "Play by Cole Escola",
    cast: "Original Broadway cast: Cole Escola and Conrad Ricamora",
    premiere: "Broadway premiere: July 11, 2024",
    playClue: "Not a musical: this comedy reimagines Mary Todd Lincoln"
  },
  "The Play That Goes Wrong": {
    credits: "Play by Henry Lewis, Jonathan Sayer, and Henry Shields",
    cast: "Original Broadway cast included Henry Lewis and Dave Hearn",
    premiere: "Broadway premiere: April 2, 2017",
    playClue: "Not a musical: the Cornley Polytechnic Drama Society attempts a murder mystery"
  }
}).map(([show, facts]) => [normalizeShow(show), facts]));

function productionCategoryClue(facts) {
  return facts.song ? `Famous number: “${facts.song}”` : facts.playClue;
}

function buildCluePool(production) {
  const theatreText = production.theatres.length === 1
    ? production.theatres[0]
    : `It has played ${production.theatres.length} Broadway theatres, including ${production.theatres[0]}`;
  const localClues = [
    { type: "theatre", text: `Theatre: ${theatreText}` },
    { type: "gross", text: `Recorded Broadway gross: ${formatGross(production.gross)}` },
    { type: "capacity", text: `Average capacity: ${(production.capacity * 100).toFixed(1)}%` },
    { type: "attendance", text: `Recorded attendance: ${production.seats.toLocaleString("en-US")}` },
    {
      type: "tony",
      text: production.awards.nominations
        ? `Tony record: ${production.awards.wins} ${production.awards.wins === 1 ? "win" : "wins"} from ${production.awards.nominations} nominations`
        : "Tony record: no nominations in the bundled awards data"
    },
    { type: "weeks", text: `Reported Broadway weeks in the dataset: ${production.weeks.toLocaleString("en-US")}` },
    {
      type: "venues",
      text: `Distinct Broadway theatres in the bundled data: ${production.theatres.length.toLocaleString("en-US")}`
    }
  ];
  if (production.longestStreak.weeks >= 8) {
    const startYear = production.longestStreak.start.slice(0, 4);
    const endYear = production.longestStreak.end.slice(0, 4);
    const years = startYear === endYear ? ` (${startYear})` : ` (${startYear}–${endYear})`;
    localClues.push({
      type: "streak",
      text: `Longest bundled reporting streak: ${production.longestStreak.weeks.toLocaleString("en-US")} consecutive weeks${years}`
    });
  }
  if (!production.facts) return localClues;
  return localClues.concat(
    { type: "credits", text: production.facts.credits },
    { type: "cast", text: production.facts.cast },
    { type: "premiere", text: production.facts.premiere },
    { type: "production", text: productionCategoryClue(production.facts) }
  );
}

function renderClues() {
  cluesElement.replaceChildren(...clues.slice(0, cluesShown).map((clue, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = `Clue ${index + 1}`;
    value.textContent = clue;
    item.append(label, value);
    return item;
  }));
  revealButton.disabled = answered || cluesShown >= clues.length;
  revealButton.textContent = cluesShown >= clues.length ? "All clues revealed" : "Reveal another clue";
}

function finishRound(choice, button) {
  if (answered) return;
  answered = true;
  const correct = choice.show === target.show;
  choicesElement.querySelectorAll("button").forEach((choiceButton) => {
    choiceButton.disabled = true;
    if (choiceButton.dataset.show === target.show) choiceButton.classList.add("correct");
  });

  if (correct) {
    const points = Math.max(1, 5 - cluesShown);
    score += points;
    streak += 1;
    correctAnswers += 1;
    button.classList.add("correct");
    feedbackElement.textContent = `Correct! ${target.show} earns you ${points} point${points === 1 ? "" : "s"}.`;
  } else {
    streak = 0;
    button.classList.add("incorrect");
    feedbackElement.textContent = `The answer was ${target.show}.`;
  }

  scoreElement.textContent = score;
  streakElement.textContent = streak;
  revealButton.disabled = true;
  nextButton.hidden = false;
  nextButton.textContent = round === roundLimit ? "See final score" : "Next round";
}

function startRound() {
  answered = false;
  gameComplete = false;
  cluesShown = 1;
  feedbackElement.textContent = "";
  resultElement.hidden = true;
  revealButton.hidden = false;
  nextButton.hidden = true;
  document.querySelector("#game-title").textContent = "Name that production";
  roundElement.textContent = `${round} / ${roundLimit}`;

  target = drawNextTarget();
  const alternatives = selectDistractors(target);
  const choices = randomizedChoices(target, alternatives);
  const cluePool = buildCluePool(target);
  const shuffledClues = shuffle(cluePool);
  if (shuffledClues[0].type === previousFirstClue) {
    const replacement = 1 + Math.floor(Math.random() * (shuffledClues.length - 1));
    [shuffledClues[0], shuffledClues[replacement]] = [shuffledClues[replacement], shuffledClues[0]];
  }
  previousFirstClue = shuffledClues[0].type;
  clues = shuffledClues.map((clue) => clue.text);

  choicesElement.replaceChildren(...choices.map((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.show = choice.show;
    button.textContent = choice.show;
    button.addEventListener("click", () => finishRound(choice, button));
    return button;
  }));
  renderClues();
}

function showFinalScore() {
  gameComplete = true;
  revealButton.hidden = true;
  cluesElement.replaceChildren();
  choicesElement.replaceChildren();
  feedbackElement.textContent = "";
  document.querySelector("#game-title").textContent = "Your final curtain call";

  let rating = "Promising understudy";
  let note = "You are building your Broadway knowledge. Another performance will sharpen your instincts.";
  if (score >= 34) {
    rating = "Broadway legend";
    note = "A star performance. You know the marquees, the numbers, and the people behind the productions.";
  } else if (score >= 26) {
    rating = "Seasoned theatre expert";
    note = "An impressive run. Your Broadway knowledge is ready for center stage.";
  } else if (score >= 16) {
    rating = "Strong ensemble player";
    note = "A solid performance with plenty of sharp Broadway instincts.";
  }

  resultTitle.textContent = rating;
  resultCopy.textContent = `You answered ${correctAnswers} of ${roundLimit} shows correctly and earned ${score} of 40 possible points. ${note}`;
  resultElement.hidden = false;
  nextButton.textContent = "Play again";
  nextButton.hidden = false;
}

revealButton.addEventListener("click", () => {
  if (answered || cluesShown >= clues.length) return;
  cluesShown += 1;
  renderClues();
});

nextButton.addEventListener("click", () => {
  if (gameComplete) {
    round = 1;
    score = 0;
    streak = 0;
    correctAnswers = 0;
    scoreElement.textContent = score;
    streakElement.textContent = streak;
    startRound();
    return;
  }
  if (round === roundLimit) {
    showFinalScore();
    return;
  }
  round += 1;
  startRound();
});

Promise.all([
  fetch("broadway-overview-data.json"),
  fetch("history-dashboard-data.json")
])
  .then(async ([overviewResponse, historyResponse]) => {
    if (!overviewResponse.ok || !historyResponse.ok) {
      throw new Error(`Game data request failed: ${overviewResponse.status}/${historyResponse.status}`);
    }
    return Promise.all([overviewResponse.json(), historyResponse.json()]);
  })
  .then(([data, historyData]) => {
    const historyStats = new Map();
    historyData.rows.forEach(([date, , show]) => {
      const key = normalizeShow(show);
      const stats = historyStats.get(key) || { dates: new Set() };
      stats.dates.add(date);
      historyStats.set(key, stats);
    });
    const shows = new Map();
    data.productions.forEach((production) => {
      const current = shows.get(production.show) || {
        show: production.show,
        gross: 0,
        seats: 0,
        availableSeats: 0,
        theatres: new Set(),
        awards: data.awards[production.show] || { wins: 0, nominations: 0 }
      };
      current.gross += production.totalGross;
      current.seats += production.totalSeats;
      current.availableSeats += production.availableSeats;
      current.theatres.add(production.theatre);
      shows.set(production.show, current);
    });
    const eligibleProductions = [...shows.values()]
      .filter((item) => item.gross > 0 && item.availableSeats > 0)
      .map((item) => {
        const facts = gameFacts.get(normalizeShow(item.show));
        const stats = historyStats.get(normalizeShow(item.show));
        const dates = [...(stats?.dates || [])].sort();
        return {
          ...item,
          theatres: [...item.theatres].sort(),
          capacity: item.seats / item.availableSeats,
          facts,
          firstYear: Number(dates[0]?.slice(0, 4)),
          lastYear: Number(dates.at(-1)?.slice(0, 4)),
          weeks: dates.length,
          longestStreak: longestWeeklyStreak(dates)
        };
      })
      .filter((item) => item.weeks > 0)
      .sort((left, right) => right.gross - left.gross);
    const curated = eligibleProductions.filter((item) => item.facts);
    const additional = eligibleProductions.filter((item) => !item.facts);
    productions = [...curated, ...additional.slice(0, Math.max(0, 60 - curated.length))];
    if (productions.length < 45) throw new Error("The verified game clue pool does not contain enough productions.");
    startRound();
  })
  .catch((error) => {
    feedbackElement.textContent = "The game data could not be loaded.";
    console.error(error);
  });
