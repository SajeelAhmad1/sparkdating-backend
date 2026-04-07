const express = require('express');
const authController = require('../controllers/auth.controller');

const router = express.Router();

// Signup (OTP + single create)
router.post('/signup/start', authController.signupStart);
router.post('/signup/verify-otp', authController.signupVerifyOtp);
router.post('/signup/set-password', authController.signupSetPassword);

// Google Auth (verify token -> complete profile)
router.post('/google/verify', authController.googleVerify);

// Login (phone OTP)
router.post('/login', authController.loginWithPassword);
router.post('/login/start', authController.loginStart);
router.post('/login/verify-otp', authController.loginVerifyOtp);

// Tokens
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

module.exports = router;

