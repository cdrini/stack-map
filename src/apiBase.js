// Same-origin by default — production serves the built frontend and the API
// from the same FastAPI process (see server/main.py), so relative URLs just
// work. Local dev runs them as two separate servers, so .env.development
// points this at the standalone API server's own port.
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
