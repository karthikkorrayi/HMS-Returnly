// Allow only known staff entry points after sign-in.
export function signInDestination(value: unknown): string {
  return typeof value === 'string' &&
    ['/items', '/items/new', '/staff', '/requests', '/support', '/account'].includes(value)
    ? value
    : '/items'
}
