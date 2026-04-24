# Steam Booster Slow Unpacker

Chrome extension for opening Steam booster packs one by one with careful pacing, randomized delays, and queue controls that reduce unnecessary request spam.

## Overview

This project helps open Steam booster packs from a logged-in Steam Community inventory in a slower, safer, and more controllable way.

Main capabilities:

- one-by-one booster opening
- configurable random delay range
- background-managed queue timing
- pause, resume, and stop controls
- lightweight ETA display

## Features

- Works only on `steamcommunity.com`
- Uses your existing logged-in browser session
- Scans your Steam inventory and builds a queue of booster packs
- Reads inventory in pages up to `2000` items with small delays between page requests
- Opens boosters one by one through Steam Community
- Uses a configurable random delay range between openings
- Keeps queue timing in the extension background so it is less dependent on the tab being active
- Supports `Pause`, `Resume`, and `Stop`
- Stops on Steam-side errors instead of retry-spamming
- Keeps permissions minimal

## Install In Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the project folder

## How To Use

1. Open your own Steam inventory page in Chrome
2. Open the extension popup or use the floating panel on the page
3. Leave the default delay range at `15-22` seconds or choose your own values
4. Click `Start`
5. Use `Pause`, `Resume`, or `Stop` as needed
6. Keep the Steam tab open while the queue is running

## Privacy And Safety

- The extension does not ask for your Steam login, password, or API key
- It relies only on your already logged-in Chrome session
- It is intended for your own Steam Community inventory
- It deliberately spaces requests out and stops on errors to reduce unnecessary load
- It stores only local extension settings such as delay configuration

## Permissions

Current permissions are intentionally limited:

- `storage`
- host access for `https://steamcommunity.com/*`

## Project Structure

- `manifest.json`: Chrome extension manifest
- `background.js`: queue and timing logic
- `content.js`: Steam page integration and floating panel
- `content.css`: floating panel styling
- `popup.html`, `popup.js`, `popup.css`: popup UI
- `LICENSE`: project license
- `SECURITY.md`: security notes
- `CONTRIBUTING.md`: contribution notes
- `GITHUB_PUBLISHING.md`: website upload guide

## Publishing On GitHub

If you are new to GitHub, follow the guide in [GITHUB_PUBLISHING.md](GITHUB_PUBLISHING.md).

Suggested repository name:

`steam-booster-slow-unpacker`

Suggested repository description:

`Chrome extension for opening Steam booster packs one by one with randomized delays, pause/resume controls, and safer queue pacing.`

## Notes

- This repository is source code only
- It is suitable for GitHub publishing
- If you later want broader public distribution, the next step after GitHub would usually be packaging for the Chrome Web Store

## License

This project is released under the [MIT License](LICENSE).
