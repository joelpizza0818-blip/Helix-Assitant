import React, { useEffect, useRef } from 'react'
import type { VoiceState } from '../../hooks/useVoiceSession'

interface HelixNucleusProps {
  state: VoiceState
  audioLevel: number // 0.0 to 1.0
  size?: number
  className?: string
}

interface OrbitParticle {
  orbitIndex: number
  progress: number // 0.0 to 1.0
  speed: number
  color: 'cyan' | 'amber'
  size: number
}

const ORBITS = [
  { radiusX: 185, radiusY: 65, tiltZ: -0.25, tiltX: 0.35 },
  { radiusX: 195, radiusY: 75, tiltZ: 0.45, tiltX: -0.2 },
  { radiusX: 175, radiusY: 55, tiltZ: -0.6, tiltX: 0.4 },
  { radiusX: 205, radiusY: 85, tiltZ: 0.1, tiltX: 0.5 },
]

export const HelixNucleus: React.FC<HelixNucleusProps> = ({
  state,
  audioLevel,
  size = 460,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number | null>(null)

  // The animation loop reads these refs every frame. Keeping them out of the
  // effect dependencies means a level update (many per second) never tears
  // down and rebuilds the render loop.
  const stateRef = useRef<VoiceState>(state)
  const targetLevelRef = useRef(0)
  stateRef.current = state
  targetLevelRef.current = Math.max(0, Math.min(1, audioLevel))

  // Motion and rotation angles in 3D
  const rotYRef = useRef(0)
  const rotXRef = useRef(0.2)
  const pulseRef = useRef(0)
  const currentLevelRef = useRef(0)

  // Persistent particles along orbital rings
  const particlesRef = useRef<OrbitParticle[]>([
    { orbitIndex: 0, progress: 0.12, speed: 0.0035, color: 'cyan', size: 3.5 },
    { orbitIndex: 0, progress: 0.65, speed: 0.0035, color: 'amber', size: 3.0 },
    { orbitIndex: 1, progress: 0.35, speed: -0.0042, color: 'cyan', size: 4.0 },
    { orbitIndex: 1, progress: 0.88, speed: -0.0042, color: 'amber', size: 3.2 },
    { orbitIndex: 2, progress: 0.05, speed: 0.0028, color: 'amber', size: 3.8 },
    { orbitIndex: 2, progress: 0.52, speed: 0.0028, color: 'cyan', size: 3.0 },
    { orbitIndex: 3, progress: 0.22, speed: -0.0032, color: 'amber', size: 3.5 },
    { orbitIndex: 3, progress: 0.77, speed: -0.0032, color: 'cyan', size: 2.8 },
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Orbits are authored for a 460px stage; scale down for smaller windows.
    const scale = size / 460
    const orbits = ORBITS.map((orbit) => ({
      ...orbit,
      radiusX: orbit.radiusX * scale,
      radiusY: orbit.radiusY * scale,
    }))

    const render = () => {
      const currentState = stateRef.current
      const targetLevel = targetLevelRef.current

      // Smooth audio level damping
      currentLevelRef.current += (targetLevel - currentLevelRef.current) * 0.22
      const level = currentLevelRef.current

      // Handle speed based on agent state
      let speedMultiplier = 1.0
      if (currentState === 'THINKING' || currentState === 'PROCESSING') speedMultiplier = 2.4
      else if (currentState === 'SPEAKING') speedMultiplier = 1.3
      else if (currentState === 'MUTED') speedMultiplier = 0.4
      else if (currentState === 'ERROR') speedMultiplier = 0.5
      else if (currentState === 'AWAITING_CONFIRMATION') speedMultiplier = 0.7

      rotYRef.current += 0.005 * speedMultiplier
      pulseRef.current += 0.035 * speedMultiplier

      const width = size
      const height = size
      const cx = width / 2
      const cy = height / 2

      ctx.clearRect(0, 0, width, height)
      ctx.save()

      // State color palette
      let coreColorCenter = '#ffffff'
      let coreColorMid = '#ffea79'
      let coreColorOuter = '#ff9800'
      let coreColorHaze = 'rgba(230, 81, 0, 0.28)'
      let flareColor = 'rgba(255, 236, 179, 0.85)'

      if (currentState === 'MUTED') {
        coreColorCenter = '#f5f5f5'
        coreColorMid = '#b0bec5'
        coreColorOuter = '#78909c'
        coreColorHaze = 'rgba(69, 90, 100, 0.25)'
        flareColor = 'rgba(207, 216, 220, 0.4)'
      } else if (currentState === 'ERROR') {
        coreColorCenter = '#ffffff'
        coreColorMid = '#ff8a80'
        coreColorOuter = '#d50000'
        coreColorHaze = 'rgba(213, 0, 0, 0.35)'
        flareColor = 'rgba(255, 138, 128, 0.8)'
      } else if (currentState === 'THINKING' || currentState === 'PROCESSING') {
        coreColorMid = '#ffe57f'
        coreColorOuter = '#ffa000'
      } else if (currentState === 'AWAITING_CONFIRMATION') {
        coreColorMid = '#fff59d'
        coreColorOuter = '#ffb300'
      }

      // Base radius of central core
      const breathing = Math.sin(pulseRef.current) * 2.5 * scale
      const dynamicExpansion = level * 28 * scale
      const coreRadius = Math.max(12 * scale, 26 * scale + breathing + dynamicExpansion)
      const glowRadius = coreRadius * (2.8 + level * 1.5)

      // ── 1. Outer Radial Glow Haze ─────────────────────────────────
      const outerGlow = ctx.createRadialGradient(cx, cy, coreRadius * 0.4, cx, cy, glowRadius * 2.2)
      outerGlow.addColorStop(0, coreColorOuter)
      outerGlow.addColorStop(0.35, coreColorHaze)
      outerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = outerGlow
      ctx.beginPath()
      ctx.arc(cx, cy, glowRadius * 2.2, 0, Math.PI * 2)
      ctx.fill()

      // ── 2. 3D Wireframe Sphere (Latitude & Longitude) ─────────────
      const sphereRadius = 135 * scale + level * 6
      const rotY = rotYRef.current
      const rotX = rotXRef.current

      ctx.strokeStyle = currentState === 'MUTED' ? 'rgba(144, 164, 174, 0.2)' : 'rgba(255, 183, 77, 0.28)'
      ctx.lineWidth = Math.max(0.6, 0.9 * scale)

      // Latitude lines (horizontal slices)
      const latCount = 7
      for (let i = 1; i <= latCount; i++) {
        const phi = ((i / (latCount + 1)) - 0.5) * Math.PI // -PI/2 to PI/2
        const rLat = sphereRadius * Math.cos(phi)
        const yLat = sphereRadius * Math.sin(phi)

        ctx.beginPath()
        const steps = 48
        for (let j = 0; j <= steps; j++) {
          const theta = (j / steps) * Math.PI * 2
          const px = rLat * Math.cos(theta)
          const py = yLat
          const pz = rLat * Math.sin(theta)

          const y1 = py * Math.cos(rotX) - pz * Math.sin(rotX)
          const z1 = py * Math.sin(rotX) + pz * Math.cos(rotX)
          const x2 = px * Math.cos(rotY) + z1 * Math.sin(rotY)
          const y2 = y1

          const screenX = cx + x2
          const screenY = cy + y2

          if (j === 0) ctx.moveTo(screenX, screenY)
          else ctx.lineTo(screenX, screenY)
        }
        ctx.stroke()
      }

      // Longitude lines (vertical meridian circles)
      const lonCount = 8
      for (let i = 0; i < lonCount; i++) {
        const lambda = (i / lonCount) * Math.PI // meridian angle
        ctx.beginPath()
        const steps = 48
        for (let j = 0; j <= steps; j++) {
          const theta = (j / steps) * Math.PI * 2
          const px = sphereRadius * Math.cos(theta) * Math.cos(lambda)
          const py = sphereRadius * Math.sin(theta)
          const pz = sphereRadius * Math.cos(theta) * Math.sin(lambda)

          const y1 = py * Math.cos(rotX) - pz * Math.sin(rotX)
          const z1 = py * Math.sin(rotX) + pz * Math.cos(rotX)
          const x2 = px * Math.cos(rotY) + z1 * Math.sin(rotY)
          const y2 = y1

          const screenX = cx + x2
          const screenY = cy + y2

          if (j === 0) ctx.moveTo(screenX, screenY)
          else ctx.lineTo(screenX, screenY)
        }
        ctx.stroke()
      }

      // ── 3. Elliptical Orbital Rings ──────────────────────────────
      ctx.lineWidth = Math.max(0.7, 1.0 * scale)
      orbits.forEach((orbit) => {
        ctx.strokeStyle = currentState === 'MUTED' ? 'rgba(144, 164, 174, 0.3)' : 'rgba(255, 179, 0, 0.4)'
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(orbit.tiltZ + rotY * 0.15)
        ctx.scale(1, Math.cos(orbit.tiltX))
        ctx.beginPath()
        ctx.ellipse(0, 0, orbit.radiusX + level * 8 * scale, orbit.radiusY + level * 4 * scale, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      })

      // ── 4. Orbital Particles (Cyan & Amber) ────────────────────────
      particlesRef.current.forEach((p) => {
        p.progress = (p.progress + p.speed * speedMultiplier + 1.0) % 1.0
        const orbit = orbits[p.orbitIndex]
        const angle = p.progress * Math.PI * 2
        const rx = orbit.radiusX + level * 8 * scale
        const ry = orbit.radiusY + level * 4 * scale

        const localX = rx * Math.cos(angle)
        const localY = ry * Math.sin(angle) * Math.cos(orbit.tiltX)
        const rotAngle = orbit.tiltZ + rotY * 0.15
        const px = cx + (localX * Math.cos(rotAngle) - localY * Math.sin(rotAngle))
        const py = cy + (localX * Math.sin(rotAngle) + localY * Math.cos(rotAngle))

        const isCyan = p.color === 'cyan'
        const baseColor = isCyan ? '#00e5ff' : '#ffb300'
        const glowColor = isCyan ? 'rgba(0, 229, 255, 0.35)' : 'rgba(255, 179, 0, 0.35)'
        const particleSize = p.size * scale

        ctx.fillStyle = glowColor
        ctx.beginPath()
        ctx.arc(px, py, particleSize * 2.2 + level * 2 * scale, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = baseColor
        ctx.beginPath()
        ctx.arc(px, py, particleSize, 0, Math.PI * 2)
        ctx.fill()
      })

      // ── 5. Horizontal Lens Flare Streak ───────────────────────────
      const flareWidth = sphereRadius * (2.4 + level * 0.8)
      const flareHeight = (2.8 + level * 3) * scale
      const flareGrad = ctx.createLinearGradient(cx - flareWidth / 2, cy, cx + flareWidth / 2, cy)
      flareGrad.addColorStop(0, 'rgba(255, 255, 255, 0)')
      flareGrad.addColorStop(0.3, flareColor)
      flareGrad.addColorStop(0.5, '#ffffff')
      flareGrad.addColorStop(0.7, flareColor)
      flareGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')

      ctx.fillStyle = flareGrad
      ctx.beginPath()
      ctx.ellipse(cx, cy, flareWidth / 2, flareHeight / 2, 0, 0, Math.PI * 2)
      ctx.fill()

      // ── 6. Central Luminous Core ──────────────────────────────────
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius)
      coreGrad.addColorStop(0, coreColorCenter)
      coreGrad.addColorStop(0.25, coreColorCenter)
      coreGrad.addColorStop(0.55, coreColorMid)
      coreGrad.addColorStop(0.85, coreColorOuter)
      coreGrad.addColorStop(1, 'rgba(255, 152, 0, 0)')

      ctx.fillStyle = coreGrad
      ctx.beginPath()
      ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2)
      ctx.fill()

      // Hot white center spot
      const hotSpotRadius = coreRadius * 0.42
      const hotSpot = ctx.createRadialGradient(cx, cy, 0, cx, cy, hotSpotRadius)
      hotSpot.addColorStop(0, '#ffffff')
      hotSpot.addColorStop(0.7, '#ffffff')
      hotSpot.addColorStop(1, 'rgba(255, 255, 255, 0)')

      ctx.fillStyle = hotSpot
      ctx.beginPath()
      ctx.arc(cx, cy, hotSpotRadius, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
      animFrameRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
    }
  }, [size])

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        width: size,
        height: size,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          display: 'block',
        }}
        aria-hidden="true"
      />
    </div>
  )
}
