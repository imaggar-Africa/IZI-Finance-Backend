// // middleware/authMiddleware.js
// const jwt = require('jsonwebtoken');
// const User = require('../models/User');
// const asyncHandler = require('express-async-handler');
// const config = require('../config/config');
// const customer = require('../models/customer');
// const AgentModel = require('../models/AgentModel');
// const { defineSecret } = require("firebase-functions/params");

// // Protect routes, role-based
// // Protect routes and attach user/agent


// const JWT_ACCESS_SECRET = defineSecret("JWT_ACCESS_SECRET");


// const protect = asyncHandler(async (req, res, next) => {
//   let token;

//   if (
//     req.headers.authorization &&
//     req.headers.authorization.startsWith("Bearer")
//   ) {
//     try {
//       token = req.headers.authorization.split(" ")[1];
//       const decoded = jwt.verify(token, JWT_ACCESS_SECRET.value());

//       const id = decoded.sub || decoded.id || decoded.userId || decoded.agentId;
//       if (!id) return res.status(401).json({ message: "Invalid token payload" });

//       // ✅ REMOVED .select("-password") - now password will be included
//       let user = await User.findById(id);
//       if (!user) user = await AgentModel.findById(id);

//       if (!user) return res.status(401).json({ message: "User/Agent not found" });

//       // Always attach as req.user for consistency
//       req.user = user;
//       req.role = user.role;

//       // Also attach specific role for backward compatibility
//       if (user.role === "agent") {
//         req.agent = user;
//       } else if (user.role === "lender") {
//         req.lender = user;
//       }

//       next();
//     } catch (error) {
//       console.error("Auth error:", error.message);
//       return res.status(401).json({ message: "Not authorized, token failed" });
//     }
//   } else {
//     return res.status(401).json({ message: "Not authorized, no token" });
//   }
// });
// /**
//  * Middleware for borrower authentication
//  */
// const borrowerProtect = asyncHandler(async (req, res, next) => {
//   let token;

//   if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
//     try {
//       token = req.headers.authorization.split(" ")[1];
// const decoded = jwt.verify(token, JWT_ACCESS_SECRET.value());
// console.log("JWT_ACCESS_SECRET:", JWT_ACCESS_SECRET.value());


//       const borrowerId = decoded.sub || decoded.borrowerId || decoded.id;
//       if (!borrowerId) {
//         return res.status(401).json({ success: false, message: "Invalid token payload" });
//       }

//       const borrower = await customer.findById(borrowerId).select("-password");
//       if (!borrower) {
//         return res.status(401).json({ success: false, message: "Borrower not found" });
//       }

//       req.borrower = borrower; // Attach borrower
//       next();
//     } catch (error) {
//       console.error("Borrower Auth error:", error.message);
//       return res.status(401).json({ success: false, message: "Not authorized, token failed" });
//     }
//   } else {
//     return res.status(401).json({ success: false, message: "Not authorized, no token" });
//   }
// });


// const agentProtect = async (req, res, next) => {
//   let token;

//   if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
//     try {
//       // Get token from header
//       token = req.headers.authorization.split(" ")[1];

//       // Verify token
// const decoded = jwt.verify(token, JWT_ACCESS_SECRET.value());

//       // Your tokens use `sub`; fallback to legacy fields
//       const agentId = decoded.sub || decoded.agentId || decoded.id;
//       if (!agentId) {
//         return res.status(401).json({ success: false, message: "Invalid token payload" });
//       }

//       // Find agent in DB
//       const agent = await AgentModel.findById(agentId).select("-password");
//       if (!agent) {
//         return res.status(401).json({ success: false, message: "Agent not found" });
//       }

//       req.agent = agent; // Attach agent to request
//       next();
//     } catch (error) {
//       console.error("Agent Auth error:", error.message);
//       return res.status(401).json({ success: false, message: "Not authorized, token failed" });
//     }
//   } else {
//     return res.status(401).json({ success: false, message: "Not authorized, no token" });
//   }
// };


// module.exports = { protect ,borrowerProtect ,agentProtect};



// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");

const User = require("../models/User");
const customer = require("../models/customer");
const AgentModel = require("../models/AgentModel");

// ✅ Read from environment (works everywhere)
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;

