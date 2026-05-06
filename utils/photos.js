/**
 * photos field in DB is Json[] storing { url, publicId } objects.
 * This helper extracts just the URL strings for places that need string arrays
 * (discovery cards, chat avatars, etc.)
 */
function photoUrl(photo) {
  if (!photo) return null;
  if (typeof photo === 'string') return photo;
  return photo.url ?? null;
}

function photoUrls(photos) {
  if (!Array.isArray(photos)) return [];
  return photos.map(photoUrl).filter(Boolean);
}

module.exports = { photoUrl, photoUrls };
