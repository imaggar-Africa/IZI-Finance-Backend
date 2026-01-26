require("dotenv").config(); // 👈 ADD THIS LINE FIRST
const mongoose = require("mongoose");
const Customer = require("../functions/models/customer");
const { generateAccountId } = require("../functions/utils/generateAccountId");

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error("❌ MONGO_URI not found in environment");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const customers = await Customer.find({ accountId: { $exists: false } });

  for (const c of customers) {
    c.accountId = await generateAccountId();
    await c.save();
    console.log(`Updated ${c.fullName} → ${c.accountId}`);
  }

  console.log("✅ Migration complete");
  process.exit();
}

run();
