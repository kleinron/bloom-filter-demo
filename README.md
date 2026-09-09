# Bloom filter demo

**Version 2.0.0**

Interactive React (Vite) visualization of a Bloom filter — add string keys, step through hash→bit probes, query membership, and **suggest a false positive**.

## Run

```bash
npm install
npm run dev
```

Build: `npm run build`

Viewport is locked to **16:9** for presentation.

## Controls

- **m** — bit array length
- **k** — hash function count (double-hashing)
- **Add** / **Exists?** — step-through animation
- **Suggest FP** — finds a string not in the added set that still probes all-1 bits

## Mechanics

- Hashes: FNV-1a + Kirsch–Mitzenmacher double hashing
- Query **no** = definitely not present; **maybe** = possible false positive
- False negatives do not occur in a Bloom filter


## Visual tests

Playwright screenshots (1280×720) guard the 16:9 layout, including the foo→bar add path:

```bash
npm run build
npm run test:visual          # compare to baselines
npm run test:visual:update   # refresh baselines
```

Assertions: 20 bits in one row, sidebar on-stage, stage fits viewport after adds.
