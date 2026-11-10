const cron = require("node-cron");
const { runReconciliation } = require("../reconciliationService");

// ⏰ Runs once a day at 6 PM (local dev / server process environment)
if (process.env.FUNCTIONS_EMULATOR !== "true") {
  cron.schedule(
    "0 18 * * *",
    async () => {
      console.log(
        "⏰ M-Pesa Reconciliation cron triggered:",
        new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })
      );

      try {
        const result = await runReconciliation();
        console.log(`✅ Reconciliation cron finished. Processed: ${result.processed}, Recovered: ${result.recoveredCount}, Failed: ${result.failedCount}`);
      } catch (error) {
        console.error("❌ Error in Reconciliation cron job:", error.message);
      }
    },
    {
      timezone: "Africa/Nairobi",
    }
  );
}
