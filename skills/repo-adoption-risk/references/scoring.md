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

**category**: `crash`, `hang`, `data-loss`, `upgrade-break`, `api-break`, `install-update`, `performance`, `resource-growth`, `auth-network`, `config-reset`, `ui`, `security`, `other`.

**severity** (what happens to an affected user when it hits):

| Value | Rule |
|---|---|
| `data-loss` | User data, history, or work is destroyed or silently corrupted. A crash that loses unsaved input is `blocks-work`, not `data-loss`. |
| `security` | Credential leak, auth bypass, RCE, or a published advisory. |
| `blocks-work` | User cannot continue the task until a fix/workaround: crash, startup failure, hang, broken core command. |
| `degraded` | Work continues but slower or more annoyingly: wrong output that is noticed, flaky behavior, memory creep that needs a restart. |
| `cosmetic` | Visual glitches, log noise, typos. |

**reach** (who is exposed). Decide from observable proxies, not from how angry the thread sounds:

| Value | Use when | Typical proxies |
|---|---|---|
| `everyone` | Triggers in the **default configuration** on all supported platforms during normal use. | Many reactions/duplicates soon after a release; maintainer says "affects all users"; reproduces on a fresh install. |
| `common` | Triggers in a mainstream workflow most users hit regularly, but not all (e.g. upgrades, the most popular provider, default plugin set). | Steady trickle of reports from different people; not tied to one feature flag. |
| `feature` | Requires a specific feature or workflow. **Set `feature`** to a tag from the list below. | Reports all mention the same feature: migration, resume, plugins, sync, etc. |
| `platform` | Only on some OS/arch/terminal. **Set `platforms`** (e.g. `["windows"]`, `["macos-arm"]`, `["wsl"]`). | All reporters share the platform. |
| `edge` | Unusual configuration, exotic environment, or giant inputs. | One or two reporters; maintainer cannot reproduce. |

Rule of thumb: high reactions alone do not make a bug `everyone`: popular niche bugs exist. Require the default-config check.

**trigger** (while the bug is live, how often an exposed user hits it): `every-use` (every session/run), `daily`, `weekly`, `occasional` (about monthly or random), `once` (one hit per incident, e.g. a one-time upgrade or migration step).

**workaround**: `none` (stuck until a fix ships), `easy` (flag, setting, downgrade one version, retry), `costly` (manual steps, lost time, reinstall), `destructive` (delete database/config/history/cache with user data).

**incidents**: each period the bug was live. A fixed-then-regressed family has two or more incidents. Prefer release tags: `introduced_in` and `fixed_in` are looked up in the collected release list and override `start`/`end`. Otherwise use dates: `start` = first credible report, `end` = fix release date or confirmed-fixed date, `null` = still open. Issue close dates are a weak proxy (issues are closed early, late, or as stale); use them only when nothing better exists.

**evidence weight**: `confirmed: true` (maintainer acknowledged or reproduced) or `reports >= 2` independent reporters gives full weight. A single unconfirmed report counts at 30%.

### Feature tags (reuse these so stored preferences carry across repos)

`data-migration`, `session-resume`, `long-sessions`, `plugins`, `multi-machine-sync`, `remote-ssh`, `custom-providers`, `auth-sso`, `large-repos`, `gpu`, `self-hosting`, `api-programmatic`, `ide-integration`, `terminal-ui`, `multi-user`, `offline`, `i18n`, `upgrade-early`, `import-export`, `voice-audio`.

Invent a new kebab-case tag only when none fit; `rar.mjs score` lists tags it has not seen before so they can be reconciled.

### Other ledger fields

- `searches_run`: approximate number of searches/tool calls spent finding evidence (affects confidence).
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

Bucket A = last 12 months, bucket B = the 12 months before. Each bucket is annualized by how long the project existed in it (minimum 90 days). **Bad days/yr = (2 x A + 1 x B) / 3**, so recent behavior counts double and a project that fixed its problems a year ago is credited.

Worked examples (neutral):
- Hits everyone, every use, blocks work, no workaround, fixed in 2 days, once in the last year: 1 x 1 x 1 x 2 days = 2 in A, rate = 1.3 bad days/yr: **Low**.
- Weekly crash for everyone, open for 6 months: 1 x 1 x 0.15 x 180 = 27 in A, rate = 18: **High**.
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

Scope: if the family's reach is `feature` or `platform`, the flag is **conditional** ("if you use session-resume"). Conditional flags never escalate the neutral verdict; they go in "Avoid if". In the personal verdict they escalate only when the user's stored answer says they use that feature/platform.

Effect: an active **critical** flag sets the risk floor to High. Active **major** flags raise the risk one level (once, not per flag).

### Dimension scores

Pain is grouped by category: **Runtime** (crash, hang, performance, resource-growth, auth-network, ui, other), **Data Safety** (data-loss, config-reset, security), **Upgrade Safety** (upgrade-break, api-break, install-update). Each score = 100 x e^(-bad_days / 10), rounded to 5. Maintainer behavior is reported as measured numbers from `collect` (first response, time to close, not-planned share, hotfix rate), not as a made-up score.

### Confidence

Starts at Medium. **Low** if `collect` data is missing, fewer than 8 searches were run, or more than half of families are single unconfirmed reports. **High** if collect data is present, at least 20 searches were run, the sample was reviewed, and at least 60% of incidents have both ends dated (release tags preferred).

## Manual fallback

If Node 18+ is not available, compute the same formula by hand for the top 3-5 families, show the arithmetic, and set Evidence Confidence one level lower. Say "manual scoring (no Node)" in the report.
