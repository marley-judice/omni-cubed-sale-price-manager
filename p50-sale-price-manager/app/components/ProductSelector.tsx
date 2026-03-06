import { useState, useMemo, useCallback } from "react";
import type { ProductWithExclusion } from "../routes/app.api.products";

interface ProductSelectorProps {
  products: ProductWithExclusion[];
  selectedProductIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  loading?: boolean;
}

export default function ProductSelector({
  products,
  selectedProductIds,
  onSelectionChange,
  loading,
}: ProductSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter((p) => p.title.toLowerCase().includes(q));
  }, [products, searchQuery]);

  const eligibleProducts = useMemo(
    () => products.filter((p) => !p.excluded),
    [products],
  );

  const eligibleFilteredProducts = useMemo(
    () => filteredProducts.filter((p) => !p.excluded),
    [filteredProducts],
  );

  const handleToggle = useCallback(
    (productId: string) => {
      const next = new Set(selectedProductIds);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      onSelectionChange(next);
    },
    [selectedProductIds, onSelectionChange],
  );

  const handleSelectAllEligible = useCallback(() => {
    const next = new Set(selectedProductIds);
    for (const p of eligibleProducts) {
      next.add(p.id);
    }
    onSelectionChange(next);
  }, [eligibleProducts, selectedProductIds, onSelectionChange]);

  const handleClearSelection = useCallback(() => {
    onSelectionChange(new Set());
  }, [onSelectionChange]);

  const formatPrice = (product: ProductWithExclusion) => {
    const variants = product.variants.edges;
    if (variants.length === 0) return "—";
    if (variants.length === 1) return `$${variants[0].node.price}`;
    const prices = variants.map((v) => parseFloat(v.node.price));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return `$${min.toFixed(2)}`;
    return `$${min.toFixed(2)} – $${max.toFixed(2)}`;
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <s-spinner size="large" />
        <s-paragraph>Loading products from Shopify...</s-paragraph>
      </div>
    );
  }

  return (
    <div>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base">
          <div style={{ flex: 1 }}>
            <s-text-field
              label="Search products"
              value={searchQuery}
              placeholder="Filter by product name..."
              onInput={(e: Event) =>
                setSearchQuery((e.target as HTMLInputElement).value)
              }
            />
          </div>
          <s-button onClick={handleSelectAllEligible} variant="tertiary">
            Select All Eligible ({eligibleProducts.length})
          </s-button>
          <s-button onClick={handleClearSelection} variant="tertiary">
            Clear Selection
          </s-button>
        </s-stack>

        <s-paragraph>
          <strong>{selectedProductIds.size}</strong> of {products.length} products
          selected · {products.length - eligibleProducts.length} auto-excluded
        </s-paragraph>

        <div
          style={{
            maxHeight: "400px",
            overflowY: "auto",
            border: "1px solid var(--p-color-border-subdued, #ddd)",
            borderRadius: "8px",
          }}
        >
          {filteredProducts.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center" }}>
              <s-paragraph>
                {searchQuery
                  ? "No products match your search."
                  : "No products found in the store."}
              </s-paragraph>
            </div>
          ) : (
            filteredProducts.map((product) => {
              const isSelected = selectedProductIds.has(product.id);
              const variantCount = product.variants.edges.length;

              return (
                <div
                  key={product.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--p-color-border-subdued, #eee)",
                    opacity: product.excluded ? 0.6 : 1,
                    background: isSelected
                      ? "var(--p-color-bg-surface-selected, #f0f7ff)"
                      : "transparent",
                    cursor: "pointer",
                  }}
                  onClick={() => handleToggle(product.id)}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggle(product.id)}
                    style={{
                      width: "18px",
                      height: "18px",
                      flexShrink: 0,
                      cursor: "pointer",
                    }}
                  />

                  {product.featuredImage?.url ? (
                    <img
                      src={product.featuredImage.url}
                      alt=""
                      style={{
                        width: "40px",
                        height: "40px",
                        objectFit: "cover",
                        borderRadius: "4px",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        background: "#f0f0f0",
                        borderRadius: "4px",
                        flexShrink: 0,
                      }}
                    />
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 500,
                        fontSize: "14px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {product.title}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#666",
                        display: "flex",
                        gap: "8px",
                        flexWrap: "wrap",
                        marginTop: "2px",
                      }}
                    >
                      <span>{formatPrice(product)}</span>
                      <span>·</span>
                      <span>
                        {variantCount} variant{variantCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "4px",
                      flexShrink: 0,
                      flexWrap: "wrap",
                      justifyContent: "flex-end",
                    }}
                  >
                    {product.excluded && product.exclusionReason && (
                      <s-badge tone="critical">{product.exclusionReason}</s-badge>
                    )}
                    {!product.excluded &&
                      product.variants.edges.some(
                        (v) =>
                          v.node.compareAtPrice &&
                          v.node.compareAtPrice !== "0" &&
                          v.node.compareAtPrice !== "0.00",
                      ) && <s-badge tone="warning">Has Compare-At</s-badge>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </s-stack>
    </div>
  );
}
