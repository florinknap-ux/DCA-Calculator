import { useState, useMemo } from "react"

const CORRECTION_RULES = [
  { threshold: -0.10, pct: 10, color: "#eab308", label: "-10%" },
  { threshold: -0.20, pct: 15, color: "#f97316", label: "-20%" },
  { threshold: -0.30, pct: 20, color: "#ef4444", label: "-30%" },
  { threshold: -0.40, pct: 25, color: "#dc2626", label: "-40%" },
  { threshold: -0.50, pct: 30, color: "#991b1b", label: "-50%" },
]

const HISTORICAL = [
  { period: "Iul–Oct 2015",      depth: -12.4, months: 4, recovery: 3,  cause: "China, commodity crash" },
  { period: "Nov 2015–Feb 2016", depth: -13.3, months: 4, recovery: 5,  cause: "Oil collapse, Fed hike" },
  { period: "Ian–Feb 2018",      depth: -11.8, months: 2, recovery: 4,  cause: "Volatility spike" },
  { period: "Sep–Dec 2018",      depth: -19.8, months: 4, recovery: 5,  cause: "Trade war, Fed tight." },
  { period: "Feb–Mar 2020",      depth: -33.9, months: 2, recovery: 5,  cause: "COVID-19" },
  { period: "Ian–Oct 2022",      depth: -25.4, months: 9, recovery: 14, cause: "Inflație, rate hikes" },
  { period: "Iul–Oct 2023",      depth: -10.3, months: 3, recovery: 2,  cause: "Treasury yields" },
]

const SCENARIOS = {
  bear: { label: "🐻 Bear", sp: 0.06,  stoxx: 0.04, gold: 0.04 },
  base: { label: "📊 Base", sp: 0.10,  stoxx: 0.07, gold: 0.05 },
  bull: { label: "🚀 Bull", sp: 0.135, stoxx: 0.09, gold: 0.07 },
}

