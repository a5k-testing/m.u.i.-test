import { tap } from 'node:test/reporters';

/**
 * Custom Node.js Test Reporter
 * Extends the built-in TAP reporter to remove 'duration_ms' 
 * while preserving all other debug info and stack traces.
 */
export default async function* cleanTap(source) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // 1. Create a generator that filters/modifies events from the source
  async function* transformSource() {
    for await (const event of source) {
      // Increment counters based on event type
      if (event.type === 'test:pass') passed++;
      if (event.type === 'test:fail') failed++;
      if (event.data?.skip) skipped++;

      // Remove duration_ms from the event data details (YAML block)
      if (event.data?.details?.duration_ms !== undefined) {
        delete event.data.details.duration_ms;
      }

      // Yield the modified event to the next step
      yield event;
    }
  }

  // 2. Pass the entire transformed stream to the built-in tap reporter once.
  // This ensures the reporter maintains correct internal state (test numbers, indentation).
  for await (const line of tap(transformSource())) {
    yield line;
  }

  // 3. Append the final summary output
  yield `\n# --- TEST SUMMARY ---\n`;
  yield `# Passed:  ${passed}\n`;
  yield `# Failed:  ${failed}\n`;
  yield `# Skipped: ${skipped}\n`;
  yield `# Total:   ${passed + failed + skipped}\n`;
  yield `# --------------------\n`;
}
