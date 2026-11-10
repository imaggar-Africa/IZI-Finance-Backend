const express = require("express");
const router = express.Router();
const jsonParser = express.json({ limit: "10mb" });


const { registerAgent, changePassword,CustomersForAgent, loginAgent, registerCustomer, getAgentProfile, getCustomersForAgent, sendRegistrationOTPs } = require("../controllers/agentController");
const { protect, agentProtect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware.js");
// Get upload from app locals
const { validateAfricaPhone } = require("../middleware/validateAfricaPhone.js");
const firebaseSafeUpload = require("../utils/upload.js");
// const handleMulterErrors = require("../utils/upload.js")
// Register agent (lender only


router.post(
  "/register/customer",
    protect,
  authorizeRoles("agent","lender"),

  firebaseSafeUpload([
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 },
    { name: "livePhoto", maxCount: 1 },
  ]),

  registerCustomer
);

router.post(
  "/initiate-registration-otps",
  protect,
  authorizeRoles("agent","lender"),
  jsonParser,
  sendRegistrationOTPs
);

router.get(
  "/getall/customer",
    protect,
  authorizeRoles("agent"),
  jsonParser,
  getCustomersForAgent 
);


router.get(
  "/customers/:agentId",
  protect,
  authorizeRoles("agent", "admin", "lender"),
  jsonParser,
  CustomersForAgent
);

router.post("/register", protect,authorizeRoles("lender"), jsonParser, validateAfricaPhone, registerAgent);

// Agent login
router.post("/login", jsonParser, validateAfricaPhone, loginAgent);

// Change password (agent only, must be logged in)
router.put("/change-password", protect, jsonParser, changePassword);



// Enhanced customer registration with proper error handling



router.get("/profile",protect,getAgentProfile)
module.exports = router;
