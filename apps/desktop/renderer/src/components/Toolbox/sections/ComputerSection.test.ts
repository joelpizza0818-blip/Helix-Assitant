mport test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const styles = readFileSync(join(__dirname, '..', 'Toolbox.css'), 'utf8')
const component = readFileSync(join(__dirname, 'ComputerSection.tsx'), 'utf8')

test('screen vision descriptions can wrap within a narrow Toolbox card', () => {
  assert.match(styles, /\.toolbox__content\s*\{[^}]*min-width:\s*0/s)
  assert.match(styles, /\.screen-vision-row\s*>\s*\.form-label\s*\{[^}]*min-width:\s*0/s)
  assert.match(styles, /\.screen-vision-description\s*\{[^}]*overflow-wrap:\s*anywhere/s)
  assert.match(component, /className="toolbox-card screen-vision-card"/)
  assert.match(component, /className="form-row screen-vision-row"/)
  assert.match(component, /className="toolbox-section__desc screen-vision-description"/)
})

test('sampling interval control exposes validated default and safe bounds', () => {
  assert.match(component, /settings\.continuous_screen_vision_interval_ms \?\? 10000/)
  assert.match(component, /value=\{intervalDraft\}/)
  assert.match(component, /min=\{10000\}/)
  assert.match(component, /max=\{60000\}/)
  assert.match(component, /interval >= 10000/)
  assert.match(component, /onBlur=\{saveInterval\}/)
  assert.match(component, /continuous_screen_vision_enabled/)
  assert.match(component, /aria-label="Enable continuous screen vision"/)
  assert.match(component, /model_decides_screen_vision_enabled/)
  assert.match(component, /Let the model decide when to inspect the screen/)
  assert.doesNotMatch(component, /disabled\s+aria-label="Continuous screen video unavailable"/)
  assert.match(component, /only while HELIX is handling a request/)
  assert.match(component, /at most once every 10 seconds/)
  assert.match(component, /sampling pauses until the request ends/)
  assert.match(component, /Provider quotas or charges may still apply/)
})
