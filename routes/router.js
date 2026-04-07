const express = require('express');
const authRoutes = require('./auth.routes');
const protect = require('../middlewares/protect');
const userController = require('../controllers/user.controller');
const interestsRoutes = require('./interests.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/interests', protect, interestsRoutes);

router.get('/me', protect, userController.me);

module.exports = router;

