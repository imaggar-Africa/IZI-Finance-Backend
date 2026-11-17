const Loan = require("../../models/Loan");
const { sendSMS } = require("../../utils/sms");
const { normalizePhone } = require("../../utils/normalizePhone");
const { applyScoreRecovery } = require("../creditScore");
const Customer = require("../../models/customer");
const Transaction = require("../../models/Transaction");

function nairobiDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

function formatKes(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ⏰ Runs daily 6 PM Nairobi (QStash / Firebase)
async function checkLoansAndSendReminders(specificLoanId = null) {
  const startTime = Date.now();
  console.log(
    `⏰ [LOAN_REMINDER_CRON_LOGIC] Started at ${new Date().toISOString()} (Nairobi: ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })})`
  );

  try {
    const filter = {
      status: { $in: ["active", "overdue"] },
      loanRequestStatus: "approved",
      balance: { $gt: 0 },
    };
    if (specificLoanId) {
      filter._id = specificLoanId;
    }
    const loans = await Loan.find(filter).populate("borrowerId lenderId");

    console.log(`[LOAN_REMINDER_CRON_LOGIC] Found ${loans.length} active/overdue loans with positive balance.`);

    let overdueCount = 0;
    let smsSentCount = 0;

    for (const loan of loans) {
      const now = new Date();

      // Apply initial overdue penalty if needed
      const overdueApplied = await applyOverduePenaltyIfNeeded(loan);
      if (overdueApplied) {
        overdueCount++;
      }

      // Apply monthly penalty if needed
      await applyMonthlyPenaltyIfNeeded(loan);

      // =====================================================
      // DAILY SMS REMINDER
      // =====================================================
      const rawPhone = loan.borrowerId?.phone || loan.borrowerId?.phoneNumber || loan.phoneNumber;
      const borrowerPhone = normalizePhone(rawPhone);

      if (!borrowerPhone) {
        console.warn("[LOAN_REMINDER_CRON_LOGIC] ⚠️ Invalid borrower phone. Skipping SMS for loan:", loan._id);
        continue;
      }

      const lastReminder = loan.lastReminderSentAt || loan.lastReminderSent;
      const todayKey = nairobiDateKey(now);
      const lastKey = lastReminder ? nairobiDateKey(new Date(lastReminder)) : null;
      const shouldSendReminder = !lastReminder || lastKey !== todayKey;

      if (!shouldSendReminder) {
        console.log(
          `[LOAN_REMINDER_CRON_LOGIC] Skip loan ${loan._id}: reminder already sent Nairobi date ${lastKey}`
        );
        continue;
      }

      try {
        const refreshed = await Loan.findById(loan._id).select(
          "balance status dueDate borrowerId"
        );
        const currentBalance = Number(refreshed?.balance ?? loan.balance) || 0;
        if (currentBalance <= 0) continue;

        const borrowerName =
          loan.borrowerId?.fullName || loan.fullName || "Valued Customer";
        const balanceText = formatKes(currentBalance);
        const dueDateFormatted = loan.dueDate
          ? new Date(loan.dueDate).toLocaleDateString("en-KE", {
              timeZone: "Africa/Nairobi",
            })
          : "the due date";
        const statusNow = refreshed?.status || loan.status;

        const messageText =
          statusNow === "overdue"
            ? `IziFinance Late Payment Notice\nHello ${borrowerName}, your loan is overdue.\nCurrent balance: KES ${balanceText}.\nPlease pay immediately. - IziFinance`
            : `IziFinance Reminder\nHello ${borrowerName}, your current loan balance is KES ${balanceText}, due on ${dueDateFormatted}.\nPlease repay on time to avoid penalties. - IziFinance`;

        await sendSMS(borrowerPhone, messageText, {
          job: "loan-reminder",
          template:
            statusNow === "overdue"
              ? "loan_overdue_current_balance"
              : "loan_active_current_balance",
          meta: {
            loanId: String(loan._id),
            balanceKes: currentBalance,
            status: statusNow,
          },
        });
        smsSentCount++;

        loan.lastReminderSentAt = now;
        loan.lastReminderSent = now;
        loan.lastReminderBalance = currentBalance;
        await loan.save();
        console.log(
          `[LOAN_REMINDER_CRON_LOGIC] 📤 Reminder queued loan ${loan._id} → ${borrowerPhone} balance KES ${balanceText}`
        );
      } catch (err) {
        console.error(
          "[LOAN_REMINDER_CRON_LOGIC] SMS sending failed for loan:",
          loan._id,
          err.message
        );
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `✅ [LOAN_REMINDER_CRON_LOGIC] Completed in ${duration}ms. Marked/Updated Overdue: ${overdueCount}, SMS Sent: ${smsSentCount}`
    );
  } catch (error) {
    console.error(`❌ [LOAN_REMINDER_CRON_LOGIC] Failed after ${Date.now() - startTime}ms:`, error.message);
  }
}

/* ======================================================
   ⭐ SCORE RECOVERY CRON
   Runs every day at Midnight
====================================================== */
async function runScoreRecovery() {
  const startTime = Date.now();
  console.log(
    `⏰ [SCORE_RECOVERY_CRON_LOGIC] Started at ${new Date().toISOString()} (Nairobi: ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })})`
  );

  try {
    const customers = await Customer.find({ isDeleted: false });
    console.log(`[SCORE_RECOVERY_CRON_LOGIC] Found ${customers.length} non-deleted customers to check.`);

    let processedCount = 0;
    for (const customer of customers) {
      await applyScoreRecovery(customer);
      processedCount++;
    }

    const duration = Date.now() - startTime;
    console.log(`✅ [SCORE_RECOVERY_CRON_LOGIC] Completed in ${duration}ms. Processed customers: ${processedCount}`);
  } catch (err) {
    console.error(`❌ [SCORE_RECOVERY_CRON_LOGIC] Failed after ${Date.now() - startTime}ms:`, err);
  }
}

// ⏰ Local development scheduling using node-cron
function initLocalCron() {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
  if (!isEmulator && !process.env.FIREBASE_CONFIG) {
    const cron = require("node-cron");
    
    cron.schedule(
      "0 18 * * *",
      checkLoansAndSendReminders,
      {
        timezone: "Africa/Nairobi",
      }
    );

    cron.schedule(
      "0 0 1 * *",
      runScoreRecovery,
      {
        timezone: "Africa/Nairobi",
      }
    );
    console.log("⏰ Local Loan Cron Jobs Scheduled");
  } else {
    console.log("ℹ️ Skipping local cron initialization in emulator environment");
  }
}

async function applyOverduePenaltyIfNeeded(loan) {
  const now = new Date();
  const dueDate = new Date(loan.dueDate);

  if (
    (loan.status === "active" || loan.status === "overdue") &&
    dueDate <= now &&
    !loan.penaltyApplied
  ) {
    const originalPrincipal = loan.amount || 0;
    const penalty = Math.round(originalPrincipal * 0.15);

    loan.status = "overdue";
    loan.balance += penalty;
    loan.penaltyAmount = (loan.penaltyAmount || 0) + penalty;

    loan.penaltyApplied = true;
    loan.penaltyAppliedAt = now;
    loan.lastMonthlyPenaltyAt = now;

    await loan.save();

    const rawPhone = loan.borrowerId?.phone || loan.borrowerId?.phoneNumber;
    const borrowerPhone = normalizePhone(rawPhone) || "";

    await Transaction.create({
      type: "penalty",
      userId: loan.borrowerId?._id || loan.borrowerId,
      userModel: "Customer",
      loanId: loan._id,
      amount: penalty,
      phone: borrowerPhone,
      description: "Initial overdue penalty (15%)",
      status: "successful",
    });

    console.log(
      `⚠️ [LOAN_REMINDER_CRON_LOGIC] Loan ${loan._id} initial penalty of KES ${penalty} added.`
    );
    return true;
  }
  return false;
}

async function applyMonthlyPenaltyIfNeeded(loan) {
  const now = new Date();
  const remainingPrincipal = Math.max(
    0,
    loan.amount - (loan.principalPaid || 0)
  );

  if (
    loan.status === "overdue" &&
    remainingPrincipal > 0 &&
    loan.lastMonthlyPenaltyAt
  ) {
    const lastPenalty = new Date(loan.lastMonthlyPenaltyAt);

    const nextPenaltyDate = new Date(lastPenalty);
    nextPenaltyDate.setMonth(nextPenaltyDate.getMonth() + 1);

    if (now >= nextPenaltyDate) {
      const monthlyPenalty = Math.round(remainingPrincipal * 0.15);

      loan.balance += monthlyPenalty;
      loan.penaltyAmount = (loan.penaltyAmount || 0) + monthlyPenalty;
      loan.lastMonthlyPenaltyAt = now;

      await loan.save();

      const rawPhone = loan.borrowerId?.phone || loan.borrowerId?.phoneNumber;
      const borrowerPhone = normalizePhone(rawPhone) || "";

      await Transaction.create({
        type: "monthly_penalty",
        userId: loan.borrowerId?._id || loan.borrowerId,
        userModel: "Customer",
        loanId: loan._id,
        amount: monthlyPenalty,
        phone: borrowerPhone,
        description: "Monthly overdue penalty (15%)",
        status: "successful",
      });

      console.log(
        `⚠️ [LOAN_REMINDER_CRON_LOGIC] Loan ${loan._id} monthly penalty of KES ${monthlyPenalty} added.`
      );
      return true;
    }
  }
  return false;
}

module.exports = {
  checkLoansAndSendReminders,
  runScoreRecovery,
  initLocalCron,
  applyOverduePenaltyIfNeeded,
  applyMonthlyPenaltyIfNeeded,
};




