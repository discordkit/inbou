/**
 * JMdict and the JLPT level lists, fetched for the builds that need them.
 *
 * Shared by `build-corpus.mjs` (the quiz's word corpus) and `build-vocab.mjs` (the word list the vocabulary test is checked against), so both read the same release the same way.
 */

import { gunzipSync } from "node:zlib";

// The JMdict release is resolved at build time rather than pinned, so a rebuild
// picks up dictionary corrections. The resolved tag is recorded in the output,
// so any corpus says which release produced it. `INBOU_JMDICT_RELEASE` pins it
// when reproducing a specific build.
const RELEASE = process.env.INBOU_JMDICT_RELEASE;
const RELEASE_API = RELEASE
  ? `https://api.github.com/repos/scriptin/jmdict-simplified/releases/tags/${RELEASE}`
  : `https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest`;

// Unofficial JLPT levels: stephenmk/yomitan-jlpt-vocab, a curated reissue of
// Jonathan Waller's (tanos.co.uk) lists, CC-BY-SA-4.0. Keyed by `jmdict_seq`,
// which is the entry id — so the join is an exact primary-key match rather than
// a lossy text match. Pinned to a commit, since a rolling raw URL is not a
// stable input.
export const JLPT_SHA = `b062d4e38c4bdd0950ae1d4ec55f04b176182e03`;
const JLPT_BASE = `https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/${JLPT_SHA}/original_data`;
// N5 (easiest) is stored as 5 and N1 as 1, so a numeric comparison orders by
// difficulty the way a learner expects.
const JLPT_FILES = [
  { file: `n5.csv`, level: 5 },
  { file: `n4.csv`, level: 4 },
  { file: `n3.csv`, level: 3 },
  { file: `n2.csv`, level: 2 },
  { file: `n1.csv`, level: 1 }
];

const UA = { "User-Agent": `inbou-build` };

const fetchOk = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res;
};

/** JMdict id → JLPT level, easiest level winning if a word appears twice. */
export const fetchJlpt = async () => {
  // Fetched together rather than in sequence: five small files with no
  // dependency between them.
  const files = await Promise.all(
    JLPT_FILES.map(async ({ file, level }) => ({
      level,
      text: await (
        await fetchOk(`${JLPT_BASE}/${file}`, { headers: UA })
      ).text()
    }))
  );

  const byId = new Map();
  for (const { level, text } of files) {
    for (const line of text.split(/\r?\n/).slice(1)) {
      const seq = line.slice(0, line.indexOf(`,`));
      // Ids are bare digits, so this also skips blank lines and any stray
      // header. Files run N5→N1, so the first sighting is the easiest level.
      if (/^\d+$/u.test(seq) && !byId.has(seq)) byId.set(seq, level);
    }
  }
  console.log(`  JLPT levels for ${byId.size} entries`);
  return byId;
};

/**
 * Read the one JSON member out of a gzipped tar, in memory.
 *
 * Unpacked here rather than by shelling out to `tar`: GNU tar reads a Windows
 * path like `C:\…` as `host:path` and tries to resolve a remote host, and the
 * `--force-local` fix is not portable to BSD tar on macOS. The format is simple
 * enough that parsing it directly is both shorter and platform-independent.
 *
 * A tar is 512-byte records: a header, then the file's content padded up to the
 * next 512-byte boundary.
 */
const extractJson = (tgz) => {
  const tar = gunzipSync(tgz);
  const cstr = (bytes) => {
    const end = bytes.indexOf(0);
    return Buffer.from(end === -1 ? bytes : bytes.subarray(0, end)).toString(
      `utf8`
    );
  };

  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = cstr(header.subarray(0, 100));
    // Two zero blocks mark the end of the archive.
    if (name === ``) break;
    // Size is octal ASCII in bytes 124..135; type '0' or NUL is a regular file.
    const size = Number.parseInt(cstr(header.subarray(124, 136)), 8) || 0;
    const type = String.fromCharCode(header[156]);
    const start = offset + 512;
    if ((type === `0` || type === `\0`) && name.endsWith(`.json`)) {
      return Buffer.from(tar.subarray(start, start + size)).toString(`utf8`);
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`no .json member in archive`);
};

/**
 * Download and unpack the JMdict release.
 *
 * `jmdict-examples-eng` rather than plain `jmdict-eng`: it is a strict superset
 * that embeds Tanaka-corpus example sentences per sense, already paired with
 * their English translations. That is the whole Tatoeba integration — no
 * separate sentence download, no index join.
 */
export const fetchJmdict = async () => {
  const release = await (await fetchOk(RELEASE_API, { headers: UA })).json();
  const asset = release.assets.find((a) =>
    /^jmdict-examples-eng-\d.*\.json\.tgz$/u.test(a.name)
  );
  if (!asset) {
    throw new Error(`no jmdict-examples-eng asset on ${release.tag_name}`);
  }

  console.log(`  ${release.tag_name} — ${asset.name}`);
  const tgz = Buffer.from(
    await (
      await fetchOk(asset.browser_download_url, { headers: UA })
    ).arrayBuffer()
  );
  return { json: extractJson(tgz), tag: release.tag_name };
};
