#!/usr/bin/env node
/**
 * Writes api/package.json for a self-contained Vercel runtime node_modules (all transitives).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const runtimeList = JSON.parse(
  fs.readFileSync(path.join(__dirname, "vercel-runtime-deps.json"), "utf8"),
);
const rootPkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const rootDeps = rootPkg.dependencies || {};

const dependencies = {};
const missing = [];

for (const name of runtimeList) {
  if (rootDeps[name]) {
    dependencies[name] = rootDeps[name];
  } else {
    missing.push(name);
  }
}

if (missing.length) {
  console.error(
    "sync-vercel-api-deps: missing from root package.json:",
    missing.join(", "),
  );
  process.exit(1);
}

const apiPkg = {
  name: "izi-vercel-api-runtime",
  private: true,
  version: "1.0.0",
  dependencies,
};

const outPath = path.join(root, "api", "package.json");
fs.writeFileSync(outPath, `${JSON.stringify(apiPkg, null, 2)}\n`, "utf8");
console.log(
  `sync-vercel-api-deps: wrote ${path.relative(root, outPath)} (${runtimeList.length} deps)`,
);
