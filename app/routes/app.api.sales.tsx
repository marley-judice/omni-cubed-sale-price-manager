import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createAndApplySale,
  createScheduledSale,
  revertSale,
  deleteSale,
  checkVariantConflicts,
  activateScheduledSale,
} from "../lib/sale-engine";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const sales = await prisma.sale.findMany({
    include: {
      _count: { select: { variants: true } },
      variants: {
        select: { productId: true },
        distinct: ["productId"],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    sales: sales.map((sale) => ({
      id: sale.id,
      name: sale.name,
      discountPercentage: sale.discountPercentage,
      startDate: sale.startDate?.toISOString() || null,
      endDate: sale.endDate?.toISOString() || null,
      active: sale.active,
      createdAt: sale.createdAt.toISOString(),
      variantCount: sale._count.variants,
      productCount: sale.variants.length,
      status: getSaleStatus(sale),
    })),
  };
};

function getSaleStatus(sale: {
  active: boolean;
  startDate: Date | null;
  endDate: Date | null;
}) {
  const now = new Date();
  if (sale.active) return "active";
  if (sale.startDate && sale.startDate > now) return "scheduled";
  if (sale.endDate && sale.endDate <= now) return "ended";
  return "reverted";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "create_apply": {
      const payload = JSON.parse(formData.get("payload") as string);
      const { name, discountPercentage, startDate, endDate, products } =
        payload;

      if (
        !discountPercentage ||
        discountPercentage < 1 ||
        discountPercentage > 99
      ) {
        return { error: "Discount must be between 1 and 99%" };
      }
      if (!products || products.length === 0) {
        return { error: "At least one product must be selected" };
      }

      const allVariantIds = products.flatMap(
        (p: { variants: Array<{ id: string }> }) =>
          p.variants.map((v: { id: string }) => v.id),
      );
      const conflicts = await checkVariantConflicts(allVariantIds);
      if (conflicts.length > 0) {
        return {
          error: "conflict",
          conflicts: conflicts.map((c) => ({
            saleName: c.saleName,
            count: c.variantIds.length,
          })),
        };
      }

      const result = await createAndApplySale(admin, {
        name: name || "Untitled Sale",
        discountPercentage,
        startDate,
        endDate,
        products,
      });

      return { success: true, result };
    }

    case "create_scheduled": {
      const payload = JSON.parse(formData.get("payload") as string);
      const { name, discountPercentage, startDate, endDate, products } =
        payload;

      if (
        !discountPercentage ||
        discountPercentage < 1 ||
        discountPercentage > 99
      ) {
        return { error: "Discount must be between 1 and 99%" };
      }
      if (!products || products.length === 0) {
        return { error: "At least one product must be selected" };
      }
      if (!startDate) {
        return { error: "Start date is required for scheduled sales" };
      }

      const result = await createScheduledSale({
        name: name || "Untitled Sale",
        discountPercentage,
        startDate,
        endDate,
        products,
      });

      return { success: true, result };
    }

    case "activate": {
      const saleId = parseInt(formData.get("saleId") as string);
      const result = await activateScheduledSale(admin, saleId);
      return { success: true, result };
    }

    case "revert": {
      const saleId = parseInt(formData.get("saleId") as string);
      const result = await revertSale(admin, saleId);
      return { success: true, result };
    }

    case "delete": {
      const saleId = parseInt(formData.get("saleId") as string);
      await deleteSale(saleId);
      return { success: true };
    }

    case "check_conflicts": {
      const variantIds = JSON.parse(
        formData.get("variantIds") as string,
      ) as string[];
      const conflicts = await checkVariantConflicts(variantIds);
      return { conflicts };
    }

    default:
      return { error: "Unknown intent" };
  }
};
