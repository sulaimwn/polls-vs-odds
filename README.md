# Polls vs. Odds

**https://pollsvsodds.com** · Polls vs. the prediction markets, for every race in 2026. What voters say, next to what bettors bet. Polls vs. Odds combines every public poll with Polymarket and Kalshi into one forecast for the House, the Senate and every district, and shows where the two disagree.

**Hosting:** this repo is private, so the site is shared as a Claude Artifact (`npm run build:artifact` packages it). To host it on GitHub Pages instead, make the repo public (or use GitHub Pro), copy `deploy/github-pages-workflow.yml` to `.github/workflows/refresh.yml`, and set Pages to deploy from GitHub Actions.

## What's on the page

Written for someone who doesn't follow polling closely:

- **The answer first.** One plain sentence and one big number per chamber ("Democrats are very likely to win the House, 94%"), plus a seat bar showing how close each side is to a majority.
- **Search** for any candidate, district ("TX-23", "Texas 23"), state or region ("Midwest", "Sun Belt", "Swing states"). The map flies to it and opens the race.
- **A real district map** of all 435 House seats with zoom (buttons, Ctrl+scroll, pinch, drag), plus a Senate map by state. Tap any district or state for candidate photos, who's favored, the polling average and every poll, each labeled by who paid for it and how reliable the pollster is.
- **Make your own prediction.** Tap states to color them blue or red and see who would win the majority.
- **The closest races**, **how the odds have changed**, and a short **where these numbers come from** section with the arithmetic. Pollster ratings and every recent poll are tucked into "read more" sections.

## How the data stays fresh

| Source | What | Refresh |
|---|---|---|
| [VoteHub](https://votehub.com/polls/) | Generic ballot, Senate and House polls | each refresh run |
| [Kalshi](https://kalshi.com) | Chamber control, Senate races, seat counts | each refresh run |
| [Polymarket](https://polymarket.com) | Chamber control, all 35 Senate races, all 435 districts | each refresh run, plus live in the browser on hosted copies |
| [538 pollster ratings](https://github.com/fivethirtyeight/data/tree/master/pollster-ratings) | Ratings and 2016–2024 accuracy | static (final 2024 edition) |
| [congress-legislators](https://github.com/unitedstates/congress-legislators) | Incumbents | every run |
| Wikipedia / Congress Bioguide | Candidate photos | cached in `img/c/` |
| Census TIGERweb (120th Congress), FL Senate, LA Legislature, TN state GIS, AL 2023 plan | 2026 district lines | `npm run districts` when maps change |

`deploy/github-pages-workflow.yml` is a ready-made GitHub Actions workflow that runs `scripts/update.mjs` every 30 minutes and deploys to GitHub Pages.

## Run it locally

```bash
npm install
npm run update      # pull polls + markets, run the model, write data/*.json and og.png
npm run photos      # fetch photos for any new candidates
npm run serve       # http://localhost:8080
npm run build:artifact  # self-contained copy in dist-artifact/ (photos inlined) for sharing as a Claude Artifact
```

## Files

- `index.html`, `styles.css`, `app.js`: the site (no framework)
- `scripts/build-site.mjs`: builds the deployable site, a page for every race (`/senate/texas/`, `/house/pa-08/`, `/state/ohio/`) with its own preview image, and the sitemap
- `worker/`: Cloudflare timer that triggers the refresh at the top of every hour
- `scripts/update.mjs`: data pipeline and polling model
- `scripts/photos.mjs`: candidate photos
- `scripts/geo.mjs`: state map; `scripts/districts-geo.mjs`: 2026 House district map (sources listed at the top of the file)
- `scripts/pollster-history.mjs`: pollster track records from 538's archive
- `config/senate.json`: the 35 Senate races, candidates and 2024 presidential margins
- `config/pollster-aliases.json`: manual fixes for pollster-name matching

Not affiliated with VoteHub, Polymarket, Kalshi or 538. Market prices are not financial advice.
