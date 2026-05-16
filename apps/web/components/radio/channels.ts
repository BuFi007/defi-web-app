export type Channel = {
  id: string;
  name: string;
  mood: string;
  emoji: string;
  accent: string;
  /** Hardcoded live videoId — preferred when we've verified the stream. */
  videoId?: string;
  /** YouTube search query — resolved at runtime by /api/radio/discover. */
  query?: string;
};

/**
 * BUFX Radio — 50+ channels, hybrid resolution.
 *
 *  - Channels with `videoId` are verified long-running 24/7 streams.
 *  - Channels with `query` are dynamically resolved via the YouTube
 *    Data API v3 (search.list, eventType=live) — see
 *    `app/api/radio/discover/route.ts`. Requires `YOUTUBE_API_KEY` in
 *    `.env.local`. Without the key, query-based channels are filtered
 *    out at runtime (won't appear in the scroller).
 *  - Both kinds are double-checked via oEmbed + iframe onError, so
 *    anything that goes dark is silently skipped.
 *
 * To add a channel: drop another entry below. Prefer `query` over
 * `videoId` unless you've verified a specific live URL.
 */
export const CHANNELS: Channel[] = [
  // === Verified static streams ===
  { id: "lofi-girl",       name: "Lofi Girl",         mood: "Beats to relax/study",   videoId: "jfKfPfyJRdk", emoji: "📚", accent: "#FF6B9D" },
  { id: "lofi-girl-synth", name: "Lofi Synthwave",    mood: "Synthwave to chill",     videoId: "4xDzrJKXOOY", emoji: "🌆", accent: "#A78BFA" },
  { id: "claude-fm",       name: "Claude FM",         mood: "Music for thinking",     videoId: "YmQ7jRgf4f0", emoji: "🧠", accent: "#D8C2FF" },

  // === Lofi / study ===
  { id: "lofi-sleep",       name: "Lofi Sleep",       mood: "Sleepy beats",           emoji: "🌙", accent: "#7C6BBF", query: "lofi hip hop sleep 24/7 live radio" },
  { id: "chillhop",         name: "Chillhop",         mood: "Jazzy hip-hop",          emoji: "🍵", accent: "#22D3EE", query: "chillhop music 24/7 live radio" },
  { id: "bootleg-boy",      name: "Bootleg Boy",      mood: "Sad lofi",               emoji: "🪦", accent: "#94A3B8", query: "sad lofi hip hop 24/7 live" },
  { id: "lofi-radio-24",    name: "Lofi 24/7",        mood: "Endless beats",          emoji: "🎧", accent: "#F472B6", query: "lofi hip hop radio beats to relax 24/7 live" },
  { id: "anime-lofi",       name: "Anime Lofi",       mood: "Studio Ghibli mood",     emoji: "🍡", accent: "#F0ABFC", query: "anime lofi hip hop 24/7 live" },

  // === Focus / coding ===
  { id: "coffee-shop",      name: "Coffee Shop",      mood: "Cafe ambience",          emoji: "☕", accent: "#A8855E", query: "coffee shop ambience cafe music live 24/7" },
  { id: "deep-focus",       name: "Deep Focus",       mood: "Ambient productivity",   emoji: "🎯", accent: "#6366F1", query: "deep focus music for studying 24/7 live" },
  { id: "binaural-focus",   name: "Binaural Focus",   mood: "Brainwave entrainment",  emoji: "🧬", accent: "#10B981", query: "binaural beats focus concentration 24/7 live" },

  // === Synthwave / cyberpunk / retro ===
  { id: "synthwave",        name: "Synthwave Radio",  mood: "Neon dreams",            emoji: "🌆", accent: "#A78BFA", query: "synthwave radio 24/7 live" },
  { id: "cyberpunk",        name: "Cyberpunk Radio",  mood: "Night city vibes",       emoji: "🤖", accent: "#F472B6", query: "cyberpunk 2077 ambient radio 24/7 live" },
  { id: "darksynth",        name: "Darksynth",        mood: "Heavy synthwave",        emoji: "🩸", accent: "#EF4444", query: "darksynth dark synthwave 24/7 live" },
  { id: "outrun",           name: "Outrun",           mood: "80s drive",              emoji: "🚗", accent: "#FB7185", query: "outrun retrowave 80s music 24/7 live" },
  { id: "vaporwave",        name: "Vaporwave",        mood: "Mall plaza dreams",      emoji: "🌐", accent: "#22D3EE", query: "vaporwave aesthetic music 24/7 live" },

  // === Jazz / cafe / acoustic ===
  { id: "jazz-hop-cafe",    name: "Jazz Hop Cafe",    mood: "Smooth jazz beats",      emoji: "🎷", accent: "#F59E0B", query: "jazz hop cafe music 24/7 live" },
  { id: "smooth-jazz",      name: "Smooth Jazz",      mood: "Late-night sax",         emoji: "🎶", accent: "#D97706", query: "smooth jazz music 24/7 live radio" },
  { id: "bossa-nova",       name: "Bossa Nova",       mood: "Brazilian breeze",       emoji: "🇧🇷", accent: "#16A34A", query: "bossa nova brazilian jazz 24/7 live" },
  { id: "piano-cafe",       name: "Piano Cafe",       mood: "Cinematic piano",        emoji: "🎹", accent: "#0891B2", query: "piano music cafe 24/7 live" },
  { id: "acoustic-cafe",    name: "Acoustic Cafe",    mood: "Indie folk",             emoji: "🪕", accent: "#CA8A04", query: "acoustic indie folk music 24/7 live" },

  // === Chillout / ambient / nature ===
  { id: "cafe-del-mar",     name: "Cafe del Mar",     mood: "Sunset chillout",        emoji: "🌅", accent: "#FB923C", query: "cafe del mar chillout ibiza 24/7 live" },
  { id: "ambient-space",    name: "Ambient Space",    mood: "Drifting cosmos",        emoji: "🌌", accent: "#312E81", query: "ambient space music 24/7 live" },
  { id: "drone-ambient",    name: "Drone Ambient",    mood: "Endless drones",         emoji: "🌀", accent: "#475569", query: "drone ambient dark music 24/7 live" },
  { id: "rain-cafe",        name: "Rain Cafe",        mood: "Rain + coffee",          emoji: "🌧️", accent: "#64748B", query: "rain coffee shop sounds 24/7 live" },
  { id: "fireplace",        name: "Fireplace",        mood: "Crackling warmth",       emoji: "🔥", accent: "#DC2626", query: "fireplace crackling sounds 24/7 live" },
  { id: "forest-sounds",    name: "Forest Sounds",    mood: "Birds + leaves",         emoji: "🌲", accent: "#15803D", query: "forest birds nature sounds 24/7 live" },
  { id: "ocean-waves",      name: "Ocean Waves",      mood: "Tidal calm",             emoji: "🌊", accent: "#0284C7", query: "ocean waves sounds 24/7 live" },

  // === Electronic / EDM ===
  { id: "monstercat",       name: "Monstercat",       mood: "Uplifting electronic",   emoji: "🐾", accent: "#10B981", query: "monstercat 24/7 live radio" },
  { id: "trap-nation",      name: "Trap Nation",      mood: "Trap & bass",            emoji: "🔥", accent: "#DC2626", query: "trap nation 24/7 live" },
  { id: "house-radio",      name: "House Radio",      mood: "Deep house",             emoji: "🕺", accent: "#0EA5E9", query: "deep house radio 24/7 live" },
  { id: "drum-n-bass",      name: "Drum & Bass",      mood: "Liquid DnB",             emoji: "💧", accent: "#06B6D4", query: "liquid drum and bass 24/7 live" },
  { id: "techno-radio",     name: "Techno",           mood: "Berlin warehouse",       emoji: "⚙️", accent: "#1E293B", query: "techno music live mix 24/7" },
  { id: "trance",           name: "Trance",           mood: "Uplifting trance",       emoji: "✨", accent: "#A855F7", query: "uplifting trance music 24/7 live" },

  // === Phonk ===
  { id: "phonk",            name: "Phonk Radio",      mood: "Drift mode",             emoji: "🚗", accent: "#7C3AED", query: "phonk music 24/7 live radio" },
  { id: "drift-phonk",      name: "Drift Phonk",      mood: "Tokyo midnight",         emoji: "🏎️", accent: "#9333EA", query: "drift phonk music 24/7 live" },

  // === World ===
  { id: "kpop-radio",       name: "K-Pop Radio",      mood: "Idol energy",            emoji: "🇰🇷", accent: "#F472B6", query: "kpop music 24/7 live radio" },
  { id: "city-pop",         name: "Japanese City Pop", mood: "80s Tokyo",             emoji: "🇯🇵", accent: "#FB7185", query: "japanese city pop 24/7 live" },
  { id: "latin-vibes",      name: "Latin Vibes",      mood: "Reggaeton + cumbia",     emoji: "🌎", accent: "#F97316", query: "latin reggaeton music 24/7 live" },
  { id: "reggae",           name: "Reggae",           mood: "Island rhythms",         emoji: "🌴", accent: "#16A34A", query: "reggae music 24/7 live radio" },
  { id: "afrobeat",         name: "Afrobeat",         mood: "African drums",          emoji: "🥁", accent: "#EA580C", query: "afrobeats music 24/7 live" },

  // === Latin / reggaeton (user-requested) ===
  { id: "lofi-reggaeton",   name: "Lofi Reggaeton",   mood: "Perreo chill",           emoji: "🇵🇷", accent: "#F97316", query: "lofi reggaeton 24/7 live" },
  { id: "latin-lofi",       name: "Latin Lofi",       mood: "Spanish chillhop",       emoji: "🌶️", accent: "#DC2626", query: "lofi en español 24/7 live" },

  // === Rock / punk / metal (user-requested) ===
  { id: "indie-rock",       name: "Indie Rock",       mood: "Arctic Monkeys mood",    emoji: "🎸", accent: "#06B6D4", query: "indie rock 24/7 live radio" },
  { id: "post-punk",        name: "Post-Punk",        mood: "Joy Division & co.",     emoji: "🖤", accent: "#1F2937", query: "post punk gothic rock 24/7 live" },
  { id: "lofi-post-punk",   name: "Lofi Post-Punk",   mood: "Slow gloom",             emoji: "🌑", accent: "#475569", query: "lofi post punk slowed 24/7 live" },
  { id: "doomerwave",       name: "Доомерwave",       mood: "Molchat Doma vibes",     emoji: "🥀", accent: "#6B7280", query: "doomerwave russian post punk 24/7 live" },
  { id: "lofi-metal",       name: "Lofi Metal",       mood: "Slowed riffs",           emoji: "🤘", accent: "#18181B", query: "lofi metal slowed metal 24/7 live" },

  // === Cinematic / game ===
  { id: "cinematic",        name: "Cinematic",        mood: "Epic & classical",       emoji: "🎻", accent: "#FBBF24", query: "epic cinematic music 24/7 live" },
  { id: "game-ost",         name: "Game OST",         mood: "RPG soundtracks",        emoji: "🎮", accent: "#7C3AED", query: "video game ost music 24/7 live" },
  { id: "ghibli-piano",     name: "Ghibli Piano",     mood: "Studio Ghibli themes",   emoji: "🍃", accent: "#22C55E", query: "ghibli piano music relax 24/7 live" },

  // === Sleep / noise ===
  { id: "brown-noise",      name: "Brown Noise",      mood: "Deep static",            emoji: "🟤", accent: "#78350F", query: "brown noise 24/7 live" },
  { id: "white-noise",      name: "White Noise",      mood: "Pure hum",               emoji: "⚪", accent: "#E5E7EB", query: "white noise 24/7 live" },

  // === John Wick Mode (user's favorite — last on purpose) ===
  { id: "john-wick",        name: "John Wick Mode",   mood: "Neo-noir scenewave",     emoji: "🕴️", accent: "#0A0A0A", query: "darkwave neo noir scenewave music 24/7 live" },
];

export const DEFAULT_CHANNEL_ID = CHANNELS[0].id;
