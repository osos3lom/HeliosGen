/**
 * HeliosGen has a single implicit, local user. Rows in the browser database
 * (lib/browser/db.ts) are keyed by this id, as they were in the desktop app's
 * SQLite database, so imported desktop data lines up unchanged.
 */
export const GUEST_USER_ID = "guest";
