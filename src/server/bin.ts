#!/usr/bin/env node
import { startMatthewServer } from "./index.js";

startMatthewServer()
  .then(({ port }) => {
    console.log(`OpenMatthew server listening on http://127.0.0.1:${port}`);
    console.log("POST /v1/chat/completions with Authorization: Bearer <credentials>");
  })
  .catch((err) => {
    console.error("Failed to start OpenMatthew server:", err);
    process.exitCode = 1;
  });
