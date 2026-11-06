import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentProfile,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowCapabilityOption,
  WorkflowToolOption,
} from '../../../types/global'
import '../Toolbox.css'
import './WorkflowsSection.css'

const NODE_LABELS: Record<WorkflowNodeType, string> = {
  trigger: 'Trigger',
  tool: 'Tool',
  agent: 'Agent',
  capability: 'Capability',
  condition: 'Condition',
  parallel: 'Parallel',
  merge: 'Merge',
  output: 'Output',
}

const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

function createWorkflow(): WorkflowDefinition {
  const trigger: WorkflowNode = {
    id: 'trigger',
    type: 'trigger',
    title: 'Workflow input',
    x: 48,
    y: 120,
    config: {},
  }
  const output: WorkflowNode = {
    id: 'output',
    type: 'output',
    title: 'Result',
    x: 480,
    y: 120,
    config: { source: 'trigger' },
  }
  return {
    id: `workflow-${Date.now()}`,
    name: 'New workflow',
    description: '',
    nodes: [trigger, output],
    edges: [{ id: 'edge-trigger-output', source: trigger.id, target: output.id, label: '' }],
  }
}

export default function WorkflowsSection() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [tools, setTools] = useState<WorkflowToolOption[]>([])
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [capabilities, setCapabilities] = useState<WorkflowCapabilityOption[]>([])
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(createWorkflow)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [configText, setConfigText] = useState('{}')
  const [configError, setConfigError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const [taskProgress, setTaskProgress] = useState(0)
  const [taskProgressLabel, setTaskProgressLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [connectSource, setConnectSource] = useState('')
  const [connectTarget, setConnectTarget] = useState('')
  const [connectLabel, setConnectLabel] = useState('')
  const [nodeType, setNodeType] = useState<WorkflowNodeType>('tool')
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef(camera)
  const selectedNode = workflow.nodes.find((node) => node.id === selectedNodeId) ?? null
  const nodeById = useMemo(
    () => new Map(workflow.nodes.map((node) => [node.id, node])),
    [workflow.nodes],
  )

  const loadData = async () => {
    setError(null)
    try {
      const [saved, availableTools, availableAgents, availableCapabilities] = await Promise.all([
        window.helix.getWorkflows(),
        window.helix.getWorkflowTools(),
        window.helix.getWorkflowAgents(),
        window.helix.getWorkflowCapabilities(),
      ])
      setWorkflows(saved)
      setTools(availableTools)
      setAgents(availableAgents)
      setCapabilities(availableCapabilities)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workflows.')
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (selectedNode) {
      setConfigText(JSON.stringify(selectedNode.config, null, 2))
      setConfigError(null)
    }
  }, [selectedNodeId])

  useEffect(() => {
    if (!taskId) return
    let active = true
    const refresh = async () => {
      try {
        const tasks = await window.helix.getTasks()
        const task = tasks.find((item) => item.id === taskId)
        if (!active || !task) return
        setTaskStatus(task.status)
        setTaskProgress(task.progress)
        setTaskProgressLabel(task.execution_summary.progress_label)
        if (['completed', 'failed', 'cancelled'].includes(task.status)) {
          if (task.status === 'failed' && task.error) setError(task.error)
          setTaskId(null)
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not refresh workflow status.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1800)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [taskId])

  const updateNode = (nodeId: string, update: Partial<WorkflowNode>) => {
    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...update } : node),
    }))
  }

  const setWorkflowCamera = (next: typeof camera) => {
    cameraRef.current = next
    setCamera(next)
  }

  const beginCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    if ((event.target as HTMLElement).closest('.workflow-node')) return
    event.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const initialCamera = cameraRef.current
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      setWorkflowCamera({
        ...initialCamera,
        x: initialCamera.x + moveEvent.clientX - startX,
        y: initialCamera.y + moveEvent.clientY - startY,
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
    window.addEventListener('blur', stop, { once: true })
  }

  const zoomCanvas = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - bounds.left
    const localY = event.clientY - bounds.top
    const current = cameraRef.current
    const scale = Math.min(3, Math.max(0.12, current.scale * Math.exp(-event.deltaY * 0.001)))
    const worldX = (localX - current.x) / current.scale
    const worldY = (localY - current.y) / current.scale
    setWorkflowCamera({
      scale,
      x: localX - worldX * scale,
      y: localY - worldY * scale,
    })
  }

  const fitCanvas = () => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds || workflow.nodes.length === 0) return
    const minX = Math.min(...workflow.nodes.map((node) => node.x))
    const maxX = Math.max(...workflow.nodes.map((node) => node.x + 148))
    const minY = Math.min(...workflow.nodes.map((node) => node.y))
    const maxY = Math.max(...workflow.nodes.map((node) => node.y + 82))
    const scale = Math.min(
      1.6,
      (bounds.width - 80) / Math.max(1, maxX - minX + 80),
      (bounds.height - 80) / Math.max(1, maxY - minY + 80),
    )
    const safeScale = Math.max(0.12, scale)
    setWorkflowCamera({
      scale: safeScale,
      x: (bounds.width - (minX + maxX) * safeScale) / 2,
      y: (bounds.height - (minY + maxY) * safeScale) / 2,
    })
  }

  const onNodePointerDown = (event: React.PointerEvent, node: WorkflowNode) => {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedNodeId(node.id)
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const startNodeX = node.x
    const startNodeY = node.y
    const scale = cameraRef.current.scale
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      updateNode(node.id, {
        x: startNodeX + (moveEvent.clientX - startX) / scale,
        y: startNodeY + (moveEvent.clientY - startY) / scale,
      })
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
    window.addEventListener('blur', stop, { once: true })
  }

  const addNode = (
    type: WorkflowNodeType,
    item?: WorkflowToolOption | AgentProfile | WorkflowCapabilityOption,
  ) => {
    if (workflow.edges.some((edge) => nodeById.get(edge.source)?.type === 'condition')) {
      setError('Add nodes to a branching workflow by creating a new linear workflow or editing its connections first.')
      return
    }
    const id = makeId(type)
    const nonOutputNodes = workflow.nodes.filter((node) => node.type !== 'output')
    const lastNode = nonOutputNodes[nonOutputNodes.length - 1]
    const output = workflow.nodes.find((node) => node.type === 'output')
    const profile = type === 'agent' ? item as AgentProfile | undefined : undefined
    const tool = type === 'tool' ? item as WorkflowToolOption | undefined : undefined
    const capability = type === 'capability'
      ? item as WorkflowCapabilityOption | undefined
      : undefined
    const config: Record<string, unknown> = type === 'tool'
      ? { action: tool?.name ?? tools[0]?.name ?? '', params: {} }
      : type === 'agent'
        ? {
          role: profile?.role ?? 'main',
          task: '{{input}}',
          ...(profile ? { profile_id: profile.profile_id } : {}),
        }
        : type === 'capability'
          ? { capability: capability?.id ?? '' }
          : type === 'condition'
          ? { source: lastNode?.id ?? 'trigger', operator: 'truthy', path: [] }
          : type === 'output'
            ? { source: lastNode?.id ?? 'trigger' }
            : {}
    const newNode: WorkflowNode = {
      id,
      type,
      title: profile?.name ?? tool?.name ?? capability?.id ?? NODE_LABELS[type],
      x: (lastNode?.x ?? 48) + 210,
      y: (lastNode?.y ?? 120) + (type === 'condition' ? 0 : 20),
      config,
    }
    setWorkflow((current) => {
      const nextNodes = [...current.nodes, newNode]
      let nextEdges = [...current.edges]
      if (current.edges.some((edge) => current.nodes.find((node) => node.id === edge.source)?.type === 'condition')) {
        return { ...current, nodes: nextNodes }
      }
      if (type === 'condition') {
        const oldOutput = current.nodes.find((node) => node.type === 'output')
        nextEdges = nextEdges.filter((edge) => edge.target !== oldOutput?.id)
        if (lastNode) nextEdges.push({ id: makeId('edge'), source: lastNode.id, target: id, label: '' })
        if (oldOutput) {
          const outputIndex = nextNodes.findIndex((node) => node.id === oldOutput.id)
          if (outputIndex >= 0) {
            nextNodes[outputIndex] = { ...nextNodes[outputIndex], config: { source: id } }
          }
          nextEdges.push({ id: makeId('edge'), source: id, target: oldOutput.id, label: 'true' })
        }
        const falseOutput: WorkflowNode = {
          id: makeId('output'),
          type: 'output',
          title: 'False result',
          x: newNode.x + 210,
          y: newNode.y + 150,
          config: { value: 'Condition was false.' },
        }
        nextNodes.push(falseOutput)
        nextEdges.push({ id: makeId('edge'), source: id, target: falseOutput.id, label: 'false' })
      } else if (type === 'output') {
        if (lastNode) nextEdges.push({ id: makeId('edge'), source: lastNode.id, target: id, label: '' })
      } else if (lastNode && output) {
        nextEdges = nextEdges.filter((edge) => edge.target !== output.id)
        nextEdges.push(
          { id: makeId('edge'), source: lastNode.id, target: id, label: '' },
          { id: makeId('edge'), source: id, target: output.id, label: '' },
        )
        const updatedOutput = nextNodes.find((node) => node.id === output.id)
        if (updatedOutput) updatedOutput.config = { source: id }
      } else if (lastNode) {
        nextEdges.push({ id: makeId('edge'), source: lastNode.id, target: id, label: '' })
      }
      return { ...current, nodes: nextNodes, edges: nextEdges }
    })
    setSelectedNodeId(id)
  }

  const connectNodes = () => {
    if (!connectSource || !connectTarget || connectSource === connectTarget) return
    const source = nodeById.get(connectSource)
    const label = source?.type === 'condition'
      ? connectLabel || (workflow.edges.some((edge) => edge.source === connectSource && edge.label === 'true') ? 'false' : 'true')
      : ''
    setWorkflow((current) => ({
      ...current,
      edges: [...current.edges, {
        id: makeId('edge'),
        source: connectSource,
        target: connectTarget,
        label,
      }],
    }))
    setConnectSource('')
    setConnectTarget('')
    setConnectLabel('')
  }

  const removeConnection = (edgeId: string) => {
    setWorkflow((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId),
    }))
  }

  const removeNode = (nodeId = selectedNodeId) => {
    const node = workflow.nodes.find((item) => item.id === nodeId)
    if (
      !node
      || node.type === 'trigger'
      || (node.type === 'output' && workflow.nodes.filter((item) => item.type === 'output').length === 1)
    ) return
    setWorkflow((current) => ({
      ...current,
      nodes: current.nodes.filter((item) => item.id !== node.id),
      edges: current.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id),
    }))
    setSelectedNodeId(null)
  }

  const handleCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
    if (!selectedNode || selectedNode.type === 'trigger') return
    if (selectedNode.type === 'output' && workflow.nodes.filter((node) => node.type === 'output').length === 1) return
    event.preventDefault()
    removeNode(selectedNode.id)
  }

  const save = async () => {
    if (configError) {
      setError('Fix the selected node configuration before saving.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await window.helix.saveWorkflow(workflow)
      setWorkflow(saved)
      setWorkflows((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save workflow.')
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (configError) {
      setError('Fix the selected node configuration before running this workflow.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await window.helix.saveWorkflow(workflow)
      setWorkflow(saved)
      setWorkflows((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
      const result = await window.helix.runWorkflow(saved.id, input)
      setTaskProgress(0)
      setTaskProgressLabel('')
      setTaskId(result.task_id)
      setTaskStatus('queued')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run workflow.')
    } finally {
      setBusy(false)
    }
  }

  const deleteWorkflow = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await window.helix.deleteWorkflow(id)
      setWorkflows((current) => current.filter((item) => item.id !== id))
      if (workflow.id === id) {
        setWorkflow(createWorkflow())
        setSelectedNodeId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete workflow.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="toolbox-section">
      <h2 className="toolbox-section__title">Workflow builder</h2>
      <p className="toolbox-section__desc">
        Compose reusable flows from triggers, tools, agents, conditions and outputs. Drag nodes to arrange the canvas.
      </p>
      {error && <p className="toolbox-error" role="alert">{error}</p>}
      <div className="toolbox-card workflow-card">
        <div className="workflow-toolbar">
          <label className="workflow-field">
            <span>Name</span>
            <input value={workflow.name} onChange={(event) => setWorkflow({ ...workflow, name: event.target.value })} />
          </label>
          <label className="workflow-field">
            <span>ID</span>
            <input value={workflow.id} onChange={(event) => setWorkflow({ ...workflow, id: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') })} />
          </label>
          <button type="button" className="validate-btn" onClick={() => {
            setWorkflow(createWorkflow())
            setSelectedNodeId(null)
            setTaskStatus(null)
          }}>New</button>
        </div>
        <label className="workflow-field">
          <span>Description</span>
          <input value={workflow.description} onChange={(event) => setWorkflow({ ...workflow, description: event.target.value })} placeholder="What this workflow does" />
        </label>
        <div className="workflow-builder">
          <div className="workflow-canvas-tools">
            <select aria-label="Node type" value={nodeType} onChange={(event) => setNodeType(event.target.value as WorkflowNodeType)}>
              {(['condition', 'parallel', 'merge', 'output'] as WorkflowNodeType[]).map((type) => (
                <option key={type} value={type}>{NODE_LABELS[type]}</option>
              ))}
            </select>
            <button type="button" className="validate-btn" onClick={() => addNode(nodeType)}>Add node</button>
            <button type="button" className="validate-btn" onClick={fitCanvas}>Fit canvas</button>
          </div>
          <div className="workflow-palette" aria-label="Workflow node palette">
            <details className="workflow-palette-group" open>
              <summary>Agents ({agents.length})</summary>
              <div className="workflow-palette-items">
                {agents.map((agent) => (
                  <button type="button" key={agent.profile_id} title={agent.description} onClick={() => addNode('agent', agent)}>
                    <span style={{ color: agent.color }}>●</span> {agent.name}
                  </button>
                ))}
                {agents.length === 0 && <span className="workflow-palette-empty">No agent profiles available.</span>}
              </div>
            </details>
            <details className="workflow-palette-group">
              <summary>Tools ({tools.length})</summary>
              <div className="workflow-palette-items">
                {tools.map((tool) => (
                  <button type="button" key={tool.name} title={tool.description} onClick={() => addNode('tool', tool)}>
                    {tool.name}
                  </button>
                ))}
                {tools.length === 0 && <span className="workflow-palette-empty">No tools available.</span>}
              </div>
            </details>
            <details className="workflow-palette-group">
              <summary>Capabilities ({capabilities.length})</summary>
              <div className="workflow-palette-items">
                {capabilities.map((capability) => (
                  <button type="button" key={capability.id} title={capability.description} onClick={() => addNode('capability', capability)}>
                    {capability.id}
                  </button>
                ))}
                {capabilities.length === 0 && <span className="workflow-palette-empty">No tool capabilities available.</span>}
              </div>
            </details>
          </div>
          <div
            className="workflow-canvas-scroll"
            ref={canvasRef}
            tabIndex={0}
            aria-label="Workflow canvas. Drag to move around, wheel to zoom, and press Delete to remove the selected node."
            onPointerDown={beginCanvasPan}
            onWheel={zoomCanvas}
            onKeyDown={handleCanvasKeyDown}
          >
            <div className="workflow-canvas">
              <svg className="workflow-edges" aria-hidden="true">
                <defs>
                  <marker id="workflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
                  {workflow.edges.map((edge) => {
                    const source = nodeById.get(edge.source)
                    const target = nodeById.get(edge.target)
                    if (!source || !target) return null
                    const x1 = source.x + 148
                    const y1 = source.y + 42
                    const x2 = target.x
                    const y2 = target.y + 42
                    return (
                      <g key={edge.id}>
                        <path className="workflow-edge" d={`M ${x1} ${y1} C ${x1 + 42} ${y1}, ${x2 - 42} ${y2}, ${x2} ${y2}`} markerEnd="url(#workflow-arrow)" />
                        {edge.label && <text className="workflow-edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8}>{edge.label}</text>}
                      </g>
                    )
                  })}
                </g>
              </svg>
              {workflow.nodes.map((node) => (
                <button
                  type="button"
                  key={node.id}
                  className={`workflow-node workflow-node--${node.type}${selectedNodeId === node.id ? ' is-selected' : ''}`}
                  style={{
                    left: camera.x,
                    top: camera.y,
                    transform: `translate(${node.x * camera.scale}px, ${node.y * camera.scale}px) scale(${camera.scale})`,
                  }}
                  onPointerDown={(event) => onNodePointerDown(event, node)}
                  onClick={() => setSelectedNodeId(node.id)}
                  title={`${node.title} · Drag to move`}
                >
                  <small>{NODE_LABELS[node.type]}</small>
                  <strong>{node.title}</strong>
                </button>
              ))}
            </div>
          </div>
          <p className="workflow-canvas-hint">Drag the empty canvas to pan · Scroll to zoom · Drag nodes freely · Select a node and press Delete/Backspace to remove it</p>
          <div className="workflow-editor">
            {selectedNode ? (
              <>
                <div className="workflow-editor__heading">
                  <strong>{NODE_LABELS[selectedNode.type]} node</strong>
                  {selectedNode.type !== 'trigger' && (
                    <button type="button" className="validate-btn" onClick={() => removeNode()}>Remove</button>
                  )}
                </div>
                <label className="workflow-field">
                  <span>Node title</span>
                  <input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.id, { title: event.target.value })} />
                </label>
                {selectedNode.type === 'tool' && (
                  <label className="workflow-field">
                    <span>Available tool</span>
                    <select
                      value={String(selectedNode.config.action ?? '')}
                      onChange={(event) => updateNode(selectedNode.id, { config: { ...selectedNode.config, action: event.target.value } })}
                    >
                      <option value="">Select a tool</option>
                      {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="workflow-field">
                  <span>Configuration (JSON)</span>
                  <textarea
                    value={configText}
                    rows={6}
                    onChange={(event) => {
                      setConfigText(event.target.value)
                      try {
                        const config = JSON.parse(event.target.value) as Record<string, unknown>
                        updateNode(selectedNode.id, { config })
                        setConfigError(null)
                      } catch {
                        setConfigError('Configuration must be valid JSON.')
                      }
                    }}
                  />
                </label>
                {configError && <p className="toolbox-error" role="alert">{configError}</p>}
              </>
            ) : (
              <p className="text-xs text-muted">Select a node to edit its configuration.</p>
            )}
          </div>
          <div className="workflow-connect">
            <strong>Connect nodes</strong>
            <select aria-label="Connection source" value={connectSource} onChange={(event) => setConnectSource(event.target.value)}>
              <option value="">From node</option>
              {workflow.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
            </select>
            <select aria-label="Connection target" value={connectTarget} onChange={(event) => setConnectTarget(event.target.value)}>
              <option value="">To node</option>
              {workflow.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
            </select>
            {nodeById.get(connectSource)?.type === 'condition' && (
              <select aria-label="Condition branch" value={connectLabel} onChange={(event) => setConnectLabel(event.target.value)}>
                <option value="">Choose branch</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            )}
            <button type="button" className="validate-btn" disabled={!connectSource || !connectTarget || connectSource === connectTarget} onClick={connectNodes}>Connect</button>
            <div className="workflow-connection-list">
              {workflow.edges.map((edge) => (
                <span className="workflow-connection" key={edge.id}>
                  {nodeById.get(edge.source)?.title} {edge.label && `· ${edge.label}`} → {nodeById.get(edge.target)?.title}
                  <button type="button" aria-label="Remove connection" onClick={() => removeConnection(edge.id)}>×</button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="workflow-run">
          <label className="workflow-field">
            <span>Run input</span>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Optional input for the trigger" />
          </label>
          {taskStatus && <span className="workflow-status">Task {taskStatus} · {taskProgress}%{taskId ? ` · ${taskId}` : ''}</span>}
          {taskProgressLabel && taskId && <span className="workflow-status">{taskProgressLabel}</span>}
          <button type="button" className="validate-btn" disabled={busy || Boolean(taskId)} onClick={() => void run()}>{busy ? 'Working…' : 'Run workflow'}</button>
          <button type="button" className="validate-btn" disabled={busy} onClick={() => void save()}>{busy ? 'Working…' : 'Save workflow'}</button>
        </div>
      </div>
      <h3 className="toolbox-card__title toolbox-skill-list-title">Saved workflows</h3>
      {workflows.length === 0 ? <p className="text-xs text-muted">No workflows saved.</p> : workflows.map((item) => (
        <article className="toolbox-card workflow-saved" key={item.id}>
          <button type="button" className="workflow-saved__load" onClick={() => {
            setWorkflow(item)
            setSelectedNodeId(null)
            setTaskStatus(null)
          }}>
            <strong>{item.name}</strong>
            <span>{item.description || item.id}</span>
          </button>
          <button type="button" className="validate-btn toolbox-danger-button" disabled={busy} onClick={() => void deleteWorkflow(item.id)}>Delete</button>
        </article>
      ))}
    </section>
  )
}
