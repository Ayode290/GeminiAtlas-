/**
 * Specs Inc. 2026
 * cardDeckData.ts – the premade "cosmos" deck cards.
 *
 * Authored by hand (no JSON import — Lens Studio isolatedModules, same as
 * cityBounds.ts). The `text` and hashtags/topics/location/captureDate are all
 * REAL now; the matching card images are inspector-assigned Texture[] on
 * CardDeckController.placeholderImages (and PingCardSpawner.placeholderImages),
 * mapped BY ARRAY INDEX — so the entry order here must match the texture order.
 *
 *   - id          unique, stable; matches the image file name (e.g. "japan_01").
 *   - text        trivia paragraph + a trailing #hashtag line (shown on the card).
 *   - topics      a subset of DEFAULT_TOPICS (Assets/Scripts/Interests/InterestTopics.ts).
 *   - location    "Tokyo" (the 20 Japan cards) | "Seattle" (the 17 Seattle cards).
 *   - captureDate "YYYY-MM-DD", faked within the recent months.
 *
 * CARD_DECK_DATA are the 37 cards SPAWNED as the cosmos, grouped by location
 * (all Tokyo first, then all Seattle — keep it contiguous so PingCardSpawner's
 * per-location image indexing lines up with simple per-city texture lists).
 * SEED_CARDS are premade records registered in the store but NOT spawned (e.g.
 * the standalone PremadeCard already present in the scene), so it is in storage too.
 */

/** One premade deck card. */
export interface CardDeckEntry {
  id: string;
  text: string;
  hashtags: string[];   // without the leading '#'
  topics: string[];     // subset of DEFAULT_TOPICS
  location: string;     // "Tokyo" | "Seattle"
  captureDate: string;  // "YYYY-MM-DD"
}

