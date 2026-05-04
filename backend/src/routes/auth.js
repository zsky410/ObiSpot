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

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1)
});

async function loadProfile(userId) {
  const { data: profile, error: profileError } = await supabaseAdminClient
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile) {
    return null;
  }
  return profile;
}

function buildAuthPayload(session, profile) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
    user: {
      id: profile.id,
      fullName: profile.full_name,
      role: profile.role
    }
  };
}

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

    const profile = await loadProfile(loginData.user.id);
    if (!profile) {
      return sendError(
        res,
        403,
        ERROR_CODES.profileNotFound,
        "Profile not found for authenticated user"
      );
    }

    return res.status(200).json(buildAuthPayload(loginData.session, profile));
  })
);

authRouter.post(
  "/refresh",
  validateBody(refreshBodySchema),
  asyncHandler(async (req, res) => {
    if (hasValidationError(req)) {
      return sendError(
        res,
        400,
        ERROR_CODES.validationError,
        "Invalid refresh request body",
        { fields: req.validationError }
      );
    }

    const { refreshToken } = req.validatedBody;
    const { data: refreshData, error: refreshError } = await supabaseAuthClient.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (refreshError || !refreshData.session || !refreshData.user) {
      return sendError(res, 401, ERROR_CODES.unauthorized, "Invalid or expired refresh token");
    }

    const profile = await loadProfile(refreshData.user.id);
    if (!profile) {
      return sendError(
        res,
        403,
        ERROR_CODES.profileNotFound,
        "Profile not found for authenticated user"
      );
    }

    return res.status(200).json(buildAuthPayload(refreshData.session, profile));
  })
);
