import { describe, expect, it } from 'vitest'
import en from './en/translation.json'
import ko from './ko/translation.json'
import ja from './ja/translation.json'
import zh from './zh/translation.json'

function leaves(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    Object.entries(leaves(child, prefix ? `${prefix}.${key}` : key))))
}

describe('translations', () => {
  const source = leaves(en)
  for (const [language, dictionary] of Object.entries({ ko, ja, zh })) {
    it(`${language} contains every English key with matching placeholders`, () => {
      const translated = leaves(dictionary)
      for (const [key, value] of Object.entries(source)) {
        expect(translated[key], `${language}: ${key}`).toBeDefined()
        const placeholders = (text: string) => [...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(match => match[1].trim()).sort()
        expect(placeholders(translated[key] ?? ''), `${language}: ${key}`).toEqual(placeholders(value))
      }
    })
  }
})
