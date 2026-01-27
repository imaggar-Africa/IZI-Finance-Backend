const asyncHandler = require("express-async-handler");
const Borrower = require("../models/customer")
const bcrypt = require("bcryptjs");
const AgentModel = require("../models/AgentModel");
const { issueSession, signAccess } = require("../utils/tokens-redis");
const OTP = require("../models/OTP");
const uploadToFirebase = require("../utils/uploadToFirebase");
const Loan = require("../models/Loan");

// @desc    Register a new agent (by lender)
// @route   POST /api/agents
// @access  Private (Lender only)






const registerAgent = async (req, res) => {
  try {
    const lenderId = req.user._id; // from protect middleware
    const { name, phone, password } = req.body;
    console.log("ph:",phone);
    
    if (!name || !phone || !password) {
      return res.status(400).json({ message: "Please provide name, phone, and password" });
    }

        // ✅ Password must be exactly 6 digits (numbers only)
    const passwordRegex = /^\d{6}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        message: "Password must be exactly 6 digits and contain only numbers (e.g., 123456)"
      });
    }
    // Only lenders can register agents
    if (req.user.role !== "lender") {
      console.log();
      
      return res.status(403).json({ message: "Only lenders can register agents" });
    }

    // Check if phone already exists
    const existingAgent = await AgentModel.findOne({ phone });
    if (existingAgent) {
      return res.status(400).json({ message: "Agent with this phone number already exists" });
    }
const plainPassword = password; // keep a copy
    // Create agent
    const agent = await AgentModel.create({
      lenderId,
      name,
      role:"agent",
      phone,
      password
    });

    if (agent) {
      return res.status(201).json({
        _id: agent._id,
        name: agent.name,
        phone: agent.phone,
        password: plainPassword ,// return it safely
        status: agent.status,
        totalCustomers: agent.totalCustomers,
        totalEarnings: agent.totalEarnings,
        role: agent.role
      });
    } else {
      return res.status(400).json({ message: "Invalid agent data" });
    }
  } catch (error) {
    console.error("Error registering agent:", error);
    return res.status(500).json({ message: "Server error while registering agent" });
  }
};




const changePassword = asyncHandler(async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = req.agent || req.user;

    if (!user) {
      return res.status(401).json({ message: "Not authorized" });
    }

    // 🔍 DEBUG: Check the user object thoroughly
    console.log("🔍 USER OBJECT DEBUG:", {
      id: user._id,
      role: user.role,
      phone: user.phone,
      name: user.name,
      hasPassword: !!user.password,
      passwordValue: user.password,
      passwordType: typeof user.password,
      allKeys: Object.keys(user.toObject ? user.toObject() : user)
    });

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: "Please provide old and new password" });
    }

    if (!/^\d{6}$/.test(newPassword)) {
      return res.status(400).json({
        message: "New password must be exactly 6 digits"
      });
    }

    // 🔍 DEBUG: Check what's happening with password comparison
    console.log("🔍 PASSWORD COMPARISON DEBUG:", {
      oldPasswordProvided: oldPassword,
      newPasswordProvided: newPassword,
      storedPasswordExists: !!user.password,
      storedPasswordLength: user.password?.length,
      storedPasswordPreview: user.password ? `${user.password.substring(0, 20)}...` : 'NULL'
    });

    let isMatch = false;

    // If password is missing, we can't compare
    if (!user.password) {
      console.log("❌ ERROR: User password is undefined or null");
      return res.status(500).json({ 
        message: "Password not set for this account. Please contact administrator." 
      });
    }

    // Try direct bcrypt comparison as fallback
    try {
      const bcrypt = require('bcryptjs');
      console.log("🔄 Attempting direct bcrypt comparison...");
      isMatch = await bcrypt.compare(oldPassword, user.password);
      console.log("✅ Direct bcrypt comparison result:", isMatch);
    } catch (bcryptError) {
      console.error("❌ Direct bcrypt comparison failed:", bcryptError);
      
      // If bcrypt fails, check if it's because the password isn't hashed
      if (user.password === oldPassword) {
        console.log("⚠️ Password matches directly (not hashed)");
        isMatch = true;
      } else {
        isMatch = false;
      }
    }

    if (!isMatch) {
      return res.status(401).json({ message: "Old password is incorrect" });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    console.log("✅ Password changed successfully for user:", user._id);
    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("❌ Error changing password:", error);
    res.status(500).json({ message: "Server error while changing password" });
  }
});




