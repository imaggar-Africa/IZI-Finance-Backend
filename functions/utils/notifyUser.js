const Notification = require("../models/Notification");

/**
 * Create in-app notification; push is sent from Notification post-save hook.
 * @param {object} opts
 * @param {string} [opts.context] - source tag for Vercel logs (e.g. c2b_repayment)
 */
async function notifyUser({
  userId,
  userModel,
  title,
  message,
  type = "general",
  context = "notify",
}) {
  const meta = {
    context,
    userId: String(userId),
    userModel,
    type,
    title,
  };
  console.log("[NOTIFY] start", meta);

  try {
    const doc = await Notification.create({
      userId,
      userModel,
      title,
      message,
      type,
    });
    console.log("[NOTIFY] in_app_ok", {
      ...meta,
      notificationId: String(doc._id),
    });
    return { ok: true, notificationId: doc._id };
  } catch (err) {
    const validation =
      err.errors && typeof err.errors === "object"
        ? Object.fromEntries(
            Object.entries(err.errors).map(([k, v]) => [k, v.message])
          )
        : undefined;
    console.error("[NOTIFY] in_app_error", {
      ...meta,
      error: err.message,
      validation,
    });
    return { ok: false, error: err.message, validation };
  }
}

module.exports = { notifyUser };