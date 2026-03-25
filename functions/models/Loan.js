const mongoose = require("mongoose");


const loanSchema = new mongoose.Schema({
  lenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  borrowerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  requestedByAgentId: { type: mongoose.Schema.Types.ObjectId, ref: "Agent" }, // Agent who requested
  issuedByLenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Lender who approved

  clientId: { type: String }, // National ID for M-Pesa BillRef
  fullName: String,
  phoneNumber: String,
  lenderPhone: String,

  amount: { type: Number, required: true, min: 0 },
  interest: { type: Number, min: 0 },
  // fee: { type: Number, required: true, min: 0 },
  totalRepayment: { type: Number, min: 0 },
  dailyRepayment: { type: Number, min: 0 },
  repaymentPlan: {
    type: String,
    enum: ["daily", "weekly", "monthly"]
  },


  repaidAmount: { type: Number, default: 0 },
  balance: { type: Number, default: function () { return this.totalRepayment; } },

  duration: { type: Number, min: 1 },
  issueDate: { type: Date, default: Date.now },
  dueDate: { type: Date },
  billRefNumber: { type: String }, // National ID used for repayment

  status: { type: String, enum: ["pending", "active", "fully paid", "overdue"] },
  // ✅ New loan request status
  loanRequestStatus: { type: String, enum: ["borrower_pending", "agent_rejected", "pending", "initiated", "processing", "failed", "approved", "rejected"], default: "pending" },
  rejectReason: { type: String, default: null },
  repayments: [
    {
      transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
        required: true
      },
      loanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Loan",
        required: true
      },
      borrowerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
        required: true
      },
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      date: {
        type: Date,
        required: true
      },
      expectedPaymentDate: {
        type: Date,
        required: true
      },
      wasPaymentLate: {
        type: Boolean,
        required: true
      },
      daysLate: {
        type: Number,
        required: true,
        min: 0
      },
      creditScoreDelta: Number
    }
  ],
  creditScoreAfter: {
    type: Number,
    default: 500
  }, isDefaulted: {
    type: Boolean,
    default: false
  },



  // 🔹 Add this field for reminders
  lastReminderSent: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});





// ✅ Indexes for Dashboard performance
loanSchema.index({ lenderId: 1, status: 1 });
loanSchema.index({ lenderId: 1, loanRequestStatus: 1 });
loanSchema.index({ dueDate: 1 });
loanSchema.index({ requestedByAgentId: 1 });
loanSchema.index({ createdAt: 1 });

// Update the `updatedAt` field before saving
loanSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// ✅ Create and export the model
const Loan = mongoose.model("Loan", loanSchema);
module.exports = Loan;