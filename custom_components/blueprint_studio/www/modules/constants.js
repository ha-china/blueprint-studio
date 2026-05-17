/** CONSTANTS.JS | Purpose: * Centralized configuration and constant values used throughout Blueprint */

export const API_BASE = "/api/blueprint_studio";
export const STREAM_BASE = "/api/blueprint_studio/stream";
export const UPLOAD_BASE = "/api/blueprint_studio/upload";
export const MOBILE_BREAKPOINT = 768;
export const STORAGE_KEY = "blueprint_studio_settings";
export const MAX_RECENT_FILES = 10;

// File Size Limits
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB - Hard limit to prevent OOM crashes
export const TEXT_FILE_WARNING_SIZE = 2 * 1024 * 1024; // 2MB - Warning for text files

export const TEXT_FILE_EXTENSIONS = new Set([
  "yaml", "yml", "json", "py", "js", "ts", "jsx", "tsx", "css",
  "html", "htm", "xml", "txt", "csv", "md", "rst", "log",
  "conf", "cfg", "ini", "toml", "env",
  "sh", "bash", "zsh", "svg",
  "jinja", "jinja2", "j2",
  "pem", "crt", "key", "cpp", "h",
  "gitignore", "lock",
  "sql", "go", "rs", "c", "java", "kt", "swift",
  "rb", "php", "lua", "r", "cs",
  "dockerignore", "properties", "gradle", "plist", "service"
]);

export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico"
]);

export const VIDEO_EXTENSIONS = new Set([
  "mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v"
]);

export const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"
]);

