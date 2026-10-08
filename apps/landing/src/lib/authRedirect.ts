export function getPostAuthRedirect(search: string): string {
  const requested = new URLSearchParams(search).get('redirectTo')
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) {
    return '/'
  }
  return requested
}
