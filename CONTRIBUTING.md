# Contributing to HELIX

Thank you for your interest in contributing to HELIX!

## Code of Conduct

Please be respectful, constructive, and collaborative in all communications.

## Development Workflow

1. **Fork & Branch:** Create a branch for your fix or feature from `main`.
2. **Environment:** Make sure you have Node.js 20+, Python 3.11+, and npm installed.
3. **Run Checks:**
   ```powershell
   npm run lint:encoding
   npm run models:check
   npm test
   npm run test:agent
   ```
4. **Pull Requests:** Ensure your PR clearly describes:
   - What changed and why.
   - Evidence of passing tests and verified behaviors.
   - Any documentation updates that accompany the code changes.

## Security Disclosures

If you discover a security vulnerability in HELIX, please report it privately to the maintainers rather than creating a public issue.
