const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-report-navigation-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/report-navigation.ts'], { cwd: resolve(__dirname, '..') });
const { reportFilterQuery, reportFiltersFromQuery, reportReturnPath, reportFiltersKey, customReportFiltersKey } = require(join(output, 'report-navigation.js'));
after(() => rmSync(output, { recursive: true, force: true }));

test('report filters survive navigation with the selected date mode and saved report', () => {
  for (const period of [
    { mode: 'monthly', start: '2024-02-01', end: '2024-02-29' },
    { mode: 'daily', start: '2026-10-03', end: '2026-10-03' },
    { mode: 'custom', start: '2026-09-14', end: '2026-10-12' },
    { mode: 'custom', start: '2026-09-14', end: '2026-09-14' },
  ]) {
    const filters = { period, account: 'synthetic-account', currency: 'USD', savedReport: 'synthetic-report' };
    assert.deepEqual(reportFiltersFromQuery(reportFilterQuery(filters)), filters);
  }
});

test('legacy month links restore and invalid ranges recover to a valid current month', () => {
  assert.deepEqual(reportFiltersFromQuery('?month=2026-10').period, { mode: 'monthly', start: '2026-10-01', end: '2026-10-31' });
  assert.equal(reportFiltersFromQuery('?start_date=bad&end_date=2026-01-01').period.mode, 'monthly');
  assert.equal(reportFiltersFromQuery('?start_date=2026-10-01&end_date=2026-10-15&date_view=monthly').period.mode, 'custom');
});

test('report return links support both pages while rejecting redirects outside reports', () => {
  for (const path of ['/reports?month=2026-10', '/custom-reports?saved_report=synthetic-report', '/custom-reports#report-transactions']) {
    assert.equal(reportReturnPath(path), path);
  }
  for (const path of [null, '', '//example.invalid/reports', '/\\example.invalid', '/transactions', '/reports/../login', 'https://example.invalid/custom-reports', '/custom-reports-other']) {
    assert.equal(reportReturnPath(path), null);
  }
  assert.notEqual(reportFiltersKey, customReportFiltersKey);
});
