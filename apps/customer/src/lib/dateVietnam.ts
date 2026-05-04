/** Ngày & tuần theo Asia/Ho_Chi_Minh — đồng bộ query backend slots. */
export const VN_TZ = "Asia/Ho_Chi_Minh";

/** Ngày yyyy-mm-dd theo lịch Việt Nam. Dùng formatToParts — `en-CA` hay lệch trên Hermes. */
export function getDateOffsetVietnam(offsetDays: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  if (![y, m, d].every((n) => Number.isFinite(n))) {
    return new Date().toISOString().slice(0, 10);
  }

  const utc = Date.UTC(y, m - 1, d + offsetDays);
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Thứ trong tuần (1=CN …) cho chip ngày — khớp UI cũ schedule-booking. */
export function weekdayFromDate(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00+07:00`);
  const wd = d.getUTCDay();
  return wd === 0 ? 8 : wd + 1;
}

export function formatSlotRangeVi(slot: { startTime: string; endTime: string }): string {
  const start = new Date(slot.startTime);
  const end = new Date(slot.endTime);
  const t = { timeZone: VN_TZ, hour: "2-digit" as const, minute: "2-digit" as const };
  return `${start.toLocaleTimeString("vi-VN", t)} – ${end.toLocaleTimeString("vi-VN", t)}`;
}

export function formatVnd(n: number): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(n);
}
