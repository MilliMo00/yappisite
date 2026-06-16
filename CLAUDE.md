# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YAPPI AGENCY is a static multi-page website for a Design & AI agency serving arbitrage teams and digital businesses. The site is pure HTML/CSS/JS — no build system, no package manager, no framework.

## Running the Backend

The only runnable component is the Telegram admin bot + analytics ingest server:

```bash
node yappi-bot.js
```

This starts two things simultaneously:
- An HTTP server on port **3001** (`/an` endpoint) that receives analytics events from the frontend
- A Telegram bot that lets the admin (ADMIN_ID) view site analytics and manage user feedback via `/start`, inline buttons, and callback queries

Data is persisted to two local JSON files: `feedback.json` (complaints/wishes) and `analytics.json` (pageviews, sessions, clicks).

## Architecture

### Pages

Each HTML file is self-contained: all CSS lives in an inline `<style>` block inside the file. The shared `mobile.css` is loaded as an external stylesheet after the inline styles on every page — it handles responsive breakpoints and hamburger menu. There is no separate desktop stylesheet file.

Pages: `index.html` (main landing), `ai-production.html`, `automation.html`, `bots-rental.html`, `cases.html`, `creatives.html`, `tables.html`, `web-dev.html`.

### i18n System (`i18n.js`)

All user-visible text on every page uses a `data-i18n="key"` attribute. `i18n.js` runs on DOMContentLoaded, reads a `TRANS` object with `ru` and `en` sub-objects, and sets `innerHTML` on each element. Language preference is stored in `localStorage`. The `window.t(key)` helper is available for JS-generated strings.

To add or change copy: update the matching key in **both** `ru` and `en` sections of `TRANS` in `i18n.js`, then make sure the HTML element has the corresponding `data-i18n` attribute.

### Analytics (`analytics.js`)

Included on every page. Tracks pageviews, session duration, and clicks on Telegram links, partner links, and service page links. On page unload it POSTs a batch of events to `http://<hostname>:3001/an` via `navigator.sendBeacon`. The analytics server in `yappi-bot.js` aggregates events into `analytics.json`.

### Telegram Bot (`yappi-bot.js`)

Uses raw HTTPS calls to the Telegram Bot API (no SDK). Polls via long-polling. Only the configured `ADMIN_ID` can interact with it. Commands available to the admin:
- `/start` — dashboard with feedback counts and today's analytics
- Inline button navigation to complaints, wishes, full analytics, today/week breakdowns
- Callback buttons on each feedback item to mark it `done` or `wip`

### CSS Variables

All pages share the same design token names (defined per-page in each `<style>` block):
- `--dark`, `--dark2`, `--purple`, `--cyan`, `--yellow`, `--orange`, `--white`, `--px`
- Helper classes: `.px-shadow`, `.px-shadow-cyan`, `.px-shadow-yellow`, `.vt` (VT323 font), `.p8` (Press Start 2P font)

## Key Conventions

- All new copy must be added to `i18n.js` (both `ru` and `en`) and referenced via `data-i18n` — never hardcode text directly in HTML.
- CSS changes that apply across all pages go in `mobile.css`; page-specific styles go in that page's inline `<style>` block.
- `analytics.js` and `mobile.css` are loaded on every HTML page — keep them lean.
- `fix_i18n_v2.py` is a one-off migration script; `do_index_writer.py` is auto-generated and empty.
