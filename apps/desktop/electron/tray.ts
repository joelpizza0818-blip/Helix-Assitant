import { Tray, Menu, nativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

type AgentStatus = 'idle' | 'busy' | 'error' | 'listening' | 'executing'

export class TrayManager {
  private tray: Tray | null = null
  private onLeftClickHandler: (() => void) | null = null

  create(iconPath: string): void {
    let icon: Electron.NativeImage
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath)
      icon = icon.resize({ width: 16, height: 16 })
    } else {
      // Minimal 1x1 transparent fallback icon
      icon = nativeImage.createEmpty()
    }

    this.tray = new Tray(icon)
    this.tray.setToolTip('HELIX — AI Computer Agent')

    this.tray.on('click', () => {
      this.onLeftClickHandler?.()
    })
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  updateStatus(status: AgentStatus): void {
    const tooltips: Record<AgentStatus, string> = {
      idle: 'HELIX — Ready',
      busy: 'HELIX — Working...',
      error: 'HELIX — Error (click to open)',
      listening: 'HELIX — Listening...',
      executing: 'HELIX — Executing task...'
    }
    this.tray?.setToolTip(tooltips[status] ?? 'HELIX')
  }

  setOnLeftClick(fn: () => void): void {
    this.onLeftClickHandler = fn
  }

  setContextMenu(menu: Menu): void {
    this.tray?.setContextMenu(menu)
  }

  setTooltip(text: string): void {
    this.tray?.setToolTip(text)
  }
}
