import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { ProjectGraph, ProjectGraphEdge, ProjectGraphNode } from '../../../types/global'
import './ProjectGraphEditor.css'

interface Props {
  projectId: string | null
  graphType?: 'project' | 'general'
  onOpenFile?: (relativePath: string) => void
}

interface GraphPoint {
  x: number
  y: number
}

interface GraphCamera extends GraphPoint {
  scale: number
}

type PointerAction =
  | { kind: 'node'; pointerId: number; nodeId: string; offset: GraphPoint }
  | { kind: 'pan'; pointerId: number; start: GraphPoint; camera: GraphCamera }

export interface ProjectGraphEditorHandle {
  confirmProjectChange: () => boolean
}

const NODE_COLORS: Record<ProjectGraphNode['type'], string> = {
  project: '#3B82F6',
  memory: '#A0CA92',
  technology: '#F97316',
  decision: '#22C55E',
  problem: '#EF4444',
  solution: '#14B8A6',
  task: '#E5E7EB',
  result: '#E5E7EB',
  file: '#A78BFA',
}
const EDGE_COLOR = '#8A8380'
const CANVAS_WIDTH = 760
const CANVAS_HEIGHT = 460
const NODE_TYPES: ProjectGraphNode['type'][] = [
  'memory',
  'technology',
  'decision',
  'problem',
  'solution',
  'task',
  'result',
  'file',
]

function graphCopy(graph: ProjectGraph): ProjectGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  }
}

