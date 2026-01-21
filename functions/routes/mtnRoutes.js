const router = require("express").Router();
const { sendMtn } = require("../controllers/mtnController");

router.post("/send", sendMtn);

module.exports = router;
