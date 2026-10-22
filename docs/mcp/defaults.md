# Catálogo de MCPs predeterminados

Este catálogo describe opciones que HELIX puede ofrecer a cada usuario. Es un catálogo, no una activación global: ningún MCP se instala ni se conecta automáticamente.

| MCP | Uso | Activación | Alcance inicial |
|---|---|---|---|
| Archivos locales | Carpetas elegidas por el usuario | Local/stdio | Solo rutas autorizadas |
| Obsidian / Helix Vault | Bóveda concreta | Local/stdio | Solo la bóveda seleccionada |
| VS Code | Workspace concreto | Local/stdio | Solo el workspace seleccionado |
| GitHub | Repositorios, issues y PRs | OAuth/token opt-in | Cuenta/repositorios consentidos |
| Gmail | Correo | OAuth opt-in | Cuenta autorizada |
| Notion | Páginas y bases de datos | Integración opt-in | Espacios compartidos por el usuario |

La configuración real se guarda por usuario. HELIX actualmente soporta servidores MCP locales por `stdio`; los conectores OAuth requieren integración específica antes de activarse.
