import { mutationGeneric } from "convex/server";

export const nuke = mutationGeneric({
    handler: async (ctx) => {
        const tables = [
            "users",
            "workers",
            "fuel_stations",
            "service_types",
            "service_requests",
            "payments",
            "settlements",
            "platform_settings",
            "activity_log",
            "worker_bank_details",
            "worker_payouts",
            "payout_logs",
            "fuel_station_bank_details",
            "floating_cash_payments",
            "password_resets",
            "cod_settings",
            "service_prices",
            "worker_station_cache",
            "fuel_station_assignments",
            "fuel_station_stock",
            "fuel_station_ledger",
            "cod_settlements",
            "connectivity_reports",
        ];

        let totalDeleted = 0;
        for (const table of tables) {
            const rows = await ctx.db.query(table as any).collect();
            for (const row of rows) {
                await ctx.db.delete(row._id);
                totalDeleted++;
            }
        }
        return { ok: true, totalDeleted };
    },
});
