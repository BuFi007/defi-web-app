export type Channel = {
  id: string;
  name: string;
  mood: string;
  videoId: string;
  emoji: string;
  accent: string;
};

/**
 * BUFX Radio — 50 curated YouTube live streams across every vibe.
 *
 * Availability is verified at runtime via the oEmbed endpoint + iframe
 * onError, so streams that go dark are silently filtered out of the
 * scroller. See `use-channel-availability.ts`. If a channel goes dark
 * permanently, swap its `videoId` for a current live URL.
 *
 * ✅ = confirmed long-running stream as of build time.
 */
export const CHANNELS: Channel[] = [
  // --- Lofi / study ---
  { id: "lofi-girl",       name: "Lofi Girl",         mood: "Beats to relax/study",   videoId: "jfKfPfyJRdk", emoji: "📚", accent: "#FF6B9D" }, // ✅
  { id: "lofi-girl-synth", name: "Lofi Synthwave",    mood: "Synthwave to chill",     videoId: "4xDzrJKXOOY", emoji: "🌆", accent: "#A78BFA" }, // ✅
  { id: "lofi-girl-sleep", name: "Lofi Sleep",        mood: "Sleepy beats",           videoId: "rUxyKA_-grg", emoji: "🌙", accent: "#7C6BBF" },
  { id: "claude-fm",       name: "Claude FM",         mood: "Music for thinking",     videoId: "YmQ7jRgf4f0", emoji: "🧠", accent: "#D8C2FF" }, // ✅ (user-supplied)
  { id: "chillhop",        name: "Chillhop",          mood: "Jazzy hip-hop",          videoId: "5yx6BWlEVcY", emoji: "🍵", accent: "#22D3EE" },
  { id: "bootleg-boy",     name: "Bootleg Boy",       mood: "Sad lofi",               videoId: "Eit7RokP4iI", emoji: "🪦", accent: "#94A3B8" },
  { id: "chillmusiclab",   name: "Chill Music Lab",   mood: "Atmospheric lofi",       videoId: "tfBVp0Zi2iE", emoji: "🌫️", accent: "#A1A1AA" },
  { id: "thebrocave",      name: "The Brocave",       mood: "Late-night lofi",        videoId: "p_PpaPq2lP8", emoji: "🌃", accent: "#475569" },
  { id: "lofi-radio-24",   name: "Lofi 24/7",         mood: "Endless beats",          videoId: "DWcJFNfaw9c", emoji: "🎧", accent: "#F472B6" },
  { id: "anime-lofi",      name: "Anime Lofi",        mood: "Studio Ghibli mood",     videoId: "TtkFsfOP9QI", emoji: "🍡", accent: "#F0ABFC" },

  // --- Focus / coding ---
  { id: "coffee-shop",     name: "Coffee Shop",       mood: "Cafe ambience",          videoId: "h2zkV-l_TbY", emoji: "☕", accent: "#A8855E" },
  { id: "deep-focus",      name: "Deep Focus",        mood: "Ambient productivity",   videoId: "lTRiuFIWV54", emoji: "🎯", accent: "#6366F1" },
  { id: "study-flow",      name: "Study Flow",        mood: "Long-form focus",        videoId: "WPni755-Krg", emoji: "📖", accent: "#0EA5E9" },
  { id: "binaural-focus",  name: "Binaural Focus",    mood: "Brainwave entrainment",  videoId: "5kFMBxiL5n0", emoji: "🧬", accent: "#10B981" },
  { id: "library-vibes",   name: "Library Vibes",     mood: "Quiet study",            videoId: "n61ULEU7CO0", emoji: "🪶", accent: "#84CC16" },

  // --- Synthwave / cyberpunk / retro ---
  { id: "synthwave",       name: "Synthwave Radio",   mood: "Neon dreams",            videoId: "MVPTGNGiI-4", emoji: "🌆", accent: "#A78BFA" },
  { id: "cyberpunk",       name: "Cyberpunk Radio",   mood: "Night city vibes",       videoId: "VyAi6vbgUYw", emoji: "🤖", accent: "#F472B6" },
  { id: "darksynth",       name: "Darksynth",         mood: "Heavy synthwave",        videoId: "_8w8lhqMqlM", emoji: "🩸", accent: "#EF4444" },
  { id: "outrun",          name: "Outrun",            mood: "80s drive",              videoId: "uvbHFwMv-ec", emoji: "🚗", accent: "#FB7185" },
  { id: "vaporwave",       name: "Vaporwave",         mood: "Mall plaza dreams",      videoId: "Rd1jhqAdtCs", emoji: "🌐", accent: "#22D3EE" },

  // --- Jazz / cafe / acoustic ---
  { id: "jazz-hop-cafe",   name: "Jazz Hop Cafe",     mood: "Smooth jazz beats",      videoId: "Dx5qFachd3A", emoji: "🎷", accent: "#F59E0B" },
  { id: "smooth-jazz",     name: "Smooth Jazz",       mood: "Late-night sax",         videoId: "Iwfd1AB37HM", emoji: "🎶", accent: "#D97706" },
  { id: "bossa-nova",      name: "Bossa Nova",        mood: "Brazilian breeze",       videoId: "Ec_zkOEHaT8", emoji: "🇧🇷", accent: "#16A34A" },
  { id: "piano-cafe",      name: "Piano Cafe",        mood: "Cinematic piano",        videoId: "4oStw0r33so", emoji: "🎹", accent: "#0891B2" },
  { id: "acoustic-cafe",   name: "Acoustic Cafe",     mood: "Indie folk",             videoId: "wZ5x0HQEpC0", emoji: "🪕", accent: "#CA8A04" },

  // --- Chillout / ambient ---
  { id: "cafe-del-mar",    name: "Cafe del Mar",      mood: "Sunset chillout",        videoId: "tNkZsRW7h2c", emoji: "🌅", accent: "#FB923C" },
  { id: "ambient-space",   name: "Ambient Space",     mood: "Drifting cosmos",        videoId: "S_MOd40zlYU", emoji: "🌌", accent: "#312E81" },
  { id: "drone-ambient",   name: "Drone Ambient",     mood: "Endless drones",         videoId: "0mWQ3JZyDgI", emoji: "🌀", accent: "#475569" },
  { id: "rain-cafe",       name: "Rain Cafe",         mood: "Rain + coffee",          videoId: "y7e-GC6oGhg", emoji: "🌧️", accent: "#64748B" },
  { id: "fireplace",       name: "Fireplace",         mood: "Crackling warmth",       videoId: "L_LUpnjgPso", emoji: "🔥", accent: "#DC2626" },
  { id: "forest-sounds",   name: "Forest Sounds",     mood: "Birds + leaves",         videoId: "OdIJ2x3nxzQ", emoji: "🌲", accent: "#15803D" },
  { id: "ocean-waves",     name: "Ocean Waves",       mood: "Tidal calm",             videoId: "Nv3SagBjQ-A", emoji: "🌊", accent: "#0284C7" },

  // --- Electronic / EDM ---
  { id: "monstercat",      name: "Monstercat",        mood: "Uplifting electronic",   videoId: "vBkBS4O3yvY", emoji: "🐾", accent: "#10B981" },
  { id: "trap-nation",     name: "Trap Nation",       mood: "Trap & bass",            videoId: "4-Yj1RvKgCs", emoji: "🔥", accent: "#DC2626" },
  { id: "house-radio",     name: "House Radio",       mood: "Deep house",             videoId: "36YnV9STBqc", emoji: "🕺", accent: "#0EA5E9" },
  { id: "drum-n-bass",     name: "Drum & Bass",       mood: "Liquid DnB",             videoId: "Y8jrnsK4Wms", emoji: "💧", accent: "#06B6D4" },
  { id: "future-house",    name: "Future House",      mood: "Bouncy four-on-floor",   videoId: "0wYTKCsKy3w", emoji: "🏠", accent: "#0EA5E9" },
  { id: "techno-radio",    name: "Techno",            mood: "Berlin warehouse",       videoId: "WLM7sV4FXLk", emoji: "⚙️", accent: "#1E293B" },
  { id: "trance",          name: "Trance",            mood: "Uplifting trance",       videoId: "fBdvjsGm5jI", emoji: "✨", accent: "#A855F7" },

  // --- Phonk / drift ---
  { id: "phonk",           name: "Phonk Radio",       mood: "Drift mode",             videoId: "VG-RDV8XfXQ", emoji: "🚗", accent: "#7C3AED" },
  { id: "drift-phonk",     name: "Drift Phonk",       mood: "Tokyo midnight",         videoId: "Tg2A07YptlQ", emoji: "🏎️", accent: "#9333EA" },

  // --- World / genre ---
  { id: "kpop-radio",      name: "K-Pop Radio",       mood: "Idol energy",            videoId: "rqGiU0jKDR8", emoji: "🇰🇷", accent: "#F472B6" },
  { id: "city-pop",        name: "Japanese City Pop", mood: "80s Tokyo",              videoId: "VKogMG9b5kE", emoji: "🇯🇵", accent: "#FB7185" },
  { id: "latin-vibes",     name: "Latin Vibes",       mood: "Reggaeton + cumbia",     videoId: "ddi13PYW2HU", emoji: "🌎", accent: "#F97316" },
  { id: "reggae",          name: "Reggae",            mood: "Island rhythms",         videoId: "lE1XlEqzeXc", emoji: "🌴", accent: "#16A34A" },
  { id: "afrobeat",        name: "Afrobeat",          mood: "African drums",          videoId: "f0EUYO_6QO0", emoji: "🥁", accent: "#EA580C" },

  // --- Game / cinematic ---
  { id: "cinematic",       name: "Cinematic",         mood: "Epic & classical",       videoId: "MzPS_Jl2YL8", emoji: "🎻", accent: "#FBBF24" },
  { id: "game-ost",        name: "Game OST",          mood: "RPG soundtracks",        videoId: "tLrlu9rGEJI", emoji: "🎮", accent: "#7C3AED" },
  { id: "ghibli-piano",    name: "Ghibli Piano",      mood: "Studio Ghibli themes",   videoId: "h7QmpAaaqi8", emoji: "🍃", accent: "#22C55E" },

  // --- Latin / reggaeton ---
  { id: "lofi-reggaeton",  name: "Lofi Reggaeton",    mood: "Perreo chill",           videoId: "1JEcq_QPnDc", emoji: "🇵🇷", accent: "#F97316" },
  { id: "latin-lofi",      name: "Latin Lofi",        mood: "Spanish chillhop",       videoId: "nx7Y_OdrxIs", emoji: "🌶️", accent: "#DC2626" },

  // --- Rock / punk / metal (with bias) ---
  { id: "indie-rock",      name: "Indie Rock",        mood: "Arctic Monkeys mood",    videoId: "7L_lyaGD4HU", emoji: "🎸", accent: "#06B6D4" },
  { id: "post-punk",       name: "Post-Punk",         mood: "Joy Division & co.",     videoId: "WhTMSlVrEDQ", emoji: "🖤", accent: "#1F2937" },
  { id: "lofi-post-punk",  name: "Lofi Post-Punk",    mood: "Slow gloom",             videoId: "RAcMpQB3o6Y", emoji: "🌑", accent: "#475569" },
  { id: "russian-post-punk", name: "Доомерwave",      mood: "Molchat Doma vibes",     videoId: "RPqewBDF5_E", emoji: "🥀", accent: "#6B7280" },
  { id: "lofi-metal",      name: "Lofi Metal",        mood: "Slowed riffs",           videoId: "gMUOJSL3BiE", emoji: "🤘", accent: "#18181B" },

  // --- Sleep / noise ---
  { id: "brown-noise",     name: "Brown Noise",       mood: "Deep static",            videoId: "RqzGzwTY-6w", emoji: "🟤", accent: "#78350F" },
  { id: "white-noise",     name: "White Noise",       mood: "Pure hum",               videoId: "yEhh7iEjipo", emoji: "⚪", accent: "#E5E7EB" },

  // --- John Wick Mode (the user's favorite — last on purpose) ---
  { id: "john-wick",       name: "John Wick Mode",    mood: "Neo-noir scenewave",     videoId: "daR-1u_2qJM", emoji: "🕴️", accent: "#0A0A0A" },
];

export const DEFAULT_CHANNEL_ID = CHANNELS[0].id;
