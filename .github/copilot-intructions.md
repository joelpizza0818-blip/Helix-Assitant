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
