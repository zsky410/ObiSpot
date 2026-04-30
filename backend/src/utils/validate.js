import { z } from "zod";

export const uuidLikeSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Invalid UUID format"
);

export function formatValidationIssues(issues) {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
}

export function validateBody(schema) {
  return function bodyValidator(req, _res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      req.validationError = formatValidationIssues(result.error.issues);
      return next();
    }
    req.validatedBody = result.data;
    return next();
  };
}

export function validateQuery(schema) {
  return function queryValidator(req, _res, next) {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      req.validationError = formatValidationIssues(result.error.issues);
      return next();
    }
    req.validatedQuery = result.data;
    return next();
  };
}

export function validateParams(schema) {
  return function paramsValidator(req, _res, next) {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      req.validationError = formatValidationIssues(result.error.issues);
      return next();
    }
    req.validatedParams = result.data;
    return next();
  };
}

export function hasValidationError(req) {
  return Array.isArray(req.validationError) && req.validationError.length > 0;
}
