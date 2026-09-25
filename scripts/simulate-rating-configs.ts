import { parseArgs } from 'node:util'
import { loadCandidates, printTable } from './rating-config-cli.js'
import { simulate } from './rating-simulation.js'

/**
 * How much can `pnpm ratings:evaluate` actually tell apart at our sample size? Runs the
 * simulation in rating-simulation.ts for every σ × match-count combination and prints one table
 * per combination. No database. Usage and how to read the output: docs/RATING_CONFIGS.md.
 *
 *   pnpm ratings:simulate <candidates.json> [--baseline <name>] [--players 11]
 *     [--matches 100,300,600] [--sigma 100,150,200] [--leagues 400] [--seed 1]
 */

function positiveInts(flag: string, value: string): number[] {
  const numbers = value.split(',').map(Number)
  if (numbers.some((x) => !Number.isInteger(x) || x <= 0)) {
    console.error(`--${flag} takes positive whole numbers, comma-separated (got "${value}")`)
    process.exit(1)
  }
  return numbers
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    baseline: { type: 'string' },
    players: { type: 'string', default: '11' },
    matches: { type: 'string', default: '100,300,600' },
    sigma: { type: 'string', default: '100,150,200' },
    leagues: { type: 'string', default: '400' },
    seed: { type: 'string', default: '1' },
  },
})

const candidatesPath = positionals[0]
if (candidatesPath === undefined) {
  console.error('usage: pnpm ratings:simulate <candidates.json> [--baseline <name>] [...]')
  process.exit(1)
}
const candidates = await loadCandidates(candidatesPath)
const baselineName = values.baseline ?? candidates[0]?.name
if (
  baselineName === undefined ||
  candidates.length < 2 ||
  !candidates.some((c) => c.name === baselineName)
) {
  console.error('Need at least two candidates, one of them the --baseline (default: the first).')
  process.exit(1)
}
const [players = 11] = positiveInts('players', values.players)
const [leagues = 400] = positiveInts('leagues', values.leagues)
const [seed = 1] = positiveInts('seed', values.seed)
if (players < 2) {
  console.error('--players must be at least 2')
  process.exit(1)
}

console.log(
  `\nBaseline: ${baselineName}. Each block: ${String(leagues)} simulated leagues of ` +
    `${String(players)} players with known true skills.`,
)
console.log(
  'Plausible σ values are the ones whose 10–90% ranges contain BOTH your Brier (from ' +
    '`ratings:evaluate`) and your leaderboard spread, at your real match count.',
)

const pct = (count: number) => `${((100 * count) / leagues).toFixed(0)}%`
for (const sigma of positiveInts('sigma', values.sigma)) {
  for (const matches of positiveInts('matches', values.matches)) {
    const result = simulate({ players, matches, sigma, leagues, seed }, candidates, baselineName)
    const [spreadLow, spreadHigh] = result.spreadRange
    const [brierLow, brierHigh] = result.brierRange
    console.log(
      `\n=== ${String(matches)} matches · true-skill σ ${String(sigma)} ===  ` +
        `draws ${(100 * result.drawRate).toFixed(0)}% · established-only matches ` +
        `≈${result.established.toFixed(0)}\n${baselineName}, middle 80% of leagues: ` +
        `Brier ${brierLow.toFixed(3)}–${brierHigh.toFixed(3)} · ` +
        `final spread ${spreadLow.toFixed(0)}–${spreadHigh.toFixed(0)} pts`,
    )
    printTable([
      [
        'config',
        'Brier',
        'verdict: better / noise / worse',
        'wrong calls',
        'truly better',
        'rank ρ',
      ],
      ...result.candidates.map((row) =>
        row.name === baselineName
          ? [`${row.name} (baseline)`, row.brier.toFixed(4), '—', '—', '—', row.rankRho.toFixed(2)]
          : [
              row.name,
              row.brier.toFixed(4),
              `${pct(row.better)} / ${pct(row.noise)} / ${pct(row.worse)}`,
              pct(row.wrongCalls),
              pct(row.trulyBetter),
              row.rankRho.toFixed(2),
            ],
      ),
    ])
  }
}
