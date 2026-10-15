import React from 'react';
import { Link } from 'react-router-dom';
import { HelixLogo } from '../components/HelixLogo/HelixLogo';
import './PrivacyPage.css';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="privacy-page" id="top">
      <header className="privacy-header">
        <Link to="/" className="privacy-header__brand" aria-label="Volver a la página principal de HELIX">
          <HelixLogo size="sm" showText />
        </Link>
        <div className="privacy-header__links">
          <Link to="/" className="privacy-header__link">Inicio</Link>
          <Link to="/features" className="privacy-header__link">Novedades</Link>
          <Link to="/docs" className="privacy-header__link">Documentación</Link>
          <Link to="/download" className="privacy-header__cta">Descargar</Link>
        </div>
      </header>

      <main className="privacy-content">
        <div className="privacy-container">
          <div className="privacy-hero">
            <span className="privacy-eyebrow">POLÍTICA DE PRIVACIDAD & SEGURIDAD</span>
            <h1>Tu escritorio. Tu privacidad. Tus límites.</h1>
            <p className="privacy-lead">
              HELIX está diseñado bajo el principio fundamental de <strong>Local-First y Confianza Cero (Zero-Trust)</strong>. Esta política describe con total transparencia cómo interactúa el agente con tu pantalla, micrófono, archivos y credenciales de inteligencia artificial.
            </p>
            <div className="privacy-badge-row">
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                100% Sin Venta de Datos
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Captura de Pantalla Solo Bajo Demanda
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Credenciales Locales en Windows
              </span>
              <span className="privacy-pill">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Acceso Zero-Trust Confirmado por Ti
              </span>
            </div>
          </div>

          <article className="privacy-article">
            <section className="privacy-section">
              <h2>1. Arquitectura Local-First y Filosofía de Diseño</h2>
              <p>
                A diferencia de los asistentes basados exclusivamente en la nube, HELIX opera como una aplicación residente en tu sistema operativo Windows (disponible en versión completa con Electron y ultra-ligera con Tauri). El núcleo del agente se ejecuta localmente en tu computadora.
              </p>
              <p>
                Esto significa que tus datos de trabajo, árbol de procesos, ventanas activas y documentos locales no se transfieren a servidores centrales de HELIX para almacenamiento, perfilamiento ni entrenamiento de modelos.
              </p>
            </section>

            <section className="privacy-section">
              <h2>2. Captura de Pantalla y Reconocimiento Visual (OCR)</h2>
              <p>
                HELIX cuenta con capacidades de lectura de pantalla para ayudarte a resolver dudas sobre lo que estás viendo. Nuestra política de captura establece:
              </p>
              <ul>
                <li><strong>Activación exclusiva bajo demanda:</strong> HELIX nunca graba tu pantalla de manera continua ni en segundo plano. La captura solo se ejecuta cuando tú realizas una solicitud explícita en el chat (por ejemplo, <em>"¿qué error muestra esta ventana?"</em>) o al activar una habilidad que requiera contexto visual.</li>
                <li><strong>Procesamiento en memoria volátil:</strong> Las capturas de pantalla se analizan en la memoria RAM temporal y se descartan tras completar el turno de interacción. No se crea ningún historial de capturas en disco ni en servidores remotos.</li>
                <li><strong>Control de áreas sensibles:</strong> Puedes configurar exclusiones para ventanas con contenido sensible como gestores de contraseñas o aplicaciones bancarias.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>3. Audio y Micrófono (SoundDevice)</h2>
              <p>
                HELIX incorpora un motor de voz nativo para permitir interacción por comandos hablados:
              </p>
              <ul>
                <li><strong>Sin escucha pasiva permanente:</strong> El micrófono solo se abre durante sesiones activas de voz iniciadas por ti (mediante atajo de teclado o botón de voz).</li>
                <li><strong>Indicador visible de estado:</strong> Siempre que HELIX esté escuchando, verás un indicador visual animado claro en la barra de herramientas y la interfaz flotante.</li>
                <li><strong>Desactivación instantánea:</strong> Puedes silenciar el micrófono o revocar el permiso de audio en cualquier momento desde la configuración de Windows o la barra de sistema (Tray).</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>4. Credenciales de Modelos y Almacenamiento Seguro</h2>
              <p>
                HELIX te permite conectar tus propios proveedores de inteligencia artificial (Google Gemini, Anthropic Claude, OpenAI, Groq) o motores locales (Ollama):
              </p>
              <ul>
                <li><strong>Almacenamiento seguro en el Administrador de Credenciales de Windows:</strong> Tus claves de API nunca se envían a servidores de HELIX. Se almacenan cifradas en el <code>Windows Credential Manager</code> o en tu archivo local <code>.env</code>.</li>
                <li><strong>Conexión directa entre cliente y proveedor:</strong> Las llamadas a los modelos de lenguaje viajan directamente mediante conexiones cifradas TLS/HTTPS desde tu equipo hacia los endpoints del proveedor que tú hayas configurado.</li>
                <li><strong>Modelos locales sin conexión:</strong> Si configuras HELIX con Ollama o modelos locales, tus conversaciones y tareas no salen en ningún momento de tu red local.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>5. Ejecución de Herramientas del Sistema y Modelo Zero-Trust</h2>
              <p>
                Para automatizar tareas complejas, HELIX dispone de herramientas para manipular el sistema de archivos, ejecutar comandos en PowerShell y controlar aplicaciones:
              </p>
              <ul>
                <li><strong>Revisión de políticas (Policy Checked):</strong> Antes de ejecutar cualquier acción que modifique archivos, elimine datos, cambie la configuración del registro o descargue paquetes, HELIX solicita tu confirmación explícita mediante un diálogo en pantalla.</li>
                <li><strong>Registro de auditoría local:</strong> Todas las acciones ejecutadas por las herramientas se registran en un archivo de log local en tu máquina para que puedas auditar con precisión qué comandos se corrieron y cuándo.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>6. Telemetría y Datos Personales</h2>
              <p>
                HELIX mantiene una postura estricta frente a la recolección de datos:
              </p>
              <ul>
                <li><strong>Cero venta de datos:</strong> No vendemos, alquilamos ni comercializamos tu información personal, tus consultas ni tu contexto de trabajo a terceros bajo ninguna circunstancia.</li>
                <li><strong>Telemetría mínima y anonimizada:</strong> Solo recogemos métricas opcionales sobre estabilidad de la aplicación y fallos críticos de compiladores, sin identificadores personales, nombres de usuario ni contenido de mensajes.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>7. Eliminación y Derechos del Usuario</h2>
              <p>
                En cumplimiento con normativas de protección de datos como GDPR, CCPA y buenas prácticas de seguridad en software de escritorio:
              </p>
              <ul>
                <li>Tienes derecho a purgar cualquier conversación previa, configuración o credencial guardada directamente desde el menú de configuración de HELIX.</li>
                <li>La desinstalación completa a través del panel de control de Windows elimina los ejecutables, registros y servicios del agente de forma limpia.</li>
              </ul>
            </section>

            <section className="privacy-section">
              <h2>8. Contacto y Soporte</h2>
              <p>
                Si tienes preguntas sobre la seguridad de HELIX o deseas reportar una inquietud sobre la privacidad del agente, puedes comunicarte a través del repositorio oficial de GitHub del proyecto HELIX.
              </p>
              <div className="privacy-cta-box">
                <div>
                  <h3>¿Listo para probar HELIX con total tranquilidad?</h3>
                  <p>Descarga la versión para Windows con aprobación previa de políticas de seguridad.</p>
                </div>
                <Link to="/download" className="privacy-btn-action">Descargar HELIX</Link>
              </div>
            </section>
          </article>
        </div>
      </main>

      <footer className="privacy-footer">
        <div className="privacy-footer__inner">
          <div className="privacy-footer__brand">
            <HelixLogo size="sm" showText />
            <p>Agente persistente de escritorio para Windows.</p>
          </div>
          <div className="privacy-footer__nav">
            <div>
              <span>EXPLORAR</span>
              <Link to="/">Inicio</Link>
              <Link to="/features">Novedades</Link>
              <Link to="/docs">Documentación</Link>
            </div>
            <div>
              <span>LEGAL Y CUENTA</span>
              <Link to="/privacy">Privacidad</Link>
              <Link to="/login">Iniciar sesión</Link>
              <Link to="/register">Crear cuenta</Link>
            </div>
          </div>
        </div>
        <div className="privacy-footer__bottom">
          <span>© {new Date().getFullYear()} Proyecto HELIX. Licenciado bajo Apache 2.0.</span>
          <a href="#top">Volver arriba ↑</a>
        </div>
      </footer>
    </div>
  );
};
