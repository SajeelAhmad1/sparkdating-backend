const express = require('express');
const chatController = require('../controllers/chat.controller');

const router = express.Router();

router.post('/conversations/direct', chatController.createDirectConversation);
router.get('/conversations', chatController.listConversations);
router.get('/conversations/:conversationId/messages', chatController.listMessages);
router.post('/conversations/:conversationId/messages', chatController.sendMessage);
router.post('/conversations/:conversationId/read', chatController.markConversationRead);

module.exports = router;

