function generateOtp4() {
  return `${Math.floor(1000 + Math.random() * 9000)}`;
}

function generateOtp6() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

module.exports = { generateOtp4, generateOtp6 };

