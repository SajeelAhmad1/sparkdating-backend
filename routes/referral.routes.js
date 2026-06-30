const express = require('express');
const referralController = require('../controllers/referral.controller');

const router = express.Router();

router.get('/stats', referralController.getMyStats);
router.post('/share', referralController.recordShare);
router.get('/launch-progress', referralController.getLaunchProgress);

module.exports = router;
