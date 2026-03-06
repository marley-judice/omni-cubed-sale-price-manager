import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  GET_PRODUCTS_QUERY,
  type ProductsQueryResult,
  type ShopifyProduct,
} from "../lib/shopify-queries";
import { isProductExcluded } from "../lib/sale-engine";

export interface ProductWithExclusion extends ShopifyProduct {
  excluded: boolean;
  exclusionReason: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const allProducts: ShopifyProduct[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(GET_PRODUCTS_QUERY, {
      variables: { cursor },
    });
    const json = await response.json();
    const { products } = json.data as ProductsQueryResult;

    for (const edge of products.edges) {
      allProducts.push(edge.node);
    }

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  const productsWithExclusion: ProductWithExclusion[] = allProducts.map(
    (product) => {
      const { excluded, reason } = isProductExcluded(product);
      return { ...product, excluded, exclusionReason: reason };
    },
  );

  return { products: productsWithExclusion };
};
