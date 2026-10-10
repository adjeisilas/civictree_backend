-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` ENUM('USER', 'ADMIN', 'AFFILIATE', 'PARTNER') NOT NULL DEFAULT 'USER',
    `password` VARCHAR(191) NOT NULL,
    `firstTimeLogin` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `twoFactorSecret` VARCHAR(512) NULL,
    `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false,
    `twoFactorLastStep` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_phoneNumber_key`(`phoneNumber`),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(512) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `isRevoked` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RefreshToken_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TwoFactorRecoveryCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TwoFactorRecoveryCode_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Otp` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `isUsed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(512) NOT NULL,
    `p256dh` VARCHAR(191) NOT NULL,
    `auth` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PushSubscription_endpoint_key`(`endpoint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `type` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AffiliateProfile` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `affiliateCode` VARCHAR(191) NOT NULL,
    `businessName` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'PENDING',
    `rejectionReason` VARCHAR(191) NULL,
    `ussdCode` VARCHAR(191) NULL,
    `payoutMethod` ENUM('MOBILE_MONEY', 'BANK_ACCOUNT') NOT NULL DEFAULT 'MOBILE_MONEY',
    `momoNetwork` VARCHAR(191) NULL,
    `momoNumber` VARCHAR(191) NULL,
    `momoAccountName` VARCHAR(191) NULL,
    `bankName` VARCHAR(191) NULL,
    `bankAccountNumber` VARCHAR(191) NULL,
    `bankAccountName` VARCHAR(191) NULL,
    `totalVouchersSold` INTEGER NOT NULL DEFAULT 0,
    `totalSalesGenerated` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `payoutDetailsUpdatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AffiliateProfile_userId_key`(`userId`),
    UNIQUE INDEX `AffiliateProfile_affiliateCode_key`(`affiliateCode`),
    UNIQUE INDEX `AffiliateProfile_ussdCode_key`(`ussdCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AffiliateConfig` (
    `id` VARCHAR(191) NOT NULL,
    `wassceNovdecCommission` DECIMAL(10, 2) NOT NULL DEFAULT 2.00,
    `beceCommission` DECIMAL(10, 2) NOT NULL DEFAULT 1.50,
    `minWithdrawalAmount` DECIMAL(10, 2) NOT NULL DEFAULT 10.00,
    `dailyWithdrawalCap` DECIMAL(10, 2) NOT NULL DEFAULT 1000.00,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AffiliateCommission` (
    `id` VARCHAR(191) NOT NULL,
    `affiliateId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `voucherType` ENUM('WASSCE_NOVDEC', 'BECE') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AffiliateCommission_orderId_key`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WithdrawalRequest` (
    `id` VARCHAR(191) NOT NULL,
    `affiliateId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `payoutMethod` ENUM('MOBILE_MONEY', 'BANK_ACCOUNT') NOT NULL,
    `accountDetails` TEXT NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `adminNote` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminWithdrawal` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `payoutMethod` ENUM('MOBILE_MONEY', 'BANK_ACCOUNT') NOT NULL,
    `accountDetails` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `transactionRef` VARCHAR(191) NULL,
    `failureReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UssdDialer` (
    `id` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `voucherType` ENUM('WASSCE_NOVDEC', 'BECE') NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'MAIN_USSD',
    `dialedCode` VARCHAR(191) NULL,
    `affiliateId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UssdDialer_phoneNumber_voucherType_idx`(`phoneNumber`, `voucherType`),
    UNIQUE INDEX `UssdDialer_phoneNumber_voucherType_key`(`phoneNumber`, `voucherType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `details` TEXT NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Voucher` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('WASSCE_NOVDEC', 'BECE') NOT NULL,
    `serialNumber` VARCHAR(191) NOT NULL,
    `pin` VARCHAR(191) NOT NULL,
    `status` ENUM('AVAILABLE', 'SOLD') NOT NULL DEFAULT 'AVAILABLE',
    `uploadHistoryId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Voucher_type_status_idx`(`type`, `status`),
    UNIQUE INDEX `Voucher_serialNumber_type_key`(`serialNumber`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VoucherConfig` (
    `id` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'GHS',
    `wassceNovdecPrice` DECIMAL(10, 2) NOT NULL,
    `wassceNovdecLimit` INTEGER NOT NULL DEFAULT 100,
    `becePrice` DECIMAL(10, 2) NOT NULL,
    `beceLimit` INTEGER NOT NULL DEFAULT 100,
    `wassceNovdecLastAlertedAt` DATETIME(3) NULL,
    `beceLastAlertedAt` DATETIME(3) NULL,
    `wassceNovdecReleaseDate` DATETIME(3) NULL,
    `beceReleaseDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VoucherUploadHistory` (
    `id` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NULL,
    `fileUrl` VARCHAR(512) NULL,
    `uploadType` VARCHAR(191) NOT NULL,
    `totalUploaded` INTEGER NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `voucherType` ENUM('WASSCE_NOVDEC', 'BECE') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `channel` ENUM('WEB', 'USSD') NOT NULL DEFAULT 'WEB',
    `paymentStatus` ENUM('PENDING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `deliveryStatus` ENUM('NOT_SENT', 'SENT', 'FAILED') NOT NULL DEFAULT 'NOT_SENT',
    `transactionId` VARCHAR(191) NULL,
    `affiliateId` VARCHAR(191) NULL,
    `affiliateCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_transactionId_key`(`transactionId`),
    INDEX `Order_paymentStatus_deliveryStatus_voucherType_idx`(`paymentStatus`, `deliveryStatus`, `voucherType`),
    INDEX `Order_affiliateId_idx`(`affiliateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Timetable` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('BECE', 'WASSCE_NOVDEC') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `examYear` INTEGER NOT NULL DEFAULT 2026,
    `startDate` DATETIME(3) NULL,
    `description` TEXT NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `fileUrl` VARCHAR(512) NULL,
    `fileName` VARCHAR(191) NULL,
    `fileSize` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Timetable_type_key`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Partner` (
    `id` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `partnerName` VARCHAR(191) NOT NULL,
    `legalEntityName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `contractRef` VARCHAR(191) NOT NULL,
    `sharePercentage` DECIMAL(5, 2) NOT NULL DEFAULT 5.0,
    `status` ENUM('Active', 'Pending', 'Suspended', 'Inactive') NOT NULL DEFAULT 'Active',
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lifetimeShareEarnings` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `withdrawnAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `availableBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Partner_partnerId_key`(`partnerId`),
    UNIQUE INDEX `Partner_email_key`(`email`),
    UNIQUE INDEX `Partner_contractRef_key`(`contractRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartnerTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `orderRef` VARCHAR(191) NOT NULL,
    `voucherType` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `grossAmount` DECIMAL(10, 2) NOT NULL,
    `partnerPercentage` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `partnerEarning` DECIMAL(10, 2) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'Web Direct',
    `paymentMethod` VARCHAR(191) NOT NULL DEFAULT 'Mobile Money',
    `settlementStatus` VARCHAR(191) NOT NULL DEFAULT 'Accrued',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PartnerTransaction_partnerId_createdAt_idx`(`partnerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartnerSettlement` (
    `id` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `fee` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `netAmount` DECIMAL(10, 2) NOT NULL,
    `payoutMethod` ENUM('MOMO', 'BANK') NOT NULL DEFAULT 'MOMO',
    `provider` VARCHAR(191) NOT NULL,
    `destinationAccount` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(191) NOT NULL,
    `status` ENUM('Pending', 'Processing', 'Completed', 'Failed', 'Rejected') NOT NULL DEFAULT 'Pending',
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `receiptUrl` VARCHAR(191) NULL,

    UNIQUE INDEX `PartnerSettlement_reference_key`(`reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartnerPayoutAccount` (
    `id` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `type` ENUM('MOMO', 'BANK') NOT NULL DEFAULT 'MOMO',
    `provider` VARCHAR(191) NOT NULL,
    `accountNumber` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartnerNotification` (
    `id` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `type` ENUM('TRANSACTION_SURGE', 'PAYOUT_STATUS', 'DAILY_DIGEST', 'CONTRACT_UPDATE', 'SYSTEM') NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `link` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartnerSetting` (
    `id` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `autoSettlementEnabled` BOOLEAN NOT NULL DEFAULT true,
    `autoSettlementThreshold` DECIMAL(10, 2) NOT NULL DEFAULT 1000.00,
    `settlementFrequency` VARCHAR(191) NOT NULL DEFAULT 'DAILY',
    `defaultPayoutAccountId` VARCHAR(191) NULL,
    `emailDailyDigest` BOOLEAN NOT NULL DEFAULT true,
    `emailPayoutAlerts` BOOLEAN NOT NULL DEFAULT true,
    `smsSurgeAlerts` BOOLEAN NOT NULL DEFAULT true,
    `smsPayoutAlerts` BOOLEAN NOT NULL DEFAULT true,
    `surgeAlertThreshold` INTEGER NOT NULL DEFAULT 50,
    `currencyDisplay` VARCHAR(191) NOT NULL DEFAULT 'GHS',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'GMT (Accra)',

    UNIQUE INDEX `PartnerSetting_partnerId_key`(`partnerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TwoFactorRecoveryCode` ADD CONSTRAINT `TwoFactorRecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Otp` ADD CONSTRAINT `Otp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AffiliateProfile` ADD CONSTRAINT `AffiliateProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AffiliateCommission` ADD CONSTRAINT `AffiliateCommission_affiliateId_fkey` FOREIGN KEY (`affiliateId`) REFERENCES `AffiliateProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AffiliateCommission` ADD CONSTRAINT `AffiliateCommission_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WithdrawalRequest` ADD CONSTRAINT `WithdrawalRequest_affiliateId_fkey` FOREIGN KEY (`affiliateId`) REFERENCES `AffiliateProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminWithdrawal` ADD CONSTRAINT `AdminWithdrawal_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UssdDialer` ADD CONSTRAINT `UssdDialer_affiliateId_fkey` FOREIGN KEY (`affiliateId`) REFERENCES `AffiliateProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Voucher` ADD CONSTRAINT `Voucher_uploadHistoryId_fkey` FOREIGN KEY (`uploadHistoryId`) REFERENCES `VoucherUploadHistory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Voucher` ADD CONSTRAINT `Voucher_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VoucherUploadHistory` ADD CONSTRAINT `VoucherUploadHistory_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_affiliateId_fkey` FOREIGN KEY (`affiliateId`) REFERENCES `AffiliateProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartnerTransaction` ADD CONSTRAINT `PartnerTransaction_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartnerSettlement` ADD CONSTRAINT `PartnerSettlement_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartnerPayoutAccount` ADD CONSTRAINT `PartnerPayoutAccount_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartnerNotification` ADD CONSTRAINT `PartnerNotification_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartnerSetting` ADD CONSTRAINT `PartnerSetting_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `Partner`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

