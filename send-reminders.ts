import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const MESSAGES = [
  "Що ти робила цієї години? Запиши коротко.",
  "Хвилинка для щоденника: що було за останню годину?",
  "Як ти? Познач настрій і що робила.",
];

function localHour(tz: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date());
    return parseInt(h, 10) % 24;
  } catch (_) {
    return -1;
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("VAPID_PUBLIC")!,
    Deno.env.get("VAPID_PRIVATE")!,
  );
  const { data: subs, error } = await sb.from("push_subs").select("*").eq("enabled", true);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, removed = 0, failed = 0;
  for (const s of subs ?? []) {
    const h = localHour(s.tz);
    const inWindow = s.from_h <= s.to_h ? (h >= s.from_h && h <= s.to_h) : (h >= s.from_h || h <= s.to_h);
    if (h < 0 || !inWindow) continue;
    const body = MESSAGES[h % MESSAGES.length];
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title: "Щоденник", body }));
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await sb.from("push_subs").delete().eq("user_id", s.user_id).eq("endpoint", s.endpoint);
        removed++;
      } else {
        failed++;
        console.log("push failed", code, String(e));
      }
    }
  }
  return new Response(JSON.stringify({ sent, removed, failed }), { headers: { "Content-Type": "application/json" } });
});
