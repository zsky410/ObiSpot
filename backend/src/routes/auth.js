import { Router } from "express";
import { z } from "zod";
import { supabaseAdminClient, supabaseAuthClient } from "../lib/supabase.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, validateBody } from "../utils/validate.js";

export const authRouter = Router();

const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1)
});

authRouter.post(
  "/login",
  validateBody(loginBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid login request body",
        { fields: req.validationError }
      );
    }
    const { email, password } = req.validatedBody;

    const { data: loginData, error: loginError } = await supabaseAuthClient.auth.signInWithPassword({
      email,
      password
    });

    if (loginError || !loginData.session || !loginData.user) {
      return sendError(res, 401, ERROR_CODES.invalidCredentials, "Invalid email or password");
    }

    const { data: profile, error: profileError } = await supabaseAdminClient
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", loginData.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return sendError(
        res,
        403,
        ERROR_CODES.profileNotFound,
        "Profile not found for authenticated user"
      );
    }

    return res.status(200).json({
      accessToken: loginData.session.access_token,
      user: {
        id: profile.id,
        fullName: profile.full_name,
        role: profile.role
      }
    });
  })
);
