#!/usr/bin/env node
/**
 * Lists npm packages required under functions/ and verifies they are declared
 * in root and/or functions package.json (for Vercel + Firebase).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const functionsDir = path.join(root, "functions");

const builtins = new Set([
  "assert", "buffer", "child_process", "cluster", "constants", "crypto",
  "dgram", "dns", "events", "fs", "http", "http2", "https", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline",
  "repl", "stream", "string_decoder", "timers", "tls", "tty", "url", "util",
  "v8", "vm", "worker_threads", "zlib",
]);

const requireRe =
  /require\s*\(\s*["']([^"']+)["']\s*\)|from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function packageName(spec) {
  if (spec.startsWith(".")) return null;
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split("/")[0];
}

function walkJsFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsFiles(full, out);
    else if (ent.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const required = new Set();
for (const file of walkJsFiles(functionsDir)) {
  const src = fs.readFileSync(file, "utf8");
  let m;
  while ((m = requireRe.exec(src))) {
    const spec = m[1] || m[2] || m[3];
    const name = packageName(spec);
    if (name && !builtins.has(name)) required.add(name);
  }
}

// firebase-functions/* only used by Firebase entry (functions/index.js), not Vercel api/
required.delete("firebase-functions");

const rootDeps = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).dependencies;
const funcDeps = JSON.parse(
  fs.readFileSync(path.join(root, "functions", "package.json"), "utf8"),
).dependencies;

const missingRoot = [];
const missingBoth = [];

for (const name of [...required].sort()) {
  const inRoot = Boolean(rootDeps[name]);
  const inFunc = Boolean(funcDeps[name]);
  if (!inRoot && !inFunc) missingBoth.push(name);
  else if (!inRoot && inFunc) missingRoot.push(name);
}

const modulePaths = [
  path.join(root, "node_modules"),
  path.join(root, "functions", "node_modules"),
];
const prev = process.env.NODE_PATH;
process.env.NODE_PATH = modulePaths.join(path.delimiter);
require("module").Module._initPaths();

const resolveFails = [];
for (const name of [...required].sort()) {
  try {
    require.resolve(name, { paths: modulePaths });
  } catch {
    resolveFails.push(name);
  }
}
process.env.NODE_PATH = prev;

console.log("\n=== Vercel / functions dependency audit ===\n");
console.log(`Packages referenced in functions/**/*.js: ${required.size}`);
console.log([...required].sort().join(", "));

if (missingBoth.length) {
  console.log("\n❌ Not in root OR functions package.json:");
  missingBoth.forEach((p) => console.log("  -", p));
}

if (missingRoot.length) {
  console.log("\n⚠️ In functions/package.json only — add to root package.json:");
  missingRoot.forEach((p) => console.log("  -", p));
}

if (resolveFails.length) {
  console.log("\n❌ Cannot resolve (run npm install && npm install --prefix functions):");
  resolveFails.forEach((p) => console.log("  -", p));
  process.exitCode = 1;
} else {
  console.log("\n✅ All referenced packages resolve locally.");
}

if (missingRoot.length || missingBoth.length) {
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log("✅ All packages declared in root package.json.");
}
