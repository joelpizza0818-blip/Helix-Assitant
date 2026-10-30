;(() => {
  function createPageContextQueue() {
    let tail = Promise.resolve()
    return {
      enqueue(operation) {
        const result = tail.then(operation, operation)
        tail = result.then(() => undefined, () => undefined)
        return result
      },
    }
  }

  const pageContextQueue = Object.freeze({ createPageContextQueue })
  globalThis.helixPageContextQueue = pageContextQueue
  if (typeof module !== 'undefined') module.exports = pageContextQueue
})()
