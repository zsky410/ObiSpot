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
  supabaseServiceRoleKey: mustGetEnv("SUPABASE_SERVICE_ROLE_KEY"),
  aiProvider: process.env.AI_PROVIDER || "",
  aiBaseUrl: process.env.AI_BASE_URL || "",
  aiApiKey: process.env.AI_API_KEY || "",
  aiModel: process.env.AI_MODEL || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  appPublicBaseUrl: process.env.APP_PUBLIC_BASE_URL || "http://localhost:4000",
  paymentHoldMinutes: Number(process.env.PAYMENT_HOLD_MINUTES || 5),
  sepayEnv: process.env.SEPAY_ENV || "sandbox",
  sepayMerchantId: process.env.SEPAY_MERCHANT_ID || "",
  sepayMerchantSecretKey: process.env.SEPAY_MERCHANT_SECRET_KEY || "",
  sepayPaymentMethod: process.env.SEPAY_PAYMENT_METHOD || "BANK_TRANSFER",
  sepayIpnSecret: process.env.SEPAY_IPN_SECRET || "",
  sepayBankCode: process.env.SEPAY_BANK_CODE || "",
  sepayAccountNo: process.env.SEPAY_ACCOUNT_NO || "",
  sepayAccountName: process.env.SEPAY_ACCOUNT_NAME || ""
};
