import { computeSlotPriceVnd } from "./slotPricing.js";
import { selectAllPages } from "./supabasePaginate.js";

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
const TIME_SLOT_UPSERT_CONFLICT = "field_id,start_time,end_time";
const TIME_SLOT_WRITE_BATCH_SIZE = 500;
const timeSlotWriteLocks = new Map();

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

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function buildSlotKey(fieldId, startTime, endTime) {
  return `${fieldId}|${normalizeTimestamp(startTime)}|${normalizeTimestamp(endTime)}`;
}

function isMissingTimeSlotUniqueConstraintError(error) {
  const message = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /42P10|no unique or exclusion constraint matching the ON CONFLICT specification/i.test(message);
}

async function writeTimeSlotBatch(supabaseAdminClient, rows) {
  let result = await supabaseAdminClient
    .from("time_slots")
    .upsert(rows, {
      onConflict: TIME_SLOT_UPSERT_CONFLICT,
      ignoreDuplicates: true
    })
    .select("id");

  if (result.error && isMissingTimeSlotUniqueConstraintError(result.error)) {
    result = await supabaseAdminClient.from("time_slots").insert(rows).select("id");
  }

  return result;
}

export async function insertTimeSlotsSafely(supabaseAdminClient, rows) {
  let insertedCount = 0;
  for (const batch of chunk(rows, TIME_SLOT_WRITE_BATCH_SIZE)) {
    const { data, error } = await writeTimeSlotBatch(supabaseAdminClient, batch);
    if (error) {
      return { data: null, error, insertedCount };
    }
    insertedCount += Array.isArray(data) ? data.length : 0;
  }

  return { data: { insertedCount }, error: null, insertedCount };
}

export async function withTimeSlotWriteLock(lockKey, task) {
  while (timeSlotWriteLocks.has(lockKey)) {
    await timeSlotWriteLocks.get(lockKey).catch(() => {});
  }

  let releaseLock = () => {};
  const lockPromise = new Promise((resolve) => {
    releaseLock = resolve;
  });
  timeSlotWriteLocks.set(lockKey, lockPromise);

  try {
    return await task();
  } finally {
    timeSlotWriteLocks.delete(lockKey);
    releaseLock();
  }
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
  return withTimeSlotWriteLock(
    `venue:${venueId}|date:${date}|slotMinutes:${slotMinutes}|window:${dailyStart}-${dailyEnd}`,
    async () => {
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
      const rangeStart = localTimestamp(date, dailyStart);
      const rangeEnd = localTimestamp(date, dailyEnd); // exclusive
      const { data: existing, error: existingError } = await selectAllPages(
        () =>
          supabaseAdminClient
            .from("time_slots")
            .select("field_id, start_time, end_time")
            .in("field_id", fieldIds)
            .gte("start_time", rangeStart)
            .lt("start_time", rangeEnd)
            .order("field_id", { ascending: true })
            .order("start_time", { ascending: true })
            .order("end_time", { ascending: true }),
        { pageSize: 2000 }
      );

      if (existingError) {
        return { createdCount: 0 };
      }

      const expectedStartCount = Math.floor((endMinutes - startMinutes) / slotMinutes);
      const existingKeys = new Set();
      const countsByField = new Map(fieldIds.map((id) => [id, 0]));
      for (const slot of existing || []) {
        const key = buildSlotKey(slot.field_id, slot.start_time, slot.end_time);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        countsByField.set(slot.field_id, (countsByField.get(slot.field_id) || 0) + 1);
      }
      const hasAllExpectedForAllFields = fieldIds.every((id) => (countsByField.get(id) || 0) >= expectedStartCount);
      if (hasAllExpectedForAllFields) {
        return { createdCount: 0 };
      }

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

      if (rowsToInsert.length === 0) {
        return { createdCount: 0 };
      }

      const { error: insertError, insertedCount } = await insertTimeSlotsSafely(supabaseAdminClient, rowsToInsert);
      if (insertError) {
        return { createdCount: 0 };
      }

      return { createdCount: insertedCount };
    }
  );
}
