import { supabaseAdminClient } from "../lib/supabase.js";
import { sendError } from "../utils/http.js";

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

export async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return sendError(res, 401, "UNAUTHORIZED", "Missing bearer token");
  }

  const { data: authData, error: authError } = await supabaseAdminClient.auth.getUser(token);
  if (authError || !authData.user) {
    return sendError(res, 401, "UNAUTHORIZED", "Invalid or expired token");
  }

  const { data: profile, error: profileError } = await supabaseAdminClient
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return sendError(res, 403, "PROFILE_NOT_FOUND", "Profile not found for authenticated user");
  }

  req.auth = {
    accessToken: token,
    user: {
      id: profile.id,
      fullName: profile.full_name,
      role: profile.role
    }
  };
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.auth?.user) {
    return sendError(res, 401, "UNAUTHORIZED", "Authentication is required");
  }
  if (req.auth.user.role !== "admin") {
    return sendError(res, 403, "FORBIDDEN", "Admin role is required");
  }
  return next();
}
