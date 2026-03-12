-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SaleVariant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "saleId" INTEGER NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL DEFAULT '',
    "productHandle" TEXT NOT NULL DEFAULT '',
    "variantTitle" TEXT NOT NULL DEFAULT '',
    "originalPrice" TEXT NOT NULL,
    "originalCompareAtPrice" TEXT,
    "newSalePrice" TEXT NOT NULL,
    "appliedAt" DATETIME,
    "revertedAt" DATETIME,
    CONSTRAINT "SaleVariant_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SaleVariant" ("appliedAt", "id", "newSalePrice", "originalCompareAtPrice", "originalPrice", "productId", "productTitle", "revertedAt", "saleId", "variantId", "variantTitle") SELECT "appliedAt", "id", "newSalePrice", "originalCompareAtPrice", "originalPrice", "productId", "productTitle", "revertedAt", "saleId", "variantId", "variantTitle" FROM "SaleVariant";
DROP TABLE "SaleVariant";
ALTER TABLE "new_SaleVariant" RENAME TO "SaleVariant";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
