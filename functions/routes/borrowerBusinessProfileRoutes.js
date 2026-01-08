const express = require("express");
const router = express.Router();
const controller = require("../controllers/borrowerBusinessProfileController");
const { protect } = require("../middleware/authMiddleware");

// Create business profile
router.post(
  "/:borrowerId/business-profile",
  controller.createBusinessProfile
);

// Get business profile
router.get(
  "/:borrowerId/business-profile",
  controller.getBusinessProfile
);

// update business profile

router.put(
  "/:borrowerId/business-profile",
  controller.updateBusinessProfile
);


module.exports = router;
