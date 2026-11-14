// What the menus may ask of the 3D game. The game fills these in when it starts;
// until then every call is a harmless no-op, so the menus can be built and tested alone.

const quiet = {
  init: async () => {},
  music() {},
  stinger() {},
  sfx() {},
  loop() {},
  setTimeScale() {},
  setVolumes() {},
  getVolumes: () => ({ master: 1, music: 1, sfx: 1 }),
  setMuted() {},
  isMuted: () => false,
  log: [],
}

export const bridge = {
  stage: {
    /** Puts beasts on the 3D stage behind the menus. */
    show(_builds, _opts) {},
    /** The DOM element whose rectangle the beasts should appear in. Null for the full screen. */
    frame(_el) {},
    clear() {},
  },
  /** Runs a fight and resolves when it is over: { won, match }. */
  async fight(_opts) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    return { won: false, match: null }
  },
  /** Opens "A week on Maul Street", the economy simulation. Returns a function that closes it. */
  week() {
    return () => {}
  },
  /** The graphics level: 'low' | 'medium' | 'high'. Setting it saves the choice on this device. */
  quality() {
    return 'medium'
  },
  setQuality(_name) {},
  audio: quiet,
}
