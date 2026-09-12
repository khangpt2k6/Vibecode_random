import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The suite drives the real game in a real browser with a real GPU path, so
 * it catches the class of bug unit tests structurally cannot: a shader that
 * fails to link, a click that never reaches a button, a scene that renders
 * black. Those were the three worst bugs in this project so far, and none of
 * them would have been caught by anything in vitest.
 *
 * Chromium only, and headed by default when run locally, because a headless
 * software rasteriser is not the thing the player uses and WebGL behaves
 * differently on it.
 */
export default defineConfig({
  testDir: './e2e',
  /**
   * Artifacts go to the system temp directory, not into the repo.
   *
   * This repo lives under OneDrive, which syncs `test-results/` out from
   * under a trace that is still being written. The longest test - a full
   * battle, about forty seconds - reliably lost its trace file and failed at
   * `browserContext.close` with ENOENT, which looks exactly like a game bug
   * and is not one.
   */
  outputDir: join(tmpdir(), 'stackmon-e2e'),
  // The game is stateful and shares one localStorage origin, so the specs run
  // one at a time rather than fighting over the same save.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          args: [
            // Force a real GL path. The default headless swiftshader can link
            // shaders this game cannot, which would make the suite lie.
            '--use-gl=angle',
            '--use-angle=default',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],

  webServer: {
    // Vite directly rather than through the workspace script: the npm
    // indirection adds enough startup latency on Windows to trip the timeout,
    // and there is nothing the wrapper does that matters here.
    command: 'npx vite --port 5173 --host 127.0.0.1',
    cwd: 'packages/game',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
