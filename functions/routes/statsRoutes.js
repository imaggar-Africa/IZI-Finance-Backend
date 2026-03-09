const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { protect } = require('../middleware/authMiddleware');
const authorizeRoles = require("../middleware/rolemiddleware");


router.get('/', protect ,authorizeRoles("lender","agent"),statsController.getStats);


router.get(
  "/summary",
  // protect,            // ✅ optional – JWT auth
  // restrictTo("admin"), // ✅ optional – role based access
  statsController.getLoanSummary
)
router.get(
  "/par",
  // protect,               // ✅ optional JWT auth
  // restrictTo("admin"),   // ✅ optional role check
  statsController.getPAR
)



router.get(
  "/pdf",
  protect,
  authorizeRoles("lender","agent"),
  statsController.downloadStatsPDF
);

router.get(
  "/overall-report-pdf",
  protect,
  statsController.downloadFullOverallReportPDF
);


module.exports = router;
