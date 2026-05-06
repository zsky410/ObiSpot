import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { generateAnswer } from "../lib/gemini.js";
import { buildSlotKey, ensureVenueDailySlots, isDateInRollingWindow } from "../lib/slotAutoSeed.js";
import { computeSlotPriceVnd } from "../lib/slotPricing.js";
import { supabaseAdminClient } from "../lib/supabase.js";
import { selectAllPages } from "../lib/supabasePaginate.js";
import { requireAuth } from "../middleware/auth.js";
import { ERROR_CODES } from "../utils/errorCodes.js";
import { asyncHandler, sendError } from "../utils/http.js";
import { hasValidationError, uuidLikeSchema, validateBody } from "../utils/validate.js";

export const chatbotRouter = Router();

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
const CHAT_TIMEOUT_MS = 8000;
const DAILY_OPEN_MINUTES = 5 * 60;
const DAILY_CLOSE_MINUTES = 23 * 60;
const CHAT_BOOKING_WINDOW_DAYS = 5;
const CHAT_HISTORY_LIMIT = 8;
const CHAT_SESSION_MESSAGE_LIMIT = 16;
const LEGACY_CHAT_SESSION_SCAN_LIMIT = 200;
const CHAT_FALLBACK_REPLY =
  "Hệ thống chat đang bận. Bạn vui lòng thử lại sau ít phút hoặc mở màn hình đặt sân để xem lịch trực tiếp.";
const CHAT_QUOTA_REPLY =
  "Trợ lý AI đang tạm quá tải hoặc hết lượt trong chốc lát. Bạn vui lòng thử lại sau hoặc kiểm tra lịch sân trực tiếp trên app.";

const chatHistoryItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(2000)
});

const chatbotQueryBodySchema = z.object({
  message: z.string().trim().min(1).max(1000),
  sessionId: uuidLikeSchema.optional(),
  history: z.array(chatHistoryItemSchema).max(CHAT_HISTORY_LIMIT).optional()
});

function stripVietnameseAccents(text) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeForSearch(text) {
  return stripVietnameseAccents(text)
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s:/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatHm(minutes) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hours = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const mins = (safe % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
}

function localTimestamp(dateYmd, minutes) {
  return `${dateYmd}T${formatHm(minutes)}:00+07:00`;
}

function minuteOfDayInVn(value) {
  const date = new Date(value);
  let total = date.getUTCHours() * 60 + date.getUTCMinutes() + 7 * 60;
  total %= 1440;
  if (total < 0) {
    total += 1440;
  }
  return total;
}

function todayYmdInVn() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function addDaysYmd(ymd, days) {
  const base = new Date(`${ymd}T00:00:00+07:00`);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatDateLabel(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(`${value}T00:00:00+07:00`));
}

function formatTimeLabel(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatCurrencyVnd(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDateShort(value) {
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit"
  }).formatToParts(new Date(`${value}T00:00:00+07:00`));
  const day = parts.find((part) => part.type === "day")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  return `${day}/${month}`;
}

function parseExplicitDate(message) {
  const isoMatch = message.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const shortMatch = message.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!shortMatch) {
    return null;
  }

  const nowYear = Number(todayYmdInVn().slice(0, 4));
  const day = shortMatch[1].padStart(2, "0");
  const month = shortMatch[2].padStart(2, "0");
  const rawYear = shortMatch[3];
  let year = rawYear ? Number(rawYear) : nowYear;
  if (rawYear && rawYear.length === 2) {
    year += 2000;
  }

  const candidate = `${year}-${month}-${day}`;
  if (Number.isNaN(new Date(`${candidate}T00:00:00+07:00`).getTime())) {
    return null;
  }
  return candidate;
}

function resolveClockMinutes(hoursValue, minutesValue = 0, dayPart = null) {
  const hours = Number(hoursValue);
  const minutes = Number(minutesValue || 0);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  let resolvedHours = hours;
  if (dayPart === "chieu" || dayPart === "toi" || dayPart === "dem") {
    if (resolvedHours >= 1 && resolvedHours <= 11) {
      resolvedHours += 12;
    }
  } else if (dayPart === "trua") {
    if (resolvedHours >= 1 && resolvedHours <= 4) {
      resolvedHours += 12;
    }
  } else if (dayPart === "sang" && resolvedHours === 12) {
    resolvedHours = 0;
  }

  if (resolvedHours < 0 || resolvedHours > 23) {
    return null;
  }

  return resolvedHours * 60 + minutes;
}

function parseExactTimeRange(normalizedMessage) {
  const exactRange = normalizedMessage.match(
    /\b(?:(sang|chieu|toi|dem|trua)\s*)?(?:tu\s*)?(\d{1,2})(?:(?::|h)(\d{1,2}))?\s*(?:h|gio)?\s*(?:-|den|toi)\s*(\d{1,2})(?:(?::|h)(\d{1,2}))?\s*(?:h|gio)?(?:\s*(sang|chieu|toi|dem|trua))?\b/
  );

  if (!exactRange) {
    return null;
  }

  const dayPart = exactRange[1] || exactRange[6] || null;
  const startMinutes = resolveClockMinutes(exactRange[2], exactRange[3], dayPart);
  const endMinutes = resolveClockMinutes(exactRange[4], exactRange[5], dayPart);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }

  return {
    label: `${formatHm(startMinutes)}-${formatHm(endMinutes)}`,
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes,
    mode: "exactRange",
    isExactRange: true
  };
}

function parseSingleExplicitTime(normalizedMessage) {
  const colonMatch = normalizedMessage.match(
    /\b(?:(sang|chieu|toi|dem|trua)\s*)?(\d{1,2}):(\d{2})(?:\s*(sang|chieu|toi|dem|trua))?\b/
  );
  if (colonMatch) {
    const dayPart = colonMatch[1] || colonMatch[4] || null;
    const center = resolveClockMinutes(colonMatch[2], colonMatch[3], dayPart);
    if (center !== null) {
      return center;
    }
  }

  const hourMatch = normalizedMessage.match(
    /\b(?:(sang|chieu|toi|dem|trua)\s*)?(\d{1,2})(?:h(\d{1,2})?\s*|\s+gio)(?:\s*(sang|chieu|toi|dem|trua))?\b/
  );
  if (!hourMatch) {
    return null;
  }

  const dayPart = hourMatch[1] || hourMatch[4] || null;
  return resolveClockMinutes(hourMatch[2], hourMatch[3], dayPart);
}

function parseTimeWindow(normalizedMessage) {
  const exactRange = parseExactTimeRange(normalizedMessage);
  if (exactRange) {
    return exactRange;
  }

  const explicitTime = parseSingleExplicitTime(normalizedMessage);
  if (explicitTime !== null) {
    const center = Math.max(DAILY_OPEN_MINUTES, Math.min(DAILY_CLOSE_MINUTES, explicitTime));
    return {
      label: `quanh ${formatHm(center)}`,
      startMinutes: Math.max(DAILY_OPEN_MINUTES, center - 30),
      endMinutes: Math.min(DAILY_CLOSE_MINUTES, center + 120),
      durationMinutes: Math.min(DAILY_CLOSE_MINUTES, center + 120) - Math.max(DAILY_OPEN_MINUTES, center - 30),
      mode: "point",
      isExactRange: false
    };
  }

  if (/\b(buoi toi|toi nay|dem)\b/.test(normalizedMessage)) {
    return {
      label: "buổi tối",
      startMinutes: 18 * 60,
      endMinutes: DAILY_CLOSE_MINUTES,
      durationMinutes: DAILY_CLOSE_MINUTES - 18 * 60,
      mode: "period",
      isExactRange: false
    };
  }
  if (/\b(chieu)\b/.test(normalizedMessage)) {
    return {
      label: "buổi chiều",
      startMinutes: 12 * 60,
      endMinutes: 18 * 60,
      durationMinutes: 6 * 60,
      mode: "period",
      isExactRange: false
    };
  }
  if (/\b(trua)\b/.test(normalizedMessage)) {
    return {
      label: "buổi trưa",
      startMinutes: 11 * 60,
      endMinutes: 14 * 60,
      durationMinutes: 3 * 60,
      mode: "period",
      isExactRange: false
    };
  }
  if (/\b(sang)\b/.test(normalizedMessage)) {
    return {
      label: "buổi sáng",
      startMinutes: DAILY_OPEN_MINUTES,
      endMinutes: 12 * 60,
      durationMinutes: 7 * 60,
      mode: "period",
      isExactRange: false
    };
  }

  return {
    label: "cả ngày",
    startMinutes: DAILY_OPEN_MINUTES,
    endMinutes: DAILY_CLOSE_MINUTES,
    durationMinutes: DAILY_CLOSE_MINUTES - DAILY_OPEN_MINUTES,
    mode: "fullDay",
    isExactRange: false
  };
}

