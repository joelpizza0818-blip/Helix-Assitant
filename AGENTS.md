# Uso de la bóveda de Obsidian

La bóveda de Obsidian del usuario está disponible en la carpeta `Helix-Vault` del workspace.

## Reglas de consulta

- Antes de responder preguntas sobre decisiones anteriores, ideas, documentación, planificación o el estado histórico del proyecto Helix, busca información relevante en la bóveda.
- Si una tarea depende de información documentada en Obsidian, consulta las notas pertinentes antes de proponer cambios.
- No leas toda la bóveda indiscriminadamente. Busca primero por nombres, temas y contenido relevante.
- Distingue entre información documentada, información actual del código e inferencias.
- Si no encuentras información relevante, indícalo; no inventes notas ni afirmes haber consultado archivos que no has leído.
- No modifiques ni elimines notas de Obsidian sin que el usuario lo solicite.
- Para tareas exclusivamente relacionadas con código que no dependan de documentación previa, no es necesario consultar la bóveda.

# Instrucciones de GitHub Copilot para Helix


## Uso automático de Helix-Vault

La bóveda Helix-Vault es la fuente central de contexto técnico, decisiones y planificación de Helix.

Antes de responder a una tarea relacionada con Helix, debes:

1. Consultar `00 - Contexto/Helix.md` y `00 - Contexto/Estado actual.md` cuando estén disponibles.
2. Leer las notas relacionadas con el componente o la funcionalidad solicitada.
3. Revisar `04 - Desarrollo/Tareas pendientes.md` cuando la tarea dependa del estado del proyecto.
4. Contrastar la documentación con el código actual cuando se trate de implementación, errores o comportamiento técnico.

No esperes a que el usuario te pida explícitamente que consultes el vault.

Si una nota no existe o no está accesible, continúa con la información disponible e informa de la limitación cuando sea relevante. No inventes su contenido.

No es necesario leer toda la bóveda en cada solicitud: consulta únicamente las notas pertinentes para mantener el contexto actualizado.

No modifiques las notas automáticamente en cada respuesta. Actualízalas cuando el usuario lo solicite o cuando la tarea incluya explícitamente documentar los cambios.

## Contexto obligatorio

Antes de trabajar en una tarea, consulta la documentación disponible en Helix-Vault.

Empieza por:

* 00 - Contexto/Helix.md
* 00 - Contexto/Estado actual.md

Después, consulta las notas relacionadas con el componente que vas a modificar.

Si no puedes acceder a Helix-Vault, informa de ello. No inventes el contenido de las notas.

## Reglas de desarrollo

* Inspecciona el código existente antes de modificarlo.
* No reescribas módulos completos si basta con un cambio localizado.
* No inventes funcionalidades, archivos, resultados de pruebas ni dependencias.
* Respeta la arquitectura y los contratos existentes.
* No afirmes que una función funciona sin evidencia.
* No expongas API keys, tokens, contraseñas ni otros secretos.
* No ejecutes operaciones destructivas sin autorización.

## Documentación

El código real es la fuente de verdad sobre la implementación actual.

Cuando un cambio afecte al comportamiento de Helix:

1. Indica qué notas de Helix-Vault necesitan actualizarse.
2. Explica qué cambió y qué pruebas se realizaron.
3. Distingue los resultados verificados de los aspectos pendientes de comprobar.

No modifiques automáticamente la bóveda durante tareas de código que no lo requieran.

## Informe final

Al terminar una tarea, resume:

* Archivos modificados.
* Cambios realizados.
* Pruebas ejecutadas y resultados.
* Errores pendientes.
* Documentación que conviene actualizar.
* tacha tareas en el vault si es necesario

## Sincronización entre código y Helix-Vault

### Al iniciar una tarea

* Consulta las notas relevantes de Helix-Vault.
* Contrasta la documentación con el código real antes de tomar decisiones.
* No asumas que la documentación está actualizada.

### Después de modificar código

1. Revisa los cambios realizados mediante Git diff.
2. Identifica si cambió el comportamiento, la arquitectura, las interfaces, los eventos, la configuración, los proveedores de IA o las pruebas.
3. Determina qué notas de Helix-Vault se ven afectadas.
4. Si el cambio es relevante para la documentación, actualiza únicamente esas notas.
5. Si no tienes acceso de escritura a Helix-Vault, presenta las actualizaciones propuestas sin afirmar que fueron guardadas.
6. No actualices notas por cambios triviales que no alteren la información documentada.

