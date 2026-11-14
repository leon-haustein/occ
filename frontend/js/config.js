/** Lokales Backend (Express auf Port 3000). */
const LOCAL_API = 'http://127.0.0.1:3000';

/** Same-origin in Produktion; lokal gegen Express auf :3000. */
export const API_BASE =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
        ? LOCAL_API
        : '';
