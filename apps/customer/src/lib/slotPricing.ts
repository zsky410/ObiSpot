/** Giá slot (VNĐ) — Việt Nam UTC+7 cố định, không DST (khớp backend). */

/** Phút trong ngày (0–1439) theo đồng hồ VN (UTC+7 cố định). */
export function vietnamMinuteOfDay(ms: number): number {
  const d = new Date(ms);
  let total = d.getUTCHours() * 60 + d.getUTCMinutes() + 7 * 60;
  total %= 1440;
  if (total < 0) {
    total += 1440;
  }
  return total;
}

/** Giá một giờ (VNĐ) theo phút trong ngày VN — đúng các khung user đặt. */
function hourlyRateVndFromMinuteOfDay(mins: number): number {
  if (mins >= 5 * 60 && mins < 8 * 60) {
    return 80000;
  }
  if (mins >= 8 * 60 && mins < 16 * 60) {
    return 60000;
  }
  if (mins >= 16 * 60 && mins < 20 * 60) {
    return 100000;
  }
  if (mins >= 20 * 60 && mins < 23 * 60) {
    return 120000;
  }
  return 80000;
}

/** Tổng tiền cho đoạn [startIso, endIso) — cộng theo từng phút. */
export function computeSlotPriceVnd(startIso: string | Date, endIso: string | Date): number {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!(startMs < endMs)) {
    return 0;
  }
  let total = 0;
  for (let t = startMs; t < endMs; t += 60_000) {
    const m = vietnamMinuteOfDay(t);
    total += hourlyRateVndFromMinuteOfDay(m) / 60;
  }
  return Math.round(total);
}

/** HH:mm theo đồng hồ VN (UTC+7) — dùng khi không neo theo một ngày lưới cụ thể. */
export function vietnamWallClockHm(iso: string | Date): string {
  const vd = vietnamMinuteOfDay(new Date(iso).getTime());
  const h = Math.floor(vd / 60);
  const m = vd % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
