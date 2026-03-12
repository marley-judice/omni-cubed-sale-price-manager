import { useState, useCallback, useMemo } from "react";
import { useFetcher } from "react-router";
import ProductSelector from "./ProductSelector";
import type { ProductWithExclusion } from "../routes/app.api.products";

interface CreateSaleProps {
  products: ProductWithExclusion[];
  productsLoading: boolean;
  onSaleCreated: () => void;
  onToast: (message: string, isError?: boolean) => void;
}

export default function CreateSale({
  products,
  productsLoading,
  onSaleCreated,
  onToast,
}: CreateSaleProps) {
  const fetcher = useFetcher();
  const [saleName, setSaleName] = useState("");
  const [discountPercentage, setDiscountPercentage] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(
    new Set(),
  );
  const [showConfirm, setShowConfirm] = useState<"apply" | "schedule" | null>(
    null,
  );

  const isSubmitting =
    fetcher.state === "submitting" || fetcher.state === "loading";

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedProductIds.has(p.id)),
    [products, selectedProductIds],
  );

  const totalVariants = useMemo(
    () =>
      selectedProducts.reduce(
        (sum, p) => sum + p.variants.edges.length,
        0,
      ),
    [selectedProducts],
  );

  const productsWithExistingCompareAt = useMemo(
    () =>
      selectedProducts.filter((p) =>
        p.variants.edges.some(
          (v) =>
            v.node.compareAtPrice &&
            v.node.compareAtPrice !== "0" &&
            v.node.compareAtPrice !== "0.00",
        ),
      ),
    [selectedProducts],
  );

  const discountNum = parseFloat(discountPercentage);
  const isValid =
    discountNum >= 1 &&
    discountNum <= 99 &&
    selectedProductIds.size > 0 &&
    !isSubmitting;

  const hasDateRange = startDate || endDate;

  const buildPayload = useCallback(() => {
    return {
      name: saleName || "Untitled Sale",
      discountPercentage: discountNum,
      startDate: startDate || null,
      endDate: endDate || null,
      products: selectedProducts.map((p) => ({
        id: p.id,
        title: p.title,
        handle: p.handle,
        variants: p.variants.edges.map((v) => ({
          id: v.node.id,
          title: v.node.title,
          price: v.node.price,
          compareAtPrice: v.node.compareAtPrice,
        })),
      })),
    };
  }, [saleName, discountNum, startDate, endDate, selectedProducts]);

  const handleApply = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "create_apply");
    formData.set("payload", JSON.stringify(buildPayload()));
    fetcher.submit(formData, {
      method: "POST",
      action: "/app/api/sales",
    });
    setShowConfirm(null);

    setTimeout(() => {
      setSaleName("");
      setDiscountPercentage("");
      setStartDate("");
      setEndDate("");
      setSelectedProductIds(new Set());
      onToast(
        `Sale applied to ${selectedProducts.length} products (${totalVariants} variants)`,
      );
      onSaleCreated();
    }, 2000);
  }, [buildPayload, fetcher, onSaleCreated, onToast, selectedProducts.length, totalVariants]);

  const handleSchedule = useCallback(() => {
    const formData = new FormData();
    formData.set("intent", "create_scheduled");
    formData.set("payload", JSON.stringify(buildPayload()));
    fetcher.submit(formData, {
      method: "POST",
      action: "/app/api/sales",
    });
    setShowConfirm(null);

    setTimeout(() => {
      setSaleName("");
      setDiscountPercentage("");
      setStartDate("");
      setEndDate("");
      setSelectedProductIds(new Set());
      onToast("Scheduled sale created successfully");
      onSaleCreated();
    }, 2000);
  }, [buildPayload, fetcher, onSaleCreated, onToast]);

  return (
    <s-section heading="Create New Sale">
      <s-stack direction="block" gap="base">
        <s-banner tone="warning">
          Make sure no Shopify automatic discounts are active for the selected
          products to avoid double-discounting.
        </s-banner>

        <s-stack direction="inline" gap="base">
          <div style={{ flex: 2 }}>
            <s-text-field
              label="Sale name"
              value={saleName}
              placeholder='e.g. "Spring Sale 2025"'
              onInput={(e: Event) =>
                setSaleName((e.target as HTMLInputElement).value)
              }
            />
          </div>
          <div style={{ flex: 1 }}>
            <s-text-field
              label="Discount %"
              value={discountPercentage}
              placeholder="e.g. 15"
              onInput={(e: Event) =>
                setDiscountPercentage((e.target as HTMLInputElement).value)
              }
            />
          </div>
        </s-stack>

        <s-stack direction="inline" gap="base">
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 500,
                marginBottom: "4px",
              }}
            >
              Start date (optional)
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid var(--p-color-border-subdued, #ccc)",
                borderRadius: "8px",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 500,
                marginBottom: "4px",
              }}
            >
              End date (optional)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid var(--p-color-border-subdued, #ccc)",
                borderRadius: "8px",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
          </div>
        </s-stack>

        {productsWithExistingCompareAt.length > 0 && (
          <s-banner tone="warning">
            {productsWithExistingCompareAt.length} selected product(s) already
            have compare-at prices. Their original compare-at values will be
            preserved and restored when the sale is reverted.
          </s-banner>
        )}

        <s-heading>Select Products</s-heading>
        <ProductSelector
          products={products}
          selectedProductIds={selectedProductIds}
          onSelectionChange={setSelectedProductIds}
          loading={productsLoading}
        />

        {discountNum >= 1 && discountNum <= 99 && selectedProductIds.size > 0 && (
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-paragraph>
              <strong>Preview:</strong> {discountNum}% off on{" "}
              {selectedProducts.length} products ({totalVariants} variants)
            </s-paragraph>
          </s-box>
        )}

        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            onClick={() => setShowConfirm("apply")}
            {...(!isValid ? { disabled: true } : {})}
            {...(isSubmitting ? { loading: true } : {})}
          >
            Create &amp; Apply Sale
          </s-button>
          {hasDateRange && (
            <s-button
              onClick={() => setShowConfirm("schedule")}
              {...(!isValid || !startDate ? { disabled: true } : {})}
              {...(isSubmitting ? { loading: true } : {})}
            >
              Create as Scheduled
            </s-button>
          )}
        </s-stack>

        {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
          <s-banner tone="critical">
            {fetcher.data.error === "conflict"
              ? `Conflict: Some variants are already in an active sale (${(fetcher.data as { conflicts: Array<{ saleName: string; count: number }> }).conflicts?.map((c: { saleName: string; count: number }) => `${c.saleName}: ${c.count} variants`).join(", ")}). Revert the existing sale first.`
              : String(fetcher.data.error)}
          </s-banner>
        )}
      </s-stack>

      {showConfirm && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "480px",
              width: "90%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <s-heading>
              {showConfirm === "apply"
                ? "Apply Sale Now?"
                : "Schedule Sale?"}
            </s-heading>
            <div style={{ margin: "16px 0" }}>
              <s-paragraph>
                {showConfirm === "apply"
                  ? `This will apply ${discountNum}% off to ${selectedProducts.length} products (${totalVariants} variants). Prices will be changed immediately on your storefront.`
                  : `This will schedule ${discountNum}% off for ${selectedProducts.length} products. Prices will be changed automatically on ${new Date(startDate).toLocaleDateString()}.`}
              </s-paragraph>
            </div>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={
                  showConfirm === "apply" ? handleApply : handleSchedule
                }
              >
                {showConfirm === "apply" ? "Apply Now" : "Schedule"}
              </s-button>
              <s-button
                variant="tertiary"
                onClick={() => setShowConfirm(null)}
              >
                Cancel
              </s-button>
            </s-stack>
          </div>
        </div>
      )}
    </s-section>
  );
}
