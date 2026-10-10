// the error middleware will catch any error thrown in the application and send a response to the client with the error message and status code
import crypto from "crypto";
import "dotenv/config";
import { logger } from "../logger.js";

const GENERIC_SERVER_ERROR = 'Something went wrong on our side. Please try again later.';

const customError = (err, req, res, next) => {
    // Extract error details with defaults
    let statusCode = err.statusCode || err.status || 500;
    let message = err.message || 'Internal Server Error';
    const isOperational = err.isOperational || false;

    // Upload validation errors are the client's fault
    if (err.name === 'MulterError' || err.isUploadValidationError) {
        statusCode = 400;
    }

    const isDevelopment = process.env.NODE_ENV === 'development';
    const errorId = crypto.randomUUID();

    // Server errors: log the details here, send the client a generic message and a reference ID.
    // Internal messages (database errors, provider responses) must not leak to users.
    if (statusCode >= 500) {
        logger.error('unhandled error', {
            errorId,
            requestId: req.id,
            method: req.method,
            path: req.originalUrl.split('?')[0],
            error: err
        });
        if (!isDevelopment) {
            message = GENERIC_SERVER_ERROR;
        }
    }

    // Error response object
    const errorResponse = {
        "success": false,
        status: statusCode,
        message: message,
        isOperational: isOperational
    };

    if (statusCode >= 500) {
        errorResponse.errorId = errorId;
    }

    // checking if the node environment is development or production and sending the error response accordingly
    if (isDevelopment) {
        errorResponse.stack = err.stack;
    }

    res.status(statusCode).json(errorResponse);

};

export { customError };