const loginAgent = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: "Phone and password are required" });
    }

    // Find agent with password field
    const agent = await AgentModel.findOne({ phone }).select("+password");
    if (!agent) return res.status(401).json({ message: "Invalid credentials" });

    // Verify password
    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    // Check agent status
    if (agent.status !== "Active") {
      return res.status(403).json({ message: "Agent is inactive. Contact lender." });
    }

    // Generate access token
    const accessToken = signAccess({ sub: agent._id.toString(), role: agent.role });

    // Generate refresh token (store in DB or session store)
    const { refreshToken } = await issueSession(agent._id.toString(), {
      ua: req.get("user-agent"),
      ip: req.ip
    });

    return res.status(200).json({
      message: "Login successful",
      accessToken,
      refreshToken,
      agent: {
        id: agent._id,
        name: agent.name,
        phone: agent.phone,
        role: agent.role
      }
    });
  } catch (err) {
    console.error("Agent login error:", err);
    return res.status(500).json({ message: "Error logging in" });
  }
};



const getCustomersForAgent  = async (req, res) => {
     console.log("👉 AUTH USER:", req.user);

  try {
    let customers;

    if (req.user.role === "agent") {
      customers = await Borrower.find({ agentId: req.user._id }).sort({ createdAt: -1 });
    } else if (["admin", "lender"].includes(req.user.role)) {
      customers = await Borrower.find().sort({ createdAt: -1 });
    } else {
      return res.status(403).json({ error: "Access denied" });
    }

    res.status(200).json({
      message: "Customers retrieved successfully",
      total: customers.length,
      customers
    });

  } catch (error) {
    res.status(500).json({ error: "Error retrieving customers" });
  }
};


const registerCustomer = async (req, res) => {
  try {
    console.log("✅ Incoming files:", req.files);
    console.log("✅ Incoming body:", req.body);

    // Parse nested / typed fields
 const gpsLocation =
      req.body.gpsLocation_lat && req.body.gpsLocation_lng
        ? {
            lat: Number(req.body.gpsLocation_lat),
            lng: Number(req.body.gpsLocation_lng),
          }
        : undefined; // ← SAFE: No NaN stored

    const savingsGoal = req.body.savingsGoal ? parseFloat(req.body.savingsGoal) : 0;
    const loanConsent = req.body.loanConsent === "true";
    const agreementAcceptance = req.body.agreementAcceptance === "true";

    const {
      idNumber,
      fullName,
      phone,
      dateOfBirth,
      gender,
      maritalStatus,
      altPhoneNumber,
      physicalAddress,
      occupation,
      monthlyIncomeRange,
      nextOfKinName,
      nextOfKinPhone,
      preferredMobileMoney,
      preferences,
      savingsBalance
    } = req.body;

    const registeredBy = req.user._id;
    const registeredByModel = req.user.role === "agent" ? "Agent" : "User";

    // ✅ Role check
    if (!["agent", "lender", "admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied: cannot register customer" });
    }

    // ✅ Validate required fields
    if (!idNumber || !fullName || !phone) {
      return res.status(400).json({ error: "FullName, ID number, phone are required" });
    }

    // ✅ Validate files
    const files = req.files;
    if (!files?.frontID?.[0] || !files?.backID?.[0] || !files?.livePhoto?.[0]) {
      return res.status(400).json({ error: "Front ID, Back ID, and Live Photo are required" });
    }

    // ✅ Upload files to Firebase
    const frontIDUrl = await uploadToFirebase(files.frontID[0], "frontID");
    const backIDUrl = await uploadToFirebase(files.backID[0], "backID");
    const livePhotoUrl = await uploadToFirebase(files.livePhoto[0], "livePhoto");

    // ✅ Check duplicates
    if (await Borrower.findOne({ phone })) return res.status(409).json({ error: "Phone number already registered" });
    if (await Borrower.findOne({ idNumber })) return res.status(409).json({ error: "ID number already registered" });

    // ✅ Create customer
    const customer = new Borrower({
      registeredBy,
      registeredByModel,
      agentId: req.user.role === "agent" ? registeredBy : null,
      fullName,
      phone,
      idNumber,
      frontID: frontIDUrl,
      backID: backIDUrl,
      livePhoto: livePhotoUrl,
      isVerified: true,
      dateOfBirth,
      gender,
      maritalStatus,
      altPhoneNumber,
      physicalAddress,
      gpsLocation,
      occupation,
      monthlyIncomeRange,
      nextOfKinName,
      nextOfKinPhone,
      preferredMobileMoney,
      savingsGoal,
      loanConsent,
      kraPin: req.body.kraPin,
      agreementAcceptance,
      preferences: preferences || {},
      savingsBalance: savingsBalance || 0
    });

    await customer.save();

    // ✅ Update agent's customers
    if (req.user.role === "agent") {
      const agent = await AgentModel.findById(registeredBy);
      if (agent) await agent.addCustomer(customer._id);
    }

    res.status(201).json({
      message: "Customer registered and verified successfully",
      customer
    });

  } catch (error) {
    console.error("Error registering customer:", error);
    res.status(500).json({ error: "Error registering customer" });
  }
};




