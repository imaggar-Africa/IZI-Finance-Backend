const sendMtnMoney = async ({ msisdn, amount, reference }) => {
  return {
    referenceId: "MOCK-MTN-REF-123456",
    status: "SUCCESS",
    message: "Mock MTN disbursement completed"
  };
};

module.exports = { sendMtnMoney };
