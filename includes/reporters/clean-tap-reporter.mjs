import { tap } from 'node:test/reporters';

/**
 * Custom Node.js Test Reporter
 * Removes 'duration_ms' and forces the removal of empty YAML blocks.
 */
export default async function* cleanTap(source) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  async function* transformSource() {
    for await (const event of source) {
      if (event.type === 'test:pass') passed++;
      if (event.type === 'test:fail') failed++;
      if (event.data?.skip) skipped++;

      // Access the data object where 'details' lives
      const data = event.data;

      if (data?.details) {
        // 1. Remove the duration
        delete data.details.duration_ms;

        // 2. Check if details is now effectively empty
        if (Object.keys(data.details).length === 0) {
          // 3. Delete the 'details' key from 'data' entirely.
          // If 'details' is missing, the TAP reporter won't start a YAML block.
          delete data.details;
        }
      }

      yield event;
    }
  }

  for await (const line of tap(transformSource())) {
    yield line;
  }

  yield `\n# --- TEST SUMMARY ---\n`;
  yield `# Passed:  ${passed}\n`;
  yield `# Failed:  ${failed}\n`;
  yield `# Skipped: ${skipped}\n`;
  yield `# Total:   ${passed + failed + skipped}\n`;
  yield `# --------------------\n`;
}
