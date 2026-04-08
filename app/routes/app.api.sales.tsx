import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { GET_PRODUCT_HANDLES_QUERY } from "../lib/shopify-queries";
import {
  createAndApplySale,
  createScheduledSale,
  revertSale,
  deleteSale,
  checkVariantConflicts,
  activateScheduledSale,
} from "../lib/sale-engine";

export interface SaleVariantRow {
  productTitle: string;
  productHandle: string;
  variantTitle: string;
  variantId: string;
  originalPrice: string;
  originalCompareAtPrice: string | null;
  newSalePrice: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const saleId = url.searchParams.get("saleId");

  if (saleId) {
    const sale = await prisma.sale.findUnique({
      where: { id: parseInt(saleId) },
      include: { variants: true },
    });

    if (!sale) {
      return { error: "Sale not found" };
    }

    const missingHandleProductIds = [
      ...new Set(
        sale.variants
          .filter((v) => !v.productHandle)
          .map((v) => v.productId),
      ),
    ];

    const handleMap = new Map<string, string>();

    if (missingHandleProductIds.length > 0) {
      try {
        const batchSize = 50;
        for (let i = 0; i < missingHandleProductIds.length; i += batchSize) {
          const batch = missingHandleProductIds.slice(i, i + batchSize);
          const response = await admin.graphql(GET_PRODUCT_HANDLES_QUERY, {
            variables: { ids: batch },
          });
          const json = await response.json();
          const nodes = json.data?.nodes || [];
          for (const node of nodes) {
            if (node?.id && node?.handle) {
              handleMap.set(node.id, node.handle);
            }
          }
        }

        for (const [productId, handle] of handleMap) {
          await prisma.saleVariant.updateMany({
            where: { saleId: sale.id, productId, productHandle: "" },
            data: { productHandle: handle },
          });
        }
      } catch {
        // Non-critical — URLs will just be missing
      }
    }

    const variants: SaleVariantRow[] = sale.variants.map((v) => ({
      productTitle: v.productTitle,
      productHandle: v.productHandle || handleMap.get(v.productId) || "",
      variantTitle: v.variantTitle,
      variantId: v.variantId,
      originalPrice: v.originalPrice,
      originalCompareAtPrice: v.originalCompareAtPrice,
      newSalePrice: v.newSalePrice,
    }));

    return {
      saleVariants: variants,
      saleName: sale.name,
      discountPercentage: sale.discountPercentage,
    };
  }

  const sales = await prisma.sale.findMany({
    include: {
      _count: { select: { variants: true } },
      variants: {
        select: { productId: true, appliedAt: true },
        distinct: ["productId"],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    sales: sales.map((sale) => {
      const appliedAt = sale.variants.find((v) => v.appliedAt)?.appliedAt;
      return {
        id: sale.id,
        name: sale.name,
        discountPercentage: sale.discountPercentage,
        startDate: sale.startDate?.toISOString() || null,
        endDate: sale.endDate?.toISOString() || null,
        active: sale.active,
        createdAt: sale.createdAt.toISOString(),
        appliedAt: appliedAt?.toISOString() || null,
        variantCount: sale._count.variants,
        productCount: sale.variants.length,
        status: getSaleStatus(sale),
      };
    }),
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

      try {
        const result = await createAndApplySale(admin, {
          name: name || "Untitled Sale",
          discountPercentage,
          startDate,
          endDate,
          products,
        });

        return { success: true, result };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
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

      try {
        const result = await createScheduledSale({
          name: name || "Untitled Sale",
          discountPercentage,
          startDate,
          endDate,
          products,
        });

        return { success: true, result };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "activate": {
      const saleId = parseInt(formData.get("saleId") as string);
      try {
        const result = await activateScheduledSale(admin, saleId);
        return { success: true, result };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "revert": {
      const saleId = parseInt(formData.get("saleId") as string);
      try {
        const result = await revertSale(admin, saleId);
        return { success: true, result };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "delete": {
      const saleId = parseInt(formData.get("saleId") as string);
      try {
        await deleteSale(saleId);
        return { success: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
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
