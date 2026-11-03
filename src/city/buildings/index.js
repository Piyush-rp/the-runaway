// Registers every building. Each file default-exports build(ctx) and owns the slots listed beside it
// (slot data lives in ../layout.js BUILDINGS). Shared helpers live in kit.js.
import buildKnowledge from './knowledge.js';   // knowledge
import buildInner from './inner.js';           // hq-north, docs, code, automation, calendar, people, mail
import buildOuterNorth from './outerNorth.js'; // models-box, cloud, gear, database, models
import buildOuterSouth from './outerSouth.js'; // shield, search, storage, analytics, chart

export default function buildBuildings(ctx) {
  for (const [name, build] of Object.entries({ buildKnowledge, buildInner, buildOuterNorth, buildOuterSouth })) {
    try { build(ctx); } catch (err) { console.error(`[buildings] ${name} failed`, err); }
  }
}
