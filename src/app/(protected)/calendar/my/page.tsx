import { CalendarScreen } from "@/modules/calendar/calendar-screen";

export const dynamic = "force-dynamic";

export default async function MyCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CalendarScreen basePath="/calendar/my" forcedMine params={await searchParams} />;
}
