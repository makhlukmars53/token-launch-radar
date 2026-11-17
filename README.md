# Launch Radar — token-launch-radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/makhlukmars53/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/makhlukmars53/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty: it reads a sealed
snapshot of every protocol DefiLlama tracks, ranks the ones that record no
token by what a launch would be worth, and hands each one a farm plan.

## The model (radar-2-comps)

Each protocol's implied value is priced off its listed peers, the way a
market prices a business off comparables — never off a hand-picked list:

```
implied = round( tvl_usd
  x multiple
  x (1 + clamp(change_7d, -40, +80) / 100 x 0.6)
  x (0.70 + 0.30 x min(age_days, 1095) / 1095)
  x (1 + 0.02 x min(chains - 1, 4)) )
```

- **multiple**: the median market-cap-to-TVL ratio of the tokenized
  protocols in the same category, read from the snapshot itself. A category
  with fewer than three listed peers falls back to the all-protocol median
  (0.21x over 128 listed protocols). The multiple is clamped to 0.05x–1.00x.
- **growth**: the snapshot's seven-day TVL move, clamped so one week's spike
  (the snapshot's own range runs to +4,448%) cannot decide a valuation.
- **maturity**: the time since the protocol was first listed — the best
  record of how long it has run with no token. Older with no token scores
  higher; an unlisted age counts as 180 days.
- **breadth**: a small step per extra chain, up to four, for wider distribution.

The board covers the whole 40-protocol watchlist plus every other rankable
pre-token protocol below the $50M floor — 226 rows. Protocols whose token
already trades are set aside in their own view at their market cap, never
mixed into the ranking. The dashboard says a protocol "records no token",
never that it has none: DefiLlama's record is not proof.

## The dashboard

A static page, no network, no framework: a sortable, filterable board
(search, category, chain), a detail view for every protocol with the model's
own inputs and a plain-language note of how it scored, a seven-step farm
plan with what each step costs and how long it takes, and the comparables
table the multiples are priced from.

## Run it

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or later, standard library only. The program reads
`/input/snapshot.json` (or `--input`), writes `/output/board.json`,
`/output/data.js`, copies `dashboard/` and `screenshots/` to `/output`, and
writes `/output/dossier.json` with the vendored make.fun library. It runs
twice and both runs write the same bytes.

## License

MIT. See LICENSE.
