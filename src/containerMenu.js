// Shared between ContainerNode.vue and VmBox.vue — their per-container
// markup differs deliberately (see ContainerNode.vue's top comment) but
// both need the exact same right-click menu.
export function containerMenuItems(container) {
  return [
    {
      label: 'View definition',
      icon: 'i-lucide-file-code-2',
      disabled: !container.definition,
      onSelect: () => window.open(container.definition, '_blank', 'noopener'),
    },
  ]
}
