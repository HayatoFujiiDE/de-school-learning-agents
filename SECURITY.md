# Security

This repository is public. It contains application code, implementation contracts and
design notes only. Nothing here is a production deployment.

## What is never committed

- API keys, webhook signing keys, Cloudflare account IDs, `.dev.vars`, `.env`
- Private design material under `reference/` and session state under `.claude/`
- Any data about real children, families, supporters or staff

All people, names, schedules and conversations that appear in the mock application
(`app-v3/`) and in sample screenshots (`screens/`) are fictional.

## Secrets at runtime

The content factory (`factory/`) reads secrets only from Cloudflare Worker secrets
(`wrangler secret put ...`) or, for local development, from a git-ignored `.dev.vars`.
Secret names are documented in `factory/worker/.dev.vars.example`; values are never
written to the repository, to logs, or to agent prompts.

## Reporting

If you find a leaked credential or personal data in this repository, open a GitHub
issue with the file path only (do not paste the value) or contact the repository owner
through GitHub. Leaked credentials will be rotated first and purged from history second.

## Automated checks

- `gitleaks detect --no-git --config .gitleaks.toml` is run before every push
- GitHub secret scanning and push protection are enabled on this repository
