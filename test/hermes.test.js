import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseKnocks, approve } from '../adapters/hermes.js';
import { validateKnock, isCandidate } from '../lib/extract.js';

test('parses real hermes reject lines', () => {
  const lines = [
    '2026-06-23 08:43:22,367 WARNING gateway.run: Unauthorized user: 515151515151 (sam k) on telegram',
    '2026-06-23 09:01:52,677 WARNING gateway.run: Unauthorized user: 424242424242 (ada) on telegram',
    '2026-06-23 09:02:00,000 INFO gateway.run: normal message handling',
  ];
  const knocks = parseKnocks(lines);
  assert.equal(knocks.length, 2);
  assert.deepEqual(knocks[0], { senderId: '515151515151', name: 'sam k', platform: 'telegram' });
  assert.deepEqual(knocks[1], { senderId: '424242424242', name: 'ada', platform: 'telegram' });
});

test('candidate pre-filter catches reject-ish lines only', () => {
  assert.ok(isCandidate('WARNING gateway.run: Unauthorized user: 1 (x) on telegram'));
  assert.ok(!isCandidate('INFO gateway.run: message delivered'));
});

test('validateKnock rejects non-numeric ids', () => {
  assert.equal(validateKnock({ senderId: 'abc; rm -rf /', name: 'evil' }), null);
  assert.ok(validateKnock({ senderId: '12345678', name: 'ok' }));
});

test('approve appends to existing TELEGRAM_ALLOWED_USERS (dry run)', () => {
  const home = mkdtempSync(join(tmpdir(), 'kk-'));
  writeFileSync(join(home, '.env'), 'TELEGRAM_BOT_TOKEN=tok\nTELEGRAM_ALLOWED_USERS=111,222\n');
  const r = approve('testagent', { home, unit: 'x.service' }, '333', { dryRun: true });
  assert.ok(r.changed);
  // dry run: file untouched
  assert.match(readFileSync(join(home, '.env'), 'utf8'), /TELEGRAM_ALLOWED_USERS=111,222/);
});

test('approve is idempotent for existing ids', () => {
  const home = mkdtempSync(join(tmpdir(), 'kk-'));
  writeFileSync(join(home, '.env'), 'TELEGRAM_ALLOWED_USERS=111,222\n');
  const r = approve('testagent', { home, unit: 'x.service' }, '222', { dryRun: true });
  assert.equal(r.changed, false);
});

test('approve adds the key when missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'kk-'));
  writeFileSync(join(home, '.env'), 'TELEGRAM_BOT_TOKEN=tok\n');
  const r = approve('testagent', { home, unit: 'x.service' }, '444', { dryRun: true });
  assert.ok(r.changed);
});
