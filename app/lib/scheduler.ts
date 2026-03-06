import cron from "node-cron";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { activateScheduledSale, revertSale } from "./sale-engine";

let schedulerStarted = false;

async function getAdminForShop(shop: string) {
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

async function checkScheduledSales() {
  const now = new Date();

  const salesToActivate = await prisma.sale.findMany({
    where: {
      active: false,
      startDate: { lte: now },
      variants: { some: { appliedAt: null } },
    },
    include: {
      variants: { take: 1 },
    },
  });

  for (const sale of salesToActivate) {
    try {
      const session = await prisma.session.findFirst({
        where: { isOnline: false },
        orderBy: { id: "desc" },
      });
      if (!session) {
        console.error("[Scheduler] No offline session found");
        continue;
      }
      const admin = await getAdminForShop(session.shop);
      console.log(`[Scheduler] Activating sale ${sale.id}: ${sale.name}`);
      await activateScheduledSale(admin, sale.id);
    } catch (err) {
      console.error(`[Scheduler] Failed to activate sale ${sale.id}:`, err);
    }
  }

  const salesToDeactivate = await prisma.sale.findMany({
    where: {
      active: true,
      endDate: { lte: now },
    },
    include: {
      variants: { take: 1 },
    },
  });

  for (const sale of salesToDeactivate) {
    try {
      const session = await prisma.session.findFirst({
        where: { isOnline: false },
        orderBy: { id: "desc" },
      });
      if (!session) {
        console.error("[Scheduler] No offline session found");
        continue;
      }
      const admin = await getAdminForShop(session.shop);
      console.log(`[Scheduler] Deactivating sale ${sale.id}: ${sale.name}`);
      await revertSale(admin, sale.id, true);

      await prisma.auditLog.create({
        data: {
          saleId: sale.id,
          action: "SCHEDULE_DEACTIVATE",
          details: JSON.stringify({ endDate: sale.endDate }),
        },
      });
    } catch (err) {
      console.error(`[Scheduler] Failed to deactivate sale ${sale.id}:`, err);
    }
  }
}

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  cron.schedule("* * * * *", async () => {
    try {
      await checkScheduledSales();
    } catch (err) {
      console.error("[Scheduler] Error in scheduled check:", err);
    }
  });

  console.log("[Scheduler] Sale scheduler started (checking every 60s)");
}
