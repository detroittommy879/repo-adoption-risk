// Run: node --test tests/
// Synthetic fixtures only. They pin the scenarios the scoring is meant to get right.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreLedger, validateLedger, setPref, unsetPref, emptyPrefs, effectivePrefs, normalizeRepo, renderScore,
} from '../skills/repo-adoption-risk/scripts/rar.mjs';

const TODAY = '2026-11-08';

function ledger(families, extra = {}) {
  return {
    schema: 'rar-ledger/1', repo: 'example/project', scanned_at: TODAY, depth: 'standard',
    project_created: '2020-01-01', searches_run: 25, sample_reviewed: true, families, positives: [], ...extra,
  };
}

function fam(over) {
  return {
    id: 'f1', title: 'Some failure', category: 'crash', severity: 'blocks-work', reach: 'everyone',
    trigger: 'every-use', workaround: 'none', incidents: [], reports: 5, confirmed: true,
    evidence: ['https://example.invalid/1'], reach_reason: 'default config', ...over,
  };
}

const score = (l, opts = {}) => {
  const r = scoreLedger(l, { today: TODAY, collect: { meta: { created_at: '2020-01-01' }, releases: [] }, ...opts });
  assert.ok(r.ok, JSON.stringify(r.errors));
  return r;
};

test('rare bug that hits everyone but is fixed in 2 days is Low (and its flag softens to a note)', () => {
  const r = score(ledger([fam({ incidents: [{ start: '2026-05-01', end: '2026-05-03' }] })]));
  assert.equal(r.neutral.risk, 'Low');
  assert.ok(r.neutral.badDaysPerYear < 2, `got ${r.neutral.badDaysPerYear}`);
  assert.equal(r.families[0].flag.status, 'resolved-fast');
  assert.deepEqual(r.neutral.escalation, []);
});

test('weekly crash for everyone, open six months, no workaround: High base, escalated by the active flag', () => {
  const r = score(ledger([fam({ trigger: 'weekly', incidents: [{ start: '2026-05-12', end: null }] })]));
  assert.equal(r.neutral.baseRisk, 'High');
  assert.equal(r.families[0].flag.status, 'active');
  assert.equal(r.neutral.risk, 'Very High');
});

test('same weekly crash with an easy workaround (restart) is Moderate and not a red flag', () => {
  const r = score(ledger([fam({ trigger: 'weekly', workaround: 'easy', incidents: [{ start: '2026-05-12', end: null }] })]));
  assert.equal(r.neutral.risk, 'Moderate');
  assert.equal(r.families[0].flag, null);
});

test('a project that keeps shipping daily everyone-bugs is High or worse', () => {
  const months = ['2025-01', '2025-04', '2025-08', '2025-11', '2026-01', '2026-04', '2026-07', '2026-10'];
  const fams = months.map((m, i) => fam({ id: `f${i}`, severity: 'degraded', trigger: 'daily', workaround: 'none', incidents: [{ start: `${m}-01`, end: `${m}-28` }] }));
  const r = score(ledger(fams));
  assert.ok(['High', 'Very High'].includes(r.neutral.risk), `got ${r.neutral.risk} (${r.neutral.badDaysPerYear})`);
});

const migration = () => ledger([fam({
  id: 'migrate-loss', category: 'data-loss', severity: 'data-loss', reach: 'feature', feature: 'data-migration',
  trigger: 'once', incidents: [{ start: '2026-03-01', end: null }],
})]);

test('migration-only data loss: neutral Low with a conditional flag, asks the user', () => {
  const r = score(migration());
  assert.equal(r.neutral.risk, 'Low');
  assert.equal(r.families[0].flag.conditional, true);
  assert.equal(r.families[0].flag.status, 'active');
  assert.equal(r.questions[0].key, 'feature.data-migration');
});

test('migration-only data loss: user who never migrates stays Low, user who migrates gets High', () => {
  const no = setPref(emptyPrefs(), 'feature.data-migration', 'no', { today: new Date(TODAY) });
  const rNo = score(migration(), { prefs: no });
  assert.equal(rNo.personal.risk, 'Low');
  assert.ok(rNo.personal.badDaysPerYear < 0.2);
  const yes = setPref(emptyPrefs(), 'feature.data-migration', 'yes', { today: new Date(TODAY) });
  const rYes = score(migration(), { prefs: yes });
  assert.equal(rYes.personal.risk, 'High');
  assert.equal(rYes.neutral.risk, 'Low', 'neutral verdict must not read preferences');
  assert.equal(rYes.questions.length, 0);
});

test('recurring data loss for common users escalates to at least High', () => {
  const r = score(ledger([fam({
    category: 'data-loss', severity: 'data-loss', reach: 'common', trigger: 'occasional',
    incidents: [{ start: '2025-02-01', end: '2025-03-01' }, { start: '2026-04-01', end: '2026-05-01' }],
  })]));
  assert.equal(r.neutral.baseRisk, 'Low');
  assert.equal(r.neutral.risk, 'High');
});

test('rare open data loss for common users: small bad-days number, but the critical flag floors it at High', () => {
  const r = score(ledger([fam({ category: 'data-loss', severity: 'data-loss', reach: 'common', trigger: 'rare', workaround: 'destructive', incidents: [{ start: '2025-07-25', end: null }] })]));
  assert.equal(r.neutral.baseRisk, 'Moderate');
  assert.equal(r.neutral.risk, 'High');
});

