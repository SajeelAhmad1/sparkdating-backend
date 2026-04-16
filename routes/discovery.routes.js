const express = require('express');
const discoveryController = require('../controllers/discovery.controller');

const router = express.Router();

router.post('/availability', discoveryController.checkAvailability);
router.post('/location', discoveryController.updateLocation);
router.get('/preferences', discoveryController.getDiscoveryPreferences);
router.patch('/preferences', discoveryController.patchDiscoveryPreferences);
router.post('/profiles', discoveryController.discoverProfiles);
router.post('/swipe', discoveryController.swipe);

module.exports = router;
