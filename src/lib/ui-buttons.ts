/**
 * Shared FamilyBoard control styles — squared soft corners, not pills.
 * Use these (or the matching `.fb-btn*` classes in globals.css) for CTAs,
 * modal actions, chips, and compact toolbar controls.
 */

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const fbBtn = `${base} px-3.5 py-2 text-base`;
export const fbBtnSm = `${base} px-2.5 py-1.5 text-sm`;
export const fbBtnLg = `${base} px-4 py-2.5 text-base sm:px-5 sm:text-lg`;
export const fbBtnXs = `${base} px-2.5 py-1 text-xs font-semibold sm:text-sm`;

export const fbBtnPrimary = `${fbBtn} bg-sky-600 text-white hover:bg-sky-500`;
export const fbBtnPrimarySm = `${fbBtnSm} bg-sky-600 text-white hover:bg-sky-500`;
export const fbBtnPrimaryLg = `${fbBtnLg} bg-sky-600 text-white hover:bg-sky-500`;
export const fbBtnPrimaryXs = `${fbBtnXs} bg-sky-600 text-white hover:bg-sky-500`;

export const fbBtnSecondary = `${fbBtn} border-slate-600 bg-slate-800 text-slate-100 hover:border-slate-500 hover:bg-slate-700`;
export const fbBtnSecondarySm = `${fbBtnSm} border-slate-600 bg-slate-800 text-slate-100 hover:border-slate-500 hover:bg-slate-700`;
export const fbBtnSecondaryLg = `${fbBtnLg} border-slate-600 bg-slate-800 text-slate-100 hover:border-slate-500 hover:bg-slate-700`;

export const fbBtnGhost =
  "inline-flex items-center justify-center rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50";
export const fbBtnGhostSm =
  "inline-flex items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-white disabled:opacity-50";

export const fbBtnDanger = `${fbBtn} border-rose-800/70 bg-transparent text-rose-200 hover:border-rose-600 hover:bg-rose-950/40`;
export const fbBtnDangerLg = `${fbBtnLg} border-rose-800/70 bg-transparent text-rose-200 hover:border-rose-600 hover:bg-rose-950/40`;

export const fbBtnAccent = `${fbBtn} bg-white text-slate-900 hover:bg-slate-100`;
export const fbBtnAccentLg = `${fbBtnLg} bg-white text-slate-900 hover:bg-slate-100`;

export const fbBtnSuccess = `${fbBtn} bg-emerald-600 text-white hover:bg-emerald-500`;
export const fbBtnSuccessXs = `${fbBtnXs} bg-emerald-500 text-white hover:bg-emerald-400`;

export const fbBtnApprove = `${fbBtn} bg-emerald-300 font-semibold text-slate-950 hover:bg-emerald-200`;
export const fbBtnApproveLg = `${fbBtnLg} bg-emerald-300 font-semibold text-slate-950 hover:bg-emerald-200`;
export const fbBtnDeny = `${fbBtn} border-rose-500/70 bg-rose-950/40 font-semibold text-rose-50 hover:bg-rose-900/50`;
export const fbBtnDenyLg = `${fbBtnLg} border-rose-500/70 bg-rose-950/40 font-semibold text-rose-50 hover:bg-rose-900/50`;

export const fbBtnChip =
  "inline-flex items-center justify-center rounded-md border border-slate-600/80 bg-slate-900/80 px-3.5 py-2 text-base leading-snug text-slate-50 transition-colors hover:border-slate-400 hover:bg-slate-800 disabled:opacity-50";

export const fbBtnIcon =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-600 text-slate-100 transition-colors hover:border-slate-400 disabled:opacity-50";
