#!/usr/bin/env node
/**
 * Local smoke tests for cron auth (no QStash network). After deploy, use QSTASH.md § Test.
 */
const { authorizeCron, resolveJobSlug } = require("../api/cron/authorize");

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function run() {
  const prev = {
    CRON_SECRET: process.env.CRON_SECRET,
    QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY,
    QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY,
  };

  process.env.CRON_SECRET = "smoke-test-secret";
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;

  const req = {
    headers: {},
    url: "/api/cron/loan-reminder",
    query: { job: "loan-reminder" },
  };

  const slug = resolveJobSlug(req);
  if (slug !== "loan-reminder") {
    console.error("resolveJobSlug failed:", slug);
    process.exit(1);
  }

  const res1 = mockRes();
  const ok1 = await authorizeCron(req, res1);
  if (ok1 || res1.statusCode !== 401) {
    console.error("Expected 401 without auth, got", res1.statusCode, res1.body);
    process.exit(1);
  }

  req.headers.authorization = "Bearer smoke-test-secret";
  const res2 = mockRes();
  const ok2 = await authorizeCron(req, res2);
  if (!ok2) {
    console.error("Expected CRON_SECRET to pass");
    process.exit(1);
  }

  Object.assign(process.env, prev);
  console.log("qstash-smoke: OK (resolveJobSlug + CRON_SECRET path)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});