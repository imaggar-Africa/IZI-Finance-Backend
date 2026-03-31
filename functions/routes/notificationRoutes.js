const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { protect, borrowerProtect } = require("../middleware/authMiddleware");

// Fetch all notifications for a user
router.get("/", protect,notificationController.getUnreadNotifications);

// Create a new notification
router.post("/",protect, notificationController.markAllAsRead);

// Delete a notification
router.delete("/:id",protect, notificationController.softDeleteNotification);

router.patch(
  "/:notificationId",
  protect, 
  notificationController.markOneAsRead
);


router.get("/borrower", borrowerProtect, notificationController.getBorrowerNotifications);

router.put("/borrower/read", borrowerProtect,  notificationController.markBorrowerNotificationAsRead);

router.delete("/borrower/:id", borrowerProtect, notificationController.deleteBorrowerNotification);

// 🆕 Update Expo Push Token (Supports both Lender/Agent and Borrower)
router.post("/push-token", (req, res, next) => {
  // Try to use protect first, if it fails because of no token, then it might be a borrower token
  // But wait, the middlewares usually return 401 if they fail.
  // We can just check which header is present or try sequentially.
  // Actually, we can define two routes or one with a combined middleware.
  next();
}, protect, notificationController.updatePushToken);

router.post("/borrower/push-token", borrowerProtect, notificationController.updatePushToken);

module.exports = router;

