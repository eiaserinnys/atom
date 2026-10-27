import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fakeTimers: {
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    },
  },
})
