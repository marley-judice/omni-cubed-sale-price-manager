import prisma from "../db.server";
import {
  BULK_UPDATE_VARIANTS_MUTATION,
  GET_VARIANT_CURRENT_PRICES_QUERY,
  type ShopifyProduct,
} from "./shopify-queries";
import { startOfDayPT, endOfDayPT } from "./timezone";

const RATE_LIMIT_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateSalePrice(
  originalPrice: string,
  discountPercentage: number,
): string {
  const price = parseFloat(originalPrice);
  const discounted = price * (1 - discountPercentage / 100);
  return discounted.toFixed(2);
}

interface SelectedProduct {
  id: string;
  title: string;
  handle: string;
  variants: Array<{
    id: string;
    title: string;
    price: string;
    compareAtPrice: string | null;
  }>;
}

interface ApplySaleInput {
  name: string;
  discountPercentage: number;
  startDate?: string | null;
  endDate?: string | null;
  products: SelectedProduct[];
}

interface ApplySaleResult {
  saleId: number;
  totalVariants: number;
  appliedVariants: number;
  failedVariants: number;
  errors: string[];
}

/**
 * Groups variants by their product ID for batched mutations.
 */
function groupVariantsByProduct(
  saleVariants: Array<{
    variantId: string;
    productId: string;
    price: string;
    compareAtPrice: string | null;
  }>,
): Map<string, Array<{ variantId: string; price: string; compareAtPrice: string | null }>> {
  const grouped = new Map<
    string,
    Array<{ variantId: string; price: string; compareAtPrice: string | null }>
  >();
  for (const sv of saleVariants) {
    const existing = grouped.get(sv.productId) || [];
    existing.push({
      variantId: sv.variantId,
      price: sv.price,
      compareAtPrice: sv.compareAtPrice,
    });
    grouped.set(sv.productId, existing);
  }
  return grouped;
}

export async function checkVariantConflicts(
  variantIds: string[],
): Promise<{ conflictingSaleId: number; saleName: string; variantIds: string[] }[]> {
  const activeVariants = await prisma.saleVariant.findMany({
    where: {
      variantId: { in: variantIds },
      sale: { active: true },
      revertedAt: null,
    },
    include: { sale: true },
  });

  const bySale = new Map<number, { saleName: string; variantIds: string[] }>();
  for (const av of activeVariants) {
    const entry = bySale.get(av.saleId) || {
      saleName: av.sale.name,
      variantIds: [],
    };
    entry.variantIds.push(av.variantId);
    bySale.set(av.saleId, entry);
  }

  return Array.from(bySale.entries()).map(([saleId, data]) => ({
    conflictingSaleId: saleId,
    saleName: data.saleName,
    variantIds: data.variantIds,
  }));
}

