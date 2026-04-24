# GitHub Publishing Guide

This guide is written for uploading the project through the GitHub website, without command line tools.

## Suggested Repository Name

`steam-booster-slow-unpacker`

## Suggested Repository Description

Chrome extension for opening Steam booster packs one by one with randomized delays, pause/resume controls, and safer queue pacing.

## Visibility

Recommended:

- `Public` if you want to share it with others
- `Private` if you only want backup/storage for now

## Before Uploading

Check that this folder contains:

- `manifest.json`
- `background.js`
- `content.js`
- `content.css`
- `popup.html`
- `popup.js`
- `popup.css`
- `README.md`
- `LICENSE`
- `.gitignore`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `GITHUB_PUBLISHING.md`

## Upload Through The GitHub Website

1. Create a GitHub account if you do not already have one
2. Click `New repository`
3. Repository name: `steam-booster-slow-unpacker`
4. Add the repository description from above
5. Choose `Public` or `Private`
6. Do not initialize with a README, because this project already has one
7. Create the repository
8. On the new repository page, choose `uploading an existing file`
9. Drag all project files from this folder into the browser
10. Commit the upload

## Recommended GitHub Settings

After upload, it is useful to set:

- About description
- topics such as `chrome-extension`, `steam`, `steamcommunity`
- repository visibility according to your goal

## Suggested First Release Text

Title:

`v1.2.1`

Notes:

- Added randomized queue pacing
- Added pause, resume, and stop controls
- Added background-managed queue timing
- Added ETA display
- Prepared repository docs for public sharing

## Safety Check Before Making It Public

Verify that:

- there are no usernames, profile IDs, cookies, or tokens hardcoded in files
- local paths are not mentioned in docs
- no personal screenshots with sensitive data are included
- permissions in `manifest.json` are still minimal

## Optional Next Step

After publishing the source on GitHub, you can later:

1. add screenshots to the repository
2. add a demo GIF
3. prepare a packaged release zip
4. publish to the Chrome Web Store
