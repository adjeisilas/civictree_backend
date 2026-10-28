-- Adds CTVET/NABTEX alongside BECE and WASSCE/NOVDEC.
--
-- Purely additive: the enums are widened and the new config columns carry
-- defaults, so existing rows are untouched and no backfill is needed.
-- ctvetNabtexPrice defaults to 0.00 - set a real price in Admin > Vouchers
-- before the type is offered for sale.

-- Table names are written in schema case on purpose: MySQL on Linux is
-- case-sensitive and 0_init creates `Order`, `Voucher` and so on. A migration
-- generated against a Windows MySQL comes out lowercased and fails there.

-- AlterTable
ALTER TABLE `AffiliateCommission` MODIFY `voucherType` ENUM('WASSCE_NOVDEC', 'BECE', 'CTVET_NABTEX') NOT NULL;
-- AlterTable
ALTER TABLE `AffiliateConfig` ADD COLUMN `ctvetNabtexCommission` DECIMAL(10, 2) NOT NULL DEFAULT 1.50;
-- AlterTable
ALTER TABLE `Order` MODIFY `voucherType` ENUM('WASSCE_NOVDEC', 'BECE', 'CTVET_NABTEX') NOT NULL;
-- AlterTable
ALTER TABLE `Timetable` MODIFY `type` ENUM('BECE', 'WASSCE_NOVDEC', 'CTVET_NABTEX') NOT NULL;
-- AlterTable
ALTER TABLE `UssdDialer` MODIFY `voucherType` ENUM('WASSCE_NOVDEC', 'BECE', 'CTVET_NABTEX') NULL;
-- AlterTable
ALTER TABLE `Voucher` MODIFY `type` ENUM('WASSCE_NOVDEC', 'BECE', 'CTVET_NABTEX') NOT NULL;
-- AlterTable
ALTER TABLE `VoucherConfig` ADD COLUMN `ctvetNabtexLastAlertedAt` DATETIME(3) NULL,
    ADD COLUMN `ctvetNabtexLimit` INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN `ctvetNabtexPrice` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `ctvetNabtexReleaseDate` DATETIME(3) NULL;
