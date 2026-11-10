// // middlewares/validateKenyaPhone.js

// exports.validateKenyaPhone = (req, res, next) => {
//   const { phone } = req.body;

//   // Kenya phone number format: +2547XXXXXXXX (13 characters total)
//   const kenyaPhoneRegex = /^\+2547\d{8}$/;

//   if (!phone) {
//     return res.status(400).json({ message: "Phone number is required" });
//   }

//   if (!kenyaPhoneRegex.test(phone)) {
//     return res
//       .status(400)
//       .json({ message: "Invalid Kenya phone format (+2547XXXXXXXX)" });
//   }

//   next();
// };

// middlewares/validateAfricaPhone.js

const { normalizePhone } = require("../utils/phone");

exports.validateAfricaPhone = (req, res, next) => {
  let { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ message: "Phone number is required" });
  }

  const normalized = normalizePhone(phone);
  if (normalized) {
    req.body.phone = normalized;
    phone = normalized;
  }

  // Country-wise regex patterns
  const phonePatterns = {
    Kenya: /^\+2547\d{8}$/,
    Uganda: /^\+2567\d{8}$/,
    Tanzania: /^\+2557\d{8}$/,
    Rwanda: /^\+2507\d{8}$/,
    Nigeria: /^\+234\d{10}$/,
    Ghana: /^\+233\d{9}$/
  };

  const isValid = Object.values(phonePatterns).some((regex) =>
    regex.test(phone)
  );

  if (!isValid) {
    return res.status(400).json({
      message:
        "Invalid phone format. Supported countries: Kenya (+254), Uganda (+256), Tanzania (+255), Rwanda (+250), Nigeria (+234), Ghana (+233)"
    });
  }

  next();
};
