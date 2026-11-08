#!/usr/bin/env node
// repo-adoption-risk helper (rar): collect GitHub data, validate and score an evidence ledger,
// and store the user's preferences. Zero dependencies; needs Node.js 18+.
//
// Reads:  GitHub, through the `gh` CLI if it is installed and logged in, otherwise the public
//         REST API (GH_TOKEN / GITHUB_TOKEN used if set). Nothing else on the network.
// Writes: only under the data directory (`rar.mjs where`), falling back to the OS temp dir if
//         that is not writable. Never writes inside the skill folder or the current project.
// The formula and ledger rules are documented in ../references/scoring.md.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const VERSION = '3.0.0';
const DAY = 86400000;

// ---------------------------------------------------------------- constants (see scoring.md)

export const ENUMS = {
  category: ['crash', 'hang', 'data-loss', 'correctness', 'upgrade-break', 'api-break', 'install-update', 'performance',
    'resource-growth', 'auth-network', 'config-reset', 'ui', 'security', 'other'],
  severity: ['data-loss', 'security', 'blocks-work', 'degraded', 'cosmetic'],
  reach: ['everyone', 'common', 'feature', 'platform', 'edge'],
  trigger: ['every-use', 'daily', 'weekly', 'occasional', 'rare', 'once'],
  workaround: ['none', 'easy', 'costly', 'destructive'],
};

export const W = {
  severity: { 'data-loss': 5, security: 5, 'blocks-work': 1, degraded: 0.3, cosmetic: 0.05 },
  trigger: { 'every-use': 1, daily: 0.7, weekly: 0.15, occasional: 0.03, rare: 0.004, once: null },
  reach: { everyone: 1, common: 0.5, feature: 0.15, platform: 0.3, edge: 0.03 },
  personalFeature: { yes: 1, sometimes: 0.5, no: 0.02 },
  platformMatch: 1,
  platformMiss: 0.02,
  workaround: { none: 1, easy: 0.4, costly: 0.8, destructive: 1.5 },
  weakEvidence: 0.3,
  annoyance: { low: 0.5, normal: 1, high: 2 },
  fastFixDays: 14,
};

export const LEVELS = ['Low', 'Moderate', 'High', 'Very High'];
export const THRESHOLDS = [4, 12, 30]; // bad days per year: <4 Low, <12 Moderate, <30 High, else Very High
export const RECOMMENDATION = { Low: 'Adopt', Moderate: 'Trial cautiously', High: 'Wait', 'Very High': 'Avoid for now' };

export const FEATURE_TAGS = {
  'data-migration': 'migrating or importing data, including major-version migrations',
  'session-resume': 'resuming or restoring earlier sessions/conversations',
  'long-sessions': 'very long-running sessions or processes',
  'auto-approve': 'letting an AI agent run commands/edits without asking (auto-approve, "yolo" modes)',
  plugins: 'plugins, extensions, MCP servers or add-ons',
  'multi-machine-sync': 'syncing across machines or cloud sync',
  'remote-ssh': 'remote development, SSH, containers or WSL',
  'custom-providers': 'custom or self-hosted model/API providers and endpoints',
  'auth-sso': 'SSO, enterprise auth or corporate proxies',
  'large-repos': 'very large repos, files or datasets',
  gpu: 'GPU / CUDA / hardware acceleration',
  'self-hosting': 'running the server yourself (docker, deploys)',
  'api-programmatic': 'using it as a library, SDK or API',
  'ide-integration': 'the editor/IDE extension',
  'terminal-ui': 'the terminal UI specifically',
  'multi-user': 'teams, shared workspaces, multiple users',
  offline: 'offline use',
  i18n: 'non-English input, locales or keyboard layouts',
  'upgrade-early': 'upgrading soon after each release',
  'import-export': 'import/export or backup/restore features',
  'voice-audio': 'voice or audio features',
};

