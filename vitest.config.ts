import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 30000,
    teardownTimeout: 60000,
    // include: ['tests/**/*.test.ts'],
    // exclude: [
    //   'tests/**/*performance*.test.ts',
    //   'tests/**/*stress*.test.ts',
    //   'node_modules/**',
    // ],
    reporters: ['verbose'],
    // pool: 'forks',
    // environment: 'node',
    // poolOptions: {
    //   threads: {
    //     singleThread: false,
    //     isolate: true,
    //   },
    //   forks: {
    //     singleFork: false,
    //   },
    // },
    // sequence: {
    //   shuffle: false,
    //   concurrent: false,
    // },
    // maxConcurrency: 1,
  },
})
