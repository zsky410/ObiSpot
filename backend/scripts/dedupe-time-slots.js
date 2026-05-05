import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { buildSlotKey } from "../src/lib/slotAutoSeed.js";
import { selectAllPages } from "../src/lib/supabasePaginate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "../.env");
const applyChanges = process.argv.includes("--apply");

loadEnvFile(envPath);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const ACTIVE_BOOKING_STATUSES = new Set(["pending", "confirmed"]);

async function main() {
  const slotRows = await fetchAllTimeSlots();
  const duplicateGroups = groupDuplicateSlots(slotRows);

  if (duplicateGroups.length === 0) {
    console.log("No duplicate time slots found.");
    return;
  }

  const duplicateSlotIds = duplicateGroups.flatMap((group) => group.slots.map((slot) => slot.id));
  const bookingsBySlotId = await fetchBookingsBySlotIds(duplicateSlotIds);

  const plan = buildDeduplicationPlan(duplicateGroups, bookingsBySlotId);

  console.log(`Duplicate groups: ${plan.duplicateGroupCount}`);
  console.log(`Duplicate slot rows to delete: ${plan.deleteSlotIds.length}`);
  console.log(`Bookings to reassign: ${plan.bookingMoves.length}`);
  console.log(`Keepers needing status update: ${plan.keeperStatusUpdates.length}`);

  if (plan.conflicts.length > 0) {
    console.error(`Found ${plan.conflicts.length} conflict group(s) with more than one active booking.`);
    for (const conflict of plan.conflicts.slice(0, 20)) {
      console.error(
        `- field ${conflict.fieldId} ${conflict.startIso} -> ${conflict.endIso}: active bookings ${conflict.activeBookingIds.join(", ")}`
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!applyChanges) {
    console.log("Dry run only. Re-run with --apply to update bookings and delete duplicate slots.");
    return;
  }

  await applyDeduplicationPlan(plan);
  console.log("Duplicate slot cleanup completed.");
}

function loadEnvFile(targetPath) {
  const lines = fs.readFileSync(targetPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function fetchAllTimeSlots() {
  const { data, error } = await selectAllPages(
    () =>
      supabase
        .from("time_slots")
        .select("id, field_id, start_time, end_time, status, created_at")
        .order("field_id", { ascending: true })
        .order("start_time", { ascending: true })
        .order("id", { ascending: true }),
    { pageSize: 1000 }
  );

  if (error) {
    throw new Error(`Failed to fetch time slots: ${error.message}`);
  }

  return data || [];
}

function groupDuplicateSlots(slotRows) {
  const grouped = new Map();
  for (const slot of slotRows) {
    const key = buildSlotKey(slot.field_id, slot.start_time, slot.end_time);
    const current = grouped.get(key) || [];
    current.push(slot);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .filter(([, slots]) => slots.length > 1)
    .map(([key, slots]) => ({
      key,
      fieldId: slots[0].field_id,
      startIso: new Date(slots[0].start_time).toISOString(),
      endIso: new Date(slots[0].end_time).toISOString(),
      slots: [...slots].sort(compareSlotRows)
    }));
}

async function fetchBookingsBySlotIds(slotIds) {
  const map = new Map();
  for (const ids of chunk(slotIds, 200)) {
    const { data, error } = await selectAllPages(
      () =>
        supabase
          .from("bookings")
          .select("id, slot_id, status, created_at")
          .in("slot_id", ids)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
      { pageSize: 1000 }
    );

    if (error) {
      throw new Error(`Failed to fetch bookings for duplicate slots: ${error.message}`);
    }

    for (const booking of data || []) {
      const current = map.get(booking.slot_id) || [];
      current.push(booking);
      map.set(booking.slot_id, current);
    }
  }
  return map;
}

function buildDeduplicationPlan(duplicateGroups, bookingsBySlotId) {
  const conflicts = [];
  const keeperStatusUpdates = [];
  const bookingMoves = [];
  const deleteSlotIds = [];

  for (const group of duplicateGroups) {
    const activeBookingEntries = [];
    for (const slot of group.slots) {
      const bookings = bookingsBySlotId.get(slot.id) || [];
      for (const booking of bookings) {
        if (ACTIVE_BOOKING_STATUSES.has(booking.status)) {
          activeBookingEntries.push({ slotId: slot.id, bookingId: booking.id });
        }
      }
    }

    if (activeBookingEntries.length > 1) {
      conflicts.push({
        fieldId: group.fieldId,
        startIso: group.startIso,
        endIso: group.endIso,
        activeBookingIds: activeBookingEntries.map((entry) => entry.bookingId)
      });
      continue;
    }

    const keeper = pickKeeper(group.slots, bookingsBySlotId);
    const desiredStatus = group.slots.some((slot) => slot.status === "blocked") ? "blocked" : "available";

    if (keeper.status !== desiredStatus) {
      keeperStatusUpdates.push({ id: keeper.id, status: desiredStatus });
    }

    for (const slot of group.slots) {
      if (slot.id === keeper.id) continue;
      deleteSlotIds.push(slot.id);
      const bookings = bookingsBySlotId.get(slot.id) || [];
      for (const booking of bookings) {
        bookingMoves.push({ bookingId: booking.id, targetSlotId: keeper.id });
      }
    }
  }

  return {
    duplicateGroupCount: duplicateGroups.length,
    conflicts,
    keeperStatusUpdates,
    bookingMoves,
    deleteSlotIds
  };
}

function pickKeeper(slots, bookingsBySlotId) {
  const activeBookedSlot = slots.find((slot) =>
    (bookingsBySlotId.get(slot.id) || []).some((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status))
  );
  if (activeBookedSlot) {
    return activeBookedSlot;
  }

  const blockedSlot = slots.find((slot) => slot.status === "blocked");
  if (blockedSlot) {
    return blockedSlot;
  }

  return [...slots].sort(compareSlotRows)[0];
}

async function applyDeduplicationPlan(plan) {
  for (const update of plan.keeperStatusUpdates) {
    const { error } = await supabase.from("time_slots").update({ status: update.status }).eq("id", update.id);
    if (error) {
      throw new Error(`Failed to update keeper slot ${update.id}: ${error.message}`);
    }
  }

  const movesByTarget = new Map();
  for (const move of plan.bookingMoves) {
    const current = movesByTarget.get(move.targetSlotId) || [];
    current.push(move.bookingId);
    movesByTarget.set(move.targetSlotId, current);
  }

  for (const [targetSlotId, bookingIds] of movesByTarget.entries()) {
    for (const ids of chunk(bookingIds, 200)) {
      const { error } = await supabase.from("bookings").update({ slot_id: targetSlotId }).in("id", ids);
      if (error) {
        throw new Error(`Failed to reassign bookings to slot ${targetSlotId}: ${error.message}`);
      }
    }
  }

  for (const ids of chunk(plan.deleteSlotIds, 200)) {
    const { error } = await supabase.from("time_slots").delete().in("id", ids);
    if (error) {
      throw new Error(`Failed to delete duplicate time slots: ${error.message}`);
    }
  }
}

function compareSlotRows(a, b) {
  const createdAtDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (createdAtDiff !== 0) return createdAtDiff;
  return a.id.localeCompare(b.id);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
