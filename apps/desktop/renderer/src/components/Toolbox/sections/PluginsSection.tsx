import { useEffect, useState } from 'react'
import { COMMUNITY_INSTALLED_PLUGINS_KEY } from '../../../lib/desktopSupabase'
import '../Toolbox.css'

interface InstalledCommunityPlugin {
  id: string
  name: string
  url: string
}

const BUILT_IN_PLUGINS = [
  {
    id: 'gmail',
    name: 'Gmail',
    role: 'Correo',
    url: 'https://mail.google.com/',
    description: 'Abre tu bandeja de Gmail en la pestaña dedicada de HELIX.',
    color: '#EA4335',
    mark: 'G',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    role: 'Asistente web',
    url: 'https://chatgpt.com/',
    description: 'Usa la sesión web de ChatGPT en la pestaña dedicada de HELIX.',
    color: '#10A37F',
    mark: 'AI',
  },
  {
    id: 'word',
    name: 'Word',
    role: 'Documentos',
    url: 'https://word.office.com/',
    description: 'Abre Word para trabajar con documentos desde el navegador HELIX.',
    color: '#2B579A',
    mark: 'W',
  },
  {
    id: 'excel',
    name: 'Excel',
    role: 'Hojas de cálculo',
    url: 'https://excel.office.com/',
    description: 'Abre Excel para trabajar con hojas de cálculo desde HELIX.',
    color: '#217346',
    mark: 'X',
  },
  {
    id: 'powerpoint',
    name: 'PowerPoint',
    role: 'Presentaciones',
    url: 'https://powerpoint.office.com/',
    description: 'Abre PowerPoint para crear y revisar presentaciones en HELIX.',
    color: '#D24726',
    mark: 'P',
  },
]

export default function PluginsSection() {
  const [browserConnected, setBrowserConnected] = useState(false)
  const [communityPlugins, setCommunityPlugins] = useState<InstalledCommunityPlugin[]>([])
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openedPlugin, setOpenedPlugin] = useState<string | null>(null)

  const refreshBrowserStatus = async () => {
    try {
      const info = await window.helix.getBrowserExtensionInfo()
      setBrowserConnected(info.listening && info.extensionConnected)
    } catch (cause) {
      setBrowserConnected(false)
      setError(cause instanceof Error ? cause.message : 'No se pudo consultar el navegador HELIX.')
    }
  }

  useEffect(() => {
    void refreshBrowserStatus()
    try {
      const saved = JSON.parse(localStorage.getItem(COMMUNITY_INSTALLED_PLUGINS_KEY) ?? '[]')
      if (!Array.isArray(saved)) throw new Error('The local Community plugin list is invalid.')
      const valid = saved.filter((entry): entry is InstalledCommunityPlugin => {
        if (
          !entry
          || typeof entry !== 'object'
          || typeof entry.id !== 'string'
          || typeof entry.name !== 'string'
          || typeof entry.url !== 'string'
        ) return false
        try {
          const url = new URL(entry.url)
          return url.protocol === 'https:' && !url.username && !url.password
        } catch {
          return false
        }
      })
      if (valid.length !== saved.length) {
        setError('Se omitieron plugins locales con datos inválidos. Reinstálalos desde Community.')
      }
      setCommunityPlugins(valid)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo leer la lista local de plugins.')
    }
  }, [])

  const openPlugin = async (plugin: typeof BUILT_IN_PLUGINS[number]) => {
    setBusyPlugin(plugin.id)
    setError(null)
    try {
      await window.helix.openManagedBrowserTab(plugin.url)
      setOpenedPlugin(plugin.id)
      await refreshBrowserStatus()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `No se pudo abrir ${plugin.name}.`)
    } finally {
      setBusyPlugin(null)
    }
  }

  const openCommunityPlugin = async (plugin: InstalledCommunityPlugin) => {
    setBusyPlugin(plugin.id)
    setError(null)
    try {
      await window.helix.openManagedBrowserTab(plugin.url)
      setOpenedPlugin(plugin.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `No se pudo abrir ${plugin.name}.`)
    } finally {
      setBusyPlugin(null)
    }
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Plugins</h2>
      <p className="toolbox-section__desc">
        Conectores web de HELIX. Se abren en una pestaña dedicada del navegador emparejado; las cuentas y cookies siguen siendo las de tu perfil habitual.
      </p>
      <div className={`community-browser-status ${browserConnected ? 'is-connected' : ''}`}>
        <span className="community-status-dot" />
        <span>
          {browserConnected
            ? 'Navegador HELIX conectado'
            : 'Conecta Browser Companion para abrir plugins en la pestaña HELIX'}
        </span>
        <button type="button" className="community-text-button" onClick={() => void refreshBrowserStatus()}>
          Actualizar
        </button>
      </div>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <div className="community-plugin-grid">
        {BUILT_IN_PLUGINS.map((plugin) => (
          <article className="community-plugin-card" key={plugin.id}>
            <div className="community-plugin-card__top">
              <span className="community-plugin-mark" style={{ backgroundColor: plugin.color }}>
                {plugin.mark}
              </span>
              <div>
                <h3>{plugin.name}</h3>
                <span>{plugin.role}</span>
              </div>
            </div>
            <p>{plugin.description}</p>
            <button
              type="button"
              className="validate-btn community-primary-button"
              disabled={busyPlugin !== null}
              onClick={() => void openPlugin(plugin)}
            >
              {busyPlugin === plugin.id
                ? 'Abriendo…'
                : openedPlugin === plugin.id
                  ? 'Volver a abrir'
                  : 'Abrir en pestaña HELIX'}
            </button>
          </article>
        ))}
      </div>
      {communityPlugins.length > 0 && (
        <>
          <h3 className="community-plugin-list-title">Plugins de Community instalados</h3>
          <div className="community-plugin-grid">
            {communityPlugins.map((plugin) => (
              <article className="community-plugin-card" key={plugin.id}>
                <div className="community-plugin-card__top">
                  <span className="community-plugin-mark community-plugin-mark--community">C</span>
                  <div>
                    <h3>{plugin.name}</h3>
                    <span>Community plugin</span>
                  </div>
                </div>
                <p>{new URL(plugin.url).hostname}</p>
                <button
                  type="button"
                  className="validate-btn community-primary-button"
                  disabled={busyPlugin !== null}
                  onClick={() => void openCommunityPlugin(plugin)}
                >
                  {busyPlugin === plugin.id ? 'Abriendo…' : 'Abrir en pestaña HELIX'}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      <p className="community-disclaimer">
        Estos conectores abren los sitios web; no usan OAuth ni acceden a APIs propias de esos servicios. Revisa cada acción antes de enviar o modificar contenido.
      </p>
    </section>
  )
}
