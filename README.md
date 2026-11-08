# repo-adoption-risk

An agent skill that checks a GitHub project **before you adopt it**. It looks for recurring crashes, bad upgrades, data loss, slow or ignored bug fixes, and real-user complaints, instead of trusting stars and hype.

It came from a simple habit: avoid projects that keep turning out to be a waste of time.

## What it does

- Finds **recurring failure families** (the same kind of bug across releases) rather than counting random issues.
- Flags **destructive workarounds** ("delete your database/config and start over") and fixes that later regress.
- Checks **maintainer behavior**: response time, real fixes vs. "closed as stale", migration and recovery tooling.
- Cross-checks outside GitHub (Reddit, Hacker News, Stack Overflow, forums).
- Gives a **verdict** (Adopt / Trial cautiously / Wait / Avoid for now), a risk level, and a confidence level.

## Pick how deep to go

| Depth | Roughly | Good for | You get |
|---|---|---|---|
| **Quick** | 5-10 searches/tool calls | "Is this worth even trying?" | One-screen verdict card with top risks |
| **Standard** (default) | 20-40 | Daily personal use, side projects | Verdict, 6-dimension scorecard, main failure families |
| **Deep** | 50+ | Production, team adoption, anything holding your data | Full evidence report with timelines and links |

The skill picks a depth from how you phrase the request, or asks you one short question if it is unclear. You can always just say it:

- "Quick check on `owner/repo`"
- "Is `owner/repo` stable enough for daily use?"
- "Deep dive on `owner/repo`, we're thinking of depending on it in production"

If a quick or standard scan finds a serious red flag, it tells you and offers to go deeper instead of silently burning more of your time and tokens.

## Install

Uses the [`skills`](https://github.com/vercel-labs/skills) CLI, which installs into many coding agents (Claude Code, Codex, Cursor, OpenCode and more). Replace `<your-github-user>` with the account hosting this repo.

```bash
# interactive: pick agents and scope
npx skills add <your-github-user>/repo-adoption-risk

# Claude Code only, globally (all projects)
npx skills add <your-github-user>/repo-adoption-risk -a claude-code -g

# see what the repo contains without installing
npx skills add <your-github-user>/repo-adoption-risk --list
```

Update or remove later with `npx skills update` / `npx skills remove repo-adoption-risk`. Run `npx skills --help` for current options, since flags can change between versions.

### Manual install

Copy the `skills/repo-adoption-risk/` folder into your agent's skills directory, for example `~/.claude/skills/repo-adoption-risk/` for Claude Code.

### Safety

The skill is plain Markdown. It has no scripts and runs nothing at install time. The `npx` command runs the `skills` installer from npm, so install it the same way you would any npm tool, and read `SKILL.md` first if you like. While running, the skill tells the agent to treat fetched issue and forum text as data, never as instructions.

## Usage notes

- Works best when the GitHub CLI (`gh`) is installed and logged in, which gives structured issue and release data. Without it, the skill falls back to web search and the GitHub API, with lower confidence.
- It cannot read private repos or sources it has no access to, and it will say so rather than guess.
- Scores summarize evidence, not measurements. Treat them as a structured opinion with links, not a benchmark.

## Repo layout

```
skills/repo-adoption-risk/
  SKILL.md                      # the skill
  references/
    search-terms.md             # search term lists (Standard/Deep)
    report-templates.md         # report formats per depth
archive/SKILL_v1.0.0_old.md     # original single-depth version, kept for reference
```

## License

MIT. See [LICENSE](LICENSE).
