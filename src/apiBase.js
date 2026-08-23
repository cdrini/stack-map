// Same-origin — production serves the built frontend and the API from the
// same FastAPI process (see server/main.py), so relative URLs just work, as
// long as they're prefixed with wherever this app is actually mounted
// (import.meta.env.BASE_URL, Vite's own --base — e.g. "/stack-map/" behind
// an nginx location that forwards the full path through unchanged; "/" at
// the domain root). Local dev's two separate processes stay same-origin too:
// vite.config.js proxies /api through to the standalone API server, rather
// than pointing at that server's own hostname/port directly — a hardcoded
// dev hostname broke in Chrome depending on whether it resolved "localhost"
// to ::1 or 127.0.0.1.
export const basePrefix = import.meta.env.BASE_URL.replace(/\/$/, '')
