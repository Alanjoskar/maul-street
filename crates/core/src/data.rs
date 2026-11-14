//! The cast: beasts, bazaar items and house fighters.
//!
//! Everything here is plain data. The numbers that change over time (prices,
//! payouts, bankrolls) are worked out in `rules.rs`.

/// The five aspects form a ring: each one beats the next.
/// Ember burns Thorn, Thorn splits Stone, Stone grounds Storm,
/// Storm shocks Tide, Tide douses Ember.
pub const ASPECT_EMBER: u8 = 0;
pub const ASPECT_THORN: u8 = 1;
pub const ASPECT_STONE: u8 = 2;
pub const ASPECT_STORM: u8 = 3;
pub const ASPECT_TIDE: u8 = 4;
pub const ASPECT_NAMES: [&str; 5] = ["Ember", "Thorn", "Stone", "Storm", "Tide"];

/// Body plans. The browser builds each beast's 3D body from its rig.
pub const RIG_QUADRUPED: u8 = 0;
pub const RIG_BIPED: u8 = 1;
pub const RIG_SERPENT: u8 = 2;
pub const RIG_WINGED: u8 = 3;

pub struct Species {
    pub id: u8,
    pub name: &'static str,
    pub aspect: u8,
    pub rig: u8,
    pub hp: u32,
    pub atk: u32,
    pub def: u32,
    pub spd: u32,
    /// Rare beasts are never in the free starting three. They are bought.
    pub rare: bool,
    /// The name of its Special.
    pub special: &'static str,
    /// Floor price of a new one, in thousandths of a NEAR.
    pub price_milli: u32,
    pub lore: &'static str,
    /// What this line is called in each of its five forms, from cub to mythic.
    /// `name` is the third: the grown beast.
    pub forms: [&'static str; 5],
}

pub const SPECIES: [Species; 10] = [
    Species {
        id: 0,
        name: "Cindermaw",
        aspect: ASPECT_EMBER,
        rig: RIG_QUADRUPED,
        hp: 410,
        atk: 78,
        def: 48,
        spd: 62,
        rare: false,
        special: "Magma Rend",
        price_milli: 300,
        lore: "A furnace on four legs. Its hide is cooled slag and its bite is not.",
        forms: ["Cinderpup", "Emberjaw", "Cindermaw", "Blazemaw", "Solarmaw"],
    },
    Species {
        id: 1,
        name: "Briarhorn",
        aspect: ASPECT_THORN,
        rig: RIG_QUADRUPED,
        hp: 460,
        atk: 70,
        def: 54,
        spd: 52,
        rare: false,
        special: "Strangleroot",
        price_milli: 300,
        lore: "Old forest given a temper. Every hit it lands feeds it.",
        forms: ["Sproutling", "Thicketbuck", "Briarhorn", "Elderhorn", "Worldroot"],
    },
    Species {
        id: 2,
        name: "Gravemaul",
        aspect: ASPECT_STONE,
        rig: RIG_BIPED,
        hp: 520,
        atk: 70,
        def: 66,
        spd: 34,
        rare: false,
        special: "Faultbreaker",
        price_milli: 300,
        lore: "It was a cliff once. Then something woke it, and it has been angry since.",
        forms: ["Pebblit", "Rockfist", "Gravemaul", "Cragmaul", "Titanmaul"],
    },
    Species {
        id: 3,
        name: "Skyrazor",
        aspect: ASPECT_STORM,
        rig: RIG_WINGED,
        hp: 370,
        atk: 78,
        def: 40,
        spd: 88,
        rare: false,
        special: "Thunderdive",
        price_milli: 300,
        lore: "You hear it after it has already hit you.",
        forms: ["Zapling", "Galewing", "Skyrazor", "Stormrazor", "Tempestlord"],
    },
    Species {
        id: 4,
        name: "Undertow",
        aspect: ASPECT_TIDE,
        rig: RIG_SERPENT,
        hp: 440,
        atk: 74,
        def: 48,
        spd: 66,
        rare: false,
        special: "Riptide Coil",
        price_milli: 300,
        lore: "Patient as deep water. It lets you tire before it tightens.",
        forms: ["Ripplet", "Brinecoil", "Undertow", "Maelstrom", "Abysscoil"],
    },
    Species {
        id: 5,
        name: "Ashwyrm",
        aspect: ASPECT_EMBER,
        rig: RIG_SERPENT,
        hp: 390,
        atk: 88,
        def: 42,
        spd: 72,
        rare: true,
        special: "Pyre Spiral",
        price_milli: 1200,
        lore: "It swims through fire the way an eel swims through a river.",
        forms: ["Sparkwyrm", "Flarewyrm", "Ashwyrm", "Pyrewyrm", "Sunwyrm"],
    },
    Species {
        id: 6,
        name: "Mirewing",
        aspect: ASPECT_THORN,
        rig: RIG_WINGED,
        hp: 380,
        atk: 80,
        def: 44,
        spd: 82,
        rare: true,
        special: "Spore Tempest",
        price_milli: 1200,
        lore: "Bog-born and beautiful, the way a poison flower is.",
        forms: ["Budwing", "Fenwing", "Mirewing", "Bloomwing", "Edenwing"],
    },
    Species {
        id: 7,
        name: "Shardfang",
        aspect: ASPECT_STONE,
        rig: RIG_QUADRUPED,
        hp: 440,
        atk: 82,
        def: 56,
        spd: 60,
        rare: true,
        special: "Glass Guillotine",
        price_milli: 1200,
        lore: "Volcanic glass grown into the shape of a hunter. Every edge is a blade.",
        forms: ["Chiplet", "Flintfang", "Shardfang", "Glassfang", "Prismfang"],
    },
    Species {
        id: 8,
        name: "Thunderhide",
        aspect: ASPECT_STORM,
        rig: RIG_BIPED,
        hp: 470,
        atk: 78,
        def: 54,
        spd: 52,
        rare: true,
        special: "Stormfall",
        price_milli: 1200,
        lore: "Lightning keeps striking it. It has stopped noticing.",
        forms: ["Staticub", "Voltfist", "Thunderhide", "Stormhide", "Skybreaker"],
    },
    Species {
        id: 9,
        name: "Tidereaver",
        aspect: ASPECT_TIDE,
        rig: RIG_QUADRUPED,
        hp: 430,
        atk: 78,
        def: 48,
        spd: 66,
        rare: true,
        special: "Drowning Maw",
        price_milli: 1200,
        lore: "It hunts the surf line, where prey has one foot in each world.",
        forms: ["Splashpup", "Reefhound", "Tidereaver", "Deepreaver", "Abyssreaver"],
    },
];

pub fn species(id: u8) -> Option<&'static Species> {
    SPECIES.get(id as usize)
}