const BOT_RE = /\[bot\]$|^(github-actions|dependabot|renovate|stale|allcontributors)$/i;
const SEVERE_TITLE_RE = /\b(crash|crashes|crashing|panic|segfault|freez|hang|hangs|data loss|lost|corrupt|deleted|wiped|broke|broken|regression|won'?t start|fails? to start|cannot start|unusable)/i;

// ---------------------------------------------------------------- small helpers

export function parseDate(v) {
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const iso = (d) => d.toISOString().slice(0, 10);
const round = (x, p = 1) => Math.round(x * 10 ** p) / 10 ** p;
const round5 = (x) => Math.max(0, Math.min(100, Math.round(x / 5) * 5));
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const overlapDays = (s, e, bs, be) => Math.max(0, (Math.min(e, be) - Math.max(s, bs)) / DAY);

export function normalizeRepo(input) {
  if (!input) return null;
  const m = String(input).trim().replace(/\.git$/, '').match(/(?:github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
const slug = (repo) => repo.replace('/', '__');

// ---------------------------------------------------------------- storage

export function dataHome(env = process.env) {
  if (env.REPO_ADOPTION_RISK_HOME) return path.resolve(env.REPO_ADOPTION_RISK_HOME);
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'repo-adoption-risk');
}

// Best effort: never let a storage failure break a scan.
function writeJson(file, obj, notes) {
  const body = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  } catch (e) {
    const alt = path.join(os.tmpdir(), 'repo-adoption-risk', path.basename(path.dirname(file)), path.basename(file));
    try {
      fs.mkdirSync(path.dirname(alt), { recursive: true });
      fs.writeFileSync(alt, body);
      notes.push(`Could not write ${file} (${e.code || e.message}); wrote ${alt} instead. Set REPO_ADOPTION_RISK_HOME to a writable folder to keep scans.`);
      return alt;
    } catch {
      notes.push(`Could not save ${path.basename(file)} anywhere (${e.code || e.message}); continuing without saving.`);
      return null;
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

// ---------------------------------------------------------------- validation

export function validateLedger(L) {
  const errors = [];
  const warnings = [];
  if (!L || typeof L !== 'object' || Array.isArray(L)) return { errors: ['ledger is not a JSON object'], warnings };
  if (!normalizeRepo(L.repo)) errors.push('repo is required (OWNER/REPO)');
  if (L.scanned_at && !parseDate(L.scanned_at)) errors.push('scanned_at is not a date (YYYY-MM-DD)');
  if (!Array.isArray(L.families)) {
    errors.push('families must be an array (an empty array is fine)');
    return { errors, warnings };
  }
  const ids = new Set();
  L.families.forEach((f, i) => {
    const at = `families[${i}]${f && f.id ? ` (${f.id})` : ''}`;
    if (!f || typeof f !== 'object') { errors.push(`${at}: not an object`); return; }
    if (!f.id) errors.push(`${at}: id is required`);
    else if (ids.has(f.id)) errors.push(`${at}: duplicate id`);
    else ids.add(f.id);
    for (const k of Object.keys(ENUMS)) {
      if (!ENUMS[k].includes(f[k])) errors.push(`${at}: ${k} must be one of ${ENUMS[k].join(', ')} (got ${JSON.stringify(f[k])})`);
    }
    if (f.reach === 'feature' && !f.feature) errors.push(`${at}: reach "feature" needs a "feature" tag (see FEATURE_TAGS in scoring.md)`);
    if (f.feature && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.feature)) errors.push(`${at}: feature tag must be kebab-case`);
    if (f.reach === 'platform' && !(Array.isArray(f.platforms) && f.platforms.length)) errors.push(`${at}: reach "platform" needs "platforms": ["windows", ...]`);
    if (!Number.isInteger(f.reports) || f.reports < 1) errors.push(`${at}: reports must be an integer >= 1`);
    if (!Array.isArray(f.incidents) || !f.incidents.length) {
      errors.push(`${at}: incidents must list at least one live period`);
    } else {
      f.incidents.forEach((inc, j) => {
        const ia = `${at}.incidents[${j}]`;
        if (!inc || typeof inc !== 'object') { errors.push(`${ia}: not an object`); return; }
        if (!inc.start && !inc.introduced_in) errors.push(`${ia}: needs start (YYYY-MM-DD) or introduced_in (release tag)`);
        if (inc.start && !parseDate(inc.start)) errors.push(`${ia}: start is not a date`);
        if (!('end' in inc) && !inc.fixed_in) errors.push(`${ia}: needs end (a date, or null if still open) or fixed_in (release tag)`);
        if (inc.end && !parseDate(inc.end)) errors.push(`${ia}: end is not a date`);
        if (inc.start && inc.end && parseDate(inc.end) < parseDate(inc.start)) errors.push(`${ia}: end is before start`);
      });
    }
    if (!Array.isArray(f.evidence) || !f.evidence.length) warnings.push(`${at}: no evidence links`);
    if (f.reach === 'everyone' && !f.reach_reason) warnings.push(`${at}: reach "everyone" without reach_reason; say why it triggers in the default configuration`);
  });
  if (typeof L.searches_run !== 'number') warnings.push('searches_run is not set; Evidence Confidence will be Low');
  return { errors, warnings };
}

// ---------------------------------------------------------------- releases

function normTag(t) {
  return String(t).trim().toLowerCase().replace(/^.*@/, '').replace(/^(release-|version-|v)/, '');
}

export function releaseDate(releases, tag) {
  if (!Array.isArray(releases) || !tag) return null;
  const want = String(tag).trim().toLowerCase();
  const hit = releases.find((r) => String(r.tag).toLowerCase() === want) || releases.find((r) => normTag(r.tag) === normTag(tag));
  return hit ? parseDate(hit.date) : null;
}

function resolveIncident(inc, releases, scan, warnings, at) {
  let start = parseDate(inc.start);
  let end = inc.end ? parseDate(inc.end) : null;
  let startSrc = start ? 'date' : null;
  let endSrc = inc.end ? 'date' : null;
  if (inc.introduced_in) {
    const d = releaseDate(releases, inc.introduced_in);
    if (d) { start = d; startSrc = 'release'; } else warnings.push(`${at}: introduced_in "${inc.introduced_in}" not found in collected releases; using start date`);
  }
  if (inc.fixed_in) {
    const d = releaseDate(releases, inc.fixed_in);
    if (d) { end = d; endSrc = 'release'; } else warnings.push(`${at}: fixed_in "${inc.fixed_in}" not found in collected releases; using end date${inc.end ? '' : ' (none given, so treated as still open)'}`);
  }
  if (!start) return null;
  const open = !end;
  if (open) { end = scan; endSrc = 'open'; }
  if (end < start) end = start;
  const effEnd = new Date(Math.max(end.getTime(), start.getTime() + DAY)); // a bug live "0 days" still hit people for ~a day
  return { start, end: effEnd, open, startSrc, endSrc, daysLive: (effEnd - start) / DAY };
}

// ---------------------------------------------------------------- preferences

export function emptyPrefs() {
  return { schema: 'rar-prefs/1', platforms: null, features: {}, annoyance: {}, repos: {} };
}

export function loadPrefs(home = dataHome()) {
  const file = path.join(home, 'prefs.json');
  try {
    return { ...emptyPrefs(), ...readJson(file) };
  } catch {
    return emptyPrefs();
  }
}

export function effectivePrefs(prefs, repo) {
  const g = prefs || emptyPrefs();
  const r = (g.repos || {})[repo] || {};
  const pick = (kind, key) => {
    if (r[kind] && r[kind][key]) return { ...r[kind][key], scope: 'this repo' };
    if (g[kind] && g[kind][key]) return { ...g[kind][key], scope: 'global' };
    return null;
  };
  const platforms = r.platforms ? { ...r.platforms, scope: 'this repo' } : g.platforms ? { ...g.platforms, scope: 'global' } : null;
  return { feature: (k) => pick('features', k), annoyance: (k) => pick('annoyance', k), platforms };
}

function platformMatches(famPlatforms, userPlatforms) {
  return famPlatforms.some((fp) => userPlatforms.some((up) => {
    const a = fp.toLowerCase();
    const b = up.toLowerCase();
    return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
  }));
}

export function setPref(prefs, key, value, { repo, today = new Date(), sourceRepo } = {}) {
  const p = JSON.parse(JSON.stringify(prefs || emptyPrefs()));
  const target = repo ? (p.repos[repo] = p.repos[repo] || {}) : p;
  const stamp = { set_at: iso(today), ...(sourceRepo ? { source_repo: sourceRepo } : {}) };
  if (key === 'platform' || key === 'platforms') {
    const list = String(value).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!list.length) throw new Error('platform needs a comma-separated list, e.g. windows,wsl');
    target.platforms = { value: list, ...stamp };
    return p;
  }
  const m = key.match(/^(feature|annoy|annoyance)\.([a-z0-9-]+)$/);
  if (!m) throw new Error('key must be platform, feature.<tag> or annoy.<category>');
  if (m[1] === 'feature') {
    if (!['yes', 'sometimes', 'no'].includes(value)) throw new Error('feature value must be yes, sometimes or no');
    target.features = target.features || {};
    target.features[m[2]] = { value, ...stamp };
  } else {
    if (!ENUMS.category.includes(m[2])) throw new Error(`annoy.<category> must use a category: ${ENUMS.category.join(', ')}`);
    if (!['low', 'normal', 'high'].includes(value)) throw new Error('annoyance value must be low, normal or high');
    target.annoyance = target.annoyance || {};
    target.annoyance[m[2]] = { value, ...stamp };
  }
  return p;
}

export function unsetPref(prefs, key, { repo } = {}) {
  const p = JSON.parse(JSON.stringify(prefs || emptyPrefs()));
  const target = repo ? p.repos[repo] : p;
  if (!target) return p;
  if (key === 'platform' || key === 'platforms') target.platforms = null;
  else {
    const m = key.match(/^(feature|annoy|annoyance)\.([a-z0-9-]+)$/);
    if (m) delete (target[m[1] === 'feature' ? 'features' : 'annoyance'] || {})[m[2]];
  }
  return p;
}

// ---------------------------------------------------------------- scoring

const evidenceWeight = (f) => (f.confirmed === true || f.reports >= 2 ? 1 : W.weakEvidence);
const levelIndex = (rate) => (rate < THRESHOLDS[0] ? 0 : rate < THRESHOLDS[1] ? 1 : rate < THRESHOLDS[2] ? 2 : 3);

function dimensionOf(f) {
  if (['data-loss', 'security'].includes(f.severity) || ['data-loss', 'config-reset', 'security'].includes(f.category)) return 'Data Safety';
  if (['upgrade-break', 'api-break', 'install-update'].includes(f.category)) return 'Upgrade Safety';
  return 'Runtime';
}

function flagFor(f, incs, scan) {
  if (evidenceWeight(f) < 1) return null;
  let kind = null;
  if (f.severity === 'data-loss' || f.severity === 'security') kind = 'critical';
  else if (f.severity === 'blocks-work' && ['none', 'destructive'].includes(f.workaround) && ['everyone', 'common'].includes(f.reach)) kind = 'major';
  if (!kind) return null;
  const recentCut = scan.getTime() - 365 * DAY;
  const openNow = incs.some((i) => i.open);
  const recurred = incs.length >= 2 && incs.some((i) => i.open || i.end.getTime() > recentCut);
  const only = incs.length === 1 ? incs[0] : null;
  const slowRecent = !!only && !only.open && only.end.getTime() > recentCut && only.daysLive > W.fastFixDays;
  const active = openNow || recurred || slowRecent;
  let status = 'active';
  if (!active) status = only && only.daysLive <= W.fastFixDays ? 'resolved-fast' : 'historical';
  const conditional = ['feature', 'platform', 'edge'].includes(f.reach);
  const scope = f.reach === 'feature' ? `if you use ${f.feature}` : f.reach === 'platform' ? `on ${f.platforms.join('/')}` : f.reach === 'edge' ? 'unusual setups only' : 'all users';
  const why = openNow ? 'still open' : recurred ? 'recurred within the last 12 months' : slowRecent ? `took ${Math.round(only.daysLive)} days to fix, within the last 12 months` : status === 'resolved-fast' ? `fixed in ${Math.max(1, Math.round(only.daysLive))} day(s), no recurrence` : 'older than 12 months, not recurring';
  return { kind, status, conditional, scope, why };
}

function applyFlags(baseLevel, flags) {
  let lvl = baseLevel;
  const why = [];
  if (flags.some((f) => f.kind === 'major')) { lvl = Math.min(3, lvl + 1); why.push('active major red flag: +1 level'); }
  if (flags.some((f) => f.kind === 'critical') && lvl < 2) { lvl = 2; why.push('active critical red flag: floor High'); }
  return { lvl, why };
}

export function scoreLedger(ledger, { collect = null, prefs = null, today = null } = {}) {
  const { errors, warnings } = validateLedger(ledger);
  if (errors.length) return { ok: false, errors, warnings };
  const repo = normalizeRepo(ledger.repo);
  const scan = parseDate(today) || parseDate(ledger.scanned_at) || new Date(`${iso(new Date())}T00:00:00Z`);
  const releases = (collect && collect.releases) || ledger.releases || [];
  const created = parseDate(ledger.project_created) || parseDate(collect && collect.meta && collect.meta.created_at);

  // Two 12-month buckets, annualized by how long the project existed in each.
  const buckets = [
    { name: 'last 12 months', start: scan.getTime() - 365 * DAY, end: scan.getTime(), weight: 2 },
    { name: 'prior 12 months', start: scan.getTime() - 730 * DAY, end: scan.getTime() - 365 * DAY, weight: 1 },
  ].map((b) => {
    const exposure = created ? overlapDays(created.getTime(), scan.getTime(), b.start, b.end) : 365;
    return { ...b, exposure, included: exposure > 0, annualize: exposure > 0 ? 365 / Math.max(exposure, 90) : 0 };
  });
  const wsum = buckets.filter((b) => b.included).reduce((s, b) => s + b.weight, 0) || 1;

  const ep = effectivePrefs(prefs, repo);
  const prefsUsed = new Map();
  const unknownTags = new Set();
  const families = [];

  ledger.families.forEach((f, i) => {
    const at = `families[${i}] (${f.id})`;
    const incs = f.incidents.map((inc, j) => resolveIncident(inc, releases, scan, warnings, `${at}.incidents[${j}]`)).filter(Boolean);
    if (f.reach === 'feature' && !FEATURE_TAGS[f.feature]) unknownTags.add(f.feature);

    // personal reach and annoyance
    let pReach = W.reach[f.reach];
    let pReachKnown = true;
    if (f.reach === 'feature') {
      const p = ep.feature(f.feature);
      if (p) { pReach = W.personalFeature[p.value]; prefsUsed.set(`feature.${f.feature}`, p); } else pReachKnown = false;
    } else if (f.reach === 'platform') {
      if (ep.platforms && ep.platforms.value && ep.platforms.value.length) {
        pReach = platformMatches(f.platforms, ep.platforms.value) ? W.platformMatch : W.platformMiss;
        prefsUsed.set('platform', ep.platforms);
      } else pReachKnown = false;
    }
    let annoy = 1;
    const a = ep.annoyance(f.category);
    if (a) {
      annoy = W.annoyance[a.value] || 1;
      if (['data-loss', 'security'].includes(f.severity) || ['data-loss', 'security'].includes(f.category)) annoy = Math.max(1, annoy);
      prefsUsed.set(`annoy.${f.category}`, a);
    }

    const perHit = W.severity[f.severity] * W.workaround[f.workaround] * evidenceWeight(f);
    const rate = W.trigger[f.trigger];
    const bucketHits = buckets.map((b) => {
      if (!b.included) return 0;
      let hits = 0;
      for (const inc of incs) {
        if (f.trigger === 'once') { if (inc.start.getTime() > b.start && inc.start.getTime() <= b.end) hits += 1; }
        else hits += rate * overlapDays(inc.start.getTime(), inc.end.getTime(), b.start, b.end);
      }
      return hits * b.annualize;
    });
    const combine = (reach, ann) => buckets.reduce((s, b, k) => s + (b.included ? b.weight * reach * ann * perHit * bucketHits[k] : 0), 0) / wsum;
    const neutral = combine(W.reach[f.reach], 1);
    const personal = combine(pReach, annoy);
    const byBucket = buckets.map((b, k) => W.reach[f.reach] * perHit * bucketHits[k]);
    const flag = flagFor(f, incs, scan);
    families.push({
      id: f.id, title: f.title || f.id, category: f.category, severity: f.severity, reach: f.reach, feature: f.feature,
      platforms: f.platforms, trigger: f.trigger, workaround: f.workaround, dimension: dimensionOf(f),
      incidents: incs.map((x) => ({ start: iso(x.start), end: x.open ? null : iso(x.end), open: x.open, days: Math.round(x.daysLive), dated_by: `${x.startSrc}/${x.endSrc}` })),
      neutral, personal, byBucket, personalReach: pReach, personalReachKnown: pReachKnown, flag,
      evidenceWeight: evidenceWeight(f), evidence: f.evidence || [],
    });
  });

  const sum = (k) => families.reduce((s, f) => s + f[k], 0);
  const neutralRate = sum('neutral');
  const personalRate = sum('personal');
  const bucketTotals = buckets.map((b, k) => (b.included ? families.reduce((s, f) => s + f.byBucket[k], 0) : null));

  const activeFlags = families.filter((f) => f.flag && f.flag.status === 'active');
  const neutralEsc = applyFlags(levelIndex(neutralRate), activeFlags.filter((f) => !f.flag.conditional).map((f) => f.flag));
  const personalEsc = applyFlags(levelIndex(personalRate), activeFlags.filter((f) => !f.flag.conditional || f.personalReach >= 0.5).map((f) => f.flag));

  // dimensions (neutral and personal)
  const dims = {};
  for (const d of ['Runtime', 'Data Safety', 'Upgrade Safety']) {
    const fs_ = families.filter((f) => f.dimension === d);
    const n = fs_.reduce((s, f) => s + f.neutral, 0);
    const p = fs_.reduce((s, f) => s + f.personal, 0);
    dims[d] = { neutral: round5(100 * Math.exp(-n / 10)), personal: round5(100 * Math.exp(-p / 10)), badDays: round(n) };
  }

  // trend
  let trend = 'n/a (project is less than a year old or dates unknown)';
  if (bucketTotals[1] !== null && bucketTotals[0] !== null) {
    const [A, B] = bucketTotals;
    if (A < 1 && B < 1) trend = 'steady (both years quiet)';
    else if (A > B * 1.5) trend = 'worsening';
    else if (A < B / 1.5) trend = 'improving';
    else trend = 'steady';
  }

  // confidence
  const confReasons = [];
  let conf = 'Medium';
  const hasCollect = !!(collect && !collect.error);
  const searches = typeof ledger.searches_run === 'number' ? ledger.searches_run : 0;
  const weak = families.filter((f) => f.evidenceWeight < 1).length;
  const closed = families.flatMap((f) => f.incidents).filter((x) => !x.open);
  const releaseDated = closed.filter((x) => x.dated_by.endsWith('/release')).length;
  if (!hasCollect) confReasons.push('no collected GitHub data');
  const minSearches = String(ledger.depth || '').toLowerCase() === 'quick' ? 4 : 8;
  if (searches < minSearches) confReasons.push(`only ${searches} searches recorded`);
  if (families.length && weak / families.length > 0.5) confReasons.push('most families rest on single unconfirmed reports');
  if (confReasons.length) conf = 'Low';
  else if (searches >= 20 && ledger.sample_reviewed === true && (closed.length === 0 || releaseDated / closed.length >= 0.6)) {
    conf = 'High';
    confReasons.push('collected data, broad search, sample reviewed, fixes dated by release');
  } else {
    if (!ledger.sample_reviewed) confReasons.push('recent-issue sample not reviewed');
    if (closed.length && releaseDated / closed.length < 0.6) confReasons.push(`${releaseDated}/${closed.length} fixes dated by release tag (issue dates are noisier)`);
    if (searches < 20) confReasons.push(`${searches} searches`);
  }

  // questions for the user (answers stored as preferences)
  const questions = [];
  const seen = new Set();
  const ranked = [...families].sort((x, y) => (y.flag ? 1 : 0) - (x.flag ? 1 : 0) || y.neutral - x.neutral);
  for (const f of ranked) {
    if (f.reach === 'feature' && !f.personalReachKnown && !seen.has(f.feature) && (f.flag || f.neutral >= 0.2)) {
      seen.add(f.feature);
      questions.push({ key: `feature.${f.feature}`, values: 'yes|sometimes|no', ask: `Do you use ${f.feature}${FEATURE_TAGS[f.feature] ? ` (${FEATURE_TAGS[f.feature]})` : ''}?`, because: f.title });
    }
  }
  if (families.some((f) => f.reach === 'platform' && (f.flag || f.neutral >= 0.2)) && !ep.platforms) {
    questions.push({ key: 'platform', values: 'e.g. windows,wsl or macos or linux', ask: 'Which OS(es) would you run it on?', because: families.find((f) => f.reach === 'platform').title });
  }
  const topCat = [...families].sort((x, y) => y.neutral - x.neutral).find((f) => f.neutral >= 1 && !['data-loss', 'security'].includes(f.severity));
  if (topCat && !ep.annoyance(topCat.category)) {
    questions.push({ key: `annoy.${topCat.category}`, values: 'low|normal|high', ask: `How much do ${topCat.category} bugs bother you compared with other bugs?`, because: topCat.title });
  }

  if (releases.length) {
    const undated = families.filter((f) => f.incidents.some((x) => !x.open && !x.dated_by.endsWith('/release'))).map((f) => f.id);
    if (undated.length) warnings.push(`fixed incidents without a release tag in: ${undated.join(', ')}. Add fixed_in (try \`fix-release OWNER/REPO <issue>\` or the release notes) for better dates and confidence`);
  }
  for (const t of unknownTags) warnings.push(`feature tag "${t}" is not in the standard list; reuse a standard tag if one fits so preferences carry across repos`);

  const usedList = [...prefsUsed.entries()].map(([k, v]) => ({
    key: k, value: Array.isArray(v.value) ? v.value.join(',') : v.value, scope: v.scope, set_at: v.set_at,
    source_repo: v.source_repo, age_days: v.set_at ? Math.round((scan - parseDate(v.set_at)) / DAY) : null,
  }));
  for (const u of usedList) if (u.age_days !== null && u.age_days > 180) warnings.push(`preference ${u.key}=${u.value} is ${u.age_days} days old; check it is still true`);

  const neutralRisk = LEVELS[neutralEsc.lvl];
  const personalRisk = LEVELS[personalEsc.lvl];
  return {
    ok: true,
    version: VERSION,
    repo,
    scanned_at: iso(scan),
    depth: ledger.depth || null,
    model: ledger.model || null,
    neutral: { badDaysPerYear: round(neutralRate), baseRisk: LEVELS[levelIndex(neutralRate)], risk: neutralRisk, escalation: neutralEsc.why, recommendation: RECOMMENDATION[neutralRisk] },
    personal: { badDaysPerYear: round(personalRate), baseRisk: LEVELS[levelIndex(personalRate)], risk: personalRisk, escalation: personalEsc.why, recommendation: RECOMMENDATION[personalRisk], prefsUsed: usedList },
    buckets: buckets.map((b, k) => ({ name: b.name, included: b.included, badDays: bucketTotals[k] === null ? null : round(bucketTotals[k]) })),
    trend,
    confidence: { level: conf, reasons: confReasons },
    dimensions: dims,
    families: families.sort((x, y) => y.neutral - x.neutral),
    questions: questions.slice(0, 3),
    positives: ledger.positives || [],
    collect: hasCollect ? summarizeCollect(collect) : null,
    warnings,
  };
}

function summarizeCollect(c) {
  return { meta: c.meta, release_stats: c.release_stats, issue_volume: c.issue_volume, keyword_share: c.keyword_share, responsiveness: c.responsiveness, notes: c.notes };
}

// ---------------------------------------------------------------- rendering

const fmtDays = (x) => (x === null || x === undefined ? 'n/a' : x < 0.05 ? '<0.05' : String(round(x)));

export function renderScore(r) {
  if (!r.ok) return `Ledger has errors, fix them and re-run:\n${r.errors.map((e) => `- ${e}`).join('\n')}${r.warnings.length ? `\nWarnings:\n${r.warnings.map((w) => `- ${w}`).join('\n')}` : ''}`;
  const showPersonal = r.personal.prefsUsed.length > 0;
  const out = [];
  out.push(`## Script verdict (rar.mjs ${r.version})`);
  out.push(`${r.repo} · scanned ${r.scanned_at}${r.depth ? ` · depth ${r.depth}` : ''}${r.model ? ` · ledger by ${r.model}` : ''}`);
  out.push('');
  out.push(showPersonal ? '| | Neutral | Personal |' : '| | Neutral |');
  out.push(showPersonal ? '|---|---|---|' : '|---|---|');
  const row = (label, n, p) => out.push(showPersonal ? `| ${label} | ${n} | ${p} |` : `| ${label} | ${n} |`);
  row('**Adoption Risk**', `**${r.neutral.risk}**`, `**${r.personal.risk}**`);
  row('Bad days per year', fmtDays(r.neutral.badDaysPerYear), fmtDays(r.personal.badDaysPerYear));
  row('Suggested recommendation', r.neutral.recommendation, r.personal.recommendation);
  if (r.neutral.escalation.length || r.personal.escalation.length) row('Escalation', r.neutral.escalation.join('; ') || 'none', r.personal.escalation.join('; ') || 'none');
  out.push('');
  out.push(`Bad days by year (neutral): ${r.buckets.map((b) => `${b.name} ${b.included ? fmtDays(b.badDays) : 'n/a'}`).join(' · ')} · trend: ${r.trend}`);
  out.push(`Evidence Confidence: ${r.confidence.level}${r.confidence.reasons.length ? ` (${r.confidence.reasons.join('; ')})` : ''}`);
  out.push(`Dimensions (neutral${showPersonal ? ' / personal' : ''}): ${Object.entries(r.dimensions).map(([k, v]) => `${k} ${v.neutral}${showPersonal ? `/${v.personal}` : ''}`).join(' · ')}`);

  if (r.families.length) {
    out.push('');
    out.push('### What drives the number');
    out.push(showPersonal ? '| Family | Severity · reach · trigger · workaround | Live periods | Bad days/yr (neutral → personal) | Flag |' : '| Family | Severity · reach · trigger · workaround | Live periods | Bad days/yr | Flag |');
    out.push('|---|---|---|---|---|');
    for (const f of r.families.slice(0, 8)) {
      const reach = f.reach === 'feature' ? `feature:${f.feature}` : f.reach === 'platform' ? `platform:${f.platforms.join('/')}` : f.reach;
      const live = f.incidents.map((x) => `${x.start}→${x.open ? 'open' : x.end} (${x.days}d)`).join(', ');
      const flag = f.flag ? `${f.flag.kind}, ${f.flag.status}${f.flag.conditional ? ` (${f.flag.scope})` : ''}` : '';
      const val = showPersonal ? `${fmtDays(f.neutral)} → ${fmtDays(f.personal)}` : fmtDays(f.neutral);
      out.push(`| ${f.title}${f.evidenceWeight < 1 ? ' *(single unconfirmed report)*' : ''} | ${f.severity} · ${reach} · ${f.trigger} · ${f.workaround} | ${live} | ${val} | ${flag} |`);
    }
    if (r.families.length > 8) out.push(`(${r.families.length - 8} smaller families omitted)`);
  } else {
    out.push('', 'No failure families recorded.');
  }

  const flagged = r.families.filter((f) => f.flag);
  if (flagged.length) {
    out.push('', '### Red flags');
    for (const f of flagged) {
      const fl = f.flag;
      const label = fl.status === 'active' ? (fl.conditional ? `CONDITIONAL ${fl.kind} (${fl.scope})` : `ACTIVE ${fl.kind}`) : fl.status === 'resolved-fast' ? `Resolved note (${fl.kind})` : `Historical (${fl.kind})`;
      out.push(`- **${label}**: ${f.title}: ${fl.why}.${f.evidence[0] ? ` ${f.evidence[0]}` : ''}`);
    }
  }

  if (r.collect) {
    const c = r.collect;
    out.push('', '### Measured (from collect)');
    if (c.release_stats) out.push(`- Releases in window: ${c.release_stats.count_in_window} · median gap ${c.release_stats.median_gap_days ?? 'n/a'} days · hotfix within 72h: ${c.release_stats.hotfix_share === null ? 'n/a' : `${Math.round(c.release_stats.hotfix_share * 100)}%`} · last release ${c.release_stats.last_release || 'none'}`);
    if (c.responsiveness) {
      const s = c.responsiveness;
      out.push(`- Recent issues sampled: ${s.sampled} · median first reply (non-author, non-bot) ${s.median_first_reply_hours === null ? 'n/a' : `${round(s.median_first_reply_hours)}h`} · no reply yet ${s.no_reply_share === null ? 'n/a' : `${Math.round(s.no_reply_share * 100)}%`} · maintainer-tagged reply median ${s.median_maintainer_reply_hours === null ? 'n/a' : `${round(s.median_maintainer_reply_hours)}h`} (lower bound; private org members are not tagged)`);
      out.push(`- Closed in sample: ${s.closed} · median days to close (completed) ${s.median_days_to_close ?? 'n/a'} · closed as not planned/duplicate ${s.not_planned_share === null ? 'n/a' : `${Math.round(s.not_planned_share * 100)}%`}`);
    }
    if (c.keyword_share) {
      const k = c.keyword_share;
      out.push(`- Base rate: of ${c.issue_volume.created_in_window} issues opened in the window, ${pct(k.crash)} mention crash/panic/hang, ${pct(k.data)} data loss/corruption, ${pct(k.regression)} regressions/broke-after-update. Context only, not scored: ripgrep, fzf, jq and bat measured 4-9% / 0.5-2% / 2-8% (Nov 2026), so mature, well-liked tools still have plenty of these.`);
    }
  }

  if (r.positives.length) {
    out.push('', '### Positive evidence recorded');
    for (const p of r.positives) out.push(`- ${p.signal || p}${p.evidence ? ` (${p.evidence})` : ''}`);
  }

  if (r.personal.prefsUsed.length) {
    out.push('', '### Your stored preferences used');
    for (const u of r.personal.prefsUsed) out.push(`- ${u.key} = ${u.value} (${u.scope}, set ${u.set_at}${u.source_repo ? ` while scanning ${u.source_repo}` : ''})`);
  }

  if (r.questions.length) {
    out.push('', '### Questions for the user (optional, ask after the report; store answers with `prefs set`)');
    for (const q of r.questions) out.push(`- ${q.ask} [${q.values}] → \`prefs set ${q.key} <answer>\` (add \`--repo ${r.repo}\` if only for this project). Affects: ${q.because}`);
  }

  if (r.warnings.length) {
    out.push('', '### Warnings');
    for (const w of r.warnings) out.push(`- ${w}`);
  }
  return out.join('\n');
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${round(x * 100)}%`);

// ---------------------------------------------------------------- GitHub access

function ghAvailable() {
  if (process.env.RAR_NO_GH) return false; // force the plain-API path (testing, or a broken gh install)
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

function makeClient() {
  const gh = ghAvailable();
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
  const headers = { 'User-Agent': 'repo-adoption-risk', Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return {
    via: gh ? 'gh' : token ? 'api+token' : 'api (unauthenticated, low rate limit)',
    canGraphql: gh || !!token,
    async rest(p, params = {}) {
      if (gh) {
        const args = ['api', '-X', 'GET', p];
        for (const [k, v] of Object.entries(params)) args.push('-f', `${k}=${v}`);
        return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 60000 }));
      }
      const res = await fetch(`https://api.github.com/${p}?${new URLSearchParams(params)}`, { headers });
      if (!res.ok) throw new Error(`GitHub API ${res.status} for ${p}`);
      return res.json();
    },
    async graphql(query, vars) {
      if (gh) {
        const args = ['api', 'graphql', '-f', `query=${query}`];
        for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
        return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 90000 })).data;
      }
      if (!token) return null;
      const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify({ query, variables: vars }) });
      if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
      return (await res.json()).data;
    },
  };
}

