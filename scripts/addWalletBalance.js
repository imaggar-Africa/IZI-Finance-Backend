const mongoose = require("mongoose");
mongoose.set("strictQuery", false);

// 🔥 Import your existing DB connection config (update path)
require("../functions/config/db.js");

// 🧩 Load the Agent model AFTER DB is initialized
const Agent = require("../functions/models/AgentModel");

async function run() {
  try {
    console.log("⏳ Waiting for DB connection...");

    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s to register schemas

    console.log("🚀 Running update...");

    const result = await Agent.updateMany(
      { walletBalance: { $exists: false } },
      { $set: { walletBalance: 0 } }
    );

    console.log("📌 Done:");
    console.log(`Matched: ${result.matchedCount}`);
    console.log(`Modified: ${result.modifiedCount}`);

  } catch (err) {
    console.error("❌ ERROR:", err);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 DB closed");
  }
}

run();
