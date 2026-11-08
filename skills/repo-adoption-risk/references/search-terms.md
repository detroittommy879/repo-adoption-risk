# Search terms and templates

Load for Standard and Deep scans. Combine terms with the project name; widen with synonyms and duplicate wording. Do not stop after one hit.

## High-severity failure families (issues, discussions, release notes)

- crash, panic, freeze, hang, startup failure, segfault
- corrupt, corruption, data loss, lost sessions, missing history, empty after update
- database locked, SQLite, migration failed, schema migration
- upgrade broke, regression, downgrade, rollback, breaking change, semver
- deprecation, removed API, peer dependency conflict (libraries)
- disk full, unbounded growth, memory leak, OOM, CPU 100%
- authentication broken, token expired loop, rate-limit loop, provider failure
- uninstall/reinstall, delete config, delete database, reset state, nuke cache
- Windows / macOS / Linux-specific breakage, ARM, WSL
- concurrency, race condition, deadlock
- repeated network/reconnect loops, timeouts
- updater failure, installer failure, signature or checksum errors
- security incidents, CVE, disclosure (if relevant)

## Outside-the-repo searches

- `<project> crashes`
- `<project> unstable`
- `<project> broke after update`
- `<project> database`
- `<project> lost data`
- `<project> regret`
- `<project> switched from` / `<project> alternative to`
- `<project> problems`
- `<project> workaround`
- `<project> long running` / `<project> memory`

Where to look: Reddit, Hacker News, Stack Overflow, project forums, indexed Discord/forum archives, blog posts and migration write-ups. Prioritize firsthand accounts. Extract concrete symptoms and map them to failure families instead of doing generic sentiment analysis.

## Issue-tracker sampling checklist

- Open bugs sorted by comments or reactions (what hurts the most people now).
- Closed bugs with labels like `regression`, `data-loss`, `critical` (did fixes stick?).
- Issues closed as stale, duplicate, or not planned (silent non-fixes).
- Titles repeating across releases (same family, different versions).
- First maintainer reply time on the top issues.

## Name collisions

Forks and similarly named repos are common. Confirm the canonical repository and official site first, and never mix bugs from unrelated projects.
