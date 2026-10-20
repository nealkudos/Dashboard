// ┌───────────────────────────────────────────────────────────────┐
// │  BLOCK REGISTRY — the only file you edit to add a new block.   │
// │  1. Copy _template.js to e.g. calendar.js and change it.        │
// │  2. Import it below and add it to the list.                     │
// │  The list order is the default layout; you can rearrange       │
// │  on the dashboard itself with Menu → Edit layout.              │
// └───────────────────────────────────────────────────────────────┘
import welcome from "./welcome.js";
import calendar from "./calendar.js";
import links from "./links.js";
import notes from "./notes.js";
import trading from "./trading.js";
import scanner from "./scanner.js";
import botStatus from "./bot-status.js";
import budget from "./budget.js";
import football from "./football.js";

export default [
  welcome,
  calendar,
  trading,
  scanner,
  botStatus,
  budget,
  football,
  links,
  notes,
];
