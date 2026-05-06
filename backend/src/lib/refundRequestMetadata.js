const REFUND_REQUEST_META_PREFIX = "[obispot_refund_meta]";

function normalizeBankAccount(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const bankName = typeof value.bankName === "string" ? value.bankName.trim() : "";
  const accountNumber = typeof value.accountNumber === "string" ? value.accountNumber.trim() : "";
  const accountHolderName = typeof value.accountHolderName === "string" ? value.accountHolderName.trim() : "";

  if (!bankName || !accountNumber || !accountHolderName) {
    return null;
  }

  return {
    bankName,
    accountNumber,
    accountHolderName
  };
}

export function encodeRefundRequestNote({ note, bankAccount }) {
  const normalizedBankAccount = normalizeBankAccount(bankAccount);
  if (!normalizedBankAccount) {
    return note || null;
  }

  return `${REFUND_REQUEST_META_PREFIX}${JSON.stringify({
    note: note || null,
    bankAccount: normalizedBankAccount
  })}`;
}

export function parseRefundRequestNote(rawNote) {
  if (!rawNote || typeof rawNote !== "string") {
    return {
      note: null,
      bankAccount: null
    };
  }

  if (!rawNote.startsWith(REFUND_REQUEST_META_PREFIX)) {
    return {
      note: rawNote,
      bankAccount: null
    };
  }

  try {
    const parsed = JSON.parse(rawNote.slice(REFUND_REQUEST_META_PREFIX.length));
    return {
      note: typeof parsed?.note === "string" ? parsed.note : null,
      bankAccount: normalizeBankAccount(parsed?.bankAccount)
    };
  } catch {
    return {
      note: rawNote,
      bankAccount: null
    };
  }
}
