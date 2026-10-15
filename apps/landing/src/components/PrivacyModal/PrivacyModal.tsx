import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import './PrivacyModal.css';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  targetEdition?: 'Normal' | 'Lite';
}

export const PrivacyModal: React.FC<PrivacyModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  targetEdition = 'Normal',
}) => {
  const [accepted, setAccepted] = useState(false);

  if (!isOpen) return null;

  const handleProceed = () => {
    if (!accepted) return;
    try {
      localStorage.setItem('helix_privacy_accepted', 'true');
    } catch {
      // ignore storage errors
    }
    onConfirm();
    onClose();
  };

  return (
    <div className="privacy-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="privacy-modal-title">
      <div className="privacy-modal-backdrop" onClick={onClose} />
      <div className="privacy-modal-container">
        <div className="privacy-modal-header">
          <div className="privacy-modal-badge">
            <span className="privacy-modal-badge__dot" />
            <span>HELIX {targetEdition} · VERIFICACIÓN DE SEGURIDAD</span>
          </div>
          <h2 id="privacy-modal-title" className="privacy-modal-title">
            Aprobación de Privacidad y Acceso al Sistema
          </h2>
          <p className="privacy-modal-subtitle">
            Antes de descargar e instalar HELIX en Windows, revisa cómo opera el agente en tu máquina.
          </p>
        </div>

        <div className="privacy-modal-body">
          <div className="privacy-modal-card">
            <div className="privacy-item">
              <span className="privacy-item__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
              <div>
                <h4>Captura de pantalla bajo demanda</h4>
                <p>HELIX solo analiza tu pantalla cuando se lo pides explícitamente en el chat o por comando. Los fotogramas se procesan en memoria volátil y nunca se almacenan ni se venden.</p>
              </div>
            </div>

            <div className="privacy-item">
              <span className="privacy-item__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </span>
              <div>
                <h4>Micrófono y voz transparente</h4>
                <p>La escucha por micrófono solo está activa durante estados de conversación directa. No existe grabación de fondo continua ni almacenamiento encubierto.</p>
              </div>
            </div>

            <div className="privacy-item">
              <span className="privacy-item__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7.5" cy="15.5" r="5.5" />
                  <path d="m21 2-9.6 9.6" />
                  <path d="m15.5 7.5 3 3L22 7l-3-3" />
                </svg>
              </span>
              <div>
                <h4>Tus claves de API se quedan contigo</h4>
                <p>Tus API keys se guardan localmente en Windows Credential Manager o tu archivo <code>.env</code>. Se comunican directamente y de forma cifrada con tus proveedores (Google, OpenAI, Anthropic o modelos locales con Ollama).</p>
              </div>
            </div>

            <div className="privacy-item">
              <span className="privacy-item__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                </svg>
              </span>
              <div>
                <h4>Política Zero-Trust</h4>
                <p>Cualquier operación que altere archivos, ejecute comandos en PowerShell o modifique el sistema requiere tu confirmación explícita antes de ejecutarse.</p>
              </div>
            </div>
          </div>

          <label className="privacy-consent-label">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="privacy-consent-checkbox"
            />
            <span className="privacy-consent-text">
              He leído y apruebo la <Link to="/privacy" target="_blank" className="privacy-link">Política de Privacidad completa</Link> y las condiciones de ejecución local en Windows.
            </span>
          </label>
        </div>

        <div className="privacy-modal-footer">
          <button type="button" className="privacy-btn-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="privacy-btn-confirm"
            disabled={!accepted}
            onClick={handleProceed}
          >
            Descargar HELIX {targetEdition} <span aria-hidden="true">↓</span>
          </button>
        </div>
      </div>
    </div>
  );
};
