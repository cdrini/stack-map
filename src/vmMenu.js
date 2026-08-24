import { linksFor, resolveLinkUrl } from './spec.js'
import { faviconUrl } from './favicon.js'

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
