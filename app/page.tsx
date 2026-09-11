'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { PROFILES, type VehicleProfile } from '@/lib/trajectory'
import { runSurvey, type Survey } from '@/lib/survey'

const Scene = dynamic(() => import('@/components/Scene'), { ssr: false })

const m = (v: number) => `${v.toFixed(0)} m`

export default function Page() {
  const [kind, setKind] = useState<'fixedwing' | 'multirotor'>('fixedwing')
  const [profile, setProfile] = useState<VehicleProfile>(PROFILES.fixedwing)
  const [threshold, setThreshold] = useState(30)
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [chase, setChase] = useState(false)
  const [head, setHead] = useState(0)
  const headRef = useRef(0)
  const textRef = useRef<string | null>(null)

  const pick = (k: 'fixedwing' | 'multirotor') => {
    setKind(k)
    setProfile(PROFILES[k])
  }

  async function run(text: string) {
    textRef.current = text
    setBusy(true)
    setError(null)
    try {
      const s = await runSurvey(text, profile, threshold)
      headRef.current = 0
      setHead(0)
      setSurvey(s)
    } catch (e) {
      setSurvey(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const cur = survey?.traj[head]

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100">
      <aside className="w-96 shrink-0 overflow-y-auto border-r border-neutral-800 p-5 space-y-5 text-sm">
        <div>
          <h1 className="text-lg font-semibold">dry run</h1>
          <p className="text-neutral-400 text-xs mt-1">
            Terrain-aware pre-flight survey. Sees hills — not masts, cranes, lines or trees.
          </p>
        </div>

        <label className="block">
          <span className="text-neutral-400 text-xs">Mission file (.waypoints / .plan)</span>
          <input
            type="file"
            accept=".waypoints,.txt,.plan,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) run(await f.text())
            }}
            className="mt-1 block w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-100"
          />
        </label>

        <div className="space-y-2">
          <div className="flex gap-2">
            {(['fixedwing', 'multirotor'] as const).map((k) => (
              <button
                key={k}
                onClick={() => pick(k)}
                className={`flex-1 rounded px-2 py-1.5 text-xs ${kind === k ? 'bg-sky-600' : 'bg-neutral-800'}`}
              >
                {k === 'fixedwing' ? 'Fixed-wing' : 'Multirotor'}
              </button>
            ))}
          </div>
          {(
            [
              ['cruiseMs', 'Cruise speed', 'm/s'],
              ['turnRadiusM', 'Turn radius', 'm'],
              ['maxClimbMs', 'Max climb', 'm/s'],
              ['maxDescentMs', 'Max descent', 'm/s'],
            ] as const
          ).map(([key, label, unit]) => (
            <label key={key} className="flex items-center justify-between gap-2">
              <span className="text-neutral-400 text-xs">
                {label} <span className="text-neutral-600">{unit}</span>
              </span>
              <input
                type="number"
                value={profile[key]}
                onChange={(e) => setProfile({ ...profile, [key]: Number(e.target.value) })}
                className="w-20 rounded bg-neutral-800 px-2 py-1 text-right text-xs"
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-2">
            <span className="text-neutral-400 text-xs">
              Min clearance <span className="text-neutral-600">m</span>
            </span>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-20 rounded bg-neutral-800 px-2 py-1 text-right text-xs"
            />
          </label>
          <button
            disabled={!textRef.current || busy}
            onClick={() => textRef.current && run(textRef.current)}
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-xs disabled:opacity-40"
          >
            {busy ? 'Sampling terrain…' : 'Re-run survey'}
          </button>
        </div>

        {error && <p className="rounded bg-red-950 p-2 text-xs text-red-300">{error}</p>}

        {survey && (
          <>
            <div
              className={`rounded p-3 ${survey.verdict === 'GO' ? 'bg-green-950' : 'bg-red-950'}`}
            >
              <div className="text-xl font-semibold">
                {survey.verdict}
                <span className="ml-2 text-xs font-normal opacity-70">
                  {survey.verdict === 'GO' ? 'no terrain conflict' : `${survey.issues.length} issue(s)`}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-xs opacity-90">
                {survey.issues.map((i, n) => (
                  <li key={n}>• {i}</li>
                ))}
              </ul>
            </div>

            {survey.grid.synthetic && (
              <p className="rounded bg-amber-950 p-2 text-xs text-amber-300">
                Synthetic terrain — no Mapbox token configured. Heights are fake.
              </p>
            )}

            <dl className="space-y-1 text-xs">
              {[
                ['Highest terrain', `${m(survey.highestTerrain)} AMSL (${m(survey.highestTerrain - survey.launchAmsl)} above launch)`],
                ['Lowest terrain', `${m(survey.lowestTerrain)} AMSL`],
                ['Launch elevation', `${m(survey.launchAmsl)} AMSL`],
                ['Min clearance', `${m(survey.minClearance)} on leg ${survey.minClearanceLeg + 1}`],
                ['Distance', `${(survey.distanceM / 1000).toFixed(2)} km`],
                ['Est. flight time', `${Math.floor(survey.durationS / 60)}m ${Math.round(survey.durationS % 60)}s`],
                ['Waypoints', `${survey.waypoints.length} (${survey.mission.source})`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-neutral-400">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>

            <div>
              <h2 className="mb-1 text-xs text-neutral-400">Waypoints</h2>
              <table className="w-full text-xs tabular-nums">
                <thead className="text-neutral-500">
                  <tr>
                    <th className="text-left font-normal">#</th>
                    <th className="text-right font-normal">AMSL</th>
                    <th className="text-right font-normal">launch</th>
                    <th className="text-right font-normal">frame</th>
                  </tr>
                </thead>
                <tbody>
                  {survey.waypoints.map((w, i) => (
                    <tr key={i} className="border-t border-neutral-900">
                      <td>{i + 1}</td>
                      <td className="text-right">{w.alt.toFixed(0)}</td>
                      <td className="text-right">{(w.alt - survey.launchAmsl).toFixed(0)}</td>
                      <td className="text-right text-neutral-500">{w.frame}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </aside>

      <main className="relative flex-1">
        {survey ? (
          <>
            <Scene
              survey={survey}
              threshold={threshold}
              playing={playing}
              speed={speed}
              chase={chase}
              headRef={headRef}
              onTick={setHead}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-neutral-900/90 p-3 text-xs backdrop-blur">
              <button
                onClick={() => setPlaying((p) => !p)}
                className="rounded bg-sky-600 px-3 py-1.5"
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <input
                type="range"
                min={0}
                max={survey.traj.length - 1}
                value={head}
                onChange={(e) => {
                  headRef.current = Number(e.target.value)
                  setHead(Number(e.target.value))
                }}
                className="flex-1"
              />
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="rounded bg-neutral-800 px-2 py-1"
              >
                {[1, 2, 4, 8, 16].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={chase} onChange={(e) => setChase(e.target.checked)} />
                Chase
              </label>
              {cur && (
                <span className="tabular-nums text-neutral-300">
                  t {cur.t.toFixed(0)}s · {m(cur.alt)} AMSL ·{' '}
                  <span className={cur.clearance! < threshold ? 'text-red-400' : 'text-green-400'}>
                    {m(cur.clearance!)} AGL
                  </span>
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-neutral-600">
            Load a mission file to begin
          </div>
        )}
      </main>
    </div>
  )
}
