# Midterm Control Room

A live forecast for the 2026 U.S. House and Senate. It combines every public poll with prices from Polymarket and Kalshi into one number per chamber, then lets you click into any state, Senate race or House district.

**Hosting:** this repo is private, so the site is shared as a Claude Artifact (`npm run build:artifact` packages it). To host it on GitHub Pages instead, make the repo public (or use GitHub Pro), copy `deploy/github-pages-workflow.yml` to `.github/workflows/refresh.yml`, and set Pages to deploy from GitHub Actions.

## What's on the page

Written for someone who doesn't follow polling closely:

- **The answer first.** One plain sentence and one big number per chamber ("Democrats are very likely to win the House, 94%"), plus a seat bar showing how close each side is to a majority.
- **The map.** Tap a state, or pick it from a list, to see its Senate race and House seats: candidate photos, who's favored, the polling average and every poll. Each poll is labeled by who paid for it and how reliable the pollster is.
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

- `index.html`, `styles.css`, `app.js`: the site (no build step, no framework)
- `scripts/update.mjs`: data pipeline and polling model
- `scripts/photos.mjs`: candidate photos
- `scripts/geo.mjs`, `scripts/hexmap.mjs`: state map and House hex cartogram
- `scripts/pollster-history.mjs`: pollster track records from 538's archive
- `config/senate.json`: the 35 Senate races, candidates and 2024 presidential margins
- `config/pollster-aliases.json`: manual fixes for pollster-name matching

Not affiliated with VoteHub, Polymarket, Kalshi or 538. Market prices are not financial advice.
