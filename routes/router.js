const express = require('express');
const authRoutes = require('./auth.routes');
const protect = require('../middlewares/protect');
const userController = require('../controllers/user.controller');
const interestsRoutes = require('./interests.routes');
const authController = require('../controllers/auth.controller');
const discoveryRoutes = require('./discovery.routes');
const serviceAreaRoutes = require('./service-area.routes');
const discoveryFilterRoutes = require('./discovery-filter.routes');
const chatRoutes = require('./chat.routes');
const socialRoutes = require('./social.routes');
const fcmRoutes = require('./fcm.routes');
const usersRoutes = require('./users.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/interests', protect, interestsRoutes);
router.use('/discovery', protect, discoveryRoutes);
router.use('/chat', protect, chatRoutes);
router.use('/users', protect, usersRoutes);
router.use('/admin/service-areas', protect, serviceAreaRoutes);
router.use('/admin/discovery-filters', protect, discoveryFilterRoutes);

router.post('/profile/complete', protect, authController.completeProfile);
router.patch('/profile/edit', protect, authController.editProfile);
router.get('/me', protect, userController.me);
router.use('/me/fcm-token', protect, fcmRoutes);
router.patch('/me/notification-preferences', protect, userController.updateNotificationPreferences);

module.exports = router;

