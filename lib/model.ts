// Launch Radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols by what a launch would be worth if the
// protocol's record stayed as it is. The value is a comparables multiple, the
// way a market prices a business off its listed peers: each category's
// multiple is the median market-cap-to-TVL ratio of the tokenized protocols
// in that same category, read from this very snapshot. A category with fewer
// than three listed peers falls back to the all-protocol median. No protocol
// name is ever special-cased: the same function scores every row, and the
// dashboard shows the multiple and the peer count behind each row.
//
//   multiple   = median(mcap_usd / tvl_usd) over listed peers in the category
//                (n >= 3), else the all-protocol median; clamped to [0.05, 1.00]
//   growth     = clamp(change_7d, -40, +80) per cent
//   growthMult = 1 + growth / 100 * 0.6
//   maturity   = 0.70 + 0.30 * min(age_days, 1095) / 1095
//                (age unknown: 180 days; older with no token scores higher)
//   breadth    = 1 + 0.02 * min(chains - 1, 4)
//   implied    = max(1, round(tvl_usd * multiple * growthMult * maturity * breadth))
//
// The board covers the whole watchlist (the floor, never a ceiling) plus every
// other rankable pre-token protocol below the floor: rankable means it records
// no token, is not an exchange, and its name carries no version marker. The
// live-token protocols are kept apart in their own view, shown at their
// market cap, never mixed into the ranking.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** Peers needed in a category before its own median is used. */
  min_category_peers: number;
  /** The multiple's floor and ceiling. */
  multiple_floor: number;
  multiple_cap: number;
  /** The seven-day growth clamp, in per cent. */
  growth_floor: number;
  growth_cap: number;
  /** How much one week's growth moves the value. */
  growth_weight: number;
  /** The maturity curve's floor, range and day cap. */
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  /** The age assumed when listed_at is missing. */
  unknown_age_days: number;
  /** The per-extra-chain breadth step, and how many extra chains count. */
  breadth_step: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  min_category_peers: 3,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  growth_floor: -40,
  growth_cap: 80,
  growth_weight: 0.6,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 180,
  breadth_step: 0.02,
  breadth_max_chains: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2-comps';

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
    multiple_source: 'category' | 'all';
    multiple_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
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
  multiple_source: 'category' | 'all';
  multiple_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparables: how many listed peers, and their median multiple. */
export interface CompRow {
  category: string;
  peers: number;
  median_multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the comps, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  global_peers: number;
  comps: CompRow[];
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

/** The median of a non-empty sorted list of numbers. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The comparables table: per-category median mcap/TVL, and the all-protocol median. */
export interface CompsTable {
  byCategory: Map<string, { peers: number; median: number }>;
  globalMedian: number;
  globalPeers: number;
}

export function buildComps(snapshot: Snapshot, model: ModelConstants): CompsTable {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.gecko_id === null && p.symbol === null) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  all.sort((a, b) => a - b);
  const globalMedian = all.length > 0 ? medianOf(all) : 0.2;
  const table = new Map<string, { peers: number; median: number }>();
  for (const [key, ratios] of byCategory) {
    ratios.sort((a, b) => a - b);
    table.set(key, { peers: ratios.length, median: medianOf(ratios) });
  }
  return { byCategory: table, globalMedian, globalPeers: all.length };
}

