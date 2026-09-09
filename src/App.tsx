import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BloomFilter, suggestFalsePositive, bloomInitCalc, K_UI_MAX } from "./lib/bloom";
import "./App.css";

type Mode = "idle" | "add" | "exists" | "fp";
type StepPhase = "hash" | "probe" | "done";

type OpState = {
  mode: Mode;
  key: string;
  indices: number[];
  hits: boolean[];
  step: number;
  phase: StepPhase;
  result?: "added" | "maybe" | "no" | "false-positive";
};

const DEFAULT_M = 20;
const DEFAULT_K = 1;

function cloneWithAdd(f: BloomFilter, key: string): BloomFilter {
  const nf = new BloomFilter(f.m, f.k);
  nf.bits = f.bits.slice();
  nf.keys = [...f.keys];
  nf.add(key);
  return nf;
}

/** Classic approx FP rate: (1 - e^{-kn/m})^k */
function estimatedFpRate(m: number, k: number, n: number): number {
  if (m <= 0 || n <= 0) return 0;
  const exp = Math.exp(-(k * n) / m);
  return Math.pow(1 - exp, k);
}

function formatPct(p: number): string {
  if (p <= 0) return "0%";
  if (p < 0.001) return "<0.1%";
  if (p < 0.01) return `${(p * 100).toFixed(2)}%`;
  return `${Math.round(p * 1000) / 10}%`;
}

/** Group hash chips that land on the same bit index */
function chipGroups(indices: number[]): { bit: number; hs: number[] }[] {
  const map = new Map<number, number[]>();
  indices.forEach((bit, i) => {
    const list = map.get(bit) ?? [];
    list.push(i);
    map.set(bit, list);
  });
  // preserve first-seen order of bits
  const seen = new Set<number>();
  const out: { bit: number; hs: number[] }[] = [];
  for (const bit of indices) {
    if (seen.has(bit)) continue;
    seen.add(bit);
    out.push({ bit, hs: map.get(bit)! });
  }
  return out;
}

