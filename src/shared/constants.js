const { Key } = require("@computer-use/nut-js");

const NUTJS_KEY_MAPPING = {
   "←": { key: Key.Left },
   "→": { key: Key.Right },
   "↑": { key: Key.Up },
   "↓": { key: Key.Down },
   "◄": { key: Key.Home },
   "►": { key: Key.End },
   "▲": { key: Key.PageUp },
   "▼": { key: Key.PageDown },

   // editing
   "↢": { key: Key.Backspace },
   "‒": { key: Key.Tab },

   // navigation with Shift
   "⇑": { shift: true, key: Key.Up },
   "⇓": { shift: true, key: Key.Down },
   "⇐": { shift: true, key: Key.Left },
   "⇒": { shift: true, key: Key.Right },

   // advanced functions
   "💾": { modifier: Key.LeftControl, key: Key.S },
   "🔁": { modifier: Key.LeftAlt, key: Key.Tab },
   Ö: { modifier: Key.LeftAlt, key: Key.Tab },
   ö: { modifier: Key.LeftControl, key: Key.F5 },
   Ș: { modifier: Key.LeftControl, key: Key.Tab },
   ñ: { modifier: Key.LeftControl, key: Key.N },
   ω: { modifier: Key.LeftControl, key: Key.W },
   é: { key: Key.Escape },
   Ț: { modifier: Key.LeftControl, key: Key.F },
};

const HOTKEYS = "abcdefghijklmnopqrstuvwxyz".split("");

const WINDOW_CONFIG = {
   width: 650,
   height: 900,
   webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
   },
   alwaysOnTop: true,
   frame: true,
};

const TIMER_CONFIG = {
   DEFAULT_MINUTES: 90,
   ADJUSTMENT_MINUTES: 10,
};

const LOG_CONFIG = {
   SAVE_INTERVAL: 10, // save log every N key presses
};

module.exports = {
   NUTJS_KEY_MAPPING,
   HOTKEYS,
   WINDOW_CONFIG,
   TIMER_CONFIG,
   LOG_CONFIG,
};
