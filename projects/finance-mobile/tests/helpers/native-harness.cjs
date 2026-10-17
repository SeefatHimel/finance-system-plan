const { readFileSync, existsSync } = require("node:fs");
const { resolve } = require("node:path");
const ts = require("typescript"),
  React = require("react");
const { create, act } = require("react-test-renderer");
global.IS_REACT_ACT_ENVIRONMENT = true;
function nativeHarness(api = {}, os = "android") {
  const listeners = new Set(),
    cache = new Map();
  const native = Object.fromEntries(
    [
      "ActivityIndicator",
      "KeyboardAvoidingView",
      "Pressable",
      "ScrollView",
      "Text",
      "TextInput",
      "View",
    ].map((name) => [name, name]),
  );
  let dimensions = { width: 390, height: 844, scale: 1, fontScale: 1 };
  native.useWindowDimensions = () => dimensions;
  native.Platform = { OS: os };
  native.StyleSheet = { create: (value) => value };
  native.AppState = {
    addEventListener: (_name, callback) => {
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    },
  };
  native.Modal = ({ visible, ...props }) =>
    visible ? React.createElement("Modal", props) : null;
  native.FlatList = (props) =>
    React.createElement(
      "FlatList",
      props,
      props.ListHeaderComponent,
      props.data.length
        ? props.data.map((item) =>
            React.createElement(
              React.Fragment,
              { key: props.keyExtractor(item) },
              props.renderItem({ item }),
            ),
          )
        : props.ListEmptyComponent,
    );
  function load(file) {
    file = resolve(file);
    if (!existsSync(file)) file += existsSync(file + ".tsx") ? ".tsx" : ".ts";
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    new Function("module", "exports", "require", code)(
      mod,
      mod.exports,
      (name) => {
        if (name === "react" || name === "react/jsx-runtime")
          return require(name);
        if (name === "react-native") return native;
        if (name === "react-native-safe-area-context")
          return { SafeAreaView: "SafeAreaView" };
        if (name === "./api") return api;
        if (name === "./native-time-field")
          return {
            NativeDateField: "NativeDateField",
            NativeTimeField: "NativeTimeField",
          };
        return load(resolve(file, "..", name));
      },
    );
    return mod.exports;
  }
  return {
    load: (file) => load(resolve(__dirname, "../../src", file)),
    resize: (patch) => { dimensions = { ...dimensions, ...patch }; },
    resume: () => listeners.forEach((callback) => callback("active")),
  };
}
const input = (tree, label) =>
  tree.root
    .findAllByType("TextInput")
    .find((node) => node.props.accessibilityLabel === label);
const button = (tree, label) =>
  tree.root
    .findAllByType("Pressable")
    .find((node) => node.props.accessibilityLabel === label);
const text = (tree) =>
  tree.root
    .findAllByType("Text")
    .map((node) =>
      []
        .concat(node.props.children)
        .filter(
          (value) => typeof value === "string" || typeof value === "number",
        )
        .join(""),
    )
    .join("\n");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
module.exports = {
  nativeHarness,
  input,
  button,
  text,
  deferred,
  React,
  create,
  act,
};
