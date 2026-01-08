const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { protect } = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/rolemiddleware');
const firebaseSafeUpload = require('../utils/upload');

router.get('/', protect, profileController.getProfile);
router.put("/",protect,authorizeRoles("lender"),
  firebaseSafeUpload([
    { name: "selfie", maxCount: 1 },
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 },
  ]),
  profileController.updateLenderProfile
);

router.get('/customer/:phone', protect, profileController.getCustomerProfile);

module.exports = router;
