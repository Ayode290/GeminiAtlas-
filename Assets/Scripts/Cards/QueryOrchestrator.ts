/**
 * Specs Inc. 2026
 * QueryOrchestrator — the deterministic half of the card-query experience.
 *
 * The CardQueryVoiceAgent owns the Gemini Live session and the conversation; this
 * class owns everything that must be exact and side-effecting: filtering the
 * CardStore by the keywords the model extracted, driving the cosmos UI
 * (CardDeckController) and the globe (GlobeController), and returning a structured
 * result the model narrates from. It deliberately has NO Gemini imports so the
 * agent file stays about the session and this stays trivially testable.
 *
 * The globe is driven through a tiny intent state machine (reconcileGlobe), called
 * once per frame by the agent, because selectCity()/back() only run from
 * OVERVIEW/DOCKED respectively and the transitions are async — a query that
 * arrives mid-zoom must be serialized, not dropped.
 */
import { CardDeckController } from "./CardDeckController";
import { GlobeController } from "../Globe/GlobeController";
import { DEFAULT_TOPICS } from "../Interests/InterestTopics";

/** A Gemini function call, typed loosely so we don't import the Gemini SDK here. */
export interface ToolCall {
  name: string;
  id: string;
  args?: { [key: string]: any };
}

/** The keyword filters the model extracts from the user's request. */
export interface QueryArgs {
  location?: string;
  topic?: string;
  time_from?: string; // "YYYY-MM-DD"
  time_to?: string;   // "YYYY-MM-DD"
  content?: string;
}

/** What we hand back to the model so it can narrate the outcome. */
export interface QueryResult {
  found: number;            // total store matches
  shown: number;            // how many of those are visible in the cosmos row
  unshown: number;          // matches that aren't cosmos cards (captured/seed)
  ids: string[];            // all matching store ids
  locations: string[];      // distinct match locations
  summaries: string[];      // short caption snippets, one per match (capped)
  zoomedTo: string | null;  // the city the globe is heading to, or null
  multipleLocations: boolean;
}

/** Minimal shape of the CardStore we rely on (it lives on global.cropCardStore). */
interface CardLike {
  id: string;
  text: string;
  hashtags: string[];
  topics: string[];
  location: string;
  captureDate: string;
}
interface StoreLike {
  getCards(): CardLike[];
}

type GlobeIntent =
  | { kind: "none" }
  | { kind: "want_city"; name: string }
  | { kind: "want_overview" };

/** Tool declarations advertised to Gemini in the session Setup message. */
export const QUERY_TOOL_DECLARATIONS = [
  {
    name: "query_cards",
    description:
      "Find trivia cards matching the user's request. Supply only the keywords you are confident " +
      "about; all parameters are optional. Returns how many matched, which are shown in the floating " +
      "deck, and where they were captured.",
    parameters: {
      type: "OBJECT",
      properties: {
        location: {
          type: "STRING",
          description: "City the cards were captured in.",
          enum: ["Tokyo", "Seattle", "Los Angeles"],
        },
        topic: {
          type: "STRING",
          description: "Topic of interest the card relates to.",
          enum: DEFAULT_TOPICS,
        },
        time_from: { type: "STRING", description: "Earliest capture date, format YYYY-MM-DD." },
        time_to: { type: "STRING", description: "Latest capture date, format YYYY-MM-DD." },
        content: {
          type: "STRING",
          description: "A free-text keyword to match against the card caption or its hashtags.",
        },
      },
      required: [],
    },
  },
  {
    name: "clear_query",
    description:
      "Clear the current results: return the pulled-out cards to the floating deck and zoom the globe " +
      "back out to its overview. Call this when the user wants to start a new search or undo the current one.",
    parameters: { type: "OBJECT", properties: {}, required: [] },
  },
];

const MAX_SUMMARIES = 8;

export class QueryOrchestrator {
  private globeIntent: GlobeIntent = { kind: "none" };

  constructor(
    private deck: CardDeckController,
    private globe: GlobeController,
    private store: StoreLike
  ) {}

  /** Dispatches a Gemini tool call and returns the function response payload. */
  run(call: ToolCall): { name: string; response: { [key: string]: any } } {
    if (call.name === "query_cards") {
      return { name: call.name, response: this.queryCards((call.args ?? {}) as QueryArgs) as any };
    }
    if (call.name === "clear_query") {
      return { name: call.name, response: this.clearQuery() as any };
    }
    return { name: call.name, response: { error: "unknown tool: " + call.name } };
  }

