const express = require('express');
const fcmController = require('../controllers/fcm.controller');

const router = express.Router();

router.post('/', fcmController.registerToken);
router.delete('/', fcmController.removeToken);

module.exports = router;
