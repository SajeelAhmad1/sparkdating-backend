const express = require('express');
const discoveryFilterController = require('../controllers/discovery-filter.controller');

const router = express.Router();

router.get('/', discoveryFilterController.getDefault);
router.patch('/', discoveryFilterController.updateDefault);

module.exports = router;
