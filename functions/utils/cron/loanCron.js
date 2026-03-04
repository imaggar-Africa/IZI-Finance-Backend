const cron = require("node-cron");
const Loan = require("../../models/Loan");
const { sendSMS } = require("../../utils/sms");
const { normalizePhone } = require("../../utils/normalizePhone");

// ⏰ Runs every day at 6 AM and 6 PM (Kenya/Nairobi time)
cron.schedule(
  "0 6,18 * * *",
  async () => {
    console.log(
      "⏰ Reminder & Overdue cron triggered:",
      new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })
    );

    try {
      const activeLoans = await Loan.find({
        status: "active",
        balance: { $gt: 0 },
      }).populate("borrowerId lenderId");

      for (const loan of activeLoans) {
        const now = new Date();

        // 🔹 Nairobi time for accurate comparison
        const nairobiTime = new Date(
          now.toLocaleString("en-US", { timeZone: "Africa/Nairobi" })
        );

        const dueDate = new Date(loan.dueDate);

        // 🔹 Step 1: Mark overdue
        if (dueDate < nairobiTime && loan.status === "active" && loan.balance > 0) {
          loan.status = "overdue";
          loan.updatedAt = now;
          await loan.save();

          console.log(
            `⚠️ Loan ${loan._id} marked OVERDUE | Due: ${dueDate} | Now: ${nairobiTime}`
          );
        }

        // 🔹 Step 2: Send reminder SMS
        const rawPhone =
          loan.borrowerId?.phone || loan.borrowerId?.phoneNumber;

        const borrowerPhone = normalizePhone(rawPhone);

        if (!borrowerPhone) {
          console.warn("⚠️ Invalid borrower phone. Skipping SMS for loan:", loan._id);
          continue;
        }

        const lastReminder = loan.lastReminderSent || loan.updatedAt;
        const hoursSinceLastReminder =
          (now - lastReminder) / (1000 * 60 * 60);

        // ✅ Only send once every 24 hours
        if (hoursSinceLastReminder >= 24) {
          let lastRepaymentDate = "No repayment yet";

          if (loan.repayments?.length > 0) {
            lastRepaymentDate =
              loan.repayments[loan.repayments.length - 1].date.toDateString();
          }

          const borrowerMessage = `⏰ Reminder: Your loan balance is KES ${
            loan.balance
          }. Last repayment: ${lastRepaymentDate}. Please pay before ${loan.dueDate.toDateString()} to avoid penalties. Loan ID: ${
            loan._id
          }`;

          console.log("📩 Sending reminder SMS to:", borrowerPhone);

          await sendSMS(borrowerPhone, borrowerMessage);

          // ✅ Update reminder timestamp
          await Loan.updateOne(
            { _id: loan._id },
            { $set: { lastReminderSent: now } }
          );

          console.log(
            `✅ Reminder sent | Loan ${loan._id} | Phone ${borrowerPhone}`
          );
        }
      }
    } catch (error) {
      console.error("❌ Error in reminder/overdue cron:", error.message);
    }
  },
  {
    timezone: "Africa/Nairobi", // 🟢 Correct timezone
  }
);


