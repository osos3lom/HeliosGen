/**
 * Lazily loaded ffmpeg.wasm (single-thread core). GitHub Pages can't send the
 * COOP/COEP headers the multi-threaded core needs, so this is the portable
 * build; `-c copy` operations (trim) stay fast regardless. The core (~30 MB)
 * is self-hosted from the build output and fetched only on first use.
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

let instance: Promise<FFmpeg> | null = null;

export function getFFmpeg(): Promise<FFmpeg> {
  instance ??= (async () => {
    const ff = new FFmpeg();
    await ff.load({ coreURL, wasmURL });
    return ff;
  })().catch((e) => {
    instance = null; // allow a retry after a failed load
    throw e;
  });
  return instance;
}

/** Run one ffmpeg job against in-memory files; inputs/outputs are cleaned up. */
export async function runFFmpeg(
  inputs: Record<string, Blob>,
  args: string[],
  output: string,
): Promise<Uint8Array> {
  const ff = await getFFmpeg();
  const names = Object.keys(inputs);
  try {
    for (const name of names) await ff.writeFile(name, new Uint8Array(await inputs[name].arrayBuffer()));
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const data = await ff.readFile(output);
    if (typeof data === "string" || data.byteLength === 0) throw new Error("ffmpeg produced no output");
    return data;
  } finally {
    for (const name of [...names, output]) await ff.deleteFile(name).catch(() => {});
  }
}