export default function App() {
  const [m, setM] = useState(DEFAULT_M);
  const [k, setK] = useState(DEFAULT_K);
  const [filter, setFilter] = useState(() => new BloomFilter(DEFAULT_M, DEFAULT_K));
  const [input, setInput] = useState("");
  const [op, setOp] = useState<OpState | null>(null);
  const [auto, setAuto] = useState(false);
  const [speedMs, setSpeedMs] = useState(450);
  const [mDraft, setMDraft] = useState(String(DEFAULT_M));
  const [kDraft, setKDraft] = useState(String(DEFAULT_K));
  const [speedDraft, setSpeedDraft] = useState("450");
  const [fpHint, setFpHint] = useState<string | null>(null);
  const [initOpen, setInitOpen] = useState(false);
  const [initM, setInitM] = useState(String(DEFAULT_M));
  const [initFppPct, setInitFppPct] = useState("1"); // 1% default teaching target
  const [capacityLabel, setCapacityLabel] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  const fill = useMemo(() => Math.round(filter.fillRatio() * 100), [filter, op]);
  const fpEst = useMemo(
    () => estimatedFpRate(filter.m, filter.k, filter.keys.length),
    [filter]
  );

  const initCalc = useMemo(() => {
    const nm = Number(initM);
    const pct = Number(initFppPct);
    if (!Number.isFinite(nm) || !Number.isFinite(pct)) {
      return bloomInitCalc(0, -1);
    }
    return bloomInitCalc(Math.round(nm), pct / 100);
  }, [initM, initFppPct]);

  const resetFilter = useCallback((nm: number, nk: number) => {
    setFilter(new BloomFilter(nm, nk));
    setOp(null);
    setFpHint(null);
    setAuto(false);
    setMDraft(String(nm));
    setKDraft(String(nk));
  }, []);

  const clearBits = useCallback(() => {
    setFilter((f) => new BloomFilter(f.m, f.k));
    setOp(null);
    setFpHint(null);
    setAuto(false);
    setInput("");
  }, []);

  const openInit = () => {
    setInitM(String(m));
    setInitOpen(true);
  };

  const confirmInit = () => {
    if (!initCalc.ok) return;
    const nm = Math.min(128, Math.max(8, Math.round(Number(initM))));
    const nk = initCalc.kOpt;
    setM(nm);
    setK(nk);
    setCapacityLabel(initCalc.nMax);
    resetFilter(nm, nk);
    setInput("");
    setInitOpen(false);
  };

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const clearTimer = () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const advance = useCallback(() => {
    setOp((prev) => {
      if (!prev || prev.phase === "done") return prev;
      if (prev.phase === "hash") {
        return { ...prev, phase: "probe", step: 0 };
      }
      if (prev.phase === "probe") {
        const next = prev.step + 1;
        if (next >= prev.indices.length) {
          if (prev.mode === "add") {
            queueMicrotask(() => setFilter((f) => cloneWithAdd(f, prev.key)));
            return { ...prev, phase: "done", step: prev.indices.length, result: "added" };
          }
          const allHit = prev.hits.every(Boolean);
          if (prev.mode === "fp") {
            return { ...prev, phase: "done", step: prev.indices.length, result: "false-positive" };
          }
          return {
            ...prev,
            phase: "done",
            step: prev.indices.length,
            result: allHit ? "maybe" : "no",
          };
        }
        return { ...prev, step: next };
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    clearTimer();
    if (!auto || !op || op.phase === "done") return;
    timer.current = window.setTimeout(() => advance(), speedMs);
    return clearTimer;
  }, [auto, op, speedMs, advance]);

  const busy = op?.phase === "hash" || op?.phase === "probe";

  const startAdd = () => {
    const key = input.trim();
    if (!key || busy) return;
    const idx = filter.indices(key);
    setAuto(true);
    setOp({ mode: "add", key, indices: idx, hits: idx.map(() => true), step: -1, phase: "hash" });
    setInput("");
  };

  const startExists = () => {
    const key = input.trim();
    if (!key || busy) return;
    const { indices, hits } = filter.mightContain(key);
    setAuto(true);
    setOp({ mode: "exists", key, indices, hits, step: -1, phase: "hash" });
  };

  const startFp = () => {
    if (filter.keys.length === 0 || busy) return;
    const suggestion = suggestFalsePositive(filter);
    setFpHint(suggestion);
    if (!suggestion) return;
    const { indices, hits } = filter.mightContain(suggestion);
    setAuto(true);
    setOp({ mode: "fp", key: suggestion, indices, hits, step: -1, phase: "hash" });
  };

  const activeBit =
    op && op.phase === "probe" && op.step < op.indices.length ? op.indices[op.step] : null;

  const probedSet = new Set<number>();
  const missSet = new Set<number>();
  if (op && (op.phase === "probe" || op.phase === "done")) {
    const upto = op.phase === "done" ? op.indices.length : op.step + 1;
    for (let i = 0; i < upto; i++) {
      probedSet.add(op.indices[i]);
      if (op.mode !== "add" && !op.hits[i]) missSet.add(op.indices[i]);
    }
  }

  const statusText = (() => {
    if (!op) return "Add a string key, then watch hashes light up bits. Query to see maybe vs definitely not.";
    if (op.phase === "hash") return `Hashing “${op.key}” → ${op.indices.length} bit indices…`;
    if (op.phase === "probe") {
      const i = op.indices[op.step];
      const hit = op.mode === "add" ? true : op.hits[op.step];
      return `h${op.step + 1} → bit ${i} ${op.mode === "add" ? "(set)" : hit ? "(already 1)" : "(0 → definitely not)"}`;
    }
    if (op.result === "added") return `Added “${op.key}”. Bits set at [${op.indices.join(", ")}].`;
    if (op.result === "no") return `“${op.key}” is definitely not in the set (a 0 bit).`;
    if (op.result === "maybe") return `“${op.key}” might be in the set (all probe bits are 1).`;
    if (op.result === "false-positive")
      return `False positive: “${op.key}” was never added, but all bits are 1 — filter says maybe.`;
    return "";
  })();

  const showTopFp = op?.result === "false-positive" || (op?.result === "maybe" && op && !filter.keys.includes(op.key));

  return (
    <div className="stage" data-testid="stage" data-phase={op?.phase ?? "idle"} data-op={op?.mode ?? "none"}>
      <header className="top">
        <div className="top-left">
          <h1>Bloom filter</h1>
          <p className="sub">
            Probabilistic set · false positives possible · false negatives never
          </p>
          {showTopFp && op && (
            <div className="fp-top">
              False positive — “{op.key}” never added, filter still says maybe
            </div>
          )}
        </div>
        <div className="metrics" data-testid="metrics">
          <div className="metric">
            <span className="mlabel">Fill</span>
            <strong>{fill}%</strong>
          </div>
          <div className="metric">
            <span className="mlabel">Est. FP</span>
            <strong>{formatPct(fpEst)}</strong>
          </div>
          <div className="metric">
            <span className="mlabel">Keys</span>
            <strong>{filter.keys.length}</strong>
          </div>
          <div className="metric">
            <span className="mlabel">m × k</span>
            <strong>
              {m}×{k}
            </strong>
          </div>
        </div>
      </header>

      <section className="hero-board" aria-label="Bit array">
        <div className="viz-head">
          <span className="viz-label">Bit array</span>
          <div className="legend" aria-label="Color legend">
            <span className="leg"><i className="sw off" /> 0</span>
            <span className="leg"><i className="sw on" /> 1</span>
            <span className="leg"><i className="sw probe" /> probing</span>
            <span className="leg"><i className="sw miss" /> miss</span>
          </div>
        </div>

        {!op && filter.keys.length === 0 && (
          <div className="teach-steps" aria-label="Suggested first steps">
            <span className="step"><strong>1</strong> Add foo</span>
            <span className="step"><strong>2</strong> Add bar</span>
            <span className="step"><strong>3</strong> Suggest FP</span>
          </div>
        )}

        <div className="bit-track">
          <div className="bitarray" style={{ ["--cols" as string]: Math.min(m, 20) }}>
            <div className="bitgrid" data-testid="bitgrid">
              {Array.from({ length: m }, (_, i) => {
                const on = filter.bits[i] === 1 || (op?.mode === "add" && probedSet.has(i));
                const isActive = activeBit === i;
                const wasProbed = probedSet.has(i);
                const isMiss = missSet.has(i);
                return (
                  <div key={i} className="bit-cell">
                    <div
                      className={[
                        "bit",
                        on ? "on" : "off",
                        isActive ? "active" : "",
                        wasProbed ? "probed" : "",
                        isMiss ? "miss" : "",
                      ].join(" ")}
                      data-testid={`bit-${i}`}
                      title={`bit ${i}`}
                    >
                      <span className="bit-v">{on ? "1" : "0"}</span>
                    </div>
                    <span className={isActive ? "idx active" : "idx"} aria-hidden="true">
                      {i}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="main">
        <section className="story" aria-label="Operation story">
          <div className="story-top">
            <span className="viz-label">What just happened</span>
            <p className="status" data-testid="status">{statusText}</p>
            {op && (
              <div className="hash-row">
                {chipGroups(op.indices).map(({ bit, hs }) => {
                  const maxH = Math.max(...hs);
                  const done = op.phase === "done" || (op.phase === "probe" && maxH <= op.step);
                  const failed =
                    op.mode !== "add" &&
                    done &&
                    hs.some((hi) => op.hits[hi] === false && (op.phase === "done" || hi <= op.step));
                  const merged = hs.length > 1;
                  const label = merged
                    ? `h${hs.map((h) => h + 1).join("+")}→${bit}`
                    : `h${hs[0] + 1}→${bit}`;
                  return (
                    <span
                      key={`${bit}-${hs.join("-")}`}
                      className={[
                        "chip",
                        done ? "done" : "",
                        failed ? "fail" : "",
                        merged ? "merged" : "",
                      ].join(" ")}
                    >
                      {label}
                      {merged && <em className="same-bit">same bit</em>}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pipeline" aria-hidden={!op}>
            <div className={["pipe-node", op ? "on" : ""].join(" ")}>
              <span className="pipe-k">key</span>
              <strong>{op?.key ?? "—"}</strong>
            </div>
            <span className="pipe-arrow">→</span>
            <div className={["pipe-node", op ? "on" : ""].join(" ")}>
              <span className="pipe-k">hashes</span>
              <strong>k={k}</strong>
            </div>
            <span className="pipe-arrow">→</span>
            <div className={["pipe-node", op ? "on" : ""].join(" ")}>
              <span className="pipe-k">bits</span>
              <strong>{op ? `[${op.indices.join(", ")}]` : "—"}</strong>
            </div>
            <span className="pipe-arrow">→</span>
            <div
              className={[
                "pipe-node",
                "result",
                op?.result === "false-positive" || (op?.result === "maybe" && op && !filter.keys.includes(op.key))
                  ? "fp"
                  : op?.result === "no"
                    ? "no"
                    : op?.result
                      ? "ok"
                      : "",
              ].join(" ")}
            >
              <span className="pipe-k">result</span>
              <strong>
                {!op
                  ? "—"
                  : op.result === "added"
                    ? "set bits"
                    : op.result === "no"
                      ? "definitely not"
                      : op.result === "false-positive"
                        ? "false positive"
                        : op.result === "maybe"
                          ? filter.keys.includes(op.key)
                            ? "maybe (true)"
                            : "maybe (FP)"
                          : op.phase}
              </strong>
            </div>
          </div>

          <div className="rules">
            <div className="rule">
              <strong>Definitely not</strong>
              <span>any probed bit is 0</span>
            </div>
            <div className="rule">
              <strong>Maybe</strong>
              <span>all probed bits are 1</span>
            </div>
            <div className="rule">
              <strong>Never wrong negative</strong>
              <span>false negatives impossible</span>
            </div>
          </div>

          <div className="formula">
            <span className="formula-eq">Est. FP ≈ (1 − exp(−k·n/m))<sup>k</sup></span>
            <em>
              n={filter.keys.length}, m={m}, k={k} → {formatPct(fpEst)}
            </em>
          </div>
        </section>

        <aside className="side" data-testid="side">
          <label className="field">
            <span>Key</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startAdd()}
              data-testid="key-input" placeholder="e.g. foo"
              disabled={busy}
            />
          </label>

          <div className="btn-row">
            <button className="primary" data-testid="btn-add" onClick={startAdd} disabled={!input.trim() || busy}>
              Add
            </button>
            <button data-testid="btn-exists" onClick={startExists} disabled={!input.trim() || busy}>
              Exists?
            </button>
            <button className="accent" data-testid="btn-fp" onClick={startFp} disabled={filter.keys.length === 0 || busy}>
              Suggest FP
            </button>
          </div>

          <div className="controls-grid">
            <label className="ctrl">
              <span className="ctrl-h">
                Bit length m
                <input
                  className="num"
                  type="number"
                  min={8}
                  max={128}
                  step={1}
                  value={mDraft}
                  onChange={(e) => setMDraft(e.target.value)}
                  onBlur={() => {
                    const raw = Number(mDraft);
                    const nm = Number.isFinite(raw) ? Math.min(128, Math.max(8, Math.round(raw))) : m;
                    setMDraft(String(nm));
                    if (nm !== m) {
                      setM(nm);
                      resetFilter(nm, k);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </span>
              <input
                type="range"
                min={8}
                max={128}
                step={1}
                value={m}
                onChange={(e) => {
                  const nm = Number(e.target.value);
                  setM(nm);
                  setMDraft(String(nm));
                  resetFilter(nm, k);
                }}
              />
            </label>
            <label className="ctrl">
              <span className="ctrl-h">
                Hash count k
                <input
                  className="num"
                  type="number"
                  min={1}
                  max={7}
                  step={1}
                  value={kDraft}
                  onChange={(e) => setKDraft(e.target.value)}
                  onBlur={() => {
                    const raw = Number(kDraft);
                    const nk = Number.isFinite(raw) ? Math.min(7, Math.max(1, Math.round(raw))) : k;
                    setKDraft(String(nk));
                    if (nk !== k) {
                      setK(nk);
                      resetFilter(m, nk);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </span>
              <input
                type="range"
                min={1}
                max={7}
                value={k}
                onChange={(e) => {
                  const nk = Number(e.target.value);
                  setK(nk);
                  setKDraft(String(nk));
                  resetFilter(m, nk);
                }}
              />
            </label>
            <label className="ctrl">
              <span className="ctrl-h">
                Step speed (ms)
                <input
                  className="num"
                  type="number"
                  min={150}
                  max={900}
                  step={10}
                  value={speedDraft}
                  onChange={(e) => setSpeedDraft(e.target.value)}
                  onBlur={() => {
                    const raw = Number(speedDraft);
                    const ns = Number.isFinite(raw) ? Math.min(900, Math.max(150, Math.round(raw))) : speedMs;
                    setSpeedDraft(String(ns));
                    setSpeedMs(ns);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </span>
              <input
                type="range"
                min={150}
                max={900}
                step={10}
                value={speedMs}
                onChange={(e) => {
                  const ns = Number(e.target.value);
                  setSpeedMs(ns);
                  setSpeedDraft(String(ns));
                }}
              />
            </label>
          </div>

          <div className="btn-row">
            <button onClick={() => advance()} disabled={!op || op.phase === "done" || auto}>
              Step
            </button>
            <button onClick={() => setAuto((a) => !a)} disabled={!op || op.phase === "done"}>
              {auto ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => {
                resetFilter(m, k);
                setInput("");
                setCapacityLabel(null);
              }}
            >
              Reset
            </button>
            <button className="secondary" data-testid="btn-clear" onClick={clearBits} disabled={busy}>
              Clear
            </button>
            <button
              className="primary-outline"
              data-testid="btn-init"
              onClick={() => (initOpen ? setInitOpen(false) : openInit())}
              disabled={busy}
            >
              Init
            </button>
          </div>

          {initOpen && (
            <div className="init-drawer" data-testid="init-drawer">
              <div className="init-h">Init calculator</div>
              <p className="init-sub">Size from m + target FPP · bitboard stays visible</p>
              <label className="ctrl">
                <span className="ctrl-h">
                  m (bits)
                  <input
                    className="num"
                    type="number"
                    min={8}
                    max={128}
                    value={initM}
                    onChange={(e) => setInitM(e.target.value)}
                  />
                </span>
              </label>
              <label className="ctrl">
                <span className="ctrl-h">
                  Target FPP (%)
                  <input
                    className="num"
                    type="number"
                    min={0.01}
                    max={99}
                    step={0.1}
                    value={initFppPct}
                    onChange={(e) => setInitFppPct(e.target.value)}
                  />
                </span>
              </label>
              <div className="init-out">
                <div>
                  <span className="mlabel">Optimal k</span>
                  <strong data-testid="init-k">
                    {initCalc.ok ? initCalc.kOpt : "—"}
                  </strong>
                </div>
                <div>
                  <span className="mlabel">Max n</span>
                  <strong data-testid="init-nmax">
                    {initCalc.ok ? initCalc.nMax : "—"}
                  </strong>
                </div>
              </div>
              {!initCalc.ok && <div className="init-warn">{initCalc.reason}</div>}
              {initCalc.ok && (
                <div className="init-note">
                  k clamped to ≤ {K_UI_MAX} · max n is a teaching capacity, not a hard stop
                </div>
              )}
              <div className="btn-row">
                <button className="primary" data-testid="btn-init-confirm" onClick={confirmInit} disabled={!initCalc.ok}>
                  Confirm
                </button>
                <button className="secondary" onClick={() => setInitOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="keys">
            <div className="keys-h">
              Added keys
              {capacityLabel != null && (
                <span className="cap-label"> · capacity ≈ {capacityLabel}</span>
              )}
            </div>
            {filter.keys.length === 0 ? (
              <div className="muted">None yet — try foo, bar</div>
            ) : (
              <ul>
                {filter.keys.map((key) => (
                  <li key={key}>{key}</li>
                ))}
              </ul>
            )}
            {fpHint && op?.mode === "fp" && (
              <div className="fp-note">
                Suggested FP: <strong>{fpHint}</strong>
              </div>
            )}
          </div>

          {op?.result === "false-positive" && (
            <div className="fp-banner">False positive — never added, filter still says maybe</div>
          )}
          {op?.result === "maybe" && filter.keys.includes(op.key) && (
            <div className="ok-banner">True positive — key was added</div>
          )}
          {op?.result === "maybe" && !filter.keys.includes(op.key) && (
            <div className="fp-banner">Looks like a false positive</div>
          )}
        </aside>
      </div>
    </div>
  );
}
