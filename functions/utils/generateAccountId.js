const Customer = require("../models/customer");

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

module.exports.generateAccountId = async function generateAccountId() {
  let accountId;
  let exists = true;

  while (exists) {
    const letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    const number = Math.floor(Math.random() * 10) + 1; // 1–10
    accountId = `${letter}${number}`;

    exists = await Customer.exists({ accountId });
  }

  return accountId;
};