export const THEME_PRESETS = {
  native: {
    name: "Native (macOS)",
    colors: {
      bgPrimary: "#ffffff",
      bgSecondary: "#f5f5f7",
      bgTertiary: "#ececee",
      bgHover: "#e8e8ea",
      bgActive: "#636366",
      textPrimary: "#1d1d1f",
      textSecondary: "#6e6e73",
      textMuted: "#aeaeb2",
      borderColor: "#d2d2d7",
      accentColor: "#636366",
      accentHover: "#545456",
      successColor: "#28cd41",
      warningColor: "#ff9f0a",
      errorColor: "#ff3b30",
      iconFolder: "#636366",
      iconYaml: "#ff3b30",
      iconJson: "#ff9f0a",
      iconPython: "#28cd41",
      iconJs: "#ff9f0a",
      iconDefault: "#6e6e73",
      modalBg: "#ffffff",
      inputBg: "#ffffff",
      shadowColor: "rgba(0, 0, 0, 0.12)",
      cmTheme: "default",
      bgGutter: "#f5f5f7"
    }
  },
  auto: {
    name: "Auto (Match HA)",
    colors: {
      bgPrimary: "#1e1e1e",
      bgSecondary: "#252526",
      bgTertiary: "#2d2d30",
      bgHover: "#3c3c3c",
      bgActive: "#094771",
      textPrimary: "#cccccc",
      textSecondary: "#858585",
      textMuted: "#6e6e6e",
      borderColor: "#3c3c3c",
      accentColor: "#0e639c",
      accentHover: "#1177bb",
      successColor: "#4ec9b0",
      warningColor: "#dcdcaa",
      errorColor: "#f14c4c",
      iconFolder: "#dcb67a",
      iconYaml: "#cb4b16",
      iconJson: "#cbcb41",
      iconPython: "#3572a5",
      iconJs: "#f1e05a",
      iconDefault: "#858585",
      modalBg: "#2d2d30",
      inputBg: "#3c3c3c",
      shadowColor: "rgba(0, 0, 0, 0.5)",
      cmTheme: "material-darker",
      bgGutter: "#2d2d30"
    }
  },
  dark: {
    name: "Dark (Default)",
    colors: {
      bgPrimary: "#1e1e1e",
      bgSecondary: "#252526",
      bgTertiary: "#2d2d30",
      bgHover: "#3c3c3c",
      bgActive: "#094771",
      textPrimary: "#cccccc",
      textSecondary: "#858585",
      textMuted: "#6e6e6e",
      borderColor: "#3c3c3c",
      accentColor: "#0e639c",
      accentHover: "#1177bb",
      successColor: "#4ec9b0",
      warningColor: "#dcdcaa",
      errorColor: "#f14c4c",
      iconFolder: "#dcb67a",
      iconYaml: "#cb4b16",
      iconJson: "#cbcb41",
      iconPython: "#3572a5",
      iconJs: "#f1e05a",
      iconDefault: "#858585",
      modalBg: "#2d2d30",
      inputBg: "#3c3c3c",
      shadowColor: "rgba(0, 0, 0, 0.5)",
      cmTheme: "material-darker",
      bgGutter: "#2d2d30"
    }
  },
  light: {
    name: "Light",
    colors: {
      bgPrimary: "#ffffff",
      bgSecondary: "#f3f3f3",
      bgTertiary: "#e8e8e8",
      bgHover: "#e0e0e0",
      bgActive: "#0060c0",
      textPrimary: "#1e1e1e",
      textSecondary: "#616161",
      textMuted: "#9e9e9e",
      borderColor: "#d4d4d4",
      accentColor: "#0066b8",
      accentHover: "#0078d4",
      successColor: "#16825d",
      warningColor: "#bf8803",
      errorColor: "#e51400",
      iconFolder: "#c09553",
      iconYaml: "#a83232",
      iconJson: "#b89500",
      iconPython: "#2b5b84",
      iconJs: "#b8a000",
      iconDefault: "#616161",
      modalBg: "#ffffff",
      inputBg: "#ffffff",
      shadowColor: "rgba(0, 0, 0, 0.2)",
      cmTheme: "default"
    }
  },
  highContrast: {
    name: "High Contrast",
    colors: {
      bgPrimary: "#000000",
      bgSecondary: "#0c0c0c",
      bgTertiary: "#1a1a1a",
      bgHover: "#333333",
      bgActive: "#ffff00",
      textPrimary: "#ffffff",
      textSecondary: "#cccccc",
      textMuted: "#999999",
      borderColor: "#ffffff",
      accentColor: "#00ffff",
      accentHover: "#66ffff",
      successColor: "#00ff00",
      warningColor: "#ffff00",
      errorColor: "#ff0000",
      iconFolder: "#ffff00",
      iconYaml: "#ff9900",
      iconJson: "#ffff00",
      iconPython: "#00ff00",
      iconJs: "#ffff00",
      iconDefault: "#cccccc",
      modalBg: "#0c0c0c",
      inputBg: "#000000",
      shadowColor: "rgba(255, 255, 255, 0.3)",
      cmTheme: "default"
    }
  },
  solarizedDark: {
    name: "Solarized Dark",
    colors: {
      bgPrimary: "#002b36",
      bgSecondary: "#073642",
      bgTertiary: "#586e75",
      bgHover: "#073642",
      bgActive: "#268bd2",
      textPrimary: "#839496",
      textSecondary: "#93a1a1",
      textMuted: "#586e75",
      borderColor: "#073642",
      accentColor: "#268bd2",
      accentHover: "#2aa198",
      successColor: "#859900",
      warningColor: "#b58900",
      errorColor: "#dc322f",
      iconFolder: "#b58900",
      iconYaml: "#cb4b16",
      iconJson: "#b58900",
      iconPython: "#2aa198",
      iconJs: "#b58900",
      iconDefault: "#93a1a1",
      modalBg: "#073642",
      inputBg: "#002b36",
      shadowColor: "rgba(0, 0, 0, 0.5)",
      cmTheme: "default"
    }
  },
  solarizedLight: {
    name: "Solarized Light",
    colors: {
      bgPrimary: "#fdf6e3",
      bgSecondary: "#eee8d5",
      bgTertiary: "#e8e0c8",
      bgHover: "#d4ceb6",
      bgActive: "#268bd2",
      textPrimary: "#657b83",
      textSecondary: "#586e75",
      textMuted: "#93a1a1",
      borderColor: "#e8e0c8",
      accentColor: "#268bd2",
      accentHover: "#2aa198",
      successColor: "#859900",
      warningColor: "#b58900",
      errorColor: "#dc322f",
      iconFolder: "#b58900",
      iconYaml: "#cb4b16",
      iconJson: "#b58900",
      iconPython: "#2aa198",
      iconJs: "#b58900",
      iconDefault: "#586e75",
      modalBg: "#eee8d5",
      inputBg: "#fdf6e3",
      shadowColor: "rgba(0, 0, 0, 0.2)",
      cmTheme: "default"
    }
  },
  ocean: {
    name: "Ocean",
    colors: {
      bgPrimary: "#0f1419",
      bgSecondary: "#131d27",
      bgTertiary: "#1a2634",
      bgHover: "#243447",
      bgActive: "#1da1f2",
      textPrimary: "#e6eef7",
      textSecondary: "#8899a6",
      textMuted: "#5b7083",
      borderColor: "#243447",
      accentColor: "#1da1f2",
      accentHover: "#4db8ff",
      successColor: "#17bf63",
      warningColor: "#ffad1f",
      errorColor: "#e0245e",
      iconFolder: "#ffad1f",
      iconYaml: "#f45d22",
      iconJson: "#ffad1f",
      iconPython: "#17bf63",
      iconJs: "#ffad1f",
      iconDefault: "#8899a6",
      modalBg: "#1a2634",
      inputBg: "#131d27",
      shadowColor: "rgba(0, 0, 0, 0.5)",
      cmTheme: "material-darker",
      bgGutter: "#1a2634"
    }
  },
  dracula: {
    name: "Dracula",
    colors: {
      bgPrimary: "#282a36",
      bgSecondary: "#44475a",
      bgTertiary: "#6272a4",
      bgHover: "#44475a",
      bgActive: "#bd93f9",
      textPrimary: "#f8f8f2",
      textSecondary: "#bfbfbf",
      textMuted: "#6272a4",
      borderColor: "#44475a",
      accentColor: "#bd93f9",
      accentHover: "#ff79c6",
      successColor: "#50fa7b",
      warningColor: "#f1fa8c",
      errorColor: "#ff5555",
      iconFolder: "#ffb86c",
      iconYaml: "#ff79c6",
      iconJson: "#f1fa8c",
      iconPython: "#50fa7b",
      iconJs: "#f1fa8c",
      iconDefault: "#bfbfbf",
      modalBg: "#44475a",
      inputBg: "#282a36",
      shadowColor: "rgba(0, 0, 0, 0.5)",
      cmTheme: "material-darker",
      bgGutter: "#6272a4"
    }
  },
  glass: {
    name: "Glass",
    colors: {
      bgPrimary: "rgba(24, 24, 28, 0.6)",
      bgSecondary: "rgba(32, 32, 38, 0.6)",
      bgTertiary: "rgba(40, 40, 46, 0.6)",
      bgHover: "rgba(255, 255, 255, 0.09)",
      bgActive: "rgba(10, 132, 255, 0.28)",
      textPrimary: "#ffffff",
      textSecondary: "rgba(255, 255, 255, 0.75)",
      textMuted: "rgba(255, 255, 255, 0.44)",
      borderColor: "rgba(255, 255, 255, 0.1)",
      accentColor: "#0a84ff",
      accentHover: "#409cff",
      successColor: "#30d158",
      warningColor: "#ffd60a",
      errorColor: "#ff453a",
      iconFolder: "#0a84ff",
      iconYaml: "#ff453a",
      iconJson: "#ffd60a",
      iconPython: "#30d158",
      iconJs: "#ffd60a",
      iconDefault: "rgba(255, 255, 255, 0.5)",
      modalBg: "rgba(36, 36, 42, 0.82)",
      inputBg: "rgba(0, 0, 0, 0.28)",
      shadowColor: "rgba(0, 0, 0, 0.45)",
      cmTheme: "material-darker",
      bgGutter: "rgba(0, 0, 0, 0.28)"
    }
  },

  midnightBlue: {
    name: "Midnight Blue",
    colors: {
      bgPrimary: "#0d1117",
      bgSecondary: "#161b22",
      bgTertiary: "#1c2128",
      bgHover: "#21262d",
      bgActive: "#1f6feb",
      textPrimary: "#e6edf3",
      textSecondary: "#8b949e",
      textMuted: "#6e7681",
      borderColor: "#30363d",
      accentColor: "#1f6feb",
      accentHover: "#388bfd",
      successColor: "#3fb950",
      warningColor: "#d29922",
      errorColor: "#f85149",
      iconFolder: "#58a6ff",
      iconYaml: "#79c0ff",
      iconJson: "#ffa657",
      iconPython: "#3fb950",
      iconJs: "#e3b341",
      iconDefault: "#8b949e",
      modalBg: "#161b22",
      inputBg: "#0d1117",
      shadowColor: "rgba(0, 0, 0, 0.6)",
      cmTheme: "material-darker",
      bgGutter: "#161b22"
    }
  },


};

