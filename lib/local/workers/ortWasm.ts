/**
 * The one ONNX Runtime wasm both workers load. `onnxruntime-web` is pinned to
 * the exact build `@huggingface/transformers` depends on, so the SD-Turbo and
 * tools workers share one package and Vite emits a single
 * `ort-wasm-simd-threaded.asyncify-*.wasm` — served from our own origin instead
 * of the jsdelivr CDN that both libraries default to. The asyncify factory is
 * already inside the `onnxruntime-web/webgpu` bundle, so only the wasm is set.
 */
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

export const ORT_WASM_PATHS = { wasm };
