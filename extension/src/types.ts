/** Format exporté par l'application (core/session/export.ts). */
export interface SessionExport {
  format: "psa-prep-session";
  version: 1;
  session: { id: string; name: string; createdAt: string };
  items: SessionExportItem[];
}

export interface SessionExportItem {
  itemId: number;
  position: number;
  cardKey: string | null;
  status: "green" | "orange" | "red" | null;
  title: string | null;
  specId: string | null;
  searchStrings: string[];
  manualFields: { year: string; brand: string; number: string; subject: string; variety: string } | null;
  declaredValue: number | null;
  label: string;
}

export type ItemOutcome = "filled" | "filled_manual_choice" | "manual_entry" | "skipped" | "simulated" | "error";

export interface ItemReport {
  position: number;
  label: string;
  outcome: ItemOutcome;
  chosenTitle?: string;
  message?: string;
}

export interface RunReport {
  sessionName: string;
  mode: "simulation" | "real";
  startedAt: string;
  finishedAt?: string;
  items: ItemReport[];
}