export const CARD_DECK_DATA: CardDeckEntry[] = [
  // --- Tokyo (the 20 Japan cards) ------------------------------------------
  { id: "japan_01", text: "The green on the copper finials is verdigris, a self-sealing layer of copper carbonate that halts further corrosion — the same chemistry protecting the Statue of Liberty.\n\n#Chemistry #ShrineRoof #Verdigris #Copper", hashtags: ["Chemistry", "ShrineRoof", "Verdigris", "Copper"], topics: ["Chemistry"], location: "Tokyo", captureDate: "2026-03-02" },
  { id: "japan_02", text: "The flat-faced \"kawaii\" style on these toys descends from a measurable 20th-century trend: studies show character design drifted toward rounder, more infant-like proportions over decades.\n\n#ArtHistory #PlushToys #Kawaii", hashtags: ["ArtHistory", "PlushToys", "Kawaii"], topics: ["Art History"], location: "Tokyo", captureDate: "2026-03-04" },
  { id: "japan_03", text: "Kuniyoshi's skeleton is unusually anatomically correct for its era because he is thought to have studied imported Dutch anatomy books — Western medical science smuggled into a ghost story.\n\n#Biology #Ukiyoe #Kuniyoshi #Anatomy", hashtags: ["Biology", "Ukiyoe", "Kuniyoshi", "Anatomy"], topics: ["Biology"], location: "Tokyo", captureDate: "2026-03-06" },
  { id: "japan_04", text: "The raised wooden floor and deep eaves create a passive cooling loop: shade plus under-floor airflow exploit convection to beat summer humidity without machinery.\n\n#Physics #Engawa #PassiveCooling", hashtags: ["Physics", "Engawa", "PassiveCooling"], topics: ["Physics"], location: "Tokyo", captureDate: "2026-03-08" },
  { id: "japan_05", text: "Japan's river-control engineering (\"sabo\") became a national science after centuries of catastrophic floods, exported worldwide as a model for erosion and debris-flow control.\n\n#History #Sabo #FloodControl", hashtags: ["History", "Sabo", "FloodControl"], topics: ["History"], location: "Tokyo", captureDate: "2026-03-10" },
  { id: "japan_06", text: "Zen gardens are built for contemplation, and studies of \"soft fascination\" in such spaces inform how we'd design psychologically restorative habitats for long space missions.\n\n#Space #ZenGarden #SoftFascination", hashtags: ["Space", "ZenGarden", "SoftFascination"], topics: ["Space"], location: "Tokyo", captureDate: "2026-03-12" },
  { id: "japan_07", text: "Calligraphy in microgravity is a studied curiosity — without gravity pulling ink down the brush, the flow physics change, altering the very strokes a master makes.\n\n#Space #Calligraphy #Microgravity", hashtags: ["Space", "Calligraphy", "Microgravity"], topics: ["Space"], location: "Tokyo", captureDate: "2026-03-14" },
  { id: "japan_08", text: "Figure-skate glide works because pressure and friction melt a microscopic water film under the blade; for a century the textbook \"pressure-melting\" explanation was actually wrong — friction does most of it.\n\n#Chemistry #FigureSkating #Friction", hashtags: ["Chemistry", "FigureSkating", "Friction"], topics: ["Chemistry"], location: "Tokyo", captureDate: "2026-03-16" },
  { id: "japan_09", text: "Japan's \"gotochi\" (regional mascot) economy turned local wildlife like the shimaenaga into branded merch — a tourism strategy formalized only in the last few decades.\n\n#History #Shimaenaga #Gotochi", hashtags: ["History", "Shimaenaga", "Gotochi"], topics: ["History"], location: "Tokyo", captureDate: "2026-03-18" },
  { id: "japan_10", text: "The instant \"it has a face!\" reaction is pareidolia, driven by the fusiform face area — a brain region so eager to find faces it fires for two dots and a line.\n\n#Biology #Pareidolia #FacePerception", hashtags: ["Biology", "Pareidolia", "FacePerception"], topics: ["Biology"], location: "Tokyo", captureDate: "2026-03-20" },
  { id: "japan_11", text: "Ramen is genuinely spaceflight food: a Japanese maker engineered \"Space Ram,\" instant noodles with a thickened broth that won't float away, flown on the Space Shuttle.\n\n#Space #Ramen #Spaceflight", hashtags: ["Space", "Ramen", "Spaceflight"], topics: ["Space"], location: "Tokyo", captureDate: "2026-03-22" },
  { id: "japan_12", text: "Nearly every Tokyo station plays a unique 7-second departure jingle (\"ekimelo\"), composed so commuters subconsciously know their stop — a citywide ambient music system.\n\n#Music #TokyoRail #Ekimelo", hashtags: ["Music", "TokyoRail", "Ekimelo"], topics: ["Music"], location: "Tokyo", captureDate: "2026-03-24" },
  { id: "japan_13", text: "The rubber soles that feel the bumps rely on latex from the Hevea tree, whose elasticity makes the texture perceptible underfoot.\n\n#Botany #TactilePaving #Rubber", hashtags: ["Botany", "TactilePaving", "Rubber"], topics: ["Botany"], location: "Tokyo", captureDate: "2026-03-26" },
  { id: "japan_14", text: "Regional clay toys are classic \"omiyage,\" and Japan's gift-giving etiquette is so tied to travel that station shops stock local figurines specifically for returning commuters.\n\n#Trains #ClayToys #Omiyage", hashtags: ["Trains", "ClayToys", "Omiyage"], topics: ["Trains"], location: "Tokyo", captureDate: "2026-03-28" },
  { id: "japan_15", text: "Orange tabbies are statistically more likely to be male (~80%), and 2024 genetics finally pinned the orange color to a specific X-linked gene found nowhere else in mammals.\n\n#Biology #GingerCat #Genetics", hashtags: ["Biology", "GingerCat", "Genetics"], topics: ["Biology"], location: "Tokyo", captureDate: "2026-03-30" },
  { id: "japan_16", text: "Yarn-bombing (covering public objects in crochet) has decorated train stations and poles worldwide as guerrilla textile art softening hard transit spaces.\n\n#Trains #YarnBombing #Crochet", hashtags: ["Trains", "YarnBombing", "Crochet"], topics: ["Trains"], location: "Tokyo", captureDate: "2026-04-01" },
  { id: "japan_17", text: "Shrines now offer app-based and AR omikuji, and some dispense them by vending machine or robot — automating a thousand-year-old ritual.\n\n#XR #Omikuji #Shrine", hashtags: ["XR", "Omikuji", "Shrine"], topics: ["XR"], location: "Tokyo", captureDate: "2026-04-03" },
  { id: "japan_18", text: "Capped at 660cc, kei cars chase efficiency through low mass and small frontal area — at city speeds, shedding weight beats horsepower for fuel economy.\n\n#Physics #KeiCar #FuelEfficiency", hashtags: ["Physics", "KeiCar", "FuelEfficiency"], topics: ["Physics"], location: "Tokyo", captureDate: "2026-04-05" },
  { id: "japan_19", text: "Beverage logistics on planes and in vending machines share a problem: pressure and temperature change taste, which is why airlines and canned-coffee makers both over-sweeten.\n\n#Aviation #VendingMachine #Taste", hashtags: ["Aviation", "VendingMachine", "Taste"], topics: ["Aviation"], location: "Tokyo", captureDate: "2026-04-07" },
  { id: "japan_20", text: "Airlines copied ekiben as the \"sky bento,\" but cabin pressure dulls taste by roughly 30%, so the same recipe must be re-seasoned for altitude.\n\n#Aviation #Ekiben #SkyBento", hashtags: ["Aviation", "Ekiben", "SkyBento"], topics: ["Aviation"], location: "Tokyo", captureDate: "2026-04-09" },

  // --- Seattle (the 17 Seattle cards) --------------------------------------
  { id: "seattle_01", text: "The baked beans on a full English began as a luxury import: Heinz first sold them at London's upscale Fortnum & Mason around 1901, and Britain now eats more canned baked beans per person than any other country.\n\n#Food #FullEnglishBreakfast #BakedBeans", hashtags: ["Food", "FullEnglishBreakfast", "BakedBeans"], topics: ["Food"], location: "Seattle", captureDate: "2026-04-12" },
  { id: "seattle_02", text: "The bike-and-walking path running past Gas Works Park is a converted railroad — the Burke-Gilman Trail follows the roadbed of the 1880s Seattle, Lake Shore & Eastern Railway, paved over after its tracks were abandoned.\n\n#Trains #GasWorksPark #BurkeGilmanTrail #RailTrail", hashtags: ["Trains", "GasWorksPark", "BurkeGilmanTrail", "RailTrail"], topics: ["Trains"], location: "Seattle", captureDate: "2026-04-15" },
  { id: "seattle_03", text: "A corgi's short legs come from a genetic quirk — an extra inserted copy of the FGF4 gene triggers the same dwarfism (chondrodysplasia) seen in dachshunds and basset hounds.\n\n#Biology #Corgi #Genetics #Dwarfism", hashtags: ["Biology", "Corgi", "Genetics", "Dwarfism"], topics: ["Biology"], location: "Seattle", captureDate: "2026-04-18" },
  { id: "seattle_04", text: "Dale Chihuly co-founded the Pilchuck Glass School north of Seattle in 1971; after a 1976 car crash cost him an eye and his depth perception, he stopped blowing glass himself and began directing teams.\n\n#ArtHistory #Chihuly #GlassArt #Pilchuck", hashtags: ["ArtHistory", "Chihuly", "GlassArt", "Pilchuck"], topics: ["Art History"], location: "Seattle", captureDate: "2026-04-21" },
  { id: "seattle_05", text: "The trendy fiddle-leaf fig is a strangler in the wild: it sprouts high in another tree, drops roots down to the ground, and slowly envelops and kills the host that supported it.\n\n#Botany #FiddleLeafFig #StranglerFig", hashtags: ["Botany", "FiddleLeafFig", "StranglerFig"], topics: ["Botany"], location: "Seattle", captureDate: "2026-04-24" },
  { id: "seattle_06", text: "Because water bends light, a fish looking straight up sees the entire world above the surface squeezed into a bright circle about 97 degrees wide — everything outside that \"Snell's window\" is mirrored tank.\n\n#Physics #Aquarium #SnellsWindow #Refraction", hashtags: ["Physics", "Aquarium", "SnellsWindow", "Refraction"], topics: ["Physics"], location: "Seattle", captureDate: "2026-04-27" },
  { id: "seattle_07", text: "Wild gourds were so bitter that only Ice Age giants like mastodons could stomach and spread their seeds; when that megafauna went extinct the plants nearly vanished, until humans domesticated them into squash and pumpkins.\n\n#History #Gourds #Megafauna #Domestication", hashtags: ["History", "Gourds", "Megafauna", "Domestication"], topics: ["History"], location: "Seattle", captureDate: "2026-04-30" },
  { id: "seattle_08", text: "The sun you watch setting over the Sound is essentially a mirage: atmospheric refraction bends its light so much that the whole disc still appears above the horizon for about two minutes after it has geometrically already set.\n\n#Space #Sunset #Refraction #PugetSound", hashtags: ["Space", "Sunset", "Refraction", "PugetSound"], topics: ["Space"], location: "Seattle", captureDate: "2026-05-03" },
  { id: "seattle_09", text: "Lichens are among the toughest life known: samples bolted to the outside of the ISS survived roughly 18 months of raw vacuum, cosmic radiation, and extreme temperatures, then resumed living once returned to Earth.\n\n#Space #Lichen #Astrobiology", hashtags: ["Space", "Lichen", "Astrobiology"], topics: ["Space"], location: "Seattle", captureDate: "2026-05-06" },
  { id: "seattle_10", text: "Traditional mochi pounding (\"mochitsuki\") is a two-person rhythm act: one swings the heavy mallet while the other flips the sticky rice between blows, keeping a chanted beat so the pounder never crushes the turner's hand.\n\n#Music #Mochitsuki #Rhythm #Mochi", hashtags: ["Music", "Mochitsuki", "Rhythm", "Mochi"], topics: ["Music"], location: "Seattle", captureDate: "2026-05-09" },
  { id: "seattle_11", text: "The black stone ring in Volunteer Park is Isamu Noguchi's \"Black Sun\" (1969), and by Seattle legend the view of the skyline through its hole helped inspire the title of Soundgarden's 1994 hit \"Black Hole Sun.\"\n\n#Music #Soundgarden #BlackSun #Noguchi", hashtags: ["Music", "Soundgarden", "BlackSun", "Noguchi"], topics: ["Music"], location: "Seattle", captureDate: "2026-05-12" },
  { id: "seattle_12", text: "The phrase \"flying saucer\" was born at this mountain: in June 1947, pilot Kenneth Arnold reported nine objects racing past Mount Rainier and moving \"like a saucer skipping on water,\" and the press coined the term.\n\n#Aviation #MountRainier #FlyingSaucer #KennethArnold", hashtags: ["Aviation", "MountRainier", "FlyingSaucer", "KennethArnold"], topics: ["Aviation"], location: "Seattle", captureDate: "2026-05-15" },
  { id: "seattle_13", text: "Old gas-lantern mantles glowed so brightly because they were soaked in thorium dioxide — which is mildly radioactive, so vintage camping mantles like these can still set off a Geiger counter decades later.\n\n#Chemistry #GasMantle #Thorium #Radioactivity", hashtags: ["Chemistry", "GasMantle", "Thorium", "Radioactivity"], topics: ["Chemistry"], location: "Seattle", captureDate: "2026-05-18" },
  { id: "seattle_14", text: "Building a figure from a single bent wire is called \"drawing in space,\" pioneered by Alexander Calder in the 1920s; the line must read as a creature from the front while secretly serving as its own load-bearing skeleton.\n\n#Design #WireSculpture #Calder #DrawingInSpace", hashtags: ["Design", "WireSculpture", "Calder", "DrawingInSpace"], topics: ["Design"], location: "Seattle", captureDate: "2026-05-21" },
  { id: "seattle_15", text: "Little Free Libraries began in 2009 when Todd Bol built a tiny schoolhouse-shaped book box in Wisconsin to honor his late mother, a teacher; there are now over 150,000 registered around the world.\n\n#History #LittleFreeLibrary #ToddBol", hashtags: ["History", "LittleFreeLibrary", "ToddBol"], topics: ["History"], location: "Seattle", captureDate: "2026-05-24" },
  { id: "seattle_16", text: "Most ornamental cherry trees are a single clone, \"Somei-yoshino,\" propagated only by grafting — so the trees blossoming across a whole city are genetically identical and bloom in near-perfect unison.\n\n#Botany #CherryBlossom #SomeiYoshino #Clones", hashtags: ["Botany", "CherryBlossom", "SomeiYoshino", "Clones"], topics: ["Botany"], location: "Seattle", captureDate: "2026-05-27" },
  { id: "seattle_17", text: "Smart plush toys increasingly ship with companion apps that recognize the toy through a phone camera and animate its character in augmented reality — a \"phygital\" bridge linking a physical doll to an extended-reality world.\n\n#XR #RobotPlush #Phygital #AugmentedReality", hashtags: ["XR", "RobotPlush", "Phygital", "AugmentedReality"], topics: ["XR"], location: "Seattle", captureDate: "2026-05-30" },
];

/**
 * Premade records registered in the store but NOT spawned as cosmos cards.
 * Empty now: the old `premade_seed` placeholder was a stray Seattle record that
 * inflated query counts (showed up as an 18th, unshowable Seattle card). The 37
 * real cards in CARD_DECK_DATA are the whole deck.
 */
export const SEED_CARDS: CardDeckEntry[] = [];
