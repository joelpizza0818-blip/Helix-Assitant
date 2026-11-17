import test from 'node:test'
import assert from 'node:assert/strict'
import { getInstalledLocalModelItems } from './installedLocalModels'

test('quick selector exposes every installed Ollama and GGUF model with its runnable identifier', () => {
  const models = getInstalledLocalModelItems(
    [
      { name: 'qwen2.5-coder:1.5b', size_gb: 1.04 },
      { name: 'deepseek-r1:1.5b', size_gb: 1.1 },
      { name: 'deepseek-v4.1-flash:cloud', size_gb: 0 },
    ],
    [
      {
        name: 'qwen-coder',
        path: 'C:\\models\\qwen-coder.gguf',
        size_gb: 1.4,
      },
    ],
  )

  assert.deepEqual(models.map((model) => model.id), [
    'qwen2.5-coder:1.5b',
    'deepseek-r1:1.5b',
    'C:\\models\\qwen-coder.gguf',
  ])
  assert.deepEqual(models.map((model) => model.provider), [
    'ollama',
    'ollama',
    'llama_server',
  ])
  assert.equal(models[2].name, 'qwen-coder')
})

test('quick selector does not offer local models that are not installed', () => {
  assert.deepEqual(getInstalledLocalModelItems([], []), [])
})

test('quick selector does not treat Ollama cloud entries as local downloads', () => {
  assert.deepEqual(
    getInstalledLocalModelItems(
      [{ name: 'deepseek-v4.1-flash:cloud', size_gb: 0 }],
      [],
    ),
    [],
  )
})
