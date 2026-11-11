#!/usr/bin/env node
/**
 * Drop heavy optional deps before Vercel packages the serverless function (<250MB).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pruneRoots = [
  path.join(root, "node_modules"),
  path.join(root, "functions", "node_modules"),
  path.join(root, "api", "node_modules"),
];

const heavy = ["puppeteer", "puppeteer-core", "@puppeteer"];

const targets = [];
for (const base of pruneRoots) {
  for (const name of heavy) {
    targets.push(path.join(base, name));
  }
}

for (const dir of targets) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("vercel-prune: removed", path.relative(root, dir));
  }
}
