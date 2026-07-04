import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseKnocks, readNewLines } from '../adapters/openclaw.js';

const jline = (message) => JSON.stringify({ message, logLevelName: 'DEBUG' });

test('parses all three telegram reject variants from JSON log lines', () => {
  const lines = [
    jline('Blocked telegram group message from 424242424242 (groupPolicy: allowlist)'),
    jline('Blocked telegram group sender 515151515151 (group allowFrom override)'),
    jline('Blocked telegram direct sender 616161616161 (dm policy)'),
    jline('Inbound message telegram:group:-100 -> @some_bot (group, 44 chars)'),
  ];
  const knocks = parseKnocks(lines);
  assert.deepEqual(knocks.map((k) => k.senderId), [
    '424242424242',
    '515151515151',
    '616161616161',
  ]);
});

test('skips non-numeric and unknown senders', () => {
  const knocks = parseKnocks([
    jline('Blocked telegram group sender unknown (group allowFrom override)'),
    'not json at all',
  ]);
  assert.equal(knocks.length, 0);
});

test('cursor: first run starts at end, rollover drains old file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kk-oc-'));
  const day1 = join(dir, 'openclaw-2026-07-04.log');
  writeFileSync(day1, jline('old noise') + '\n');
  const agent = { logDir: dir };

  // first run: cursor lands at end, no lines
  let { lines, cursor } = readNewLines(agent, undefined);
  assert.equal(lines.length, 0);

  // new content in same file is picked up
  appendFileSync(day1, jline('Blocked telegram group message from 777777777 (groupPolicy: allowlist)') + '\n');
  ({ lines, cursor } = readNewLines(agent, cursor));
  assert.equal(parseKnocks(lines).length, 1);

  // rollover: remainder of old file + new file from 0
  appendFileSync(day1, jline('Blocked telegram direct sender 888888888 (x)') + '\n');
  const day2 = join(dir, 'openclaw-2026-07-05.log');
  writeFileSync(day2, jline('Blocked telegram group message from 999999999 (groupPolicy: allowlist)') + '\n');
  ({ lines, cursor } = readNewLines(agent, cursor));
  const ids = parseKnocks(lines).map((k) => k.senderId);
  assert.deepEqual(ids, ['888888888', '999999999']);
  assert.equal(cursor.file, day2);
});