  private queryCards(args: QueryArgs): QueryResult {
    // 1. Signal "searching" immediately so the cosmos spins up the moment the
    //    model commits to a query, before we've computed anything.
    if (this.deck) this.deck.setSearchActive(true);

    // 2. Filter the full store by whatever keywords were supplied.
    const cards = this.store ? this.store.getCards() : [];
    const loc = norm(args.location);
    const topic = norm(args.topic);
    const content = norm(args.content);
    const from = args.time_from && args.time_from.length > 0 ? args.time_from : null;
    const to = args.time_to && args.time_to.length > 0 ? args.time_to : null;

    const matches = cards.filter((c) => {
      if (loc && norm(c.location) !== loc) return false;
      if (topic && !c.topics.some((t) => norm(t) === topic)) return false;
      if (from && c.captureDate < from) return false;
      if (to && c.captureDate > to) return false;
      if (content && !this.contentMatches(c, content)) return false;
      return true;
    });

    const ids = matches.map((c) => c.id);
    const locations = distinct(matches.map((c) => c.location));

    // 3. No matches: leave the searching spin ON and let the model ask a
    //    follow-up / drop a keyword and call query_cards again.
    if (matches.length === 0) {
      return {
        found: 0, shown: 0, unshown: 0, ids: [], locations: [],
        summaries: [], zoomedTo: null, multipleLocations: false,
      };
    }

    // 4. Pull the matching cards out of the cosmos into the front row. Some
    //    matches (captured/seed cards) aren't cosmos cards and can't be shown.
    const shown = this.deck ? this.deck.showQueryResults(ids) : 0;

    // 5. Decide the globe target: only zoom when every shown card shares one
    //    mappable city; otherwise stay in overview and let the model say so.
    let zoomedTo: string | null = null;
    const multipleLocations = locations.length > 1;
    if (!multipleLocations && locations.length === 1 && this.globe && this.globe.hasCity(locations[0])) {
      zoomedTo = locations[0];
      this.globeIntent = { kind: "want_city", name: locations[0] };
    } else {
      // Different places (or an unmapped one): make sure we're at the overview.
      this.globeIntent = { kind: "want_overview" };
    }

    return {
      found: matches.length,
      shown,
      unshown: matches.length - shown,
      ids,
      locations,
      summaries: matches.slice(0, MAX_SUMMARIES).map((c) => snippet(c.text)),
      zoomedTo,
      multipleLocations,
    };
  }

  private clearQuery(): { ok: true } {
    if (this.deck) {
      this.deck.clearQueryResults();
      this.deck.setSearchActive(false);
    }
    this.globeIntent = { kind: "want_overview" };
    return { ok: true };
  }

  /**
   * Drives the globe toward the pending intent, respecting its async state guards.
   * Called every frame by the agent. selectCity/back silently no-op outside
   * OVERVIEW/DOCKED, so we only issue them in the right state and otherwise wait.
   */
  reconcileGlobe(): void {
    if (!this.globe) return;
    const intent = this.globeIntent;
    if (intent.kind === "none") return;
    if (this.globe.isAnimating()) return; // a transition is in flight — wait it out

    if (intent.kind === "want_city") {
      if (this.globe.isDocked()) {
        // Docked on a previous city: back out first, then aim for the new one.
        this.globe.resetToGlobe();
        return;
      }
      if (this.globe.isOverview()) {
        this.globe.focusCityByName(intent.name);
        this.globeIntent = { kind: "none" };
      }
    } else if (intent.kind === "want_overview") {
      if (this.globe.isDocked()) {
        this.globe.resetToGlobe();
        return;
      }
      if (this.globe.isOverview()) this.globeIntent = { kind: "none" };
    }
  }

  // Substring match over the caption text and the joined hashtags.
  private contentMatches(c: CardLike, needle: string): boolean {
    if (norm(c.text).indexOf(needle) >= 0) return true;
    return norm((c.hashtags ?? []).join(" ")).indexOf(needle) >= 0;
  }
}

function norm(s: string | undefined | null): string {
  return (s ?? "").trim().toLowerCase();
}

function distinct(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (out.indexOf(v) < 0) out.push(v);
  return out;
}

function snippet(text: string): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > 80 ? t.slice(0, 77) + "..." : t;
}
