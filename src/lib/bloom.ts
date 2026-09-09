/**
 * Classic Bloom filter for string keys.
 * Hashes: FNV-1a 32-bit + double-hashing (Kirsch–Mitzenmacher):
 *   h_i(x) = (h1(x) + i * h2(x)) mod m
 */

export function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashPair(key: string): [number, number] {
  const h1 = fnv1a32(key);
  // second hash: FNV on reversed + salt
  const h2 = fnv1a32(key.split("").reverse().join("") + "\0salt") | 1; // odd, never 0
  return [h1, h2 >>> 0];
}

export function indicesFor(key: string, m: number, k: number): number[] {
  const [h1, h2] = hashPair(key);
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    out.push((h1 + i * h2) % m);
  }
  return out;
}

export class BloomFilter {
  readonly m: number;
  readonly k: number;
  bits: Uint8Array;
  keys: string[];

  constructor(m: number, k: number) {
    this.m = m;
    this.k = k;
    this.bits = new Uint8Array(m);
    this.keys = [];
  }

  indices(key: string): number[] {
    return indicesFor(key, this.m, this.k);
  }

  add(key: string): number[] {
    const idx = this.indices(key);
    for (const i of idx) this.bits[i] = 1;
    if (!this.keys.includes(key)) this.keys.push(key);
    return idx;
  }

  /** true = maybe; false = definitely not */
  mightContain(key: string): { maybe: boolean; indices: number[]; hits: boolean[] } {
    const idx = this.indices(key);
    const hits = idx.map((i) => this.bits[i] === 1);
    return { maybe: hits.every(Boolean), indices: idx, hits };
  }

  fillRatio(): number {
    let set = 0;
    for (let i = 0; i < this.m; i++) if (this.bits[i]) set++;
    return set / this.m;
  }
}

/** Small word list for demo FP suggestions */
export const WORD_BANK = [
  "orange","apple","banana","grape","mango","peach","plum","kiwi","melon","lemon",
  "cat","dog","bird","fish","lion","tiger","bear","wolf","fox","deer",
  "red","blue","green","yellow","purple","black","white","silver","gold","coral",
  "alpha","bravo","charlie","delta","echo","foxtrot","golf","hotel","india","juliet",
  "north","south","east","west","up","down","left","right","center","edge",
  "river","ocean","mountain","forest","desert","island","valley","canyon","lake","stream",
  "code","data","bit","byte","hash","bloom","filter","array","index","probe",
  "sunny","cloudy","rainy","windy","storm","frost","flame","spark","glow","shade",
  "zeta","omega","sigma","theta","lambda","kappa","gamma","beta","nova","quark",
  "hello","world","demo","test","sample","token","string","value","key","item",
];

/**
 * Find a string NOT in added keys that still probes all-set bits (false positive).
 * Searches word bank then generated suffixes.
 */
export function suggestFalsePositive(filter: BloomFilter): string | null {
  const added = new Set(filter.keys);
  const tryKey = (s: string) => {
    if (added.has(s)) return false;
    return filter.mightContain(s).maybe;
  };

  for (const w of WORD_BANK) {
    if (tryKey(w)) return w;
  }
  // generated candidates
  for (let n = 0; n < 4000; n++) {
    const s = `fp_${n.toString(36)}`;
    if (tryKey(s)) return s;
  }
  for (const w of WORD_BANK) {
    for (let i = 0; i < 50; i++) {
      const s = `${w}${i}`;
      if (tryKey(s)) return s;
    }
  }
  return null;
}

const LN2 = Math.LN2;
export const K_UI_MAX = 7;

export type InitCalc =
  | { ok: true; nMax: number; kOpt: number }
  | { ok: false; reason: string };

/**
 * Classic Bloom sizing (optimal k):
 *   n_max = floor( m * (ln 2)^2 / (-ln p) )
 *   k_opt = max(1, round( (m / n_max) * ln 2 ))  // ≡ round(-log2(p)) when n_max > 0
 */
export function bloomInitCalc(m: number, p: number): InitCalc {
  if (!(p > 0 && p < 1)) {
    return { ok: false, reason: "Target FPP must be between 0% and 100% (exclusive)." };
  }
  if (!(m >= 1)) {
    return { ok: false, reason: "m must be ≥ 1." };
  }
  const nMax = Math.floor((m * LN2 * LN2) / -Math.log(p));
  if (nMax < 1) {
    return { ok: false, reason: "m too small for that FPP" };
  }
  let kOpt = Math.round((m / nMax) * LN2);
  kOpt = Math.max(1, kOpt);
  kOpt = Math.min(K_UI_MAX, kOpt);
  return { ok: true, nMax, kOpt };
}
