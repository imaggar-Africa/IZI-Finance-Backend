const NextOfKin = require("../models/NextOfKin");

// --------------------------------------------------
// CREATE Next-of-Kin
// --------------------------------------------------
exports.createNextOfKin = async (req, res) => {
  try {
    const { borrowerId, fullName, idNumber, relationship } = req.body;

    if (!borrowerId || !fullName || !idNumber || !relationship) {
      return res.status(400).json({
        message: "borrowerId, fullName, idNumber and relationship are required"
      });
    }

    const exists = await NextOfKin.findOne({ borrowerId });
    if (exists) {
      return res.status(409).json({
        message: "Next-of-kin already exists. Use update API."
      });
    }

    const nok = await NextOfKin.create({
      borrowerId,
      fullName,
      idNumber,
      relationship
    });

    res.status(201).json({
      success: true,
      message: "Next-of-kin created successfully",
      nextOfKin: nok
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// --------------------------------------------------
// UPDATE Next-of-Kin
// --------------------------------------------------
exports.updateNextOfKin = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const { fullName, idNumber, relationship } = req.body;

    if (!borrowerId) {
      return res.status(400).json({ message: "borrowerId is required" });
    }

    const nok = await NextOfKin.findOne({ borrowerId });
    if (!nok) {
      return res.status(404).json({
        message: "Next-of-kin not found"
      });
    }

    if (fullName) nok.fullName = fullName;
    if (idNumber) nok.idNumber = idNumber;
    if (relationship) nok.relationship = relationship;

    await nok.save();

    res.json({
      success: true,
      message: "Next-of-kin updated successfully",
      nextOfKin: nok
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// --------------------------------------------------
// GET Next-of-Kin
// --------------------------------------------------
exports.getNextOfKin = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    if (!borrowerId) {
      return res.status(400).json({ message: "borrowerId is required" });
    }

    const nok = await NextOfKin.findOne({ borrowerId });
    if (!nok) {
      return res.status(404).json({
        message: "Next-of-kin not found"
      });
    }

    res.json({
      success: true,
      nextOfKin: nok
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

