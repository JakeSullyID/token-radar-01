# Token Radar — radar-2

A token launch radar for the make.fun `token-radar-01` bounty ($1,325; 1st place $1,000).
It ranks pre-token protocols by an implied value and gives each one a farm plan.

## The model (radar-2)

```
implied = round( tvl_usd × catMultiple(category) × growthMult × maturityMult )
```

- `catMultiple(category)` is the **median mcap/TVL of live-token protocols in the
  same category**, computed from the sealed snapshot — at least 2 live comps,
  otherwise the global median **0.2138** (128 live comps). Clamped to [0.02, 1.00].
- Growth is the 7-day change clamped to ±25%, weighted 0.5 (a tilt of at most ±12.5%).
- Age is a 0.75–1.00 maturity tilt over 1,095 days (unknown age counts as 365 days).

No protocol name is special-cased; every multiple is computed from the snapshot.

## The board

178 rows: the 40-protocol watchlist (the floor) plus 138 pre-token protocols below
the $50M floor that pass the watchlist's own exclusion rule (no bridges, no liquid
staking/restaking, no wrapped/staked products, no exchange products, no versioned pools).

- #1 Steakhouse Financial — $508,960,080 · #2 Gauntlet — $303,124,278 ·
  #3 USDD — $156,208,831 · #20 Veda — $26,803,968 (the allocator demotion:
  its only two live comps trade at 0.006–0.019× TVL, floored to 0.020).

Every row carries an 8-step farm plan with cost and time, derived from the
protocol's own record (category, chains, TVL tier, age).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes the
ranked board to `board.json`, the dashboard data to `data.js`, copies
`dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored
make.fun library. The dashboard (`dashboard/index.html`, `app.css`, `app.js`) is
a static page with no network: board, filters (category, chain, watchlist-only),
per-protocol detail with model breakdown + comparables + farm plan, and a
live-token calibration tab.

## Submission

- make.fun submission `01a1d9b1-e73f-744d-a6e5-e84964c8f4fb`, claim code
  `AF-JRZVG-A8W0N-04GTA-XCAG1`, commit `fbbba5b7ef2552895299cc0e6486077b87b547c3`
- Competition closes Mon 2026-12-14 17:00 WIB.
- License: MIT.