// --- RNG ---
function createRng(seed) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}
function normZ(rng) {
  const u1 = Math.max(1e-12, rng()), u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// --- Correction planner ---
// ~60% of years have a correction >=10% (S&P 500, 2013-2024)
function planCorrections(years, rng) {
  const events = []
  for (let y = 0; y < years; y++) {
    if (rng() > 0.60) continue
    const startMonth = y * 12 + 1 + Math.floor(rng() * 10)
    const roll = rng()
    let depth, fallM, recoverM
    if (roll < 0.13) {
      depth = 0.30 + rng() * 0.08; fallM = 2 + Math.floor(rng() * 6); recoverM = 5 + Math.floor(rng() * 9)
    } else if (roll < 0.40) {
      depth = 0.20 + rng() * 0.09; fallM = 2 + Math.floor(rng() * 4); recoverM = 4 + Math.floor(rng() * 7)
    } else {
      depth = 0.10 + rng() * 0.09; fallM = 1 + Math.floor(rng() * 3); recoverM = 2 + Math.floor(rng() * 4)
    }
    events.push({ startMonth, depth: -depth, fallM, recoverM })
  }
  return events.sort((a, b) => a.startMonth - b.startMonth)
}

// --- Simulation ---
// 3 strategies compared with same total capital (dca monthly + reserveSize):
//   portDCA  = DCA only (no reserve, just dca/month)
//   portLump = Lump sum: invest reserveSize in month 0 + dca/month (same capital, all-in)
//   portRes  = Reserve strategy: dca/month + reserveSize deployed at corrections
function runSim({ dca, reserveSize, years, seed, sp, stoxx, gold }) {
  const rng = createRng(seed)
  const N = years * 12
  const W = { sp: 0.55, stoxx: 0.35, gold: 0.10 }

  const corrections = planCorrections(years, rng)
  const baseMonthly = (W.sp * sp + W.stoxx * stoxx + W.gold * gold) / 12

  const monthReturns = new Array(N).fill(null).map(() => ({
    r: baseMonthly + 0.008 * normZ(rng), phase: "normal",
  }))
  corrections.forEach(c => {
    if (c.startMonth >= N) return
    const fallEnd    = Math.min(c.startMonth + c.fallM,    N)
    const recoverEnd = Math.min(fallEnd      + c.recoverM, N)
    const fallR      = Math.pow(1 + c.depth, 1 / c.fallM) - 1
    for (let m = c.startMonth; m < fallEnd; m++)
      monthReturns[m] = { r: fallR * (0.8 + 0.4 * rng()), phase: "falling" }
    const recoveryR = Math.pow(1 / (1 + c.depth), 1 / Math.max(c.recoverM, 1)) - 1
    for (let m = fallEnd; m < recoverEnd; m++)
      monthReturns[m] = { r: recoveryR * (0.8 + 0.4 * rng()) + baseMonthly * 0.3, phase: "recovering" }
  })

  let portDCA  = 0             // pure DCA, no reserve
  let portLump = reserveSize   // lump sum: reserve invested immediately from month 0
  let portRes  = 0             // reserve strategy: DCA + reserve deployed at corrections
  let reserve  = reserveSize

  let mkt = 1000, mktPeak = 1000, lvl = 0, cycleActive = false
  let totalDeployed = 0

  const deployEvents = [], refillEvents = [], hist = []

  for (let m = 0; m < N; m++) {
    const { r, phase } = monthReturns[m]

    mkt      *= (1 + r)
    portDCA   = portDCA  * (1 + r) + dca
    portLump  = portLump * (1 + r) + dca   // reserve invested from day 0, grows with market
    portRes   = portRes  * (1 + r) + dca

    // New ATH → refill reserve if a correction cycle was active
    if (mkt > mktPeak) {
      if (cycleActive && reserve < reserveSize) {
        const refillAmt = reserveSize - reserve
        reserve     = reserveSize
        lvl         = 0
        cycleActive = false
        refillEvents.push({ m, refillAmt })
      }
      mktPeak = mkt
    }

    // Deploy from reserve at correction thresholds (fixed % of original reserveSize)
    const dd = mkt / mktPeak - 1
    for (let i = lvl; i < CORRECTION_RULES.length; i++) {
      if (dd <= CORRECTION_RULES[i].threshold && reserve > 0.01) {
        const amt = Math.min(reserve, reserveSize * CORRECTION_RULES[i].pct / 100)
        portRes      += amt
        reserve      -= amt
        totalDeployed += amt
        lvl           = i + 1
        cycleActive   = true
        deployEvents.push({ m, lvl: i, dd, amt, reserveAfter: reserve })
        break
      }
    }

    hist.push({ m, dca: portDCA, lump: portLump, res: portRes + reserve, phase })
  }

  const totalRefilled = refillEvents.reduce((s, e) => s + e.refillAmt, 0)

  return {
    hist, corrections, deployEvents, refillEvents,
    dcaFinal:    portDCA,
    lumpFinal:   portLump,
    resFinal:    portRes + reserve,
    reserveLeft: reserve,
    totalDeployed,
    totalRefilled,
    refillCount: refillEvents.length,
  }
}

// --- Chart ---
function fmtEur(v) {
  if (v >= 1e6) return `€${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `€${(v / 1e3).toFixed(0)}k`
  return `€${v.toFixed(0)}`
}
function niceTicks(min, max, n = 4) {
  const range = max - min
  const mag   = Math.pow(10, Math.floor(Math.log10(range / n)))
  const step  = [1, 2, 5, 10].map(f => f * mag).find(f => range / f <= n + 1) || range / n
  const start = Math.floor(min / step) * step
  return Array.from({ length: Math.ceil((max - start) / step) + 2 }, (_, i) => start + i * step).filter(v => v >= min * 0.99 && v <= max * 1.01)
}

function Chart({ hist, deployEvents, refillEvents, years }) {
  if (!hist || hist.length < 2) return null
  const VW = 360, VH = 230
  const P = { t: 10, r: 10, b: 30, l: 52 }
  const PW = VW - P.l - P.r, PH = VH - P.t - P.b
  const N = hist.length

  // Zoomed y-axis: don't start from 0, start near the minimum value
  const allVals = hist.flatMap(d => [d.dca, d.lump, d.res])
  const yMin = Math.min(...allVals) * 0.92
  const yMax = Math.max(...allVals) * 1.05
  const yTicks = niceTicks(yMin, yMax)
  const xTicks = Array.from({ length: years + 1 }, (_, i) => i)

  const tx = m => P.l + (m / (N - 1)) * PW
  const ty = v => P.t + (1 - (v - yMin) / (yMax - yMin)) * PH
  const mkPath = fn => hist.map((d, i) => `${i ? "L" : "M"}${tx(i).toFixed(1)},${ty(fn(d)).toFixed(1)}`).join("")

  // Correction phase shading
  const corrRects = []
  let rStart = null
  hist.forEach((d, i) => {
    if (d.phase === "falling" && rStart === null) rStart = i
    if (d.phase !== "falling" && rStart !== null) { corrRects.push({ x1: tx(rStart), x2: tx(i) }); rStart = null }
  })
  if (rStart !== null) corrRects.push({ x1: tx(rStart), x2: tx(hist.length - 1) })

  // Area between reserve and lump (green when reserve wins, red when lump wins)
  const areaPath = [
    ...hist.map((d, i) => `${i ? "L" : "M"}${tx(i).toFixed(1)},${ty(d.res).toFixed(1)}`),
    ...hist.slice().reverse().map((d, i) => `L${tx(N-1-i).toFixed(1)},${ty(d.lump).toFixed(1)}`),
    "Z"
  ].join("")

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-auto">
      {/* Grid */}
      {yTicks.map(v => (
        <line key={v} x1={P.l} x2={P.l+PW} y1={ty(v)} y2={ty(v)} stroke="#1e2030" strokeWidth={1} />
      ))}
      {xTicks.map(y => (
        <line key={y} x1={tx(y*12)} x2={tx(y*12)} y1={P.t} y2={P.t+PH} stroke="#1e2030" strokeWidth={1} />
      ))}

      {/* Correction shading */}
      {corrRects.map((r, i) => (
        <rect key={i} x={r.x1} width={Math.max(1, r.x2-r.x1)} y={P.t} height={PH} fill="#ef4444" fillOpacity={0.07} />
      ))}

      {/* Area between reserve and lump sum — shows advantage/disadvantage */}
      <path d={areaPath} fill="#6366f1" fillOpacity={0.12} />

      {/* Deploy markers */}
      {deployEvents.map((e, i) => (
        <line key={i} x1={tx(e.m).toFixed(1)} x2={tx(e.m).toFixed(1)} y1={P.t} y2={P.t+PH}
          stroke={CORRECTION_RULES[e.lvl]?.color || "#ef4444"} strokeWidth={1.5} strokeDasharray="3,3" opacity={0.8} />
      ))}

      {/* Refill markers */}
      {refillEvents.map((e, i) => (
        <polygon key={i}
          points={`${tx(e.m)},${P.t+2} ${tx(e.m)-4},${P.t+10} ${tx(e.m)+4},${P.t+10}`}
          fill="#22c55e" opacity={0.7} />
      ))}

      {/* DCA pur (grey) */}
      <path d={mkPath(d => d.dca)} fill="none" stroke="#475569" strokeWidth={1.5} strokeDasharray="4,2" />

      {/* Lump sum (orange) */}
      <path d={mkPath(d => d.lump)} fill="none" stroke="#f97316" strokeWidth={2} />

      {/* Rezervă (indigo) */}
      <path d={mkPath(d => d.res)} fill="none" stroke="#6366f1" strokeWidth={2.5} />

      {/* Y labels */}
      {yTicks.map(v => (
        <text key={v} x={P.l-4} y={ty(v)+4} textAnchor="end" fontSize={9} fill="#475569" fontFamily="monospace">
          {fmtEur(v)}
        </text>
      ))}
      {/* X labels */}
      {xTicks.map(y => (
        <text key={y} x={tx(y*12)} y={VH-6} textAnchor="middle" fontSize={9} fill="#475569" fontFamily="monospace">
          {y === 0 ? "0" : `${y}a`}
        </text>
      ))}
    </svg>
  )
}

// --- Input ---
function Input({ label, value, set, min, max, step, prefix, suffix }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-sm text-slate-400">{label}</span>
        <div className="flex items-center gap-1.5">
          {prefix && <span className="text-slate-500 text-sm font-mono">{prefix}</span>}
          <input
            type="number"
            inputMode="numeric"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={e => {
              const v = Math.max(min, Math.min(max, parseInt(e.target.value) || min))
              set(v)
            }}
            style={{ fontSize: 16 }}
            className="w-24 bg-[#12141c] border border-[#2a2c3a] rounded-lg px-2 py-1 text-right text-indigo-300 font-mono font-semibold focus:outline-none focus:border-indigo-500/60"
          />
          {suffix && <span className="text-slate-500 text-sm font-mono">{suffix}</span>}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => set(+e.target.value)} />
    </div>
  )
}

// --- Main ---
export default function DCACalculator() {
  const [dca,         setDca]         = useState(250)
  const [reserveSize, setReserveSize] = useState(5000)
  const [years,       setYears]       = useState(10)
  const [scen,        setScen]        = useState("base")
  const [seed,        setSeed]        = useState(42)
  const [tab,         setTab]         = useState("calc")

  const cfg = SCENARIOS[scen]
  const sim = useMemo(() => runSim({
    dca, reserveSize, years, seed,
    sp: cfg.sp, stoxx: cfg.stoxx, gold: cfg.gold,
  }), [dca, reserveSize, years, seed, scen]) // eslint-disable-line react-hooks/exhaustive-deps

  const capital     = dca * years * 12 + reserveSize   // total capital identic în toate strategiile
  const resWinsLump = sim.resFinal > sim.lumpFinal
  const vsLump      = sim.resFinal - sim.lumpFinal
  const vsDCA       = sim.resFinal - sim.dcaFinal

  return (
    <div className="min-h-screen bg-[#12141c] text-slate-200 flex flex-col safe-top">

      {/* Header */}
      <div className="bg-[#12141c]/95 backdrop-blur border-b border-[#2a2c3a] px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-slate-100 leading-tight">📈 DCA vs Rezervă Fixă</h1>
            <p className="text-xs text-slate-500 mt-0.5">55% S&P · 35% STOXX · 10% Gold</p>
          </div>
          <button onClick={() => setSeed(Math.floor(Math.random() * 999999))}
            className="px-3 py-1.5 rounded-lg border border-[#2a2c3a] text-xs text-slate-500 active:bg-[#2a2c3a]">
            🔀 Resim.
          </button>
        </div>
        <div className="flex gap-1 mt-3 bg-[#1a1c26] rounded-lg p-1">
          {[
            { key: "calc",  label: "Calculator" },
            { key: "strat", label: "Strategie" },
            { key: "hist",  label: "Istoric" },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-1.5 rounded text-xs font-mono transition-colors ${
                tab === t.key ? "bg-indigo-500/20 text-indigo-300" : "text-slate-500"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* === TAB: Calculator === */}
        {tab === "calc" && (
          <div className="px-4 py-4 space-y-4 safe-bottom">

            {/* Inputs */}
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4 space-y-5">
              <Input label="DCA lunar (ambele strategii)" value={dca} set={setDca} min={50} max={10000} step={50} prefix="€" />
              <Input label="Rezervă fixă" value={reserveSize} set={setReserveSize} min={500} max={100000} step={500} prefix="€" />
              <Input label="Orizont" value={years} set={setYears} min={1} max={40} step={1} suffix="ani" />
              <div className="text-xs text-slate-600 pt-1 border-t border-[#2a2c3a] space-y-0.5">
                <div>DCA total: <span className="text-slate-400 font-mono">€{(dca * years * 12).toLocaleString()}</span></div>
                <div>Rezervă inițială: <span className="text-slate-400 font-mono">€{reserveSize.toLocaleString()}</span>
                  <span className="text-slate-700"> · se reface la ATH după fiecare corecție</span>
                </div>
              </div>
            </div>

            {/* Scenarios */}
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SCENARIOS).map(([k, s]) => (
                <button key={k} onClick={() => setScen(k)}
                  className={`py-2.5 rounded-xl text-sm font-mono transition-colors ${
                    scen === k
                      ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-300"
                      : "bg-[#1a1c26] border border-[#2a2c3a] text-slate-500"
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Chart */}
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-3">
              <div className="flex gap-x-3 gap-y-1 text-xs mb-2 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-indigo-500 inline-block rounded" />
                  <span className="text-slate-500">Rezervă {fmtEur(reserveSize)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-orange-500 inline-block rounded" />
                  <span className="text-slate-500">Lump sum (tot din ziua 1)</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-slate-500 inline-block rounded" style={{borderTop:"1px dashed #475569",height:0}} />
                  <span className="text-slate-600">DCA pur</span>
                </span>
              </div>
              <Chart hist={sim.hist} deployEvents={sim.deployEvents} refillEvents={sim.refillEvents} years={years} />
              <p className="text-xs text-slate-700 mt-1">Zona violet = avantaj rezervă vs lump sum</p>
            </div>

            {/* Reserve activity */}
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4">
              <div className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">
                Activitate rezervă
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <div className="text-xs text-slate-600">Deploiat total</div>
                  <div className="text-base font-mono font-bold text-orange-400">{fmtEur(sim.totalDeployed)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-600">Cicluri</div>
                  <div className="text-base font-mono font-bold text-slate-300">{sim.refillCount}</div>
                  <div className="text-xs text-slate-700">reîncărcări</div>
                </div>
                <div>
                  <div className="text-xs text-slate-600">Rezervă rămasă</div>
                  <div className="text-base font-mono font-bold text-slate-300">{fmtEur(sim.reserveLeft)}</div>
                </div>
              </div>
              {sim.deployEvents.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {sim.deployEvents.map((e, i) => (
                    <span key={i} className="px-2 py-1 rounded text-xs font-mono"
                      style={{
                        background: (CORRECTION_RULES[e.lvl]?.color || "#ef4444") + "18",
                        border: `1px solid ${(CORRECTION_RULES[e.lvl]?.color || "#ef4444")}40`,
                        color: CORRECTION_RULES[e.lvl]?.color || "#ef4444",
                      }}>
                      An {(e.m/12+1).toFixed(1)} · {(e.dd*100).toFixed(1)}% · {fmtEur(e.amt)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-700">Nicio corecție în această simulare. Încearcă 🔀.</p>
              )}
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#1a1c26] border border-indigo-500/25 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">🟣 Rezervă {fmtEur(reserveSize)}</div>
                <div className="text-lg font-mono font-bold text-indigo-400">{fmtEur(sim.resFinal)}</div>
                <div className="text-xs text-slate-600 mt-1">{sim.deployEvents.length} deploy-uri · {sim.refillCount} refill-uri</div>
                <div className="text-xs font-mono mt-1 text-slate-600">deploiat: {fmtEur(sim.totalDeployed)}</div>
              </div>

              <div className="bg-[#1a1c26] border border-orange-500/20 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">🟠 Lump sum (tot din zi 1)</div>
                <div className="text-lg font-mono font-bold text-orange-400">{fmtEur(sim.lumpFinal)}</div>
                <div className="text-xs text-slate-600 mt-1">{fmtEur(reserveSize)} investit imediat</div>
                <div className="text-xs font-mono mt-1 text-slate-600">+ €{dca}/lună DCA</div>
              </div>

              <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">⬛ DCA pur €{dca}/lună</div>
                <div className="text-lg font-mono font-bold text-slate-400">{fmtEur(sim.dcaFinal)}</div>
                <div className="text-xs text-slate-600 mt-1">fără rezervă</div>
                <div className="text-xs font-mono mt-1 text-slate-600">+{fmtEur(vsDCA)} față de rezervă</div>
              </div>

              <div className={`bg-[#1a1c26] border rounded-xl p-3 ${resWinsLump ? "border-indigo-500/30" : "border-orange-500/30"}`}>
                <div className="text-xs text-slate-500 mb-1">Rezervă vs Lump sum</div>
                <div className={`text-lg font-mono font-bold ${resWinsLump ? "text-indigo-400" : "text-orange-400"}`}>
                  {vsLump >= 0 ? "+" : ""}{fmtEur(vsLump)}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {resWinsLump ? "✅ Corecțiile au plătit" : "❌ Mai bine all-in din ziua 1"}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-700 text-center pb-4">
              ⚠️ Not financial advice · corecții simulate la frecvența istorică reală S&P 500
            </p>
          </div>
        )}

        {/* === TAB: Strategie === */}
        {tab === "strat" && (
          <div className="px-4 py-4 space-y-4 safe-bottom">
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4 space-y-3 text-sm text-slate-400">
              <h2 className="text-sm font-semibold text-slate-200">Cum funcționează rezerva fixă</h2>
              <p>Menții permanent <span className="text-indigo-300 font-mono">€{reserveSize.toLocaleString()}</span> în cash (cont de economii, fond monetar, etc.).</p>
              <p>Investești lunar <span className="text-indigo-300 font-mono">€{dca}</span> prin DCA, indiferent de piață.</p>
              <p>La corecții, deploiezi din rezervă conform tabelului — cumperi la discount.</p>
              <p>Când piața revine la ATH (all-time high anterior), <span className="text-green-400">reîncarci rezerva la €{reserveSize.toLocaleString()}</span> și ciclul reîncepe.</p>
              <p className="text-slate-600 text-xs">
                Rezerva nu crește cu dobândă în simulare (cash 0%). În realitate poți ține în fond monetar ~4-5% și câștigi extra cât timp aștepți.
              </p>
            </div>

            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a2c3a]">
                <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">Deploy din rezervă</span>
              </div>
              {CORRECTION_RULES.map((r, i) => {
                const triggered = sim.deployEvents.filter(e => e.lvl === i).length
                return (
                  <div key={r.threshold} className="flex items-center px-4 py-3.5 border-b border-[#1e2030] last:border-0">
                    <div className="w-14 font-mono text-base font-bold" style={{ color: r.color }}>{r.label}</div>
                    <div className="flex-1">
                      <div className="text-sm text-slate-300">Deploy <span className="font-mono">{r.pct}%</span> din rezervă</div>
                      <div className="text-xs text-slate-600">≈ {fmtEur(reserveSize * r.pct / 100)} la rezervă plină</div>
                    </div>
                    {triggered > 0 && (
                      <div className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: r.color + "20", color: r.color }}>×{triggered}</div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4">
              <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">Alocare portofoliu DCA</h3>
              {[
                { label: "S&P 500", pct: 55, color: "#6366f1", ret: cfg.sp },
                { label: "STOXX Europe 600", pct: 35, color: "#3b82f6", ret: cfg.stoxx },
                { label: "Gold (XAU)", pct: 10, color: "#eab308", ret: cfg.gold },
              ].map(a => (
                <div key={a.label} className="mb-3 last:mb-0">
                  <div className="flex justify-between text-sm mb-1">
                    <span style={{ color: a.color }}>{a.label}</span>
                    <span className="text-slate-400 font-mono">{a.pct}% · {(a.ret*100).toFixed(0)}%/an</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#2a2c3a]">
                    <div className="h-2 rounded-full" style={{ width: `${a.pct}%`, background: a.color }} />
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-700 text-center pb-4">⚠️ Not financial advice</p>
          </div>
        )}

        {/* === TAB: Istoric === */}
        {tab === "hist" && (
          <div className="px-4 py-4 space-y-3 safe-bottom">
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Corecții S&P 500 · 2013–2024</h2>
              <p className="text-xs text-slate-600">Date reale · Bloomberg, Macrotrends, Yahoo Finance</p>
            </div>
            {HISTORICAL.map((row, i) => {
              const triggered = CORRECTION_RULES.filter(r => row.depth / 100 <= r.threshold)
              const color = row.depth < -25 ? "#ef4444" : row.depth < -15 ? "#f97316" : "#eab308"
              return (
                <div key={i} className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-mono text-slate-300">{row.period}</div>
                      <div className="text-xs text-slate-600 mt-0.5">{row.cause}</div>
                    </div>
                    <div className="text-xl font-mono font-bold ml-3" style={{ color }}>{row.depth}%</div>
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500">
                    <span>⏱ {row.months} luni cădere</span>
                    <span>📈 {row.recovery} luni recovery</span>
                  </div>
                  {triggered.length > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {triggered.map(r => (
                        <span key={r.threshold} className="px-2 py-0.5 rounded text-xs font-mono"
                          style={{ background: r.color+"20", color: r.color, border: `1px solid ${r.color}40` }}>
                          {r.label} → deploy {fmtEur(reserveSize * r.pct / 100)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Corecții ≥ −10%", value: "7", sub: "în 11 ani · ~0.64/an" },
                { label: "Ani cu corecție", value: "~60%", sub: "frecvența istorică" },
                { label: "Corecții ≥ −20%", value: "2", sub: "2020 COVID, 2022" },
                { label: "Recovery mediu", value: "5.4 luni", sub: "trough → ATH nou" },
              ].map((s, i) => (
                <div key={i} className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-3">
                  <div className="text-xs text-slate-600">{s.label}</div>
                  <div className="text-base font-mono text-slate-300 mt-0.5">{s.value}</div>
                  <div className="text-xs text-slate-700">{s.sub}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-700 text-center pb-4">Performanțele trecute nu garantează rezultate viitoare</p>
          </div>
        )}
      </div>
    </div>
  )
}
