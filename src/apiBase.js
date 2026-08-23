// Same-origin by default — production serves the built frontend and the API
// from the same FastAPI process (see server/main.py), so relative URLs just
// work, as long as they're prefixed with wherever this app is actually
// mounted (import.meta.env.BASE_URL, Vite's own --base — e.g. "/stack-map/"
// behind an nginx location that forwards the full path through unchanged;
// "/" at the domain root). Local dev runs the frontend and API as two
// separate servers instead, so .env.development overrides this entirely to
// point at the standalone API server's own port.
const basePrefix = import.meta.env.BASE_URL.replace(/\/$/, '')
export const API_BASE = import.meta.env.VITE_API_BASE ?? basePrefix
