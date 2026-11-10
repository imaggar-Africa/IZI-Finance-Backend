const { sendSMS, sendSMSDirect, processSmsQueueRetry } = require("../utils/sms");
const SmsQueue = require("../models/SmsQueue");

/**
 * Test SMS route
 * POST /api/sms/send-sms
 */
exports.testSMS = async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ success: false, message: "phone and message are required" });
  }

  const result = await sendSMS(
    phone,
    message
  );

  res.json(result);
};

/**
 * Get SMS Queue with filtering and pagination
 * GET /api/sms/queue
 */
exports.getSmsQueue = async (req, res) => {
  try {
    const { status, phoneNumber, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status) {
      query.status = status;
    }
    if (phoneNumber) {
      // Partial regex match for phone number searching
      query.phoneNumber = { $regex: phoneNumber, $options: "i" };
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skipNum = (pageNum - 1) * limitNum;

    const total = await SmsQueue.countDocuments(query);
    const messages = await SmsQueue.find(query)
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum);

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      data: messages,
    });
  } catch (error) {
    console.error("❌ Error fetching SMS Queue:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Manually retry a specific SMS by ID
 * POST /api/sms/retry/:id
 */
exports.retrySmsMessage = async (req, res) => {
  try {
    const { id } = req.params;

    const smsRecord = await SmsQueue.findById(id);
    if (!smsRecord) {
      return res.status(404).json({ success: false, message: "SMS record not found" });
    }

    if (smsRecord.status === "Sent") {
      return res.json({ success: true, message: "SMS is already sent", data: smsRecord });
    }

    console.log(`Manual retry requested for SMS ID: ${id} to: ${smsRecord.phoneNumber}`);
    
    // We attempt sending. It might throw, which is caught below.
    try {
      await sendSMSDirect(smsRecord);
      res.json({
        success: true,
        message: "SMS successfully sent on manual retry",
        data: smsRecord,
      });
    } catch (sendErr) {
      res.status(500).json({
        success: false,
        message: `SMS attempt failed: ${sendErr.message}`,
        status: smsRecord.status,
        retryCount: smsRecord.retryCount,
        errorDetails: smsRecord.errorDetails,
      });
    }
  } catch (error) {
    console.error("❌ Error retrying SMS:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Manually trigger retry of all failed/waiting/pending messages
 * POST /api/sms/retry-all
 */
exports.retryAllFailedOrWaiting = async (req, res) => {
  try {
    const result = await processSmsQueueRetry();
    res.json({
      success: true,
      message: "Batch SMS retry processing completed",
      result,
    });
  } catch (error) {
    console.error("❌ Error in batch SMS retry:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};