export async function createAndApplySale(
  admin: { graphql: Function },
  input: ApplySaleInput,
): Promise<ApplySaleResult> {
  const { name, discountPercentage, startDate, endDate, products } = input;

  const sale = await prisma.sale.create({
    data: {
      name,
      discountPercentage,
      startDate: startDate ? startOfDayPT(startDate) : null,
      endDate: endDate ? endOfDayPT(endDate) : null,
      active: false,
    },
  });

  const saleVariantData = products.flatMap((product) =>
    product.variants.map((variant) => {
      const hasExistingCompareAt =
        variant.compareAtPrice !== null &&
        variant.compareAtPrice !== "0" &&
        variant.compareAtPrice !== "0.00";

      return {
        saleId: sale.id,
        variantId: variant.id,
        productId: product.id,
        productTitle: product.title,
        productHandle: product.handle,
        variantTitle: variant.title,
        originalPrice: variant.price,
        originalCompareAtPrice: variant.compareAtPrice,
        newSalePrice: calculateSalePrice(variant.price, discountPercentage),
        compareAtToSet: hasExistingCompareAt
          ? variant.compareAtPrice!
          : variant.price,
      };
    }),
  );

  await prisma.saleVariant.createMany({
    data: saleVariantData.map(({ compareAtToSet: _, ...rest }) => rest),
  });

  const mutationPayloads = new Map<
    string,
    Array<{ id: string; price: string; compareAtPrice: string }>
  >();
  for (const sv of saleVariantData) {
    const existing = mutationPayloads.get(sv.productId) || [];
    existing.push({
      id: sv.variantId,
      price: sv.newSalePrice,
      compareAtPrice: sv.compareAtToSet,
    });
    mutationPayloads.set(sv.productId, existing);
  }

  let appliedVariants = 0;
  let failedVariants = 0;
  const errors: string[] = [];

  for (const [productId, variants] of mutationPayloads) {
    try {
      const response = await admin.graphql(BULK_UPDATE_VARIANTS_MUTATION, {
        variables: { productId, variants },
      });
      const json = await response.json();
      const userErrors =
        json.data?.productVariantsBulkUpdate?.userErrors || [];

      if (userErrors.length > 0) {
        failedVariants += variants.length;
        errors.push(
          ...userErrors.map(
            (e: { field: string[]; message: string }) =>
              `${productId}: ${e.message}`,
          ),
        );
      } else {
        appliedVariants += variants.length;
      }
    } catch (err) {
      failedVariants += variants.length;
      errors.push(`${productId}: ${String(err)}`);
    }
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  const now = new Date();
  await prisma.sale.update({
    where: { id: sale.id },
    data: { active: true },
  });
  await prisma.saleVariant.updateMany({
    where: { saleId: sale.id },
    data: { appliedAt: now },
  });

  await prisma.auditLog.create({
    data: {
      saleId: sale.id,
      action: "APPLY",
      details: JSON.stringify({
        totalVariants: saleVariantData.length,
        appliedVariants,
        failedVariants,
        errors,
      }),
    },
  });

  return {
    saleId: sale.id,
    totalVariants: saleVariantData.length,
    appliedVariants,
    failedVariants,
    errors,
  };
}

export async function createScheduledSale(
  input: ApplySaleInput,
): Promise<{ saleId: number }> {
  const { name, discountPercentage, startDate, endDate, products } = input;

  const sale = await prisma.sale.create({
    data: {
      name,
      discountPercentage,
      startDate: startDate ? startOfDayPT(startDate) : null,
      endDate: endDate ? endOfDayPT(endDate) : null,
      active: false,
    },
  });

  const saleVariantData = products.flatMap((product) =>
    product.variants.map((variant) => ({
      saleId: sale.id,
      variantId: variant.id,
      productId: product.id,
      productTitle: product.title,
      productHandle: product.handle,
      variantTitle: variant.title,
      originalPrice: variant.price,
      originalCompareAtPrice: variant.compareAtPrice,
      newSalePrice: calculateSalePrice(variant.price, discountPercentage),
    })),
  );

  await prisma.saleVariant.createMany({ data: saleVariantData });

  await prisma.auditLog.create({
    data: {
      saleId: sale.id,
      action: "SCHEDULE_ACTIVATE",
      details: JSON.stringify({
        startDate,
        endDate,
        variantCount: saleVariantData.length,
      }),
    },
  });

  return { saleId: sale.id };
}

interface RevertResult {
  revertedVariants: number;
  failedVariants: number;
  modifiedVariants: string[];
  errors: string[];
}

export async function revertSale(
  admin: { graphql: Function },
  saleId: number,
  skipModifiedCheck = false,
): Promise<RevertResult> {
  // Fetch ALL variants for this sale — not just un-reverted ones.
  // Previous reverts may have marked revertedAt in the DB without
  // actually updating Shopify, so we always push original prices.
  const saleVariants = await prisma.saleVariant.findMany({
    where: { saleId },
  });

  if (saleVariants.length === 0) {
    console.log(`[revertSale] Sale ${saleId}: no variants at all, deactivating sale only`);
    await prisma.sale.update({
      where: { id: saleId },
      data: { active: false },
    });
    await prisma.auditLog.create({
      data: {
        saleId,
        action: "REVERT",
        details: JSON.stringify({
          revertedVariants: 0,
          failedVariants: 0,
          modifiedVariants: [],
          errors: [],
          note: "No variants found; sale deactivated only",
        }),
      },
    });
    return { revertedVariants: 0, failedVariants: 0, modifiedVariants: [], errors: [] };
  }

  console.log(`[revertSale] Sale ${saleId}: reverting ${saleVariants.length} variants`);

  const modifiedVariants: string[] = [];

  if (!skipModifiedCheck) {
    const batchSize = 50;
    for (let i = 0; i < saleVariants.length; i += batchSize) {
      const batch = saleVariants.slice(i, i + batchSize);
      const ids = batch.map((sv) => sv.variantId);
      try {
        const response = await admin.graphql(GET_VARIANT_CURRENT_PRICES_QUERY, {
          variables: { ids },
        });
        const json = await response.json();
        const nodes = json.data?.nodes || [];
        for (const node of nodes) {
          if (!node) continue;
          const sv = saleVariants.find((s) => s.variantId === node.id);
          if (sv && node.price !== sv.newSalePrice) {
            modifiedVariants.push(node.id);
          }
        }
      } catch (err) {
        console.error(`[revertSale] Sale ${saleId}: price check failed:`, err);
      }
      if (i + batchSize < saleVariants.length) await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  const revertPayloads = groupVariantsByProduct(
    saleVariants.map((sv) => ({
      variantId: sv.variantId,
      productId: sv.productId,
      price: sv.originalPrice,
      compareAtPrice: sv.originalCompareAtPrice,
    })),
  );

  let revertedVariants = 0;
  let failedVariants = 0;
  const errors: string[] = [];
  const successfulVariantIds: string[] = [];

  for (const [productId, variants] of revertPayloads) {
    try {
      const mutationVariants = variants.map((v) => {
        const cap = v.compareAtPrice;
        const resolvedCap =
          cap === null || cap === undefined || cap === "" || cap === "0" || cap === "0.00"
            ? null
            : cap;
        return {
          id: v.variantId,
          price: v.price,
          compareAtPrice: resolvedCap,
        };
      });

      console.log(`[revertSale] Sale ${saleId}: updating product ${productId} with ${mutationVariants.length} variants`);

      const response = await admin.graphql(BULK_UPDATE_VARIANTS_MUTATION, {
        variables: { productId, variants: mutationVariants },
      });
      const json = await response.json();

      console.log(`[revertSale] Sale ${saleId}: response for ${productId}:`, JSON.stringify(json));

      const userErrors =
        json.data?.productVariantsBulkUpdate?.userErrors || [];

      if (userErrors.length > 0) {
        failedVariants += variants.length;
        const msgs = userErrors.map(
          (e: { field: string[]; message: string }) =>
            `${productId}: ${e.message}`,
        );
        errors.push(...msgs);
        console.error(`[revertSale] Sale ${saleId}: userErrors for ${productId}:`, msgs);
      } else {
        revertedVariants += variants.length;
        successfulVariantIds.push(...variants.map((v) => v.variantId));
      }
    } catch (err) {
      failedVariants += variants.length;
      const msg = `${productId}: ${String(err)}`;
      errors.push(msg);
      console.error(`[revertSale] Sale ${saleId}: exception for ${productId}:`, err);
    }
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  console.log(`[revertSale] Sale ${saleId}: done — reverted=${revertedVariants}, failed=${failedVariants}, errors=${errors.length}`);

  const now = new Date();

  if (failedVariants === 0) {
    await prisma.sale.update({
      where: { id: saleId },
      data: { active: false },
    });
    await prisma.saleVariant.updateMany({
      where: { saleId },
      data: { revertedAt: now },
    });
  } else if (successfulVariantIds.length > 0) {
    await prisma.saleVariant.updateMany({
      where: { saleId, variantId: { in: successfulVariantIds } },
      data: { revertedAt: now },
    });
  }

  await prisma.auditLog.create({
    data: {
      saleId,
      action: "REVERT",
      details: JSON.stringify({
        revertedVariants,
        failedVariants,
        modifiedVariants,
        errors,
      }),
    },
  });

  return { revertedVariants, failedVariants, modifiedVariants, errors };
}

export async function activateScheduledSale(
  admin: { graphql: Function },
  saleId: number,
): Promise<ApplySaleResult> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: { variants: true },
  });

  if (!sale || sale.active) {
    throw new Error("Sale not found or already active");
  }

  // Check for conflicts with currently active sales before applying
  const allVariantIds = sale.variants.map((v) => v.variantId);
  const conflicts = await checkVariantConflicts(allVariantIds);
  if (conflicts.length > 0) {
    const details = conflicts
      .map((c) => `"${c.saleName}" (${c.variantIds.length} variants)`)
      .join(", ");
    throw new Error(
      `Cannot activate: ${allVariantIds.length > conflicts.reduce((sum, c) => sum + c.variantIds.length, 0) ? "some" : ""} variants conflict with active sale(s): ${details}`,
    );
  }

  const mutationPayloads = new Map<
    string,
    Array<{ id: string; price: string; compareAtPrice: string }>
  >();

  for (const sv of sale.variants) {
    const hasExistingCompareAt =
      sv.originalCompareAtPrice !== null &&
      sv.originalCompareAtPrice !== "0" &&
      sv.originalCompareAtPrice !== "0.00";

    const existing = mutationPayloads.get(sv.productId) || [];
    existing.push({
      id: sv.variantId,
      price: sv.newSalePrice,
      compareAtPrice: hasExistingCompareAt
        ? sv.originalCompareAtPrice!
        : sv.originalPrice,
    });
    mutationPayloads.set(sv.productId, existing);
  }

  let appliedVariants = 0;
  let failedVariants = 0;
  const errors: string[] = [];

  for (const [productId, variants] of mutationPayloads) {
    try {
      const response = await admin.graphql(BULK_UPDATE_VARIANTS_MUTATION, {
        variables: { productId, variants },
      });
      const json = await response.json();
      const userErrors =
        json.data?.productVariantsBulkUpdate?.userErrors || [];

      if (userErrors.length > 0) {
        failedVariants += variants.length;
        errors.push(
          ...userErrors.map(
            (e: { field: string[]; message: string }) =>
              `${productId}: ${e.message}`,
          ),
        );
      } else {
        appliedVariants += variants.length;
      }
    } catch (err) {
      failedVariants += variants.length;
      errors.push(`${productId}: ${String(err)}`);
    }
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  const now = new Date();
  await prisma.sale.update({
    where: { id: saleId },
    data: { active: true },
  });
  await prisma.saleVariant.updateMany({
    where: { saleId },
    data: { appliedAt: now },
  });

  await prisma.auditLog.create({
    data: {
      saleId,
      action: "APPLY",
      details: JSON.stringify({
        scheduled: true,
        totalVariants: sale.variants.length,
        appliedVariants,
        failedVariants,
        errors,
      }),
    },
  });

  return {
    saleId,
    totalVariants: sale.variants.length,
    appliedVariants,
    failedVariants,
    errors,
  };
}

export async function deleteSale(saleId: number): Promise<void> {
  await prisma.auditLog.create({
    data: {
      saleId,
      action: "DELETE",
      details: JSON.stringify({ deletedAt: new Date().toISOString() }),
    },
  });
  await prisma.sale.delete({ where: { id: saleId } });
}

export function getExcludedCollectionPatterns(): string[] {
  return ["replacement parts"];
}

export function isProductExcluded(
  product: ShopifyProduct,
): { excluded: boolean; reason: string | null } {
  const patterns = getExcludedCollectionPatterns();
  for (const edge of product.collections.edges) {
    const title = edge.node.title.toLowerCase();
    for (const pattern of patterns) {
      if (title.includes(pattern)) {
        return { excluded: true, reason: "Replacement Parts" };
      }
    }
  }
  return { excluded: false, reason: null };
}
