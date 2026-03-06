import { useEffect, useState, useCallback } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import SaleDashboard, { type SaleRow } from "../components/SaleDashboard";
import CreateSale from "../components/CreateSale";
import type { ProductWithExclusion } from "./app.api.products";

function getSaleStatus(sale: {
  active: boolean;
  startDate: Date | null;
  endDate: Date | null;
}): SaleRow["status"] {
  const now = new Date();
  if (sale.active) return "active";
  if (sale.startDate && sale.startDate > now) return "scheduled";
  if (sale.endDate && sale.endDate <= now) return "ended";
  return "reverted";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  try {
    const { startScheduler } = await import("../lib/scheduler");
    startScheduler();
  } catch {
    // Scheduler may fail in dev mode without offline sessions
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

export default function Index() {
  const { sales: initialSales } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const productsFetcher = useFetcher();
  const salesFetcher = useFetcher();

  const [sales, setSales] = useState<SaleRow[]>(initialSales);
  const [products, setProducts] = useState<ProductWithExclusion[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);

  useEffect(() => {
    if (!productsLoaded && productsFetcher.state === "idle" && !productsFetcher.data) {
      productsFetcher.load("/app/api/products");
    }
  }, [productsLoaded, productsFetcher]);

  useEffect(() => {
    if (productsFetcher.data && "products" in productsFetcher.data) {
      setProducts(productsFetcher.data.products as ProductWithExclusion[]);
      setProductsLoaded(true);
    }
  }, [productsFetcher.data]);

  const refreshSales = useCallback(() => {
    salesFetcher.load("/app/api/sales");
  }, [salesFetcher]);

  useEffect(() => {
    if (salesFetcher.data && "sales" in salesFetcher.data) {
      setSales(salesFetcher.data.sales as SaleRow[]);
    }
  }, [salesFetcher.data]);

  const handleToast = useCallback(
    (message: string, isError = false) => {
      if (isError) {
        shopify.toast.show(message, { isError: true });
      } else {
        shopify.toast.show(message);
      }
    },
    [shopify],
  );

  const handleSaleCreated = useCallback(() => {
    refreshSales();
    if (productsFetcher.state === "idle") {
      productsFetcher.load("/app/api/products");
    }
  }, [refreshSales, productsFetcher]);

  return (
    <s-page heading="Sale Price Manager">
      <s-stack direction="block" gap="large-200">
        <SaleDashboard
          sales={sales}
          onRefresh={refreshSales}
          onToast={handleToast}
        />

        <CreateSale
          products={products}
          productsLoading={!productsLoaded}
          onSaleCreated={handleSaleCreated}
          onToast={handleToast}
        />
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
