const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
function load(name) {
 const shim = { exports: {} };
 const source = ts.transpileModule(readFileSync(resolve(__dirname, '../lib', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
 new Function('module', 'exports', 'require', source)(shim, shim.exports, path => load(path.replace('./', '')));
 return shim.exports;
}
const { fillMissingStatementDetails, selectedStatementDetails } = load('statement-details');
const suggestions = [
 { field: 'counterparty_text', label: 'Merchant', existing_value: '', suggested_value: 'Demo Cafe' },
 { field: 'note', label: 'Note', existing_value: 'My note', suggested_value: 'Card purchase · Demo Cafe' },
 { field: 'reference', label: 'Reference', existing_value: '', suggested_value: '' },
];
test('fill-missing selects only empty fields with evidence and preserves edits without selecting replacements', () => {
 const selected = fillMissingStatementDetails(suggestions, { counterparty_text: { ...suggestions[0], selected: false, value: 'My merchant label' } });
 assert.deepEqual(selectedStatementDetails(suggestions, selected), { choices: [{ field: 'counterparty_text', existing_value: '', value: 'My merchant label' }], error: null });
 assert.equal(selected.note, undefined);
 assert.equal(selected.reference, undefined);
});
test('replacements are explicit; changed snapshots and blank selected values block acceptance', () => {
 const selected = { note: { ...suggestions[1], selected: true, value: 'Edited note' } };
 assert.equal(selectedStatementDetails(suggestions, selected).choices[0].value, 'Edited note');
 assert.match(selectedStatementDetails([{ ...suggestions[1], existing_value: 'Changed note' }], selected).error, /changed/);
 assert.match(selectedStatementDetails([{ ...suggestions[1], suggested_value: 'New suggestion' }], selected).error, /changed/);
 assert.match(selectedStatementDetails(suggestions, { note: { ...selected.note, value: ' ' } }).error, /Enter note/);
});
test('card edits are masked before transmission; unsafe short masks are rejected', () => {
 const detail = { field: 'sender_card_identifier', label: 'Sender card', existing_value: '', suggested_value: '***3456' };
 const selected = { sender_card_identifier: { ...detail, selected: true, value: '1234567890123456' } };
 assert.equal(selectedStatementDetails([detail], selected).choices[0].value, '3456');
 selected.sender_card_identifier.value = '1234**12';
 assert.match(selectedStatementDetails([detail], selected).error, /three ending digits/);
});
