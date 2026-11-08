# Scoring: ledger rules and formula

The model **classifies** evidence into a JSON ledger. The script (`scripts/rar.mjs score`) does **all arithmetic**. This file is the contract between them. Load it for every scan that uses the script, and in manual-fallback mode.

## The ledger

Create it with `rar.mjs init-ledger OWNER/REPO`, then fill `families`. Each family is one recurring failure pattern (same subsystem or root cause), not one issue.

```json
{
  "id": "session-resume-crash",
  "title": "Crash when resuming an old session",
  "category": "crash",
  "severity": "blocks-work",
  "reach": "feature",
  "feature": "session-resume",
  "platforms": [],
  "trigger": "occasional",
  "workaround": "easy",
  "incidents": [
    { "start": "2025-03-01", "end": "2025-03-04", "introduced_in": "v1.2.0", "fixed_in": "v1.2.1" },
    { "start": "2025-09-10", "end": null }
  ],
  "reports": 7,
  "reactions": 40,
  "duplicates": 3,
  "confirmed": true,
  "evidence": ["https://github.com/OWNER/REPO/issues/123"],
  "reach_reason": "Only when resuming sessions older than a day; default flow unaffected."
}
```

### Field rules (pick from the lists; when unsure, pick the milder/narrower option and say why in `reach_reason` or `notes`)

**category**: `crash`, `hang`, `data-loss`, `correctness` (wrong results/output), `upgrade-break`, `api-break`, `install-update`, `performance`, `resource-growth`, `auth-network`, `config-reset`, `ui`, `security`, `other`.

**severity** (what happens to an affected user when it hits):

| Value | Rule |
|---|---|
| `data-loss` | User data or work is destroyed or silently corrupted: files, databases, saved projects, and saved conversation/session history the user expects to keep. A crash that loses unsaved input is `blocks-work`, not `data-loss`. Losing a cache or a draft that is easy to recreate is `degraded`. |
| `security` | Credential leak, auth bypass, RCE, or a published advisory. |
| `blocks-work` | User cannot continue the task until a fix/workaround: crash, startup failure, broken core command, or a hang/slowdown lasting minutes that stops work. |
| `degraded` | Work continues but slower or more annoyingly: wrong or incomplete output (noticed or not, as long as nothing stored is damaged), flaky behavior, memory creep that needs a restart. |
| `cosmetic` | Visual glitches, log noise, typos. |

**reach** (who is exposed). Decide from observable proxies, not from how angry the thread sounds:

| Value | Use when | Typical proxies |
|---|---|---|
| `everyone` | Triggers in the **default configuration** on all supported platforms during normal use. | Many reactions/duplicates soon after a release; maintainer says "affects all users"; reproduces on a fresh install. |
| `common` | Triggers in a mainstream workflow most users hit regularly, but not all (e.g. upgrades, the most popular provider, default plugin set). | Steady trickle of reports from different people; not tied to one feature flag. |
| `feature` | Requires a specific feature or workflow. **Set `feature`** to a tag from the list below. | Reports all mention the same feature: migration, resume, plugins, sync, etc. |
| `platform` | Only on some OS/arch/terminal. **Set `platforms`** (e.g. `["windows"]`, `["macos-arm"]`, `["wsl"]`). | All reporters share the platform. |
| `edge` | Unusual configuration, exotic environment, giant or pathological inputs, rarely used flag combinations. | One or two reporters; maintainer cannot reproduce; needs a contrived input. |

Between `common` and `edge`, ask: would a typical user of this tool plausibly hit it in their first month? Yes → `common`; no → `edge`.

Rule of thumb: high reactions alone do not make a bug `everyone`: popular niche bugs exist. Require the default-config check.

**trigger** (while the bug is live, how often an exposed user hits it): `every-use` (every session/run), `daily`, `weekly`, `occasional` (about monthly or random), `once` (each user hits it at most once per incident, e.g. a one-time upgrade or migration step). A crash on a particular input that users may feed it again is `occasional`, not `once`.

**workaround**: `none` (stuck until a fix ships), `easy` (flag, setting, downgrade one version, retry), `costly` (manual steps, lost time, reinstall), `destructive` (delete database/config/history/cache with user data).

