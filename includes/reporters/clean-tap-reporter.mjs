import { tap } from 'node:test/reporters';

/**
 * Custom Node.js Test Reporter
 * Extends the built-in TAP reporter to remove 'duration_ms' 
 * while preserving all other debug info and stack traces.
 */
export default async function* cleanTap(source) {
  // Create a generator that filters/modifies events from the source
  async function* transformSource() {
    for await (const event of source) {
      if (event.type === 'test:pass' && event.data?.details) {
        // Remove duration_ms from the event data details (YAML block)
        delete event.data.details.duration_ms;
        // If 'details' is now empty, delete it entirely to prevent empty YAML blocks
        if (Object.keys(event.data.details).length === 0) {
          delete event.data.details;
        }
      }

      // Yield the modified event to the next step
      yield event;
    }
  }

  // Use the built-in tap reporter with the cleaned stream
  for await (const line of tap(transformSource())) {
    yield line;
  }
}
