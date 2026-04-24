# Security Policy

## Supported Scope

This project is a small Chrome extension intended for use on `steamcommunity.com`.

It is designed to:

- use an already logged-in browser session
- avoid requesting Steam credentials
- avoid using an API key
- keep permissions minimal

## What The Project Does Not Store

The extension does not intentionally store:

- Steam login credentials
- Steam password
- Steam Guard codes
- API keys
- payment data

It only stores local extension settings such as configured delay values.

## Reporting A Security Issue

If you discover a security problem, do not post sensitive details publicly first.

Instead, contact the maintainer privately if possible, or use a private reporting channel where the project is hosted.

When reporting, include:

- what the issue is
- how it can be reproduced
- which file or feature is affected
- whether any sensitive data could be exposed

## Safe Publishing Guidance

Before publishing forks or changes:

- review permissions in `manifest.json`
- avoid adding telemetry unless clearly documented
- avoid embedding personal account information
- avoid hardcoding profile IDs, tokens, cookies, or local machine paths
