// Extending the error class to create a custom error class for the application
class AppError extends Error {
    constructor(message, statusCode, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.status = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }

}

export { AppError };