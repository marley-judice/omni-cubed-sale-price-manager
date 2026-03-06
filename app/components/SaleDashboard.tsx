import { useFetcher } from "react-router";
import { useCallback, useState } from "react";

export interface SaleRow {
  id: number;
  name: string;
  discountPercentage: number;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  variantCount: number;
  productCount: number;
  status: "active" | "scheduled" | "ended" | "reverted";
}

interface SaleDashboardProps {
  sales: SaleRow[];
  onRefresh: () => void;
  onToast: (message: string, isError?: boolean) => void;
}

type BadgeTone = "success" | "warning" | "neutral" | "info" | "critical" | "caution";

function StatusBadge({ status }: { status: string }) {
  const toneMap: Record<string, BadgeTone> = {
    active: "success",
    scheduled: "warning",
    ended: "neutral",
    reverted: "neutral",
  };
  return (
    <s-badge tone={toneMap[status] || ("neutral" as BadgeTone)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </s-badge>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function SaleDashboard({
  sales,
  onRefresh,
  onToast,
}: SaleDashboardProps) {
  const fetcher = useFetcher();
  const [confirmAction, setConfirmAction] = useState<{
    type: "revert" | "activate" | "delete";
    saleId: number;
    saleName: string;
  } | null>(null);

  const isLoading = fetcher.state !== "idle";

  const handleAction = useCallback(
    (type: "revert" | "activate" | "delete", saleId: number, saleName: string) => {
      setConfirmAction({ type, saleId, saleName });
    },
    [],
  );

  const executeAction = useCallback(() => {
    if (!confirmAction) return;
    const formData = new FormData();
    formData.set("intent", confirmAction.type);
    formData.set("saleId", String(confirmAction.saleId));
    fetcher.submit(formData, {
      method: "POST",
      action: "/app/api/sales",
    });
    setConfirmAction(null);

    setTimeout(() => {
      onToast(
        `Sale "${confirmAction.saleName}" ${confirmAction.type === "revert" ? "reverted" : confirmAction.type === "activate" ? "activated" : "deleted"} successfully`,
      );
      onRefresh();
    }, 1500);
  }, [confirmAction, fetcher, onRefresh, onToast]);

  return (
    <s-section heading="Sales Dashboard">
      {sales.length === 0 ? (
        <s-box padding="large-200">
          <s-stack direction="block" gap="base">
            <s-heading>No sales yet</s-heading>
            <s-paragraph>
              Create your first sale below to start managing discounted prices.
            </s-paragraph>
          </s-stack>
        </s-box>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
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
                  }}
                >
                  <th style={{ padding: "12px 8px", fontWeight: 600 }}>Name</th>
                  <th style={{ padding: "12px 8px", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "12px 8px", fontWeight: 600 }}>Discount</th>
                  <th style={{ padding: "12px 8px", fontWeight: 600 }}>Products</th>
                  <th style={{ padding: "12px 8px", fontWeight: 600 }}>Variants</th>
                  <th style={{ padding: "12px 8px", fontWeight: 600 }}>Date Range</th>
                  <th style={{ padding: "12px 8px", fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr
                    key={sale.id}
                    style={{
                      borderBottom: "1px solid var(--p-color-border-subdued, #eee)",
                    }}
                  >
                    <td style={{ padding: "12px 8px" }}>
                      <strong>{sale.name || "Untitled"}</strong>
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <StatusBadge status={sale.status} />
                    </td>
                    <td style={{ padding: "12px 8px" }}>{sale.discountPercentage}%</td>
                    <td style={{ padding: "12px 8px" }}>{sale.productCount}</td>
                    <td style={{ padding: "12px 8px" }}>{sale.variantCount}</td>
                    <td style={{ padding: "12px 8px" }}>
                      {formatDate(sale.startDate)} → {formatDate(sale.endDate)}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <s-stack direction="inline" gap="base">
                        {sale.status === "active" && (
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() =>
                              handleAction("revert", sale.id, sale.name)
                            }
                            {...(isLoading ? { disabled: true } : {})}
                          >
                            Revert
                          </s-button>
                        )}
                        {(sale.status === "scheduled" ||
                          sale.status === "reverted") && (
                          <s-button
                            variant="tertiary"
                            onClick={() =>
                              handleAction("activate", sale.id, sale.name)
                            }
                            {...(isLoading ? { disabled: true } : {})}
                          >
                            Activate
                          </s-button>
                        )}
                        {(sale.status === "reverted" ||
                          sale.status === "ended") && (
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() =>
                              handleAction("delete", sale.id, sale.name)
                            }
                            {...(isLoading ? { disabled: true } : {})}
                          >
                            Delete
                          </s-button>
                        )}
                      </s-stack>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {confirmAction && (
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
                  {confirmAction.type === "revert"
                    ? "Revert Sale"
                    : confirmAction.type === "activate"
                      ? "Activate Sale"
                      : "Delete Sale"}
                </s-heading>
                <div style={{ margin: "16px 0" }}>
                  <s-paragraph>
                    {confirmAction.type === "revert"
                      ? `This will restore original prices for all products in "${confirmAction.saleName}". Continue?`
                      : confirmAction.type === "activate"
                        ? `This will apply discounted prices for "${confirmAction.saleName}". Continue?`
                        : `This will permanently delete "${confirmAction.saleName}". This cannot be undone.`}
                  </s-paragraph>
                </div>
                <s-stack direction="inline" gap="base">
                  <s-button
                    variant="primary"
                    tone={confirmAction.type === "delete" ? "critical" : undefined}
                    onClick={executeAction}
                  >
                    {confirmAction.type === "revert"
                      ? "Revert Prices"
                      : confirmAction.type === "activate"
                        ? "Activate Sale"
                        : "Delete Sale"}
                  </s-button>
                  <s-button
                    variant="tertiary"
                    onClick={() => setConfirmAction(null)}
                  >
                    Cancel
                  </s-button>
                </s-stack>
              </div>
            </div>
          )}
        </>
      )}
    </s-section>
  );
}
