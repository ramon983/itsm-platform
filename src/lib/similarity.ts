/** Small TF-IDF + cosine similarity engine used by the copilot (similar tickets, KB matching) and pattern detection. */

const STOP = new Set([
  'the', 'and', 'for', 'with', 'not', 'after', 'from', 'into', 'this', 'that', 'are', 'was', 'were', 'has', 'have', 'had',
  'can', 'cannot', 'does', 'did', 'but', 'all', 'any', 'out', 'new', 'since', 'when', 'then', 'than', 'via', 'per', 'its',
  'user', 'users', 'needs', 'need', 'needed', 'request', 'issue', 'every', 'few', 'minutes', 'keeps', 'now', 'only', 'our',
  'your', 'you', 'they', 'them', 'their', 'will', 'would', 'should', 'could', 'been', 'being', 'also', 'just', 'get', 'got',
  'help', 'please', 'working', 'work', 'not', 'one', 'two', 'three', 'last', 'week', 'today', 'morning',
]);

const SYNONYMS: Record<string, string> = {
  syncing: 'sync', synced: 'sync', synchronise: 'sync', synchronize: 'sync',
  locked: 'lock', lockout: 'lock', locks: 'lock',
  connecting: 'connect', connection: 'connect', connected: 'connect', connects: 'connect',
  certificates: 'certificate', cert: 'certificate', certs: 'certificate',
  microphone: 'audio', mic: 'audio', sound: 'audio',
  licence: 'license', licenses: 'license', licences: 'license', seat: 'license', seats: 'license',
  calendars: 'calendar', invites: 'calendar', invite: 'calendar', meetings: 'calendar',
  updating: 'update', updated: 'update', updates: 'update', upgrade: 'update',
  failing: 'fail', fails: 'fail', failed: 'fail', failure: 'fail', failures: 'fail', error: 'fail', errors: 'fail',
  drops: 'drop', dropping: 'drop', dropped: 'drop', cuts: 'drop', crackling: 'drop',
  mfa: 'mfa', verify: 'mfa', '2fa': 'mfa',
  macbook: 'mac', macos: 'mac', laptop: 'mac',
};

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]+/g) ?? [])
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

export type Vector = Map<string, number>;

export class TfIdf {
  private readonly idf = new Map<string, number>();
  private readonly n: number;

  constructor(corpus: string[]) {
    this.n = corpus.length;
    const df = new Map<string, number>();
    for (const doc of corpus) for (const term of new Set(tokenize(doc))) df.set(term, (df.get(term) ?? 0) + 1);
    for (const [term, count] of df) this.idf.set(term, Math.log((1 + this.n) / (1 + count)) + 1);
  }

  vector(text: string): Vector {
    const tf = new Map<string, number>();
    for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vector = new Map();
    for (const [t, c] of tf) v.set(t, c * (this.idf.get(t) ?? Math.log(1 + this.n) + 1));
    return v;
  }
}

export function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  for (const [t, v] of a) dot += v * (b.get(t) ?? 0);
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function sharedTerms(a: Vector, b: Vector, limit = 4): string[] {
  return [...a.keys()].filter((t) => b.has(t)).sort((x, y) => (b.get(y) ?? 0) - (b.get(x) ?? 0)).slice(0, limit);
}

export function addInto(target: Vector, v: Vector): void {
  for (const [t, w] of v) target.set(t, (target.get(t) ?? 0) + w);
}
