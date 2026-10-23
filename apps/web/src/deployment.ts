/** Keeps app-owned HTTP and event-stream URLs under a same-origin root-relative HTML base. Direct localhost use retains root URLs. */
export function appUrl(
  route: string,
  base = typeof document === 'undefined'
    ? '/'
    : (document.querySelector('base[href]')?.getAttribute('href') ?? '/'),
): string {
  if (
    !route.startsWith('/') ||
    route.startsWith('//') ||
    !base.startsWith('/') ||
    base.startsWith('//') ||
    /[?#]/.test(base)
  )
    return route;
  const prefix = base.replace(/\/+$/, '');
  return !prefix || route === prefix || route.startsWith(prefix + '/') ? route : prefix + route;
}
