# Report templates

State the chosen depth first: `Depth: Quick | Standard | Deep` (add "assumed" if it was defaulted). Copy the Adoption Risk, bad days per year, red flags and Evidence Confidence from `rar.mjs score` exactly. Add a `Model override:` line only if you disagree, with the evidence.

## Quick: verdict card

```
Depth: Quick
Project: <name> (<repo link>)   Last release: <version, date>   License: <x>

Recommendation: Adopt / Trial cautiously / Wait / Avoid for now
Adoption Risk: <script>  (~<N> bad days/yr for a typical user; personal: <level, N> if preferences exist)
Evidence Confidence: <script>

What drives it:
1. <family> - <severity, who it hits, how often, how long it was live> (<link>)
2. <family> - ... (<link>)

Red flags: <active flags from the script, or "none active">
In its favor: <one concrete positive signal>
Avoid if: <conditional flags / feature- or platform-specific families>
Want more? Say "standard" or "deep" and I'll continue from here.
```

## Standard

### Adoption verdict
- **Depth:** Standard
- **Recommendation:** Adopt / Trial cautiously / Wait / Avoid for now
- **Adoption Risk:** neutral <level> (<N> bad days/yr); personal <level> (<N>) if preferences exist
- **Trend:** last 12 months vs the 12 before (improving / steady / worsening)
- **Evidence Confidence:** <level and the script's reasons>
- **Best fit:** who can reasonably tolerate the risk
- **Avoid if:** use cases most exposed (conditional flags, feature- and platform-specific families)

### What drives the number
The script's family table (top families: severity, reach, trigger, live periods, bad days/yr). One line of plain-language context per family, with a link.

### Red flags
Active flags, conditional flags, and resolved notes exactly as the script lists them.

### Maintainer pattern
A few sentences using the measured numbers (first reply, time to close, not-planned share, hotfix rate, release cadence) plus what you saw: fixed at the root, repeatedly patched, ignored, or reintroduced.

### Positive evidence
Meaningful counterevidence.

### Bottom line
Plain language: will adopting this save time or create maintenance/debugging work for the stated use case?

### Questions (optional, after the report)
Up to 3 questions from the script's list, about features this repo's bugs depend on. Store answers with `prefs set`.

## Deep

Use the Standard structure, with these additions.

### Recurring failure families (detailed)
For each important family: name; severity, reach and trigger with the reasoning; timeline (each incident, dated by release where possible); number and type of independent reports; versions/platforms affected; current status; typical workaround and its cost/risk; evidence links (primary sources first).

### What users are saying
Recurring firsthand reports, without cherry-picking inflammatory quotes. Separate concrete technical complaints from subjective dislike.

### Governance and sustainability
Bus factor, active maintainers, funding or org backing, release discipline, contributor turnover.

### Security and health data
OpenSSF Scorecard, advisories, dependency risk, if available. These supplement, not replace, reliability evidence.

### Method and limits
Sources searched, time window, sources that could not be reached, ledger path, what would change the verdict.
