#!/usr/bin/env node
/**
 * Export HeliosGen desktop data (SQLite guest.db + generated media) into a
 * zip the browser version imports from Settings → Data → Import desktop data.
 *
 *   node scripts/export-desktop-data.mjs [options]
 *
 *   --data-dir <dir>   folder containing guest.db
 *   --media-dir <dir>  folder containing images/, videos/, uploads/, references/
 *   --out <file>       output zip (default: ./heliosgen-export-<date>.zip)
 *   --include-keys     also export saved API keys (off by default — the zip
 *                      would then contain secrets)
 *
 * Without --data-dir/--media-dir it uses HELIOS_DATA_DIR / HELIOS_MEDIA_DIR,
 * then the desktop app's data folder for this OS, then the repo's dev
 * folders (./data, ./public/generated). The database is opened read-only;
 * quit the desktop app first so its latest writes are flushed.
 *
 * Needs Node 22.13+ (built-in node:sqlite).
 */
import { createReadStream, existsSync, openSync, writeSync, closeSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";

const FORMAT = "heliosgen-desktop-export";
const VERSION = 1;
const TAURI_ID = "cash.sdd.helios.desktop";
const SECRET_KEYS = new Set(["kie_api_token", "azure_api_key"]);
const USAGE = "Usage: node scripts/export-desktop-data.mjs [--data-dir DIR] [--media-dir DIR] [--out FILE] [--include-keys]";

// ── Arguments ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { includeKeys: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--include-keys") out.includeKeys = true;
    else if (a === "--data-dir") out.dataDir = argv[++i];
    else if (a === "--media-dir") out.mediaDir = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return out;
}

/** Where Tauri's app_data_dir() puts the desktop app's data on each OS. */
function tauriDataDir() {
  const home = homedir();
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), TAURI_ID);
  if (process.platform === "darwin") return join(home, "Library", "Application Support", TAURI_ID);
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), TAURI_ID);
}

function resolveDirs(args) {
  if (args.dataDir) {
    const dataDir = resolve(args.dataDir);
    return { dataDir, mediaDir: resolve(args.mediaDir ?? join(dataDir, "generated")) };
  }
  if (process.env.HELIOS_DATA_DIR) {
    const dataDir = resolve(process.env.HELIOS_DATA_DIR);
    return { dataDir, mediaDir: resolve(args.mediaDir ?? process.env.HELIOS_MEDIA_DIR ?? join(dataDir, "generated")) };
  }
  const tauri = tauriDataDir();
  if (existsSync(join(tauri, "guest.db"))) return { dataDir: tauri, mediaDir: resolve(args.mediaDir ?? join(tauri, "generated")) };
  return { dataDir: resolve("data"), mediaDir: resolve(args.mediaDir ?? join("public", "generated")) };
}

// ── Database ──────────────────────────────────────────────────────────────────

const parseArr = (v) => {
  if (typeof v !== "string" || !v) return undefined;
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : undefined;
  } catch {
    return undefined;
  }
};

async function readDatabase(dbPath, includeKeys) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const all = (sql) => {
    try {
      return db.prepare(sql).all();
    } catch (e) {
      // Older databases may lack a table; export what exists.
      if (/no such table/i.test(e.message)) return [];
      throw e;
    }
  };

  const tables = {
    generations: all("SELECT * FROM generations").map((r) => ({
      ...r,
      sound: r.sound == null ? undefined : Boolean(r.sound),
      reference_image_urls: parseArr(r.reference_image_urls),
      image_urls: parseArr(r.image_urls),
    })),
    uploads: all("SELECT * FROM uploads"),
    asset_cache: all("SELECT * FROM asset_cache"),
    folders: all("SELECT * FROM folders"),
    folder_items: all("SELECT * FROM folder_items"),
    spaces: all("SELECT data FROM spaces ORDER BY updated_at ASC")
      .map((r) => {
        try {
          return JSON.parse(r.data);
        } catch {
          return null;
        }
      })
      .filter(Boolean),
    settings: all("SELECT key, value FROM settings").filter(
      (r) => !r.key.startsWith("_import") && (includeKeys || !SECRET_KEYS.has(r.key)),
    ),
  };
  db.close();
  return tables;
}

// ── Media ─────────────────────────────────────────────────────────────────────

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile() && !entry.name.startsWith(".")) yield p;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const { dataDir, mediaDir } = resolveDirs(args);
  const dbPath = join(dataDir, "guest.db");
  if (!existsSync(dbPath)) throw new Error(`No guest.db found in ${dataDir}. Pass --data-dir <folder containing guest.db>.`);

  const out = resolve(args.out ?? `heliosgen-export-${new Date().toISOString().slice(0, 10)}.zip`);
  console.log(`Database: ${dbPath}`);
  console.log(`Media:    ${existsSync(mediaDir) ? mediaDir : "(none found)"}`);

  const tables = await readDatabase(dbPath, args.includeKeys);
  const mediaFiles = existsSync(mediaDir) ? [...walk(mediaDir)] : [];
  const mediaBytes = mediaFiles.reduce((n, f) => n + statSync(f).size, 0);

  const fd = openSync(out, "w");
  let failed = null;
  const done = new Promise((resolveDone, rejectDone) => {
    const zip = new Zip((err, chunk, final) => {
      if (err) return rejectDone(err);
      writeSync(fd, chunk);
      if (final) resolveDone();
    });

    const addJson = (name, value) => {
      const f = new ZipDeflate(name, { level: 6 });
      zip.add(f);
      f.push(strToU8(JSON.stringify(value)), true);
    };

    (async () => {
      addJson("manifest.json", {
        format: FORMAT,
        version: VERSION,
        exportedAt: new Date().toISOString(),
        includesKeys: args.includeKeys,
        counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
        media: { files: mediaFiles.length, bytes: mediaBytes },
      });
      for (const [name, rows] of Object.entries(tables)) addJson(`tables/${name}.json`, rows);

      // Media is already compressed (png/jpg/mp4) — store it as-is.
      let i = 0;
      for (const file of mediaFiles) {
        const rel = relative(mediaDir, file).split(sep).join("/");
        const entry = new ZipPassThrough(`media/${rel}`);
        zip.add(entry);
        for await (const chunk of createReadStream(file)) entry.push(new Uint8Array(chunk));
        entry.push(new Uint8Array(0), true);
        if (++i % 25 === 0 || i === mediaFiles.length) process.stdout.write(`\r  media ${i}/${mediaFiles.length}`);
      }
      if (mediaFiles.length) process.stdout.write("\n");
      zip.end();
    })().catch(rejectDone);
  });

  try {
    await done;
  } catch (e) {
    failed = e;
  } finally {
    closeSync(fd);
  }
  if (failed) throw failed;

  const c = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  console.log(
    `Exported ${c.generations} generations, ${c.uploads} uploads, ${c.spaces} workflows, ${c.folders} folders, ` +
      `${mediaFiles.length} media files (${(mediaBytes / 1e6).toFixed(1)} MB)` +
      (args.includeKeys ? ", including API keys" : " — API keys not included"),
  );
  console.log(`→ ${out}`);
  console.log("Import it in the web app: Settings → Data → Import desktop data.");
}


main().catch((e) => {
  console.error(`Export failed: ${e.message}`);
  process.exit(1);
});
