---
name: repo-adoption-risk
description: Investigate a GitHub repository before adoption by looking for recurring reliability failures, upgrade risk, data-loss risk, maintainer response patterns, and real-user complaint clusters. Do not treat stars or popularity as proof of quality.
metadata:
  version: 1.0.0
---

# Repo Adoption Risk Scanner

Use this skill when deciding whether to install, adopt, depend on, migrate to, or invest significant time in an open-source project, developer tool, framework, CLI, desktop app, agent, library, or service with a public repository.

The goal is not to decide whether a project is "good" or "bad." The goal is to estimate the practical risk of adopting it today and identify recurring failure patterns that popularity metrics can hide.

## Core principle

Do not use GitHub stars, downloads, social-media enthusiasm, or "open source" status as proxies for reliability.

Prefer longitudinal evidence:

- Does the same class of failure recur across versions?
- Does an upgrade break existing user data or configuration?
- Are fixes later regressed?
- Do users repeatedly need destructive workarounds such as deleting databases, config directories, caches, or session history?
- Are crashes, hangs, corruption, runaway disk/RAM/CPU usage, auth failures, or data loss recurring themes?
- How quickly and effectively do maintainers respond?
- Are the same symptoms reported independently on GitHub, Reddit, forums, Discord archives, Hacker News, Stack Overflow, or other communities?

## Inputs

At minimum obtain:

- Repository URL or project name.
- Intended use if known: casual testing, daily personal use, production dependency, team adoption, security-sensitive use, long-running agent, etc.
- Operating system/platform if relevant.

If the intended use is unknown, perform a general adoption-risk scan rather than blocking on clarification.

## Research procedure

### 1. Establish project identity and current state

Confirm:

- canonical repository and official website/docs;
- license;
- latest stable release and release cadence;
- whether the repo is active, archived, moved, rewritten, or undergoing a major migration;
- major runtime/storage architecture when it affects reliability;
- supported operating systems and installation methods.

Treat forks and old repos carefully. Do not mix bugs from unrelated projects with similar names.

### 2. Search for high-severity failure families

Search the issue tracker, discussions, release notes, and the broader web for variants of these terms:

- crash, panic, freeze, hang, startup failure;
- corrupt, corruption, data loss, lost sessions, missing history;
- database locked, SQLite, migration failed, schema migration;
- upgrade broke, regression, downgrade, rollback;
- disk full, unbounded growth, memory leak, OOM, CPU 100%;
- authentication broken, rate-limit loop, provider failure;
- uninstall/reinstall, delete config, delete database, reset state;
- Windows/macOS/Linux-specific breakage;
- concurrency, race, deadlock;
- repeated network/reconnect loops;
- security incidents if relevant.

Do not stop after finding one issue. Search for related wording and duplicate reports.

### 3. Cluster complaints by failure family

Group reports that appear to share a subsystem or root cause, even if the exact error message differs.

Example families:

- session database / persistence;
- schema migrations / upgrades;
- concurrent-process locking;
- provider/authentication routing;
- updater/install process;
- plugin system;
- context/session recovery;
- memory/disk growth;
- desktop frontend/backend synchronization.

For each family record:

- earliest report found;
- latest report found;
- number of independent reports found;
- affected versions/platforms;
- severity;
- whether a fix exists;
- whether the problem later reappeared;
- common workaround;
- whether the workaround risks data/config loss.

A recurring family across multiple releases is much more important than a large number of unrelated minor bugs.

### 4. Look outside the repository

Search independent user discussions. Prioritize sources where people describe firsthand use.

Useful searches include combinations of:

- `<project> crashes`
- `<project> unstable`
- `<project> broke after update`
- `<project> database`
- `<project> lost data`
- `<project> regret`
- `<project> switched from`
- `<project> problems`
- `<project> workaround`

Search Reddit, Hacker News, Stack Overflow, project forums, public Discord/forum archives where indexed, and blog posts.

Do not reduce this to generic sentiment analysis. Extract concrete symptoms and map them back to failure families.

### 5. Measure maintainer behavior

For serious bug families examine:

- acknowledgement time;
- time to first attempted fix;
- time to confirmed fix/release;
- whether duplicates accumulate for months;
- whether reports are closed without resolution;
- whether maintainers provide migration/recovery tools;
- whether release notes warn users about known breakage;
- whether tests were added to prevent recurrence;
- whether the architecture was changed when patches repeatedly failed.

Fast issue closure is not automatically good. "Closed as duplicate," "stale," or "not planned" without a working resolution should not count as a successful fix.

### 6. Normalize popularity bias

Never conclude that Project A is worse than Project B merely because it has more complaints.

Where possible consider:

- unique reporters rather than raw issue count;
- complaints per active-user/download/star proxy;
- percentage of recent issue traffic represented by severe failures;
- recurrence over time;
- severity weighting;
- cross-source agreement;
- whether the project is unusually complex or young.

