# Next.js Login Example

This project is a Next.js app with API routes migrating to Convex.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Configure environment files:
- `.env`: app-level keys (SMTP, Razorpay, etc.)
- `.env.local`: Convex URL and app bootstrap keys

3. Start development server:

```bash
npm run dev
```

## Convex configuration

Set your Convex deployment URL in `.env.local`:

```env
NEXT_PUBLIC_CONVEX_URL="https://<your-convex-deployment>.convex.cloud"

ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="change-me"
```

Then sync Convex functions/schema:

```bash
npx convex dev --once
```

## Notes

- Core auth, users/workers, service requests, payments, and fuel-station flows are now Convex-backed.
- Some admin and legacy endpoints may still use SQL during the migration window.
