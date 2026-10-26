const { test } = require("node:test");
const assert = require("node:assert/strict");
const { nativeHarness, React, create, act } = require("./helpers/native-harness.cjs");

test("appearance reaches shared actions, optional controls and native date inputs", async () => {
  const h = nativeHarness();
  const { MobileThemeProvider } = h.load("mobile-theme");
  const { ActionButton } = h.load("mobile-ui");
  const { Disclosure } = h.load("disclosure");
  const { NativeDateField } = h.load("native-time-field");
  let tree;
  function render(isLight) {
    return React.createElement(MobileThemeProvider, { isLight },
      React.createElement(React.Fragment, null,
        React.createElement(ActionButton, { label: "Check", onPress() {} }),
        React.createElement(Disclosure, { label: "More details" }, React.createElement("Text", null, "Saved value")),
        React.createElement(NativeDateField, { label: "Due date", value: "2026-10-26", onChange() {} }),
      ));
  }
  await act(async () => { tree = create(render(true)); });
  const buttons = tree.root.findAllByType("Pressable");
  assert.equal(buttons[0].props.style[0].backgroundColor, "#e1f1ea");
  assert.equal(buttons[1].props.style.backgroundColor, "#e1f1ea");
  assert.equal(tree.root.findByType("TextInput").props.style[0].backgroundColor, "#ffffff");
  await act(async () => tree.update(render(false)));
  const darkButtons = tree.root.findAllByType("Pressable");
  assert.equal(darkButtons[0].props.style[0].backgroundColor, "#153747");
  assert.equal(darkButtons[1].props.style.backgroundColor, "#153747");
  assert.equal(tree.root.findByType("TextInput").props.style[0].backgroundColor, "#0a1725");
  await act(async () => tree.unmount());
});