const getAgentProfile = asyncHandler(async (req, res) => {
  // Agent is set by protect middleware
  const agent = await AgentModel.findById(req.user._id)
    .select("-password")
    .populate("customers");

  if (!agent) {
    return res.status(404).json({ message: "Agent not found" });
  }

  /* =====================================================
     📊 DASHBOARD CALCULATIONS (NO FLOW CHANGE)
  ===================================================== */

  // 1️⃣ Loans issued by this agent (APPROVED ONLY)
  const issuedLoans = await Loan.find({
    requestedByAgentId: agent._id,
    loanRequestStatus: "approved"
  });

  const loansIssuedAmount = issuedLoans.reduce(
    (sum, loan) => sum + (loan.amount || 0),
    0
  );

  // 2️⃣ Pending loan requests by this agent
  const pendingRequests = await Loan.countDocuments({
    requestedByAgentId: agent._id,
    loanRequestStatus: "pending"
  });

  // 3️⃣ Agent tier (simple rule — can be enhanced later)
  let agentTier = "Bronze Agent";
  if (agent.totalCustomers >= 20) agentTier = "Silver Agent";
  if (agent.totalCustomers >= 50) agentTier = "Gold Agent";

  // 4️⃣ Rating (safe fallback)
  const rating =
    agent.totalCustomers > 0
      ? Math.min(5, Number((agent.totalCustomers / 5).toFixed(1)))
      : 0;

  /* =====================================================
     ✅ FINAL RESPONSE (ADDITIVE ONLY)
  ===================================================== */
  res.status(200).json({
    agent, // ✅ EXISTING DATA (UNCHANGED)

    dashboardSummary: {
      agentId: `AG-${agent._id.toString().slice(-5)}`,
      agentTier,
      rating,

      wallet: {
        availableBalance: agent.walletBalance || 0,
        lastUpdated: agent.updatedAt
      },

      stats: {
        totalCustomers: agent.customers.length,
        loansIssuedAmount,   // ✅ REAL DB VALUE
        pendingRequests      // ✅ REAL DB VALUE
      }
    }
  });
});


module.exports = { registerAgent ,changePassword,loginAgent , registerCustomer ,getAgentProfile,getCustomersForAgent };
