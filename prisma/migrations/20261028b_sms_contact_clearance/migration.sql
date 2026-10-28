-- Lets an admin clear the SMS contact list so new contacts can accumulate.
--
-- USSD dialer rows are deleted outright by the endpoint (UssdDialer has a
-- unique constraint on phoneNumber+voucherType, so the row must go for a
-- returning caller to register again). Orders are never deleted - they are
-- revenue records - so each clearance records a cut-off instead, and
-- order-derived contacts rejoin campaigns only when that customer orders again.
--
-- Additive: one new table, nothing existing is touched.

-- CreateTable
CREATE TABLE `SmsContactClearance` (
    `id` VARCHAR(191) NOT NULL,
    `voucherType` ENUM('WASSCE_NOVDEC', 'BECE', 'CTVET_NABTEX') NULL,
    `clearedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `clearedById` VARCHAR(191) NULL,
    `dialersDeleted` INTEGER NOT NULL DEFAULT 0,
    `ordersExcluded` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `SmsContactClearance_voucherType_clearedAt_idx`(`voucherType`, `clearedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- AddForeignKey
ALTER TABLE `SmsContactClearance` ADD CONSTRAINT `SmsContactClearance_clearedById_fkey` FOREIGN KEY (`clearedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
