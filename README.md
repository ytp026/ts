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

`.github/workflows/refresh-broadway.yml` runs Tuesday and Thursday at 23:00 UTC
(Thursday retries delayed Tuesday publications), plus manual dispatch. It tests,
acquires, validates, commits only the four data files to the default branch,
then explicitly requests a legacy GitHub Pages build. This explicit rebuild is
necessary because commits made with `GITHUB_TOKEN` do not automatically trigger
Pages builds. Acquisition and publishing failures remain failed Actions runs;
existing data remains available with an overdue warning.

As inspected on 2026-10-06, this repository's Pages configuration is
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

The bundled data was refreshed locally through **2026-10-04**. Local changes
do not update the live site until merged/published. No push or production
deployment was performed during implementation.

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
