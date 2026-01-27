
const OTP = require("../models/OTP");
const User = require("../models/User");
const Borrower = require("../models/customer")

const path = require("path");
const Profile = require("../models/Profile");
const Transaction = require("../models/Transaction")
const Loan = require("../models/Loan");
// const CustomerProfile = require("../models/BorrowerProfile");
const bucket = require("../config/firebase");
const { getStorage } = require("firebase-admin/storage");
const mongoose = require("mongoose"); 
const { generateAccountId } = require("../utils/generateAccountId");
const { evaluateLoanByCreditScore } = require("../utils/loanApprovalRules");

// Upload to Firebase Storage
const uploadToFirebase = async (file, baseName, folder = "borrowers") => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!file) return resolve(null);

      // Bucket safety check
      if (!bucket || bucket.isConfigured === false || typeof bucket.file !== "function") {
        console.warn("⚠️ Firebase Storage unavailable. Skipping upload:", baseName);
        return resolve(null);
      }

      const ext = path.extname(file.originalname) || ".jpg";
      const safeBase = baseName.replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `${folder}/${safeBase}_${Date.now()}${ext}`;

      const fileRef = bucket.file(fileName);

      const stream = fileRef.createWriteStream({
        metadata: { contentType: file.mimetype },
        resumable: false,
      });

      stream.on("error", (err) => reject(err));

      stream.on("finish", async () => {
        try {
          await fileRef.makePublic();
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
          resolve(publicUrl);
        } catch (err) {
          reject(err);
        }
      });

      stream.end(file.buffer);

    } catch (err) {
      reject(err);
    }
  });
};


// **Send OTP**
exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    console.log(`OTP for ${phone}:`, otp);

    // Set expiry time (5 minutes from now)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Upsert OTP in MongoDB (insert new or update existing)
    await OTP.findOneAndUpdate(
      { phone },
      { otp, expiresAt },
      { upsert: true, new: true }
    );

    // TODO: Send OTP via SMS provider here (e.g., Africa's Talking)

    res.status(200).json({ message: "OTP sent successfully", otp });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
};



// **Register Customer**

  // change path as needed

exports.registerCustomer = async (req, res) => {
  try {
    console.log("🔥 Reached Customer Register Controller");

    const {
      fullName,
      phone,
      idNumber,
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
      preferences,
      savingsBalance,
      referralSource,
      referredByBorrowerId
    } = req.body;

    // -----------------------------
    // Validate required fields
    // -----------------------------
    if (!fullName || !phone || !idNumber || !req.files?.livePhoto) {
      return res.status(400).json({
        message: "Full name, phone, ID number and Live Photo are required.",
      });
    }

    // -----------------------------
// Referral validation
// -----------------------------
if (!referralSource) {
  return res.status(400).json({
    message: "referralSource is required"
  });
}

if (referralSource === "existing_borrower") {
  if (!referredByBorrowerId) {
    return res.status(400).json({
      message: "referredByBorrowerId is required for existing borrower referral"
    });
  }

  const referredBorrower = await Borrower.findById(referredByBorrowerId);
  if (!referredBorrower) {
    return res.status(404).json({
      message: "Referred borrower not found"
    });
  }
}

    // -----------------------------
    // Check duplicates
    // -----------------------------
    if (await Borrower.findOne({ phone })) {
      return res.status(409).json({ message: "Phone number already registered." });
    }
    if (await Borrower.findOne({ idNumber })) {
      return res.status(409).json({ message: "ID number already registered." });
    }

    // -----------------------------
    // Upload files
    // -----------------------------
    const livePhotoFile = req.files.livePhoto?.[0];
    const frontIDFile = req.files.frontID?.[0];
    const backIDFile = req.files.backID?.[0];

    const livePhotoUrl = await uploadToFirebase(livePhotoFile, "livePhoto");
    const frontIDUrl = await uploadToFirebase(frontIDFile, "frontID");
    const backIDUrl = await uploadToFirebase(backIDFile, "backID");

    const accountId = await generateAccountId();
    // -----------------------------
    // Create borrower record
    // -----------------------------
    const borrower = new Borrower({
      registeredBy: req.user._id,
      registeredByModel: req.user.role === "agent" ? "Agent" : "User",
      agentId: req.user.role === "agent" ? req.user._id : null,
      accountId,
      fullName,
      phone,
      idNumber,

      livePhoto: livePhotoUrl,
      frontID: frontIDUrl,
      backID: backIDUrl,

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
      kraPin,
      agreementAcceptance,
      preferences: preferences || {},
      savingsBalance: savingsBalance || 0,
      referralSource,
      referredByBorrowerId: referralSource === "existing_borrower"
    ? referredByBorrowerId
    : null,
    });

    await borrower.save();

    return res.status(201).json({
      message: "Customer registered successfully.",
      borrower,
    });

  } catch (error) {
    console.error("❌ Error registering customer:", error);
    return res.status(500).json({
      message: "Server error while registering customer.",
      error: error.message,
    });
  }
};


