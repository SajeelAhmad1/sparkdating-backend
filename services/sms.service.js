const OTP_SMS_TEMPLATES = {
  signup: (otp, ttl) => `Your Spark verification code is ${otp}. It expires in ${ttl} minutes. Do not share this code with anyone.`,
  login: (otp, ttl) => `Your Spark login code is ${otp}. It expires in ${ttl} minutes. Do not share this code with anyone.`,
  password_reset: (otp, ttl) => `Your Spark password reset code is ${otp}. It expires in ${ttl} minutes. Do not share this code with anyone.`,
};

let _client = null;

function getTwilioClient() {
  if (_client) return _client;

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    throw new Error(
      'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in your environment.'
    );
  }

  const twilio = require('twilio');
  _client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return _client;
}

/**
 * @param {object} opts
 * @param {string} opts.to                                        - E.164 phone number, e.g. "+14155552671"
 * @param {string} opts.otp                                       - plain-text OTP code
 * @param {'signup' | 'login' | 'password_reset'} opts.type
 * @param {number}  [opts.ttlMinutes=5]                           - minutes until expiry shown in the message
 */
async function sendOtpSms({ to, otp, type, ttlMinutes = 5 }) {
  const buildMessage = OTP_SMS_TEMPLATES[type] ?? OTP_SMS_TEMPLATES.signup;
  const body = buildMessage(otp, ttlMinutes);

  const client = getTwilioClient();

  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body,
    });
  } catch (err) {
    // Twilio errors expose a `message` and numeric `code` field
    const detail = err?.message ?? String(err);
    throw new Error(`Failed to send OTP SMS: ${detail}`);
  }
}

module.exports = { sendOtpSms };
