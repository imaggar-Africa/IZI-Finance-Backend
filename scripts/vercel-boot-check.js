#!/usr/bin/env node
/**
 * Simulates Vercel cold start: loads api/index.js like production.
 * Run: npm run check:vercel-boot
 */
const path = require("path");

process.env.VERCEL = "1";
process.env.IZI_RUNTIME = "vercel";
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const root = path.join(__dirname, "..");

try {
  delete require.cache[require.resolve(path.join(root, "api", "index.js"))];
} catch (_) {
  /* first run */
}

try {
  require(path.join(root, "api", "index.js"));
  console.log("\n✅ Vercel boot check passed (api/index.js loaded).\n");
} catch (err) {
  console.error("\n❌ Vercel boot check failed:\n");
  console.error(err.message);
  if (err.stack) console.error(err.stack);
  console.error(
    "\nTip: run `npm run check:vercel-deps` and fix missing packages in package.json / ensure-vercel-deps.js\n",
  );
  process.exit(1);
}
