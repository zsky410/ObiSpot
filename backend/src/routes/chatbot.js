import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, validateBody } from "../utils/validate.js";

export const chatbotRouter = Router();

const chatbotQueryBodySchema = z.object({
  message: z.string().trim().min(1).max(1000)
});

chatbotRouter.post(
  "/query",
  requireAuth,
  validateBody(chatbotQueryBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(res, 400, ERROR_CODES.validationError, "Invalid chatbot query body", {
        fields: req.validationError
      });
    }

    const { message } = req.validatedBody;

    return res.status(200).json({
      reply: `Stub: Da nhan cau hoi "${message}". Chatbot retrieval-first se duoc noi o Day 9.`,
      source: "stub"
    });
  })
);
