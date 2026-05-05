import { computeSlotPriceVnd } from "./slotPricing.js";

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";

function parseMinutesFromHm(hm) {
  const [hours, minutes] = hm.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatHmFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function localTimestamp(date, hm) {
  return `${date}T${hm}:00+07:00`;
}

function normalizeTimestamp(value) {
  return new Date(value).toISOString();
}

export function buildSlotKey(fieldId, startTime, endTime) {
  return `${fieldId}|${normalizeTimestamp(startTime)}|${normalizeTimestamp(endTime)}`;
}

function ymdInTz(date, timeZone = VN_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function todayYmdInVn() {
  return ymdInTz(new Date(), VN_TIMEZONE);
}

function ymdAddDays(ymd, days) {
  const base = new Date(`${ymd}T00:00:00+07:00`);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isDateInRollingWindow(date, daysAhead = 5) {
  const today = todayYmdInVn();
  const maxDate = ymdAddDays(today, daysAhead);
  const target = new Date(`${date}T00:00:00+07:00`).getTime();
  const min = new Date(`${today}T00:00:00+07:00`).getTime();
  const max = new Date(`${maxDate}T00:00:00+07:00`).getTime();
  return Number.isFinite(target) && target >= min && target <= max;
}

/**
 * Tự đảm bảo slot cố định cho 1 ngày trong 1 chi nhánh.
 * Mặc định: 05:00 -> 23:00, mỗi slot 30 phút.
 */
export async function ensureVenueDailySlots(
  supabaseAdminClient,
  { venueId, date, slotMinutes = 30, dailyStart = "05:00", dailyEnd = "23:00" }
) {
  const startMinutes = parseMinutesFromHm(dailyStart);
  const endMinutes = parseMinutesFromHm(dailyEnd);
  if (startMinutes >= endMinutes || slotMinutes <= 0) {
    return { createdCount: 0 };
  }

  const { data: fields, error: fieldsError } = await supabaseAdminClient
    .from("fields")
    .select("id")
    .eq("venue_id", venueId);

  if (fieldsError || !fields || fields.length === 0) {
    return { createdCount: 0 };
  }

  const fieldIds = fields.map((f) => f.id);
  const dayStart = localTimestamp(date, "00:00");
  const dayEnd = localTimestamp(date, "23:59");
  const { data: existing, error: existingError } = await supabaseAdminClient
    .from("time_slots")
    .select("field_id, start_time, end_time")
    .in("field_id", fieldIds)
    .gte("start_time", dayStart)
    .lte("start_time", dayEnd);

  if (existingError) {
    return { createdCount: 0 };
  }

  const existingKeys = new Set(
    (existing || []).map((slot) => buildSlotKey(slot.field_id, slot.start_time, slot.end_time))
  );

  const rowsToInsert = [];
  for (const fieldId of fieldIds) {
    for (let start = startMinutes; start + slotMinutes <= endMinutes; start += slotMinutes) {
      const end = start + slotMinutes;
      const startHm = formatHmFromMinutes(start);
      const endHm = formatHmFromMinutes(end);
      const startTs = localTimestamp(date, startHm);
      const endTs = localTimestamp(date, endHm);
      const key = buildSlotKey(fieldId, startTs, endTs);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      rowsToInsert.push({
        field_id: fieldId,
        start_time: startTs,
        end_time: endTs,
        status: "available",
        price_vnd: computeSlotPriceVnd(startTs, endTs)
      });
    }
  }

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabaseAdminClient.from("time_slots").insert(rowsToInsert);
    if (insertError) {
      return { createdCount: 0 };
    }
  }

  return { createdCount: rowsToInsert.length };
}
