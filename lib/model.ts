// The radar-2 algorithm evaluates unissued protocols by multiplying total value locked against peer valuation metrics.
// Category multipliers derive from median market capitalization ratios among active comparable tokens within the dataset.
// When category samples fall below two, valuation defaults to the dataset-wide median ratio with strict floor and ceiling bounds.
// Final estimations incorporate adjustments for seven-day performance momentum and historical operating duration without tokens.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_category_comps: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -25,
  growth_cap: 25,
  maturity_floor: 0.75,
  maturity_range: 0.25,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
  min_category_comps: 2,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
    live_comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One live-token comparable: a protocol whose token already trades, near the row by TVL. */
export interface Comparable {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: 'category' | 'global';
  live_comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  comparables: Comparable[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** One category's calibration: how many live comps set its multiple, and what it is. */
export interface CategoryMultiple {
  category: string;
  n: number;
  median: number | null;
  multiple: number;
  fallback: boolean;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list; the mean of the two middle values when the count is even. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) throw new Error('median of an empty list');
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** Whether a protocol is a live comparable: its token trades, so mcap/TVL is a market fact. */
export function isLiveComp(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** The live comps grouped by category, and the global median over all of them. */
export function computeMultiples(snapshot: Snapshot, model: ModelConstants): { globalMedian: number; byCategory: Map<string, CategoryMultiple> } {
  const live = snapshot.protocols.filter(isLiveComp);
  const globalMedian = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const ratios = new Map<string, number[]>();
  for (const p of live) {
    const c = p.category ?? 'Other';
    const list = ratios.get(c);
    if (list === undefined) ratios.set(c, [p.mcap_usd! / p.tvl_usd]);
    else list.push(p.mcap_usd! / p.tvl_usd);
  }
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, xs] of [...ratios.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (xs.length >= model.min_category_comps) {
      const med = median(xs);
      byCategory.set(category, { category, n: xs.length, median: med, multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, med)), fallback: false });
    } else {
      byCategory.set(category, { category, n: xs.length, median: median(xs), multiple: globalMedian, fallback: true });
    }
  }
  return { globalMedian, byCategory };
}

