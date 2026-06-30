const Mailjet = require('node-mailjet');

const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY,
  process.env.MAILJET_SECRET_KEY,
);

const FROM_EMAIL = process.env.MAIL_FROM_EMAIL;
const FROM_NAME  = process.env.MAIL_FROM_NAME;

/**
 * @param {object} opts
 * @param {string} opts.to          - recipient email
 * @param {string} opts.otp         - plain-text OTP code
 * @param {'signup' | 'login' | 'password_reset'} opts.type
 * @param {number}  opts.ttlMinutes - how many minutes until the OTP expires
 */
async function sendOtpEmail({ to, otp, type, ttlMinutes = 5 }) {
  const subjects = {
    signup:         'Your Spark verification code',
    login:          'Your Spark login code',
    password_reset: 'Your Spark password reset code',
  };

  const headings = {
    signup:         'Verify your email',
    login:          'Your login code',
    password_reset: 'Reset your password',
  };

  const descriptions = {
    signup:         'Use the code below to verify your email address and complete sign up.',
    login:          'Use the code below to log in to your Spark account.',
    password_reset: 'Use the code below to reset your Spark account password.',
  };

  const subject     = subjects[type]      ?? 'Your Spark code';
  const heading     = headings[type]      ?? 'Your verification code';
  const description = descriptions[type] ?? 'Use the code below to continue.';

  const html = buildOtpHtml({ otp, heading, description, ttlMinutes });

  try {
    const response = await mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: FROM_EMAIL,
              Name:  FROM_NAME,
            },
            To: [{ Email: to }],
            Subject: subject,
            HTMLPart: html,
          },
        ],
      });

    const status = response.body?.Messages?.[0]?.Status;
    if (status && status !== 'success') {
      const errors = JSON.stringify(response.body?.Messages?.[0]?.Errors ?? response.body);
      throw new Error(`Mailjet rejected the message: ${errors}`);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[Mailjet] Error sending OTP email:', err?.response?.data ?? err.message);
    }
    throw new Error(`Failed to send OTP email: ${err.message}`);
  }
}

function buildOtpHtml({ otp, heading, description, ttlMinutes }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spark – ${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F3ED;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3ED;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td align="center" style="background:linear-gradient(135deg,#CEB98F,#EAD6A9);padding:36px 40px 28px;">
              <div style="font-size:32px;margin-bottom:8px;">⚡</div>
              <h1 style="margin:0;font-size:26px;font-weight:700;color:#0B0B0B;letter-spacing:-0.5px;">Spark</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 24px;">
              <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#0B0B0B;">${heading}</h2>
              <p style="margin:0 0 28px;font-size:15px;color:#555555;line-height:1.6;">${description}</p>

              <!-- OTP box -->
              <div style="background-color:#F7F3ED;border:1.5px solid #EAD6A9;border-radius:12px;padding:24px 0;text-align:center;margin-bottom:28px;">
                <span style="font-size:40px;font-weight:700;letter-spacing:10px;color:#0B0B0B;font-family:'Courier New',Courier,monospace;">${otp}</span>
              </div>

              <p style="margin:0 0 8px;font-size:13px;color:#7D858E;text-align:center;">
                This code expires in <strong style="color:#0B0B0B;">${ttlMinutes} minutes</strong>.
              </p>
              <p style="margin:0;font-size:13px;color:#7D858E;text-align:center;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#F7F3ED;padding:20px 40px;border-top:1px solid #EFEFEF;">
              <p style="margin:0;font-size:12px;color:#AAAAAA;text-align:center;">
                © ${new Date().getFullYear()} Spark Dating. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { sendOtpEmail };