/** The multiple one protocol gets: its category's median, or the all-protocol median. */
export function multipleFor(
  protocol: SnapshotProtocol,
  comps: CompsTable,
  model: ModelConstants,
): { multiple: number; source: 'category' | 'all'; peers: number } {
  const entry = comps.byCategory.get(protocol.category ?? 'Other');
  const raw = entry !== undefined && entry.peers >= model.min_category_peers ? entry.median : comps.globalMedian;
  const source: 'category' | 'all' = entry !== undefined && entry.peers >= model.min_category_peers ? 'category' : 'all';
  const peers = source === 'category' ? entry!.peers : comps.globalPeers;
  const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
  return { multiple, source, peers };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: CompsTable,
  model: ModelConstants,
): {
  implied: number;
  multiple: number;
  multipleSource: 'category' | 'all';
  multiplePeers: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, source, peers } = multipleFor(protocol, comps, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_max_chains));
  const breadthMult = 1 + extraChains * model.breadth_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, multiple, multipleSource: source, multiplePeers: peers, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = buildComps(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol below the floor.
  // No cap by count: the snapshot's whole pre-token universe below the floor.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, comps, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      multiple: round4(s.v.multiple),
      multiple_source: s.v.multipleSource,
      multiple_peers: s.v.multiplePeers,
      growth_pct: round2(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
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

/** What one transaction costs on a chain, in whole dollars, from the chain's own fee level. */
function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'solana') return 1;
  if (c === 'bitcoin') return 2;
  if (c === 'tron') return 1;
  if (c === 'polygon') return 1;
  if (c === 'binance') return 1;
  if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'zksync era' || c === 'linea' || c === 'scroll' || c === 'blast' || c === 'mode' || c === 'mantle' || c === 'zircuit' || c === 'world chain' || c === 'abstract') return 1;
  return 2;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The pair of actions a category farms with: the main position, then the second touch. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(25, Math.round(capital / 4));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} as collateral and borrow a small amount against it, so the position touches both sides of the book.`,
      `Repay the borrow in full and supply $${small} again the same week, so the position records a complete borrow cycle.`,
    ];
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('amm')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position open.`,
      `Swap $${small} through ${name} on ${chain} once a week, routing through the pool you already fund.`,
    ];
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged farm')) {
    return [
      `Deposit $${capital} into ${name}'s top vault on ${chain} and keep the shares.`,
      `Claim the vault's yield once a week and restake it into the same vault.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`,
      `Reinvest the yield the asset pays into the same position once a month.`,
    ];
  }
  if (c.includes('risk') || c.includes('curator') || c.includes('allocator') || c.includes('capital allocator')) {
    return [
      `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`,
      `Move $${small} between two of ${name}'s vaults, so activity registers in more than one market.`,
    ];
  }
  if (c.includes('basis')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`,
      `Top the vault up by $${small} after a funding round, so the position grows through the cycle.`,
    ];
  }
  if (c.includes('restak') || c.includes('staking pool') || c.includes('liquid staking')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`,
      `Restake the receipt once more through ${name} to compound the position.`,
    ];
  }
  if (c.includes('bridge')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.`,
      `Bridge $${small} back the other way a week later, so both directions of the route are used.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`,
      `Close the hedge and open a fresh one each week, keeping the margin on the platform.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} and place one market position on ${name}.`,
      `Settle the position and place a second one in a different market the next week.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Lock $${capital} of collateral in ${name} on ${chain} and mint its stable asset.`,
      `Repay a small part of the mint and mint it again, so the position cycles.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`,
      `Renew the cover before it lapses and add $${small} of cover on the same policy.`,
    ];
  }
  if (c.includes('index')) {
    return [
      `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`,
      `Rebalance into the index with $${small} once a month.`,
    ];
  }
  if (c.includes('privacy')) {
    return [
      `Deposit $${capital} through ${name}'s shielded pool on ${chain} and keep the note.`,
      `Withdraw and redeposit $${small} each month, so the pool sees repeat use.`,
    ];
  }
  if (c.includes('chain')) {
    return [
      `Bridge $${capital} of USDC onto ${chain} and deposit it in the chain's largest lending market.`,
      `Use ${name}'s native swap once a week for $${small}, so the chain sees repeat activity.`,
    ];
  }
  if (c.includes('cedefi')) {
    return [
      `Deposit $${capital} into ${name}'s managed vault on ${chain} and keep the shares.`,
      `Claim the vault's weekly distribution and redeposit it the same day.`,
    ];
  }
  if (c.includes('anchor') || c.includes('btc')) {
    return [
      `Deposit $${capital} of BTC through ${name} on ${chain} and keep the receipt.`,
      `Move the receipt between two of ${name}'s vaults to register activity in more than one.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Make a second deposit of $${small} a week later, so the position shows repeat use.`,
  ];
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasUsd(chain);
  const [primary, secondary] = actionsFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `no cost to create, about $${gas} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: primary,
      cost: `$${capital} of capital and about $${gas} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: secondary,
      cost: `about $${gas} of gas on ${chain}`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gas} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
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
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
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
    multiple_peers: row.model.multiple_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comps = buildComps(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const compRows: CompRow[] = [...comps.byCategory.entries()]
    .filter(([, v]) => v.peers >= model.min_category_peers)
    .map(([category, v]) => ({ category, peers: v.peers, median_multiple: round4(v.median) }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(comps.globalMedian),
    global_peers: comps.globalPeers,
    comps: compRows,
    rows: board.map(radarRow),
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
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
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
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value over the cap`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
