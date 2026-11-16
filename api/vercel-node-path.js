/**
 * Resolve deps from api/node_modules on Vercel (same as api/index.js).
 */
const path = require("path");
const Module = require("module");

const projectRoot = path.join(__dirname, "..");
const moduleSearchPaths = [
  path.join(projectRoot, "api", "node_modules"),
  path.join(projectRoot, "node_modules"),
];
const existingNodePath = process.env.NODE_PATH
  ? process.env.NODE_PATH.split(path.delimiter)
  : [];
process.env.NODE_PATH = [...existingNodePath, ...moduleSearchPaths].join(
  path.delimiter
);
Module._initPaths();