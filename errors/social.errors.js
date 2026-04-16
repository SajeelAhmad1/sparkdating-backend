const SOCIAL_ERRORS = Object.freeze({
  CANNOT_BLOCK_SELF: 'You cannot block yourself',
  USER_NOT_FOUND: 'User not found',
  CANNOT_REQUEST_SELF: 'You cannot send a request to yourself',
  CANNOT_REQUEST_BLOCKED_USER: 'You cannot interact with this user',
  TARGET_PROFILE_REQUIRED: 'This user cannot receive requests yet',
  CANNOT_SWIPE_BLOCKED_USER: 'You cannot swipe this user',
  CONNECTION_REQUEST_NOT_FOUND: 'Connection request not found',
  NOT_CONNECTION_REQUEST_RECIPIENT: 'Only the recipient can respond to this request',
  CONNECTION_REQUEST_NOT_PENDING: 'This request is no longer pending',
  CONNECTION_REQUEST_ALREADY_ACCEPTED: 'This request was already accepted'
});

module.exports = {
  SOCIAL_ERRORS
};
