const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { submitCompanyKYC, reviewCompanyKYC } = require("../controllers/companyKycController");
const firebaseSafeUpload = require("../utils/upload");
const authorizeRoles = require("../middleware/rolemiddleware");


router.post(
  "/",
  protect,
 authorizeRoles("lender"),
  firebaseSafeUpload([
    { name: "certificate", maxCount: 1 },
    { name: "signatoryId", maxCount: 1 },
    { name: "companyLogo", maxCount: 1 },
  ]),
  submitCompanyKYC
);

router.post(
  "/review",
  protect,
  reviewCompanyKYC
);

module.exports = router;
