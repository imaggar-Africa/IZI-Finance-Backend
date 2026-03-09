const { Queue } = require("bullmq");
const bullRedis = require("./redis");

const smsQueue = new Queue("sms-queue", {
  connection: bullRedis,
  defaultJobOptions: {
    attempts: 10,
    backoff: {
      type: "exponential",
      delay: 60 * 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

module.exports = smsQueue;