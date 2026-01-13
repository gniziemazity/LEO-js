const { Key } = require("@computer-use/nut-js");

const NUTJS_KEY_MAPPING = {
   "↢": { key: Key.Backspace },
   "►": { key: Key.End },
   "💾": { modifier: Key.LeftControl, key: Key.S },
   "↑": { key: Key.Up },
   "↓": { key: Key.Down },
   "←": { key: Key.Left },
   "→": { key: Key.Right },
   "⇑": { shift: true, key: Key.Up },
   "⇓": { shift: true, key: Key.Down },
   "⇐": { shift: true, key: Key.Left },
   "⇒": { shift: true, key: Key.Right },
   Ö: { modifier: Key.LeftAlt, key: Key.Tab },
   ö: { modifier: Key.LeftControl, key: Key.F5 },
   Ș: { modifier: Key.LeftControl, key: Key.Tab },
   ñ: { modifier: Key.LeftControl, key: Key.N },
   ω: { modifier: Key.LeftControl, key: Key.W },
   é: { key: Key.Escape },
   Ț: { modifier: Key.LeftControl, key: Key.F },
   "▼": { key: Key.PageDown },
   "▲": { key: Key.PageUp },
   "◄": { key: Key.Home },
   "‒": { key: Key.Tab },
};

const TYPING_DELAY = 5;
const HOTKEYS = "abcdefghijklmnopqrstuvwxyz".split(""); // TO-DO: Interface for choosing hotkeys

const WINDOW_CONFIG = {
   width: 450,
   height: 900,
   webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
   },
   alwaysOnTop: true,
   frame: true,
};

module.exports = {
   NUTJS_KEY_MAPPING,
   TYPING_DELAY,
   HOTKEYS,
   WINDOW_CONFIG,
};
