import swaggerAutogen from 'swagger-autogen';

const doc = {
  info: {
    title: 'CivicTree Backend API',
    description: 'Auto-generated API documentation for CivicTree Backend services',
    version: '1.0.0'
  },
  servers: [
    {
      url: '/'
    }
  ],
  tags: [
    { name: 'Partner Auth', description: 'Partner Authentication Endpoints' },
    { name: 'Partner Portal', description: 'Partner Portal Dashboard, Analytics, Ledger, Payouts, Profile & Settings' },
    { name: 'Admin - Partner Management', description: 'Admin Management for Partner Accounts' }
  ],
  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Enter your bearer token in the format: Bearer <token>'
    }
  },
  components: {
    schemas: {
      LoginRequest: {
        email: 'user@example.com',
        password: 'Password123'
      },
      LoginResponse: {
        success: true,
        message: 'Login successful',
        data: {
          accessToken: 'access_token_here',
          refreshToken: 'refresh_token_here',
          user: {
            id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
            fullName: 'John Doe',
            email: 'user@example.com',
            role: 'USER',
            firstTimeLogin: true,
            isActive: true,
            createdAt: '2026-06-05T20:00:00.000Z',
            updatedAt: '2026-06-05T20:00:00.000Z'
          }
        }
      },
      RefreshRequest: {
        refreshToken: 'refresh_token_here'
      },
      RefreshResponse: {
        success: true,
        message: 'Tokens refreshed successfully',
        data: {
          accessToken: 'new_access_token_here',
          refreshToken: 'new_refresh_token_here'
        }
      },
      LogoutRequest: {
        refreshToken: 'refresh_token_here'
      },
      LogoutResponse: {
        success: true,
        message: 'Logged out successfully'
      },
      ForgotPasswordRequest: {
        email: 'user@example.com'
      },
      ForgotPasswordResponse: {
        success: true,
        message: 'OTP sent successfully to your email.'
      },
      ValidateOtpRequest: {
        email: 'user@example.com',
        otp: '123456'
      },
      ValidateOtpResponse: {
        success: true,
        message: 'OTP validated successfully.'
      },
      ResetPasswordRequest: {
        email: 'user@example.com',
        otp: '123456',
        newPassword: 'NewPassword123',
        confirmPassword: 'NewPassword123'
      },
      ResetPasswordResponse: {
        success: true,
        message: 'Password reset successfully. You can now log in.'
      },
      CreateVoucherConfigRequest: {
        currency: 'GHS',
        wassceNovdecPrice: 30.00,
        wassceNovdecLimit: 100,
        becePrice: 30.00,
        beceLimit: 100
      },
      VoucherConfigResponse: {
        success: true,
        message: 'Voucher configuration created/updated successfully.',
        data: {
          id: 'config-uuid',
          currency: 'GHS',
          wassceNovdecPrice: 30.00,
          wassceNovdecLimit: 100,
          becePrice: 30.00,
          beceLimit: 100,
          wassceNovdecLastAlertedAt: '2026-06-08T00:00:00.000Z',
          beceLastAlertedAt: '2026-06-08T00:00:00.000Z',
          createdAt: '2026-06-08T00:00:00.000Z',
          updatedAt: '2026-06-08T00:00:00.000Z'
        }
      },
      UploadVoucherSingleRequest: {
        type: 'WASSCE',
        serialNumber: 'W-123456',
        pin: '1234567890'
      },
      VoucherResponse: {
        success: true,
        message: 'Voucher processed successfully.',
        data: {
          id: 'voucher-uuid',
          type: 'WASSCE',
          serialNumber: 'W-123456',
          pin: '1234567890',
          status: 'AVAILABLE',
          uploadHistoryId: 'history-uuid',
          orderId: 'order-uuid',
          createdAt: '2026-06-08T00:00:00.000Z',
          updatedAt: '2026-06-08T00:00:00.000Z'
        }
      },
      VoucherUploadBulkResponse: {
        success: true,
        message: 'Successfully uploaded 50 vouchers.',
        data: {
          filename: 'vouchers.xlsx',
          fileUrl: 'https://cloudinary.com/...',
          totalUploaded: 50,
          uploadType: 'BULK_EXCEL'
        }
      },
      VoucherCheckBulkDuplicatesResponse: {
        success: true,
        message: 'File check completed. Found 5 duplicates out of 55 records.',
        data: {
          totalParsed: 55,
          totalUnique: 50,
          totalDuplicates: 5,
          duplicates: {
            database: [
              { serialNumber: 'SN12345', pin: '12345678' }
            ],
            local: [
              { serialNumber: 'SN67890', pin: '87654321' }
            ]
          }
        }
      },
      VoucherOverviewResponse: {
        success: true,
        data: {
          totalVouchers: 150,
          availableVouchers: 100,
          soldVouchers: 50,
          byType: {
            WASSCE: { total: 50, available: 30, sold: 20 },
            BECE: { total: 50, available: 40, sold: 10 },
            NOVDEC: { total: 50, available: 30, sold: 20 }
          }
        }
      },
      VoucherHistoryListResponse: {
        success: true,
        data: [
          {
            id: 'history-uuid',
            filename: 'vouchers.xlsx',
            fileUrl: 'https://cloudinary.com/...',
            uploadType: 'BULK_EXCEL',
            totalUploaded: 50,
            uploadedById: 'user-uuid',
            createdAt: '2026-06-08T00:00:00.000Z'
          }
        ]
      },
      CreateOrderRequest: {
        voucherType: 'WASSCE',
        quantity: 2,
        phoneNumber: '0241234567',
        customerName: 'John Doe',
        channel: 'WEB'
      },
      CreateOrderResponse: {
        success: true,
        message: 'Order initiated successfully. Redirect to checkout URL to complete payment.',
        data: {
          orderId: '#CT-1001',
          checkoutUrl: 'https://pay.hubtel.com/checkout/invoice-uuid',
          amount: 60.00,
          quantity: 2,
          voucherType: 'WASSCE'
        }
      },
      OrderDetailsResponse: {
        success: true,
        message: 'Order details retrieved successfully.',
        data: {
          id: '#CT-1001',
          customerName: 'John Doe',
          phoneNumber: '0241234567',
          voucherType: 'WASSCE',
          quantity: 2,
          amount: 60.00,
          channel: 'WEB',
          paymentStatus: 'SUCCESS',
          deliveryStatus: 'SENT',
          transactionId: 'checkout-txn-uuid',
          createdAt: '2026-06-08T00:00:00.000Z',
          updatedAt: '2026-06-08T00:00:00.000Z',
          vouchers: [
            {
              id: 'voucher-uuid',
              type: 'WASSCE',
              serialNumber: 'W-123456',
              pin: '1234567890',
              status: 'SOLD'
            }
          ]
        }
      },
      OrdersListResponse: {
        success: true,
        message: 'Orders retrieved successfully.',
        data: {
          orders: [
            {
              id: '#CT-1001',
              customerName: 'John Doe',
              phoneNumber: '0241234567',
              voucherType: 'WASSCE',
              quantity: 2,
              amount: 60.00,
              channel: 'WEB',
              paymentStatus: 'SUCCESS',
              deliveryStatus: 'SENT',
              createdAt: '2026-06-08T00:00:00.000Z',
              vouchers: [
                {
                  id: 'voucher-uuid',
                  serialNumber: 'W-123456',
                  status: 'SOLD'
                }
              ]
            }
          ],
          pagination: {
            total: 1,
            page: 1,
            limit: 10,
            totalPages: 1
          }
        }
      },
      OrderStatsResponse: {
        success: true,
        message: 'Order statistics generated successfully.',
        data: {
          summary: {
            totalRevenue: 60.00,
            totalVouchersSold: 2,
            totalCompletedOrders: 1,
            totalOrders: 5,
            totalOrdersSuccessful: 1,
            totalOrdersPending: 2,
            totalOrdersFailed: 2
          },
          byVoucherType: {
            WASSCE: 2,
            BECE: 0,
            NOVDEC: 0
          },
          byChannel: {
            WEB: 1,
            USSD: 0
          },
          deliverySuccessRate: {
            SENT: 1,
            FAILED: 0,
            NOT_SENT: 0
          }
        }
      },
      CustomerProfile: {
        phoneNumber: '0241234567',
        name: 'John Doe',
        status: 'active',
        totalOrdersCount: 5,
        lifetimeSpent: 150.00,
        firstPurchaseDate: '2026-06-08T00:00:00.000Z',
        lastPurchasedDate: '2026-06-09T00:00:00.000Z',
        purchasedVoucherTypes: ['WASSCE', 'BECE'],
        usedChannels: ['WEB', 'USSD'],
        totalQuantity: 5,
        defaultPaymentChannel: 'hubtel'
      },
      CustomerListResponse: {
        success: true,
        results: 1,
        pagination: {
          page: 1,
          limit: 10,
          totalResults: 1,
          totalPages: 1
        },
        data: [
          {
            $ref: '#/components/schemas/CustomerProfile'
          }
        ]
      },
      DashboardStatsResponse: {
        success: true,
        data: {
          totalRevenue: 15450.50,
          totalOrders: 120,
          totalSuccessfulOrders: 100,
          totalFailedOrders: 15,
          totalPendingOrders: 5,
          totalVoucherStock: 430,
          totalCustomers: 45,
          totalSmsDelivered: 95,
          averageOrderValue: 154.51,
          revenueTrends: [
            { month: 'Jan', revenue: 1200.00 }
          ],
          voucherSalesCountByType: {
            WASSCE: 40,
            BECE: 35,
            NOVDEC: 25
          },
          ordersCountByChannel: {
            WEB: 80,
            USSD: 40
          },
          dailyOrdersCount: [
            { day: 'Sun', count: 10 }
          ],
          recentOrders: [],
          voucherStockStatus: {
            WASSCE: {
              available: 240,
              sold: 760,
              total: 1000,
              allocatedPercent: 76.0,
              remainingPercent: 24.0,
              isLowStock: false
            }
          },
          recentActivityLogs: []
        }
      },
      ReportStatsResponse: {
        success: true,
        data: [
          {
            month: 'Jan',
            year: 2026,
            revenue: { WASSCE: 2700.00, BECE: 1000.00, NOVDEC: 600.00 },
            orderRates: { successRate: 85.5, failureRate: 12.3 },
            customers: { new: 150, returning: 75 },
            channels: { WEB: 150, USSD: 75 }
          },
          {
            month: 'Feb',
            year: 2026,
            revenue: { WASSCE: 3000.00, BECE: 1200.00, NOVDEC: 700.00 },
            orderRates: { successRate: 87.0, failureRate: 10.5 },
            customers: { new: 180, returning: 120 },
            channels: { WEB: 200, USSD: 100 }
          },
          {
            month: 'Mar',
            year: 2026,
            revenue: { WASSCE: 4200.00, BECE: 1600.00, NOVDEC: 900.00 },
            orderRates: { successRate: 83.5, failureRate: 14.0 },
            customers: { new: 220, returning: 150 },
            channels: { WEB: 250, USSD: 120 }
          },
          {
            month: 'Apr',
            year: 2026,
            revenue: { WASSCE: 3600.00, BECE: 1300.00, NOVDEC: 750.00 },
            orderRates: { successRate: 89.0, failureRate: 9.0 },
            customers: { new: 200, returning: 175 },
            channels: { WEB: 220, USSD: 155 }
          },
          {
            month: 'May',
            year: 2026,
            revenue: { WASSCE: 4800.00, BECE: 2000.00, NOVDEC: 1200.00 },
            orderRates: { successRate: 90.0, failureRate: 8.0 },
            customers: { new: 260, returning: 220 },
            channels: { WEB: 300, USSD: 180 }
          },
          {
            month: 'Jun',
            year: 2026,
            revenue: { WASSCE: 3100.00, BECE: 1200.00, NOVDEC: 680.00 },
            orderRates: { successRate: 90.5, failureRate: 7.5 },
            customers: { new: 170, returning: 210 },
            channels: { WEB: 210, USSD: 170 }
          }
        ]
      },
      CustomerStatsResponse: {
        success: true,
        data: {
          totalCustomers: 120,
          totalCustomersUssd: 80,
          totalCustomersWeb: 40
        }
      },
      PublicVoucherConfigResponse: {
        success: true,
        data: {
          currency: 'GHS',
          wassceNovdecPrice: 150.00,
          wassceNovdecHasReachedLimit: false,
          becePrice: 80.00,
          beceHasReachedLimit: false
        }
      },
      TimetableItem: {
        id: 'uuid-1234',
        type: 'BECE',
        title: "BECE '26 Timetable",
        examYear: 2026,
        startDate: '2026-06-01T00:00:00.000Z',
        description: 'Official WAEC BECE 2026 timetable. All 10 subjects, dates, and times in one PDF.',
        isPublished: true,
        fileUrl: 'https://res.cloudinary.com/.../becetimetable2026.pdf',
        fileName: 'becetimetable2026.pdf',
        fileSize: '1.2 MB',
        createdAt: '2026-07-27T12:00:00.000Z',
        updatedAt: '2026-07-27T12:00:00.000Z'
      },
      TimetablesListResponse: {
        success: true,
        message: 'Timetables retrieved successfully.',
        data: [
          {
            $ref: '#/components/schemas/TimetableItem'
          }
        ]
      },
      UpdateTimetableRequest: {
        title: "BECE '26 Timetable",
        examYear: 2026,
        startDate: '2026-06-01',
        description: 'Official WAEC BECE 2026 timetable. All 10 subjects, dates, and times in one PDF.',
        isPublished: true
      },
      VerifyPaymentResponse: {
        success: true,
        status: 'SUCCESS',
        message: 'Payment verified successfully.',
        data: {
          orderId: '#CT-1001',
          paymentStatus: 'SUCCESS',
          deliveryStatus: 'SENT'
        }
      },
      ErrorResponse: {
        success: false,
        message: 'Error message details'
      },
      AffiliateProfileItem: {
        id: 'aff-uuid-1234',
        userId: 'user-uuid-1234',
        affiliateCode: 'AFF-1001',
        businessName: 'JM Sales',
        location: 'Accra, Greater Accra',
        status: 'APPROVED',
        rejectionReason: null,
        ussdCode: '*713*001#',
        payoutMethod: 'MOBILE_MONEY',
        momoNetwork: 'MTN',
        momoNumber: '0241234567',
        momoAccountName: 'John Mensah',
        bankName: null,
        bankAccountNumber: null,
        bankAccountName: null,
        totalVouchersSold: 150,
        totalSalesGenerated: 7500.00
      },
      AffiliateDashboardMetrics: {
        affiliateCode: 'AFF-1001',
        businessName: 'JM Sales',
        ussdCode: '*713*001#',
        status: 'APPROVED',
        totalVouchersSold: 150,
        approvedCommission: 300.00,
        withdrawnAmount: 200.00,
        pendingWithdrawalAmount: 50.00,
        availableBalance: 50.00,
        recentOrders: [
          {
            id: "order-uuid-1001",
            customerName: "Kofi Mensah",
            phoneNumber: "0245001122",
            voucherType: "BECE",
            quantity: 2,
            amount: 60.00,
            channel: "USSD",
            paymentStatus: "SUCCESS",
            deliveryStatus: "SENT",
            createdAt: "2026-08-18T12:00:00.000Z",
            commission: {
              amount: 3.00,
              createdAt: "2026-08-18T12:00:00.000Z"
            }
          }
        ]
      },
      AffiliateConfigItem: {
        id: 'config-uuid-1234',
        wassceNovdecCommission: 2.00,
        beceCommission: 1.50,
        minWithdrawalAmount: 10.00,
        dailyWithdrawalCap: 1000.00
      },
      WithdrawalRequestItem: {
        id: 'withdraw-uuid-1234',
        affiliateId: 'aff-uuid-1234',
        amount: 150.00,
        payoutMethod: 'MOBILE_MONEY',
        accountDetails: '{"method":"MOBILE_MONEY","network":"MTN","number":"0241234567","accountName":"John Mensah"}',
        status: 'PENDING',
        adminNote: null,
        processedAt: null,
        createdAt: '2026-07-27T14:00:00.000Z'
      },
      PartnerLoginRequest: {
        email: 'partner@example.com',
        password: 'your-partner-password'
      },
      PartnerDashboardOverview: {
        partnerId: 'PRT-8801',
        partnerName: 'BOATENG OWUSU',
        contractRef: 'CTR-REV-2026-01',
        sharePercentage: 10.0,
        lifetimeGrossVolume: 461250.00,
        lifetimeShareEarnings: 23062.50,
        availableBalance: 8450.00,
        withdrawnAmount: 18500.00,
        totalVouchersSold: 18450,
        todayEarnings: 95.00,
        todayVouchersSold: 95,
        todayGrossVolume: 2850.00,
        mtdEarnings: 2812.00,
        mtdGrowthPercentage: 24.6,
        avgEarningPerVoucher: 1.00
      },
      PartnerTransactionItem: {
        id: 'tx-uuid-101',
        orderRef: '#CT-1001-A8F9',
        voucherType: 'BECE',
        quantity: 2,
        unitPrice: 30.00,
        grossAmount: 60.00,
        partnerPercentage: 10.0,
        partnerEarning: 3.00,
        channel: 'Web Direct',
        paymentMethod: 'Mobile Money',
        settlementStatus: 'Accrued',
        createdAt: '2026-09-01T21:05:00.000Z'
      },
      PartnerSettlementItem: {
        id: 'set-uuid-301',
        reference: 'PAY20260901DEZX',
        amount: 1200.00,
        fee: 0.00,
        netAmount: 1200.00,
        payoutMethod: 'MOMO',
        provider: 'MTN Mobile Money',
        destinationAccount: '0599745043',
        accountName: 'BOATENG OWUSU',
        status: 'Completed',
        requestedAt: '2026-09-01T23:55:00.000Z',
        processedAt: '2026-09-01T23:55:05.000Z'
      },
      PartnerPayoutAccountItem: {
        id: 'pm-uuid-1',
        type: 'MOMO',
        provider: 'MTN Mobile Money',
        accountNumber: '0599745043',
        accountName: 'BOATENG OWUSU',
        isDefault: true
      },
      PartnerNotificationItem: {
        id: 'notif-uuid-1',
        title: 'Daily Revenue Settlement (Completed)',
        message: 'Your daily settlement of GHS 142.50 for 95 vouchers sold today has been processed to 0599745043.',
        type: 'PAYOUT_STATUS',
        isRead: false,
        link: '/partner/settlements',
        createdAt: '2026-09-01T23:55:00.000Z'
      },
      PartnerProfileItem: {
        id: 'prt-uuid-8801',
        partnerId: 'PRT-8801',
        partnerName: 'BOATENG OWUSU',
        legalEntityName: 'Boateng Owusu Enterprise',
        email: 'partner@example.com',
        phone: '0599745043',
        contractRef: 'CTR-REV-2026-01',
        sharePercentage: 10.0,
        status: 'Active',
        lifetimeShareEarnings: 23062.50,
        withdrawnAmount: 18500.00,
        pendingWithdrawalAmount: 1200.00,
        availableBalance: 3362.50
      },
      PartnerSettingsItem: {
        autoSettlementEnabled: true,
        autoSettlementThreshold: 1000.00,
        settlementFrequency: 'DAILY',
        defaultPayoutAccountId: 'pm-uuid-1',
        emailDailyDigest: true,
        emailPayoutAlerts: true,
        smsSurgeAlerts: true,
        smsPayoutAlerts: true
      }
    }
  }
};

const outputFile = './swagger-output.json';
const endpointsFiles = ['./server.js'];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, endpointsFiles, doc).then(() => {
  console.log('Swagger documentation generated successfully!');
});


