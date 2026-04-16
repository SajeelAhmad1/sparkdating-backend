const express = require('express');
const socialController = require('../controllers/social.controller');

const router = express.Router();

router.post('/blocks', socialController.blockUser);
router.get('/blocks', socialController.listBlockedUsers);
router.post('/connection-requests/:requestId/accept', socialController.acceptConnectionRequest);
router.post('/connection-requests/:requestId/reject', socialController.rejectConnectionRequest);
router.post('/connection-requests', socialController.sendConnectionRequest);
router.get('/connection-requests', socialController.listConnectionRequests);

module.exports = router;
