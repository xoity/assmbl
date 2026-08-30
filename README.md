# assmbl

assmbl is a wardrobe and outfit planning app built with React, Vite, Express, and Postgres. It lets users create an account, save wardrobe items, generate outfit ideas, upload clothing images, and give feedback so recommendations can improve over time.

## Stack

- React 19 + TypeScript + Vite frontend
- Express 5 API server
- Postgres database via `pg`
- Sharp image processing
- Helmet, CORS, compression, rate limiting, and secure cookies
- Cloudflare Turnstile on signup and login
- Coolify/Nixpacks production deployment

## Requirements

- Node.js 22 or newer
- npm
- Postgres for production-style local testing
- OpenCode API key for AI outfit generation
- Cloudflare Turnstile site key and secret for auth protection


## Scripts

```bash
npm run dev      # Start Vite and Express for development
npm run build    # Type-check and build the frontend
npm run preview  # Preview the built frontend with Vite
npm start        # Start the production Express server
npm run server   # Start only the Express server
```

The `npm run install` script is intentionally a no-op for Coolify compatibility when a platform tries to run it after `npm ci`.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port for the Express server |
| `NODE_ENV` | Use `production` in Coolify |
| `DATABASE_URL` | Postgres connection string |
| `DATABASE_POOL_MAX` | Max Postgres pool connections |
| `DATABASE_SSL` | Set to `true` if your Postgres endpoint requires SSL |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Set to `false` only in development for self-signed certs; certificate verification is always enforced in production |
| `ALLOWED_ORIGINS` | Comma-separated allowed browser origins |
| `TRUST_PROXY` | Set to `true` behind Coolify/reverse proxy |
| `OPENCODE_GO_API_KEY` | Server-only API key for model calls |
| `OPENCODE_MODEL` | Text model name |
| `OPENCODE_VISION_MODEL` | Vision model name |
| `VITE_TURNSTILE_SITE_KEY` | Public Turnstile site key used by the browser |
| `TURNSTILE_SECRET` | Server-only Turnstile secret key |
| `TURNSTILE_HOSTNAMES` | Comma-separated hostnames accepted from Turnstile verification |


## Contributing

Pull requests are welcome for fixes and improvements that belong in this repository. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

Report security issues privately instead of opening a public issue. See [SECURITY.md](SECURITY.md).


## License

Copyright (c) 2026 Mohammad Abukhader. All rights reserved.

This repository is public and source-available, but it is not open-source licensed. See LICENSE.md.
