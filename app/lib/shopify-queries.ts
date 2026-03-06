export const GET_PRODUCTS_QUERY = `#graphql
  query GetProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      edges {
        node {
          id
          title
          featuredImage {
            url
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
              }
            }
          }
          collections(first: 20) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const BULK_UPDATE_VARIANTS_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const GET_VARIANT_CURRENT_PRICES_QUERY = `#graphql
  query GetVariantPrices($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        price
        compareAtPrice
      }
    }
  }
`;

export interface ShopifyProduct {
  id: string;
  title: string;
  featuredImage: { url: string } | null;
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        compareAtPrice: string | null;
      };
    }>;
  };
  collections: {
    edges: Array<{
      node: {
        id: string;
        title: string;
      };
    }>;
  };
}

export interface ProductsQueryResult {
  products: {
    edges: Array<{ node: ShopifyProduct }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}
