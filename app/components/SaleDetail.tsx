import { useFetcher } from "react-router";
import { useEffect, useState, useCallback } from "react";
import type { SaleVariantRow } from "../routes/app.api.sales";

interface SaleDetailProps {
  saleId: number;
  saleName: string;
  discountPercentage: number;
  onClose: () => void;
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
  onClose,
}: SaleDetailProps) {
  const fetcher = useFetcher();
  const [variants, setVariants] = useState<SaleVariantRow[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  const handleExportCsv = useCallback(() => {
    const csv = buildCsv(variants, saleName, discountPercentage);
    const safeFilename = saleName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    downloadCsv(csv, `${safeFilename}_products.csv`);
  }, [variants, saleName, discountPercentage]);

  const isLoading = fetcher.state !== "idle";

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
            <s-button
              variant="primary"
              onClick={handleExportCsv}
              {...(isLoading || variants.length === 0 ? { disabled: true } : {})}
            >
              Export CSV
            </s-button>
            <s-button variant="tertiary" onClick={onClose}>
              Close
            </s-button>
          </s-stack>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {isLoading && !loaded ? (
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
