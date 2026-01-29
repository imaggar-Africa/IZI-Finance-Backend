const AuditLog = require("../models/AuditLog");

exports.logReportAudit = async ({ req, reportType, filters = {} }) => {
  try {
    await AuditLog.create({
      userId: req.user?._id,
      userRole: req.user?.role,
      reportType,
      filtersUsed: filters,
      endpoint: req.originalUrl,
      ipAddress: req.ip
    });
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
};
