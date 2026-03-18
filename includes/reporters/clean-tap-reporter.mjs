import { TAP } from 'node:test/reporters';

/**
 * Custom Node.js Test Reporter
 * Extends TAP to remove 'duration_ms' while preserving all other debug info and stack traces.
 */
export default async function* cleanTap(source) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for await (const event of source) {
    // Track test results for the final summary
    if (event.type === 'test:pass') passed++;
    if (event.type === 'test:fail') failed++;
    if (event.data?.skip) skipped++;

    // Remove the duration_ms property from the event data before it's rendered
    if (event.data?.details?.duration_ms !== undefined) {
      delete event.data.details.duration_ms;
    }

    // Use the built-in TAP generator to format the modified event
    const tapGenerator = TAP(async function* () { yield event; }());
    for await (const line of tapGenerator) {
      // Final safety check to skip any remaining duration lines
      // Safety check to avoid printing empty blocks if only durations remained
      if (!line.includes('duration_ms:')) {
        yield line;
      }
    }
  }

  // Final Summary Output
  yield `\n# --- TEST SUMMARY ---\n`;
  yield `# Passed:  ${passed}\n`;
  yield `# Failed:  ${failed}\n`;
  yield `# Skipped: ${skipped}\n`;
  yield `# Total:   ${passed + failed + skipped}\n`;
  yield `# --------------------\n`;
}
