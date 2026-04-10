const DISCOVERY_ERRORS = Object.freeze({
  LOCATION_REQUIRED: 'Location is required before discovery',
  LOCATION_OUTSIDE_SERVICE_AREA: 'Your location is not currently supported',
  PROFILE_REQUIRED: 'Complete profile first',
  INVALID_SWIPE_TARGET: 'Invalid swipe target',
  SELF_SWIPE_NOT_ALLOWED: 'You cannot swipe yourself',
  SWIPE_TARGET_NOT_FOUND: 'Swipe target not found',
  SWIPE_ACTION_INVALID: 'Invalid swipe action'
});

module.exports = {
  DISCOVERY_ERRORS
};
