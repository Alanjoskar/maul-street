// The one place that touches the browser's storage.
//
// In a page this is localStorage. A private window may refuse it, and Node has
// none, so everything falls back to memory and nothing here ever throws.
// Tests can hand in their own storage with useStorage().

function memory() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

let backend = null

function detect() {
  try {
    // Only look at `window.localStorage`: Node's own global of that name warns when touched.
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch {
    // Storage is blocked. Keep things in memory for this visit.
  }
  return memory()
}

function current() {
  if (!backend) backend = detect()
  return backend
}

/** Use another storage: anything with getItem, setItem and removeItem. No argument means memory. */
export function useStorage(custom) {
  backend = custom && typeof custom.getItem === 'function' ? custom : memory()
}

export const store = {
  get(key) {
    try {
      const value = current().getItem(key)
      return value === undefined ? null : value
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      current().setItem(key, String(value))
      return true
    } catch {
      return false
    }
  },
  remove(key) {
    try {
      current().removeItem(key)
    } catch {
      // Nothing was stored.
    }
  },
  getJson(key) {
    const raw = store.get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  },
  setJson(key, value) {
    return store.set(key, JSON.stringify(value))
  },
}
