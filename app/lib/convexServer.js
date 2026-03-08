const { ConvexHttpClient } = require("convex/browser");

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";
  console.log("[ConvexServer] Resolved URL:", url ? "FOUND (starts with " + url.substring(0, 10) + "...)" : "MISSING");
  if (!url) {
    throw new Error("Convex URL missing. Set NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) in environment variables.");
  }
  return url;
}

function getClient() {
  return new ConvexHttpClient(getConvexUrl());
}

async function convexQuery(functionName, args = {}) {
  const client = getClient();
  return await client.query(functionName, args);
}

async function convexMutation(functionName, args = {}) {
  const client = getClient();
  return await client.mutation(functionName, args);
}

module.exports = {
  convexQuery,
  convexMutation,
};

