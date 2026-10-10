import { AppError } from '../../utils/error/AppError.js';

/**
 * Validates req.body against a zod schema and replaces it with the parsed (trimmed, normalised) value.
 * Responds 400 with the first problem found, e.g. "email: Please provide a valid email address".
 *
 * @param {import('zod').ZodType} schema
 */
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});

  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    return next(new AppError(field ? `${field}: ${issue.message}` : issue.message, 400));
  }

  req.body = result.data;
  next();
};
