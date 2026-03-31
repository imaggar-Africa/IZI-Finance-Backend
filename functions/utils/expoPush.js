const { Expo } = require("expo-server-sdk");
const mongoose = require("mongoose");

// Create a new Expo SDK client
let expo = new Expo();

/**
 * Sends a single push notification via Expo.
 * @param {string} pushToken - The target's Expo push token.
 * @param {string} title - The notification title.
 * @param {string} message - The notification body.
 * @param {object} [data] - Optional metadata.
 */
const sendPushNotification = async (pushToken, title, message, data = {}) => {
  // Check that all your push tokens appear to be valid Expo push tokens
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Push token ${pushToken} is not a valid Expo push token`);
    return;
  }

  // Create the messages that you want to send to clients
  let messages = [];
  messages.push({
    to: pushToken,
    sound: "default",
    title: title,
    body: message,
    data: data,
    priority: "high",
    channelId: "default",
  });

  // The Expo push notification service accepts batches of notifications.
  // Quota limits apply. 
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

  // NOTE: You can also handle receipts here (delivery status) but for many apps, 
  // sending the notification to Expo service is sufficient.
  return tickets;
};

/**
 * Resolves a model and sends a push notification to a user by ID.
 * @param {string} userId - Target user ID string or ObjectId.
 * @param {string} userModel - One of "User", "Customer", "Agent".
 * @param {string} title - The notification title.
 * @param {string} message - The notification message.
 * @param {object} [data] - Optional metadata.
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
      // console.log(`No expoPushToken found for user ${userId} (${userModel})`);
      return;
    }

    return await sendPushNotification(token, title, message, { ...data, type: data.type || "general" });
  } catch (error) {
    console.error(`Error in sendPushToUser: ${error.message}`);
  }
};

module.exports = {
  sendPushNotification,
  sendPushToUser,
};
