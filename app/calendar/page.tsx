import type { Metadata } from "next";
import { fetchCalendarWeekAction } from "./actions";
import CalendarClient from "./calendar-client";

export const metadata: Metadata = {
  title: "Anime Release Calendar | Nayozu",
  description:
    "Daily and weekly anime episode release schedule on Nayozu with timezone-accurate broadcast times.",
};

function getMondayAndTodayUtc(): { mondayIso: string; todayIso: string; startUnix: number; endUnix: number } {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const [y, m, d] = todayIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const day = dt.getUTCDay(); // 0 = Sun, 1 = Mon
  const diffToMon = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diffToMon);

  const mondayIso = dt.toISOString().slice(0, 10);
  const startUnix = Math.floor(dt.getTime() / 1000);
  const endUnix = startUnix + 7 * 86400;

  return { mondayIso, todayIso, startUnix, endUnix };
}

export default async function CalendarPage() {
  const { mondayIso, todayIso, startUnix, endUnix } = getMondayAndTodayUtc();
  const initialData = await fetchCalendarWeekAction({ startUnix, endUnix });

  return (
    <CalendarClient
      initialWeekStartIso={mondayIso}
      initialSelectedDateIso={todayIso}
      initialData={initialData}
    />
  );
}
