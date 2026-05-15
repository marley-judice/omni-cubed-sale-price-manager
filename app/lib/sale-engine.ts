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
  const successfulVariantIds: string[] = [];

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
        successfulVariantIds.push(...variants.map((v) => v.id));
      }
    } catch (err) {
      failedVariants += variants.length;
      errors.push(`${productId}: ${String(err)}`);
    }
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  const now = new Date();
  if (appliedVariants > 0) {
    await prisma.sale.update({
      where: { id: sale.id },
      data: { active: true },
    });
    await prisma.saleVariant.updateMany({
      where: {
        saleId: sale.id,
        variantId: { in: successfulVariantIds },
      },
      data: { appliedAt: now },
    });
  }

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
  verificationFailures?: string[];
}

export async function revertSale(
  admin: { graphql: Function },
  saleId: number,
  skipModifiedCheck = false,
): Promise<RevertResult> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: { variants: true },
  });

  if (!sale) {
    throw new Error(`Sale ${saleId} not found`);
  }

  const saleVariants = sale.variants;

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

  // Fetch live prices from Shopify to detect stale stored originals.
  // If a variant's stored originalPrice looks wrong (e.g. it equals the
  // sale price of another sale), the live compare-at price is the real MSRP.
  const livePrices = new Map<string, { price: string; compareAtPrice: string | null }>();
  const modifiedVariants: string[] = [];
  const batchSize = 50;
  const allVariantIds = saleVariants.map((sv) => sv.variantId);

  for (let i = 0; i < allVariantIds.length; i += batchSize) {
    const batch = allVariantIds.slice(i, i + batchSize);
    try {
      const response = await admin.graphql(GET_VARIANT_CURRENT_PRICES_QUERY, {
        variables: { ids: batch },
      });
      const json = await response.json();
      const nodes = json.data?.nodes || [];
      for (const node of nodes) {
        if (!node) continue;
        livePrices.set(node.id, {
          price: node.price,
          compareAtPrice: node.compareAtPrice,
        });
        if (!skipModifiedCheck) {
          const sv = saleVariants.find((s) => s.variantId === node.id);
          if (sv && node.price !== sv.newSalePrice) {
            modifiedVariants.push(node.id);
          }
        }
      }
    } catch (err) {
      console.error(`[revertSale] Sale ${saleId}: live price fetch failed:`, err);
    }
    if (i + batchSize < allVariantIds.length) await sleep(RATE_LIMIT_DELAY_MS);
  }

  // Build revert payloads, correcting stale originals using live compare-at
  const dbUpdates: Array<{ variantId: string; originalPrice: string; originalCompareAtPrice: string | null }> = [];

  const revertPayloads = groupVariantsByProduct(
    saleVariants.map((sv) => {
      let restorePrice = sv.originalPrice;
      let restoreCompareAt = sv.originalCompareAtPrice;

      const live = livePrices.get(sv.variantId);
      if (live?.compareAtPrice) {
        const cap = parseFloat(live.compareAtPrice);
        const stored = parseFloat(sv.originalPrice);
        // If the stored original is less than the current compare-at,
        // the stored value is from a previous sale — use compare-at as the real price
        if (!isNaN(cap) && !isNaN(stored) && stored < cap) {
          restorePrice = live.compareAtPrice;
          restoreCompareAt = null;
          dbUpdates.push({
            variantId: sv.variantId,
            originalPrice: restorePrice,
            originalCompareAtPrice: null,
          });
        }
      }

      return {
        variantId: sv.variantId,
        productId: sv.productId,
        price: restorePrice,
        compareAtPrice: restoreCompareAt,
      };
    }),
  );

  // Fix the DB so future reverts don't re-poison prices
  for (const update of dbUpdates) {
    await prisma.saleVariant.updateMany({
      where: { saleId, variantId: update.variantId },
      data: {
        originalPrice: update.originalPrice,
        originalCompareAtPrice: update.originalCompareAtPrice,
        newSalePrice: calculateSalePrice(update.originalPrice, sale.discountPercentage),
      },
    });
  }

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

  // Verify prices were actually restored on Shopify
  const verificationFailures: string[] = [];
  if (successfulVariantIds.length > 0) {
    const batchSize = 50;
    for (let i = 0; i < successfulVariantIds.length; i += batchSize) {
      const batch = successfulVariantIds.slice(i, i + batchSize);
      try {
        const response = await admin.graphql(GET_VARIANT_CURRENT_PRICES_QUERY, {
          variables: { ids: batch },
        });
        const json = await response.json();
        const nodes = json.data?.nodes || [];
        for (const node of nodes) {
          if (!node) continue;
          const sv = saleVariants.find((s) => s.variantId === node.id);
          if (sv && node.price !== sv.originalPrice) {
            verificationFailures.push(
              `${node.id}: expected ${sv.originalPrice}, got ${node.price}`,
            );
          }
        }
      } catch (err) {
        console.error(`[revertSale] Sale ${saleId}: post-revert verification failed:`, err);
      }
      if (i + batchSize < successfulVariantIds.length) await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  if (verificationFailures.length > 0) {
    console.error(
      `[revertSale] Sale ${saleId}: ${verificationFailures.length} variant(s) did NOT revert correctly:`,
      verificationFailures,
    );
  }

  console.log(`[revertSale] Sale ${saleId}: done — reverted=${revertedVariants}, failed=${failedVariants}, verificationFailures=${verificationFailures.length}`);

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
        verificationFailures,
        errors,
      }),
    },
  });

  return { revertedVariants, failedVariants, modifiedVariants, errors, verificationFailures };
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

  // Re-fetch live prices from Shopify so we capture the true current state,
  // not stale values from when the sale was first created or last reverted.
  const livePrices = new Map<string, { price: string; compareAtPrice: string | null }>();
  const batchSize = 50;
  for (let i = 0; i < allVariantIds.length; i += batchSize) {
    const batch = allVariantIds.slice(i, i + batchSize);
    try {
      const response = await admin.graphql(GET_VARIANT_CURRENT_PRICES_QUERY, {
        variables: { ids: batch },
      });
      const json = await response.json();
      const nodes = json.data?.nodes || [];
      for (const node of nodes) {
        if (!node) continue;
        livePrices.set(node.id, {
          price: node.price,
          compareAtPrice: node.compareAtPrice,
        });
      }
    } catch (err) {
      console.error(`[activateScheduledSale] Sale ${saleId}: failed to fetch live prices:`, err);
    }
    if (i + batchSize < allVariantIds.length) await sleep(RATE_LIMIT_DELAY_MS);
  }

  const mutationPayloads = new Map<
    string,
    Array<{ id: string; price: string; compareAtPrice: string }>
  >();

  // Track DB updates for variants whose stored originals are stale
  const variantUpdates: Array<{ variantId: string; originalPrice: string; originalCompareAtPrice: string | null; newSalePrice: string }> = [];

  for (const sv of sale.variants) {
    const live = livePrices.get(sv.variantId);

    // Use live prices if available; fall back to stored originals
    const currentPrice = live?.price ?? sv.originalPrice;
    const currentCompareAt = live ? live.compareAtPrice : sv.originalCompareAtPrice;

    const freshSalePrice = calculateSalePrice(currentPrice, sale.discountPercentage);

    const hasExistingCompareAt =
      currentCompareAt !== null &&
      currentCompareAt !== "0" &&
      currentCompareAt !== "0.00";

    const existing = mutationPayloads.get(sv.productId) || [];
    existing.push({
      id: sv.variantId,
      price: freshSalePrice,
      compareAtPrice: hasExistingCompareAt ? currentCompareAt! : currentPrice,
    });
    mutationPayloads.set(sv.productId, existing);

    // Update stored values if they changed
    if (currentPrice !== sv.originalPrice || freshSalePrice !== sv.newSalePrice || currentCompareAt !== sv.originalCompareAtPrice) {
      variantUpdates.push({
        variantId: sv.variantId,
        originalPrice: currentPrice,
        originalCompareAtPrice: currentCompareAt,
        newSalePrice: freshSalePrice,
      });
    }
  }

  // Persist refreshed original prices so revert will restore correctly
  for (const update of variantUpdates) {
    await prisma.saleVariant.updateMany({
      where: { saleId, variantId: update.variantId },
      data: {
        originalPrice: update.originalPrice,
        originalCompareAtPrice: update.originalCompareAtPrice,
        newSalePrice: update.newSalePrice,
      },
    });
  }

  let appliedVariants = 0;
  let failedVariants = 0;
  const errors: string[] = [];
  const successfulVariantIds: string[] = [];

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
        successfulVariantIds.push(...variants.map((v) => v.id));
      }
    } catch (err) {
      failedVariants += variants.length;
      errors.push(`${productId}: ${String(err)}`);
    }
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  const now = new Date();
  if (appliedVariants > 0) {
    await prisma.sale.update({
      where: { id: saleId },
      data: { active: true },
    });
    await prisma.saleVariant.updateMany({
      where: {
        saleId,
        variantId: { in: successfulVariantIds },
      },
      data: { appliedAt: now, revertedAt: null },
    });
  }

  await prisma.auditLog.create({
    data: {
      saleId,
      action: "APPLY",
      details: JSON.stringify({
        scheduled: true,
        totalVariants: sale.variants.length,
        appliedVariants,
        failedVariants,
        refreshedVariants: variantUpdates.length,
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

export async function deleteSale(
  admin: { graphql: Function } | null,
  saleId: number,
): Promise<{ revertedBeforeDelete: boolean; revertResult?: RevertResult }> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: { variants: true },
  });

  if (!sale) {
    throw new Error("Sale not found");
  }

  let revertedBeforeDelete = false;
  let revertResult: RevertResult | undefined;

  const hasUnrevertedVariants = sale.variants.some((v) => v.appliedAt && !v.revertedAt);

  if (hasUnrevertedVariants && admin) {
    console.log(`[deleteSale] Sale ${saleId} has unreverted variants — reverting prices before delete`);
    revertResult = await revertSale(admin, saleId, true);
    revertedBeforeDelete = true;

    if (revertResult.failedVariants > 0) {
      throw new Error(
        `Cannot delete: failed to revert ${revertResult.failedVariants} variant(s). ` +
        `Revert prices first, then delete. ${revertResult.errors[0] || ""}`,
      );
    }
  }

  await prisma.auditLog.create({
    data: {
      saleId,
      action: "DELETE",
      details: JSON.stringify({
        deletedAt: new Date().toISOString(),
        revertedBeforeDelete,
        revertResult: revertResult
          ? {
              revertedVariants: revertResult.revertedVariants,
              failedVariants: revertResult.failedVariants,
            }
          : null,
      }),
    },
  });

  await prisma.sale.delete({ where: { id: saleId } });

  return { revertedBeforeDelete, revertResult };
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
