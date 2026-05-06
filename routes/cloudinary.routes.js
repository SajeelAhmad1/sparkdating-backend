const express = require('express');
const cloudinaryController = require('../controllers/cloudinary.controller');

const router = express.Router();

router.delete('/image', cloudinaryController.deleteImage);

module.exports = router;