**incidents**: each period the bug was live. A fixed-then-regressed family has two or more incidents. Prefer release tags: `introduced_in` and `fixed_in` are looked up in the collected release list and override `start`/`end`. Otherwise use dates: `start` = first credible report, `end` = fix release date or confirmed-fixed date, `null` = still open. Issue close dates are a weak proxy (issues are closed early, late, or as stale); use them only when nothing better exists.

A fix merged to the main branch but **not released yet** does not end an incident either: users of released versions still hit it. Keep `end: null` and mention the pending fix in `notes`.

Incidents older than the 24-month scoring window are worth recording when they belong to a recurring family: the script ignores time outside the window for bad days, but counts them when deciding whether a family recurred.

An issue closed as stale, duplicate, or "not planned" **without a fix** does not end an incident. Keep it open while newer reports exist; if reports simply stop, end it at the last credible report and say so in `notes`.

**evidence weight**: `confirmed: true` (a maintainer acknowledged it as a real bug, including "it's an upstream bug", or a fix landed) or `reports >= 2` gives full weight. A single unconfirmed report counts at 30%. `reports` counts distinct people, not issues: three issues from one reporter is `reports: 1`.

`reactions` and `duplicates` are not scored directly. They are proxies that help you choose `reach` (and they let a reader check your choice).

### Special cases

- **AI agents misbehaving** (deleting or overwriting files, running commands it was told not to, ignoring instructions): record it as a family like any other bug. Reach: `common` if it can happen with the default approval settings; `feature` with tag `auto-approve` if it needs auto-approve/"yolo"-style modes; `edge` only for genuinely unusual setups. Trigger is usually `occasional`. Severity follows the outcome (`data-loss` if user files are destroyed).
- **Service-side failures** (rate limits, capacity errors, a hosted backend being down) count when the tool depends on that service in its default setup, because users lose the time either way. Use category `auth-network`, and note in `notes` that it is server-side.
- **Model quality complaints** ("answers got worse") are not reliability bugs. Leave them out unless they are concrete, reproducible failures.
- **Process or supply-chain findings** (unpinned CI actions, missing signing, risky release workflow) are not families. Mention them in the report's security notes, not the ledger, unless they caused an actual incident.

### Feature tags (reuse these so stored preferences carry across repos)

`data-migration`, `session-resume`, `long-sessions`, `auto-approve`, `plugins`, `multi-machine-sync`, `remote-ssh`, `custom-providers`, `auth-sso`, `large-repos`, `gpu`, `self-hosting`, `api-programmatic`, `ide-integration`, `terminal-ui`, `multi-user`, `offline`, `i18n`, `upgrade-early`, `import-export`, `voice-audio`.

Invent a new kebab-case tag only when none fit; `rar.mjs score` lists tags it has not seen before so they can be reconciled.

### Other ledger fields

- `searches_run`: number of research tool calls (searches, issue/PR reads, page fetches, `gh` queries), not counting script runs. Affects confidence.
- `sample_reviewed`: `true` if you looked through the collected recent-issue sample and top-reacted list, not only failure-term searches.
- `positives`: list of `{ "signal": "...", "evidence": "url" }` (tests added for past failures, backups before upgrade, repair tools, postmortems, long quiet periods after fixes).
- `sources_unreachable`: list of sources you could not reach.
- `model`: the model/harness that filled the ledger (useful when comparing harnesses).

## The formula (what the script computes)

**Bad days per year** is the headline number: roughly how many days per year a typical user (neutral) or this user (personal) loses to this project's bugs.

For each incident, within each 12-month bucket:

```
pain = reach x severity_weight x workaround_mult x evidence_weight x annoyance x hits
hits = trigger_rate x days_live_in_bucket     (trigger "once": 1 hit if the incident started in the bucket)
```

