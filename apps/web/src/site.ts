// nyxeron.xyz is the landing only; the game lives on app.nyxeron.xyz (vercel.json redirects app paths there).
// Locally and on preview URLs everything runs on one host, and /landing shows the landing.
export const APP_ORIGIN = 'https://app.nyxeron.xyz'
const LANDING_HOSTS = ['nyxeron.xyz', 'www.nyxeron.xyz']

export const isLandingHost = (host = location.hostname) => LANDING_HOSTS.includes(host)
/** Where a link into the game goes: the app's own origin from the landing, a plain path everywhere else. */
export const appUrl = (path = '/') => (isLandingHost() ? APP_ORIGIN + path : path)
