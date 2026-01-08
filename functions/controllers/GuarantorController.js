const Guarantor = require("../models/Guarantor");
const Customer = require("../models/customer");

/**
 * Add guarantor (Borrower / Customer)
 */
exports.addGuarantor = async (req, res) => {
  try {
    const { borrowerId, fullName, phone, relationship, idNumber } = req.body;

    // role safety (extra guard)
    if (!["lender", "agent"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Only lender or agent can add guarantor",
      });
    }

    if (!borrowerId || !fullName || !phone || !relationship || !idNumber) {
      return res.status(400).json({
        message: "All guarantor fields including borrowerId are required",
      });
    }

    // ensure borrower (customer) exists
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({
        message: "Borrower not found",
      });
    }

    // prevent duplicate guarantor ID for same borrower
    const existing = await Guarantor.findOne({
      borrowerId,
      idNumber,
      isDeleted: false,
    });

    if (existing) {
      return res.status(409).json({
        message: "Guarantor with this ID already exists for this borrower",
      });
    }

    const guarantor = await Guarantor.create({
      borrowerId,
      fullName,
      phone,
      relationship,
      idNumber,
    });

    return res.status(201).json({
      message: "Guarantor added successfully",
      guarantor,
    });
  } catch (error) {
    console.error("Add guarantor error:", error);
    return res.status(500).json({
      message: "Server error while adding guarantor",
    });
  }
};

/**
 * Get logged-in borrower's guarantors
 */
exports.getMyGuarantors = async (req, res) => {
  try {
    const guarantors = await Guarantor.find({
      borrowerId: req.user._id,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    res.json(guarantors);
  } catch (error) {
    res.status(500).json({
      message: "Server error",
    });
  }
};

/**
 * Admin: Get guarantors of a borrower
 */
exports.getBorrowerGuarantors = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    const guarantors = await Guarantor.find({
      borrowerId,
      isDeleted: false,
    });

    res.json(guarantors);
  } catch (error) {
    res.status(500).json({
      message: "Server error",
    });
  }
};
