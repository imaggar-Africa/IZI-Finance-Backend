const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const User = require("../models/User");
const Transaction = require("../models/Transaction");

async function check() {
  const uri = process.env.MONGO_URI;
  console.log("Connecting to:", uri);
  await mongoose.connect(uri);
  console.log("Connected");

  const userId = "69253c627b9bb3283aeba7ee";
  const user = await User.findById(userId);
  console.log("User:", user ? {
    id: user._id,
    phone: user.phone,
    walletBalance: user.walletBalance,
    role: user.role
  } : "Not found");

  const tx = await Transaction.findOne({ checkoutRequestID: "94aa-4db8-b709-8bbeab719ae07292" });
  console.log("Transaction:", tx);

  await mongoose.disconnect();
}

check().catch(console.error);
