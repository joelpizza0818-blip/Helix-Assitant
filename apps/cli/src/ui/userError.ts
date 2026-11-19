export function getUserFacingError(error: unknown, fallback: string): string {
  const detail = error instanceof Error
    ? error.message.toLowerCase()
    : typeof error === 'string'
      ? error.toLowerCase()
      : ''

  if (/timeout|timed ?out|deadline exceeded/.test(detail)) {
    return 'La operación tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.'
  }
  if (/network|fetch failed|econn|enotfound|socket|connection refused/.test(detail)) {
    return 'No se pudo conectar con HELIX. Comprueba tu conexión y que Desktop esté abierto.'
  }
  if (/rate.?limit|quota|resource_exhausted|too many requests/.test(detail)) {
    return 'Se alcanzó el límite de solicitudes. Espera un momento y vuelve a intentarlo.'
  }
  if (/unauthori[sz]ed|invalid credentials|authentication failed|token expired/.test(detail)) {
    return 'No se pudo verificar el acceso. Vuelve a iniciar sesión e inténtalo de nuevo.'
  }

  return fallback
}
