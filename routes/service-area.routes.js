const express = require('express');
const serviceAreaController = require('../controllers/service-area.controller');

const router = express.Router();

router.get('/', serviceAreaController.list);
router.post('/', serviceAreaController.create);
router.patch('/:areaId', serviceAreaController.update);

module.exports = router;
