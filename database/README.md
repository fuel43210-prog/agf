# Database Folder Notes

This project now uses Convex as the primary datastore.

The files kept in this folder are runtime utilities still used by the app:
- `auth-middleware.js` for JWT auth helpers used by API routes.
- `distance-calculator.js` for geo distance math.
- `settlement-calculator.js` for pricing/settlement calculations.

Legacy SQL/Appwrite/Supabase migration/setup scripts were removed.