| Factor | Values |
|---|---|
| severity_weight (bad-day equivalents per hit) | data-loss 5, security 5, blocks-work 1, degraded 0.3, cosmetic 0.05 |
| trigger_rate (hits per live day) | every-use 1, daily 0.7, weekly 0.15, occasional 0.03, once (single hit) |
| reach, neutral | everyone 1, common 0.5, feature 0.15, platform 0.3, edge 0.03 |
| reach, personal | feature: uses yes 1 / sometimes 0.5 / no 0.02; platform: listed 1 / not listed 0.02; unknown answers fall back to neutral |
| workaround_mult | none 1, easy 0.4, costly 0.8, destructive 1.5 |
| evidence_weight | confirmed or >= 2 reports: 1; otherwise 0.3 |
| annoyance (personal only) | low 0.5, normal 1, high 2 (data-loss and security never below 1) |

Bucket A = last 12 months, bucket B = the 12 months before. **Bad days/yr = (2 x A + 1 x B) / 3**, so recent behavior counts double and a project that fixed its problems a year ago is credited. For a project that existed the whole two years, A and B are just the pain summed inside each 12-month window. For a younger project, a bucket's pain is scaled by 365 / (days the project existed in that bucket, minimum 90), and a bucket before the project existed is dropped (so a 4-month-old project uses A alone).

Worked examples (neutral, project older than two years, so B is 0 when nothing happened in it):
- Hits everyone, every use, blocks work, no workaround, fixed in 2 days, once in the last year: A = 1 x 1 x 1 x (1 hit/day x 2 days) = 2, B = 0, rate = (2 x 2 + 0) / 3 = 1.3 bad days/yr: **Low**.
- Weekly crash for everyone, open for 6 months, no workaround: 1 x 1 x 0.15 x 180 = 27 in A, rate = 18: **High**, and because it is still open with no workaround (an active major red flag) the verdict becomes **Very High**. With an easy workaround (just restart) it is 0.4 x 27 = 10.8, rate = 7.2: **Moderate**, no flag.
- Session-resume crash, occasional, open all year: 0.15 x 1 x 0.03 x 365 = 1.6 in A: barely registers neutrally, and drops to ~0.2 for someone who never resumes sessions.

### Risk level

| Bad days/yr | Adoption Risk |
|---|---|
| < 4 | Low |
| 4 - 12 | Moderate |
| 12 - 30 | High |
| >= 30 | Very High |

### Red flags (gated, can soften)

A family is a **red-flag candidate** if severity is `data-loss` or `security` (**critical**), or if severity is `blocks-work` with workaround `none` or `destructive` and reach `everyone` or `common` (**major**). It must also have full evidence weight.

A candidate is **active** only if it is current: an incident is still open, or it recurred (two or more incidents, at least one in the last 12 months), or its only incident ended in the last 12 months **and** took more than 14 days to fix.

A candidate that was **fixed within 14 days and has not recurred** becomes a *resolved note*: listed, never escalates.

Scope: if the family's reach is `feature`, `platform` or `edge`, the flag is **conditional** ("if you use session-resume", "on windows", "unusual setups only"). Conditional flags never escalate the neutral verdict; report them under Red flags and in "Avoid if". In the personal verdict, feature and platform flags escalate only when the user's stored answer says they use that feature/platform; edge flags never escalate.

Effect: an active **critical** flag sets the risk floor to High. Active **major** flags raise the risk one level (once, not per flag).

### Dimension scores

Pain is grouped by category: **Runtime** (crash, hang, correctness, performance, resource-growth, auth-network, ui, other), **Data Safety** (data-loss, config-reset, security), **Upgrade Safety** (upgrade-break, api-break, install-update). Each score = 100 x e^(-bad_days / 10), rounded to 5. Maintainer behavior is reported as measured numbers from `collect` (first response, time to close, not-planned share, hotfix rate), not as a made-up score.

### Confidence

Starts at Medium. **Low** if `collect` data is missing, fewer than 8 searches were run, or more than half of families are single unconfirmed reports. **High** if collect data is present, at least 20 searches were run, the sample was reviewed, and at least 60% of incidents have both ends dated (release tags preferred).

## Manual fallback

If Node 18+ is not available, compute the same formula by hand for the top 3-5 families, show the arithmetic, and set Evidence Confidence one level lower. Say "manual scoring (no Node)" in the report.