export const ACCENT_COLORS = [
  { name: "Blue", value: "#0e639c", lightValue: "#0066b8" },
  { name: "Purple", value: "#7c4dff", lightValue: "#651fff" },
  { name: "Pink", value: "#ff4081", lightValue: "#c60055" },
  { name: "Red", value: "#ff5252", lightValue: "#d32f2f" },
  { name: "Orange", value: "#ff9100", lightValue: "#ef6c00" },
  { name: "Green", value: "#4caf50", lightValue: "#2e7d32" },
  { name: "Teal", value: "#00bfa5", lightValue: "#00897b" },
  { name: "Cyan", value: "#00b8d4", lightValue: "#0097a7" }
];

// NOTE: Icon themes were reverted. Keep a single, consistent icon mapping in utils.js.
export const SYNTAX_THEMES = {
  custom: {
    name: "Custom",
    description: "Your own custom colors below",
    colors: null  // null = use customColors from state
  },
  dracula: {
    name: "Dracula",
    description: "Dark purple & pink tones",
    colors: {
      comment:  "#6272a4",
      keyword:  "#ff79c6",
      string:   "#f1fa8c",
      number:   "#bd93f9",
      boolean:  "#bd93f9",
      key:      "#8be9fd",
      tag:      "#50fa7b"
    }
  },
  nord: {
    name: "Nord",
    description: "Cool arctic blue tones",
    colors: {
      comment:  "#616e88",
      keyword:  "#81a1c1",
      string:   "#a3be8c",
      number:   "#b48ead",
      boolean:  "#b48ead",
      key:      "#88c0d0",
      tag:      "#ebcb8b"
    }
  },
  monokai: {
    name: "Monokai",
    description: "Vibrant yellow & green",
    colors: {
      comment:  "#75715e",
      keyword:  "#f92672",
      string:   "#e6db74",
      number:   "#ae81ff",
      boolean:  "#ae81ff",
      key:      "#a6e22e",
      tag:      "#66d9e8"
    }
  },
  solarized: {
    name: "Solarized",
    description: "Warm amber & teal",
    colors: {
      comment:  "#586e75",
      keyword:  "#859900",
      string:   "#2aa198",
      number:   "#d33682",
      boolean:  "#d33682",
      key:      "#268bd2",
      tag:      "#b58900"
    }
  },
  oneDark: {
    name: "One Dark",
    description: "Soft pastel atom colors",
    colors: {
      comment:  "#5c6370",
      keyword:  "#c678dd",
      string:   "#98c379",
      number:   "#d19a66",
      boolean:  "#56b6c2",
      key:      "#61afef",
      tag:      "#e06c75"
    }
  }
};

