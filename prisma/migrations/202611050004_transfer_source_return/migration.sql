-- AlterTable
ALTER TABLE "TransferLine" ADD COLUMN     "returned" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TransferReceipt" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'DESTINATION_RECEIPT';

-- AlterTable
ALTER TABLE "TransferReceiptLine" ADD COLUMN     "returned" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TransferLine" DROP CONSTRAINT "transfer_quantity_valid";
ALTER TABLE "TransferLine" ADD CONSTRAINT "transfer_quantity_valid" CHECK (planned > 0 AND sent BETWEEN 0 AND planned AND "receivedSellable" >= 0 AND "receivedUnavailable" >= 0 AND lost >= 0 AND returned >= 0 AND "receivedSellable"::bigint + "receivedUnavailable" + lost + returned <= sent);
ALTER TABLE "TransferReceiptLine" DROP CONSTRAINT "receipt_quantity_valid";
ALTER TABLE "TransferReceiptLine" ADD CONSTRAINT "receipt_quantity_valid" CHECK (sellable >= 0 AND unavailable >= 0 AND lost >= 0 AND returned >= 0 AND sellable::bigint + unavailable + lost + returned > 0);
ALTER TABLE "TransferReceipt" ADD CONSTRAINT "receipt_kind_valid" CHECK (kind IN ('DESTINATION_RECEIPT','SOURCE_RETURN'));
