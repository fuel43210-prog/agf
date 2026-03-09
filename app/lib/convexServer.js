const { ConvexHttpClient } = require("convex/browser");

function getConvexUrl() {
  let url = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || "";

  if (!url) {
    throw new Error("Convex URL missing. Set NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) in environment variables.");
  }

  // Sanitize the URL to prevent 404 errors with empty messages from Convex client
  url = url.trim().replace(/\/+$/, ""); // Remove trailing slashes
  if (url.endsWith(".convex.site")) {
    url = url.replace(".convex.site", ".convex.cloud"); // Client requires .cloud domain
  }

  console.log("[ConvexServer] Resolved URL:", "FOUND (starts with " + url.substring(0, 10) + "...)");
  return url;
}

function getClient() {
  const customFetch = async (url, options) => {
    try {
      const resp = await fetch(url, options);
      if (!resp.ok) {
        let text = "";
        try { text = await resp.clone().text(); } catch (e) { }
        if (!text) {
          // Convex throws an empty error when the response text is empty. We preempt it here.
          throw new Error(`Convex fetch failed: HTTP ${resp.status} ${resp.statusText} at ${url}. ` +
            `This usually means your Convex URL is incorrect or the deployment does not exist.`);
        }
      }
      return resp;
    } catch (e) {
      if (e.message && e.message.includes("fetch failed")) {
        throw new Error(`Convex network error: Could not reach ${url}. Check your internet connection or NEXT_PUBLIC_CONVEX_URL.`);
      }
      throw e;
    }
  };
  return new ConvexHttpClient(getConvexUrl(), { fetch: customFetch });
}

async function convexQuery(functionName, args = {}) {
  const client = getClient();
  try {
    return await client.query(functionName, args);
  } catch (err) {
    console.error(`[ConvexServer] query (${functionName}) error:`, err.message || err);
    if (!err.message) {
      console.error("[ConvexServer] Hint: An empty error usually means the Convex URL is invalid, gave a 404, or the network is blocking the request.");
    }
    throw err;
  }
}

async function convexMutation(functionName, args = {}) {
  const client = getClient();
  try {
    return await client.mutation(functionName, args);
  } catch (err) {
    console.error(`[ConvexServer] mutation (${functionName}) error:`, err.message || err);
    if (!err.message) {
      console.error("[ConvexServer] Hint: An empty error usually means the Convex URL is invalid, gave a 404, or the network is blocking the request.");
    }
    throw err;
  }
}

module.exports = {
  convexQuery,
  convexMutation,
};

