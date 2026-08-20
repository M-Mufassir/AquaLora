import { useState } from 'react'
import type { NodeRow } from '../../../shared/types'

interface AddNodeModalProps {
  onClose: () => void
  onCreated: (node: NodeRow) => void
}

function AddNodeModal({ onClose, onCreated }: AddNodeModalProps): React.JSX.Element {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!id.trim()) {
      setError('Node ID is required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const node = await window.api.upsertNode(id.trim(), name.trim(), location.trim())
      onCreated(node)
      onClose()
    } catch (err) {
      setError('Failed to add node.')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Add Node</h2>

        <label htmlFor="node-id">Node ID</label>
        <input
          id="node-id"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="e.g. slave-02"
          autoFocus
          required
        />
        <p className="modal-hint">
          Must exactly match the node_id the physical Slave Node sends over LoRa.
        </p>

        <label htmlFor="node-name">Name</label>
        <input
          id="node-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Pond 2"
        />

        <label htmlFor="node-location">Location</label>
        <input
          id="node-location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. North pond"
        />

        {error && <p className="login-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="apply-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="login-submit-btn" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Node'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default AddNodeModal