if (!JWT_ACCESS_SECRET) {
  console.warn("⚠️ JWT_ACCESS_SECRET is not set");
}

/**
 * =========================
 * PROTECT (User / Agent)
 * =========================
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (!req.headers.authorization?.startsWith("Bearer")) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    token = req.headers.authorization.split(" ")[1];

    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);

    const id =
      decoded.sub ||
      decoded.id ||
      decoded.userId ||
      decoded.agentId;

    if (!id) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    let user = await User.findById(id);
    if (!user) user = await AgentModel.findById(id);

    if (!user) {
      return res.status(401).json({ message: "User/Agent not found" });
    }

    req.user = user;
    req.role = user.role;

    if (user.role === "agent") req.agent = user;
    if (user.role === "lender") req.lender = user;

    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
});

/**
 * =========================
 * BORROWER PROTECT
 * =========================
 */
const borrowerProtect = asyncHandler(async (req, res, next) => {
  let token;

  if (!req.headers.authorization?.startsWith("Bearer")) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    token = req.headers.authorization.split(" ")[1];

    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);

    const borrowerId =
      decoded.sub ||
      decoded.borrowerId ||
      decoded.id;

    if (!borrowerId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const borrower = await customer.findById(borrowerId).select("-password");

    if (!borrower) {
      return res.status(401).json({ message: "Borrower not found" });
    }

    req.borrower = borrower;
    next();
  } catch (error) {
    console.error("Borrower auth error:", error.message);
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
});

/**
 * =========================
 * AGENT PROTECT (optional)
 * =========================
 */
// const agentProtect = asyncHandler(async (req, res, next) => {
//   let token;

//   if (!req.headers.authorization?.startsWith("Bearer")) {
//     return res.status(401).json({ message: "Not authorized, no token" });
//   }

//   try {
//     token = req.headers.authorization.split(" ")[1];

//     const decoded = jwt.verify(token, JWT_ACCESS_SECRET);

//     const agentId =
//       decoded.sub ||
//       decoded.agentId ||
//       decoded.id;

//     if (!agentId) {
//       return res.status(401).json({ message: "Invalid token payload" });
//     }

//     const agent = await AgentModel.findById(agentId).select("-password");

//     if (!agent) {
//       return res.status(401).json({ message: "Agent not found" });
//     }

//     req.agent = agent;
//     next();
//   } catch (error) {
//     console.error("Agent auth error:", error.message);
//     return res.status(401).json({ message: "Not authorized, token failed" });
//   }
// });

const agentProtect = asyncHandler(async (req, res, next) => {
  let token;

  if (!req.headers.authorization?.startsWith("Bearer")) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    token = req.headers.authorization.split(" ")[1];

    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);

    const agentId =
      decoded.sub ||
      decoded.agentId ||
      decoded.id;

    if (!agentId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const agent = await AgentModel.findById(agentId).select("-password");

    if (!agent) {
      return res.status(401).json({ message: "Agent not found" });
    }

    /* =====================================================
       ✅ ENFORCEMENT CHECK
    ===================================================== */

    // 🔴 LEVEL 3 — PERMANENT BLOCK
    if (agent.enforcementLevel === 3) {
      return res.status(403).json({
        message: "Your account has been permanently blocked. Contact lender."
      });
    }

    // 🟠 LEVEL 2 — TEMPORARY SUSPENSION
    if (agent.enforcementLevel === 2) {
      const now = new Date();

      if (agent.suspensionUntil && now < agent.suspensionUntil) {
        return res.status(403).json({
          message: `Account suspended until ${agent.suspensionUntil}`
        });
      }

      // ✅ Auto restore after suspension expires
      agent.enforcementLevel = 0;
      agent.status = "Active";
      agent.suspensionUntil = null;
      await agent.save();
    }

    // 🟡 LEVEL 1 — WARNING (Allow login but attach warning)
    if (agent.enforcementLevel === 1) {
      req.warning = {
        message: "Warning issued by lender",
        reason: agent.warningReason
      };
    }

    req.agent = agent;
    next();

  } catch (error) {
    console.error("Agent auth error:", error.message);
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
});

module.exports = {
  protect,
  borrowerProtect,
  agentProtect,
};
