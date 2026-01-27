exports.calculateMembership = ({
  creditScore = 500,
  fullyPaidLoans = 0,
  overdueLoans = 0
}) => {
  // Default
  let membershipType = "Silver Member";

  if (
    creditScore >= 750 &&
    fullyPaidLoans >= 2 &&
    overdueLoans === 0
  ) {
    membershipType = "Platinum Member";
  } 
  else if (
    creditScore >= 600 &&
    fullyPaidLoans >= 1
  ) {
    membershipType = "Gold Member";
  }

  return membershipType;
};