const SAMPLE_QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issues(first:$n,orderBy:{field:CREATED_AT,direction:DESC}){nodes{number title url state stateReason createdAt closedAt author{login __typename} reactions{totalCount} comments(first:10){totalCount nodes{createdAt authorAssociation author{login __typename}}}}}}}`;

const isBot = (a) => !a || a.__typename === 'Bot' || BOT_RE.test(a.login || '');

export async function collect(repo, { windowMonths = 24, sample = 100, client = makeClient(), today = new Date() } = {}) {
  const [owner, name] = repo.split('/');
  const notes = [];
  const out = { schema: 'rar-collect/1', repo, collected_at: today.toISOString(), via: client.via, window_months: windowMonths };
  const windowStart = new Date(today.getTime() - windowMonths * 30.44 * DAY);
  out.window_start = iso(windowStart);

  const m = await client.rest(`repos/${owner}/${name}`);
  out.meta = {
    full_name: m.full_name, description: m.description, stars: m.stargazers_count, forks: m.forks_count,
    open_issues_and_prs: m.open_issues_count, created_at: m.created_at, pushed_at: m.pushed_at,
    archived: m.archived, license: m.license && m.license.spdx_id, has_issues: m.has_issues, default_branch: m.default_branch,
  };
  if (m.full_name && m.full_name.toLowerCase() !== repo.toLowerCase()) notes.push(`Repository redirects to ${m.full_name}; use that name.`);
  if (!m.has_issues) notes.push('GitHub issues are disabled; the tracker lives elsewhere, so issue-based metrics are missing.');

  // releases
  const releases = [];
  try {
    for (let page = 1; page <= 3; page++) {
      const batch = await client.rest(`repos/${owner}/${name}/releases`, { per_page: 100, page });
      releases.push(...batch.filter((r) => !r.draft).map((r) => ({ tag: r.tag_name, date: r.published_at || r.created_at, prerelease: r.prerelease })));
      if (batch.length < 100) break;
    }
  } catch (e) { notes.push(`Could not list releases: ${e.message}`); }
  out.releases = releases;
  const stable = releases.filter((r) => !r.prerelease).map((r) => ({ ...r, t: parseDate(r.date).getTime() })).sort((a, b) => a.t - b.t);
  const inWin = stable.filter((r) => r.t >= windowStart.getTime());
  const gaps = inWin.map((r, i) => {
    const prev = i ? inWin[i - 1] : stable[stable.indexOf(r) - 1];
    return prev ? (r.t - prev.t) / DAY : null;
  }).filter((g) => g !== null);
  out.release_stats = {
    count_in_window: inWin.length,
    median_gap_days: gaps.length ? round(median(gaps)) : null,
    hotfix_share: gaps.length ? round(gaps.filter((g) => g <= 3).length / gaps.length, 2) : null,
    last_release: stable.length ? `${stable[stable.length - 1].tag} (${iso(new Date(stable[stable.length - 1].t))})` : null,
  };
  if (!releases.length) notes.push('No GitHub releases found; fix dates must come from issues/commits, so confidence is lower.');

  // issue volume, keyword base rates, top-reacted issues (search API)
  const base = `repo:${owner}/${name} is:issue created:>=${iso(windowStart)}`;
  const count = async (extra) => (await client.rest('search/issues', { q: extra ? `${base} ${extra}` : base, per_page: 1 })).total_count;
  try {
    const total = await count('');
    out.issue_volume = { created_in_window: total, per_month: round(total / windowMonths) };
    const crash = await count('crash OR panic OR segfault OR freeze OR hang');
    const data = await count('"data loss" OR corrupt OR corrupted OR "lost data" OR wiped');
    const regression = await count('regression OR "broke after" OR "after update" OR "after upgrade"');
    out.keyword_share = total ? { crash: round(crash / total, 3), data: round(data / total, 3), regression: round(regression / total, 3) } : null;
    const top = await client.rest('search/issues', { q: base, sort: 'reactions', order: 'desc', per_page: 15 });
    out.top_reacted = top.items.map((i) => ({ number: i.number, title: i.title, state: i.state, reactions: i.reactions && i.reactions.total_count, comments: i.comments, created: i.created_at.slice(0, 10), closed: i.closed_at ? i.closed_at.slice(0, 10) : null, url: i.html_url }));
  } catch (e) { notes.push(`Search API failed (${e.message}); issue volume and base rates missing.`); }

  // recent-issue sample: responsiveness and an unbiased view of what people report
  out.responsiveness = null;
  out.recent_sample = [];
  if (client.canGraphql) {
    try {
      const data = await client.graphql(SAMPLE_QUERY, { owner, name, n: Math.min(sample, 100) });
      const nodes = ((data && data.repository && data.repository.issues.nodes) || []).filter((n) => !isBot(n.author));
      const old = nodes.filter((n) => today - parseDate(n.createdAt) >= 7 * DAY);
      const firstReply = [];
      const maint = [];
      let noReply = 0;
      for (const n of old) {
        const author = n.author && n.author.login;
        const cs = n.comments.nodes.filter((c) => !isBot(c.author) && (c.author && c.author.login) !== author);
        if (cs.length) firstReply.push((parseDate(cs[0].createdAt) - parseDate(n.createdAt)) / 3600000);
        else if (n.comments.totalCount <= 10) noReply++;
        const mc = cs.find((c) => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(c.authorAssociation));
        if (mc) maint.push((parseDate(mc.createdAt) - parseDate(n.createdAt)) / 3600000);
      }
      const closed = nodes.filter((n) => n.state === 'CLOSED');
      const completed = closed.filter((n) => n.stateReason === 'COMPLETED');
      const notPlanned = closed.filter((n) => ['NOT_PLANNED', 'DUPLICATE'].includes(n.stateReason));
      out.responsiveness = {
        sampled: nodes.length,
        median_first_reply_hours: median(firstReply),
        no_reply_share: old.length ? round(noReply / old.length, 2) : null,
        median_maintainer_reply_hours: median(maint),
        closed: closed.length,
        median_days_to_close: completed.length ? round(median(completed.map((n) => (parseDate(n.closedAt) - parseDate(n.createdAt)) / DAY))) : null,
        not_planned_share: closed.length ? round(notPlanned.length / closed.length, 2) : null,
        severe_title_share: nodes.length ? round(nodes.filter((n) => SEVERE_TITLE_RE.test(n.title)).length / nodes.length, 2) : null,
      };
      out.recent_sample = nodes.map((n) => ({ number: n.number, title: n.title, state: n.state, reason: n.stateReason, reactions: n.reactions.totalCount, comments: n.comments.totalCount, created: n.createdAt.slice(0, 10) }));
    } catch (e) { notes.push(`Issue sample failed (${e.message}); responsiveness metrics missing.`); }
  } else notes.push('No gh login or token: skipped the recent-issue sample and responsiveness metrics (GraphQL needs auth).');
  out.notes = notes;
  return out;
}

function renderCollect(c, file) {
  const lines = [];
  lines.push(`Collected ${c.repo} via ${c.via} → ${file || '(not saved)'}`);
  const m = c.meta;
  lines.push(`Created ${m.created_at.slice(0, 10)} · last push ${m.pushed_at.slice(0, 10)} · license ${m.license || 'none'} · stars ${m.stars} (not a quality signal)${m.archived ? ' · ARCHIVED' : ''}`);
  const r = c.release_stats;
  lines.push(`Releases: ${c.releases.length} listed · ${r.count_in_window} stable in window · median gap ${r.median_gap_days ?? 'n/a'}d · hotfix share ${r.hotfix_share ?? 'n/a'} · last ${r.last_release || 'none'}`);
  if (c.issue_volume) lines.push(`Issues opened in window: ${c.issue_volume.created_in_window} (${c.issue_volume.per_month}/month) · keyword share crash ${pct(c.keyword_share && c.keyword_share.crash)} · data ${pct(c.keyword_share && c.keyword_share.data)} · regression ${pct(c.keyword_share && c.keyword_share.regression)}`);
  if (c.responsiveness) {
    const s = c.responsiveness;
    lines.push(`Sample of ${s.sampled} recent issues: first reply median ${s.median_first_reply_hours === null ? 'n/a' : `${round(s.median_first_reply_hours)}h`} · no reply ${pct(s.no_reply_share)} · closed ${s.closed} (median ${s.median_days_to_close ?? 'n/a'}d, not planned/duplicate ${pct(s.not_planned_share)}) · severe-sounding titles ${pct(s.severe_title_share)}`);
  }
  if (c.top_reacted && c.top_reacted.length) {
    lines.push('', 'Most-reacted issues in window (reach proxy):');
    for (const i of c.top_reacted) lines.push(`  #${i.number} [${i.state}${i.closed ? ` ${i.closed}` : ''}] +${i.reactions} ${i.comments}c ${i.created} ${i.title}`);
  }
  if (c.recent_sample && c.recent_sample.length) {
    lines.push('', 'Most recent issues (unbiased sample; skim for what people actually hit):');
    for (const i of c.recent_sample.slice(0, 40)) lines.push(`  #${i.number} [${i.state}${i.reason && i.state === 'CLOSED' ? `:${i.reason.toLowerCase()}` : ''}] +${i.reactions} ${i.comments}c ${i.created} ${i.title}`);
  }
  for (const n of c.notes) lines.push(`Note: ${n}`);
  return lines.join('\n');
}

