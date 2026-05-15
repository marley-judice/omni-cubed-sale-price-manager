import { useFetcher } from "react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import type { SaleVariantRow } from "../routes/app.api.sales";
import type { ProductWithExclusion } from "../routes/app.api.products";
import ProductSelector from "./ProductSelector";

interface SaleDetailProps {
  saleId: number;
  saleName: string;
  discountPercentage: number;
  saleStatus: "active" | "scheduled" | "ended" | "reverted";
  products: ProductWithExclusion[];
  onClose: () => void;
  onUpdated?: () => void;
}

function formatPrice(price: string): string {
  const num = parseFloat(price);
  return isNaN(num) ? price : `$${num.toFixed(2)}`;
}

const STORE_DOMAIN = "https://omnicubed.com";

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function extractNumericId(gid: string): string {
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : gid;
}

function buildProductUrl(handle: string, variantGid: string): string {
  if (!handle) return "";
  const numericId = extractNumericId(variantGid);
  return `${STORE_DOMAIN}/products/${handle}?variant=${numericId}`;
}

function buildCsv(
  variants: SaleVariantRow[],
  saleName: string,
  discountPercentage: number,
): string {
  const headers = [
    "Product",
    "Variant",
    "Original Price",
    "Original Compare-At Price",
    "Sale Price",
    `Discount (${discountPercentage}%)`,
    "URL",
  ];

  const rows = variants.map((v) => {
    const savings = (parseFloat(v.originalPrice) - parseFloat(v.newSalePrice)).toFixed(2);
    const url = buildProductUrl(v.productHandle, v.variantId);
    return [
      escapeCsvField(v.productTitle),
      escapeCsvField(v.variantTitle),
      v.originalPrice,
      v.originalCompareAtPrice || "",
      v.newSalePrice,
      savings,
      escapeCsvField(url),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function SaleDetail({
  saleId,
  saleName,
  discountPercentage,
  saleStatus,
  products,
  onClose,
  onUpdated,
}: SaleDetailProps) {
  const fetcher = useFetcher();
  const updateFetcher = useFetcher();
  const [variants, setVariants] = useState<SaleVariantRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  const lastHandledUpdateData = useRef<unknown>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && !loaded) {
      fetcher.load(`/app/api/sales?saleId=${saleId}`);
    }
  }, [fetcher, saleId, loaded]);

  useEffect(() => {
    if (fetcher.data && "saleVariants" in fetcher.data) {
      setVariants(fetcher.data.saleVariants as SaleVariantRow[]);
      setLoaded(true);
    }
  }, [fetcher.data]);

  // Pre-select products currently in the sale when entering edit mode
  const originalProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of variants) {
      ids.add(v.productId);
    }
    return ids;
  }, [variants]);

  const handleStartEdit = useCallback(() => {
    setSelectedProductIds(new Set(originalProductIds));
    setIsEditing(true);
  }, [originalProductIds]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setShowConfirm(false);
  }, []);

  const addedProducts = useMemo(() => {
    const added: string[] = [];
    for (const id of selectedProductIds) {
      if (!originalProductIds.has(id)) added.push(id);
    }
    return added;
  }, [selectedProductIds, originalProductIds]);

  const removedProducts = useMemo(() => {
    const removed: string[] = [];
    for (const id of originalProductIds) {
      if (!selectedProductIds.has(id)) removed.push(id);
    }
    return removed;
  }, [selectedProductIds, originalProductIds]);

  const hasDiff = addedProducts.length > 0 || removedProducts.length > 0;

  const handleSave = useCallback(() => {
    if (saleStatus === "active" && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);

    const selectedProducts = products
      .filter((p) => selectedProductIds.has(p.id))
      .map((p) => ({
        id: p.id,
        title: p.title,
        handle: p.handle,
        variants: p.variants.edges.map((v) => ({
          id: v.node.id,
          title: v.node.title,
          price: v.node.price,
          compareAtPrice: v.node.compareAtPrice,
        })),
      }));

    const formData = new FormData();
    formData.set("intent", "update_products");
    formData.set("saleId", String(saleId));
    formData.set("products", JSON.stringify(selectedProducts));
    updateFetcher.submit(formData, {
      method: "POST",
      action: "/app/api/sales",
    });
  }, [saleStatus, showConfirm, products, selectedProductIds, saleId, updateFetcher]);

  useEffect(() => {
    if (
      updateFetcher.state === "idle" &&
      updateFetcher.data &&
      updateFetcher.data !== lastHandledUpdateData.current
    ) {
      lastHandledUpdateData.current = updateFetcher.data;
      const data = updateFetcher.data as { success?: boolean; error?: string };
      if (data.success) {
        setIsEditing(false);
        setLoaded(false);
        onUpdated?.();
      }
    }
  }, [updateFetcher.state, updateFetcher.data, onUpdated]);

  const handleExportCsv = useCallback(() => {
    const csv = buildCsv(variants, saleName, discountPercentage);
    const safeFilename = saleName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    downloadCsv(csv, `${safeFilename}_products.csv`);
  }, [variants, saleName, discountPercentage]);

  const isLoading = fetcher.state !== "idle";
  const isUpdating = updateFetcher.state !== "idle";

  return (
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
          maxWidth: "1100px",
          width: "95%",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            flexShrink: 0,
          }}
        >
          <div>
            <s-heading>{saleName}</s-heading>
            <s-paragraph>
              {discountPercentage}% off &middot; {variants.length} variant
              {variants.length !== 1 ? "s" : ""}
            </s-paragraph>
          </div>
          <s-stack direction="inline" gap="base">
            {!isEditing && (
              <>
                <s-button
                  variant="primary"
                  onClick={handleStartEdit}
                  {...(!loaded ? { disabled: true } : {})}
                >
                  Edit Products
                </s-button>
                <s-button
                  onClick={handleExportCsv}
                  {...(isLoading || variants.length === 0 ? { disabled: true } : {})}
                >
                  Export CSV
                </s-button>
              </>
            )}
            <s-button variant="tertiary" onClick={isEditing ? handleCancelEdit : onClose}>
              {isEditing ? "Cancel" : "Close"}
            </s-button>
          </s-stack>
        </div>

        {updateFetcher.data && "error" in updateFetcher.data && (
          <s-banner tone="critical" style={{ marginBottom: "12px" }}>
            {String((updateFetcher.data as { error: string }).error)}
          </s-banner>
        )}

        {updateFetcher.data && "warning" in updateFetcher.data && (
          <s-banner tone="warning" style={{ marginBottom: "12px" }}>
            {String((updateFetcher.data as { warning: string }).warning)}
          </s-banner>
        )}

        <div style={{ overflowY: "auto", flex: 1 }}>
          {isEditing ? (
            <div>
              {saleStatus === "active" && (
                <s-banner tone="warning">
                  This sale is active. Adding or removing products will update live
                  storefront prices immediately.
                </s-banner>
              )}

              <div style={{ marginTop: "12px" }}>
                <ProductSelector
                  products={products}
                  selectedProductIds={selectedProductIds}
                  onSelectionChange={setSelectedProductIds}
                />
              </div>

              {hasDiff && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "12px",
                    background: "#f8f9fa",
                    borderRadius: "8px",
                    fontSize: "14px",
                  }}
                >
                  <strong>Changes:</strong>{" "}
                  {addedProducts.length > 0 && (
                    <span style={{ color: "#2e7d32" }}>
                      +{addedProducts.length} product{addedProducts.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {addedProducts.length > 0 && removedProducts.length > 0 && ", "}
                  {removedProducts.length > 0 && (
                    <span style={{ color: "#c62828" }}>
                      -{removedProducts.length} product{removedProducts.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}

              <div style={{ marginTop: "16px" }}>
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="primary"
                    onClick={handleSave}
                    {...(!hasDiff || isUpdating || selectedProductIds.size === 0
                      ? { disabled: true }
                      : {})}
                    {...(isUpdating ? { loading: true } : {})}
                  >
                    Save Changes
                  </s-button>
                  <s-button variant="tertiary" onClick={handleCancelEdit}>
                    Cancel
                  </s-button>
                </s-stack>
              </div>

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
                    zIndex: 10000,
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
                    <s-heading>Update Active Sale?</s-heading>
                    <div style={{ margin: "16px 0" }}>
                      <s-paragraph>
                        This sale is currently active. Changes will update live storefront prices:
                      </s-paragraph>
                      <ul style={{ margin: "8px 0", paddingLeft: "20px", fontSize: "14px" }}>
                        {addedProducts.length > 0 && (
                          <li>{addedProducts.length} product(s) will be discounted</li>
                        )}
                        {removedProducts.length > 0 && (
                          <li>
                            {removedProducts.length} product(s) will have prices restored
                          </li>
                        )}
                      </ul>
                    </div>
                    <s-stack direction="inline" gap="base">
                      <s-button variant="primary" tone="critical" onClick={handleSave}>
                        Confirm Update
                      </s-button>
                      <s-button variant="tertiary" onClick={() => setShowConfirm(false)}>
                        Cancel
                      </s-button>
                    </s-stack>
                  </div>
                </div>
              )}
            </div>
          ) : isLoading && !loaded ? (
            <s-box padding="large-200">
              <s-paragraph>Loading products...</s-paragraph>
            </s-box>
          ) : variants.length === 0 ? (
            <s-box padding="large-200">
              <s-paragraph>No products found for this sale.</s-paragraph>
            </s-box>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--p-color-border-subdued, #ddd)",
                    textAlign: "left",
                    position: "sticky",
                    top: 0,
                    background: "white",
                  }}
                >
                  <th style={{ padding: "10px 8px", fontWeight: 600 }}>Product</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600 }}>Variant</th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, textAlign: "right" }}>
                    Original Price
                  </th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, textAlign: "right" }}>
                    Compare-At
                  </th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, textAlign: "right" }}>
                    Sale Price
                  </th>
                  <th style={{ padding: "10px 8px", fontWeight: 600, textAlign: "right" }}>
                    Savings
                  </th>
                  <th style={{ padding: "10px 8px", fontWeight: 600 }}>URL</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v, idx) => {
                  const savings = (
                    parseFloat(v.originalPrice) - parseFloat(v.newSalePrice)
                  ).toFixed(2);
                  const url = buildProductUrl(v.productHandle, v.variantId);
                  return (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: "1px solid var(--p-color-border-subdued, #eee)",
                      }}
                    >
                      <td style={{ padding: "10px 8px" }}>{v.productTitle}</td>
                      <td style={{ padding: "10px 8px", color: "#666" }}>
                        {v.variantTitle === "Default Title" ? "—" : v.variantTitle}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right" }}>
                        {formatPrice(v.originalPrice)}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", color: "#888" }}>
                        {v.originalCompareAtPrice
                          ? formatPrice(v.originalCompareAtPrice)
                          : "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          textAlign: "right",
                          fontWeight: 600,
                          color: "#2e7d32",
                        }}
                      >
                        {formatPrice(v.newSalePrice)}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          textAlign: "right",
                          color: "#c62828",
                        }}
                      >
                        -{formatPrice(savings)}
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "#2c6ecb",
                              textDecoration: "underline",
                              fontSize: "13px",
                              wordBreak: "break-all",
                            }}
                          >
                            View
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