function parsePitchFormat(normalizedMessage) {
  if (/\b(7v7|7vs7|7 nguoi|san 7)\b/.test(normalizedMessage)) {
    return "7v7";
  }
  if (/\b(5v5|5vs5|5 nguoi|san 5)\b/.test(normalizedMessage)) {
    return "5v5";
  }
  return null;
}

function parseTopic(normalizedMessage) {
  if (/\b(gia|bao nhieu tien|chi phi|don gia)\b/.test(normalizedMessage)) {
    return "price";
  }
  if (/\b(con san|con slot|con khong|co khong|khung gio|lich|trong|dat duoc|available|check lich|het chua)\b/.test(normalizedMessage)) {
    return "availability";
  }
  return "general";
}

function parseDateIntent(message, normalizedMessage) {
  const explicitDate = parseExplicitDate(message);
  const today = todayYmdInVn();

  if (explicitDate) {
    return {
      dateYmd: explicitDate,
      dateSource: "explicit"
    };
  }

  if (/\b(ngay kia|ngay mot|mot mai)\b/.test(normalizedMessage)) {
    return { dateYmd: addDaysYmd(today, 2), dateSource: "dayAfterTomorrow" };
  }
  if (/\b(ngay mai|mai)\b/.test(normalizedMessage)) {
    return { dateYmd: addDaysYmd(today, 1), dateSource: "tomorrow" };
  }
  if (/\b(hom nay|toi nay|chieu nay|sang nay|trua nay)\b/.test(normalizedMessage)) {
    return { dateYmd: today, dateSource: "today" };
  }

  return { dateYmd: today, dateSource: "defaultToday" };
}

function hasTimeReference(normalizedMessage) {
  return Boolean(
    parseExactTimeRange(normalizedMessage) ||
      parseSingleExplicitTime(normalizedMessage) !== null ||
      /\b(sang|chieu|trua|dem|khung gio|luc)\b/.test(normalizedMessage) ||
      /\b(buoi toi|toi nay)\b/.test(normalizedMessage)
  );
}

function hasFollowUpSignal(normalizedMessage) {
  return Boolean(
    /\b(thi sao|sao nhi|sao ta|sao a|con sao|con khong|the nao|chi nhanh do|san do)\b/.test(normalizedMessage) ||
      normalizedMessage.split(" ").filter(Boolean).length <= 6
  );
}

function isNonTaskMessage(normalizedMessage) {
  return /\b(cam on|thank|thanks|ok|oke|tam biet|bye)\b/.test(normalizedMessage);
}

function hasImplicitFieldReference(normalizedMessage) {
  return /\b(san do|san nay|san ay|san kia)\b/.test(normalizedMessage);
}

function parseChatIntent(message) {
  const normalizedMessage = normalizeForSearch(message);
  const dateIntent = parseDateIntent(message, normalizedMessage);

  return {
    originalMessage: message.trim(),
    normalizedMessage,
    topic: parseTopic(normalizedMessage),
    pitchFormat: parsePitchFormat(normalizedMessage),
    timeWindow: parseTimeWindow(normalizedMessage),
    ...dateIntent
  };
}

function buildVenueAliases(venue) {
  const aliases = new Set([normalizeForSearch(venue.name)]);
  const branchNumber = venue.name.match(/ObiSpot\s*(\d+)/i)?.[1];
  if (branchNumber) {
    aliases.add(`obispot ${branchNumber}`);
    aliases.add(`chi nhanh ${branchNumber}`);
    aliases.add(`cn ${branchNumber}`);
  }

  const branchLabel = venue.name.split("-").slice(1).join("-").trim();
  if (branchLabel) {
    const normalizedBranch = normalizeForSearch(branchLabel);
    aliases.add(normalizedBranch);
    const shortened = normalizedBranch.replace(/^chi nhanh\s+/, "").trim();
    if (shortened) {
      aliases.add(shortened);
    }
  }

  return [...aliases].filter(Boolean);
}

function buildFieldAliases(field) {
  const normalized = normalizeForSearch(field.name);
  const aliases = new Set([normalized]);
  aliases.add(normalized.replace(/^san\s*/, "").trim());
  return [...aliases].filter(Boolean);
}

function matchEntities(intent, venues, fields) {
  const matchedVenues = venues.filter((venue) =>
    buildVenueAliases(venue).some((alias) => intent.normalizedMessage.includes(alias))
  );

  const rawMatchedFields = fields.filter((field) =>
    buildFieldAliases(field).some((alias) => intent.normalizedMessage.includes(alias))
  );

  const preferredVenueIds = new Set(intent.preferredVenueIds || []);
  const preferredFieldIds = new Set(intent.preferredFieldIds || []);
  const implicitMatchedFields =
    rawMatchedFields.length === 0 && preferredFieldIds.size > 0 && hasImplicitFieldReference(intent.normalizedMessage)
      ? fields.filter((field) => preferredFieldIds.has(field.id))
      : [];
  const preferredFields = implicitMatchedFields.length > 0 ? implicitMatchedFields : rawMatchedFields;
  const narrowedFields =
    matchedVenues.length === 0 && preferredVenueIds.size > 0 && preferredFields.length > 0
      ? preferredFields.filter((field) => preferredVenueIds.has(field.venue_id))
      : preferredFields;
  const matchedFields = narrowedFields.length > 0 ? narrowedFields : preferredFields;

  const matchedFieldVenueIds = [...new Set(matchedFields.map((field) => field.venue_id))];
  const targetVenueIds = new Set(
    matchedVenues.length > 0
      ? matchedVenues.map((venue) => venue.id)
      : matchedFieldVenueIds.length > 0
        ? matchedFieldVenueIds
        : preferredVenueIds.size > 0
          ? [...preferredVenueIds]
        : venues.map((venue) => venue.id)
  );

  return { matchedVenues, matchedFields, targetVenueIds };
}

function normalizeSessionState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    topic: typeof state.topic === "string" ? state.topic : null,
    dateYmd: typeof state.dateYmd === "string" ? state.dateYmd : null,
    timeWindow:
      state.timeWindow && typeof state.timeWindow === "object" && Number.isFinite(state.timeWindow.startMinutes)
        ? {
            label: typeof state.timeWindow.label === "string" ? state.timeWindow.label : "cả ngày",
            startMinutes: Number(state.timeWindow.startMinutes),
            endMinutes: Number(state.timeWindow.endMinutes),
            durationMinutes: Number(state.timeWindow.durationMinutes || 0),
            mode: typeof state.timeWindow.mode === "string" ? state.timeWindow.mode : "fullDay",
            isExactRange: Boolean(state.timeWindow.isExactRange)
          }
        : null,
    pitchFormat: state.pitchFormat === "5v5" || state.pitchFormat === "7v7" ? state.pitchFormat : null,
    preferredVenueIds: Array.isArray(state.preferredVenueIds) ? state.preferredVenueIds.filter(Boolean) : [],
    preferredFieldIds: Array.isArray(state.preferredFieldIds) ? state.preferredFieldIds.filter(Boolean) : []
  };
}