// For each issue: when it closed, which PR closed it, and the first release after the merge.
export async function fixRelease(repo, numbers, { client = makeClient() } = {}) {
  const [owner, name] = repo.split('/');
  const releases = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await client.rest(`repos/${owner}/${name}/releases`, { per_page: 100, page });
    releases.push(...batch.filter((r) => !r.draft && !r.prerelease).map((r) => ({ tag: r.tag_name, t: parseDate(r.published_at || r.created_at).getTime() })));
    if (batch.length < 100) break;
  }
  releases.sort((a, b) => a.t - b.t);
  const firstAfter = (t) => releases.find((r) => r.t >= t) || null;
  const q = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){number title createdAt closedAt stateReason timelineItems(itemTypes:[CLOSED_EVENT],last:1){nodes{... on ClosedEvent{closer{__typename ... on PullRequest{number mergedAt} ... on Commit{oid committedDate}}}}}}}}`;
  const lines = [];
  for (const n of numbers) {
    try {
      const d = client.canGraphql ? await client.graphql(q, { owner, name, n: Number(n) }) : null;
      const i = d && d.repository && d.repository.issue;
      if (!i) { lines.push(`#${n}: not found (or no GraphQL access)`); continue; }
      const closer = i.timelineItems.nodes[0] && i.timelineItems.nodes[0].closer;
      let fixT = null;
      let by = 'no linked PR/commit';
      if (closer && closer.__typename === 'PullRequest' && closer.mergedAt) { fixT = parseDate(closer.mergedAt).getTime(); by = `PR #${closer.number} merged ${closer.mergedAt.slice(0, 10)}`; }
      else if (closer && closer.__typename === 'Commit') { fixT = parseDate(closer.committedDate).getTime(); by = `commit ${closer.oid.slice(0, 7)} ${closer.committedDate.slice(0, 10)}`; }
      const rel = fixT ? firstAfter(fixT) : null;
      lines.push(`#${i.number} opened ${i.createdAt.slice(0, 10)} · closed ${i.closedAt ? i.closedAt.slice(0, 10) : 'open'}${i.stateReason ? ` (${i.stateReason.toLowerCase()})` : ''} · ${by} · first release after fix: ${rel ? `${rel.tag} (${iso(new Date(rel.t))})` : fixT ? 'none yet (fixed on the main branch, unreleased: keep end null)' : 'unknown (no linked PR; check release notes)'} · ${i.title}`);
    } catch (e) { lines.push(`#${n}: lookup failed (${e.message})`); }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else args.push(a);
  }
  return { args, flags };
}

