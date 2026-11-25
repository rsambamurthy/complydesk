/**
 * MCA form data packs — pure. A form is described as data (forms.ts): parts → fields → where each value comes from.
 * buildForm turns a spec + the client's records into what the screen and the Excel show, with what's still missing.
 * MCA V3 forms are web forms filled on the portal; the pack is what the person copies in (CIN pre-fills the rest there).
 */
export interface Person { id: string; name: string; din: string | null; pan: string | null; email: string | null; designation: string; appointedOn: string | null; ceasedOn: string | null }
export interface Holder { name: string; pan: string | null; folio: string | null; shareClass: string; shares: number; faceValue: string }
export interface Auditor { firmName: string; frn: string | null; appointedOn: string | null; termFromFy: number | null; termToFy: number | null; current: boolean }
export interface MeetingLite { type: 'BOARD' | 'AGM' | 'EGM'; date: string; present: number | null; entitled: number | null }

export interface FormCtx {
  today: string;
  client: { cin: string; name: string; companyType: string; smallCompany: boolean; incorporationDate: string | null; rocOffice: string | null; registeredOffice: string | null; email: string | null; authorisedCapital: string | null; paidUpCapital: string | null };
  profile: Record<string, string>;
  formData: Record<string, string>;
  ob: { ruleCode: string; form: string; fy: number; dueDate: string; eventDate: string | null; personId: string | null };
  people: Person[]; shareholders: Holder[]; auditors: Auditor[];
  years: { fy: number; agmDate: string | null }[];
  /** Meetings held during the filing's FY (from the Meetings module, or the calendar when not recorded there). */
  meetings: MeetingLite[];
}

export type Scope = 'client' | 'filing';
export interface FieldSpec {
  key: string; label: string; help?: string; optional?: boolean;
  /** Other wordings of this field on the MCA portal — the browser extension matches fields by label. */
  aliases?: string[];
  /** Computed from the records; return null when the records don't have it. */
  value?: (c: FormCtx) => string | number | null | undefined;
  /** Typed by the user: kept on the client (reused every year) or on this filing. */
  input?: { scope: Scope; type?: 'text' | 'number' | 'date' | 'select'; options?: string[]; default?: string };
  /** Where to fix it in the records when missing. */
  fixAt?: 'details' | 'directors' | 'shareholders' | 'auditor' | 'year';
  show?: (c: FormCtx) => boolean;
}
export interface TableSpec { key: string; title: string; columns: string[]; rows: (c: FormCtx) => (string | number | null)[][]; empty: string }
export interface PartSpec { title: string; fields?: FieldSpec[]; tables?: TableSpec[] }
export interface FormSpec { form: string; title: string; note?: string; parts: (c: FormCtx) => PartSpec[]; attachments: (c: FormCtx) => { name: string; why?: string }[] }

export interface BuiltField { key: string; label: string; aliases?: string[]; value: string | null; source: 'records' | 'client' | 'filing'; missing: boolean; optional: boolean; help?: string; fixAt?: string; input?: FieldSpec['input'] }
export interface Built {
  form: string; title: string; note?: string;
  parts: { title: string; fields: BuiltField[]; tables: { key: string; title: string; columns: string[]; rows: (string | number | null)[][]; empty: string }[] }[];
  attachments: { name: string; why?: string }[];
  progress: { filled: number; total: number; missing: string[] };
}

const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

export function buildForm(spec: FormSpec, c: FormCtx): Built {
  const missing: string[] = [];
  let filled = 0; let total = 0;
  const parts = spec.parts(c).map((p) => ({
    title: p.title,
    fields: (p.fields ?? []).filter((f) => !f.show || f.show(c)).map((f): BuiltField => {
      const store = f.input?.scope === 'client' ? c.profile : c.formData;
      const value = f.input ? str(store[f.key]) ?? str(f.input.default) : str(f.value?.(c));
      const isMissing = value === null && !f.optional;
      if (!f.optional) { total++; if (isMissing) missing.push(f.label); else filled++; }
      return { key: f.key, label: f.label, aliases: f.aliases, value, source: f.input ? f.input.scope : 'records', missing: isMissing, optional: !!f.optional, help: f.help, fixAt: f.fixAt, input: f.input };
    }),
    tables: (p.tables ?? []).map((t) => ({ key: t.key, title: t.title, columns: t.columns, rows: t.rows(c), empty: t.empty })),
  }));
  return { form: spec.form, title: spec.title, note: spec.note, parts, attachments: spec.attachments(c), progress: { filled, total, missing } };
}

/** Every input key a spec declares, with its scope — the API only accepts these. */
export function inputKeys(spec: FormSpec, c: FormCtx) {
  const out = new Map<string, Scope>();
  for (const p of spec.parts(c)) for (const f of p.fields ?? []) if (f.input) out.set(f.key, f.input.scope);
  return out;
}
