const express = require('express');
const chatController = require('../controllers/chat.controller');

const router = express.Router();

// REST-only: conversation management and message history
router.post('/conversations/direct', chatController.createDirectConversation);
router.get('/conversations', chatController.listConversations);
router.get('/conversations/:conversationId/messages', chatController.listMessages);

// NOTE: POST /conversations/:id/messages (send) and POST /conversations/:id/read
// are intentionally removed — handled exclusively via Socket.IO message:send and message:read.

module.exports = router;