// exports.UpdateBorrowerProfile = async (req, res) => {
//   try {
//     const { customerId } = req.params;
//     const profileData = req.body;

//     // Ensure customer exists
//     const customer = await Borrower.findById(customerId);
//     if (!customer) {
//       return res.status(404).json({ message: "Customer not found" });
//     }

//     // Check if profile already exists
//     let profile = await CustomerProfile.findOne({ customer: customerId });

//     if (profile) {
//       // Update profile
//       profile.set(profileData);
//       await profile.save();
//       return res.json({ message: "Customer profile updated", profile });
//     } else {
//       // Create new profile
//       profile = new CustomerProfile({
//         customer: customerId,
//         ...profileData
//       });
//       await profile.save();
//       return res.status(201).json({ message: "Customer profile created", profile });
//     }
//   } catch (error) {
//     console.error("Error adding/updating profile:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };


// Controller to get all customers
exports.getAllCustomers = async (req, res) => {
  try {
    const customers = await Borrower.find({ isDeleted: false })
      .sort({ createdAt: -1 });

    if (!customers.length) {
      return res.status(404).json({ message: "No customers found" });
    }

    const customersWithExtras = await Promise.all(
      customers.map(async (customer) => {

        // 1️⃣ Fetch all approved loans
        const loans = await Loan.find({
          borrowerId: customer._id,
          loanRequestStatus: "approved"
        }).sort({ issueDate: -1 });

        // 2️⃣ Identify last loan
        const lastLoan = loans[0] || null;

        // 3️⃣ BLOCKLIST LOGIC
        const hasOverdueLoan = loans.some(
          l => l.status === "overdue" || l.isDefaulted === true
        );

        // 4️⃣ REPEATED BORROWER LOGIC
        const isRepeatedBorrower =
          loans.length > 0 &&
          lastLoan &&
          lastLoan.status === "fully paid";

        // 5️⃣ Borrower type
        let borrowerType = "NEW";
        if (hasOverdueLoan) borrowerType = "BLOCKLISTED";
        else if (isRepeatedBorrower) borrowerType = "REPEATED";

        // 6️⃣ Credit score & rating
        const creditScore = lastLoan?.creditScoreAfter || 500;
        const rating = Math.min(
          5,
          Math.max(0, Number((creditScore / 100).toFixed(1)))
        );

        return {
          ...customer.toObject(),
          lastLoanAmount: lastLoan ? lastLoan.amount : 0,
          borrowerType,
          isBlocked: borrowerType === "BLOCKLISTED",
          rating
        };
      })
    );

    res.status(200).json({
      success: true,
      count: customersWithExtras.length,
      customers: customersWithExtras
    });

  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};






// exports.getCustomerWithProfile = async (req, res) => {
//   try {
//     const { id } = req.params; // use `id` instead of `customerId`

//     // 1. Fetch customer core details
//     const customer = await Borrower.findById(id).lean();
//     if (!customer) {
//       return res.status(404).json({ message: "Customer not found" });
//     }

//     // 2. Fetch profile (linked to customer)
//     const profile = await CustomerProfile.findOne({ customer: id }).lean();

//     // 3. Fetch loans
//     const loans = await Loan.find({ borrowerId: id })
//       .sort({ createdAt: -1 })
//       .lean();

//     // 4. Fetch transactions
//     const transactions = await Transaction.find({ borrowerId: id })
//       .sort({ date: -1 })
//       .lean();

//     // 5. Return everything in one response
//     res.status(200).json({
//       customer,
//       profile: profile || null,
//       loans,
//       transactions,
//     });
//   } catch (error) {
//     console.error("Error fetching customer details with profile:", error);
//     res.status(500).json({ message: "Server error", error: error.message });
//   }
// };

// **Get Borrower's Savings Balance**
exports.getSavings = async (req, res) => {
  try {
    const { customerId } = req.params;
    const userId = req.user ? req.user._id : null; // Ensure JWT middleware is set up

    if (!customerId || !userId) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    const customer = await Borrower.findOne({ userId: customerId });
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    if (customer.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.status(200).json({ savingsBalance: customer.savingsBalance });
  } catch (error) {
    console.error("Error fetching savings balance:", error);
    res.status(500).json({ message: "Error fetching savings balance" });
  }
};

// exports.getBorrowerProfile = async (req, res) => {
//   try {
//     // Borrower is already attached by borrowerProtect middleware
//     const borrower = req.borrower;

//     if (!borrower) {
//       return res.status(404).json({ success: false, message: "Borrower not found" });
//     }

//     // Fetch loans related to this borrower
//     const loans = await Loan.find({ borrowerId: borrower._id })
//       .populate("lenderId")           // Populate full lender document
//       .populate("requestedByAgentId") // Populate full agent document
//       .populate("issuedByLenderId");  // Populate full issuedBy lender document

//     res.status(200).json({
//       success: true,
//       borrower, // Entire borrower object
//       loans     // Array of full loan objects
//     });
//   } catch (error) {
//     console.error("Error fetching borrower profile:", error);
//     res.status(500).json({ success: false, message: "Error fetching borrower profile" });
//   }
// };

exports.getBorrowerProfile = async (req, res) => {
  try {
    // Borrower is already attached by borrowerProtect middleware
    const borrower = req.borrower;

    if (!borrower) {
      return res.status(404).json({
        success: false,
        message: "Borrower not found"
      });
    }

    // Fetch loans related to this borrower
    const loans = await Loan.find({ borrowerId: borrower._id })
      .populate("lenderId")
      .populate("requestedByAgentId")
      .populate("issuedByLenderId");

    /* ================= ADDED: DERIVED PROFILE DATA ================= */

    let totalLoanBalance = 0;
    let activeLoanCount = 0;
    let overdueLoanCount = 0;
    let nextDueDate = null;

    loans.forEach((loan) => {
      if (loan.status === "active" || loan.status === "overdue") {
        activeLoanCount++;
        totalLoanBalance += loan.balance || 0;

        if (loan.status === "overdue") {
          overdueLoanCount++;
        }

        if (!nextDueDate || new Date(loan.dueDate) < new Date(nextDueDate)) {
          nextDueDate = loan.dueDate;
        }
      }
    });

    const creditScore = borrower.creditScore || 500;

    const eligibility = evaluateLoanByCreditScore({
      creditScore,
      requestedAmount: borrower.creditLimit || 50000
    });

    const profileSummary = {
      borrowerName: borrower.fullName,
      phone: borrower.phone,
      membershipType: borrower.membershipType || "Silver Member",
      creditScore,
      creditLimit: borrower.creditLimit || eligibility.approvedAmount || 50000,
      eligible: eligibility.allowed,

      loanSummary: {
        activeLoanCount,
        overdueLoanCount,
        totalLoanBalance,
        nextDueDate
      },

      savingsBalance: borrower.savingsBalance || 0
    };

    /* ================= FINAL RESPONSE (UNCHANGED + ADDED) ================= */

    res.status(200).json({
      success: true,
      borrower,          // EXISTING (UNCHANGED)
      loans,             // EXISTING (UNCHANGED)
      profileSummary     // ✅ ADDED
    });

  } catch (error) {
    console.error("Error fetching borrower profile:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching borrower profile"
    });
  }
};


exports.getCustomersWithoutActiveLoans = async (req, res) => {
  try {
    // 1. Find all borrowers who have active loans (these should be EXCLUDED)
    const activeLoanBorrowerIds = await Loan.find({
      $or: [
        { status: "active" },
        { 
          status: "pending", 
          loanRequestStatus: { $in: ["pending", "approved"] } 
        }
      ]
    }).distinct("borrowerId");

    // 2. Find all borrowers who are NOT in the active loans list
    const customersWithoutActiveLoans = await Borrower.find({
      _id: { $nin: activeLoanBorrowerIds }
    });

    // 3. Attach Loan Details to Each Customer (these will only be non-active loans)
    const customersWithLoanDetails = await Promise.all(
      customersWithoutActiveLoans.map(async (customer) => {
        const loanDetails = await Loan.find({ borrowerId: customer._id });
        return {
          ...customer.toObject(),
          loans: loanDetails
        };
      })
    );

    res.status(200).json({
      success: true,
      total: customersWithLoanDetails.length,
      customers: customersWithLoanDetails
    });

  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ message: "Server Error", error });
  }
};



