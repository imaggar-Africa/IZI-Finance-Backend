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
 */
const sendPushNotification = async (pushToken, title, message, data = {}) => {
  try {
    const expo = await getExpoClient();

    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      return;
    }

    let messages = [
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

    let chunks = expo.chunkPushNotifications(messages);
    let tickets = [];

    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error("Error sending push notification chunk:", error);
      }
    }

    return tickets;
  } catch (error) {
    console.error("Push notification error:", error.message);
  }
};

/**
 * Send push notification to user by ID
 */
const sendPushToUser = async (userId, userModel, title, message, data = {}) => {
  try {
    const Model = mongoose.model(userModel);

    const user = await Model.findById(userId).select("expoPushToken fcmToken");

    if (!user) {
      console.error(`User with ID ${userId} and model ${userModel} not found`);
      return;
    }

    const token = user.expoPushToken;

    if (!token) {
      return;
    }

    return await sendPushNotification(
      token,
      title,
      message,
      { ...data, type: data.type || "general" }
    );
  } catch (error) {
    console.error(`Error in sendPushToUser: ${error.message}`);
  }
};

module.exports = {
  sendPushNotification,
  sendPushToUser,
};