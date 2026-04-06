const express = require('express');
const authRoutes = require('./auth.routes');
const protect = require('../middlewares/protect');
const userController = require('../controllers/user.controller');

const router = express.Router();

router.use('/auth', authRoutes);

router.get('/me', protect, userController.me);

module.exports = router;

