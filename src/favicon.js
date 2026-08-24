// The target's own favicon rather than a third-party favicon-fetching
// service (e.g. Google's) — this app never sends real internal Archive
// hostnames to a third party (see stack.yaml/STACKMAP_SPEC_PATH), and a
// plain <img src> to the target's own origin costs nothing extra: it's
// exactly the request the browser would make loading that page anyway.
export function faviconUrl(url) {
  try {
    return new URL(url).origin + '/favicon.ico'
  } catch {
    return null
  }
}
