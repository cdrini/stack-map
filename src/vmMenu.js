import { linksFor, resolveLinkUrl } from './spec.js'

// The target's own favicon rather than a third-party favicon-fetching
// service (e.g. Google's) — this app never sends real internal Archive
// hostnames to a third party (see stack.yaml/STACKMAP_SPEC_PATH), and a
// plain <img src> to the target's own origin costs nothing extra: it's
// exactly the request the browser would make loading that page anyway.
function faviconUrl(url) {
  try {
    return new URL(url).origin + '/favicon.ico'
  } catch {
    return null
  }
}

// A VM's right-click menu — its own `links:` plus whatever top-level
// `links:` entries apply to VMs (see stack.yaml's doc comment). Each
// item's avatar shows the link's own favicon, falling back to a generic
// link icon if it 404s or the origin doesn't resolve (UAvatar's own
// built-in fallback behavior — see its `error` handling).
export function vmMenuItems(vm) {
  return linksFor(vm, 'vm').map((link) => {
    const url = resolveLinkUrl(link, vm.id)
    return {
      label: link.label,
      avatar: { src: faviconUrl(url), icon: 'i-lucide-link' },
      onSelect: () => window.open(url, '_blank', 'noopener'),
    }
  })
}
