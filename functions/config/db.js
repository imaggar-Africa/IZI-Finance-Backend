// config/db.js
const mongoose = require('mongoose');

const connectDB = async (mongoUri) => {
  const uri = (
    mongoUri ||
    process.env.MONGO_URI ||
    global.config?.mongoUri
  )?.trim();

  if (!uri) {
    console.warn('⚠️ MONGO_URI not set; skipping MongoDB connection initialization.');
    return;
  }

  // Already connected
  if (mongoose.connection.readyState === 1) {
    return;
  }

  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    // Optional: Retry once after a short delay
    await new Promise((res) => setTimeout(res, 1000));
    try {
      await mongoose.connect(uri);
      console.log('✅ MongoDB connected on retry');
    } catch (retryErr) {
      console.error('❌ MongoDB retry failed:', retryErr.message);
      throw retryErr;
    }
  }
};

module.exports = connectDB;