// ----- Bazaar items -------------------------------------------------------

pub const KIND_RELIC: u8 = 0;
pub const KIND_AURA: u8 = 1;
pub const KIND_FINISHER: u8 = 2;

pub const RELIC_WILDFANG: u8 = 1;
pub const RELIC_IRONHIDE: u8 = 2;
pub const RELIC_QUICKENING: u8 = 3;
pub const RELIC_HEARTSTONE: u8 = 4;
pub const RELIC_RAGE_EMBER: u8 = 5;
pub const RELIC_LEECH_THORN: u8 = 6;

pub struct Item {
    pub id: u8,
    pub name: &'static str,
    pub kind: u8,
    /// Floor price, in thousandths of a NEAR.
    pub price_milli: u32,
    pub text: &'static str,
}

pub const ITEMS: [Item; 13] = [
    Item { id: RELIC_WILDFANG, name: "Wildfang", kind: KIND_RELIC, price_milli: 250, text: "+10% attack." },
    Item { id: RELIC_IRONHIDE, name: "Ironhide Plate", kind: KIND_RELIC, price_milli: 250, text: "+12% defence." },
    Item { id: RELIC_QUICKENING, name: "Quickening Feather", kind: KIND_RELIC, price_milli: 250, text: "+12% speed." },
    Item { id: RELIC_HEARTSTONE, name: "Heartstone", kind: KIND_RELIC, price_milli: 250, text: "+12% health." },
    Item { id: RELIC_RAGE_EMBER, name: "Rage Ember", kind: KIND_RELIC, price_milli: 400, text: "Rage fills 25% faster." },
    Item { id: RELIC_LEECH_THORN, name: "Leech Thorn", kind: KIND_RELIC, price_milli: 400, text: "Heals for 12% of the damage dealt." },
    Item { id: 20, name: "Ember Haze", kind: KIND_AURA, price_milli: 150, text: "A warm ember glow clings to the beast." },
    Item { id: 21, name: "Golden Halo", kind: KIND_AURA, price_milli: 200, text: "Slow motes of gold circle the beast." },
    Item { id: 22, name: "Void Wisps", kind: KIND_AURA, price_milli: 200, text: "Dark sparks drift up from its back." },
    Item { id: 23, name: "Storm Crown", kind: KIND_AURA, price_milli: 250, text: "Small lightning arcs around its head." },
    Item { id: 40, name: "Thunderclap", kind: KIND_FINISHER, price_milli: 300, text: "A thunderclap marks every knockout." },
    Item { id: 41, name: "Spirit Bell", kind: KIND_FINISHER, price_milli: 300, text: "Golden bells ring out for every knockout." },
    Item { id: 42, name: "Red Moon", kind: KIND_FINISHER, price_milli: 500, text: "The sky turns red when this beast wins a round." },
];

