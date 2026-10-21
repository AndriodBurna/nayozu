/**
 * Feature flags.
 * Flip AUTH_ENABLED to true when the login/register work is finished and the
 * Sign In / Register buttons, Library links and "add to library" controls
 * will all come back. Nothing was deleted.
 */
export const AUTH_ENABLED = false;

/**
 * When false, only real official/authorized media streams and chapters are returned.
 * When true, demo video streams and demo manga chapters are provided for UI testing.
 */
export const DEMO_MEDIA = false;

/**
 * Experimental anime streaming via hexxt-git/anime-sdk.
 * When enabled, in-player provider switching and the /test-stream route are activated.
 */
export const ENABLE_ANIMESDK = true;
