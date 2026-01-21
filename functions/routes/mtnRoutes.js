const router = require("express").Router();
const { sendMtn} = require("../controllers/mtnController");

router.post("/send", sendMtn);
// router.post("/callback", mtnCallback);

module.exports = router;
