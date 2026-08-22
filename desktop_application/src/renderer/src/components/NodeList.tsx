import { Link } from 'react-router-dom'
import { deriveStatusTier } from '../../../shared/types'
import type { NodeRow } from '../../../shared/types'
import type { NodeState } from '../store/useReadingsStore'

interface NodeListProps {
  nodes: NodeRow[]
  nodesById: Record<string, NodeState>
  selectedNodeId: string | null
}

function NodeList({ nodes, nodesById, selectedNodeId }: NodeListProps): React.JSX.Element {
  return (
    <nav className="node-list">
      {nodes.map((node) => {
        const state = nodesById[node.id]
        const tier = deriveStatusTier(state?.latestScore ?? null, state?.status.online ?? false)
        return (
          <Link
            key={node.id}
            to={`/logs/${node.id}`}
            className={`node-list-item${node.id === selectedNodeId ? ' active' : ''}`}
          >
            <span className={`tier-dot tier-${tier.toLowerCase()}`} />
            <span className="node-list-name">{node.name || node.id}</span>
          </Link>
        )
      })}
      {nodes.length === 0 && <p className="status">No nodes yet</p>}
    </nav>
  )
}

export default NodeList
