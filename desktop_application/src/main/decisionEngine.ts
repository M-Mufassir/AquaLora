import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'
import { createInterface } from 'readline'

export interface DecisionResult {
  score: number
  status: 'Normal' | 'Warning' | 'Critical'
  parameter: string | null
  recommendation: string | null
}

interface ScoreInput {
  temperature: number
  turbidity: number
  tds: number
  ph?: number | null
  pond_type?: string | null
}

const SCRIPT_PATH = join(__dirname, '../../decision-engine/fish_health_index.py')
const CANDIDATE_INTERPRETERS = ['python3', 'python']

// Windows "App Execution Alias" stubs (e.g. a bare `python3` with no real
// interpreter installed) exit near-instantly with this code instead of a
// normal ENOENT, so a version-check must be exit-code based, not just
// presence based.
function findInterpreter(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'])
    if (result.status === 0) return candidate
  }
  return null
}

export class DecisionEngine {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending: Array<{
    resolve: (result: DecisionResult | null) => void
  }> = []

  start(): void {
    const interpreter = findInterpreter(CANDIDATE_INTERPRETERS)
    if (!interpreter) {
      console.warn('[decisionEngine] no Python interpreter found, scoring disabled')
      return
    }

    const proc = spawn(interpreter, [SCRIPT_PATH])
    this.proc = proc
    console.log(`[decisionEngine] started using "${interpreter}"`)

    proc.once('exit', (code) => {
      console.warn(`[decisionEngine] process exited (code ${code}), scoring disabled`)
      if (this.proc === proc) this.proc = null
    })

    const rl = createInterface({ input: proc.stdout })
    rl.on('line', (line) => {
      const next = this.pending.shift()
      if (!next) return
      try {
        const parsed = JSON.parse(line)
        next.resolve('error' in parsed ? null : (parsed as DecisionResult))
      } catch {
        next.resolve(null)
      }
    })

    proc.stderr.on('data', (chunk) => console.error('[decisionEngine:stderr]', chunk.toString()))
  }

  scoreReading(reading: ScoreInput): Promise<DecisionResult | null> {
    if (!this.proc) return Promise.resolve(null)
    const input: ScoreInput = {
      temperature: reading.temperature,
      turbidity: reading.turbidity,
      tds: reading.tds,
      ph: reading.ph ?? null,
      pond_type: reading.pond_type ?? null
    }
    return new Promise((resolve) => {
      this.pending.push({ resolve })
      this.proc!.stdin.write(JSON.stringify(input) + '\n')
    })
  }
}
