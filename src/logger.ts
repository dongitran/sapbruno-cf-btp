const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[0;32m";
const CYAN = "\x1b[0;36m";
const YELLOW = "\x1b[1;33m";
const RED = "\x1b[0;31m";
const RESET = "\x1b[0m";

export const log = {
  info: (msg: string): void => {
    process.stderr.write(`  ${CYAN}i  ${msg}${RESET}\n`);
  },
  warn: (msg: string): void => {
    process.stderr.write(`  ${YELLOW}!  ${msg}${RESET}\n`);
  },
  error: (msg: string): void => {
    process.stderr.write(`  ${RED}x  ${msg}${RESET}\n`);
  },
  success: (msg: string): void => {
    process.stderr.write(`  ${GREEN}+  ${msg}${RESET}\n`);
  },
  dim: (msg: string): void => {
    process.stderr.write(`  ${DIM}${msg}${RESET}\n`);
  },
  bold: (msg: string): void => {
    process.stderr.write(`  ${BOLD}${msg}${RESET}\n`);
  },
};
