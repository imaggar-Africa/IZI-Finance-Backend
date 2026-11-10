const express = require("express");
const router = express.Router();
const jsonParser = express.json({ limit: "10mb" });
const customerController = require("../controllers/customerController");

const { protect, borrowerProtect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");
const { validateAfricaPhone } = require("../middleware/validateAfricaPhone");
const busboyMiddleware = require("../middleware/busboyMiddleware");
const firebaseSafeUpload = require("../utils/upload");
// const firebaseSafeUpload = require("../middleware/firebaseSafeUpload");



router.get("/eligible-loan", protect, customerController.getCustomersWithoutActiveLoans)
// Register a new borrower with ID photos
// Upload 3 files with fields
// Enhanced customer registration with proper error handling

// Register a new borrower with ID photos - USING BUSBOY
// Register a new borrower with ID photos - USING BUSBOY WITH RAW BODY
// Register a borrower with 3 files
router.post(
  "/register",
  protect,
  authorizeRoles("lender","agent"),
  firebaseSafeUpload([
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 },
    { name: "livePhoto", maxCount: 1 },
  ]),
  //  validateAfricaPhone,

  customerController.registerCustomer
);

router.post(
  "/initiate-registration-otps",
  protect,
  authorizeRoles("lender", "agent"),
  jsonParser,
  customerController.sendRegistrationOTPs
);





router.get("/findAll", protect, customerController.getAllCustomers);
// GET customer details by ID
// router.get("/:id",protect, customerController.getCustomerWithProfile);

// Add or update profile
// router.post("/:customerId/profile", customerController.UpdateBorrowerProfile);
// Get borrower savings balance
router.get("/savings/:customerId", customerController.getSavings);

router.get("/summary", protect, customerController.getBorrowerSummary);


router.get("/login/profile", borrowerProtect, customerController.getBorrowerProfile)

router.put(
  "/:customerId",
  protect,
  authorizeRoles("lender"),
  firebaseSafeUpload([
    { name: "livePhoto", maxCount: 1 },
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 }
  ]),
  customerController.updateBorrowerProfile
);

router.get(
  "/:borrowerId",
  borrowerProtect,
  customerController.getMyLoans
);

// Toggle manual block for customer
router.patch(
  "/:customerId/toggle-block",
  protect,
  authorizeRoles("lender"),
  jsonParser,
  customerController.toggleBlockCustomer
);

module.exports = router;