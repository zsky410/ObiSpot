export function sendError(res, status, code, message, details = {}) {
  return res.status(status).json({
    error: {
      code,
      message,
      details
    }
  });
}

export function asyncHandler(fn) {
  return async function wrapped(req, res, next) {
    try {
      await fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}
