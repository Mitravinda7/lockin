# 🔒 LockIn

A Chrome extension that uses AI to block distracting content during study sessions.

Unlike other focus apps that blindly block entire websites, LockIn understands content — a Python tutorial on YouTube is allowed but a movie trailer is blocked.

## Features

- 🤖 AI content classifier — checks every tab in real time
- 🚫 Blocks entertainment on YouTube, streaming sites, any website
- ✅ Allows study content on any platform
- 🎵 Focus music — Lo-fi, Nature, Deep Focus — plays even when popup is closed
- ⏱️ Emergency breaks with countdown timer
- 📊 Weekly stats with bar chart
- ✅ Smart whitelist with AI warning
- 🗓️ Scheduled sessions — recurring weekly or one-time dates
- 🔑 Zero setup for users — no API key needed

## How it works

When you start a study session, LockIn monitors every tab you open. It sends the page title and URL to an AI model which decides if the content is educational or entertainment. If it's entertainment, a red overlay appears and the tab closes automatically.

## Installation

Since this is not on the Chrome Web Store yet, install it manually:

1. Download this repository as ZIP — click the green **Code** button → **Download ZIP**
2. Extract the ZIP folder
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** in the top right
5. Click **Load unpacked**
6. Select the extracted `lockin-main` folder
7. Pin the extension from the toolbar

## Screenshots

### Main popup
![LockIn popup](https://raw.githubusercontent.com/Mitravinda7/lockin/main/screenshots/lockin.png)

### Weekly stats
![Stats page](https://raw.githubusercontent.com/Mitravinda7/lockin/main/screenshots/stats.png)

### Schedule
![Schedule page](https://raw.githubusercontent.com/Mitravinda7/lockin/main/screenshots/schedule.png)

### Whitelist
![Whitelist page](https://raw.githubusercontent.com/Mitravinda7/lockin/main/screenshots/whitelist.png)

### Distraction blocked
![Block alert](https://raw.githubusercontent.com/Mitravinda7/lockin/main/screenshots/breaktime.png)

## Tech stack

- Chrome Extension Manifest V3
- Gemini AI via Cloudflare Workers
- Web Audio API for focus music
- Chrome Offscreen Documents for persistent audio

## Built by

Made by Mitravinda as a productivity tool.
