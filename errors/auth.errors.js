const AUTH_ERRORS = Object.freeze({
  ACCOUNT_EXISTS: 'Account is already registered. Please login.',
  SIGNUP_SESSION_NOT_FOUND: 'Signup session not found',
  OTP_ALREADY_VERIFIED: 'OTP already verified',
  SIGNUP_SESSION_ALREADY_USED: 'Signup session already used',
  OTP_EXPIRED: 'OTP expired',
  INVALID_CODE: 'Invalid code',
  OTP_NOT_VERIFIED: 'OTP not verified',
  USER_NOT_FOUND: 'User not found. Please signup.',
  LOGIN_SESSION_NOT_FOUND: 'Login session not found',
  INVALID_CREDENTIALS: 'Invalid credentials',
  PASSWORD_LOGIN_NOT_ENABLED: 'Password login not enabled for this account',
  INVALID_REFRESH_TOKEN: 'Invalid refresh token',
  REFRESH_TOKEN_REVOKED: 'Refresh token revoked',
  REFRESH_TOKEN_EXPIRED: 'Refresh token expired',
  GOOGLE_CLIENT_ID_MISSING: 'GOOGLE_CLIENT_ID is not configured',
  INVALID_GOOGLE_TOKEN: 'Invalid Google token',
  GOOGLE_TOKEN_SUBJECT_MISSING: 'Google token missing subject'
});

module.exports = {
  AUTH_ERRORS
};
