export function getUserFacingError(error: unknown, fallback: string): string {
  const detail = error instanceof Error
    ? error.message.toLowerCase()
    : typeof error === 'string'
      ? error.toLowerCase()
      : ''

  if (/docker cli is not installed|docker.*not recognized|docker.*not found/.test(detail)) {
    return 'Instala Docker Desktop y vuelve a iniciar HELIX para preparar el escritorio aislado.'
  }
  if (/docker desktop.*engine is not running|failed to connect to the docker api|docker daemon is not running/.test(detail)) {
    return 'Inicia Docker Desktop y espera a que el motor de contenedores Linux esté listo; después, vuelve a intentarlo.'
  }
  if (/container named .* already exists|named container.*already exists/.test(detail)) {
    return 'Ya existe un contenedor con el nombre reservado para HELIX y no se modificó. Revisa ese contenedor antes de volver a intentarlo.'
  }
  if (/invalid loopback desktop port|invalid desktop port/.test(detail)) {
    return 'Docker no pudo asignar un puerto local seguro al escritorio aislado. Reinicia Docker Desktop e inténtalo de nuevo.'
  }
  if (/timeout|timed ?out|deadline exceeded/.test(detail)) {
    return 'La operación tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.'
  }
  if (/network|fetch failed|econn|enotfound|socket|connection refused/.test(detail)) {
    return 'No se pudo conectar con el servicio. Comprueba tu conexión e inténtalo de nuevo.'
  }
  if (/rate.?limit|quota|resource_exhausted|too many requests/.test(detail)) {
    return 'Se alcanzó el límite de solicitudes. Espera un momento o prueba otro proveedor.'
  }
  if (/unauthori[sz]ed|invalid credentials|authentication failed|token expired/.test(detail)) {
    return 'No se pudo verificar el acceso. Vuelve a iniciar sesión y comprueba la configuración.'
  }
  if (/permission denied|access denied|not allowed/.test(detail)) {
    return 'No tienes permisos para completar esta acción. Revisa los permisos y vuelve a intentarlo.'
  }

  return fallback
}
