/**
 * The font picker's list (Story 5.11): the attached design system's families first, then the
 * families the file's text styles use, then every family the editor has installed. Each family
 * appears once, under the first source that has it.
 */
export type FontSource = 'Design system' | 'This file' | 'Installed';

export interface FontEntry {
  family: string;
  source: FontSource;
}

export function fontList(sources: {
  designSystem: readonly string[];
  file: readonly string[];
  installed: readonly string[];
}): FontEntry[] {
  const seen = new Set<string>();
  const out: FontEntry[] = [];
  const add = (families: readonly string[], source: FontSource, sort: boolean) => {
    const list = sort ? [...families].sort((a, b) => a.localeCompare(b)) : families;
    for (const family of list) {
      const key = family.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ family: family.trim(), source });
    }
  };
  add(sources.designSystem, 'Design system', false);
  add(sources.file, 'This file', true);
  add(sources.installed, 'Installed', true);
  return out;
}

/** Case-insensitive, matching anywhere in the family name. */
export const filterFonts = (fonts: readonly FontEntry[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? fonts.filter((f) => f.family.toLowerCase().includes(q)) : [...fonts];
};
