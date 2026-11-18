const mongoose = require("mongoose");

let Expo;
let expo;

/**
 * Load Expo SDK dynamically (fix for ESM issue)
 */
const getExpoClient = async () => {
  if (!Expo) {
    const expoModule = await import("expo-server-sdk");
    Expo = expoModule.Expo;
    expo = new Expo();
  }
  return expo;
};

/**
 * Sends a single push notification via Expo.
 * @param {string} pushToken
 * @param {string} title
 * @param {string} message
 * @param {object} data
 * @param {string} [logContext]
 */
const sendPushNotification = async (
  pushToken,
  title,
  message,
  data = {},
  logContext = "push"
) => {
  const meta = { context: logContext, title };
  try {
    const expo = await getExpoClient();

    if (!Expo.isExpoPushToken(pushToken)) {
      console.error("[NOTIFY_PUSH] invalid_token", {
        ...meta,
        tokenPreview: String(pushToken).slice(0, 24),
      });
      return { ok: false, reason: "invalid_token" };
    }

    const messages = [
      {
        to: pushToken,
        sound: "default",
        title: title,
        body: message,
        data: data,
        priority: "high",
        channelId: "default",
      },
    ];

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error("[NOTIFY_PUSH] chunk_error", {
          ...meta,
          error: error.message,
        });
        return { ok: false, reason: "chunk_error", error: error.message };
      }
    }

    const ticketErrors = tickets.filter((t) => t.status === "error");
    if (ticketErrors.length > 0) {
      console.error("[NOTIFY_PUSH] ticket_error", {
        ...meta,
        errors: ticketErrors.map((t) => t.message || t.details),
      });
      return { ok: false, reason: "ticket_error", tickets };
    }

    console.log("[NOTIFY_PUSH] sent", { ...meta, ticketCount: tickets.length });
    return { ok: true, tickets };
  } catch (error) {
    console.error("[NOTIFY_PUSH] error", { ...meta, error: error.message });
    return { ok: false, reason: "exception", error: error.message };
  }
};

/**
 * Send push notification to user by ID
 */
const sendPushToUser = async (
  userId,
  userModel,
  title,
  message,
  data = {},
  logContext = "sendPushToUser"
) => {
  const meta = {
    context: logContext,
    userId: String(userId),
    userModel,
    title,
    type: data.type || "general",
  };
  try {
    const Model = mongoose.model(userModel);

    const user = await Model.findById(userId).select("expoPushToken fcmToken");

    if (!user) {
      console.warn("[NOTIFY_PUSH] skip_user_not_found", meta);
      return { ok: false, reason: "user_not_found" };
    }

    const token = user.expoPushToken;

    if (!token) {
      console.warn("[NOTIFY_PUSH] skip_no_token", meta);
      return { ok: false, reason: "no_expo_token" };
    }

    return await sendPushNotification(
      token,
      title,
      message,
      { ...data, type: data.type || "general" },
      logContext
    );
  } catch (error) {
    console.error("[NOTIFY_PUSH] send_to_user_error", {
      ...meta,
      error: error.message,
    });
    return { ok: false, reason: "exception", error: error.message };
  }
};

module.exports = {
  sendPushNotification,
  sendPushToUser,
};