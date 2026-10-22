export interface McpDefaultDefinition {
  id: string;
  label: string;
  purpose: string;
  transport: 'stdio' | 'connector';
  activation: 'local-opt-in' | 'oauth-opt-in';
  privacy: string;
}

/** Catalog only: entries are never enabled or installed automatically. */
export const MCP_DEFAULTS: McpDefaultDefinition[] = [
  { id: 'filesystem', label: 'Archivos locales', purpose: 'Carpeta elegida por el usuario', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo rutas autorizadas' },
  { id: 'obsidian', label: 'Obsidian / Helix Vault', purpose: 'Leer y gestionar una bóveda concreta', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo la bóveda seleccionada' },
  { id: 'vscode', label: 'VS Code', purpose: 'Trabajar con el workspace seleccionado', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo el workspace seleccionado' },
  { id: 'github', label: 'GitHub', purpose: 'Repositorios, issues y pull requests', transport: 'stdio', activation: 'oauth-opt-in', privacy: 'Requiere token u OAuth del usuario' },
  { id: 'gmail', label: 'Gmail', purpose: 'Correo y búsqueda de mensajes', transport: 'connector', activation: 'oauth-opt-in', privacy: 'Requiere OAuth explícito del usuario' },
  { id: 'notion', label: 'Notion', purpose: 'Páginas y bases de datos', transport: 'connector', activation: 'oauth-opt-in', privacy: 'Requiere integración autorizada' },
];
