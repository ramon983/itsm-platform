/** Public holidays for the countries our human agents work in (Nager.Date public API, cached per country/year). */

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string; // English name
  localName: string;
  country: string;
  source: 'nager' | 'builtin';
}

export const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', ES: 'Spain', FR: 'France', DE: 'Germany', IN: 'India', JP: 'Japan',
  BR: 'Brazil', PT: 'Portugal', IT: 'Italy', MX: 'Mexico', IE: 'Ireland', NL: 'Netherlands', AU: 'Australia',
};

export const flag = (cc: string) => String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));

// Nager.Date does not cover these countries. Only fixed-date national holidays are listed — regional and
// lunar-calendar holidays vary, and we would rather show fewer than show wrong ones.
const BUILTIN: Record<string, (year: number) => Omit<Holiday, 'country' | 'source'>[]> = {
  IN: (y) => [
    { date: `${y}-01-26`, name: 'Republic Day', localName: 'गणतंत्र दिवस' },
    { date: `${y}-08-15`, name: 'Independence Day', localName: 'स्वतंत्रता दिवस' },
    { date: `${y}-10-02`, name: 'Gandhi Jayanti', localName: 'गांधी जयंती' },
    { date: `${y}-12-25`, name: 'Christmas Day', localName: 'Christmas' },
  ],
};

const cacheKey = (cc: string, year: number) => `adminzero-holidays-${cc}-${year}`;

function readCache(cc: string, year: number): Holiday[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(cc, year));
    return raw ? (JSON.parse(raw) as Holiday[]) : null;
  } catch {
    return null;
  }
}

function writeCache(cc: string, year: number, list: Holiday[]) {
  try {
    localStorage.setItem(cacheKey(cc, year), JSON.stringify(list));
  } catch {
    /* storage full or blocked — holidays are re-fetched next time */
  }
}

export async function fetchHolidays(cc: string, year: number, fetchImpl: typeof fetch = fetch): Promise<Holiday[]> {
  const builtin = BUILTIN[cc];
  if (builtin) return builtin(year).map((h) => ({ ...h, country: cc, source: 'builtin' }));
  const cached = readCache(cc, year);
  if (cached) return cached;
  const res = await fetchImpl(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`);
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`Holiday API returned ${res.status} for ${cc}`);
  const data = (await res.json()) as { date: string; name: string; localName: string; global: boolean }[];
  // National holidays only — regional ones (e.g. a single US state) would mislabel the whole team.
  const list = data.filter((h) => h.global).map((h) => ({ date: h.date, name: h.name, localName: h.localName, country: cc, source: 'nager' as const }));
  writeCache(cc, year, list);
  return list;
}

/** Holidays for every country, this year and next, within [from, from + days]. Failures are reported per country. */
export async function upcomingHolidays(countries: string[], fromYmd: string, days: number, fetchImpl: typeof fetch = fetch) {
  const year = Number(fromYmd.slice(0, 4));
  const until = new Date(Date.parse(`${fromYmd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const failed: string[] = [];
  const all: Holiday[] = [];
  await Promise.all(
    [...new Set(countries)].map(async (cc) => {
      try {
        for (const y of until.slice(0, 4) === String(year) ? [year] : [year, year + 1]) all.push(...(await fetchHolidays(cc, y, fetchImpl)));
      } catch {
        failed.push(cc);
      }
    }),
  );
  return { holidays: all.filter((h) => h.date >= fromYmd && h.date <= until).sort((a, b) => a.date.localeCompare(b.date)), failed };
}
