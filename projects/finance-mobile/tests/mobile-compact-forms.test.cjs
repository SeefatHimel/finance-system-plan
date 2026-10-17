const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nativeHarness, input, button, text, React, create, act } = require('./helpers/native-harness.cjs');
const accounts = [{ id: 'bank', name: 'Demo bank', currency: 'BDT', is_active: true }, { id: 'wallet', name: 'Demo wallet', currency: 'BDT', is_active: true }];
const categories = [{ id: 'expense', name: 'Demo expense', kind: 'expense' }, { id: 'transfer', name: 'Demo transfer', kind: 'transfer' }];
const methods = [{ id: 'card', name: 'Demo card', account: 'bank' }];
const layout = async (tree, width) => act(async () => {
  for (const grid of tree.root.findAllByType('View').filter(node => node.props.onLayout)) grid.props.onLayout({ nativeEvent: { layout: { width } } });
});
const choose = async (tree, label, value) => {
  await act(async () => button(tree, label).props.onPress());
  await act(async () => button(tree, value).props.onPress());
};

test('actual container width and enlarged text change columns without remounting inputs or an open selector', async () => {
  const h = nativeHarness(), { CompactFields } = h.load('compact-form'), { SearchSelect } = h.load('mobile-ui');
  let tree;
  function Probe() {
    const [value, setValue] = React.useState('');
    return React.createElement(CompactFields, null,
      React.createElement('TextInput', { key: 'value', accessibilityLabel: 'Draft', value, onChangeText: setValue }),
      React.createElement(SearchSelect, { key: 'account', label: 'Account', value: 'bank', options: accounts, onChange() {} }));
  }
  await act(async () => { tree = create(React.createElement(Probe)); });
  const field = input(tree, 'Draft');
  await act(async () => field.props.onChangeText('Retained across columns'));
  await act(async () => button(tree, 'Account: Demo bank').props.onPress());
  const search = input(tree, 'Search account');
  await act(async () => search.props.onChangeText('wallet'));
  for (const [width, columns] of [[280, 1], [580, 2], [900, 3]]) {
    await layout(tree, width);
    const grid = tree.root.findAllByType('View').find(node => node.props.onLayout);
    assert.equal(grid.children[0].props.style.width, (width - 12 * (columns - 1)) / columns);
    assert.equal(input(tree, 'Draft'), field); assert.equal(field.props.value, 'Retained across columns');
    assert.equal(input(tree, 'Search account'), search); assert.equal(search.props.value, 'wallet');
    assert.equal(tree.root.findAllByType('Modal').length, 1);
  }
  h.resize({ fontScale: 2 });
  await act(async () => tree.update(React.createElement(Probe)));
  assert.equal(tree.root.findAllByType('View').find(node => node.props.onLayout).children[0].props.style.width, 900);
  assert.equal(input(tree, 'Draft'), field);
  await act(async () => tree.unmount());
});

test('review retains optional edits, exact date/time and zero balance through collapse, busy state, resize and type correction', async () => {
  const h = nativeHarness(), { ReviewFields } = h.load('review-fields'), { updateReviewBalanceContext } = h.load('review-balance');
  let tree, current;
  function Probe({ busy = false, error = '' }) {
    const [draft, setDraft] = React.useState({ accountId: 'bank', transactionType: 'expense', categoryId: 'expense', direction: 'debit', transferAccountId: 'wallet', amount: '100.00', balanceAfter: '0.00', balanceAccountId: 'bank', balanceNotice: '', date: '2026-10-01', time: '15:42:17', reference: '', note: '', counterpartyText: 'Demo', paymentMethodId: 'card' });
    current = draft;
    return React.createElement(ReviewFields, { draft, accounts, categories, paymentMethods: methods, busy, error, onChange: patch => setDraft(value => updateReviewBalanceContext(value, patch)) });
  }
  await act(async () => { tree = create(React.createElement(Probe)); });
  assert.equal(button(tree, 'More details').props.accessibilityState.expanded, false);
  await act(async () => button(tree, 'More details').props.onPress());
  const note = input(tree, 'Note'), date = tree.root.findByType('NativeDateField'), time = tree.root.findByType('NativeTimeField');
  await act(async () => { note.props.onChangeText('Retained note'); input(tree, 'Reference').props.onChangeText('DEMO-REFERENCE'); date.props.onChange('2026-10-02'); time.props.onChange('16:07:29'); });
  await act(async () => button(tree, 'More details').props.onPress());
  for (const width of [280, 600, 960]) { await layout(tree, width); assert.equal(input(tree, 'Note'), note); }
  await act(async () => tree.update(React.createElement(Probe, { busy: true })));
  assert.equal(tree.root.findByType('NativeDateField'), date); assert.equal(date.props.disabled, true);
  await act(async () => tree.update(React.createElement(Probe)));
  await choose(tree, 'Transaction type: Expense', 'Transfer');
  assert.match(text(tree), /Clear the category/);
  await act(async () => button(tree, 'Use Transfer').props.onPress());
  assert.equal(current.transactionType, 'transfer'); assert.equal(current.transferAccountId, 'wallet');
  for (const [key, value] of Object.entries({ balanceAfter: '0.00', note: 'Retained note', reference: 'DEMO-REFERENCE', paymentMethodId: 'card', date: '2026-10-02', time: '16:07:29' })) assert.equal(current[key], value);
  await act(async () => tree.update(React.createElement(Probe, { error: 'Reference: needs correction' })));
  assert.equal(button(tree, 'More details').props.accessibilityState.expanded, true); assert.equal(input(tree, 'Note'), note);
  await act(async () => tree.unmount());
});

