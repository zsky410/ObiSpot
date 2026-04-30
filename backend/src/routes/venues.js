import { Router } from "express";
import { supabaseAdminClient } from "../lib/supabase.js";
import { asyncHandler, sendError } from "../utils/http.js";

export const venuesRouter = Router();

venuesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabaseAdminClient
      .from("venues")
      .select("id, name, address")
      .order("name", { ascending: true });

    if (error) {
      return sendError(res, 500, "DB_ERROR", "Failed to fetch venues");
    }

    return res.status(200).json({ items: data || [] });
  })
);
