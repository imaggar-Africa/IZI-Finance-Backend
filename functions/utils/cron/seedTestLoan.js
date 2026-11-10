const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../../../.env") });

const mongoUri =
  process.env.MONGO_URI ||
  "mongodb+srv://dinesh7733_db_user:yD80Ojyk1mH5DBCP@cluster0.dcdunbi.mongodb.net/Izifinance?retryWrites=true&w=majority&appName=Cluster0";

const Loan = require("../../models/Loan");
const Customer = require("../../models/customer");
const User = require("../../models/User");

async function seed() {
  try {
    console.log("Connecting to MongoDB Atlas...");
    await mongoose.connect(mongoUri);
    console.log("Connected successfully.");

    // 1. Find an active lender to attach the customer and loan to
    let lender = await User.findOne({ role: "lender" });
    if (!lender) {
      lender = await User.findOne({});
    }

    const lenderId = lender ? lender._id : new mongoose.Types.ObjectId();
    const lenderPhone = lender?.phone || "+254710962545";
    console.log(`Using Lender: ${lender?.fullName || "Default Lender"} (ID: ${lenderId})`);

    const phone = "+254742702362";
    const idNumber = "28308844";

    // 2. Find or create Customer
    let customer = await Customer.findOne({
      $or: [{ phone }, { idNumber }],
    });

    if (!customer) {
      console.log(`Customer with phone ${phone} or ID ${idNumber} not found. Creating new customer...`);
      customer = await Customer.create({
        fullName: "David Customer",
        phone: phone,
        idNumber: idNumber,
        status: "Active",
        isVerified: true,
        creditScore: 500,
        creditLevel: "High Risk",
        registeredBy: lenderId,
        registeredByModel: "User",
      });
      console.log("✅ Customer created successfully with ID:", customer._id);
    } else {
      console.log(`Found existing customer: ${customer.fullName} (${customer._id}). Updating phone and ID...`);
      customer.phone = phone;
      customer.idNumber = idNumber;
      customer.status = "Active";
      customer.isVerified = true;
      await customer.save();
      console.log("✅ Customer details updated.");
    }

    // 3. Create active loan for this customer
    const now = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const loanAmount = 5000;
    const interest = 1000;
    const totalRepayment = loanAmount + interest;

    const loanData = {
      lenderId: lenderId,
      borrowerId: customer._id,
      fullName: customer.fullName,
      phoneNumber: customer.phone,
      lenderPhone: lenderPhone,
      clientId: idNumber,
      billRefNumber: idNumber,
      amount: loanAmount,
      interest: interest,
      totalRepayment: totalRepayment,
      dailyRepayment: Math.round(totalRepayment / 30),
      repaidAmount: 0,
      balance: totalRepayment,
      principalPaid: 0,
      duration: 30,
      repaymentPlan: "daily",
      issueDate: now,
      dueDate: dueDate,
      status: "active",
      loanRequestStatus: "approved",
      penaltyApplied: false,
      penaltyAmount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const newLoan = await Loan.create(loanData);
    console.log("✅ Seeded loan successfully with ID:", newLoan._id);

    // Update customer loan balance
    customer.loanBalance = totalRepayment;
    await customer.save();

    console.log("\n================ SEEDED DETAILS ================");
    console.log("Customer ID   :", customer._id.toString());
    console.log("Full Name     :", customer.fullName);
    console.log("Phone Number  :", customer.phone);
    console.log("National ID   :", customer.idNumber);
    console.log("Loan ID       :", newLoan._id.toString());
    console.log("BillRefNumber :", newLoan.billRefNumber);
    console.log("Loan Balance  : KES", newLoan.balance);
    console.log("Due Date      :", newLoan.dueDate.toISOString().split("T")[0]);
    console.log("================================================\n");

  } catch (error) {
    console.error("❌ Error seeding customer/loan data:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

seed();
