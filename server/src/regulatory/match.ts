/**
 * Which of a firm's clients a regulatory update affects — pure, tested in tests/regulatory.test.ts.
 * Same conditions as a compliance rule's `applies`: company types, small company or not, flags; `all` = every company.
 */
export interface RegApplies { types?: string[]; small?: boolean; flags?: string[]; all?: boolean }
export interface ClientFacts { id: string; name: string; cin: string; companyType: string; smallCompany: boolean; flags: Record<string, boolean> }

export function affects(a: RegApplies, c: ClientFacts) {
  if (a.all) return true;
  if (!a.types?.length && a.small === undefined && !a.flags?.length) return true;
  if (a.types?.length && !a.types.includes(c.companyType)) return false;
  if (a.small !== undefined && a.small !== c.smallCompany) return false;
  if (a.flags?.length && !a.flags.every((f) => c.flags?.[f])) return false;
  return true;
}

/** "Private companies (not small) with MSME dues" — for screens and emails. */
export function describeApplies(a: RegApplies, flagLabel: (f: string) => string = (f) => f) {
  if (a.all || (!a.types?.length && a.small === undefined && !a.flags?.length)) return 'All companies';
  const t = a.types?.length ? a.types.map((x) => (x === 'OPC' ? 'One Person Companies' : x === 'PRIVATE' ? 'Private companies' : x)).join(' and ') : 'Companies';
  const s = a.small === true ? ' that are small companies' : a.small === false ? ' that are not small companies' : '';
  const f = a.flags?.length ? ` where: ${a.flags.map(flagLabel).join('; ')}` : '';
  return `${t}${s}${f}`;
}