function buildSessionState(chatbotContext, previousState = null) {
  const existing = normalizeSessionState(previousState);
  const resolvedPitchFormat =
    chatbotContext.intent.pitchFormat && chatbotContext.intent.pitchFormat !== "all" ? chatbotContext.intent.pitchFormat : existing.pitchFormat;
  const resolvedVenueIds =
    chatbotContext.matchedVenues.length > 0
      ? chatbotContext.matchedVenues.map((venue) => venue.id)
      : chatbotContext.matchedFields.length > 0
        ? [...new Set(chatbotContext.matchedFields.map((field) => field.venueId))]
        : existing.preferredVenueIds;

  return {
    topic: chatbotContext.intent.topic === "general" ? existing.topic : chatbotContext.intent.topic,
    dateYmd: chatbotContext.intent.requestedDate || existing.dateYmd,
    timeWindow: chatbotContext.intent.timeWindow || existing.timeWindow,
    pitchFormat: resolvedPitchFormat,
    preferredVenueIds: resolvedVenueIds,
    preferredFieldIds: chatbotContext.matchedFields.map((field) => field.id)
  };
}

function buildIntentFromConversation(message, sessionState, history, venues, fields) {
  const currentIntent = parseChatIntent(message);
  const currentMatch = matchEntities(currentIntent, venues, fields);
  const normalizedSessionState = normalizeSessionState(sessionState);

  const historyEntries = (history || [])
    .filter((item) => item?.role === "user" && item?.text)
    .slice(-CHAT_HISTORY_LIMIT)
    .map((item) => {
      const intent = parseChatIntent(item.text);
      return {
        role: item.role,
        text: item.text,
        intent,
        match: matchEntities(intent, venues, fields)
      };
    });

  const historyNewestFirst = [...historyEntries].reverse();
  const latestTopicEntry = historyNewestFirst.find((entry) => entry.intent.topic !== "general");
  const latestDateEntry = historyNewestFirst.find((entry) => entry.intent.dateSource !== "defaultToday");
  const latestTimeEntry = historyNewestFirst.find(
    (entry) => hasTimeReference(entry.intent.normalizedMessage) || entry.intent.timeWindow.mode !== "fullDay"
  );
  const latestPitchEntry = historyNewestFirst.find((entry) => Boolean(entry.intent.pitchFormat));
  const latestVenueEntry = historyNewestFirst.find(
    (entry) => entry.match.matchedVenues.length > 0 || entry.match.matchedFields.length > 0
  );

  if (
    !normalizedSessionState.topic &&
    !normalizedSessionState.dateYmd &&
    !normalizedSessionState.timeWindow &&
    !normalizedSessionState.pitchFormat &&
    normalizedSessionState.preferredVenueIds.length === 0 &&
    normalizedSessionState.preferredFieldIds.length === 0 &&
    !latestTopicEntry &&
    !latestDateEntry &&
    !latestTimeEntry &&
    !latestPitchEntry &&
    !latestVenueEntry
  ) {
    return currentIntent;
  }

  const contextTopic = normalizedSessionState.topic || latestTopicEntry?.intent.topic || null;
  const contextDateYmd = normalizedSessionState.dateYmd || latestDateEntry?.intent.dateYmd || null;
  const contextTimeWindow = normalizedSessionState.timeWindow || latestTimeEntry?.intent.timeWindow || null;
  const contextPitchFormat = normalizedSessionState.pitchFormat || latestPitchEntry?.intent.pitchFormat || null;
  const contextPreferredVenueIds =
    normalizedSessionState.preferredVenueIds.length > 0
      ? normalizedSessionState.preferredVenueIds
      : latestVenueEntry?.match.matchedVenues.map((venue) => venue.id).length > 0
        ? latestVenueEntry.match.matchedVenues.map((venue) => venue.id)
        : [...new Set((latestVenueEntry?.match.matchedFields || []).map((field) => field.venue_id))];
  const contextPreferredFieldIds =
    normalizedSessionState.preferredFieldIds.length > 0
      ? normalizedSessionState.preferredFieldIds
      : (latestVenueEntry?.match.matchedFields || []).map((field) => field.id);

  const shouldInheritTopic =
    currentIntent.topic === "general" &&
    !isNonTaskMessage(currentIntent.normalizedMessage) &&
    (
      hasFollowUpSignal(currentIntent.normalizedMessage) ||
      currentMatch.matchedVenues.length > 0 ||
      currentMatch.matchedFields.length > 0 ||
      Boolean(currentIntent.pitchFormat)
    );
  const shouldInheritDate = currentIntent.dateSource === "defaultToday" && Boolean(contextDateYmd);
  const shouldInheritTime = !hasTimeReference(currentIntent.normalizedMessage) && Boolean(contextTimeWindow);
  const shouldInheritPitchFormat = !currentIntent.pitchFormat && Boolean(contextPitchFormat);
  const shouldInheritVenue = currentMatch.matchedVenues.length === 0 && contextPreferredVenueIds.length > 0;
  const shouldInheritField = currentMatch.matchedFields.length === 0 && contextPreferredFieldIds.length > 0;

  return {
    ...currentIntent,
    topic: shouldInheritTopic && contextTopic ? contextTopic : currentIntent.topic,
    dateYmd: shouldInheritDate ? contextDateYmd : currentIntent.dateYmd,
    dateSource: shouldInheritDate ? "history" : currentIntent.dateSource,
    timeWindow: shouldInheritTime ? contextTimeWindow : currentIntent.timeWindow,
    pitchFormat: shouldInheritPitchFormat ? contextPitchFormat : currentIntent.pitchFormat,
    preferredVenueIds: shouldInheritVenue ? contextPreferredVenueIds : [],
    preferredFieldIds: shouldInheritField ? contextPreferredFieldIds : []
  };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchBookedSlotIds(slotIds) {
  const bookedIds = new Set();
  for (const ids of chunk([...new Set(slotIds.filter(Boolean))], 200)) {
    if (ids.length === 0) {
      continue;
    }

    const { data, error } = await selectAllPages(
      () =>
        supabaseAdminClient
          .from("bookings")
          .select("slot_id")
          .in("slot_id", ids)
          .in("status", ["pending", "confirmed"]),
      { pageSize: 1000 }
    );

    if (error) {
      throw new Error(`Failed to fetch booked slots: ${error.message}`);
    }

    for (const row of data || []) {
      if (row?.slot_id) {
        bookedIds.add(row.slot_id);
      }
    }
  }

  return bookedIds;
}

function slotOverlapsWindow(slot, timeWindow) {
  const startMinutes = minuteOfDayInVn(slot.start_time);
  const endMinutes = minuteOfDayInVn(slot.end_time);
  return startMinutes < timeWindow.endMinutes && endMinutes > timeWindow.startMinutes;
}

function buildEffectiveSlots(slotRows, bookedSlotIds) {
  const groupedBySlotKey = new Map();
  for (const row of slotRows) {
    const key = buildSlotKey(row.field_id, row.start_time, row.end_time);
    const siblings = groupedBySlotKey.get(key);
    if (siblings) {
      siblings.push(row);
    } else {
      groupedBySlotKey.set(key, [row]);
    }
  }

  const effectiveSlots = [];
  for (const siblings of groupedBySlotKey.values()) {
    const hasBookedSibling = siblings.some((candidate) => bookedSlotIds.has(candidate.id));
    const blockedSibling = siblings.find((candidate) => candidate.status === "blocked");
    const availableSibling = siblings.find((candidate) => candidate.status === "available");
    const representative = blockedSibling || availableSibling || siblings[0];

    effectiveSlots.push({
      ...representative,
      effectiveStatus: hasBookedSibling ? "booked" : blockedSibling ? "blocked" : representative.status,
      effectivePriceVnd: Number(representative.price_vnd || 0),
      startMinutes: minuteOfDayInVn(representative.start_time),
      endMinutes: minuteOfDayInVn(representative.end_time)
    });
  }

  return effectiveSlots.sort((a, b) => {
    if (a.field_id !== b.field_id) {
      return a.field_id.localeCompare(b.field_id);
    }
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  });
}

function buildExactFieldWindows(fields, effectiveSlots, venuesById, timeWindow) {
  const slotsByFieldId = new Map();
  for (const slot of effectiveSlots) {
    const current = slotsByFieldId.get(slot.field_id);
    if (current) {
      current.push(slot);
    } else {
      slotsByFieldId.set(slot.field_id, [slot]);
    }
  }

  return fields.map((field) => {
    const venue = venuesById.get(field.venue_id);
    const fieldSlots = (slotsByFieldId.get(field.id) || []).filter(
      (slot) => slot.startMinutes >= timeWindow.startMinutes && slot.endMinutes <= timeWindow.endMinutes
    );

    let cursor = timeWindow.startMinutes;
    let status = "available";
    const coveringSlots = [];

    while (cursor < timeWindow.endMinutes) {
      const matchingSlot = fieldSlots.find((slot) => slot.startMinutes === cursor);
      if (!matchingSlot) {
        status = "missing";
        break;
      }
      coveringSlots.push(matchingSlot);
      if (matchingSlot.effectiveStatus !== "available" && status === "available") {
        status = matchingSlot.effectiveStatus;
      }
      cursor = matchingSlot.endMinutes;
    }

    if (status === "available" && cursor < timeWindow.endMinutes) {
      status = "missing";
    }

    return {
      fieldId: field.id,
      fieldName: field.name,
      pitchFormat: field.pitch_format,
      venueId: field.venue_id,
      venueName: venue?.name || "",
      status,
      totalPriceVnd: coveringSlots.reduce((sum, slot) => sum + Number(slot.effectivePriceVnd || 0), 0),
      slots: coveringSlots
    };
  });
}

function buildPriceBands(dateYmd) {
  return [
    { label: "05:00-08:00", samplePriceVnd: computeSlotPriceVnd(localTimestamp(dateYmd, 5 * 60), localTimestamp(dateYmd, 5 * 60 + 30)) },
    { label: "08:00-16:00", samplePriceVnd: computeSlotPriceVnd(localTimestamp(dateYmd, 8 * 60), localTimestamp(dateYmd, 8 * 60 + 30)) },
    { label: "16:00-20:00", samplePriceVnd: computeSlotPriceVnd(localTimestamp(dateYmd, 16 * 60), localTimestamp(dateYmd, 16 * 60 + 30)) },
    { label: "20:00-23:00", samplePriceVnd: computeSlotPriceVnd(localTimestamp(dateYmd, 20 * 60), localTimestamp(dateYmd, 20 * 60 + 30)) }
  ].map((band) => ({
    ...band,
    samplePriceLabel: formatCurrencyVnd(band.samplePriceVnd)
  }));
}

function summarizeAvailability(availableSlots, fieldsById, venuesById) {
  const grouped = new Map();
  for (const slot of availableSlots) {
    const field = fieldsById.get(slot.field_id);
    const venue = venuesById.get(field?.venue_id);
    if (!field || !venue) {
      continue;
    }

    const current = grouped.get(venue.id) || {
      venueId: venue.id,
      venueName: venue.name,
      availableSlotCount: 0,
      sampleSlots: []
    };

    current.availableSlotCount += 1;
    if (current.sampleSlots.length < 4) {
      current.sampleSlots.push({
        fieldName: field.name,
        startTime: slot.start_time,
        endTime: slot.end_time,
        startTimeLabel: formatTimeLabel(slot.start_time),
        endTimeLabel: formatTimeLabel(slot.end_time),
        priceVnd: Number(slot.price_vnd || 0),
        priceLabel: formatCurrencyVnd(slot.price_vnd || 0)
      });
    }
    grouped.set(venue.id, current);
  }

  return [...grouped.values()].sort((a, b) => b.availableSlotCount - a.availableSlotCount);
}

function summarizePrices(slotRows, fieldsById, venuesById) {
  const grouped = new Map();
  for (const slot of slotRows) {
    const field = fieldsById.get(slot.field_id);
    const venue = venuesById.get(field?.venue_id);
    if (!field || !venue) {
      continue;
    }

    const current = grouped.get(venue.id) || {
      venueId: venue.id,
      venueName: venue.name,
      minPriceVnd: Number.POSITIVE_INFINITY,
      maxPriceVnd: Number.NEGATIVE_INFINITY
    };

    const price = Number(slot.price_vnd || 0);
    current.minPriceVnd = Math.min(current.minPriceVnd, price);
    current.maxPriceVnd = Math.max(current.maxPriceVnd, price);
    grouped.set(venue.id, current);
  }

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      minPriceLabel: formatCurrencyVnd(item.minPriceVnd),
      maxPriceLabel: formatCurrencyVnd(item.maxPriceVnd)
    }))
    .sort((a, b) => a.venueName.localeCompare(b.venueName));
}

