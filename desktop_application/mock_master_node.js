// Fake Master Node for local dashboard development (see README.md Phase 2).
// Simulates the Master Node relaying uplink readings from several Slave
// Nodes over the same WebSocket connection — exactly like the real Master
// Node would forward LoRa packets from multiple physical Slave Nodes, each
// tagged with its own node_id. Also logs any downlink commands (e.g.
// set_interval) received from the dashboard.
const { WebSocketServer } = require('ws')

const PORT = 8081
const SEND_INTERVAL_MS = 10000

// Value ranges per node — tuned (and statistically validated against
// decision-engine/fish_health_index.py) so each node demonstrates a
// different Fish Health Index tier over time.
const NODES = [
  {
    node_id: 'slave-01',
    temperature: [24, 31],
    turbidity: [5, 60],
    tds: [150, 320]
  }, // mixed — mostly Good, occasional Warning
  {
    node_id: 'slave-02',
    temperature: [27, 29],
    turbidity: [5, 18],
    tds: [180, 260]
  }, // healthy — consistently Good
  {
    node_id: 'slave-03',
    temperature: [23, 33],
    turbidity: [28, 50],
    tds: [200, 360]
  }, // borderline — ~24% Warning
  {
    node_id: 'slave-04',
    temperature: [19, 36],
    turbidity: [35, 65],
    tds: [60, 430]
  } // unhealthy — ~51% Warning, ~24% Critical
]

const wss = new WebSocketServer({ port: PORT })
console.log(`[mock-master-node] listening on ws://localhost:${PORT}`)
console.log(`[mock-master-node] simulating nodes: ${NODES.map((n) => n.node_id).join(', ')}`)

function randomInRange([min, max]) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10
}

function buildReading(profile) {
  return {
    node_id: profile.node_id,
    timestamp: new Date().toISOString(),
    temperature: randomInRange(profile.temperature),
    turbidity: randomInRange(profile.turbidity),
    tds: Math.round(randomInRange(profile.tds)),
    battery_pct: Math.round(randomInRange([60, 100])),
    rssi: Math.round(randomInRange([-90, -50]))
  }
}

wss.on('connection', (socket) => {
  console.log('[mock-master-node] dashboard connected')

  // Real Master Node firmware sends this the moment a client connects, so
  // the dashboard's Connect Device wizard can show "N nodes detected"
  // immediately instead of waiting for each node's first staggered Reading.
  socket.send(
    JSON.stringify({ type: 'node_list', nodes: NODES.map((n) => ({ node_id: n.node_id })) })
  )

  // Stagger each node's first send so they don't all land in the same
  // tick — closer to how independent Slave Nodes would actually behave.
  const timers = []
  for (const [i, profile] of NODES.entries()) {
    timers.push(
      setTimeout(() => {
        const tick = () => {
          const reading = buildReading(profile)
          socket.send(JSON.stringify(reading))
          console.log('[mock-master-node] sent reading:', reading)
        }
        tick()
        timers.push(setInterval(tick, SEND_INTERVAL_MS))
      }, i * 2000)
    )
  }

  socket.on('message', (data) => {
    try {
      const command = JSON.parse(data.toString())
      console.log('[mock-master-node] received downlink command:', command)
    } catch {
      console.log('[mock-master-node] received non-JSON message:', data.toString())
    }
  })

  socket.on('close', () => {
    console.log('[mock-master-node] dashboard disconnected')
    for (const t of timers) {
      clearTimeout(t)
      clearInterval(t)
    }
  })
})
