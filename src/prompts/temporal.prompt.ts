/**
 * Real-time temporal awareness context builder.
 */

export interface TemporalContext {
  fullDateTime: string;
  weekday: string;
  dayType: string;
  timePeriod: string;
  timeDescription: string;
  timeZone: string;
}

function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts structured temporal components in the target timezone.
 */
export function getTemporalContext(date: Date = new Date(), timeZone: string = "Asia/Kolkata"): TemporalContext {
  const safeTimeZone = isValidTimeZone(timeZone) ? timeZone : "Asia/Kolkata";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const hour24 = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: safeTimeZone, hour: "numeric", hourCycle: "h23" }).format(date),
    10
  );

  let timePeriod = "Night";
  let timeDescription = "Regular night hours";
  if (hour24 >= 0 && hour24 < 5) {
    timePeriod = "Late Night / Wee hours";
    timeDescription = "Quiet late-night / night-owl hours";
  } else if (hour24 >= 5 && hour24 < 12) {
    timePeriod = "Morning";
    timeDescription = "Morning hours";
  } else if (hour24 >= 12 && hour24 < 17) {
    timePeriod = "Afternoon";
    timeDescription = "Afternoon working hours";
  } else if (hour24 >= 17 && hour24 < 21) {
    timePeriod = "Evening";
    timeDescription = "Evening wind-down hours";
  }

  const weekday = partMap.weekday || "Unknown";
  let dayType = "Weekday";
  if (weekday === "Saturday" || weekday === "Sunday") {
    dayType = "Weekend";
  } else if (weekday === "Monday") {
    dayType = "Monday (Start of the work week)";
  } else if (weekday === "Friday") {
    dayType = "Friday (Weekend eve / wrap-up)";
  } else {
    dayType = "Midweek";
  }

  const fullDateTime = `${weekday}, ${partMap.day} ${partMap.month} ${partMap.year}, ${partMap.hour}:${partMap.minute} ${partMap.dayPeriod || ""}`.trim();

  return {
    fullDateTime,
    weekday,
    dayType,
    timePeriod,
    timeDescription,
    timeZone: safeTimeZone,
  };
}

/**
 * Builds the real-time situational temporal context block for the LLM system prompt.
 */
export function buildTemporalPrompt(date: Date = new Date(), timeZone: string = "Asia/Kolkata"): string {
  const ctx = getTemporalContext(date, timeZone);

  return [
    `[TEMPORAL & REAL-TIME CONTEXT]`,
    `- Current Date & Time: ${ctx.fullDateTime}`,
    `- Day: ${ctx.weekday} (${ctx.dayType})`,
    `- Time of Day: ${ctx.timePeriod} (${ctx.timeDescription})`,
    `- Timezone: ${ctx.timeZone}`,
    `- Temporal Guidance: Use this situational awareness naturally when relevant (e.g. late-night coding banter, weekend plans, or contextual time-of-day greetings). Do NOT force-cite the timestamp mechanically unless asked.`,
  ].join("\n");
}
