process.env.NEXT_PUBLIC_CONVEX_URL = "https://successful-pelican-435.convex.cloud";
const { convexQuery } = require("./app/lib/convexServer.js");

async function test() {
    try {
        const res = await convexQuery("auth:getLoginAccount", { role: "Admin", email: "admin@gmail.com" });
        console.log("Success:", res);
    } catch (err) {
        console.error("Test error:", err);
    }
}
test();
