const asyncHandler = require("express-async-handler");
const Borrower = require("../models/customer")
const bcrypt = require("bcryptjs");
const AgentModel = require("../models/AgentModel");
const { issueSession, signAccess } = require("../utils/tokens-redis");
const OTP = require("../models/OTP");
const uploadToFirebase = require("../utils/uploadToFirebase");
const Loan = require("../models/Loan");
const { normalizePhone } = require("../utils/normalizePhone");
const { generateAccountId } = require("../utils/generateAccountId");

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

    /* ================= PARSE & NORMALIZE ================= */

    const gpsLocation =
      req.body.gpsLocation_lat && req.body.gpsLocation_lng
        ? {
            lat: Number(req.body.gpsLocation_lat),
            lng: Number(req.body.gpsLocation_lng),
          }
        : undefined;

    const savingsGoal = req.body.savingsGoal
      ? Number(req.body.savingsGoal)
      : 0;

    const loanConsent = req.body.loanConsent === "true";
    const agreementAcceptance = req.body.agreementAcceptance === "true";

    /* ================= EXTRACT BODY ================= */

    let {
      idNumber,
      fullName,
      phone,
      email,
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
      savingsBalance,
      kraPin,

      educationLevel,
      householdSize,
      loanPurpose,
      deviceType,

      referralSource,
      referredByBorrowerId
    } = req.body;

    /* ================= ROLE CHECK ================= */

    if (!["agent", "lender", "admin"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied: cannot register customer"
      });
    }

    /* ================= TYPE SAFETY ================= */

    fullName = String(fullName || "").trim();
    email = String(email || "").toLowerCase().trim();
    idNumber = String(idNumber || "").trim();

    const rawPhone =
      Array.isArray(phone)
        ? phone[0]
        : typeof phone === "object"
        ? phone.value || phone.phone || ""
        : phone;

    const normalizedPhone = normalizePhone(String(rawPhone).trim());

    if (!normalizedPhone) {
      return res.status(400).json({
        message:
          "Invalid phone format. Supported countries: Kenya (+254), Uganda (+256), Tanzania (+255), Rwanda (+250), Nigeria (+234), Ghana (+233)"
      });
    }

    /* ================= REQUIRED VALIDATION ================= */

    if (
      !fullName ||
      !normalizedPhone ||
      !email ||
      !idNumber ||
      !educationLevel ||
      !householdSize ||
      !loanPurpose ||
      !deviceType
    ) {
      return res.status(400).json({
        message:
          "Full name, phone, email, ID number, education level, household size, loan purpose, device type are required"
      });
    }

    /* ================= FILE VALIDATION ================= */

    if (
      !req.files?.frontID?.[0] ||
      !req.files?.backID?.[0] ||
      !req.files?.livePhoto?.[0]
    ) {
      return res.status(400).json({
        message: "Front ID, Back ID and Live Photo are required"
      });
    }

    /* ================= DATA VALIDATION ================= */

    const householdSizeNum = Number(householdSize);
    if (isNaN(householdSizeNum) || householdSizeNum < 1) {
      return res.status(400).json({
        message: "householdSize must be a valid number greater than 0"
      });
    }

    const allowedEducationLevels = [
      "None",
      "Primary",
      "Secondary",
      "Diploma",
      "Graduate",
      "Postgraduate"
    ];
    if (!allowedEducationLevels.includes(educationLevel)) {
      return res.status(400).json({ message: "Invalid education level" });
    }

    const allowedDeviceTypes = ["Android", "iOS", "Web", "USSD", "Other"];
    if (!allowedDeviceTypes.includes(deviceType)) {
      return res.status(400).json({ message: "Invalid device type" });
    }

    /* ================= REFERRAL VALIDATION ================= */

    if (!referralSource) {
      return res.status(400).json({ message: "referralSource is required" });
    }

    if (referralSource === "existing_borrower") {
      if (!referredByBorrowerId) {
        return res.status(400).json({
          message: "referredByBorrowerId is required"
        });
      }

      const referredBorrower = await Borrower.findById(referredByBorrowerId);
      if (!referredBorrower) {
        return res.status(404).json({
          message: "Referred borrower not found"
        });
      }
    }

    /* ================= DUPLICATE CHECK ================= */

    if (await Borrower.findOne({ phone: normalizedPhone }))
      return res.status(409).json({ message: "Phone already registered" });

    if (await Borrower.findOne({ email }))
      return res.status(409).json({ message: "Email already registered" });

    if (await Borrower.findOne({ idNumber }))
      return res.status(409).json({ message: "ID number already registered" });

    /* ================= FILE UPLOAD ================= */

    const frontIDUrl = await uploadToFirebase(req.files.frontID[0], "frontID");
    const backIDUrl = await uploadToFirebase(req.files.backID[0], "backID");
    const livePhotoUrl = await uploadToFirebase(
      req.files.livePhoto[0],
      "livePhoto"
    );

    const accountId = await generateAccountId();

    /* ================= CREATE BORROWER ================= */

    const borrower = await Borrower.create({
      registeredBy: req.user._id,
      registeredByModel: req.user.role === "agent" ? "Agent" : "User",
      agentId: req.user.role === "agent" ? req.user._id : null,
      accountId,

      fullName,
      phone: normalizedPhone,
      email,
      idNumber,

      livePhoto: livePhotoUrl,
      frontID: frontIDUrl,
      backID: backIDUrl,

      isVerified: true,
      status: "Active",

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
      kraPin,
      agreementAcceptance,

      preferences: preferences || {},
      savingsBalance: savingsBalance || 0,

      referralSource,
      referredByBorrowerId:
        referralSource === "existing_borrower"
          ? referredByBorrowerId
          : null,

      educationLevel,
      householdSize: householdSizeNum,
      loanPurpose,
      deviceType,

      creditScore: 500,
      creditLevel: "High Risk",
      maxLoanLimit: 1000,
      totalLoans: 0,
      completedLoans: 0,
      overdueLoans: 0,
      lastScoreUpdate: new Date()
    });

    /* ================= AGENT LINK ================= */

    if (req.user.role === "agent") {
      const agent = await AgentModel.findById(req.user._id);
      if (agent) await agent.addCustomer(borrower._id);
    }

    return res.status(201).json({
      success: true,
      message: "Customer registered successfully",
      borrower
    });

  } catch (error) {
    console.error("❌ Error registering customer:", error);
    return res.status(500).json({
      success: false,
      message: "Error registering customer",
      error: error.message
    });
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
