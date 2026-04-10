const PROFILE_ERRORS = Object.freeze({
  ALREADY_EXISTS: 'Profile already exists',
  NOT_FOUND: 'Profile not found',
  INVALID_DOB: 'Invalid dob',
  INVALID_INTERESTS_PREFIX: 'Invalid interests:',
  UNIQUE_INTERESTS_RANGE: 'Select min 3 and max 5 unique interests',
  UPDATE_FIELDS_REQUIRED: 'Provide at least one field to update'
});

module.exports = {
  PROFILE_ERRORS
};
