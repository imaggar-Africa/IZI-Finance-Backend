const cron = require("node-cron");
const { processSmsQueueRetry } = require("../sms");

// ⏰ Runs every 2 minutes (local dev / server process environment)
if (process.env.FUNCTIONS_EMULATOR !== "true") {
  cron.schedule(
    "*/2 * * * *",
    async () => {
      const startTime = Date.now();
      console.log(
        `⏰ [LOCAL_SMS_RETRY_CRON] Triggered at ${new Date().toISOString()} (Nairobi: ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })})`
      );

      try {
        const result = await processSmsQueueRetry();
        const duration = Date.now() - startTime;
        console.log(
          `✅ [LOCAL_SMS_RETRY_CRON] Finished successfully in ${duration}ms. Processed: ${result.processed}, Sent: ${result.successCount}, Failed: ${result.failedCount}`
        );
      } catch (error) {
        console.error(`❌ [LOCAL_SMS_RETRY_CRON] Failed after ${Date.now() - startTime}ms:`, error.message);
      }
    },
    {
      timezone: "Africa/Nairobi",
    }
  );
}
