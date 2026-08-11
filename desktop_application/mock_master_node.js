// Fake Master Node for local dashboard development (see README.md Phase 2).
// Sends fabricated uplink readings over WebSocket on a short interval and
// logs any downlink commands (e.g. set_interval) received from the dashboard.
const { WebSocketServer } = require('ws')

const PORT = 8081
const NODE_ID = 'slave-01'
const SEND_INTERVAL_MS = 10000

const wss = new WebSocketServer({ port: PORT })
console.log(`[mock-master-node] listening on ws://localhost:${PORT}`)

function randomInRange(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10
}

function buildReading() {
  return {
    node_id: NODE_ID,
    timestamp: new Date().toISOString(),
    temperature: randomInRange(24, 31),
    turbidity: randomInRange(5, 60),
    tds: Math.round(randomInRange(150, 320)),
    battery_pct: Math.round(randomInRange(60, 100)),
    rssi: Math.round(randomInRange(-90, -50))
  }
}

wss.on('connection', (socket) => {
  console.log('[mock-master-node] dashboard connected')

  const interval = setInterval(() => {
    const reading = buildReading()
    socket.send(JSON.stringify(reading))
    console.log('[mock-master-node] sent reading:', reading)
  }, SEND_INTERVAL_MS)

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
    clearInterval(interval)
  })
})
