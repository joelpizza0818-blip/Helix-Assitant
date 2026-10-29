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
  { id: 'filesystem', label: 'Archivos locales', purpose: 'Carpetas y archivos del equipo del usuario', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo rutas autorizadas' },
  { id: 'obsidian', label: 'Obsidian / Helix Vault', purpose: 'Leer y gestionar una bóveda concreta', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo la bóveda seleccionada' },
  { id: 'vscode', label: 'VS Code', purpose: 'Trabajar con el workspace seleccionado', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo el workspace seleccionado' },
  { id: 'cursor', label: 'Cursor', purpose: 'Proyectos y editor de código del usuario', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo el workspace autorizado' },
  { id: 'github', label: 'GitHub', purpose: 'Repositorios, issues, pull requests y código', transport: 'stdio', activation: 'oauth-opt-in', privacy: 'Requiere token u OAuth del usuario' },
  { id: 'linear', label: 'Linear', purpose: 'Issues, roadmap y trabajo del equipo', transport: 'connector', activation: 'oauth-opt-in', privacy: 'Requiere acceso autorizado del workspace' },
  { id: 'gmail', label: 'Gmail', purpose: 'Correo, búsquedas y mensajes relevantes', transport: 'connector', activation: 'oauth-opt-in', privacy: 'Requiere OAuth explícito del usuario' },
  { id: 'google-drive', label: 'Google Drive', purpose: 'Documentos y archivos compartidos', transport: 'connector', activation: 'oauth-opt-in', privacy: 'Requiere acceso autorizado a la cuenta' },
  { id: 'notion', label: 'Notion', purpose: 'Páginas, bases de datos y conocimiento', transport: 'connector', activation: 'oauth-opt-in', privacy: 'Requiere integración autorizada' },
  { id: 'chatgpt', label: 'ChatGPT', purpose: 'Acceso a tareas y contexto de chat del usuario', transport: 'connector', activation: 'oauth-opt-in', privacy: 'Requiere conexión autorizada del usuario' },
  { id: 'claude-desktop', label: 'Claude Desktop', purpose: 'Contexto y trabajo en la app desktop de Claude', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo los recursos autorizados por el usuario' },
  { id: 'word', label: 'Microsoft Word', purpose: 'Documentos y edición de texto', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo archivos autorizados' },
  { id: 'excel', label: 'Microsoft Excel', purpose: 'Hojas de cálculo, análisis y tabulación', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo archivos autorizados' },
  { id: 'powerpoint', label: 'Microsoft PowerPoint', purpose: 'Presentaciones y material visual', transport: 'stdio', activation: 'local-opt-in', privacy: 'Solo archivos autorizados' },
  { id: 'antigravity', label: 'Antigravity', purpose: 'Workspace y flujos de automatización del usuario', transport: 'connector', activation: 'oauth-opt-in', privacy: 'Requiere conexión explícita del usuario' },
];
