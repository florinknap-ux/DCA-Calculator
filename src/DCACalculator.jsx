import { useState, useMemo } from "react"

// --- Constants ---

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

// --- Simulation ---

function createRng(seed) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

function normZ(rng) {
  const u1 = Math.max(1e-12, rng()), u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function runSim({ dca, savings, years, seed, sp, stoxx, gold }) {
  const rng = createRng(seed)
  const N = years * 12
  const SP    = { mu: sp    / 12, sg: 0.040 }
  const STOXX = { mu: stoxx / 12, sg: 0.042 }
  const GOLD  = { mu: gold  / 12, sg: 0.028 }
  const Lsp    = [1,     0,     0    ]
  const Lstoxx = [0.85,  0.527, 0    ]
  const Lgold  = [-0.20, 0.133, 0.971]
  const W = { sp: 0.55, stoxx: 0.35, gold: 0.10 }

  let portS = 0, savBuf = 0, portA = 0
  let mkt = 1000, mktPeak = 1000, lvl = 0
  const events = [], hist = []

  for (let m = 0; m < N; m++) {
    const z1 = normZ(rng), z2 = normZ(rng), z3 = normZ(rng)
    const rSP    = SP.mu    + SP.sg    * Lsp[0]   * z1
    const rSTOXX = STOXX.mu + STOXX.sg * (Lstoxx[0]*z1 + Lstoxx[1]*z2)
    const rGOLD  = GOLD.mu  + GOLD.sg  * (Lgold[0]*z1  + Lgold[1]*z2  + Lgold[2]*z3)
    const rPort  = W.sp * rSP + W.stoxx * rSTOXX + W.gold * rGOLD

    mkt *= (1 + rPort)
    portS  = portS * (1 + rPort) + dca
    portA  = portA * (1 + rPort) + dca + savings
    savBuf += savings

    if (mkt > mktPeak) { mktPeak = mkt; lvl = 0 }

    const dd = mkt / mktPeak - 1
    for (let i = lvl; i < CORRECTION_RULES.length; i++) {
      if (dd <= CORRECTION_RULES[i].threshold && savBuf > 0.01) {
        const amt = savBuf * CORRECTION_RULES[i].pct / 100
        portS += amt; savBuf -= amt; lvl = i + 1
        events.push({ m, lvl: i, dd, amt })
        break
      }
    }
    hist.push({ m, s: portS + savBuf, a: portA })
  }

  return { hist, events, stratTotal: portS + savBuf, stratPort: portS, savLeft: savBuf, allIn: portA }
}

// --- Chart ---

function fmtEur(v) {
  if (v >= 1e6) return `€${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `€${(v / 1e3).toFixed(0)}k`
  return `€${v.toFixed(0)}`
}

function niceTicks(max, n = 4) {
  const mag = Math.pow(10, Math.floor(Math.log10(max / n)))
  const step = [1, 2, 5, 10].map(f => f * mag).find(f => max / f <= n + 1) || max / n
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

function Chart({ hist, events, years }) {
  if (!hist || hist.length < 2) return null
  const VW = 360, VH = 220
  const P = { t: 10, r: 10, b: 30, l: 52 }
  const PW = VW - P.l - P.r, PH = VH - P.t - P.b
  const N = hist.length
  const yMax = Math.max(...hist.map(d => Math.max(d.s, d.a))) * 1.06
  const yTicks = niceTicks(yMax)
  const xTicks = Array.from({ length: years + 1 }, (_, i) => i)
  const tx = m => P.l + (m / (N - 1)) * PW
  const ty = v => P.t + (1 - v / yMax) * PH
  const mkPath = fn => hist.map((d, i) => `${i ? "L" : "M"}${tx(i).toFixed(1)},${ty(fn(d)).toFixed(1)}`).join("")

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-auto">
      {yTicks.map(v => (
        <line key={v} x1={P.l} x2={P.l + PW} y1={ty(v)} y2={ty(v)} stroke="#1e2030" strokeWidth={1} />
      ))}
      {xTicks.map(y => (
        <line key={y} x1={tx(y * 12)} x2={tx(y * 12)} y1={P.t} y2={P.t + PH} stroke="#1e2030" strokeWidth={1} />
      ))}
      <path
        d={`${mkPath(d => d.s)} L${tx(N-1).toFixed(1)},${(P.t+PH).toFixed(1)} L${tx(0).toFixed(1)},${(P.t+PH).toFixed(1)}Z`}
        fill="#6366f1" fillOpacity={0.08}
      />
      {events.map((e, i) => (
        <line key={i} x1={tx(e.m).toFixed(1)} x2={tx(e.m).toFixed(1)} y1={P.t} y2={P.t + PH}
          stroke={CORRECTION_RULES[e.lvl]?.color || "#ef4444"} strokeWidth={1.5} strokeDasharray="3,3" opacity={0.7} />
      ))}
      <path d={mkPath(d => d.a)} fill="none" stroke="#22c55e" strokeWidth={2} />
      <path d={mkPath(d => d.s)} fill="none" stroke="#6366f1" strokeWidth={2.5} />
      {yTicks.map(v => (
        <text key={v} x={P.l - 4} y={ty(v) + 4} textAnchor="end" fontSize={9} fill="#475569"
          fontFamily="monospace">{fmtEur(v)}</text>
      ))}
      {xTicks.map(y => (
        <text key={y} x={tx(y * 12)} y={VH - 6} textAnchor="middle" fontSize={9} fill="#475569"
          fontFamily="monospace">{y === 0 ? "0" : `${y}a`}</text>
      ))}
    </svg>
  )
}

// --- Main Component ---

export default function DCACalculator() {
  const [dca,      setDca]      = useState(250)
  const [sav,      setSav]      = useState(300)
  const [years,    setYears]    = useState(10)
  const [scen,     setScen]     = useState("base")
  const [seed,     setSeed]     = useState(42)
  const [tab,      setTab]      = useState("calc")   // "calc" | "strat" | "hist"

  const cfg = SCENARIOS[scen]
  const sim = useMemo(() => runSim({
    dca, savings: sav, years, seed,
    sp: cfg.sp, stoxx: cfg.stoxx, gold: cfg.gold,
  }), [dca, sav, years, seed, scen]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalOut   = (dca + sav) * years * 12
  const stratGain  = sim.stratTotal - totalOut
  const allInGain  = sim.allIn - totalOut
  const stratPct   = ((stratGain / totalOut) * 100).toFixed(1)
  const allInPct   = ((allInGain  / totalOut) * 100).toFixed(1)
  const stratWins  = sim.stratTotal > sim.allIn
  const deployed   = sim.events.reduce((s, e) => s + e.amt, 0)

  const Slider = ({ label, value, set, min, max, step, fmt }) => (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="text-indigo-300 font-mono font-semibold">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => set(+e.target.value)} />
    </div>
  )

  return (
    <div className="min-h-screen bg-[#12141c] text-slate-200 flex flex-col safe-top">

      {/* Header */}
      <div className="bg-[#12141c]/95 backdrop-blur border-b border-[#2a2c3a] px-4 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-slate-100 leading-tight">📈 DCA + Corecții</h1>
            <p className="text-xs text-slate-500 mt-0.5">55% S&P · 35% STOXX · 10% Gold</p>
          </div>
          <button
            onClick={() => setSeed(Math.floor(Math.random() * 999999))}
            className="px-3 py-1.5 rounded-lg border border-[#2a2c3a] text-xs text-slate-500 active:bg-[#2a2c3a] transition-colors">
            🔀 Resim.
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3 bg-[#1a1c26] rounded-lg p-1">
          {[
            { key: "calc",  label: "Calculator" },
            { key: "strat", label: "Strategie" },
            { key: "hist",  label: "Istoric" },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-1.5 rounded text-xs font-mono transition-colors ${
                tab === t.key
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-slate-500 active:text-slate-300"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* === TAB: Calculator === */}
        {tab === "calc" && (
          <div className="px-4 py-4 space-y-4 safe-bottom">

            {/* Sliders */}
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4 space-y-5">
              <Slider label="DCA lunar" value={dca} set={setDca} min={50} max={2000} step={50} fmt={v => `€${v}`} />
              <Slider label="Economii/lună (rezervă)" value={sav} set={setSav} min={50} max={2000} step={50} fmt={v => `€${v}`} />
              <Slider label="Orizont" value={years} set={setYears} min={3} max={30} step={1} fmt={v => `${v} ani`} />
              <div className="text-xs text-slate-600 pt-1 border-t border-[#2a2c3a]">
                Buget lunar: <span className="text-slate-400 font-mono">€{dca + sav}</span>
                &nbsp;·&nbsp;Total {years} ani:&nbsp;
                <span className="text-slate-400 font-mono">€{((dca + sav) * years * 12).toLocaleString()}</span>
              </div>
            </div>

            {/* Scenarios */}
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SCENARIOS).map(([k, s]) => (
                <button key={k} onClick={() => setScen(k)}
                  className={`py-2.5 rounded-xl text-sm font-mono transition-colors ${
                    scen === k
                      ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-300"
                      : "bg-[#1a1c26] border border-[#2a2c3a] text-slate-500 active:text-slate-300"
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Chart */}
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-600 font-mono uppercase tracking-wider">Evoluție · {years} ani</span>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-indigo-500 inline-block rounded" />
                    <span className="text-slate-600">Strategie</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-green-500 inline-block rounded" />
                    <span className="text-slate-600">All-In</span>
                  </span>
                </div>
              </div>
              <Chart hist={sim.hist} events={sim.events} years={years} />
            </div>

            {/* Correction events */}
            {sim.events.length > 0 && (
              <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-3">
                <div className="text-xs text-slate-600 mb-2">
                  {sim.events.length} corecții · {fmtEur(deployed)} total deploiat
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sim.events.map((e, i) => (
                    <span key={i} className="px-2 py-1 rounded text-xs font-mono"
                      style={{
                        background: (CORRECTION_RULES[e.lvl]?.color || "#ef4444") + "18",
                        border: `1px solid ${(CORRECTION_RULES[e.lvl]?.color || "#ef4444")}40`,
                        color: CORRECTION_RULES[e.lvl]?.color || "#ef4444",
                      }}>
                      An {(e.m / 12 + 1).toFixed(1)} · {(e.dd * 100).toFixed(1)}% · {fmtEur(e.amt)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#1a1c26] border border-indigo-500/25 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">Final Strategie</div>
                <div className="text-lg font-mono font-bold text-indigo-400">{fmtEur(sim.stratTotal)}</div>
                <div className="text-xs text-slate-600 mt-1">
                  portfolio {fmtEur(sim.stratPort)}<br />rezervă {fmtEur(sim.savLeft)}
                </div>
                <div className={`text-xs font-mono mt-1 ${stratGain >= 0 ? "text-indigo-400" : "text-red-400"}`}>
                  {stratGain >= 0 ? "+" : ""}{stratPct}%
                </div>
              </div>

              <div className="bg-[#1a1c26] border border-green-500/20 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">DCA All-In €{dca + sav}/lună</div>
                <div className="text-lg font-mono font-bold text-green-400">{fmtEur(sim.allIn)}</div>
                <div className="text-xs text-slate-600 mt-1">
                  tot investit imediat<br />fără rezervă
                </div>
                <div className={`text-xs font-mono mt-1 ${allInGain >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {allInGain >= 0 ? "+" : ""}{allInPct}%
                </div>
              </div>

              <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">Total Investit</div>
                <div className="text-lg font-mono font-bold text-slate-300">{fmtEur(totalOut)}</div>
                <div className="text-xs text-slate-600 mt-1">{years}a × €{dca + sav}/lună</div>
              </div>

              <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">Verdict</div>
                <div className={`text-lg font-mono font-bold ${stratWins ? "text-indigo-400" : "text-green-400"}`}>
                  {stratWins ? "Strategie" : "All-In"}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  cu {fmtEur(Math.abs(sim.stratTotal - sim.allIn))} față de cealaltă
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-700 text-center pb-4">
              ⚠️ Not financial advice · simulare Monte Carlo · performanțele trecute nu garantează rezultate viitoare
            </p>
          </div>
        )}

        {/* === TAB: Strategie === */}
        {tab === "strat" && (
          <div className="px-4 py-4 space-y-4 safe-bottom">
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Cum funcționează</h2>
              <div className="space-y-3 text-sm text-slate-400">
                <p>Investești <span className="text-indigo-300 font-mono">€{dca}/lună</span> prin DCA indiferent de piață.</p>
                <p>Acumulezi <span className="text-indigo-300 font-mono">€{sav}/lună</span> în rezervă, așteptând corecții.</p>
                <p>La fiecare prag de corecție, deploiezi un procent din rezervă:</p>
              </div>
            </div>

            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a2c3a]">
                <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">Tabelul de corecții</span>
              </div>
              {CORRECTION_RULES.map((r, i) => {
                const triggered = sim.events.filter(e => e.lvl === i).length
                const annualSav = sav * 12
                return (
                  <div key={r.threshold}
                    className="flex items-center px-4 py-3.5 border-b border-[#1e2030] last:border-0">
                    <div className="w-16 font-mono text-base font-bold" style={{ color: r.color }}>
                      {r.label}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm text-slate-300">Deploy <span className="font-mono">{r.pct}%</span> din rezervă</div>
                      <div className="text-xs text-slate-600">≈ €{(annualSav * r.pct / 100).toFixed(0)} la €{sav}/lună economii/an</div>
                    </div>
                    {triggered > 0 && (
                      <div className="text-xs font-mono px-2 py-0.5 rounded"
                        style={{ background: r.color + "20", color: r.color }}>
                        ×{triggered} în sim.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4">
              <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-3">Alocarea portofoliului</h3>
              <div className="space-y-3">
                {[
                  { label: "S&P 500", pct: 55, color: "#6366f1", ret: cfg.sp },
                  { label: "STOXX Europe 600", pct: 35, color: "#3b82f6", ret: cfg.stoxx },
                  { label: "Gold (XAU)", pct: 10, color: "#eab308", ret: cfg.gold },
                ].map(a => (
                  <div key={a.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span style={{ color: a.color }}>{a.label}</span>
                      <span className="text-slate-400 font-mono">{a.pct}% · {(a.ret * 100).toFixed(0)}%/an</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#2a2c3a]">
                      <div className="h-2 rounded-full" style={{ width: `${a.pct}%`, background: a.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-700 text-center pb-4">
              ⚠️ Not financial advice
            </p>
          </div>
        )}

        {/* === TAB: Istoric === */}
        {tab === "hist" && (
          <div className="px-4 py-4 space-y-3 safe-bottom">
            <div className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-4">
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Corecții S&P 500 · 2013–2024</h2>
              <p className="text-xs text-slate-600">Date reale · surse: Bloomberg, Macrotrends, Yahoo Finance</p>
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
                    <div className="text-xl font-mono font-bold ml-3 flex-shrink-0" style={{ color }}>
                      {row.depth}%
                    </div>
                  </div>
                  <div className="flex gap-3 text-xs text-slate-500">
                    <span>⏱ {row.months} luni cădere</span>
                    <span>📈 {row.recovery} luni recovery</span>
                  </div>
                  {triggered.length > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {triggered.map(r => (
                        <span key={r.threshold} className="px-2 py-0.5 rounded text-xs font-mono"
                          style={{ background: r.color + "20", color: r.color, border: `1px solid ${r.color}40` }}>
                          {r.label} atins
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { label: "Corecții ≥ −10%", value: "7", sub: "în 11 ani" },
                { label: "Corecții ≥ −20%", value: "2", sub: "2020, 2022" },
                { label: "Corecții ≥ −30%", value: "1", sub: "COVID 2020" },
                { label: "Recovery mediu", value: "5.4 luni", sub: "trough → ATH nou" },
              ].map((s, i) => (
                <div key={i} className="bg-[#1a1c26] border border-[#2a2c3a] rounded-xl p-3">
                  <div className="text-xs text-slate-600">{s.label}</div>
                  <div className="text-base font-mono text-slate-300 mt-0.5">{s.value}</div>
                  <div className="text-xs text-slate-700">{s.sub}</div>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-700 text-center pb-4">
              Performanțele trecute nu garantează rezultate viitoare
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
