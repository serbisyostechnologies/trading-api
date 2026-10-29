const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const configured = process.env.LOG_LEVEL || "info";
const threshold = levels[configured] ?? levels.info;

function write(level, message, meta = {}) {
  if (levels[level] > threshold) return;
  const record = { time: new Date().toISOString(), level, message, ...meta };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else console.log(line);
}
export const logger = {
  error: (message, meta) => write("error", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  info: (message, meta) => write("info", message, meta),
  debug: (message, meta) => write("debug", message, meta),
};
