// Which agent lives in each building (keyed by layout.js BUILDINGS id).
// Placeholder data for now; later this comes from Cobi's live agent registry over the event bus.
export const AGENTS = {
  knowledge:    { agent: 'Knowledge Agent',  role: 'Stores, indexes and recalls your documents, notes and facts.' },
  'hq-north':   { agent: 'Core Annex',       role: 'Coordination hub that hands work between Cobi and the agents.' },
  docs:         { agent: 'Documents Agent',  role: 'Reads, writes and summarises documents and files.' },
  code:         { agent: 'Code Agent',       role: 'Writes, reviews and runs code across your projects.' },
  automation:   { agent: 'Automation Agent', role: 'Runs scheduled jobs, triggers and multi-step workflows.' },
  calendar:     { agent: 'Calendar Agent',   role: 'Keeps your schedule, reminders and deadlines.' },
  people:       { agent: 'People Agent',     role: 'Remembers contacts, relationships and conversations.' },
  mail:         { agent: 'Mail Agent',       role: 'Triages, drafts and sends email.' },
  'models-box': { agent: 'Model Hub',        role: 'Hosts and routes requests to the AI models.' },
  cloud:        { agent: 'Cloud Agent',      role: 'Syncs data and manages cloud services.' },
  gear:         { agent: 'Settings Agent',   role: 'Holds preferences, configuration and system tuning.' },
  shield:       { agent: 'Security Agent',   role: 'Guards permissions, approvals and risky actions.' },
  search:       { agent: 'Search Agent',     role: 'Finds information on the web and across your files.' },
  storage:      { agent: 'Storage Agent',    role: 'Manages long-term storage and backups.' },
  analytics:    { agent: 'Analytics Agent',  role: 'Tracks activity and turns it into insights.' },
  chart:        { agent: 'Reports Agent',    role: 'Builds charts, dashboards and progress reports.' },
  models:       { agent: 'Models Lab',       role: 'Experiments with, tunes and evaluates models.' },
  database:     { agent: 'Database Agent',   role: 'Reads and writes structured data and memory tables.' },
};
