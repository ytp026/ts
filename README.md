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
