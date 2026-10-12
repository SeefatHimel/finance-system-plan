const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Shared runtime helpers live outside the mobile project root.
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, "../finance-contracts"),
];

module.exports = config;