test('manual entry uses searchable names, retains collapsed drafts and hides the other account outside transfers', async () => {
  const h = nativeHarness(), { ManualEntryFields } = h.load('manual-entry-fields');
  let tree, current;
  function Probe() {
    const [draft, setDraft] = React.useState({ account: 'bank', category: '', type: 'expense', direction: 'debit', transfer_account: 'wallet', amount: '125.50', balance_after: '0.00', date: '2026-10-01', time: '17:07:33', note: '', counterparty_text: '' }); current = draft;
    return React.createElement(ManualEntryFields, { draft, accounts, categories, busy: false, onChange: patch => setDraft(value => ({ ...value, ...patch })) });
  }
  await act(async () => { tree = create(React.createElement(Probe)); });
  assert.ok(button(tree, 'Reporting account: Demo bank'));
  const otherVisible = () => tree.root.findAllByType('Pressable').some(node => node.props.accessibilityLabel?.startsWith('Other transfer account'));
  assert.equal(otherVisible(), false);
  await act(async () => button(tree, 'More details').props.onPress());
  const note = input(tree, 'Note'); await act(async () => note.props.onChangeText('Unsent full entry'));
  await act(async () => button(tree, 'More details').props.onPress());
  await layout(tree, 900); await layout(tree, 280);
  await choose(tree, 'Transaction type: Expense', 'Transfer');
  assert.ok(button(tree, 'Other transfer account · To: Demo wallet'));
  assert.equal(input(tree, 'Note'), note); assert.equal(current.note, 'Unsent full entry'); assert.equal(current.balance_after, '0.00'); assert.equal(current.time, '17:07:33');
  await choose(tree, 'Transaction type: Transfer', 'Expense');
  assert.equal(current.transfer_account, 'wallet'); assert.equal(otherVisible(), false);
  await act(async () => tree.unmount());
});

test('transfer edit keeps both balances and linked consent through layout changes and submits the edited patch', async () => {
  const row = { id: 'demo-entry', type: 'transfer', account: 'bank', transfer_account: 'wallet', direction: 'debit', amount: '100.00', date: '2026-10-01', time: '15:42:17', category: 'transfer', payment_method: null, reference: '', counterparty_text: '', note: '', needs_review: false, balance_after: '0.00', balance_reporting_account: 'bank', reported_balances: [{ account: 'bank', balance_after: '0.00' }, { account: 'wallet', balance_after: '200.07' }], transfer_evidence: [{ account: 'bank', balance_after: '0.00', is_primary: true }, { account: 'wallet', balance_after: '200.07', is_primary: false }], updated_at: '2026-10-01T12:00:00Z', source: 'sms', statement_evidence_count: 1 };
  let tree, saved, posts = 0;
  const h = nativeHarness({ getTransaction: async () => row, getTransactionSourceMessages: async () => [], getTransactionStatements: async () => [], updateTransaction: async (_token, _id, patch) => { posts++; saved = patch; return { ...row, ...patch }; } });
  const { TransactionEditor } = h.load('transaction-editor');
  const props = { id: row.id, token: 'demo-token', scope: 'demo-owner', accounts, categories, paymentMethods: methods, onClose() {}, onSaved() {} };
  await act(async () => { tree = create(React.createElement(TransactionEditor, props)); });
  await act(async () => button(tree, 'More details').props.onPress());
  const note = input(tree, 'Note'), date = tree.root.findByType('NativeDateField');
  await act(async () => { note.props.onChangeText('Edited and retained'); input(tree, 'Reference').props.onChangeText('DEMO-REF'); input(tree, 'Amount').props.onChangeText('125.50'); input(tree, 'Reported balance after · Demo wallet').props.onChangeText('250.07'); });
  const ack = () => tree.root.findAllByType('Pressable').find(node => node.props.accessibilityRole === 'checkbox' && node.findAllByType('Text').some(t => String(t.props.children).includes('I reviewed')));
  assert.ok(ack()); await act(async () => ack().props.onPress());
  await act(async () => button(tree, 'More details').props.onPress());
  for (const width of [280, 580, 920]) await layout(tree, width);
  h.resize({ fontScale: 1.8 }); await act(async () => tree.update(React.createElement(TransactionEditor, { ...props, token: 'demo-refreshed' })));
  assert.equal(input(tree, 'Note'), note); assert.equal(tree.root.findByType('NativeDateField'), date); assert.equal(ack().props.accessibilityState.checked, true);
  await act(async () => button(tree, 'Save changes').props.onPress());
  assert.equal(posts, 1); assert.equal(saved.allow_linked_correction, true); assert.equal(saved.note, 'Edited and retained'); assert.equal(saved.reference, 'DEMO-REF'); assert.equal(saved.amount, '125.50');
  assert.deepEqual(saved.reported_balances, [{ account: 'bank', balance_after: '0.00' }, { account: 'wallet', balance_after: '250.07' }]);
  await act(async () => tree.unmount());
});