function hashNumber(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function layoutGraph(graph: ProjectGraph): Map<string, GraphPoint> {
  const points = new Map<string, GraphPoint>()
  const nodes = graph.nodes
  if (nodes.length === 0) return points

  const adjacency = new Map(nodes.map((node) => [node.node_id, new Set<string>()]))
  graph.edges.forEach((edge) => {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  })

  const components: ProjectGraphNode[][] = []
  const visited = new Set<string>()
  nodes.forEach((start) => {
    if (visited.has(start.node_id)) return
    const component: ProjectGraphNode[] = []
    const queue = [start.node_id]
    visited.add(start.node_id)
    while (queue.length) {
      const current = queue.shift()
      if (!current) continue
      const node = nodes.find((item) => item.node_id === current)
      if (node) component.push(node)
      adjacency.get(current)?.forEach((neighbor) => {
        if (visited.has(neighbor)) return
        visited.add(neighbor)
        queue.push(neighbor)
      })
    }
    components.push(component)
  })
  components.sort((left, right) => right.length - left.length)

  const componentCenters = new Map<string, GraphPoint>()
  components.forEach((component, componentIndex) => {
    let center: GraphPoint
    if (componentIndex === 0 && component.length > 1) {
      center = { x: 380, y: 230 }
    } else {
      const angle = componentIndex * 2.399963229728653 - Math.PI / 2
      const radius = componentIndex === 0 ? 0 : 210 + Math.min(componentIndex * 18, 110)
      center = {
        x: 380 + Math.cos(angle) * radius,
        y: 230 + Math.sin(angle) * radius,
      }
    }
    component.forEach((node) => componentCenters.set(node.node_id, center))
  })

  const pending = nodes.filter((node) => (
    Number.isFinite(node.x) && Number.isFinite(node.y)
      ? (points.set(node.node_id, { x: node.x as number, y: node.y as number }), false)
      : true
  ))
  if (pending.length === 0) return points

  if (pending.length > 140) {
    pending.forEach((node, index) => {
      const center = componentCenters.get(node.node_id) ?? { x: 380, y: 230 }
      const angle = index * 2.399963229728653
      const radius = 20 + Math.sqrt(index + 1) * 12
      points.set(node.node_id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      })
    })
    return points
  }

  pending.forEach((node, index) => {
    const center = componentCenters.get(node.node_id) ?? { x: 380, y: 230 }
    const angle = hashNumber(node.node_id) % 6283 / 1000
    const radius = 25 + Math.sqrt(index + 1) * 12
    points.set(node.node_id, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    })
  })

  const pendingIds = new Set(pending.map((node) => node.node_id))
  const edgePairs = graph.edges.filter((edge) => (
    pendingIds.has(edge.source) && pendingIds.has(edge.target)
  ))
  for (let iteration = 0; iteration < 90; iteration += 1) {
    const forces = new Map(pending.map((node) => [node.node_id, { x: 0, y: 0 }]))
    for (let left = 0; left < pending.length; left += 1) {
      const first = pending[left]
      const firstPoint = points.get(first.node_id)
      if (!firstPoint) continue
      for (let right = left + 1; right < pending.length; right += 1) {
        const second = pending[right]
        const secondPoint = points.get(second.node_id)
        if (!secondPoint) continue
        let dx = firstPoint.x - secondPoint.x
        let dy = firstPoint.y - secondPoint.y
        const distanceSquared = Math.max(dx * dx + dy * dy, 0.01)
        const distance = Math.sqrt(distanceSquared)
        if (distance < 0.1) {
          dx = ((hashNumber(first.node_id + second.node_id) % 100) - 50) / 100
          dy = ((hashNumber(second.node_id + first.node_id) % 100) - 50) / 100
        }
        const repulsion = 1800 / distanceSquared
        const firstForce = forces.get(first.node_id)
        const secondForce = forces.get(second.node_id)
        if (!firstForce || !secondForce) continue
        firstForce.x += dx / distance * repulsion
        firstForce.y += dy / distance * repulsion
        secondForce.x -= dx / distance * repulsion
        secondForce.y -= dy / distance * repulsion
      }
    }
    edgePairs.forEach((edge) => {
      const firstPoint = points.get(edge.source)
      const secondPoint = points.get(edge.target)
      const firstForce = forces.get(edge.source)
      const secondForce = forces.get(edge.target)
      if (!firstPoint || !secondPoint || !firstForce || !secondForce) return
      const dx = secondPoint.x - firstPoint.x
      const dy = secondPoint.y - firstPoint.y
      const distance = Math.max(Math.hypot(dx, dy), 0.1)
      const pull = (distance - 58) * 0.004
      firstForce.x += dx / distance * pull
      firstForce.y += dy / distance * pull
      secondForce.x -= dx / distance * pull
      secondForce.y -= dy / distance * pull
    })
    pending.forEach((node) => {
      const point = points.get(node.node_id)
      const force = forces.get(node.node_id)
      const center = componentCenters.get(node.node_id)
      if (!point || !force || !center) return
      point.x += Math.max(-4, Math.min(4, force.x + (center.x - point.x) * 0.008))
      point.y += Math.max(-4, Math.min(4, force.y + (center.y - point.y) * 0.008))
    })
  }
  return points
}

function fitCamera(points: Map<string, GraphPoint>): GraphCamera {
  if (points.size === 0) return { x: 0, y: 0, scale: 1 }
  const coordinates = [...points.values()]
  const minX = Math.min(...coordinates.map((point) => point.x))
  const maxX = Math.max(...coordinates.map((point) => point.x))
  const minY = Math.min(...coordinates.map((point) => point.y))
  const maxY = Math.max(...coordinates.map((point) => point.y))
  const width = Math.max(maxX - minX, 40)
  const height = Math.max(maxY - minY, 40)
  const scale = Math.min(2.5, (CANVAS_WIDTH - 100) / width, (CANVAS_HEIGHT - 80) / height)
  return {
    x: CANVAS_WIDTH / 2 - (minX + maxX) / 2 * scale,
    y: CANVAS_HEIGHT / 2 - (minY + maxY) / 2 * scale,
    scale: Math.max(0.001, scale),
  }
}

