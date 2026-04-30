import { Router } from "express";
import { supabaseAdminClient, supabaseAuthClient } from "../lib/supabase.js";
import { asyncHandler, sendError } from "../utils/http.js";

export const authRouter = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return sendError(res, 400, "VALIDATION_ERROR", "Email and password are required");
    }

    const { data: loginData, error: loginError } = await supabaseAuthClient.auth.signInWithPassword({
      email,
      password
    });

    if (loginError || !loginData.session || !loginData.user) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const { data: profile, error: profileError } = await supabaseAdminClient
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", loginData.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return sendError(res, 403, "PROFILE_NOT_FOUND", "Profile not found for authenticated user");
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
