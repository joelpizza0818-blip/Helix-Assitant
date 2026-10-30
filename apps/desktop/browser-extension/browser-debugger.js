;(() => {
  const KEY_DEFINITIONS = {
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    Delete: { code: 'Delete', keyCode: 46 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    Home: { code: 'Home', keyCode: 36 },
    End: { code: 'End', keyCode: 35 },
    PageUp: { code: 'PageUp', keyCode: 33 },
    PageDown: { code: 'PageDown', keyCode: 34 },
    Space: { code: 'Space', keyCode: 32, text: ' ' },
    ' ': { code: 'Space', keyCode: 32, text: ' ' },
    Control: { code: 'ControlLeft', keyCode: 17 },
    Alt: { code: 'AltLeft', keyCode: 18 },
    Shift: { code: 'ShiftLeft', keyCode: 16 },
    Meta: { code: 'MetaLeft', keyCode: 91 },
  }
  const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }
  const MOUSE_BUTTON_BITS = { left: 1, right: 2, middle: 4 }
  const MODIFIER_ALIASES = {
    ctrl: 'Control',
    control: 'Control',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    meta: 'Meta',
    cmd: 'Meta',
    command: 'Meta',
    super: 'Meta',
  }

  function getKeyDefinition(key) {
    if (KEY_DEFINITIONS[key]) return { key, ...KEY_DEFINITIONS[key] }
    if (/^[a-z]$/i.test(key)) {
      const upper = key.toUpperCase()
      return {
        key: key.toLowerCase(),
        code: `Key${upper}`,
        keyCode: upper.charCodeAt(0),
        text: key,
      }
    }
    if (/^[0-9]$/.test(key)) {
      return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key }
    }
    throw new Error(`Unsupported keyboard key: ${key}`)
  }

  function parseKeyCombination(input) {
    const parts = input.split('+').map((part) => part.trim()).filter(Boolean)
    if (parts.length === 0) throw new Error('A keyboard key is required.')
    const primary = parts.pop()
    const modifiers = []
    for (const part of parts) {
      const modifier = MODIFIER_ALIASES[part.toLowerCase()]
      if (!modifier || modifiers.includes(modifier)) {
        throw new Error(`Unsupported keyboard modifier: ${part}`)
      }
      modifiers.push(modifier)
    }
    const definition = getKeyDefinition(primary)
    const modifierMask = modifiers.reduce((mask, modifier) => mask | MODIFIER_BITS[modifier], 0)
    return { definition, modifiers, modifierMask }
  }

  async function sendKey(debuggerApi, target, type, definition, modifiers = 0) {
    const parameters = {
      type,
      key: definition.key,
      code: definition.code,
      windowsVirtualKeyCode: definition.keyCode,
      nativeVirtualKeyCode: definition.keyCode,
      modifiers,
    }
    if (type === 'char' && definition.text) {
      parameters.text = definition.text
      parameters.unmodifiedText = definition.text
    }
    await debuggerApi.sendCommand(target, 'Input.dispatchKeyEvent', parameters)
  }

  async function dispatchKey(debuggerApi, target, input) {
    const { definition, modifiers, modifierMask } = parseKeyCombination(input)
    const modifierDefinitions = modifiers.map((modifier) => ({
      key: modifier,
      ...KEY_DEFINITIONS[modifier],
    }))

    let activeModifiers = 0
    let primaryKeyDown = false
    const pressedModifiers = []
    let actionError = null
    const cleanupErrors = []
    try {
      for (const modifier of modifierDefinitions) {
        activeModifiers |= MODIFIER_BITS[modifier.key]
        await sendKey(debuggerApi, target, 'keyDown', modifier, activeModifiers)
        pressedModifiers.push(modifier)
      }
      await sendKey(debuggerApi, target, 'keyDown', definition, modifierMask)
      primaryKeyDown = true
      if (
        definition.text
        && modifierMask === 0
        && definition.text.length === 1
        && definition.text >= ' '
      ) {
        await sendKey(debuggerApi, target, 'char', definition, modifierMask)
      }
      await sendKey(debuggerApi, target, 'keyUp', definition, modifierMask)
      primaryKeyDown = false
    } catch (error) {
      actionError = error
    }

    if (primaryKeyDown) {
      try {
        await sendKey(debuggerApi, target, 'keyUp', definition, modifierMask)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    for (const modifier of pressedModifiers.reverse()) {
      activeModifiers &= ~MODIFIER_BITS[modifier.key]
      try {
        await sendKey(debuggerApi, target, 'keyUp', modifier, activeModifiers)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (actionError || cleanupErrors.length > 0) {
      const cause = actionError instanceof Error ? actionError.message : String(actionError || '')
      const cleanup = cleanupErrors.map((error) => (
        error instanceof Error ? error.message : String(error)
      )).join('; ')
      throw new Error(
        `Keyboard input may have partially completed${cause ? `: ${cause}` : ''}${cleanup ? `; HELIX could not fully release the keys: ${cleanup}` : ''}. Verify the page before retrying.`,
      )
    }
  }

  async function withAttachedTab(debuggerApi, tabId, action) {
    const target = { tabId }
    await debuggerApi.attach(target, '1.3')
    let actionError = null
    try {
      return await action(target)
    } catch (error) {
      actionError = error
      throw error
    } finally {
      try {
        await debuggerApi.detach(target)
      } catch (error) {
        if (!actionError) {
          throw new Error(
            `The browser action may have completed, but HELIX could not detach from the selected tab: ${error.message || error}. Verify the page before retrying.`,
          )
        }
      }
    }
  }

  async function pressAndReleaseMouse(debuggerApi, target, position, button, clickCount = 1) {
    let pressed = false
    let actionError = null
    try {
      await dispatchMouse(debuggerApi, target, 'mousePressed', position.x, position.y, {
        button,
        clickCount,
      })
      pressed = true
      await dispatchMouse(debuggerApi, target, 'mouseReleased', position.x, position.y, {
        button,
        clickCount,
      })
      pressed = false
    } catch (error) {
      actionError = error
    }

    if (pressed) {
      try {
        await dispatchMouse(debuggerApi, target, 'mouseReleased', position.x, position.y, {
          button,
          clickCount,
        })
      } catch (releaseError) {
        throw new Error(
          `Mouse input may have partially completed and Chrome could not release the button: ${releaseError.message || releaseError}. Verify the page before retrying.`,
        )
      }
    }
    if (actionError) {
      const reason = actionError instanceof Error ? actionError.message : String(actionError)
      throw new Error(`Mouse input may have partially completed: ${reason}. Verify the page before retrying.`)
    }
  }

  async function dispatchMouse(debuggerApi, target, type, x, y, options = {}) {
    await debuggerApi.sendCommand(target, 'Input.dispatchMouseEvent', {
      type,
      x,
      y,
      ...options,
    })
  }

  async function click(debuggerApi, target, x, y, button = 'left', clickCount = 1) {
    if (!['left', 'middle', 'right'].includes(button)) {
      throw new Error(`Unsupported mouse button: ${button}`)
    }
    await dispatchMouse(debuggerApi, target, 'mouseMoved', x, y)
    await pressAndReleaseMouse(debuggerApi, target, { x, y }, button, clickCount)
  }

  async function runAction(debuggerApi, tabId, action, input = {}) {
    return withAttachedTab(debuggerApi, tabId, async (target) => {
      if (action === 'click' || action === 'click_at') {
        await click(debuggerApi, target, input.x, input.y, input.button || 'left')
        return { clicked: true }
      }
      if (action === 'double_click' || action === 'double_click_at') {
        const button = input.button || 'left'
        try {
          await click(debuggerApi, target, input.x, input.y, button)
          await click(debuggerApi, target, input.x, input.y, button, 2)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`The double-click may have partially completed: ${reason}. Verify the page before retrying.`)
        }
        return { clicked: true }
      }
      if (action === 'move_mouse') {
        await dispatchMouse(debuggerApi, target, 'mouseMoved', input.x, input.y)
        return { moved: true }
      }
      if (action === 'drag') {
        await dispatchMouse(debuggerApi, target, 'mouseMoved', input.x, input.y)
        let pressed = false
        let actionError = null
        const button = input.button || 'left'
        if (!['left', 'middle', 'right'].includes(button)) {
          throw new Error(`Unsupported mouse button: ${button}`)
        }
        try {
          await dispatchMouse(debuggerApi, target, 'mousePressed', input.x, input.y, {
            button,
            clickCount: 1,
          })
          pressed = true
          const steps = 8
          for (let step = 1; step <= steps; step += 1) {
            const progress = step / steps
            await dispatchMouse(
              debuggerApi,
              target,
              'mouseMoved',
              input.x + (input.end_x - input.x) * progress,
              input.y + (input.end_y - input.y) * progress,
              { button, buttons: MOUSE_BUTTON_BITS[button] },
            )
          }
          await dispatchMouse(debuggerApi, target, 'mouseReleased', input.end_x, input.end_y, {
            button,
            clickCount: 1,
          })
          pressed = false
        } catch (error) {
          actionError = error
        }
        if (pressed) {
          try {
            await dispatchMouse(debuggerApi, target, 'mouseReleased', input.end_x, input.end_y, {
              button,
              clickCount: 1,
            })
          } catch (releaseError) {
            throw new Error(
              `The drag may have partially completed and Chrome could not release the mouse button: ${releaseError.message || releaseError}. Verify the page before retrying.`,
            )
          }
        }
        if (actionError) {
          const reason = actionError instanceof Error ? actionError.message : String(actionError)
          throw new Error(`The drag may have partially completed: ${reason}. Verify the page before retrying.`)
        }
        return { dragged: true }
      }
      if (action === 'scroll') {
        await dispatchMouse(debuggerApi, target, 'mouseWheel', input.x, input.y, {
          deltaX: input.deltaX || 0,
          deltaY: input.deltaY || 0,
        })
        return { scrolled: true }
      }
      if (action === 'type') {
        try {
          if (input.selectAllKey === 'Control' || input.selectAllKey === 'Meta') {
            await dispatchKey(debuggerApi, target, `${input.selectAllKey}+A`)
          }
          await debuggerApi.sendCommand(target, 'Input.insertText', { text: input.text })
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`Text input may have partially completed: ${reason}. Verify the field before retrying.`)
        }
        return { typed: true }
      }
      if (action === 'select') {
        await click(debuggerApi, target, input.x, input.y)
        await dispatchKey(debuggerApi, target, 'Home')
        for (let index = 0; index < input.optionIndex; index += 1) {
          await dispatchKey(debuggerApi, target, 'ArrowDown')
        }
        await dispatchKey(debuggerApi, target, 'Enter')
        return { selected: true }
      }
      if (action === 'press_key') {
        await dispatchKey(debuggerApi, target, input.key)
        return { pressed: true }
      }
      if (action === 'screenshot') {
        await debuggerApi.sendCommand(target, 'Page.enable')
        const result = await debuggerApi.sendCommand(target, 'Page.captureScreenshot', {
          format: 'jpeg',
          quality: 70,
          fromSurface: true,
          captureBeyondViewport: false,
        })
        if (typeof result?.data !== 'string') {
          throw new Error('Chrome did not return a browser screenshot.')
        }
        return { data_url: `data:image/jpeg;base64,${result.data}` }
      }
      throw new Error(`Unsupported browser debugger action: ${action}`)
    })
  }

  const browserDebugger = Object.freeze({ runAction })
  globalThis.helixBrowserDebugger = browserDebugger
  if (typeof module !== 'undefined') module.exports = browserDebugger
})()
