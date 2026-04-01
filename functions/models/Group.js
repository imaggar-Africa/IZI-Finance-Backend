const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    location: String,

    lenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent"
    },
  group_leader_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer"
  },

  member_count: {
    type: Number,
    default: 0
  },



  status: {
    type: String,
    enum: ["pending", "active", "completed", "defaulted"],
    default: "pending"
  },

   shofco_facility_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Loan"
  },

  /* ===============================
     GROUP LOAN DETAILS
  =============================== */
  loan_amount: { type: Number, default: 0 },
  interest_rate: { type: Number, default: 0 }, // monthly interest as decimal e.g. 0.005 for 0.5%
  duration_months: { type: Number, default: 0 },
  total_interest: { type: Number, default: 0 },
  total_repayment: { type: Number, default: 0 },
  remaining_loan_balance: { type: Number, default: 0 },
  monthly_repayment_to_lender: { type: Number, default: 0 },
  collected_pool_balance: { type: Number, default: 0 },

  },
  { timestamps: true }
);

module.exports = mongoose.model("Group", groupSchema);
