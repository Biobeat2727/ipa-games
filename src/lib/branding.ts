// Venue + tip-jar details shown on the intermission graph screens and the
// end-of-game screens. Every surface imports from here — fill these in once.
// An empty string hides that section everywhere, so nothing half-configured
// ever shows to players.

/** Venmo username, without the leading @ */
export const VENMO_HANDLE = 'biobeat'

/** Venue name shown next to the logo/link on the final screens */
export const VENUE_NAME = 'Idaho Pour Authority'

/** Full venue website URL, including https:// */
export const VENUE_URL = 'https://www.idahopourauthority.com/'

/** Venue logo file served from /public, e.g. '/ipa-logo.png' */
export const VENUE_LOGO = '/ipa-logo.jpg'

/** Full venue Instagram profile URL, including https:// */
export const VENUE_INSTAGRAM = 'https://www.instagram.com/idahopourauthority/'

export const venmoUrl = () => `https://venmo.com/u/${VENMO_HANDLE}`

/** "@idahopourauthority" from the profile URL */
export const instagramHandle = () =>
  '@' + VENUE_INSTAGRAM.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')

/** Strip the protocol for display ("idahopourauthority.com", not the full URL) */
export const venueUrlLabel = () => VENUE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')
