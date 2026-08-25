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

  target = productions[Math.floor(Math.random() * productions.length)];
  const alternatives = shuffle(productions.filter((item) => item.show !== target.show)).slice(0, 3);
  const choices = shuffle([target, ...alternatives]);
  const theatreText = target.theatres.length === 1
    ? target.theatres[0]
    : `It has played ${target.theatres.length} Broadway theatres, including ${target.theatres[0]}`;
  const cluePool = [
    { type: "theatre", text: `Theatre: ${theatreText}` },
    { type: "gross", text: `Recorded Broadway gross: ${formatGross(target.gross)}` },
    { type: "capacity", text: `Average capacity: ${(target.capacity * 100).toFixed(1)}%` },
    { type: "tony", text: `Tony record: ${target.awards.wins} wins from ${target.awards.nominations} nominations` }
  ];
  if (target.creators.length) {
    cluePool.push({
      type: "creators",
      text: `Composer / lyricist clue: ${target.creators[Math.floor(Math.random() * target.creators.length)]}`
    });
  }
  if (target.cast.length) {
    const cast = shuffle(target.cast).slice(0, 2);
    cluePool.push({
      type: "cast",
      text: `Tony-recognized cast: ${cast.join(" and ")}`
    });
  }
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
  fetch("tony-dashboard-data.json")
])
  .then(async ([overviewResponse, tonyResponse]) => {
    if (!overviewResponse.ok) throw new Error(`Game data request failed: ${overviewResponse.status}`);
    if (!tonyResponse.ok) throw new Error(`Tony clue data request failed: ${tonyResponse.status}`);
    return Promise.all([overviewResponse.json(), tonyResponse.json()]);
  })
  .then(([data, tonyData]) => {
    const creativeByShow = new Map();
    tonyData.rows
      .filter(([year, category, name, show]) => (
        /^(19|20)\d{2}$/.test(String(year))
        && category
        && name
        && show
      ))
      .forEach(([, category, name, show]) => {
        show.split("|").map((value) => value.trim()).filter(Boolean).forEach((showName) => {
          const key = normalizeShow(showName);
          const creative = creativeByShow.get(key) || { creators: new Set(), cast: new Set() };
          if (/score|music|lyrics/i.test(category) && name.length <= 100) {
            creative.creators.add(name);
          }
          if (/actor|actress/i.test(category) && name.length <= 100) {
            creative.cast.add(name);
          }
          creativeByShow.set(key, creative);
        });
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
    productions = [...shows.values()]
      .filter((item) => item.gross > 0 && item.availableSeats > 0)
      .map((item) => {
        const creative = creativeByShow.get(normalizeShow(item.show)) || {
          creators: new Set(),
          cast: new Set()
        };
        return {
          ...item,
          theatres: [...item.theatres].sort(),
          capacity: item.seats / item.availableSeats,
          creators: [...creative.creators],
          cast: [...creative.cast]
        };
      })
      .filter((item) => item.creators.length || item.cast.length);
    startRound();
  })
  .catch((error) => {
    feedbackElement.textContent = "The game data could not be loaded.";
    console.error(error);
  });
