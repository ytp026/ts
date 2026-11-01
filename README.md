# Broadway dashboard data updates

The static site reads committed JSON files, not a live database. The original
gross snapshots were exported from a PBIP model (as credited in `index.html`).
Repository history contains no PBIP source or reproducible gross generator.
The original export covered weeks through **2026-08-23**; `generatedAt` was
2026-08-26. Supabase manages timeline memories, not box-office data. The receipt
OCR bytecode in `__pycache__` is not evidence of gross-data provenance.

## Refresh locally

Requires Python 3.11+ and `curl` on PATH; no third-party Python packages or secrets.

```powershell
python scripts\refresh_broadway.py
python -m unittest discover -s tests -p "test_*.py"
node --test
```

The updater reads [Playbill's public weekly table](https://playbill.com/grosses)
and its `?week=YYYY-MM-DD` archive. It backfills every week after the original
export and rechecks the most recent two weeks for corrections. Missing cells,
invalid dates/numbers, duplicate productions, partial tables, mismatched weekly
headline totals, source regression, HTTP failures and a source more than 14 days
old fail the command without publishing a successful refresh. No estimates or
substitute revenue are generated. Seats available equal theatre seats times
performances **plus previews**; ticket price is the reported average.

`broadway-weekly-data.json` retains the acquired weekly records and baseline
boundary. The updater subtracts previously acquired records before applying
their replacements to all three compatible outputs:

| Output | Consumers |
| --- | --- |
| `history-dashboard-data.json` | History and guessing game |
| `theatres-dashboard-data.json` | Theatre dashboard |
| `broadway-overview-data.json` | Overview, Tony comparisons and game |

Historical rows, awards, theatre metadata and existing Tony comparison windows
are preserved. New show/theatre pairs are included; existing names are matched
by case/diacritic/punctuation-normalized identity. Ambiguous identities fail.
All three gross totals must reconcile before files are written. Repeating a
refresh with unchanged source records is byte-for-byte idempotent, including
timestamps. `latestWeek` is the reporting boundary, not the generation date.
The frontend bypasses the JSON cache and shows overdue/unknown dates and HTTP
errors. These metrics describe **box-office gross, not profit**.

Awards, production opening dates and theatre map metadata are separate historical
datasets; this job does not invent or refresh them. Existing Tony period windows
remain as exported. New ceremony years need a separately verified update to
those windows and awards. Corrections before the baseline are deliberately not
applied because the original weekly export lacks theatre identity. For corrections
older than the two-week recheck, run `python scripts\refresh_broadway.py --recheck-all`;
do not edit the acquired ledger alone.

## Weekly automation and deployment

### Why the October 6 upload stopped updating

Verified against `main` commit `1250f721f8bf390664ee5579fe0c18356eff721b`
on October 25: the website, ledger and October 4 snapshot were uploaded, but
`.github/workflows`, `scripts` and `tests` were absent. The live site still
reported October 4 and the repository had only Pages runs, not a scheduled
gross refresh. Updating frontend files alone cannot create a weekly data job.

`.github/workflows/refresh-broadway.yml` runs Tuesday and Thursday at 23:00 UTC
(Thursday retries delayed Tuesday publications), plus default-branch pushes
and manual dispatch. The job refuses non-default branches. It tests,
acquires, validates, commits only the four data files to the default branch,
then explicitly requests and polls a legacy GitHub Pages build for the exact
commit. This explicit rebuild is
necessary because commits made with `GITHUB_TOKEN` do not automatically trigger
Pages builds. A build is requested even if data did not change, so a previous
commit followed by a failed deployment can recover on the next run.
An accepted build request alone is not reported as a successful deployment.
Acquisition and publishing failures remain failed Actions runs;
existing data remains available with an overdue warning.

As inspected on 2026-10-25, this repository's Pages configuration is
**Deploy from branch: `main`, `/`**, at https://ytp026.github.io/ts/.
The workflow targets that existing configuration and does not change Pages settings.

To activate, review and merge these changes into the default branch, enable
GitHub Actions and scheduled workflows, and allow the job's `contents: write`
and `pages: write` permissions. Branch protection must permit the automation's
data commit; otherwise the run fails and needs an approved PR-based publishing
process. No PAT or source credentials are needed. Enable Actions failure
notifications and monitor the Pages build after the first manual dispatch.
If Pages is switched to Actions deployment, replace the legacy build-request
step with your approved Pages deployment workflow.

The bundled data was refreshed locally through **2026-10-25**, the latest
published source week available on October 27. October 25's 32 production
rows reconcile to the publisher's total of **$33,966,016.20**. Local changes
do not update the live site until merged/published. No push or production
deployment was performed during implementation.

### Uploading the corrected source archive

Apply the archive as an **overlay to the current repository**, not as a replacement
that deletes existing files. Include both hidden `.github/workflows/` files
as well as **all `scripts/` and `tests/` files**; these were missing from the
previous upload. The archive excludes Git metadata, caches, dependencies,
receipt inputs and personal CSV/import files. Existing memory/timeline CSVs and
Supabase settings in the repository must be preserved; they are unrelated to
the gross updater. The existing browser-publishable Supabase configuration is
public site configuration, not a service-role secret.

Review/merge the complete overlay to `main`, then check **Actions → Refresh
Broadway grosses** (or manually Run workflow). The first run must finish both
the data refresh and verified Pages build. A token-policy inspection was denied
with HTTP 403, so Actions write policy and protected-branch compatibility still
require the repository owner's confirmation. Scheduled workflows run only from
the default branch and GitHub can disable schedules after prolonged repository
inactivity; re-enable them in Actions if needed. No upload/merge/settings changes
have been authorized or performed by this local correction.

## Rush & Lottery directory

`ticket-access-data.json` contains `checkedOn`, the policy-guide `source`, coverage
and verification notes, and an `offers` array consumed only by `rush.js`.
Automatically checked **October 28, 2026**: 53 offers across 28 productions (25 Rush,
22 Lottery, 6 SRO). Counts are computed from the loaded dataset, not hardcoded.
The directory reflects the current
[Playbill policy guide](https://playbill.com/article/broadway-rush-lottery-and-standing-room-only-policies-com-116003),
not every Broadway discount or real-time ticket inventory.

This refresh adds seven guide-listed productions, Telecharge digital rush for
Maybe Happy Ending, and the Outsiders' $30 Under 30 offer. It fills Hadestown
and SIX lottery details and corrects Wicked's lottery to $55 (not its separate
$59 student offer), corroborated on the official Hadestown and Wicked sites.
Moulin Rouge and Titanique offers were removed because they are no longer in
the current guide; this is **not** an independent assertion of closing dates.
Advance student/military discounts, full-price cancellation lines and the
Outsiders' special Ponyboy seat remain outside this rush/lottery/SRO directory.

`scripts/refresh_ticket_policies.py` acquires the complete guide and refreshes
prices, shows, offer types, entry times, eligibility, limits, payment, seating,
availability notes and linked destinations. It checks each distinct linked page
once, follows HTTPS redirects and preserves curated show names and official
box-office links. For a broken entry URL, a previously reviewed link at the
same provider is retained only if it still responds successfully; otherwise the
card links to the guide and warns about the broken URL. HTTP 403/429 responses
are explicitly flagged as blocked checks, not evidence that an offer closed.
Live inventory and agreement of every provider policy with the guide cannot be
established by link checks; linked provider policy always takes precedence.

The updater fails without changing the existing file or its check date on
source/network failure, unrecognized/incomplete article structure, missing
fields, unsafe URLs, duplicate offers or unexpected provider failures.
It requires at least 20 offers across 10 shows and all three offer categories.
Removing more than 20% of existing offers also stops the update for human review.
After independently confirming a large removal, run with
`--accept-large-removal`; do not use that flag to bypass a source/parser failure.
An offer absent from the guide is removed, not inferred to be a closed production.
All output is validated before an atomic replacement. Repeated checks with the
same date, policies and link results are byte-identical.

### Two-week automatic checks

The separate **Refresh Broadway ticket policies** workflow checks the guide
every **14 UTC calendar days after the last successful check**. GitHub cron
cannot represent a rolling two-week interval: it wakes daily at **13:17 UTC**,
but the updater makes **no policy or provider requests until due**. A failed
check leaves the previous date unchanged and retries on the next daily wake-up.
Successful unchanged policies still advance `checkedOn`; `automation.nextCheckOn`
is 14 days later. The current snapshot is next due **November 11, 2026**.
The page displays both dates and flags missed checks after the due date.
GitHub may delay scheduled jobs; this is not an exact-time SLA.

The workflow tests the parser and frontend, stages **only** the ticket JSON,
commits changed data and explicitly verifies branch-based Pages publication.
On days when no policy check is due, it avoids redundant builds of an already
published commit but retries a failed/missing Pages build. The ticket and
weekly-gross workflows share a concurrency lock to avoid overlapping bot pushes.
Manual **Run workflow** and relevant default-branch source pushes force an
immediate policy check without bypassing validation/removal safeguards.

**Activation still requires uploading/merging the complete source to `main`**,
including `.github/workflows/refresh-ticket-policies.yml`, both updater scripts,
the shared Pages publisher and tests. Enable Actions, allow `GITHUB_TOKEN` to
write repository contents/Pages, and ensure branch rules permit the bot push.
Keep Pages configured for the `main` branch root (the existing legacy setup).
No additional API key or secret is needed. Manually run **Refresh Broadway ticket
policies** after installation and confirm both data and Pages steps succeed.
Enable GitHub notifications for failed Actions runs; failures do not silently
claim a new successful check. Schedules run only on the default branch and can
be disabled by GitHub after prolonged repository inactivity.

For local checks (no publishing or Git operations):

```powershell
python scripts\refresh_ticket_policies.py
python scripts\refresh_ticket_policies.py --force
python -m unittest discover -s tests -p "test_*.py"
node --test
```

The first command skips acquisition when not due; `--force` checks now.
Frontend requests bypass browser cache and fail explicitly on invalid data.
The downloaded source package is code-ready, **not an activated production
schedule**; no push, merge, settings change or deployment has been performed.

## History seasonal index

The single monthly seasonality chart beneath the weekly line chart sums selected
shows' gross by reporting week before normalization. For each complete calendar
year, it divides every weekly gross by that year's average weekly gross and
multiplies by 100. It then averages those indices within each month of that year,
and averages the year-month means with **equal weight for each eligible year**.
The reporting week-ending date determines the calendar year/month; the older
line chart's "Week Starting" title is not used to shift those dates.

Eligibility requires every Sunday in the calendar year (52 or 53 weeks), with
positive total gross and available seats for the filtered shows each week.
Incomplete years, missing weeks and zero-gross/no-performance weeks exclude the
whole year; missing observations are never imputed as zero. With the current
unfiltered dataset, 38 years qualify: 1986–2019 and 2022–2025. Partial 1985/2026
and closure/reopening years 2020/2021 are excluded. Complete weeks do not guarantee
every production reported; historical reporting gaps cannot be inferred from
these aggregates.

Year, show search and selected-production filters apply. A show that did not
report for a full calendar year may have no eligible years, which is displayed
explicitly. Weekly selection and line-chart zoom intentionally do not narrow
the annual baseline. The panel highlights above-baseline months and their
percentages using the current filtered data. Included-year ranges appear in a
short caption; accessible, initially collapsed **How this is calculated** details
retain the full formula and excluded-year counts. Month tooltips and keyboard
focus show the index, contributing years and reported-week count.
The dashed line is labeled **Average = 100**. Indigo bars mean above average
(>100), slate bars below average (<100); effectively equal indices use a separate
neutral fill and an **Average (=100)** legend entry only when needed. Bar fills
and legend swatches share seasonality-scoped CSS color tokens. Numeric labels
and comparisons remain available independently of color.
An index of 120 means that month's equally year-weighted normalized weekly gross
is 20% above the annual baseline, not 20% more profit or a causal holiday effect.
Because month/week counts vary, the unweighted mean of the 12 final monthly
indices need not be exactly 100. Equal year weighting prevents high-gross modern
years or a 53-week year from dominating the chart; it does not control show mix,
prices, reporting changes or extraordinary events.

Seasonal context is shown only for above-baseline April/December, inside the
collapsed details. The linked Broadway News reports discuss a
[spring-break/Easter week with additional performances](https://www.broadwaynews.com/grosses-analysis-broadway-welcomes-highest-number-of-admissions-since-2018/)
and a [strong Christmas week](https://www.broadwaynews.com/grosses-analysis-broadway-does-big-business-during-christmas-2025/).
These are possible contributors, not demonstrated causes of the long-run index.
No holiday explanation is attached to arbitrary other months.

Longevity row labels follow the exact reporting segments plotted in the track:
a gap longer than 26 weeks starts a new segment, using the existing rule.
Each segment has its own year range, even if the years on opposite sides of the
gap are consecutive. If two segments share a calendar year, month/year labels
make the gap visible. Tooltips retain every segment's exact first/last reporting
dates. For example, Phantom has reported periods 1988-01-10–2020-03-08 and
2021-10-24–2023-04-16, displayed as **1988–2020, 2021–2023 · 1,753 weeks**.
The labels do not assert uninterrupted weekly performances within a segment.
Week counts, timeline segments, sorting and row selection behavior are unchanged.

## Machine learning, causal inference and NLP

The [ML Models page](https://ytp026.github.io/ts/models.html) and the causal section
of the [Tony Awards page](https://ytp026.github.io/ts/tony-awards.html#causal-results)
read JSON written by the scripts below. No result on the site is hand-entered.

### Data design: frozen training snapshot

- The weekly Playbill pull (`refresh_broadway.py`) is unchanged and only feeds the
  live dashboards.
- Modeling uses a one-time, numbers-only snapshot frozen by
  `scripts/freeze_grosses_snapshot.py` into
  `data/snapshots/grosses_snapshot_<YYYYMMDD>.csv`. It has one row per show-week:
  week, show, gross, seats sold, seats available, capacity and average ticket.
  A `.manifest.json` records its SHA-256, week range and source, and `CURRENT`
  points to the active file. The script refuses to overwrite a snapshot unless
  `--force` is given.
- The causal study, model training, evaluation and NLP join read only the snapshot.
  The weekly workflow never scrapes and never adds new weeks to training. New live
  weeks are used only to score next week's forecast, to fill in actuals for
  previously logged forecasts, and to measure drift against the snapshot.

### 1. Quasi-experimental study: do Tony winners pull ahead?

`scripts/tony_causal.py` → `ml/tony-causal-results.json`

Winning is not randomly assigned, so the headline number is reported as an
**association** between winning and later grosses. The pre-trend test, placebo and
event-study chart are shown next to it, so readers can judge how far a causal
reading is supported. The script writes this wording into the `interpretation`
field from its own test results.

- **Units:** productions nominated for Best Musical, Best Play, Best Revival of a
  Musical or Best Revival of a Play that were running on Tony night.
- **Comparison:** winners (treated) vs same-season nominees that lost (control).
- **Difference-in-differences:** the outcome is mean log weekly gross in weeks
  1–8 after the ceremony minus weeks −7–0. OLS with year fixed effects
  (seasonality and market shocks) and controls for musical vs play, revival,
  pre-ceremony capacity, pre-ceremony log gross and log run age.
- **Inference:** HC1 robust 95% CIs plus a 1,000-replicate production bootstrap.
- **Event study:** weeks −8 to +12 with production fixed effects and
  year-by-event-week fixed effects, SEs clustered by production, and a joint Wald
  test of the pre-period coefficients (pre-trends).
- **Checks and secondary outcomes:** a placebo ceremony 8 weeks early, capacity
  points, closing within 26 weeks (linear probability model), and musicals vs
  plays.
- Statistics are implemented in numpy (`scripts/ml_stats.py`) and unit-tested
  against synthetic data with a known effect.

### 2. Forecasting with MLOps on GitHub Actions

`scripts/forecast.py` → `ml/forecast-metrics.json`, `forecast-predictions.json`,
`forecast-backtest.json`, `monitoring.json`, `prediction-log.json`

- **Targets:** next week's gross (modeled as the log change) and whether a
  production closes within 8 weeks. Closing labels are censored for runs that may
  still be open.
- **Features:** lagged grosses and attendance, capacity, average ticket, run age,
  seasonality, Tony nominations and wins, and market totals, all known at
  forecast time.
- **Model:** scikit-learn `HistGradientBoostingRegressor` / `Classifier`.
  LightGBM was planned, but its wheels were unavailable for the development
  machine (Windows ARM64), so the scikit-learn implementation of the same
  algorithm family is used everywhere. The number of boosting iterations is
  selected on a validation year.
- **Time-based split:** train before 2023, validate on 2023, test from 2024 to the
  end of the snapshot. The 2020–2021 shutdown is excluded from labels.
- **Baselines:** last week's gross (persistence), seasonal persistence, logistic
  regression, and a low-capacity rule (1 − capacity, clipped to [0, 1] because
  standing room can push capacity above 100%). The 95% CIs for model−baseline differences
  come from paired bootstraps (by week for gross, by production for closing).
- **Experiment tracking:** each run is logged to a local file-based MLflow store
  (`mlruns/`, git-ignored, uploaded as a 90-day workflow artifact) with
  parameters, metrics and pickled models.
- **Deployment:** `.github/workflows/ml-weekly.yml` runs every Wednesday and on
  manual dispatch. It runs the tests, retrains, batch-scores the latest live week,
  commits the `ml/*.json` files and rebuilds GitHub Pages. There is no server, no
  external host and no secret beyond the built-in `GITHUB_TOKEN`.
- **Monitoring:** PSI drift for five show-level features (gross, capacity,
  average ticket, weekly change and run age), comparing the latest 8 live weeks
  with the 52 snapshot (training) weeks just before them, so long-run inflation
  and market growth don't trigger alerts (0.1 = moderate, 0.25 = major).
  Market gross is one value per week shared by every show, so row-level PSI on it
  mostly counts weeks and seasonality; instead it is checked as the percent
  change versus the same weeks one year earlier (10% = moderate, 25% = major).
  A run-age alert is kept as a real signal: it means the current slate is
  dominated by long-running shows (or a wave of new openings), which shifts the
  model's inputs. A prediction log is
  matched to reported actuals to compute live MAPE. There is an alert when live
  MAPE exceeds 1.5× the backtest MAPE after at least 30 matured forecasts.

### 3. NLP: do critics' reviews add predictive signal?

`scripts/collect_wikipedia_reviews.py` → `data/cache/wikipedia-reception.json`
(git-ignored), `scripts/score_review_sentiment.py` → `ml/review-sentiment.json`,
`scripts/nlp_lift.py` → `ml/nlp-lift.json`

- The collector resolves each snapshot production to its Wikipedia article (it must
  be a Broadway production page), extracts the "Critical reception" / "Reception"
  section, and drops sentences that mention awards, grosses or closing, to limit
  leakage.
- VADER (`vaderSentiment`) scores each sentence. Only per-show aggregates (mean
  compound, positive and negative shares, sentence count) and article/revision
  links are committed. Transformer models were considered, but a lightweight
  lexicon model keeps the pipeline reproducible on CI.
- `nlp_lift.py` trains the same models with and without the three sentiment
  features on the same rows and the same time split. It reports AUC lift and MAPE
  change with paired-bootstrap 95% CIs.
- Sentiment is cached, so the weekly workflow does not call Wikipedia.

### Results

<!-- ML-RESULTS:START -->
Measured on the frozen snapshot `grosses_snapshot_20261101.csv` (54,529
show-weeks, 1985-06-09 to 2026-10-25). The test period is 2024-01-01 to 2026-10-25.

| Study | Result |
| --- | --- |
| Tony win vs losing nominees, weeks 1–8 weekly gross (association) | **+30.8%** (95% CI 19.6% to 43.1%); 188 productions (121 winners, 67 losing nominees), 39 ceremonies |
| Design checks | Pre-trend joint p = 0.39; placebo ceremony +3.7% (95% CI −4.9% to +13.0%); winners' grosses were already rising in the four weeks before the ceremony |
| Tony win, capacity | +7.6 points (95% CI 4.7 to 10.4) |
| Next-week gross MAPE | Model **11.84%** vs persistence 13.36% vs seasonal persistence 12.94% (difference vs persistence 95% CI −2.41 to −0.73 points) |
| Closing within 8 weeks, ROC AUC | Model **0.891** vs logistic baseline 0.865 (difference 95% CI 0.001 to 0.060); average precision 0.706 vs 0.584 |
| NLP: closing AUC, numeric vs + sentiment | 0.821 → **0.874** (lift +0.053, 95% CI 0.016 to 0.098), likely inflated by hindsight in Wikipedia text |
| NLP: next-week gross MAPE | 10.62% → 10.55% (change −0.07, 95% CI −0.16 to +0.01, not significant) |
| Drift (latest 8 weeks vs prior 52 snapshot weeks) | PSI: gross 0.09, capacity 0.12, avg ticket 0.06, weekly change 0.08, run age 0.62 (alert); market gross −11.7% vs same weeks last year |

The Tony result is an association, not a clean causal effect: winners are often
the frontrunners, and their grosses were already rising before the ceremony.
<!-- ML-RESULTS:END -->

### Limitations

- Tony winners are not randomly assigned, so the Tony result is an association,
  not a clean causal effect. The DiD controls for level differences and the event
  study checks pre-trends. The pre-period coefficients are jointly insignificant
  but mostly negative, so winners were already gaining slightly before the
  ceremony. Post-ceremony shocks that coincide with winning (for example,
  marketing pushes) cannot be ruled out. Many losing nominees had already closed
  by Tony night, so the control group is smaller and made up of survivors.
- Productions not running on Tony night, or without matched grosses, are excluded.
- Forecast accuracy on 2024 and later is not guaranteed to hold in future
  seasons. Drift monitoring is there to flag this.
- Wikipedia reception sections are written with hindsight and exist mostly for
  notable shows (selection bias). Each show has one static score, and VADER is not
  tuned to theatre criticism. Any NLP lift should be read as an upper bound.

### Run locally

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-ml.txt -r requirements-mlops.txt
.venv\Scripts\python scripts\freeze_grosses_snapshot.py   # one time only
.venv\Scripts\python scripts\collect_wikipedia_reviews.py # occasional, network
.venv\Scripts\python scripts\score_review_sentiment.py
.venv\Scripts\python scripts\tony_causal.py
.venv\Scripts\python scripts\forecast.py
.venv\Scripts\python scripts\nlp_lift.py
.venv\Scripts\python -m unittest discover -s tests -p "test_*.py"
node --test tests/
```

`requirements-mlops.txt` (MLflow) is optional. Without it, the scripts still
write all JSON outputs and skip run logging.

## Data sources & attribution

- **Weekly grosses** are factual box-office figures reported by
  [The Broadway League](https://www.broadwayleague.com). The numbers are collected
  from [Playbill's public grosses page](https://playbill.com/grosses), and credit
  goes to Playbill and The Broadway League.
- **Only factual figures are used:** show, week, gross, attendance, capacity and
  average ticket price. No Playbill article text is stored or used for modeling.
- **Non-commercial:** Theater Spotlight is a portfolio and educational project. It
  is not affiliated with or endorsed by Playbill, The Broadway League, the Tony
  Awards or any production.
- **Removal on request:** if you are a rights holder and want data removed, open an
  issue at <https://github.com/ytp026/ts/issues>. The data will be removed.
- **Review text:** comes only from [Wikipedia](https://en.wikipedia.org) and is
  used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), with
  attribution to Wikipedia contributors. Raw text is cached locally and
  git-ignored. Only derived sentiment scores, with article titles and revision
  links, are committed.
- **Tony Awards** nominations and winners come from
  [The Tony Awards](https://www.tonyawards.com).