export const HA_SCHEMA = {
  // Blueprint-specific keys
  blueprintKeys: [
    { text: "blueprint:", type: "key", description: "Blueprint header block" },
    { text: "name:", type: "key", description: "Blueprint name (required)" },
    { text: "domain:", type: "key", description: "Blueprint domain: automation or script" },
    { text: "description:", type: "key", description: "Blueprint description" },
    { text: "author:", type: "key", description: "Blueprint author" },
    { text: "input:", type: "key", description: "Blueprint inputs block" },
    { text: "selector:", type: "key", description: "Input selector" },
    { text: "default:", type: "key", description: "Input default value" },
    { text: "source_url:", type: "key", description: "Source URL of the blueprint" },
    { text: "homeassistant:", type: "key", description: "HA version requirements" },
    { text: "min_version:", type: "key", description: "Minimum HA version required" },
  ],
  // Blueprint selector types
  blueprintSelectors: [
    { text: "entity:", type: "selector", description: "Entity selector" },
    { text: "device:", type: "selector", description: "Device selector" },
    { text: "area:", type: "selector", description: "Area selector" },
    { text: "target:", type: "selector", description: "Target selector (entity/device/area)" },
    { text: "number:", type: "selector", description: "Number selector" },
    { text: "text:", type: "selector", description: "Text selector" },
    { text: "boolean:", type: "selector", description: "Boolean (toggle) selector" },
    { text: "select:", type: "selector", description: "Dropdown select selector" },
    { text: "time:", type: "selector", description: "Time selector" },
    { text: "date:", type: "selector", description: "Date selector" },
    { text: "datetime:", type: "selector", description: "Date+time selector" },
    { text: "color_temp:", type: "selector", description: "Color temperature selector" },
    { text: "color_rgb:", type: "selector", description: "RGB color selector" },
    { text: "action:", type: "selector", description: "Action sequence selector" },
    { text: "object:", type: "selector", description: "Generic object selector" },
    { text: "template:", type: "selector", description: "Template selector" },
    { text: "icon:", type: "selector", description: "Icon selector" },
    { text: "duration:", type: "selector", description: "Duration selector" },
    { text: "trigger:", type: "selector", description: "Trigger selector" },
    { text: "condition:", type: "selector", description: "Condition selector" },
    { text: "theme:", type: "selector", description: "Theme selector" },
    { text: "floor:", type: "selector", description: "Floor selector" },
    { text: "label:", type: "selector", description: "Label selector" },
    { text: "media:", type: "selector", description: "Media selector" },
    { text: "attribute:", type: "selector", description: "Attribute selector" },
  ],
  // Core configuration keys
  configuration: [
    { text: "homeassistant:", type: "domain", description: "Core Home Assistant configuration" },
    { text: "automation:", type: "domain", description: "Automation configuration" },
    { text: "script:", type: "domain", description: "Script configuration" },
    { text: "scene:", type: "domain", description: "Scene configuration" },
    { text: "sensor:", type: "domain", description: "Sensor configuration" },
    { text: "binary_sensor:", type: "domain", description: "Binary sensor configuration" },
    { text: "template:", type: "domain", description: "Template entities" },
    { text: "input_boolean:", type: "domain", description: "Input boolean helper" },
    { text: "input_number:", type: "domain", description: "Input number helper" },
    { text: "input_text:", type: "domain", description: "Input text helper" },
    { text: "input_select:", type: "domain", description: "Input select helper" },
    { text: "input_datetime:", type: "domain", description: "Input datetime helper" },
    { text: "input_button:", type: "domain", description: "Input button helper" },
    { text: "counter:", type: "domain", description: "Counter helper" },
    { text: "timer:", type: "domain", description: "Timer helper" },
    { text: "group:", type: "domain", description: "Group configuration" },
    { text: "person:", type: "domain", description: "Person configuration" },
    { text: "zone:", type: "domain", description: "Zone configuration" },
    { text: "light:", type: "domain", description: "Light configuration" },
    { text: "switch:", type: "domain", description: "Switch configuration" },
    { text: "cover:", type: "domain", description: "Cover configuration" },
    { text: "climate:", type: "domain", description: "Climate configuration" },
    { text: "fan:", type: "domain", description: "Fan configuration" },
    { text: "lock:", type: "domain", description: "Lock configuration" },
    { text: "camera:", type: "domain", description: "Camera configuration" },
    { text: "media_player:", type: "domain", description: "Media player configuration" },
    { text: "notify:", type: "domain", description: "Notification configuration" },
    { text: "tts:", type: "domain", description: "Text-to-speech configuration" },
    { text: "mqtt:", type: "domain", description: "MQTT configuration" },
    { text: "http:", type: "domain", description: "HTTP configuration" },
    { text: "logger:", type: "domain", description: "Logger configuration" },
    { text: "recorder:", type: "domain", description: "Recorder configuration" },
    { text: "history:", type: "domain", description: "History configuration" },
    { text: "logbook:", type: "domain", description: "Logbook configuration" },
    { text: "frontend:", type: "domain", description: "Frontend configuration" },
    { text: "config:", type: "domain", description: "Configuration UI" },
    { text: "api:", type: "domain", description: "API configuration" },
    { text: "websocket_api:", type: "domain", description: "WebSocket API" },
    { text: "mobile_app:", type: "domain", description: "Mobile app integration" },
    { text: "shopping_list:", type: "domain", description: "Shopping list" },
    { text: "conversation:", type: "domain", description: "Conversation integration" },
    { text: "default_config:", type: "domain", description: "Default configuration" },
    { text: "system_health:", type: "domain", description: "System health monitoring" },
  ],

  // Common keys for automations
  automation: [
    { text: "alias:", type: "key", description: "Automation friendly name" },
    { text: "description:", type: "key", description: "Automation description" },
    { text: "id:", type: "key", description: "Unique automation ID" },
    { text: "mode:", type: "key", description: "Automation execution mode" },
    { text: "max:", type: "key", description: "Maximum concurrent runs" },
    { text: "max_exceeded:", type: "key", description: "Behavior when max exceeded" },
    { text: "trigger:", type: "key", description: "Automation triggers" },
    { text: "condition:", type: "key", description: "Automation conditions" },
    { text: "action:", type: "key", description: "Automation actions" },
  ],

  // Automation modes
  automation_modes: [
    { text: "single", type: "value", description: "Only one run at a time" },
    { text: "restart", type: "value", description: "Restart automation on new trigger" },
    { text: "queued", type: "value", description: "Queue runs" },
    { text: "parallel", type: "value", description: "Run in parallel" },
  ],

  // Trigger types (HA 2024.4+ uses "trigger:" key; "platform:" is legacy but still supported)
  triggers: [
    { text: "trigger: state", type: "trigger", description: "State change trigger" },
    { text: "trigger: numeric_state", type: "trigger", description: "Numeric state trigger" },
    { text: "trigger: event", type: "trigger", description: "Event trigger" },
    { text: "trigger: time", type: "trigger", description: "Time trigger" },
    { text: "trigger: time_pattern", type: "trigger", description: "Time pattern trigger" },
    { text: "trigger: mqtt", type: "trigger", description: "MQTT trigger" },
    { text: "trigger: webhook", type: "trigger", description: "Webhook trigger" },
    { text: "trigger: zone", type: "trigger", description: "Zone trigger" },
    { text: "trigger: geo_location", type: "trigger", description: "Geo location trigger" },
    { text: "trigger: homeassistant", type: "trigger", description: "Home Assistant event trigger" },
    { text: "trigger: sun", type: "trigger", description: "Sun event trigger" },
    { text: "trigger: tag", type: "trigger", description: "NFC tag trigger" },
    { text: "trigger: template", type: "trigger", description: "Template trigger" },
    { text: "trigger: calendar", type: "trigger", description: "Calendar trigger" },
    { text: "trigger: conversation", type: "trigger", description: "Conversation trigger" },
    { text: "trigger: persistent_notification", type: "trigger", description: "Persistent notification trigger" },
    { text: "platform: state", type: "trigger", description: "State change trigger (legacy)" },
    { text: "platform: numeric_state", type: "trigger", description: "Numeric state trigger (legacy)" },
    { text: "platform: event", type: "trigger", description: "Event trigger (legacy)" },
    { text: "platform: time", type: "trigger", description: "Time trigger (legacy)" },
    { text: "platform: time_pattern", type: "trigger", description: "Time pattern trigger (legacy)" },
    { text: "platform: mqtt", type: "trigger", description: "MQTT trigger (legacy)" },
    { text: "platform: webhook", type: "trigger", description: "Webhook trigger (legacy)" },
    { text: "platform: zone", type: "trigger", description: "Zone trigger (legacy)" },
    { text: "platform: geo_location", type: "trigger", description: "Geo location trigger (legacy)" },
    { text: "platform: homeassistant", type: "trigger", description: "Home Assistant event trigger (legacy)" },
    { text: "platform: sun", type: "trigger", description: "Sun event trigger (legacy)" },
    { text: "platform: tag", type: "trigger", description: "NFC tag trigger (legacy)" },
    { text: "platform: template", type: "trigger", description: "Template trigger (legacy)" },
    { text: "platform: calendar", type: "trigger", description: "Calendar trigger (legacy)" },
    { text: "platform: conversation", type: "trigger", description: "Conversation trigger (legacy)" },
  ],

  // Condition types
  conditions: [
    { text: "condition: state", type: "condition", description: "State condition" },
    { text: "condition: numeric_state", type: "condition", description: "Numeric state condition" },
    { text: "condition: template", type: "condition", description: "Template condition" },
    { text: "condition: time", type: "condition", description: "Time condition" },
    { text: "condition: zone", type: "condition", description: "Zone condition" },
    { text: "condition: sun", type: "condition", description: "Sun condition" },
    { text: "condition: and", type: "condition", description: "AND condition" },
    { text: "condition: or", type: "condition", description: "OR condition" },
    { text: "condition: not", type: "condition", description: "NOT condition" },
    { text: "condition: device", type: "condition", description: "Device condition" },
    { text: "condition: trigger", type: "condition", description: "Trigger condition" },
  ],

  // Common actions (HA 2024.8+: "service:" renamed to "action:")
  services: [
    { text: "action: homeassistant.turn_on", type: "service", description: "Turn on entity" },
    { text: "action: homeassistant.turn_off", type: "service", description: "Turn off entity" },
    { text: "action: homeassistant.toggle", type: "service", description: "Toggle entity" },
    { text: "action: homeassistant.reload_config_entry", type: "service", description: "Reload config entry" },
    { text: "action: homeassistant.restart", type: "service", description: "Restart Home Assistant" },
    { text: "action: homeassistant.stop", type: "service", description: "Stop Home Assistant" },
    { text: "action: homeassistant.update_entity", type: "service", description: "Update entity" },
    { text: "action: light.turn_on", type: "service", description: "Turn on light" },
    { text: "action: light.turn_off", type: "service", description: "Turn off light" },
    { text: "action: light.toggle", type: "service", description: "Toggle light" },
    { text: "action: switch.turn_on", type: "service", description: "Turn on switch" },
    { text: "action: switch.turn_off", type: "service", description: "Turn off switch" },
    { text: "action: switch.toggle", type: "service", description: "Toggle switch" },
    { text: "action: cover.open_cover", type: "service", description: "Open cover" },
    { text: "action: cover.close_cover", type: "service", description: "Close cover" },
    { text: "action: cover.stop_cover", type: "service", description: "Stop cover" },
    { text: "action: climate.set_temperature", type: "service", description: "Set climate temperature" },
    { text: "action: climate.set_hvac_mode", type: "service", description: "Set HVAC mode" },
    { text: "action: notify.notify", type: "service", description: "Send notification" },
    { text: "action: script.turn_on", type: "service", description: "Run script" },
    { text: "action: automation.turn_on", type: "service", description: "Enable automation" },
    { text: "action: automation.turn_off", type: "service", description: "Disable automation" },
    { text: "action: automation.trigger", type: "service", description: "Trigger automation" },
    { text: "action: automation.reload", type: "service", description: "Reload automations" },
    { text: "action: scene.turn_on", type: "service", description: "Activate scene" },
    { text: "action: input_boolean.turn_on", type: "service", description: "Turn on input boolean" },
    { text: "action: input_boolean.turn_off", type: "service", description: "Turn off input boolean" },
    { text: "action: input_boolean.toggle", type: "service", description: "Toggle input boolean" },
    { text: "action: input_number.set_value", type: "service", description: "Set input number value" },
    { text: "action: input_text.set_value", type: "service", description: "Set input text value" },
    { text: "action: input_select.select_option", type: "service", description: "Select input option" },
    { text: "action: input_datetime.set_datetime", type: "service", description: "Set datetime" },
    { text: "action: input_button.press", type: "service", description: "Press input button" },
    { text: "action: counter.increment", type: "service", description: "Increment counter" },
    { text: "action: counter.decrement", type: "service", description: "Decrement counter" },
    { text: "action: counter.reset", type: "service", description: "Reset counter" },
    { text: "action: timer.start", type: "service", description: "Start timer" },
    { text: "action: timer.pause", type: "service", description: "Pause timer" },
    { text: "action: timer.cancel", type: "service", description: "Cancel timer" },
    { text: "action: persistent_notification.create", type: "service", description: "Create notification" },
    { text: "action: persistent_notification.dismiss", type: "service", description: "Dismiss notification" },
    { text: "action: tts.speak", type: "service", description: "Speak text" },
    { text: "action: media_player.media_play", type: "service", description: "Play media" },
    { text: "action: media_player.media_pause", type: "service", description: "Pause media" },
    { text: "action: media_player.media_stop", type: "service", description: "Stop media" },
    { text: "action: media_player.volume_up", type: "service", description: "Increase volume" },
    { text: "action: media_player.volume_down", type: "service", description: "Decrease volume" },
    { text: "action: media_player.volume_set", type: "service", description: "Set volume" },
  ],

  // Common action keys
  actionKeys: [
    { text: "entity_id:", type: "key", description: "Target entity ID" },
    { text: "device_id:", type: "key", description: "Target device ID" },
    { text: "area_id:", type: "key", description: "Target area ID" },
    { text: "data:", type: "key", description: "Service data" },
    { text: "target:", type: "key", description: "Service target" },
    { text: "delay:", type: "key", description: "Delay action" },
    { text: "wait_template:", type: "key", description: "Wait for template" },
    { text: "wait_for_trigger:", type: "key", description: "Wait for trigger" },
    { text: "choose:", type: "key", description: "Choose action based on condition" },
    { text: "repeat:", type: "key", description: "Repeat action" },
    { text: "if:", type: "key", description: "Conditional action" },
    { text: "then:", type: "key", description: "If condition is true" },
    { text: "else:", type: "key", description: "If condition is false" },
    { text: "parallel:", type: "key", description: "Run actions in parallel" },
    { text: "sequence:", type: "key", description: "Sequence of actions" },
  ],

  // Common config keys
  commonKeys: [
    { text: "name:", type: "key", description: "Entity name" },
    { text: "unique_id:", type: "key", description: "Unique entity ID" },
    { text: "icon:", type: "key", description: "Entity icon (mdi:icon-name)" },
    { text: "device_class:", type: "key", description: "Device class" },
    { text: "unit_of_measurement:", type: "key", description: "Unit of measurement" },
    { text: "state:", type: "key", description: "Entity state" },
    { text: "state_topic:", type: "key", description: "MQTT state topic" },
    { text: "command_topic:", type: "key", description: "MQTT command topic" },
    { text: "availability_topic:", type: "key", description: "MQTT availability topic" },
    { text: "payload_on:", type: "key", description: "Payload for ON state" },
    { text: "payload_off:", type: "key", description: "Payload for OFF state" },
    { text: "payload_available:", type: "key", description: "Payload for available" },
    { text: "payload_not_available:", type: "key", description: "Payload for not available" },
    { text: "value_template:", type: "key", description: "Template for value" },
    { text: "availability_template:", type: "key", description: "Template for availability" },
    { text: "attributes:", type: "key", description: "Entity attributes" },
    { text: "friendly_name:", type: "key", description: "Friendly entity name" },
  ],

  // YAML tags
  yamlTags: [
    { text: "!include ", type: "tag", description: "Include another YAML file (no space after !)" },
    { text: "!include_dir_list ", type: "tag", description: "Include directory as list (no space after !)" },
    { text: "!include_dir_named ", type: "tag", description: "Include directory as named entries (no space after !)" },
    { text: "!include_dir_merge_list ", type: "tag", description: "Include and merge directory as list (no space after !)" },
    { text: "!include_dir_merge_named ", type: "tag", description: "Include and merge directory as named (no space after !)" },
    { text: "!secret ", type: "tag", description: "Reference secret from secrets.yaml (no space after !)" },
    { text: "!env_var ", type: "tag", description: "Use environment variable (no space after !)" },
    { text: "!input ", type: "tag", description: "Blueprint input (no space after !)" },
  ],

  // Sensor platforms
  sensorPlatforms: [
    { text: "platform: template", type: "platform", description: "Template sensor" },
    { text: "platform: mqtt", type: "platform", description: "MQTT sensor" },
    { text: "platform: statistics", type: "platform", description: "Statistics sensor" },
    { text: "platform: time_date", type: "platform", description: "Time and date sensor" },
    { text: "platform: rest", type: "platform", description: "REST sensor" },
    { text: "platform: command_line", type: "platform", description: "Command line sensor" },
    { text: "platform: sql", type: "platform", description: "SQL sensor" },
    { text: "platform: file", type: "platform", description: "File sensor" },
    { text: "platform: folder", type: "platform", description: "Folder sensor" },
    { text: "platform: history_stats", type: "platform", description: "History statistics sensor" },
    { text: "platform: trend", type: "platform", description: "Trend sensor" },
    { text: "platform: min_max", type: "platform", description: "Min/Max sensor" },
    { text: "platform: filter", type: "platform", description: "Filter sensor" },
  ],

  snippets: [
    {
      text: "snip:automation",
      label: "Automation Snippet",
      type: "snippet",
      description: "Standard automation template",
      content: "- alias: \"New Automation\"\n  description: \"Description of the automation\"\n  trigger:\n    - platform: state\n      entity_id: light.example\n      to: \"on\"\n  condition: []\n  action:\n    - action: light.turn_on\n      target:\n        entity_id: light.example\n  mode: single"
    },
    {
      text: "snip:script",
      label: "Script Snippet",
      type: "snippet",
      description: "Standard script template",
      content: "new_script:\n  alias: \"New Script\"\n  sequence:\n    - action: light.turn_on\n      target:\n        entity_id: light.example\n  mode: single"
    },
    {
      text: "snip:sensor",
      label: "Template Sensor Snippet",
      type: "snippet",
      description: "Modern template sensor",
      content: "template:\n  - sensor:\n      - name: \"My Sensor\"\n        state: >\n          {{ states('sensor.source') }}\n        unit_of_measurement: \"°C\"\n        device_class: temperature"
    },
    {
      text: "snip:blueprint",
      label: "Blueprint (Automation) Snippet",
      type: "snippet",
      description: "Automation blueprint template",
      content: "blueprint:\n  name: \"My Blueprint\"\n  description: \"\"\n  domain: automation\n  author: \"\"\n  input:\n    trigger_entity:\n      name: Trigger Entity\n      description: The entity that triggers this automation\n      selector:\n        entity: {}\n    target_entity:\n      name: Target Entity\n      description: The entity to control\n      selector:\n        entity: {}\n\ntriggers:\n  - trigger: state\n    entity_id: !input trigger_entity\n    to: \"on\"\n\nconditions: []\n\nactions:\n  - action: homeassistant.turn_on\n    target:\n      entity_id: !input target_entity\n\nmode: single"
    },
    {
      text: "snip:blueprint-script",
      label: "Blueprint (Script) Snippet",
      type: "snippet",
      description: "Script blueprint template",
      content: "blueprint:\n  name: \"My Script Blueprint\"\n  description: \"\"\n  domain: script\n  author: \"\"\n  input:\n    target_entity:\n      name: Target Entity\n      description: The entity to control\n      selector:\n        entity: {}\n\nsequence:\n  - action: homeassistant.turn_on\n    target:\n      entity_id: !input target_entity\n\nmode: single"
    },
    {
      text: "snip:trigger_group",
      label: "Nested Trigger Group Snippet",
      type: "snippet",
      description: "Group multiple triggers with AND/OR logic (HA 2024.10+)",
      content: "triggers:\n  - trigger: or\n    triggers:\n      - trigger: state\n        entity_id: binary_sensor.motion\n        to: \"on\"\n      - trigger: state\n        entity_id: binary_sensor.motion_2\n        to: \"on\""
    },
    {
      text: "snip:continue_on_error",
      label: "Continue on Error Snippet",
      type: "snippet",
      description: "Action step that continues the automation even if it fails (HA 2026.3+)",
      content: "- action: light.turn_on\n  continue_on_error: true\n  target:\n    entity_id: light.example"
    }
  ]
};