function buildSuggestions(intent, availabilitySummary) {
  const suggestions = new Set();
  if (intent.topic !== "availability") {
    suggestions.add("Tối nay còn sân 7 người không?");
  }
  if (intent.topic !== "price") {
    suggestions.add("Sân 7 người buổi tối giá bao nhiêu?");
  }
  const firstVenue = availabilitySummary[0]?.venueName;
  if (firstVenue) {
    const shortVenue = firstVenue.split("-").slice(1).join("-").trim() || firstVenue;
    suggestions.add(`${shortVenue} ngày mai còn khung sau 19h không?`);
  } else {
    suggestions.add("Chi nhánh Sơn Trà chiều mai còn sân 5 người không?");
  }
  suggestions.add("Sân 5 người buổi chiều giá bao nhiêu?");
  return [...suggestions].slice(0, 3);
}

function buildConversationTranscript(history, message) {
  const lines = (history || [])
    .slice(-CHAT_HISTORY_LIMIT)
    .map((item) => `${item.role === "assistant" ? "Tro ly" : "Khach"}: ${item.text}`);

  lines.push(`Khach: ${message}`);
  return lines.join("\n");
}

function isMissingChatSessionColumnsError(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /session_id|assistant_reply|state|source/i.test(message);
}

function parseLoggedResponsePayload(rawValue) {
  if (!rawValue || typeof rawValue !== "string") {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function extractAssistantReplyFromLog(row) {
  if (typeof row?.assistant_reply === "string" && row.assistant_reply.trim()) {
    return row.assistant_reply.trim();
  }

  const payload = parseLoggedResponsePayload(row?.response);
  if (typeof payload?.reply === "string" && payload.reply.trim()) {
    return payload.reply.trim();
  }

  return typeof row?.response === "string" ? row.response.trim() : "";
}

function extractSessionIdFromLog(row) {
  if (typeof row?.session_id === "string" && row.session_id.trim()) {
    return row.session_id.trim();
  }

  const payload = parseLoggedResponsePayload(row?.response);
  return typeof payload?.sessionId === "string" && payload.sessionId.trim() ? payload.sessionId.trim() : null;
}

function extractStateFromLog(row) {
  if (row?.state && typeof row.state === "object") {
    return row.state;
  }

  const payload = parseLoggedResponsePayload(row?.response);
  return payload?.state && typeof payload.state === "object" ? payload.state : null;
}

function trimSessionRows(rows) {
  return [...(rows || [])]
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    .slice(-CHAT_SESSION_MESSAGE_LIMIT);
}

async function loadLegacyChatSessionRows(userId, requestedSessionId = null) {
  const result = await supabaseAdminClient
    .from("chat_logs")
    .select("id, message, response, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(LEGACY_CHAT_SESSION_SCAN_LIMIT);

  if (result.error) {
    return { sessionId: requestedSessionId, rows: [], state: null, error: result.error };
  }

  const scannedRows = (result.data || []).map((row) => ({
    ...row,
    session_id: extractSessionIdFromLog(row),
    state: extractStateFromLog(row)
  }));

  if (scannedRows.length === 0) {
    return { sessionId: requestedSessionId, rows: [], state: null, error: null };
  }

  const resolvedSessionId = requestedSessionId || scannedRows.find((row) => row.session_id)?.session_id || null;
  const matchedRows =
    resolvedSessionId
      ? scannedRows.filter((row) => row.session_id === resolvedSessionId)
      : scannedRows.filter((row) => !row.session_id);

  const rows = trimSessionRows(matchedRows.length > 0 ? matchedRows : scannedRows);
  const lastRow = rows[rows.length - 1] || null;

  return {
    sessionId: resolvedSessionId,
    rows,
    state: extractStateFromLog(lastRow),
    error: null
  };
}

async function loadChatSessionRows(userId, sessionId) {
  if (!sessionId) {
    return { sessionId: null, rows: [], state: null, error: null };
  }

  let result = await supabaseAdminClient
    .from("chat_logs")
    .select("id, session_id, message, assistant_reply, response, source, state, created_at")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(CHAT_SESSION_MESSAGE_LIMIT);

  if (result.error && isMissingChatSessionColumnsError(result.error)) {
    return loadLegacyChatSessionRows(userId, sessionId);
  }

  if (result.error) {
    return { sessionId, rows: [], state: null, error: result.error };
  }

  const rows = result.data || [];
  const trimmedRows = trimSessionRows(rows);
  const lastRow = trimmedRows[trimmedRows.length - 1] || null;
  return {
    sessionId,
    rows: trimmedRows,
    state: extractStateFromLog(lastRow),
    error: null
  };
}

async function resolveChatSession(userId, requestedSessionId) {
  if (requestedSessionId) {
    return loadChatSessionRows(userId, requestedSessionId);
  }

  let latestRowResult = await supabaseAdminClient
    .from("chat_logs")
    .select("session_id, state, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRowResult.error && isMissingChatSessionColumnsError(latestRowResult.error)) {
    return loadLegacyChatSessionRows(userId, requestedSessionId || null);
  }

  if (latestRowResult.error) {
    return { sessionId: randomUUID(), rows: [], state: null, error: latestRowResult.error };
  }

  const latestSessionId = latestRowResult.data?.session_id || randomUUID();
  if (!latestRowResult.data?.session_id) {
    return { sessionId: latestSessionId, rows: [], state: null, error: null };
  }

  return loadChatSessionRows(userId, latestSessionId);
}

function buildHistoryFromSessionRows(rows) {
  const history = [];
  for (const row of rows || []) {
    if (row?.message) {
      history.push({ role: "user", text: row.message });
    }

    const assistantReply = extractAssistantReplyFromLog(row);
    if (assistantReply) {
      history.push({ role: "assistant", text: assistantReply });
    }
  }

  return history.slice(-CHAT_HISTORY_LIMIT);
}

function buildSessionMessagesFromRows(rows) {
  const items = [];
  for (const row of rows || []) {
    if (row?.message) {
      items.push({
        id: `${row.id}:user`,
        role: "user",
        text: row.message,
        createdAt: row.created_at
      });
    }

    const assistantReply = extractAssistantReplyFromLog(row);
    if (assistantReply) {
      items.push({
        id: `${row.id}:assistant`,
        role: "assistant",
        text: assistantReply,
        source: row.source || parseLoggedResponsePayload(row.response)?.source || "db+llm",
        createdAt: row.created_at
      });
    }
  }

  return items;
}

function formatDurationLabel(totalMinutes) {
  const minutes = Number(totalMinutes || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours} giờ ${remainingMinutes} phút`;
  }
  if (hours > 0) {
    return `${hours} giờ`;
  }
  return `${remainingMinutes} phút`;
}

function formatPitchFormatLabel(pitchFormat) {
  return pitchFormat === "7v7" ? "sân 7 người" : "sân 5 người";
}

function formatListWithOverflow(items, limit = 4) {
  const uniqueItems = [...new Set((items || []).filter(Boolean))];
  if (uniqueItems.length === 0) {
    return "";
  }
  if (uniqueItems.length <= limit) {
    return uniqueItems.join(", ");
  }
  return `${uniqueItems.slice(0, limit).join(", ")} và ${uniqueItems.length - limit} sân khác`;
}

function formatExactPriceRangeLabel(minPriceVnd, maxPriceVnd, durationMinutes) {
  if (!Number.isFinite(minPriceVnd) || !Number.isFinite(maxPriceVnd)) {
    return "";
  }

  const durationLabel = formatDurationLabel(durationMinutes);
  if (!durationLabel) {
    return "";
  }

  if (minPriceVnd === maxPriceVnd) {
    return `${formatCurrencyVnd(minPriceVnd)} / ${durationLabel} / sân`;
  }
  return `${formatCurrencyVnd(minPriceVnd)} - ${formatCurrencyVnd(maxPriceVnd)} / ${durationLabel} / sân`;
}

function formatPerSlotPriceRangeLabel(minPriceVnd, maxPriceVnd) {
  if (!Number.isFinite(minPriceVnd) || !Number.isFinite(maxPriceVnd)) {
    return "";
  }
  if (minPriceVnd === maxPriceVnd) {
    return `${formatCurrencyVnd(minPriceVnd)} / slot 30 phút`;
  }
  return `${formatCurrencyVnd(minPriceVnd)} - ${formatCurrencyVnd(maxPriceVnd)} / slot 30 phút`;
}

function buildBookingWindowReply(chatbotContext) {
  const today = todayYmdInVn();
  const maxDate = addDaysYmd(today, CHAT_BOOKING_WINDOW_DAYS);
  return `Hiện app chỉ mở lịch từ ${formatDateShort(today)} đến ${formatDateShort(maxDate)}. Ngày ${formatDateShort(chatbotContext.intent.requestedDate)} chưa có dữ liệu mở slot.`;
}

function buildNoMatchingScopeReply(chatbotContext) {
  const venueName = chatbotContext.matchedVenues[0]?.name;
  const fieldName = chatbotContext.matchedFields[0]?.name;
  if (fieldName && venueName) {
    return `${fieldName} tại ${venueName} hiện không khớp với điều kiện bạn đang hỏi.`;
  }
  if (venueName) {
    return `${venueName} hiện chưa có sân phù hợp với điều kiện bạn đang hỏi.`;
  }
  return "Mình chưa tìm thấy sân phù hợp với yêu cầu này.";
}

function groupExactFieldWindowsByVenueAndFormat(fieldWindows, { availableOnly = false } = {}) {
  const grouped = new Map();

  for (const item of fieldWindows || []) {
    if (!item || item.status === "missing") {
      continue;
    }
    if (availableOnly && item.status !== "available") {
      continue;
    }

    const key = `${item.venueId}|${item.pitchFormat}`;
    const current = grouped.get(key) || {
      venueId: item.venueId,
      venueName: item.venueName,
      pitchFormat: item.pitchFormat,
      fieldNames: [],
      minPriceVnd: Number.POSITIVE_INFINITY,
      maxPriceVnd: Number.NEGATIVE_INFINITY
    };

    if (!availableOnly || item.status === "available") {
      current.fieldNames.push(item.fieldName);
    }
    current.minPriceVnd = Math.min(current.minPriceVnd, Number(item.totalPriceVnd || 0));
    current.maxPriceVnd = Math.max(current.maxPriceVnd, Number(item.totalPriceVnd || 0));
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((a, b) => {
    if (a.venueName !== b.venueName) {
      return a.venueName.localeCompare(b.venueName);
    }
    return a.pitchFormat.localeCompare(b.pitchFormat);
  });
}

function buildAvailabilityReply(chatbotContext) {
  const { intent, matchedFields, matchedVenues, availability, exactFieldWindows, filteredFieldsCount } = chatbotContext;
  const dateLabel = formatDateShort(intent.requestedDate);

  if (!intent.bookingWindowSupported) {
    return buildBookingWindowReply(chatbotContext);
  }
  if (filteredFieldsCount === 0) {
    return buildNoMatchingScopeReply(chatbotContext);
  }

  if (intent.timeWindow.isExactRange) {
    if (intent.timeWindow.startMinutes < DAILY_OPEN_MINUTES || intent.timeWindow.endMinutes > DAILY_CLOSE_MINUTES) {
      return `ObiSpot hiện mở slot từ 05:00 đến 23:00 mỗi ngày. Khung ${intent.requestedTimeWindow} ngày ${dateLabel} nằm ngoài giờ này.`;
    }

    const matchedFieldIds = new Set(matchedFields.map((field) => field.id));
    if (matchedFieldIds.size > 0) {
      const selectedWindows = exactFieldWindows.filter((item) => matchedFieldIds.has(item.fieldId));

      if (selectedWindows.length === 1) {
        const target = selectedWindows[0];
        const priceText = target.totalPriceVnd
          ? ` Giá khung này là ${formatCurrencyVnd(target.totalPriceVnd)} / ${formatDurationLabel(intent.timeWindow.durationMinutes)} / sân.`
          : "";

        if (target.status === "available") {
          return `${target.fieldName} tại ${target.venueName} ngày ${dateLabel} khung ${intent.requestedTimeWindow} vẫn còn trống.${priceText}`;
        }

        const alternativeFields = exactFieldWindows
          .filter(
            (item) =>
              item.fieldId !== target.fieldId &&
              item.venueId === target.venueId &&
              item.pitchFormat === target.pitchFormat &&
              item.status === "available"
          )
          .map((item) => item.fieldName);

        let reply = `${target.fieldName} tại ${target.venueName} ngày ${dateLabel} khung ${intent.requestedTimeWindow} hiện không còn trống.`;
        if (alternativeFields.length > 0) {
          reply += ` Bạn vẫn có thể đặt ${formatListWithOverflow(alternativeFields)}.`;
        }
        return `${reply}${priceText}`;
      }

      if (selectedWindows.length > 1) {
        const lines = [`Ngày ${dateLabel} khung ${intent.requestedTimeWindow}:`];
        for (const item of selectedWindows.slice(0, 5)) {
          if (item.status === "available") {
            lines.push(
              `- ${item.fieldName} tại ${item.venueName}: còn trống, giá ${formatCurrencyVnd(item.totalPriceVnd)} / ${formatDurationLabel(intent.timeWindow.durationMinutes)}.`
            );
          } else {
            lines.push(`- ${item.fieldName} tại ${item.venueName}: hiện không còn trống.`);
          }
        }
        return lines.join("\n");
      }
    }

    const availableGroups = groupExactFieldWindowsByVenueAndFormat(exactFieldWindows, { availableOnly: true });
    if (availableGroups.length === 0) {
      const scopeLabel = matchedVenues[0]?.name || "Khung giờ này";
      return `${scopeLabel} ngày ${dateLabel} khung ${intent.requestedTimeWindow} hiện chưa còn sân trống.`;
    }

    if (matchedVenues.length === 1) {
      const venueName = matchedVenues[0].name;
      const venueGroups = availableGroups.filter((group) => group.venueId === matchedVenues[0].id);
      const lines = [`${venueName} ngày ${dateLabel} khung ${intent.requestedTimeWindow} vẫn còn sân.`];
      for (const group of venueGroups) {
        lines.push(
          `- ${formatPitchFormatLabel(group.pitchFormat)}: ${formatListWithOverflow(group.fieldNames)}. Giá ${formatExactPriceRangeLabel(group.minPriceVnd, group.maxPriceVnd, intent.timeWindow.durationMinutes)}.`
        );
      }
      return lines.join("\n");
    }

    const lines = [`Ngày ${dateLabel} khung ${intent.requestedTimeWindow} vẫn còn sân ở các chi nhánh sau:`];
    for (const group of availableGroups.slice(0, 5)) {
      lines.push(
        `- ${group.venueName}: ${formatPitchFormatLabel(group.pitchFormat)} còn ${formatListWithOverflow(group.fieldNames)}. Giá ${formatExactPriceRangeLabel(group.minPriceVnd, group.maxPriceVnd, intent.timeWindow.durationMinutes)}.`
      );
    }
    return lines.join("\n");
  }

  if (matchedFields.length === 1) {
    const targetField = matchedFields[0];
    const sampleSlots = chatbotContext.sampleAvailableSlots.filter((slot) => slot.fieldName === targetField.name);
    if (sampleSlots.length === 0) {
      return `${targetField.name} ngày ${dateLabel} ${intent.requestedTimeWindow} hiện chưa thấy slot trống phù hợp.`;
    }

    return `${targetField.name} ngày ${dateLabel} ${intent.requestedTimeWindow} vẫn còn slot trống. Ví dụ: ${sampleSlots
      .slice(0, 3)
      .map((slot) => `${slot.startTimeLabel}-${slot.endTimeLabel}`)
      .join(", ")}.`;
  }

  if (availability.totalAvailableSlots === 0 || availability.byVenue.length === 0) {
    return `Ngày ${dateLabel} ${intent.requestedTimeWindow} hiện chưa thấy slot trống phù hợp.`;
  }

  if (availability.byVenue.length === 1) {
    const venue = availability.byVenue[0];
    const sampleText = venue.sampleSlots
      .map((slot) => `${slot.fieldName} ${slot.startTimeLabel}-${slot.endTimeLabel}`)
      .join(", ");
    return `${venue.venueName} ngày ${dateLabel} ${intent.requestedTimeWindow} vẫn còn ${venue.availableSlotCount} slot 30 phút trống.${sampleText ? ` Ví dụ: ${sampleText}.` : ""}`;
  }

  const lines = [`Ngày ${dateLabel} ${intent.requestedTimeWindow} vẫn còn slot trống ở các chi nhánh sau:`];
  for (const venue of availability.byVenue.slice(0, 3)) {
    const sampleText = venue.sampleSlots
      .map((slot) => `${slot.fieldName} ${slot.startTimeLabel}-${slot.endTimeLabel}`)
      .join(", ");
    lines.push(`- ${venue.venueName}: ${venue.availableSlotCount} slot 30 phút.${sampleText ? ` Ví dụ ${sampleText}.` : ""}`);
  }
  return lines.join("\n");
}

function buildPriceReply(chatbotContext) {
  const { intent, matchedFields, matchedVenues, exactFieldWindows, prices, filteredFieldsCount } = chatbotContext;
  const dateLabel = formatDateShort(intent.requestedDate);

  if (!intent.bookingWindowSupported) {
    return buildBookingWindowReply(chatbotContext);
  }
  if (filteredFieldsCount === 0) {
    return buildNoMatchingScopeReply(chatbotContext);
  }

  if (intent.timeWindow.isExactRange) {
    if (intent.timeWindow.startMinutes < DAILY_OPEN_MINUTES || intent.timeWindow.endMinutes > DAILY_CLOSE_MINUTES) {
      return `ObiSpot hiện mở slot từ 05:00 đến 23:00 mỗi ngày. Khung ${intent.requestedTimeWindow} ngày ${dateLabel} nằm ngoài giờ này.`;
    }

    const matchedFieldIds = new Set(matchedFields.map((field) => field.id));
    if (matchedFieldIds.size > 0) {
      const selectedWindows = exactFieldWindows.filter((item) => matchedFieldIds.has(item.fieldId) && item.status !== "missing");
      if (selectedWindows.length === 1) {
        const target = selectedWindows[0];
        const statusLabel = target.status === "available" ? "Hiện sân này vẫn còn trống." : "Hiện sân này đã có khách hoặc bị khóa.";
        return `Giá ${target.fieldName} tại ${target.venueName} ngày ${dateLabel} khung ${intent.requestedTimeWindow} là ${formatCurrencyVnd(target.totalPriceVnd)} / ${formatDurationLabel(intent.timeWindow.durationMinutes)} / sân. ${statusLabel}`;
      }
    }

    const exactGroups = groupExactFieldWindowsByVenueAndFormat(exactFieldWindows);
    if (exactGroups.length === 0) {
      return `Mình chưa đủ dữ liệu giá cho ngày ${dateLabel} khung ${intent.requestedTimeWindow}.`;
    }

    if (matchedVenues.length === 1) {
      const venueGroups = exactGroups.filter((group) => group.venueId === matchedVenues[0].id);
      const lines = [`${matchedVenues[0].name} ngày ${dateLabel} khung ${intent.requestedTimeWindow}:`];
      for (const group of venueGroups) {
        lines.push(
          `- ${formatPitchFormatLabel(group.pitchFormat)}: ${formatExactPriceRangeLabel(group.minPriceVnd, group.maxPriceVnd, intent.timeWindow.durationMinutes)}.`
        );
      }
      return lines.join("\n");
    }

    const lines = [`Giá ngày ${dateLabel} khung ${intent.requestedTimeWindow}:`];
    for (const group of exactGroups.slice(0, 5)) {
      lines.push(
        `- ${group.venueName}: ${formatPitchFormatLabel(group.pitchFormat)} ${formatExactPriceRangeLabel(group.minPriceVnd, group.maxPriceVnd, intent.timeWindow.durationMinutes)}.`
      );
    }
    return lines.join("\n");
  }

  if (prices.byVenue.length === 0) {
    return `Mình chưa đủ dữ liệu giá cho ngày ${dateLabel} ${intent.requestedTimeWindow}.`;
  }

  if (prices.byVenue.length === 1) {
    const venue = prices.byVenue[0];
    return `${venue.venueName} ngày ${dateLabel} ${intent.requestedTimeWindow} có giá ${formatPerSlotPriceRangeLabel(venue.minPriceVnd, venue.maxPriceVnd)}.`;
  }

  const lines = [`Giá ngày ${dateLabel} ${intent.requestedTimeWindow}:`];
  for (const venue of prices.byVenue.slice(0, 4)) {
    lines.push(`- ${venue.venueName}: ${formatPerSlotPriceRangeLabel(venue.minPriceVnd, venue.maxPriceVnd)}.`);
  }
  return lines.join("\n");
}

function buildStructuredReply(chatbotContext) {
  if (chatbotContext.intent.topic === "availability") {
    return buildAvailabilityReply(chatbotContext);
  }
  if (chatbotContext.intent.topic === "price") {
    return buildPriceReply(chatbotContext);
  }
  return null;
}

async function fetchChatbotContext(message, { history = [], sessionState = null } = {}) {
  const { data: venueRows, error: venuesError } = await supabaseAdminClient
    .from("venues")
    .select("id, name, address, open_time, close_time")
    .order("name", { ascending: true });
  if (venuesError) {
    throw new Error(`Failed to fetch venues: ${venuesError.message}`);
  }

  const { data: fieldRows, error: fieldsError } = await supabaseAdminClient
    .from("fields")
    .select("id, venue_id, name, pitch_format, status")
    .eq("status", "active")
    .order("venue_id", { ascending: true })
    .order("name", { ascending: true });
  if (fieldsError) {
    throw new Error(`Failed to fetch fields: ${fieldsError.message}`);
  }

  const venues = venueRows || [];
  const fields = fieldRows || [];
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const intent = buildIntentFromConversation(message, sessionState, history, venues, fields);
  const matched = matchEntities(intent, venues, fields);
  const inferredPitchFormat =
    intent.pitchFormat ||
    (matched.matchedFields.length > 0 &&
    new Set(matched.matchedFields.map((field) => field.pitch_format)).size === 1
      ? matched.matchedFields[0].pitch_format
      : null);

  const filteredFields = fields.filter((field) => {
    if (!matched.targetVenueIds.has(field.venue_id)) {
      return false;
    }
    if (inferredPitchFormat && field.pitch_format !== inferredPitchFormat) {
      return false;
    }
    return true;
  });

  const bookingWindowSupported = isDateInRollingWindow(intent.dateYmd, CHAT_BOOKING_WINDOW_DAYS);
  const uniqueVenueIds = [...new Set(filteredFields.map((field) => field.venue_id))];

  if (bookingWindowSupported) {
    await Promise.all(
      uniqueVenueIds.map((venueId) =>
        ensureVenueDailySlots(supabaseAdminClient, {
          venueId,
          date: intent.dateYmd,
          slotMinutes: 30,
          dailyStart: "05:00",
          dailyEnd: "23:00"
        })
      )
    );
  }

  let slotRows = [];
  if (filteredFields.length > 0 && bookingWindowSupported) {
    const rangeStart = localTimestamp(intent.dateYmd, DAILY_OPEN_MINUTES);
    const rangeEnd = localTimestamp(intent.dateYmd, DAILY_CLOSE_MINUTES);
    const { data, error } = await selectAllPages(
      () =>
        supabaseAdminClient
          .from("time_slots")
          .select("id, field_id, start_time, end_time, status, price_vnd")
          .in("field_id", filteredFields.map((field) => field.id))
          .gte("start_time", rangeStart)
          .lt("start_time", rangeEnd)
          .order("field_id", { ascending: true })
          .order("start_time", { ascending: true }),
      { pageSize: 2000 }
    );

    if (error) {
      throw new Error(`Failed to fetch time slots: ${error.message}`);
    }

    slotRows = (data || []).filter((slot) => slotOverlapsWindow(slot, intent.timeWindow));
  }

  const bookedSlotIds = await fetchBookedSlotIds(slotRows.map((slot) => slot.id));
  const effectiveSlots = buildEffectiveSlots(slotRows, bookedSlotIds);
  const availableSlots = effectiveSlots.filter((slot) => slot.effectiveStatus === "available");
  const availabilitySummary = summarizeAvailability(availableSlots, fieldsById, venuesById);
  const priceSummary = summarizePrices(effectiveSlots, fieldsById, venuesById);
  const exactFieldWindows = intent.timeWindow.isExactRange
    ? buildExactFieldWindows(filteredFields, effectiveSlots, venuesById, intent.timeWindow)
    : [];

  const topSlots = availableSlots.slice(0, 8).map((slot) => {
    const field = fieldsById.get(slot.field_id);
    const venue = venuesById.get(field?.venue_id);
    return {
      venueName: venue?.name || "",
      fieldName: field?.name || "",
      pitchFormat: field?.pitch_format || "",
      startTime: slot.start_time,
      endTime: slot.end_time,
      startTimeLabel: formatTimeLabel(slot.start_time),
      endTimeLabel: formatTimeLabel(slot.end_time),
      priceVnd: Number(slot.price_vnd || 0),
      priceLabel: formatCurrencyVnd(slot.price_vnd || 0)
    };
  });

  return {
    intent: {
      topic: intent.topic,
      requestedDate: intent.dateYmd,
      requestedDateLabel: formatDateLabel(intent.dateYmd),
      requestedTimeWindow: intent.timeWindow.label,
      timeWindow: intent.timeWindow,
      pitchFormat: inferredPitchFormat || "all",
      dateSource: intent.dateSource,
      bookingWindowSupported
    },
    matchedVenues: matched.matchedVenues.map((venue) => ({
      id: venue.id,
      name: venue.name
    })),
    matchedFields: matched.matchedFields.map((field) => ({
      id: field.id,
      name: field.name,
      venueId: field.venue_id,
      pitchFormat: field.pitch_format
    })),
    searchedVenueNames: uniqueVenueIds.map((venueId) => venuesById.get(venueId)?.name).filter(Boolean),
    filteredFieldsCount: filteredFields.length,
    priceBands: buildPriceBands(intent.dateYmd),
    availability: {
      totalAvailableSlots: availableSlots.length,
      byVenue: availabilitySummary
    },
    prices: {
      byVenue: priceSummary
    },
    exactFieldWindows,
    sampleAvailableSlots: topSlots
  };
}

function buildPrompt(message, history, chatbotContext) {
  return [
    "Ban la tro ly tu van dat san cua ObiSpot.",
    "Quy tac bat buoc:",
    "- Chi duoc dua vao DU LIEU CO SAN ben duoi.",
    "- Khong bịa, khong doan thong tin neu du lieu khong co.",
    "- Neu khong du du lieu hoac ngay vuot pham vi dat san, phai noi ro.",
    "- Khong nhan dat cho, giu cho, hay xac nhan booking thay nguoi dung.",
    "- Tra loi bang tieng Viet, gon gang, than thien.",
    "- Khong dung markdown, khong dung **, #, ` hay bang bieu phuc tap.",
    "- Neu co slot phu hop, uu tien neu toi da 5 goi y cu the: chi nhanh, san, gio, gia.",
    "- Neu khong con slot phu hop, goi y chi nhanh khac hoac khung gio khac neu du lieu co.",
    "",
    "Lich su hoi dap gan day:",
    buildConversationTranscript(history, message),
    "",
    "Du lieu co san (JSON):",
    JSON.stringify(chatbotContext, null, 2),
    "",
    "Tra loi cho khach:"
  ].join("\n");
}

function normalizeAssistantReply(text) {
  return `${text || ""}`
    .replace(/\r\n/g, "\n")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[*-]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeLogText(text, maxLength) {
  return `${text || ""}`
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:\+?84|0)\d{8,10}\b/g, "[redacted-phone]")
    .replace(/\b\d{9,16}\b/g, "[redacted-number]")
    .slice(0, maxLength);
}

function buildLoggedResponsePayload({ sessionId, source, reply, suggestions, state }) {
  const normalizedState = normalizeSessionState(state);
  const normalizedSuggestions = Array.isArray(suggestions)
    ? suggestions.filter(Boolean).slice(0, 4).map((item) => sanitizeLogText(item, 160))
    : [];

  const primaryPayload = JSON.stringify({
    sessionId,
    source,
    state: normalizedState,
    suggestions: normalizedSuggestions,
    reply: sanitizeLogText(reply, 2200)
  });

  if (primaryPayload.length <= 4000) {
    return primaryPayload;
  }

  return JSON.stringify({
    sessionId,
    source,
    state: normalizedState,
    suggestions: normalizedSuggestions.slice(0, 2),
    reply: sanitizeLogText(reply, 1200)
  });
}

async function logChatExchange({ userId, sessionId, message, reply, source, suggestions, state }) {
  const payload = buildLoggedResponsePayload({
    sessionId,
    source,
    reply,
    suggestions,
    state
  });

  let result = await supabaseAdminClient.from("chat_logs").insert({
    user_id: userId,
    session_id: sessionId,
    message: sanitizeLogText(message, 1000),
    assistant_reply: sanitizeLogText(reply, 4000),
    response: payload,
    source,
    state: state || {}
  });

  if (result.error && isMissingChatSessionColumnsError(result.error)) {
    result = await supabaseAdminClient.from("chat_logs").insert({
      user_id: userId,
      message: sanitizeLogText(message, 1000),
      response: payload
    });
  }

  if (result.error) {
    console.error("Failed to log chat exchange:", result.error.message);
  }
}

function buildFallbackReply(error) {
  const message = `${error?.message || ""}`;
  if (/quota exceeded|429 too many requests|limit: 0/i.test(message)) {
    return CHAT_QUOTA_REPLY;
  }
  return CHAT_FALLBACK_REPLY;
}

chatbotRouter.get(
  "/session",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessionData = await resolveChatSession(req.auth.user.id, null);
    if (sessionData.error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to load chat session");
    }

    return res.status(200).json({
      sessionId: sessionData.rows.length > 0 ? sessionData.sessionId : null,
      items: buildSessionMessagesFromRows(sessionData.rows),
      state: normalizeSessionState(sessionData.state)
    });
  })
);

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

    const { message, history = [], sessionId: requestedSessionId } = req.validatedBody;
    const intent = parseChatIntent(message);
    const sessionData = await resolveChatSession(req.auth.user.id, requestedSessionId);
    if (sessionData.error) {
      return sendError(res, 500, ERROR_CODES.dbError, "Failed to load chat session");
    }

    const sessionId = sessionData.sessionId || requestedSessionId || randomUUID();
    const effectiveHistory = sessionData.rows.length > 0 ? buildHistoryFromSessionRows(sessionData.rows) : history;
    const sessionState = normalizeSessionState(sessionData.state);
    let reply = CHAT_FALLBACK_REPLY;
    let source = "fallback";
    let suggestions = buildSuggestions(intent, []);
    let nextSessionState = sessionState;

    try {
      const chatbotContext = await fetchChatbotContext(message, {
        history: effectiveHistory,
        sessionState
      });
      suggestions = buildSuggestions(chatbotContext.intent, chatbotContext.availability.byVenue);
      const structuredReply = buildStructuredReply(chatbotContext);
      if (structuredReply) {
        reply = structuredReply;
      } else {
        reply = await generateAnswer(buildPrompt(message, effectiveHistory, chatbotContext), {
          timeoutMs: CHAT_TIMEOUT_MS
        });
      }
      reply = normalizeAssistantReply(reply);
      nextSessionState = buildSessionState(chatbotContext, sessionState);
      source = "db+llm";
    } catch (error) {
      reply = buildFallbackReply(error);
      console.error("Chatbot failed, using fallback:", error instanceof Error ? error.message : error);
    }

    await logChatExchange({
      userId: req.auth.user.id,
      sessionId,
      message,
      reply,
      source,
      suggestions,
      state: nextSessionState
    });

    return res.status(200).json({
      sessionId,
      reply,
      source,
      suggestions,
      state: nextSessionState
    });
  })
);
