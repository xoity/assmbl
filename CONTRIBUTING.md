# Contributing

Thanks for taking a look at assmbl.

This is a public source-available project. Contributions are welcome by pull request, but the project is not licensed for reuse outside this repository unless written permission is granted by the owner.

## Local Development

Install dependencies:

```bash
npm ci
```

Create local environment variables:

```bash
cp .env.example .env
```

Run the development server:

```bash
npm run dev
```

Before opening a pull request, run:

```bash
npm run build
npm audit --audit-level=high
```

## Pull Request Guidelines

- Keep changes focused and easy to review.
- Do not commit `.env` files, secrets, generated build output, or local screenshots.
- Update documentation when deployment, environment variables, or user-facing behavior changes.
- Preserve the existing React, TypeScript, and Express style unless there is a clear reason to change it.
- Include reproduction steps or screenshots for UI fixes when helpful.

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).
