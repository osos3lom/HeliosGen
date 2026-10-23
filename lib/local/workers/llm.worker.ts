/// <reference lib="webworker" />
// WebLLM engine host: all model loading and token generation run here, off the
// main thread; lib/local/runtime.ts talks to it through CreateWebWorkerMLCEngine.
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