const ProjectGraphEditor = forwardRef<ProjectGraphEditorHandle, Props>(function ProjectGraphEditor(
  { projectId, graphType = 'project', onOpenFile },
  ref,
) {
  const [graph, setGraph] = useState<ProjectGraph | null>(null)
  const [savedGraph, setSavedGraph] = useState<ProjectGraph | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [newNodeType, setNewNodeType] = useState<ProjectGraphNode['type']>('decision')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [positions, setPositions] = useState<Map<string, GraphPoint>>(new Map())
  const [savedPositions, setSavedPositions] = useState<Map<string, GraphPoint>>(new Map())
  const [camera, setCamera] = useState<GraphCamera>({ x: 0, y: 0, scale: 1 })
  const pointerAction = useRef<PointerAction | null>(null)
  const canvasRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    let active = true
    setGraph(null)
    setSavedGraph(null)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setHoveredNodeId(null)
    setError(null)
    setPositions(new Map())
    setSavedPositions(new Map())
    if (graphType === 'project' && !projectId) return

    setLoading(true)
    const request = graphType === 'general'
      ? window.helix.getGeneralMemoryGraph()
      : window.helix.getProjectGraph(projectId as string)
    void request
      .then((loaded) => {
        if (!active) return
        const copy = graphCopy(loaded)
        const initialPositions = layoutGraph(copy)
        setGraph(copy)
        setSavedGraph(graphCopy(copy))
        setPositions(initialPositions)
        setSavedPositions(new Map(initialPositions))
        setCamera(fitCamera(initialPositions))
        setSelectedNodeId(null)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the project graph.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [graphType, projectId])

  const selectedNode = graph?.nodes.find((node) => node.node_id === selectedNodeId) ?? null
  const selectedEdge = graph?.edges.find((edge) => edge.edge_id === selectedEdgeId) ?? null
  const isIndexedNode = selectedNode?.origin === 'file_index' || selectedNode?.origin === 'auto_technology'
  const isDirty = Boolean(
    graph && savedGraph && (
      JSON.stringify(graph) !== JSON.stringify(savedGraph)
      || JSON.stringify([...positions]) !== JSON.stringify([...savedPositions])
    ),
  )

  useImperativeHandle(ref, () => ({
    confirmProjectChange: () => {
      if (busy) {
        setError('Wait for the project graph save to finish before changing projects.')
        return false
      }
      return !isDirty || window.confirm('Discard unsaved project graph changes?')
    },
  }), [busy, isDirty])

  const connectedNodeIds = useMemo(() => {
    if (!graph || !hoveredNodeId) return new Set<string>()
    return new Set(
      graph.edges
        .filter((edge) => edge.source === hoveredNodeId || edge.target === hoveredNodeId)
        .map((edge) => edge.source === hoveredNodeId ? edge.target : edge.source),
    )
  }, [graph, hoveredNodeId])

  useEffect(() => {
    setNewNodeType(graphType === 'general' ? 'memory' : 'decision')
  }, [graphType])

  const nodeDegrees = useMemo(() => {
    const degrees = new Map<string, number>()
    graph?.edges.forEach((edge) => {
      degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
    })
    return degrees
  }, [graph?.edges])

  const updateNode = (nodeId: string, patch: Partial<ProjectGraphNode>) => {
    setGraph((current) => current && ({
      ...current,
      nodes: current.nodes.map((node) => (
        node.node_id === nodeId ? { ...node, ...patch } : node
      )),
    }))
  }

  const updateEdge = (edgeId: string, patch: Partial<ProjectGraphEdge>) => {
    setGraph((current) => current && ({
      ...current,
      edges: current.edges.map((edge) => {
        if (edge.edge_id !== edgeId) return edge
        const updated = { ...edge, ...patch }
        if (edge.origin === 'auto') delete updated.origin
        return updated
      }),
    }))
  }

  const addNode = () => {
    if (!graph) return
    const node: ProjectGraphNode = {
      node_id: crypto.randomUUID(),
      type: newNodeType,
      title: `New ${newNodeType}`,
      content: '',
      color: NODE_COLORS[newNodeType],
      created_at: new Date().toISOString(),
      x: 380 + Math.cos(graph.nodes.length) * 125,
      y: 230 + Math.sin(graph.nodes.length) * 125,
    }
    setGraph({ ...graph, nodes: [...graph.nodes, node] })
    setPositions((current) => new Map(current).set(node.node_id, {
      x: 380 + Math.cos(graph.nodes.length) * 125,
      y: 230 + Math.sin(graph.nodes.length) * 125,
    }))
    setSelectedNodeId(node.node_id)
    setSelectedEdgeId(null)
  }

  const deleteNode = () => {
    if (!graph || !selectedNode || selectedNode.node_id === graph.project_id) return
    if (!window.confirm(`Delete "${selectedNode.title}" and its connections?`)) return
    setGraph({
      ...graph,
      nodes: graph.nodes.filter((node) => node.node_id !== selectedNode.node_id),
      edges: graph.edges.filter((edge) => (
        edge.source !== selectedNode.node_id && edge.target !== selectedNode.node_id
      )),
    })
    setPositions((current) => {
      const next = new Map(current)
      next.delete(selectedNode.node_id)
      return next
    })
    setSelectedNodeId(graph.project_id)
  }

  const addEdge = () => {
    if (!graph || graph.nodes.length < 2) return
    const source = selectedNode?.node_id ?? graph.project_id
    const target = graph.nodes.find((node) => node.node_id !== source)?.node_id
    if (!target) return
    const edge: ProjectGraphEdge = {
      edge_id: crypto.randomUUID(),
      source,
      target,
      relation: 'relates_to',
      color: EDGE_COLOR,
    }
    setGraph({ ...graph, edges: [...graph.edges, edge] })
    setSelectedNodeId(null)
    setSelectedEdgeId(edge.edge_id)
  }

  const deleteEdge = () => {
    if (!graph || !selectedEdge) return
    setGraph({
      ...graph,
      edges: graph.edges.filter((edge) => edge.edge_id !== selectedEdge.edge_id),
    })
    setSelectedEdgeId(null)
  }

  const saveGraph = async () => {
    if (!graph || (graphType === 'project' && !projectId)) return
    setBusy(true)
    setError(null)
    try {
      const nodes = graph.nodes.map((node) => {
        const point = positions.get(node.node_id)
        return point ? { ...node, x: point.x, y: point.y } : node
      })
      const payload = { nodes, edges: graph.edges }
      const saved = graphType === 'general'
        ? await window.helix.saveGeneralMemoryGraph(payload)
        : await window.helix.saveProjectGraph(projectId as string, payload)
      const copy = graphCopy(saved)
      const nextPositions = new Map(
        copy.nodes.map((node) => [
          node.node_id,
          { x: node.x ?? 380, y: node.y ?? 230 },
        ]),
      )
      setGraph(copy)
      setSavedGraph(graphCopy(copy))
      setPositions(nextPositions)
      setSavedPositions(new Map(nextPositions))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the project graph.')
    } finally {
      setBusy(false)
    }
  }

  const screenPoint = (clientX: number, clientY: number) => {
    const transform = canvasRef.current?.getScreenCTM()
    if (!transform) return null
    return new DOMPoint(clientX, clientY).matrixTransform(transform.inverse())
  }

  const beginNodeDrag = (event: ReactPointerEvent<SVGGElement>, nodeId: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const svg = canvasRef.current
    const pointer = screenPoint(event.clientX, event.clientY)
    const position = positions.get(nodeId)
    if (!svg || !pointer || !position) return
    svg.setPointerCapture(event.pointerId)
    const worldPoint = {
      x: (pointer.x - camera.x) / camera.scale,
      y: (pointer.y - camera.y) / camera.scale,
    }
    pointerAction.current = {
      kind: 'node',
      pointerId: event.pointerId,
      nodeId,
      offset: {
        x: position.x - worldPoint.x,
        y: position.y - worldPoint.y,
      },
    }
    setHoveredNodeId(nodeId)
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
  }

  const beginCanvasPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const target = event.target instanceof Element
      ? event.target.closest('[data-node-id], [data-edge-id]')
      : null
    if (target) return
    const point = screenPoint(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerAction.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      start: { x: point.x, y: point.y },
      camera: { ...camera },
    }
    setHoveredNodeId(null)
  }

  const movePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = screenPoint(event.clientX, event.clientY)
    if (!point) return
    const action = pointerAction.current
    if (!action || action.pointerId !== event.pointerId) {
      const target = event.target instanceof Element
        ? event.target.closest<SVGGElement>('[data-node-id]')
        : null
      setHoveredNodeId(target?.dataset.nodeId ?? null)
      return
    }
    if (action.kind === 'pan') {
      setCamera({
        ...action.camera,
        x: action.camera.x + point.x - action.start.x,
        y: action.camera.y + point.y - action.start.y,
      })
      return
    }
    const world = {
      x: (point.x - camera.x) / camera.scale,
      y: (point.y - camera.y) / camera.scale,
    }
    setPositions((current) => new Map(current).set(action.nodeId, {
      x: world.x + action.offset.x,
      y: world.y + action.offset.y,
    }))
  }

  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointerAction.current?.pointerId !== event.pointerId) return
    pointerAction.current = null
  }

  const zoomAtPointer = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const point = screenPoint(event.clientX, event.clientY)
    if (!point) return
    const nextScale = Math.min(8, Math.max(0.001, camera.scale * Math.exp(-event.deltaY * 0.001)))
    const world = {
      x: (point.x - camera.x) / camera.scale,
      y: (point.y - camera.y) / camera.scale,
    }
    setCamera({
      x: point.x - world.x * nextScale,
      y: point.y - world.y * nextScale,
      scale: nextScale,
    })
  }

  const adjustZoom = (factor: number) => {
    const point = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }
    const nextScale = Math.min(8, Math.max(0.001, camera.scale * factor))
    const world = {
      x: (point.x - camera.x) / camera.scale,
      y: (point.y - camera.y) / camera.scale,
    }
    setCamera({
      x: point.x - world.x * nextScale,
      y: point.y - world.y * nextScale,
      scale: nextScale,
    })
  }

  const fitGraph = () => setCamera(fitCamera(positions))

  if (graphType === 'project' && !projectId) {
    return <p className="text-xs text-muted">Select a project to open its knowledge graph.</p>
  }
  if (loading) return <p className="text-xs text-muted">Loading project graph…</p>
  if (!graph) return error ? <p className="toolbox-error" role="alert">{error}</p> : null

  return (
    <div className="project-graph-editor">
      <div className="project-graph-editor__toolbar">
        <div>
          <strong>{graph.nodes.length} nodes</strong>
          <span>{graph.edges.length} relationships</span>
        </div>
        <div className="project-graph-editor__actions">
          <div className="project-graph-editor__zoom-controls" aria-label="Graph zoom controls">
            <button type="button" onClick={() => adjustZoom(1.2)} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => adjustZoom(1 / 1.2)} aria-label="Zoom out">−</button>
            <button type="button" onClick={fitGraph}>Fit graph</button>
            <span>{Math.round(camera.scale * 100)}%</span>
          </div>
          <button type="button" className="validate-btn" disabled={!isDirty || busy} onClick={() => void saveGraph()}>
            {busy ? 'Saving…' : 'Save graph'}
          </button>
        </div>
      </div>
      {error && <p className="toolbox-error" role="alert">{error}</p>}

      <div className="project-graph-editor__layout">
        <div className="project-graph-editor__canvas">
          <svg
            ref={canvasRef}
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            role="group"
            aria-label={`${graphType === 'general' ? 'General memory' : 'Project'} knowledge graph. Drag nodes and empty space freely, or use the wheel to zoom.`}
            onPointerDown={beginCanvasPan}
            onPointerMove={movePointer}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={() => {
              if (!pointerAction.current) setHoveredNodeId(null)
            }}
            onWheel={zoomAtPointer}
          >
            <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="project-graph-editor__hit-area" />
            <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
              {graph.edges.map((edge) => {
                const from = positions.get(edge.source)
                const to = positions.get(edge.target)
                if (!from || !to) return null
                const isConnected = hoveredNodeId === edge.source || hoveredNodeId === edge.target
                const isSelected = selectedEdgeId === edge.edge_id
                const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
                return (
                  <g
                    key={edge.edge_id}
                    data-edge-id={edge.edge_id}
                    className={[
                      'project-graph-editor__edge',
                      isSelected ? 'is-selected' : '',
                      hoveredNodeId && !isConnected ? 'is-dimmed' : '',
                      isConnected ? 'is-highlighted' : '',
                    ].filter(Boolean).join(' ')}
                    style={isConnected || isSelected
                      ? { filter: `drop-shadow(0 0 3px ${edge.color})` }
                      : undefined}
                    role="button"
                    tabIndex={0}
                    aria-label={`Relationship ${edge.relation}`}
                    onClick={() => {
                      setSelectedEdgeId(edge.edge_id)
                      setSelectedNodeId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        setSelectedEdgeId(edge.edge_id)
                        setSelectedNodeId(null)
                      }
                    }}
                  >
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={isConnected || isSelected ? edge.color : EDGE_COLOR}
                    />
                    {isSelected && (
                      <text x={midpoint.x} y={midpoint.y - 5}>{edge.relation}</text>
                    )}
                  </g>
                )
              })}
              {graph.nodes.map((node) => {
                const point = positions.get(node.node_id)
                if (!point) return null
                const degree = nodeDegrees.get(node.node_id) ?? 0
                const radius = node.node_id === graph.project_id
                  ? 11
                  : Math.max(3, Math.min(13, 3.2 + Math.sqrt(degree) * 1.8))
                const isHovered = hoveredNodeId === node.node_id
                const isSelected = selectedNodeId === node.node_id
                return (
                  <g
                    key={node.node_id}
                    data-node-id={node.node_id}
                    className={[
                      'project-graph-editor__node',
                      isSelected ? 'is-selected' : '',
                      hoveredNodeId && !isHovered && !connectedNodeIds.has(node.node_id) ? 'is-dimmed' : '',
                      hoveredNodeId && connectedNodeIds.has(node.node_id) ? 'is-connected' : '',
                    ].filter(Boolean).join(' ')}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.type}: ${node.title}`}
                    onClick={() => {
                      setSelectedNodeId(node.node_id)
                      setSelectedEdgeId(null)
                    }}
                    onDoubleClick={() => {
                      if (node.type === 'file' && node.relative_path) {
                        onOpenFile?.(node.relative_path)
                      }
                    }}
                    onPointerDown={(event) => beginNodeDrag(event, node.node_id)}
                    onPointerEnter={() => setHoveredNodeId(node.node_id)}
                    onPointerLeave={() => {
                      if (!pointerAction.current) setHoveredNodeId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        setSelectedNodeId(node.node_id)
                        setSelectedEdgeId(null)
                        if (event.key === 'Enter' && node.type === 'file' && node.relative_path) {
                          onOpenFile?.(node.relative_path)
                        }
                      }
                    }}
                  >
                    <title>{node.type}: {node.title}</title>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={radius}
                      fill={node.color}
                      style={{
                        filter: isHovered || connectedNodeIds.has(node.node_id)
                          ? `drop-shadow(0 0 6px ${node.color})`
                          : undefined,
                      }}
                    />
                    {(isHovered || isSelected) && (
                      <text className="project-graph-editor__node-title" x={point.x} y={point.y + radius + 16}>
                        {node.title.length > 36 ? `${node.title.slice(0, 35)}…` : node.title}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
          <div className="project-graph-editor__hint">Drag nodes or empty space to move · Scroll to zoom</div>
        </div>

        <details className="project-graph-editor__details">
          <summary>Graph controls and selected item</summary>
          <aside className="project-graph-editor__panel">
          <div className="project-graph-editor__add">
            <label>
              Add node
              <select className="form-input" value={newNodeType} onChange={(event) => setNewNodeType(event.target.value as ProjectGraphNode['type'])}>
                {NODE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <button type="button" className="validate-btn" onClick={addNode}>Add node</button>
            <button type="button" className="validate-btn" disabled={graph.nodes.length < 2} onClick={addEdge}>Add relationship</button>
          </div>

          {selectedNode && (
            <div className="project-graph-editor__form">
              <h4>{selectedNode.node_id === graph.project_id ? 'Project node' : 'Edit node'}</h4>
              <label>
                Type
                <select
                  className="form-input"
                  value={selectedNode.type}
                  disabled={selectedNode.node_id === graph.project_id || Boolean(selectedNode.task_id) || isIndexedNode}
                  onChange={(event) => updateNode(selectedNode.node_id, { type: event.target.value as ProjectGraphNode['type'] })}
                >
                  {(['project', ...NODE_TYPES] as ProjectGraphNode['type'][]).map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input
                  className="form-input"
                  maxLength={200}
                  value={selectedNode.title}
                  disabled={selectedNode.node_id === graph.project_id || isIndexedNode}
                  onChange={(event) => updateNode(selectedNode.node_id, { title: event.target.value })}
                />
              </label>
              <label>
                Memory content
                <textarea
                  className="form-input"
                  rows={5}
                  maxLength={4000}
                  value={selectedNode.content}
                  disabled={selectedNode.node_id === graph.project_id || isIndexedNode}
                  onChange={(event) => updateNode(selectedNode.node_id, { content: event.target.value })}
                />
              </label>
              <label>
                Node color
                <input type="color" value={selectedNode.color} onChange={(event) => updateNode(selectedNode.node_id, { color: event.target.value })} />
              </label>
              <button
                type="button"
                className="validate-btn project-graph-editor__danger"
                disabled={selectedNode.node_id === graph.project_id || isIndexedNode}
                onClick={deleteNode}
              >
                Delete node
              </button>
            </div>
          )}

          {selectedEdge && (
            <div className="project-graph-editor__form">
              <h4>Edit relationship</h4>
              <label>
                From
                <select className="form-input" value={selectedEdge.source} onChange={(event) => updateEdge(selectedEdge.edge_id, { source: event.target.value })}>
                  {graph.nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.title}</option>)}
                </select>
              </label>
              <label>
                To
                <select className="form-input" value={selectedEdge.target} onChange={(event) => updateEdge(selectedEdge.edge_id, { target: event.target.value })}>
                  {graph.nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.title}</option>)}
                </select>
              </label>
              <label>
                Relationship label
                <input className="form-input" maxLength={100} value={selectedEdge.relation} onChange={(event) => updateEdge(selectedEdge.edge_id, { relation: event.target.value })} />
              </label>
              <label>
                Relationship color
                <input type="color" value={selectedEdge.color} onChange={(event) => updateEdge(selectedEdge.edge_id, { color: event.target.value })} />
              </label>
              <button
                type="button"
                className="validate-btn project-graph-editor__danger"
                disabled={selectedEdge.origin === 'auto'}
                onClick={deleteEdge}
              >
                Delete relationship
              </button>
            </div>
          )}
          </aside>
        </details>
      </div>
      <p className="text-xs text-muted">
        Select a node or link to edit it. Memory content is shown only in the editor; colors and relationship labels are saved per project.
      </p>
    </div>
  )
})

export default ProjectGraphEditor
