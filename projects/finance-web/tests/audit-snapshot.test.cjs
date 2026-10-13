const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const output = mkdtempSync(join(tmpdir(), 'finance-audit-test-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/audit-snapshot.ts'], { cwd: resolve(__dirname, '..') });
const { auditFieldChanges } = require(join(output, 'audit-snapshot.js'));
after(() => rmSync(output, { recursive: true, force: true }));

test('audit changes show only edited fields with before and after values', () => {
  assert.deepEqual(
    auditFieldChanges(
      { id: 'same', note: 'Card Purchase', counterparty_text: null, needs_review: true },
      { id: 'same', note: 'Coffee', counterparty_text: 'North End Coffee', needs_review: false }
    ),
    [
      { key: 'note', field: 'Note', before: 'Card Purchase', after: 'Coffee' },
      { key: 'counterparty_text', field: 'Counterparty', before: 'Not set', after: 'North End Coffee' },
      { key: 'needs_review', field: 'Needs review', before: 'Yes', after: 'No' }
    ]
  );
});

test('same-size evidence changes remain visibly different and raw snapshots can explain them', () => {
  assert.deepEqual(
    auditFieldChanges(
      { transfer_evidence: [{ id: 'before' }] },
      { transfer_evidence: [{ id: 'after' }] }
    ),
    [{ key: 'transfer_evidence', field: 'Linked observations', before: '1 observation', after: '1 observation (contents changed)' }]
  );
  assert.deepEqual(auditFieldChanges(null, { note: 'New' }), []);
  assert.deepEqual(
    auditFieldChanges({}, { reference: null }),
    [{ key: 'reference', field: 'Reference', before: 'Not recorded', after: 'Not set' }]
  );
});