If usage numbers are unavailable, say so and lower confidence rather than inventing a denominator.

### 7. Score adoption risk

Produce 0-100 scores where higher is better:

- **Runtime Reliability** — crashes, hangs, resource leaks, basic operation.
- **Data Safety** — corruption, lost history, destructive recovery procedures.
- **Upgrade Safety** — migrations, updater regressions, backward compatibility.
- **Recovery Quality** — backups, repair tooling, diagnostics, graceful recovery.
- **Maintainer Response** — serious-bug handling and regression prevention.
- **Operational Predictability** — consistency across platforms and long sessions.

Also output:

- **Complaint Recurrence:** Low / Medium / High / Severe
- **Evidence Confidence:** Low / Medium / High
- **Adoption Risk:** Low / Moderate / High / Very High

Do not fake mathematical precision. Scores summarize evidence; explain the strongest reasons.

Suggested weighting for a general desktop/developer tool:

- Runtime Reliability: 25%
- Data Safety: 20%
- Upgrade Safety: 20%
- Recovery Quality: 10%
- Maintainer Response: 15%
- Operational Predictability: 10%

Adjust weights when the use case makes another dimension more important.

## Automatic red flags

Escalate the recommendation when any of these are supported by multiple reports:

- data corruption or silent data loss;
- upgrade migrations that strand existing users;
- recurring startup failures requiring deletion of state;
- repeated "database locked" / concurrency failures across releases;
- unbounded disk or memory growth;
- a fix followed by recurrence of the same failure family;
- serious bugs remaining open across many releases with only destructive workarounds;
- maintainers repeatedly blaming unsupported environments that documentation presents as supported;
- security-critical behavior with poor disclosure or recovery.

One isolated report is not enough to trigger a strong conclusion unless independently verified or clearly demonstrated by code/reproduction.

## Positive signals

Actively look for evidence that reduces risk:

- reproducible tests added for previous failures;
- migration tests across old versions;
- automatic DB/config backups before upgrades;
- integrity checks and non-destructive repair tools;
- bounded storage/retention policies;
- rollback support;
- clear known-issues documentation;
- transparent incident postmortems;
- maintainers closing the architectural cause rather than repeatedly patching symptoms;
- long periods without recurrence after a documented fix.

## Security and existing health scores

When available, include but do not substitute:

- OpenSSF Scorecard;
- package vulnerability/maintenance data from reputable services;
- dependency/supply-chain risk tools;
- project/community health metrics.

These are useful dimensions, but a project can have strong security hygiene and still be frustrating or unreliable in normal use.

## Final report format

Start with a compact verdict.

### Adoption verdict

- **Recommendation:** Adopt / Trial cautiously / Wait / Avoid for now
- **Adoption Risk:** Low / Moderate / High / Very High
- **Evidence Confidence:** Low / Medium / High
- **Best fit:** who can reasonably tolerate the risk
- **Avoid if:** what use cases are most exposed

### Scorecard

| Dimension | Score | Why |
|---|---:|---|
| Runtime Reliability | /100 | |
| Data Safety | /100 | |
| Upgrade Safety | /100 | |
| Recovery Quality | /100 | |
| Maintainer Response | /100 | |
| Operational Predictability | /100 | |

### Recurring failure families

For each important family provide:

1. Name of failure family.
2. Severity.
3. Timeline: earliest → latest evidence.
4. Number/type of independent reports found.
5. Versions/platforms affected.
6. Current status.
7. Typical workaround and its cost/risk.
8. Evidence links.

### What users are saying

Summarize recurring firsthand reports without cherry-picking inflammatory quotes. Distinguish concrete technical complaints from subjective dislike.

### Maintainer pattern

Explain whether serious problems appear to be quickly eliminated, repeatedly patched, ignored, or reintroduced.

### Positive evidence

Include meaningful counterevidence. Do not create a prosecution brief.

### Bottom line

Explain in plain language whether adopting the project is likely to save time or create maintenance/debugging work for the stated use case.

## Evidence rules

- Prefer primary sources for technical claims: issue reports, PRs, release notes, commits, documentation.
- Use community posts as supporting evidence of real-world frequency and impact.
- Cite dates and versions whenever possible.
- Distinguish confirmed root cause from plausible correlation.
- Do not call maintainers incompetent, dishonest, malicious, or negligent based on bug reports.
- Do not accuse users of lying or bias. Measure observable patterns instead.
- Include evidence that contradicts the initial hypothesis.
- Do not turn popularity into a quality score.
- Do not recommend avoiding a project solely because it is new.

## Optional comparison mode

When comparing multiple projects, apply the same search window, severity definitions, scoring weights, and evidence standard to all of them.

Rank by expected adoption pain for the user's actual use case, not by stars or feature count.

## Optional watch mode

If the environment supports scheduled monitoring, periodically check for new severe issues in previously identified failure families and alert only when the adoption-risk assessment materially changes.

