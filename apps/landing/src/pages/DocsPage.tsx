import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import './DocsPage.css';

type DocSection = 'intro' | 'install' | 'models' | 'tools' | 'voice' | 'mcp' | 'faq';

export const DocsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<DocSection>('intro');

  return (
    <div className="docs-page" id="top">
      <header className="docs-header">
        <Link to="/" className="docs-header__brand" aria-label="Volver a la página principal de HELIX">
          <HelixLogo size="sm" showText />
        </Link>
        <div className="docs-header__links">
          <Link to="/" className="docs-header__link">Inicio</Link>
          <Link to="/features" className="docs-header__link">Novedades</Link>
          <Link to="/privacy" className="docs-header__link">Privacidad</Link>
          <Link to="/download" className="docs-header__cta">Descargar</Link>
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <div className="docs-sidebar__group">
            <span className="docs-sidebar__title">DOCUMENTACIÓN OFICIAL</span>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'intro' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('intro')}
            >
              1. Visión General & Arquitectura
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'install' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('install')}
            >
              2. Instalación (Normal vs Lite)
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'models' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('models')}
            >
              3. Proveedores de IA & API Keys
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'tools' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('tools')}
            >
              4. Herramientas & Modo Zero-Trust
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'voice' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('voice')}
            >
              5. Voz, Micrófono & SoundDevice
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'mcp' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('mcp')}
            >
              6. Conexión de Servidores MCP
            </button>
            <button
              type="button"
              className={`docs-nav-item ${activeSection === 'faq' ? 'is-active' : ''}`}
              onClick={() => setActiveSection('faq')}
            >
              7. Diagnóstico & Preguntas Frecuentes
            </button>
          </div>

          <div className="docs-sidebar__box">
            <span className="docs-box-tag">VERSIÓN RECOMENDADA</span>
            <p>HELIX Lite (Tauri) consume hasta un 80% menos memoria RAM en sistemas con recursos limitados.</p>
            <Link to="/download" className="docs-box-link">
              Obtener HELIX Lite
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6 }}>
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        </aside>

        <main className="docs-body">
          {activeSection === 'intro' && (
            <article className="docs-article">
              <span className="docs-badge">SECCIÓN 1</span>
              <h1>Visión General de HELIX</h1>
              <p className="docs-lead">
                HELIX es un agente de inteligencia artificial persistente para Windows, diseñado para convivir en el flujo diario de tu escritorio sin aislarte en una pestaña de navegador web.
              </p>

              <div className="docs-callout">
                <h4>Componentes de la Arquitectura</h4>
                <ul>
                  <li><strong>Desktop Shell (Electron o Tauri):</strong> Interfaz gráfica residente en bandeja de sistema (System Tray), panel flotante y controles globales de teclado.</li>
                  <li><strong>Agent Core (Python Service):</strong> Motor autónomo que procesa el ciclo de pensamiento del agente, orquesta herramientas locales, interpreta visión OCR y gestiona la memoria de trabajo.</li>
                  <li><strong>Local IPC:</strong> Comunicación interproceso local de alta velocidad y autenticada entre la interfaz de escritorio y el servicio del agente.</li>
                </ul>
              </div>

              <h2>Filosofía Local-First</h2>
              <p>
                HELIX no requiere suscripción propietaria a modelos cerrados ni almacena tus consultas en la nube de HELIX. Tú configuras tus propias claves de API o utilizas modelos locales con Ollama en tu tarjeta gráfica.
              </p>
            </article>
          )}

          {activeSection === 'install' && (
            <article className="docs-article">
              <span className="docs-badge">SECCIÓN 2</span>
              <h1>Instalación: HELIX Normal vs HELIX Lite</h1>
              <p className="docs-lead">
                Ofrecemos dos distribuciones oficiales para satisfacer diferentes requerimientos de hardware y preferencias de entorno.
              </p>

              <div className="docs-comparison-table">
                <div className="comparison-col">
                  <h3>HELIX Normal (Electron)</h3>
                  <span className="comparison-tag">Versión Completa</span>
                  <ul>
                    <li>Shell integrada basada en Chromium/Node.js</li>
                    <li>Soporte extendido para extensiones visuales pesadas</li>
                    <li>Actualizador automático con verificación de canal</li>
                    <li>Memoria base: ~180MB RAM</li>
                    <li>Recomendado para workstations y PCs modernas</li>
                  </ul>
                </div>
                <div className="comparison-col is-featured">
                  <h3>HELIX Lite (Tauri)</h3>
                  <span className="comparison-tag">Ultra-Ligero · Rápido</span>
                  <ul>
                    <li>Shell construida en Rust con WebView2 nativo de Windows</li>
                    <li>Arranque instantáneo y binario de tamaño reducido (~15MB)</li>
                    <li>Memoria base reducida: ~40MB RAM</li>
                    <li>Mismo soporte completo para el motor Python y modelos de IA</li>
                    <li>Recomendado para laptops y máxima eficiencia energética</li>
                  </ul>
                </div>
              </div>

              <h2>Requisitos del Sistema</h2>
              <ul>
                <li><strong>Sistema Operativo:</strong> Windows 10 (Build 19041+) o Windows 11 (64-bit).</li>
                <li><strong>Procesador:</strong> Intel Core i3 / AMD Ryzen 3 o superior (x64).</li>
                <li><strong>Memoria RAM:</strong> Mínimo 4 GB (8 GB recomendado para modelos grandes o OCR continuo).</li>
                <li><strong>WebView2:</strong> Instalado por defecto en Windows 11 y versiones recientes de Windows 10.</li>
              </ul>
            </article>
          )}

          {activeSection === 'models' && (
            <article className="docs-article">
              <span className="docs-badge">SECCIÓN 3</span>
              <h1>Configuración de Proveedores de IA</h1>
              <p className="docs-lead">
                Configura fácilmente los modelos que prefieras. Tus claves nunca salen de tu máquina hacia servidores de HELIX.
              </p>

              <h2>Proveedores Soportados</h2>
              <div className="docs-provider-grid">
                <div className="provider-card">
                  <h4>Google Gemini</h4>
                  <p>Compatible con Gemini 1.5 Pro, Flash y Gemini 2.0. Ideal para ventanas de contexto gigantes y multimodalidad nativa.</p>
                  <code>GEMINI_API_KEY=tu_clave_aqui</code>
                </div>
                <div className="provider-card">
                  <h4>Anthropic Claude</h4>
                  <p>Compatible con Claude 3.5 Sonnet y Haiku. Excelente precisión para programación y razonamiento estructurado.</p>
                  <code>ANTHROPIC_API_KEY=tu_clave_aqui</code>
                </div>
                <div className="provider-card">
                  <h4>OpenAI</h4>
                  <p>Compatible con GPT-4o, GPT-4o-mini y o1. Gran versatilidad y rapidez de ejecución de herramientas.</p>
                  <code>OPENAI_API_KEY=tu_clave_aqui</code>
                </div>
                <div className="provider-card">
                  <h4>Ollama (Modelos Locales)</h4>
                  <p>Ejecuta Llama 3, Qwen, DeepSeek o Mistral de forma 100% offline y gratuita en tu GPU local.</p>
                  <code>OLLAMA_BASE_URL=http://localhost:11434</code>
                </div>
              </div>

              <h2>Almacenamiento Seguro de Claves</h2>
              <p>
                Puedes ingresar tus claves directamente desde la interfaz gráfica de configuración de HELIX (Toolbox) para que se guarden de forma encriptada en el <strong>Administrador de Credenciales de Windows (Windows Credential Manager)</strong>, o definir un archivo <code>.env</code> en el directorio raíz del agente.
              </p>
            </article>
          )}

          {activeSection === 'tools' && (
            <article className="docs-article">
              <span className="docs-badge">SECCIÓN 4</span>
              <h1>Herramientas del Sistema & Modo Zero-Trust</h1>
              <p className="docs-lead">
                HELIX no se limita a responder texto: puede ejecutar acciones concretas en tu computadora, siempre bajo tus reglas.
              </p>

              <h2>Filosofía Zero-Trust</h2>
              <p>
                Ninguna IA debe tener acceso de escritura irrestricto a tu sistema operativo. Por eso HELIX implementa una capa de comprobación de políticas:
              </p>
              <ul>
                <li><strong>Operaciones de lectura:</strong> Consultar la hora, listar archivos de un directorio o leer documentos solicitados se ejecutan con fluidez.</li>
                <li><strong>Operaciones de modificación o destructivas:</strong> Crear archivos, editar código, ejecutar scripts de PowerShell o instalar librerías muestran un diálogo emergente con el comando exacto para que lo apruebes con un clic.</li>
              </ul>

              <h2>Captura de Pantalla y OCR</h2>
              <p>
                Para pedirle ayuda sobre lo que tienes en pantalla, presiona el botón de pantalla o escribe: <em>"¿qué significa el error que aparece en la consola?"</em>. HELIX captura únicamente el área relevante, procesa el texto con OCR y lo analiza en el mismo turno.
              </p>
            </article>
          )}

          {activeSection === 'voice' && (
            <article className="docs-article">
              <span className="docs-badge">SECCIÓN 5</span>
              <h1>Voz, Micrófono & SoundDevice</h1>
              <p className="docs-lead">
                Habla con HELIX con la naturalidad de una llamada telefónica o un walkie-talkie en tu escritorio.
              </p>

              <h2>Cómo activar la escucha</h2>
              <ul>
                <li><strong>Atajo global:</strong> Presiona <code>Ctrl + Shift + Espacio</code> (configurable) para invocar a HELIX por voz.</li>
                <li><strong>Indicador visible:</strong> Mientras el micrófono esté abierto, la onda de sonido animada se mostrará en color ámbar en la ventana flotante.</li>
                <li><strong>Procesamiento de audio:</strong> El audio capturado por SoundDevice se transcribe en tiempo real y el micrófono se cierra inmediatamente después de procesar tu turno.</li>
              </ul>
            </article>
          )}

          {activeSection === 'mcp' && (
            <article className="docs-article">
              <span className="docs-badge">SECCIÓN 6</span>
              <h1>Conexión de Servidores MCP (Model Context Protocol)</h1>
              <p className="docs-lead">
                Extiende las capacidades de HELIX integrándolo con bases de datos, APIs de GitHub, navegadores headless y herramientas personalizadas mediante el estándar abierto MCP.
              </p>

              <h2>Configuración en <code>helix-config.json</code></h2>
              <pre className="docs-code-block">
{`{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\tu_usuario\\Proyectos"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
      }
    }
  }
}`}
              </pre>
            </article>
          )}

          {activeSection === 'faq' && (
            <article className="docs-article">
              <span className="docs-badge">SECCIÓN 7</span>
              <h1>Diagnóstico & Preguntas Frecuentes</h1>
              
              <div className="docs-faq-item">
                <h3>¿Windows SmartScreen muestra una advertencia al instalar HELIX Lite?</h3>
                <p>
                  Debido a que HELIX Lite es un ejecutable generado directamente por el pipeline de Tauri y aún no cuenta con un certificado de firma EV comercial costoso, Windows Defender puede mostrar la pantalla azul de "Windows protegió su PC". Puedes hacer clic en <em>"Más información"</em> y luego en <em>"Ejecutar de todas formas"</em>. Además, el instalador publica su suma de verificación SHA-256 en GitHub para que verifiques su integridad.
                </p>
              </div>

              <div className="docs-faq-item">
                <h3>¿Dónde se guardan los archivos de log del agente?</h3>
                <p>
                  Los registros de actividad y depuración se almacenan localmente en <code>%USERPROFILE%\.helix\logs</code>. Puedes inspeccionarlos o borrarlos en cualquier momento.
                </p>
              </div>

              <div className="docs-faq-item">
                <h3>¿Puedo cambiar entre HELIX Normal y HELIX Lite?</h3>
                <p>
                  Sí. Ambas versiones comparten la misma base de configuración de modelos y herramientas, por lo que puedes instalar HELIX Lite si necesitas menor consumo de memoria sin perder tu configuración previa.
                </p>
              </div>
            </article>
          )}
        </main>
      </div>

      <footer className="docs-footer">
        <div className="docs-footer__inner">
          <p>© {new Date().getFullYear()} Proyecto HELIX. Documentación técnica oficial.</p>
          <div className="docs-footer__links">
            <Link to="/privacy">Privacidad</Link>
            <Link to="/features">Novedades</Link>
            <Link to="/download">Descargar</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
