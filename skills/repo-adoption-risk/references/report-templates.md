# Report templates

State the chosen depth first: `Depth: Quick | Standard | Deep` (and "assumed" if it was defaulted).

## Quick: verdict card

```
Depth: Quick
Project: <name> (<repo link>)   Last release: <version, date>   License: <x>

Recommendation: Adopt / Trial cautiously / Wait / Avoid for now
Adoption Risk: Low / Moderate / High / Very High
Evidence Confidence: Low / Medium / High

Top risks:
1. <risk> - <one line> (<link>)
2. <risk> - <one line> (<link>)
3. <optional>

In its favor: <one concrete positive signal>
Avoid if: <use cases most exposed>
Want more? Say "standard" or "deep" and I'll continue from here.
```

## Standard

### Adoption verdict
- **Depth:** Standard
- **Recommendation:** Adopt / Trial cautiously / Wait / Avoid for now
- **Adoption Risk:** Low / Moderate / High / Very High
- **Evidence Confidence:** Low / Medium / High
- **Complaint Recurrence:** Low / Medium / High / Severe
- **Best fit:** who can reasonably tolerate the risk
- **Avoid if:** which use cases are most exposed

### Scorecard
| Dimension | Score | Why |
|---|---:|---|
| Runtime Reliability | /100 | |
| Data Safety | /100 | |
| Upgrade Safety | /100 | |
| Recovery Quality | /100 | |
| Maintainer Response | /100 | |
| Operational Predictability | /100 | |

### Top failure families
One or two lines each: name, severity, time span, number of independent reports, status, workaround and its cost, link.

### Maintainer pattern
A few sentences: quickly eliminated, repeatedly patched, ignored, or reintroduced.

### Positive evidence
Meaningful counterevidence.

### Bottom line
Plain-language: will adopting this save time or create maintenance/debugging work for the stated use case?

## Deep

Use the Standard structure, with these additions.

### Recurring failure families (detailed)
For each important family:

1. Name
2. Severity
3. Timeline: earliest -> latest evidence
4. Number/type of independent reports
5. Versions/platforms affected
6. Current status
7. Typical workaround and its cost/risk
8. Evidence links (primary sources first)

### What users are saying
Summarize recurring firsthand reports without cherry-picking inflammatory quotes. Separate concrete technical complaints from subjective dislike.

### Governance and sustainability
Bus factor, active maintainers, funding or org backing, release discipline, contributor turnover.

### Security and health data
OpenSSF Scorecard, advisories, dependency risk, if available. Note that these supplement, not replace, reliability evidence.

### Method and limits
Sources searched, time window, sources that could not be reached, what would change the verdict.
