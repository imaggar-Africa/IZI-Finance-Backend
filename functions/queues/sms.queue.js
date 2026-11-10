const { Queue } = require("bullmq");
const bullRedis = require("./redis");

let _smsQueue = null;

const getSmsQueue = () => {
  if (_smsQueue) return _smsQueue;

  _smsQueue = new Queue("sms-queue", {
    connection: bullRedis,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  });

  return _smsQueue;
};

// Export a Proxy that delegates to the lazy-loaded Queue instance
const proxy = new Proxy({}, {
  get: (target, prop) => {
    const queue = getSmsQueue();
    const val = queue[prop];
    return typeof val === 'function' ? val.bind(queue) : val;
  }
});

module.exports = proxy;