test('Quick depth needs fewer searches before confidence drops to Low', () => {
  const r = score(ledger([], { depth: 'quick', searches_run: 5, sample_reviewed: false }));
  assert.equal(r.confidence.level, 'Medium');
});

test('old data-loss bug fixed slowly two years ago and never seen again does not escalate', () => {
  const r = score(ledger([fam({ category: 'data-loss', severity: 'data-loss', reach: 'common', trigger: 'occasional', incidents: [{ start: '2024-09-01', end: '2024-12-01' }] })]));
  assert.equal(r.families[0].flag.status, 'historical');
  assert.equal(r.neutral.risk, 'Low');
});

test('Windows-only bug: High neutrally, Low for a macOS user', () => {
  const l = ledger([fam({ reach: 'platform', platforms: ['windows'], trigger: 'daily', incidents: [{ start: '2026-04-22', end: null }] })]);
  const prefs = setPref(emptyPrefs(), 'platform', 'macos', { today: new Date(TODAY) });
  const r = score(l, { prefs });
  assert.equal(r.neutral.risk, 'High');
  assert.equal(r.personal.risk, 'Low');
});

test('single unconfirmed report counts at 30% and never raises a flag', () => {
  const r = score(ledger([fam({ category: 'data-loss', severity: 'data-loss', reports: 1, confirmed: false, incidents: [{ start: '2026-10-01', end: null }] })]));
  assert.equal(r.families[0].flag, null);
  assert.equal(r.families[0].evidenceWeight, 0.3);
});

test('clean project with a broad search is Low with High confidence', () => {
  const r = score(ledger([]));
  assert.equal(r.neutral.risk, 'Low');
  assert.equal(r.confidence.level, 'High');
});

test('missing collect data or few searches gives Low confidence', () => {
  const r = scoreLedger(ledger([], { searches_run: 3 }), { today: TODAY });
  assert.equal(r.confidence.level, 'Low');
});

test('release tags override issue dates', () => {
  const collect = { meta: { created_at: '2020-01-01' }, releases: [{ tag: 'v1.2.0', date: '2026-02-01T00:00:00Z' }, { tag: 'v1.2.1', date: '2026-02-11T00:00:00Z' }] };
  const r = scoreLedger(ledger([fam({ incidents: [{ start: '2026-02-05', end: '2026-03-20', introduced_in: '1.2.0', fixed_in: 'v1.2.1' }] })]), { today: TODAY, collect });
  assert.equal(r.families[0].incidents[0].start, '2026-02-01');
  assert.equal(r.families[0].incidents[0].end, '2026-02-11');
  assert.equal(r.families[0].incidents[0].dated_by, 'release/release');
});

test('young project is annualized over its real age', () => {
  const l = ledger([fam({ workaround: 'easy', incidents: [{ start: '2026-08-01', end: '2026-08-31' }] })], { project_created: '2026-07-11' });
  const r = scoreLedger(l, { today: TODAY, collect: { meta: { created_at: '2026-07-11' }, releases: [] } });
  assert.equal(r.buckets[1].included, false);
  assert.ok(r.neutral.badDaysPerYear > 30, `got ${r.neutral.badDaysPerYear}`);
});

test('validation catches bad enums and missing feature tags', () => {
  const { errors } = validateLedger(ledger([fam({ severity: 'terrible', reach: 'feature', incidents: [{ start: '2026-01-01' }] })]));
  assert.ok(errors.some((e) => e.includes('severity must be one of')));
  assert.ok(errors.some((e) => e.includes('needs a "feature" tag')));
  assert.ok(errors.some((e) => e.includes('needs end')));
});

test('repo-scoped preference overrides the global one', () => {
  let p = setPref(emptyPrefs(), 'feature.session-resume', 'no', { today: new Date(TODAY) });
  p = setPref(p, 'feature.session-resume', 'yes', { repo: 'example/project', today: new Date(TODAY) });
  assert.equal(effectivePrefs(p, 'example/project').feature('session-resume').value, 'yes');
  assert.equal(effectivePrefs(p, 'other/repo').feature('session-resume').value, 'no');
  p = unsetPref(p, 'feature.session-resume', { repo: 'example/project' });
  assert.equal(effectivePrefs(p, 'example/project').feature('session-resume').value, 'no');
});

test('annoyance cannot lower data-loss weight', () => {
  const p = setPref(emptyPrefs(), 'annoy.data-loss', 'low', { today: new Date(TODAY) });
  const l = ledger([fam({ category: 'data-loss', severity: 'data-loss', reach: 'common', trigger: 'occasional', incidents: [{ start: '2026-06-01', end: '2026-06-30' }] })]);
  const r = score(l, { prefs: p });
  assert.equal(r.personal.badDaysPerYear, r.neutral.badDaysPerYear);
});

test('repo names normalize from URLs', () => {
  assert.equal(normalizeRepo('https://github.com/BurntSushi/ripgrep.git'), 'BurntSushi/ripgrep');
  assert.equal(normalizeRepo('BurntSushi/ripgrep'), 'BurntSushi/ripgrep');
});

test('report renders both columns when preferences were used', () => {
  const prefs = setPref(emptyPrefs(), 'feature.data-migration', 'no', { today: new Date(TODAY) });
  const text = renderScore(score(migration(), { prefs }));
  assert.match(text, /\| \| Neutral \| Personal \|/);
  assert.match(text, /CONDITIONAL critical \(if you use data-migration\)/);
});
