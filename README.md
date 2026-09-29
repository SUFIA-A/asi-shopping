# ASI Shopping — Render Free Deploy Package

Node.js + Express dropshipping storefront and admin dashboard for DropSourceBD.

## Render settings

This repository includes `render.yaml`, so Render can detect the service configuration.

- Runtime: Node
- Plan: Free
- Build: `npm install`
- Start: `npm start`
- Health check: `/health`

## Required environment variables

Set these in Render Environment Variables / Secrets:

- `DROPSOURCE_API_KEY` = your current DropSourceBD reseller API key
- `ADMIN_PASSWORD` = a strong admin password

Do **not** commit the real API key or password to GitHub.

## Important Free Render storage limitation

This starter currently stores admin settings, product overrides, and local order records in JSON files under `data/`. Render Free web services use an ephemeral filesystem, so those local changes can be lost when the service restarts, redeploys, or spins down. Render recommends a database for persistent data; its Free Postgres option currently expires after 30 days.

Therefore this package is deploy-ready for testing/demo use on Render Free, but persistent production order/settings storage should be moved to an external persistent database before relying on it for long-term operations.

## Local run

```bash
npm install
cp .env.example .env
# edit .env with your secrets
npm start
```

Open `http://localhost:3000`.

Admin dashboard: `http://localhost:3000/admin/`

Health check: `http://localhost:3000/health`
