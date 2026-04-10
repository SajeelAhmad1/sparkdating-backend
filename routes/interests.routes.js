const express = require('express');
const interestsController = require('../controllers/interests.controller');

const router = express.Router();

// Requires Bearer token (enforced by parent router mount)
router.get('/', interestsController.getCatalog);

module.exports = router;

