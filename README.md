# repo-adoption-risk

An agent skill that checks a GitHub project **before you adopt it**. Instead of trusting stars and hype, it estimates how much time the project's bugs are likely to cost you: who each bug hits, how often, how bad it is, and how fast it gets fixed.

It came from a simple habit: avoid projects that keep turning out to be a waste of time.

## What it does

- Reports **bad days per year**: roughly how many days a year a typical user (and, once it knows a bit about you, *you*) loses to the project's bugs.
- Weighs each bug by **reach** (everyone, a common workflow, one feature, one OS), **frequency** (every use, daily, weekly, occasionally, once), **severity**, **workaround cost**, and **how long it stayed unfixed**. A bug that hits everyone once a year and is fixed in two days barely registers; a weekly crash left open for months dominates.
- Finds **recurring failure families** (the same kind of bug across releases) and flags destructive workarounds ("delete your database and start over").
- **Red flags can soften.** A serious bug that was fixed fast and never came back is listed as a resolved note, not an escalation. Bugs that only hit a feature or OS you don't use become "avoid if" notes instead of raising the verdict.
- Measures maintainer behavior from GitHub data (first reply time, time to close, "not planned" share, hotfix rate) instead of guessing.
- Gives a **verdict** (Adopt / Trial cautiously / Wait / Avoid for now), a risk level, and a confidence level.

### Why v3

v2 asked the model to read issues and score in its head. Since every mature project has dozens of issues mentioning "crash" or "regression" (ripgrep, fzf, jq and bat all do), scans tended to land on High no matter what. v3 splits the work: the model **classifies** evidence into a small JSON ledger using written rules, and a bundled script does **all the counting and math**. The same ledger always gets the same score, so results are comparable across models and harnesses, and you can see exactly which classification drove a verdict. v2 is kept in `archive/` if you want to compare.

## Pick how deep to go

| Depth | Roughly | Good for | You get |
|---|---|---|---|
| **Quick** | 5-10 searches/tool calls | "Is this worth even trying?" | One-screen verdict card |
| **Standard** (default) | 20-40 | Daily personal use, side projects | Verdict, what drives it, red flags, maintainer numbers |
| **Deep** | 50+ | Production, team adoption, anything holding your data | Full evidence report with timelines and links |

Just say it: "Quick check on `owner/repo`", "Is `owner/repo` stable enough for daily use?", "Deep dive on `owner/repo`, we're thinking of depending on it in production".

## Personal results without a setup questionnaire

There is no up-front survey. After a scan, the skill may ask up to three questions **about what that scan found**, for example "Do you use session resume?" when a resume bug is driving the score. Your answers are stored and reused on later scans of any repo, or saved for one project only if you say so (usage differs between projects).

Every report keeps the **neutral** verdict, which never reads your preferences, next to a **personal** one, so you can always see both. Preferences are stored only from your explicit answers, never inferred from repo content.

Manage them yourself any time:

```bash
node <skill-folder>/scripts/rar.mjs prefs show
node <skill-folder>/scripts/rar.mjs prefs set feature.session-resume no
node <skill-folder>/scripts/rar.mjs prefs set feature.plugins yes --repo owner/repo
node <skill-folder>/scripts/rar.mjs prefs unset feature.session-resume
```

## Install

Uses the [`skills`](https://github.com/vercel-labs/skills) CLI, which installs into many coding agents (Claude Code, Codex, Cursor, OpenCode and more).

```bash
# interactive: pick agents and scope
npx skills add detroittommy879/repo-adoption-risk

# Claude Code only, globally (all projects)
npx skills add detroittommy879/repo-adoption-risk -a claude-code -g

# see what the repo contains without installing
npx skills add detroittommy879/repo-adoption-risk --list
```

Update or remove later with `npx skills update` / `npx skills remove repo-adoption-risk`. Run `npx skills --help` for current options.

### Manual install

Copy the `skills/repo-adoption-risk/` folder into your agent's skills directory, for example `~/.claude/skills/repo-adoption-risk/` for Claude Code.

### Requirements

- **Node.js 18+** for the scoring script (already present if you installed with `npx`). No npm packages.
- **GitHub CLI (`gh`)**, logged in, is strongly recommended. Without it the script uses the public GitHub API (set `GH_TOKEN` for a usable rate limit) and skips the response-time sample.
- Without Node, the skill falls back to scoring by hand with the same formula and says so, with lower confidence.

## Safety: what the script does

`scripts/rar.mjs` is a single readable file with no dependencies. Nothing runs at install time; the agent runs it during a scan.

- **Reads:** public GitHub data for the repo being scanned (repo info, releases, issue counts and a sample of recent issues), via `gh` or `api.github.com`. No other network access.
- **Writes:** only in its data directory: scan data, ledgers and scores under `scans/`, plus `prefs.json` and `prefs-history.jsonl`. It never writes inside the skill folder or your project. If the data directory is not writable (some sandboxes), it falls back to the OS temp folder and says so.
- **Data directory:** `$REPO_ADOPTION_RISK_HOME` if set, else `$XDG_CONFIG_HOME/repo-adoption-risk`, else `~/.config/repo-adoption-risk` (on Windows, `C:\Users\<you>\.config\repo-adoption-risk`). Run `rar.mjs where` to print it. Deleting the folder resets everything.
- The skill tells the agent to treat fetched issue and forum text as data, never as instructions, and to change preferences only from your direct answers.

## How the score works

Details and the full rule set are in [`references/scoring.md`](skills/repo-adoption-risk/references/scoring.md). In short:

```
bad days/yr  =  sum over bugs of  reach x severity x workaround x evidence x (hits while live)
risk         =  Low < 4  ·  Moderate 4-12  ·  High 12-30  ·  Very High 30+
```

The last 12 months count double compared with the 12 before, so projects that cleaned up get credit. These weights are a structured opinion, not a measurement. They are written down, tested, and the same for every project.

## Repo layout

```
skills/repo-adoption-risk/
  SKILL.md                      # the skill
  scripts/rar.mjs               # collector + scorer + preferences (Node, no deps)
  references/
    scoring.md                  # ledger rules and formula (the model/script contract)
    search-terms.md             # search term lists (Standard/Deep)
    report-templates.md         # report formats per depth
tests/rar.test.mjs              # scenario tests: node --test tests/rar.test.mjs
archive/                        # v1 and v2 SKILL.md, kept for comparison
```

## License

MIT. See LICENSE file.
