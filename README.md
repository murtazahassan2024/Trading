<div align="center">

# SignalOS

### A live crypto futures trading dashboard for scanning, paper trading, backtesting, and disciplined market review.

![Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript-f7df1e?style=for-the-badge&logo=javascript&logoColor=111)
![Chart.js](https://img.shields.io/badge/Charts-Chart.js-ff6384?style=for-the-badge&logo=chartdotjs&logoColor=white)
![Binance Futures](https://img.shields.io/badge/Data-Binance%20Futures-f3ba2f?style=for-the-badge&logo=binance&logoColor=111)
![Supabase](https://img.shields.io/badge/Persistence-Supabase-3ecf8e?style=for-the-badge&logo=supabase&logoColor=white)

**Live market data. Strategy consensus. Risk-first paper trading. Local backtests.**

</div>

---

## Overview

SignalOS is a browser-based trading command center built around Binance Futures market data. It combines live candles, order book snapshots, funding/open-interest context, multi-symbol scanning, signal scoring, simulated trade management, and a local backtesting engine into one focused dashboard.

The project is intentionally conservative around real execution: it supports simulated paper trades in the app and an Alpaca paper-only broker adapter, while keeping live-money readiness checks explicit and visible.

> Educational tooling only. Nothing in this project is financial advice, and no strategy output should be treated as a guarantee of profit.

## Highlights

| Area | What It Does |
| --- | --- |
| **Live Futures Dashboard** | Streams Binance Futures candles, mini ticker, and depth data for the active symbol. |
| **Signal Engine** | Blends trend, momentum, RSI, MACD, ATR, ADX, candles, funding, and multi-timeframe context. |
| **Market Scanner** | Ranks a curated set of major USDT pairs for long/short watch opportunities. |
| **Paper Trading** | Opens, tracks, closes, and journals simulated trades with P/L, R multiples, risk, stops, and targets. |
| **Backtesting** | Runs out-of-sample local tests for the current symbol or scanner universe with slippage and fee controls. |
| **AI Market Coach** | Sends scanner context to a server-side AI provider and returns a concise market brief. |
| **Supabase Persistence** | Optionally stores dashboard state and alerts across sessions. |
| **Alpaca Paper Broker** | Syncs account/positions and previews/submits paper-only orders through the local server. |

## Interface

SignalOS is designed as an operating surface rather than a landing page:

- **Topline metrics** for symbol, last price, volume, funding, open interest, and 24h movement.
- **Chart stack** with price, volume, RSI, and MACD panels.
- **Consensus signal panel** with entry, stop, target, and reasoning.
- **Risk dashboard** for win rate, total R, open risk, and paper-trading limits.
- **Scanner table** for multi-symbol opportunity discovery.
- **Backtest and readiness panels** for validating ideas before simulated execution.

## Quickstart

```bash
git clone <your-repo-url>
cd Trading
cp .env.example .env
node server.js
```

Then open:

```text
http://localhost:5173
```

No build step is required. The frontend is plain HTML, CSS, and JavaScript served by the local Node server.

## Environment

SignalOS can run without keys for the core Binance Futures dashboard and scanner. Add keys only for optional server-side features.

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=replace_me
OPENROUTER_MODEL=openrouter/auto

ALPACA_PAPER_ONLY=true
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_API_KEY_ID=replace_me
ALPACA_API_SECRET_KEY=replace_me
```

Supported AI provider paths in `server.js` include OpenRouter, OpenAI, and DeepSeek. The `.env.example` file also documents alternate model variables.

## Supabase Setup

Supabase is optional. To enable persistence:

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
3. Paste your project URL and anon key into the dashboard's Supabase panel.
4. Click **Connect**, then **Save now**.

The schema stores lightweight app state and alert records by device ID.

## Project Structure

```text
.
|-- index.html                 # Main SignalOS dashboard
|-- signalos.html              # Redirect to index.html
|-- server.js                  # Local static server and API proxy layer
|-- assets/
|   |-- css/styles.css         # Dashboard styling and themes
|   `-- js/
|       |-- app.js             # App lifecycle and orchestration
|       |-- exchange.js        # Binance Futures data provider
|       |-- indicators.js      # Technical indicator calculations
|       |-- scanner.js         # Multi-symbol scanner and auto-scouting
|       |-- paper.js           # Simulated trade lifecycle
|       |-- backtest.js        # Local backtesting engine
|       |-- broker.js          # Alpaca paper broker UI flow
|       |-- ai.js              # AI market brief client integration
|       `-- persistence.js     # Supabase/local state persistence
|-- api/                       # Vercel-style API route equivalents
|-- supabase/schema.sql        # Optional persistence schema
`-- vercel.json                # Deployment routing config
```

## Local API Routes

The local server exposes:

| Route | Purpose |
| --- | --- |
| `POST /api/ai/market-brief` | Server-side AI market coach request. |
| `GET /api/crypto-news` | Crypto news feed with RSS fallback. |
| `/api/binance/*` | Binance Futures REST proxy with Coinbase candle fallback. |
| `/api/alpaca/*` | Alpaca paper account, assets, orders, and kill-switch helpers. |

## Trading Safety Model

SignalOS is built around practice and validation:

- Paper trades are simulated unless you explicitly use the Alpaca paper adapter.
- Alpaca defaults to `https://paper-api.alpaca.markets`.
- `ALPACA_PAPER_ONLY=true` blocks accidental live endpoint use.
- The live-readiness panel keeps execution status visible.
- Backtests include slippage, fee, drawdown, expectancy, Sharpe, and Sortino views.

## Deployment Notes

This project includes `vercel.json` and API route files for deployment-friendly routing. For local development, `server.js` is the simplest path because it serves static files, loads `.env`, proxies Binance requests, and keeps AI/broker keys server-side.

## Roadmap Ideas

- Add screenshot assets for the README hero.
- Export paper ledger results to CSV.
- Add strategy preset switching.
- Add replay mode for historical candles.
- Add richer Supabase trade journaling.
- Add automated test coverage for indicator and backtest calculations.

---

<div align="center">

**SignalOS** keeps the trader's loop tight: scan, validate, size, simulate, review.

</div>
