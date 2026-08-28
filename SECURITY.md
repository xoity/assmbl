# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities.

Report security concerns privately by contacting the project owner directly. Include:

- A clear description of the issue
- Steps to reproduce, if available
- The affected route, file, dependency, or deployment setting
- Any impact you believe the issue may have

Do not include real production secrets, API keys, database URLs, session cookies, or Turnstile secrets in reports.

## Supported Version

This project currently supports the latest code on the main branch.

## Secret Handling

The following values must stay out of GitHub and local commits:

- `OPENCODE_GO_API_KEY`
- `DATABASE_URL`
- `TURNSTILE_SECRET`
- Production `.env` files
- Coolify service credentials

Use `.env.example` only for placeholder values.
