/** Giá/giờ (VNĐ) — Việt Nam UTC+7 cố định (không dùng Intl theo phút — tránh lệch runtime). */

function vietnamMinuteOfDay(ms) {
  const d = new Date(ms);
  let total = d.getUTCHours() * 60 + d.getUTCMinutes() + 7 * 60;
  total %= 1440;
  if (total < 0) {
    total += 1440;
  }
  return total;
}

function hourlyRateVndFromMinuteOfDay(mins) {
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

/**
 * @param {string | Date} startIso
 * @param {string | Date} endIso
 * @returns {number}
 */
export function computeSlotPriceVnd(startIso, endIso) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!(startMs < endMs)) {
    return 0;
  }
  let total = 0;
  for (let t = startMs; t < endMs; t += 60_000) {
    total += hourlyRateVndFromMinuteOfDay(vietnamMinuteOfDay(t)) / 60;
  }
  return Math.round(total);
}