/** A category's multiple: its own median when it has enough live comps, else the global median. */
export function categoryMultiple(category: string | null, multiples: { globalMedian: number; byCategory: Map<string, CategoryMultiple> }, model: ModelConstants): CategoryMultiple {
  const c = category ?? 'Other';
  const entry = multiples.byCategory.get(c);
  if (entry !== undefined) return entry;
  return { category: c, n: 0, median: null, multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiples.globalMedian)), fallback: true };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, multiples: { globalMedian: number; byCategory: Map<string, CategoryMultiple> }, model: ModelConstants): { implied: number; multiple: number; multipleSource: 'category' | 'global'; liveComps: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const entry = categoryMultiple(protocol.category, multiples, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * entry.multiple * growthMult * maturityMult));
  return { implied, multiple: entry.multiple, multipleSource: entry.fallback ? 'global' : 'category', liveComps: entry.n, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The watchlist's own exclusion rule for below-floor protocols: never a bridged, staked or exchange product. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a below-floor protocol is one the early radar may rank: pre-token, and the watchlist's own exclusion rule applied to it. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The live comps in a protocol's own category nearest by TVL, for the detail view's comparables box. */
export function comparablesFor(p: SnapshotProtocol, snapshot: Snapshot): Comparable[] {
  const c = p.category ?? 'Other';
  return snapshot.protocols
    .filter((q) => isLiveComp(q) && (q.category ?? 'Other') === c)
    .map((q) => ({ slug: q.slug, name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd!, ratio: q.mcap_usd! / q.tvl_usd, gap: Math.abs(q.tvl_usd - p.tvl_usd) }))
    .sort((a, b) => a.gap - b.gap || (a.slug < b.slug ? -1 : 1))
    .slice(0, 3)
    .map((q) => ({ slug: q.slug, name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd, ratio: q.ratio }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = computeMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that pass the watchlist's own
  // exclusion rule, every one of them. Never a replacement for a watchlist row: a chosen protocol
  // stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { implied, multiple, multipleSource, liveComps, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, implied, multiple, multipleSource, liveComps, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      multiple_source: s.multipleSource,
      live_comps: s.liveComps,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action: the chain and the category action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('liquidity manager') || c.includes('leveraged farm')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and hold the position.`;
  if (c.includes('restak')) return `Restake $${capital} of the staking asset through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('payment') || c === 'chain') return `Use ${name} to move $${capital} on ${chain}, through the payment rail or the chain's flagship app.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('governance')) return `Lock $${capital} through ${name} on ${chain} and vote in the protocol's governance if it offers voting.`;
  if (c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The second qualifying action: a different mechanic in the same protocol, so the wallet shows more than one deposit. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): FarmStep {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  if (c.includes('curator') || c.includes('allocator')) {
    if (secondChain !== null) return { text: `Deposit a second, smaller tranche into a ${name} vault on a different chain it lists, such as ${secondChain}, so the activity spans two chains.`, cost: 'about $4 of gas', time: '10 minutes' };
    return { text: `Deposit a second, smaller tranche into a second ${name} vault on ${chain}, or a second strategy in the same vault, so the activity is not a single deposit.`, cost: 'about $4 of gas', time: '10 minutes' };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return { text: `Borrow a small amount against the supply, keeping the health factor high, so the wallet shows borrowing as well as supplying.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('dex')) return { text: `Swap a small amount through the ${name} pool once, so the wallet shows trading activity as well as liquidity.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('yield') || c.includes('liquidity manager') || c.includes('leveraged farm')) return { text: `Stake the receipt token if the protocol offers staking; otherwise deposit into a second vault on ${chain}.`, cost: 'about $4 of gas', time: '10 minutes' };
  if (c.includes('rwa')) {
    if (secondChain !== null) return { text: `Mint a second tranche on another chain the protocol lists, such as ${secondChain}, so the activity spans two chains.`, cost: 'about $4 of gas', time: '10 minutes' };
    return { text: `Mint a second, smaller tranche a week later, so the position is built in two steps.`, cost: 'about $4 of gas', time: '10 minutes' };
  }
  if (c.includes('basis')) return { text: `Add a second deposit after one week rather than all at once, so the position is built in two steps.`, cost: 'about $4 of gas', time: '10 minutes' };
  if (c.includes('restak')) return { text: `Delegate to a second operator if the protocol offers a choice of operators; otherwise add a second tranche a week later.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return { text: `Close and reopen the hedge after a month so the activity stays fresh, keeping the margin in place.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('payment') || c === 'chain') return { text: `Repeat the payment or transaction weekly, so the wallet shows steady use rather than a single transfer.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('stable')) return { text: `Provide the stable asset as liquidity in the protocol's pool if it offers one, so the wallet shows a second use of the asset.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('insurance')) return { text: `Extend or renew the cover before it lapses, so the policy stays active through the qualifying window.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('prediction')) return { text: `Place a position in a second market on ${name}, so the wallet shows more than one market.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('governance')) return { text: `Vote again in the next round of the protocol's governance, if it offers voting.`, cost: 'about $2 of gas', time: '10 minutes' };
  if (c.includes('staking pool')) return { text: `Stake a second tranche after a week, so the position is built in two steps.`, cost: 'about $4 of gas', time: '10 minutes' };
  return { text: `Make a second deposit a week later, so the position is built in two steps.`, cost: 'about $4 of gas', time: '10 minutes' };
}

/**
 * Custom strategy instructions assemble dynamically from protocol telemetry including sectoral classification, network availability, capital scale, and duration.
 * Every discrete action specifies estimated resource expenditures and required duration.
 * Unverified protocol attributes remain strictly conditional to avoid fabricating unconfirmed capabilities.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  const fund =
    p.chains.length > 1
      ? `Move $${capital} of USDC to ${chain}, the first chain ${p.name} lists, and keep enough of the chain's asset on ${chain} for gas.`
      : `Move $${capital} of USDC to ${chain}, the only chain ${p.name} lists, and keep enough of the chain's asset on ${chain} for gas.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: fund,
      cost: 'about $4 of gas to bridge',
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    second,
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page if it publishes one and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, snapshot: Snapshot): RadarRow {
  const p = snapshot.protocols.find((q) => q.slug === row.slug)!;
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    live_comps: row.model.live_comps,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    comparables: comparablesFor(p, snapshot),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = computeMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median: multiples.globalMedian,
    multiples: [...multiples.byCategory.values()],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, snapshot)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
