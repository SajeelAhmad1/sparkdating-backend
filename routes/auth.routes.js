const express = require('express');
const authController = require('../controllers/auth.controller');

const router = express.Router();

// Signup (OTP + single create)
router.post('/signup/start', authController.signupStart);
router.post('/signup/verify-otp', authController.signupVerifyOtp);
router.post('/signup/complete', authController.signupComplete);

// Login (phone OTP)
router.post('/login/start', authController.loginStart);
router.post('/login/verify-otp', authController.loginVerifyOtp);

// Tokens
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

// Catalog
router.get('/interests', authController.getInterestsCatalog);

module.exports = router;

