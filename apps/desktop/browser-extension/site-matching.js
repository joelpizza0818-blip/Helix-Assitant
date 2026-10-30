;(() => {
  function isWithinSite(input, siteKey) {
    let url
    let site
    try {
      url = new URL(input)
      site = new URL(siteKey)
    } catch {
      return false
    }

    return url.protocol === site.protocol
      && (
        url.hostname === site.hostname
        || url.hostname.endsWith(`.${site.hostname}`)
      )
  }

  function hasSameOrigin(left, right) {
    try {
      return new URL(left).origin === new URL(right).origin
    } catch {
      return false
    }
  }

  function findMatchingTab(tabs, targetUrl, siteKey) {
    if (!isWithinSite(targetUrl, siteKey)) return null
    const targetHostname = new URL(targetUrl).hostname

    return tabs
      .filter((tab) => typeof tab.url === 'string' && typeof tab.id === 'number')
      .filter((tab) => isWithinSite(tab.url, siteKey))
      .sort((left, right) => {
        const leftExactHost = new URL(left.url).hostname === targetHostname
        const rightExactHost = new URL(right.url).hostname === targetHostname
        return Number(rightExactHost) - Number(leftExactHost)
          || Number(right.active) - Number(left.active)
          || (right.lastAccessed || 0) - (left.lastAccessed || 0)
      })[0] ?? null
  }

  const siteMatching = Object.freeze({ findMatchingTab, hasSameOrigin })
  globalThis.helixSiteMatching = siteMatching
  if (typeof module !== 'undefined') module.exports = siteMatching
})()
