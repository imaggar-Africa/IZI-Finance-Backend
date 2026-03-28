const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer to the project directory.
  // This ensures the Chrome binary is downloaded into the deployment image 
  // during npm install and is accessible in the serverless environment.
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
