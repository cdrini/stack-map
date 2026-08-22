// Registry of `application` values a container in stack.yaml can reference.
// Anything not listed here (or with no `icon`) falls back to a plain color
// dot in the views — that's the intended behavior for apps without a clear
// icon, not a missing-data bug.

export const APPS = {
  python: {
    label: 'Python',
    icon: 'https://www.python.org/favicon.ico',
  },
  solr: {
    label: 'Apache Solr',
    icon: 'https://solr.apache.org/theme/images/favicon.ico',
  },
  haproxy: {
    label: 'HAProxy',
    icon: 'https://www.haproxy.org/favicon.ico',
  },
  nginx: {
    label: 'nginx',
    icon: 'https://nginx.org/favicon.ico',
  },
  jenkins: {
    label: 'Jenkins',
    icon: 'https://www.jenkins.io/favicon.ico',
  },
  postgres: {
    label: 'PostgreSQL',
    icon: 'https://www.postgresql.org/favicon.ico',
  },
}

export function appFor(applicationKey) {
  return applicationKey ? APPS[applicationKey] : undefined
}