pub fn item(id: u8) -> Option<&'static Item> {
    ITEMS.iter().find(|i| i.id == id)
}

// ----- House fighters -----------------------------------------------------

pub const STYLE_BRAWLER: u8 = 0;
pub const STYLE_WALL: u8 = 1;
pub const STYLE_GAMBLER: u8 = 2;
pub const STYLE_READER: u8 = 3;
pub const STYLE_CLOSER: u8 = 4;

pub struct Den {
    pub id: u8,
    pub name: &'static str,
    pub title: &'static str,
    pub style: u8,
    /// 1 (gentle) to 5 (ruthless). Higher tiers pay more Essence.
    pub tier: u8,
    pub squad: [u8; 3],
    pub teaches: &'static str,
}

pub const DENS: [Den; 5] = [
    Den {
        id: 0,
        name: "Old Grist",
        title: "The Brawler",
        style: STYLE_BRAWLER,
        tier: 1,
        squad: [2, 0, 1],
        teaches: "Swings first and thinks later. Guard, and punish.",
    },
    Den {
        id: 1,
        name: "Mother Thorne",
        title: "The Wall",
        style: STYLE_WALL,
        tier: 2,
        squad: [1, 2, 4],
        teaches: "Braces and counters. Crush her guard with Break.",
    },
    Den {
        id: 2,
        name: "Coin-Eyed Vesh",
        title: "The Gambler",
        style: STYLE_GAMBLER,
        tier: 3,
        squad: [3, 5, 0],
        teaches: "Loves the heavy hit. A quick Strike stops it cold.",
    },
    Den {
        id: 3,
        name: "The Auditor",
        title: "The Reader",
        style: STYLE_READER,
        tier: 4,
        squad: [4, 7, 6],
        teaches: "Counts your habits and counters them. Mix it up.",
    },
    Den {
        id: 4,
        name: "Madam Ruin",
        title: "The Closer",
        style: STYLE_CLOSER,
        tier: 5,
        squad: [8, 9, 5],
        teaches: "Plays the odds every turn. Bring everything you know.",
    },
];

pub fn den(id: u8) -> Option<&'static Den> {
    DENS.get(id as usize)
}
