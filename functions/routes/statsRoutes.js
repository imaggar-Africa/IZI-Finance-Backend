const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { protect } = require('../middleware/authMiddleware');
const authorizeRoles = require("../middleware/rolemiddleware");


router.get('/', protect ,authorizeRoles("lender","agent"),statsController.getStats);

router.get(
  "/pdf",
  protect,
  authorizeRoles("lender","agent"),
  statsController.downloadStatsPDF
);

module.exports = router;
