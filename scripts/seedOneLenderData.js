const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Load models
const User = require("../functions/models/User");
const Profile = require("../functions/models/Profile");
const connectDB = require("../functions/config/db");

async function seedOneLender() {
  try {
    console.log("⏳ Connecting to Database...");
    await connectDB();
    console.log("✅ Database connected.");

    const lenderPhone = "+254700000000";
    const lenderName = "IZI Finance Official Lender";

    // 1. Check if lender already exists
    let user = await User.findOne({ phone: lenderPhone });

    if (user) {
      console.log(`⚠️ Lender with phone ${lenderPhone} already exists. Skipping user creation.`);
    } else {
      console.log("🚀 Creating new Lender User...");
      
      // Hash password (default: password123)
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("password123", salt);

      user = await User.create({
        name: lenderName,
        phone: lenderPhone,
        accountType: "company",
        role: "lender",
        kycStatus: "approved",
        password: hashedPassword,
        isPhoneVerified: true,
        walletBalance: 1000000, // Seed with some initial balance
      });

      console.log(`✅ User created: ${user.name} (ID: ${user._id})`);
    }

    // 2. Create or Update Profile
    let profile = await Profile.findOne({ userId: user._id });

    if (profile) {
      console.log("⚠️ Profile already exists for this user. Skipping profile creation.");
    } else {
      console.log("🚀 Creating Lender Profile...");
      profile = await Profile.create({
        userId: user._id,
        fullName: lenderName,
        phone: lenderPhone,
        idNumber: "LEND-001-IZI", // Dummy ID number
        isVerified: true,
        selfie: "https://api.dicebear.com/7.x/avataaars/svg?seed=lender", // Placeholder avatar
      });
      console.log(`✅ Profile created for: ${profile.fullName}`);
    }

    console.log("\n==============================");
    console.log("🎉 SEEDING COMPLETED SUCCESSFULLY");
    console.log(`Lender ID: ${user._id}`);
    console.log(`Phone: ${lenderPhone}`);
    console.log(`Password: password123`);
    console.log("==============================\n");

  } catch (error) {
    console.error("❌ Seeding failed:", error);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log("🔌 Database connection closed.");
    }
    process.exit(0);
  }
}

seedOneLender();