### Reglas de documentación

* El código es la fuente de verdad sobre la implementación actual.
* Registra únicamente hechos respaldados por el código, las pruebas o resultados observados.
* Distingue entre implementado, probado, parcialmente implementado y no verificado.
* No marques una funcionalidad como funcional solo porque exista su código.
* Conserva las decisiones anteriores salvo que exista evidencia de que cambiaron.
* No borres información útil ni reescribas notas completas sin necesidad.
* No copies claves, tokens, contraseñas ni secretos a Obsidian.
* No cambies archivos de Helix-Vault para ocultar errores del código.

### Informe final

Cuando termines una tarea, informa:

* Archivos de código modificados.
* Pruebas ejecutadas y sus resultados.
* Notas de Helix-Vault actualizadas, con sus rutas.
* Información que sigue pendiente de verificar.

Si no hubo cambios relevantes para la documentación, indica que no fue necesario actualizar notas.

## Flujo obligatorio de cada lanzamiento

Antes de publicar una versión, verificar y registrar por separado Desktop Normal, Desktop Lite, Linux, macOS, web, CLI y móvil. Una plataforma sin instalador o prueba de empaquetado no se debe anunciar como compatible solo porque pase pruebas del agente.

1. Revisar el estado real del código, pruebas, dependencias y cambios incluidos; bloquear publicación si hay una regresión crítica o falta una firma/credencial requerida.
2. Alinear las versiones de cada canal con sus archivos fuente y workflows. Etiquetas actuales: `vX.Y.Z` para Desktop Normal, `lite-vX.Y.Z` para Lite y `mobile-vX.Y.Z` para móvil. CLI usa su versión npm y publicación mediante su workflow; web se despliega desde el commit aprobado. No reutilizar una etiqueta entre canales.
3. Ejecutar los tests y builds definidos por cada canal. La matriz `test-multiplatform.yml` valida el agente/relay en Windows, Linux y macOS; eso no demuestra que existan instaladores de escritorio Linux/macOS. No prometer esos instaladores hasta agregar, ejecutar y verificar su empaquetado en CI.
4. Verificar integridad de los instaladores y publicar hashes SHA-256 junto a cada activo. Mantener visibles avisos de firma, plataforma, arquitectura y limitaciones.
5. Actualizar la documentación del repositorio, el changelog/What's New de la web y las notas de publicación con el mismo alcance: funcionalidades nuevas, cambios, incompatibilidades, limitaciones y elementos que no se publican.
6. Actualizar `Helix-vault/Human/Registro de versiones.md` y `09 - Operación/Registro de versiones por plataforma.md`, separando `desktop/linux`, `mac`, `win`, `web`, `cli` y `movil`. Guardar evidencia de pruebas y estado de publicación; no convertir planes en resultados.
7. Revisar las notas de GitHub Release y la web después de publicar; verificar que cada descarga corresponde a un activo existente y a su checksum.

### Puertas de publicación por canal

- **Windows Normal:** workflow `release-desktop.yml`; validar versión, tag, release, build del instalador, checksum y publicación.
- **Windows Lite:** workflow `release-desktop-tauri-lite.yml`; versiones npm/Tauri/Rust alineadas, tests y clave pública configurada.
- **Linux y macOS desktop:** actualmente no hay evidencia de instaladores oficiales; registrar como no publicado y tratar el empaquetado como trabajo pendiente.
- **Agente/relay Linux y macOS:** ejecutar la matriz multiplataforma y registrar el resultado por sistema operativo.
- **Web:** verificar build de landing, rutas de descarga, What's New y enlaces a releases antes/después del deploy.
- **CLI:** verificar tests/build y publicar `helix-assistant-cli` mediante `publish-cli.yml`; confirmar versión en npm.
- **Móvil:** `flutter analyze`, `flutter test`, build Android firmado y checksum; publicar solo con tag `mobile-vX.Y.Z` y credenciales válidas. No afirmar disponibilidad de APK sin release publicado.

Toda versión debe conservar un registro de lo que incluye y de lo que expresamente no incluye. Una solicitud de publicación no sustituye las verificaciones ni la confirmación de que los activos están disponibles.