function latestCollectFor(dir) {
  try {
    const f = fs.readdirSync(dir).filter((x) => x.endsWith('-collect.json')).sort().pop();
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}

const HELP = `rar.mjs ${VERSION}: repo-adoption-risk helper (Node 18+, no dependencies)

  collect OWNER/REPO [--window-months 24] [--out FILE]   fetch releases, issue stats, recent-issue sample
  init-ledger OWNER/REPO [--depth standard] [--collect FILE] [--out FILE] [--force]
                                                         create an empty evidence ledger to fill in
  fix-release OWNER/REPO ISSUE [ISSUE...]                closing PR and first release after it, per issue
  validate LEDGER                                        check a ledger against the rules
  score LEDGER [--collect FILE] [--neutral-only] [--json] [--today YYYY-MM-DD]
                                                         compute the verdict (neutral and personal)
  prefs show | path
  prefs set KEY VALUE [--repo OWNER/REPO] [--source OWNER/REPO]
        KEY: platform (e.g. windows,wsl) | feature.<tag> (yes|sometimes|no) | annoy.<category> (low|normal|high)
  prefs unset KEY [--repo OWNER/REPO]
  where                                                  print the data directory

Data directory: $REPO_ADOPTION_RISK_HOME, else $XDG_CONFIG_HOME/repo-adoption-risk, else ~/.config/repo-adoption-risk`;

export async function main(argv = process.argv.slice(2)) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) { console.error(`rar.mjs needs Node.js 18 or newer (found ${process.versions.node}). Use the manual fallback in references/scoring.md.`); return 2; }
  const [cmd, ...rest] = argv;
  const { args, flags } = parseArgs(rest);
  const home = dataHome();
  const notes = [];
  const today = new Date();

  switch (cmd) {
    case 'collect': {
      const repo = normalizeRepo(args[0]);
      if (!repo) { console.error('usage: collect OWNER/REPO'); return 1; }
      const c = await collect(repo, { windowMonths: Number(flags['window-months'] || 24) });
      const file = writeJson(flags.out ? path.resolve(flags.out) : path.join(home, 'scans', slug(repo), `${iso(today)}-collect.json`), c, notes);
      console.log(renderCollect(c, file));
      notes.forEach((n) => console.log(`Note: ${n}`));
      return 0;
    }
    case 'init-ledger': {
      const repo = normalizeRepo(args[0]);
      if (!repo) { console.error('usage: init-ledger OWNER/REPO'); return 1; }
      const dir = path.join(home, 'scans', slug(repo));
      const collectFile = flags.collect ? path.resolve(flags.collect) : latestCollectFor(dir);
      let created = null;
      try { if (collectFile) created = readJson(collectFile).meta.created_at.slice(0, 10); } catch { /* optional */ }
      const file = flags.out ? path.resolve(flags.out) : path.join(dir, `${iso(today)}-ledger.json`);
      if (fs.existsSync(file) && !flags.force) { console.log(`Ledger already exists: ${file}\nEdit it, or pass --force to start over.`); return 0; }
      const ledger = {
        schema: 'rar-ledger/1', repo, scanned_at: iso(today), depth: flags.depth || 'standard', model: '',
        project_created: created, collect_file: collectFile, searches_run: 0, sample_reviewed: false,
        families: [], positives: [], sources_unreachable: [],
        _example_family: {
          _note: 'Shape reference only; ignored by the script. Copy into "families" and edit. Rules: references/scoring.md',
          id: 'session-resume-crash', title: 'Crash when resuming an old session', category: 'crash', severity: 'blocks-work',
          reach: 'feature', feature: 'session-resume', platforms: [], trigger: 'occasional', workaround: 'easy',
          incidents: [{ start: '2025-03-01', end: '2025-03-04', introduced_in: 'v1.2.0', fixed_in: 'v1.2.1' }, { start: '2025-09-10', end: null }],
          reports: 7, reactions: 40, duplicates: 3, confirmed: true, evidence: ['https://github.com/OWNER/REPO/issues/123'],
          reach_reason: 'Only when resuming sessions older than a day; default flow unaffected.', notes: '',
        },
      };
      const saved = writeJson(file, ledger, notes);
      console.log(`Ledger: ${saved}${collectFile ? `\nUsing collect data: ${collectFile}` : '\nNo collect data found; run collect first for release dates and metrics.'}\nFill "families" using the rules in references/scoring.md, then run: score "${saved}"`);
      notes.forEach((n) => console.log(`Note: ${n}`));
      return 0;
    }
    case 'fix-release': {
      const repo = normalizeRepo(args[0]);
      const nums = args.slice(1).map((x) => x.replace(/^#/, '')).filter((x) => /^\d+$/.test(x));
      if (!repo || !nums.length) { console.error('usage: fix-release OWNER/REPO ISSUE [ISSUE...]'); return 1; }
      console.log(await fixRelease(repo, nums));
      return 0;
    }
    case 'validate': {
      if (!args[0]) { console.error('usage: validate LEDGER'); return 1; }
      const { errors, warnings } = validateLedger(readJson(path.resolve(args[0])));
      errors.forEach((e) => console.log(`ERROR ${e}`));
      warnings.forEach((w) => console.log(`warn  ${w}`));
      if (!errors.length) console.log('Ledger is valid.');
      return errors.length ? 1 : 0;
    }
    case 'score': {
      if (!args[0]) { console.error('usage: score LEDGER'); return 1; }
      const ledgerFile = path.resolve(args[0]);
      const ledger = readJson(ledgerFile);
      const collectFile = flags.collect ? path.resolve(flags.collect) : ledger.collect_file || latestCollectFor(path.dirname(ledgerFile));
      let collectData = null;
      if (collectFile) { try { collectData = readJson(collectFile); } catch (e) { notes.push(`Could not read collect file ${collectFile}: ${e.message}`); } }
      const prefs = flags['neutral-only'] ? null : loadPrefs(home);
      const r = scoreLedger(ledger, { collect: collectData, prefs, today: flags.today || null });
      if (r.ok && !flags['no-save']) writeJson(ledgerFile.replace(/-ledger\.json$|\.json$/, '-score.json'), r, notes);
      console.log(flags.json ? JSON.stringify(r, null, 2) : renderScore(r));
      notes.forEach((n) => console.log(`Note: ${n}`));
      return r.ok ? 0 : 1;
    }
    case 'prefs': {
      const sub = args[0];
      const file = path.join(home, 'prefs.json');
      if (!sub || sub === 'show') { console.log(JSON.stringify(loadPrefs(home), null, 2)); console.log(`(${file})`); return 0; }
      if (sub === 'path') { console.log(file); return 0; }
      if (sub === 'set' || sub === 'unset') {
        const repo = flags.repo ? normalizeRepo(flags.repo) : null;
        let p;
        try {
          p = sub === 'set'
            ? setPref(loadPrefs(home), args[1], args[2], { repo, today, sourceRepo: flags.source ? normalizeRepo(flags.source) : repo })
            : unsetPref(loadPrefs(home), args[1], { repo });
        } catch (e) { console.error(e.message); return 1; }
        try {
          fs.mkdirSync(home, { recursive: true });
          fs.writeFileSync(file, `${JSON.stringify(p, null, 2)}\n`);
          fs.appendFileSync(path.join(home, 'prefs-history.jsonl'), `${JSON.stringify({ at: today.toISOString(), op: sub, key: args[1], value: args[2] ?? null, repo })}\n`);
        } catch (e) {
          console.error(`Could not save preferences to ${file} (${e.code || e.message}). Set REPO_ADOPTION_RISK_HOME to a writable folder.`);
          return 1;
        }
        console.log(`${sub === 'set' ? 'Saved' : 'Removed'} ${args[1]}${sub === 'set' ? ` = ${args[2]}` : ''}${repo ? ` for ${repo} only` : ' (global)'} → ${file}`);
        return 0;
      }
      console.error('usage: prefs show | path | set KEY VALUE [--repo OWNER/REPO] | unset KEY [--repo OWNER/REPO]');
      return 1;
    }
    case 'where': console.log(home); return 0;
    case '--version': case 'version': console.log(VERSION); return 0;
    default: console.log(HELP); return cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`rar.mjs: ${e.message}`); process.exitCode = 1; });
}
