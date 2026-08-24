import { linksFor, resolveLinkUrl } from './spec.js'
import { faviconUrl } from './favicon.js'

// Shared between ContainerNode.vue and VmBox.vue — their per-container
// markup differs deliberately (see ContainerNode.vue's top comment) but
// both need the exact same right-click menu.
export function containerMenuItems(container) {
  const items = [
    {
      label: 'View definition',
      icon: 'i-lucide-file-code-2',
      disabled: !container.definition,
      onSelect: () => window.open(container.definition, '_blank', 'noopener'),
    },
  ]

  // Unlike "View definition" above, links just don't appear at all when
  // there aren't any, rather than showing up disabled — same as VmBox's
  // own menu (see vmMenu.js).
  for (const link of linksFor(container, 'container')) {
    const url = resolveLinkUrl(link, container.id, container.hostedOn)
    items.push({
      label: link.label,
      avatar: { src: faviconUrl(url), icon: 'i-lucide-link' },
      onSelect: () => window.open(url, '_blank', 'noopener'),
    })
  }

  return items
}
