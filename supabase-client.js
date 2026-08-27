"use strict";

const timelineColumns = [
  "date",
  "show",
  "theatre",
  "city",
  "seat",
  "price",
  "rating",
  "cast_vibe",
  "music_vibe",
  "stage_magic",
  "story_feel",
  "note",
  "photo",
  "color",
  "source_photos",
  "confidence",
  "source_receipts"
];

function supabaseConfigured() {
  const config = window.THEATER_SPOTLIGHT_SUPABASE || {};
  return Boolean(config.url && config.publishableKey && window.supabase?.createClient);
}

let theaterSpotlightClient;

function getSupabaseClient() {
  if (!supabaseConfigured()) return null;
  if (!theaterSpotlightClient) {
    const config = window.THEATER_SPOTLIGHT_SUPABASE;
    theaterSpotlightClient = window.supabase.createClient(config.url, config.publishableKey);
  }
  return theaterSpotlightClient;
}

async function fetchTimelineRows() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from("timeline_memories")
    .select(["id", ...timelineColumns].join(","))
    .order("date", { ascending: false })
    .order("show", { ascending: true });
  if (error) throw error;
  return data;
}

function subscribeToTimelineRows(onChange) {
  const client = getSupabaseClient();
  if (!client) return null;

  const channel = client
    .channel("timeline-memories-live")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "timeline_memories"
    }, onChange)
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error(`Timeline realtime subscription failed: ${status}`);
      }
    });

  return () => {
    client.removeChannel(channel).catch((error) => {
      console.error("Timeline realtime cleanup failed.", error);
    });
  };
}
