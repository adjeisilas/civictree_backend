import express from "express";
import config from "./config/config.js";
import dotenv from "dotenv";
import { customError } from "./utils/error/custom_error.js";
import cors from "cors";
import helmet from "helmet";
import { globalLimiter } from "./middlewares/security/rateLimiters.js";
import { logger, requestLogger } from "./utils/logger.js";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import authRouter from "./routes/auth/authRoutes.js";
import notificationRouter from "./routes/admin/notificationRoutes.js";
import activityLogRouter from "./routes/admin/activityLogRoutes.js";
import userRouter from "./routes/admin/userRoutes.js";
import voucherRouter from "./routes/admin/voucherRoutes.js";
import publicVoucherRouter from "./routes/public/voucherRoutes.js";
import publicOrderRouter from "./routes/public/orderRoutes.js";
import publicUssdRouter from "./routes/public/ussdRoutes.js";
import publicPurchaseRouter from "./routes/public/purchaseRoutes.js";
import publicPayoutRouter from "./routes/public/payoutRoutes.js";
import adminOrderRouter from "./routes/admin/orderRoutes.js";
import adminCustomerRouter from "./routes/admin/customerRoutes.js";
import adminSmsRouter from "./routes/admin/smsRoutes.js";
import adminDashboardRouter from "./routes/admin/dashboardRoutes.js";
import adminReportRouter from "./routes/admin/reportRoutes.js";
import publicTimetableRouter from "./routes/public/timetableRoutes.js";
import adminTimetableRouter from "./routes/admin/timetableRoutes.js";
import affiliateUssdRouter from "./routes/public/affiliateUssdRoutes.js";
import affiliatePortalRouter from "./routes/affiliate/affiliateRoutes.js";
import adminAffiliateRouter from "./routes/admin/affiliateRoutes.js";
import partnerAuthRouter from "./routes/auth/partnerAuthRoutes.js";
import partnerPortalRouter from "./routes/partner/partnerPortalRoutes.js";
import partnerAdminRouter from "./routes/admin/partnerAdminRoutes.js";
import { initCronJobs } from "./utils/cron/cronJobs.js";
import { runStartupChecks } from "./utils/startupChecks.js";
import healthRouter from "./routes/public/healthRoutes.js";

// Configuring environment variables
dotenv.config();

// Setting the port for the server to listen on
const PORT = process.env.PORT || 5000;

// Initializing express
const app = express();

// Number of reverse proxies in front of the app (default 1), so req.ip is the real client IP.
// Hubtel IP checks and activity logs depend on this. Set TRUST_PROXY=0 if the app is reached directly.
const trustProxy = process.env.TRUST_PROXY ?? '1';
const parseTrustProxy = (value) => {
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (value === 'true' || value === 'false') return value === 'true';
    return value; // e.g. 'loopback' or a list of proxy IPs
};
app.set('trust proxy', parseTrustProxy(trustProxy));

const isProduction = process.env.NODE_ENV === 'production';

// Security headers (Swagger UI needs inline scripts, so /docs skips the content security policy)
const apiHelmet = helmet();
const docsHelmet = helmet({ contentSecurityPolicy: false });
app.use((req, res, next) => (req.path.startsWith('/docs') ? docsHelmet : apiHelmet)(req, res, next));

// app middleware for json and form data (small bodies only; file uploads go through multer)
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// CORS: only our own web apps may call the API from a browser.
// Extra origins can be added with CORS_ORIGINS (comma-separated).
const allowedOrigins = new Set([
    config.frontendUrl,
    config.frontendUrl.replace('://', '://www.'),
    ...(process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
    ...(isProduction ? [] : ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173'])
]);

app.use(cors({
    origin: (origin, callback) => {
        // Requests without an Origin header (Hubtel, server-to-server, curl) are not subject to CORS
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Health check: ahead of the limiter so frequent polling is never throttled,
// and ahead of the request log so it does not drown out real traffic
app.use("/api/health", healthRouter);

// Request id + one log line per request, with sensitive fields redacted
app.use(requestLogger);

// Baseline rate limit for all routes (Hubtel callback and USSD routes are exempt)
app.use(globalLimiter);

// Serve Swagger API documentation outside production only (ENABLE_API_DOCS=true to force it on)
if (!isProduction || process.env.ENABLE_API_DOCS === 'true') {
    const swaggerDocument = JSON.parse(
        fs.readFileSync(new URL("./swagger-output.json", import.meta.url))
    );
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

// Authentication routes
app.use("/api/auth", authRouter);
app.use("/api/auth/partner", partnerAuthRouter);

// Notification routes
app.use("/api/notifications", notificationRouter);

// Activity log routes
app.use("/api/activity-logs", activityLogRouter);

// User management routes
app.use("/api/users", userRouter);

// Voucher management routes
app.use("/api/vouchers", publicVoucherRouter);
app.use("/api/vouchers", voucherRouter);

// Public timetable routes
app.use("/api/timetables", publicTimetableRouter);

// Admin timetable routes
app.use("/api/admin/timetables", adminTimetableRouter);

// Public voucher purchase order routes
app.use("/api/orders", publicOrderRouter);

// Public USSD routes
app.use("/api/ussd", publicUssdRouter);

// Public purchase verification routes
app.use("/api/public/purchase", publicPurchaseRouter);

// Hubtel payout (Send Money) status callbacks
app.use("/api/payouts", publicPayoutRouter);

// Admin order management and stats routes
app.use("/api/admin/orders", adminOrderRouter);

// Admin customer management routes
app.use("/api/admin/customers", adminCustomerRouter);

// Admin SMS campaign routes
app.use("/api/admin/sms", adminSmsRouter);

// Admin dashboard stats routes
app.use("/api/admin/dashboard", adminDashboardRouter);

// Admin reports stats routes
app.use("/api/admin/reports", adminReportRouter);

// Affiliate USSD routes
app.use("/api/ussd/affiliate", affiliateUssdRouter);

// Affiliate portal routes
app.use("/api/affiliate", affiliatePortalRouter);

// Admin affiliate management routes
app.use("/api/admin/affiliates", adminAffiliateRouter);

// Partner portal routes (supports both /api/partner and /api/v1/partner)
// app.use("/api/partner", partnerPortalRouter);
// app.use("/api/v1/partner", partnerPortalRouter);

// Admin partner management routes
app.use("/api/admin/partners", partnerAdminRouter);





// Default route for testing server
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Welcome to CivicTree Backed API',
        version: '1.0.0',
        data: {
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'Production',
        }
    });
});


// Error handling middleware
app.use(customError);


// Checked before the port is opened, so a misconfigured release never serves traffic
runStartupChecks(logger);

app.listen(PORT || 5000, () => {
    console.log(`Server is running on port ${PORT}`);
    initCronJobs();
});