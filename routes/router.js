const express = require('express');
const authRoutes = require('./auth.routes');
const protect = require('../middlewares/protect');
const userController = require('../controllers/user.controller');
const interestsRoutes = require('./interests.routes');
const authController = require('../controllers/auth.controller');
const discoveryRoutes = require('./discovery.routes');
const serviceAreaRoutes = require('./service-area.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/interests', protect, interestsRoutes);
router.use('/discovery', protect, discoveryRoutes);
router.use('/admin/service-areas', protect, serviceAreaRoutes);

router.post('/profile/complete', protect, authController.completeProfile);
router.patch('/profile/edit', protect, authController.editProfile);
router.get('/me', protect, userController.me);

module.exports = router;

