import dotenv from "dotenv";

dotenv.config();

function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT || 4000),
  supabaseUrl: mustGetEnv("SUPABASE_URL"),
  supabaseAnonKey: mustGetEnv("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: mustGetEnv("SUPABASE_SERVICE_ROLE_KEY")
};
