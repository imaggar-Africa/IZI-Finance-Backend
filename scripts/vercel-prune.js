#!/usr/bin/env node
/**
 * Drop heavy optional deps before Vercel packages the serverless function (<250MB).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const targets = [
  path.join(root, "node_modules", "puppeteer"),
  path.join(root, "node_modules", "puppeteer-core"),
  path.join(root, "node_modules", "@puppeteer"),
  path.join(root, "functions", "node_modules", "puppeteer"),
  path.join(root, "functions", "node_modules", "puppeteer-core"),
  path.join(root, "functions", "node_modules", "@puppeteer"),
];

for (const dir of targets) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("vercel-prune: removed", path.relative(root, dir));
  }
}