exports.getBorrowerSummary = async (req, res) => {
  try {
    const borrowers = await Borrower.find();

    const summaries = await Promise.all(
      borrowers.map(async (b) => {
        const loans = await Loan.find({
          borrowerId: b._id,
          status: "active"
        });

        const activeLoanBalance = loans.reduce(
          (sum, l) => sum + (l.balance || 0),
          0
        );

        const isDefaulted = loans.some(l => l.isDefaulted === true);

        return {
          borrowerId: b._id,
          fullName: b.fullName,
          creditScore: b.creditScore || 500,
          activeLoanBalance,
          isDefaulted
        };
      })
    );

    res.status(200).json({
      success: true,
      count: summaries.length,
      borrowers: summaries
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


/* =====================================================
   🆕 EDIT BORROWER PROFILE (SAFE UPDATE)
===================================================== */
exports.updateBorrowerProfile = async (req, res) => {
  try {
    const { customerId } = req.params;

    // 1️⃣ Ensure customer exists
    const customer = await Borrower.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        message: "Customer not found"
      });
    }

    // 2️⃣ Fields lender is ALLOWED to update
    const allowedFields = [
      "fullName",
      "altPhoneNumber",
      "physicalAddress",
      "gpsLocation",
      "occupation",
      "monthlyIncomeRange",
      "market",
      "town",
      "nextOfKinName",
      "nextOfKinPhone",
      "status"
    ];

    // 3️⃣ Build safe update object (TEXT FIELDS)
    const updateData = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    /* =====================================================
       🆕 PHOTO UPDATE (ADDITIVE ONLY)
    ===================================================== */

    if (req.files?.livePhoto?.[0]) {
      updateData.livePhoto = await uploadToFirebase(
        req.files.livePhoto[0],
        "livePhoto"
      );
    }

    if (req.files?.frontID?.[0]) {
      updateData.frontID = await uploadToFirebase(
        req.files.frontID[0],
        "frontID"
      );
    }

    if (req.files?.backID?.[0]) {
      updateData.backID = await uploadToFirebase(
        req.files.backID[0],
        "backID"
      );
    }

    // ❌ Nothing to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        message: "No valid fields provided for update"
      });
    }

    // 4️⃣ Partial update (NO validation error)
    const updatedCustomer = await Borrower.findByIdAndUpdate(
      customerId,
      { $set: updateData },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Customer updated successfully",
      customer: updatedCustomer
    });

  } catch (error) {
    console.error("❌ updateBorrowerProfile error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};


exports.getMyLoans = async (req, res) => {
  const { borrowerId } = req.params;

  const loans = await Loan.find({
    borrowerId,
    loanRequestStatus: "approved",
    status: { $in: ["active", "overdue"] }
  });

  const enrichedLoans = loans.map((loan) => {
    const repayments = Array.isArray(loan.repayments) ? loan.repayments : [];

    const totalPaid = repayments.reduce(
      (sum, r) => sum + (r.amount || 0),
      0
    );

    const paymentsMade = repayments.length;

    const averagePayment =
      paymentsMade > 0 ? Math.round(totalPaid / paymentsMade) : 0;

    const lastPayment =
      paymentsMade > 0
        ? repayments.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        : null;

    // ✅ EXISTING: repayment behavior calculation
    const repaymentBehavior = calculateLoan(
      loan.amount,      // principal
      loan.duration,    // repaymentDays
      totalPaid
    );

    const repaymentProgress =
      repaymentBehavior.totalPayable > 0
        ? Math.round(
            (totalPaid / repaymentBehavior.totalPayable) * 100
          )
        : 0;

    // ✅ ADDED: loan eligibility (NO EXISTING CODE CHANGED)
    const eligibility = evaluateLoanByCreditScore({
      creditScore: loan.creditScoreAfter || 500,
      requestedAmount: loan.amount
    });

    return {
      ...loan.toObject(),

      // ================= EXISTING =================
      repaymentBehavior: {
        paymentsMade,
        averagePayment,
        totalPaid,
        remainingBalance: repaymentBehavior.remainingBalance,
        remainingPayments: repaymentBehavior.remainingDays,
        dailyTarget: repaymentBehavior.dailyTarget,
        lastPaymentDate: lastPayment?.date || null,
        repaymentProgress
      },

      // ================= ADDED (SAFE) =================
      loanEligibility: {
        eligible: eligibility.allowed,
        creditScore: loan.creditScoreAfter || 500,
        maxEligibleAmount: eligibility.approvedAmount || 0,
        reason: eligibility.reason || null
      }
    };
  });

  res.json({ loans: enrichedLoans });
};



