# Contributing

Thanks for your interest in improving this project.

## Scope

This extension is intentionally small and focused:

- Steam Community inventory only
- logged-in browser session only
- paced queue processing
- minimal permissions

Please keep changes aligned with that goal.

## Good Contributions

- bug fixes
- safer queue behavior
- clearer UI feedback
- better documentation
- performance improvements that reduce unnecessary requests

## Please Avoid

- adding unrelated tracking
- adding permissions that are not clearly required
- changing the extension to collect credentials or account data
- aggressive retry loops or request spam

## Development Notes

- Reload the extension in `chrome://extensions` after local changes
- Test on your own Steam Community inventory page
- Keep delays conservative and avoid high-frequency polling

## Pull Requests

When opening a pull request, include:

- what changed
- why it changed
- how it was tested
- whether permissions or request behavior changed
