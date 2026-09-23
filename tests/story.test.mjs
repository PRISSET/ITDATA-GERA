import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const story = readFileSync(new URL('../src/story.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(story, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { chapters, chapterWeights } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`)

test('presentation keeps eight ordered scroll chapters', () => {
  const ids = chapters.map(({ id }) => id)
  assert.deepEqual(ids, ['hello', 'intro', 'network', 'servers', 'cloud', 'training', 'end', 'thanks'])
})

test('scroll progress selects exactly one chapter at every chapter center', () => {
  chapters.forEach((_, index) => {
    const weights = chapterWeights(index / (chapters.length - 1))
    assert.equal(weights[index], 1)
    assert.equal(weights.reduce((sum, value) => sum + value, 0), 1)
  })
  assert.deepEqual(chapterWeights(-1), chapterWeights(0))
  assert.deepEqual(chapterWeights(2), chapterWeights(1))
})

test('Ausbildung is described as fitting work, not as an advertised vacancy', () => {
  assert.equal(chapters.find(({ id }) => id === 'training').note, 'Passende Berufe — keine bestätigten Stellen')
})
