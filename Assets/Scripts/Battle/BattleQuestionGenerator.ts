/**
 * Specs Inc. 2026
 * BattleQuestionGenerator for the Crop Spectacles lens (battle mode).
 *
 * Turns a batch of cards (captured or premade) into fun multiple-choice trivia
 * questions tied to each card's fact text, plus a short playful roast to show
 * when a player answers wrong. One OpenAI call per batch returns a JSON array;
 * the MultiplayerTriviaManager assembles these into the per-round question queue.
 *
 * Isolation: the manager references this via @input('Component.ScriptComponent')
 * and calls it through an `any` accessor (like roastFetcherComponent /
 * battleHostComponent) so the OpenAI import stays out of the manager.
 *
 * Modeled on ChatGPT.ts (OpenAI.chatCompletions, .then/.catch, sanitize).
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import { OpenAI } from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI";

/** Minimal card shape the manager passes in (from CardStore.getCards()). */
export interface CardSeed {
  text: string;
  topics: string[];
  location: string;
}

/** A generated question (id is assigned later by the manager at assembly time). */
export interface GeneratedQuestion {
  question: string;
  option1: string;
  option2: string;
  option3: string;
  option4: string;
  optionCount: number;
  answer: number; // 1-indexed correct option
  roast: string;  // short playful line shown on a wrong answer
  praise: string; // short witty line shown on a correct answer
}

@component
export class BattleQuestionGenerator extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">BattleQuestionGenerator – cards → fun trivia via OpenAI</span><br/><span style="color: #94A3B8; font-size: 11px;">Returns a JSON array of multiple-choice questions (with inline roasts) tied to each card. Needs the OpenAI RSG token configured (as for ChatGPT).</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false;

  // Cards per OpenAI call. Smaller batches keep each JSON response easy to parse.
  private readonly batchSize = 8;

  private logger: Logger;

  onAwake() {
    this.logger = new Logger("BattleQuestionGenerator", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()");
  }

  /**
   * Generates one question per card. Splits large sets into batches and fires the
   * callback ONCE with the combined results (order roughly follows the input).
   * On any failure the affected batch contributes nothing; an all-empty result
   * just calls back with [] so the caller can fall back.
   */
  generate(cards: CardSeed[], callback: (records: GeneratedQuestion[]) => void): void {
    const usable = (cards ?? []).filter((c) => c && (c.text ?? "").trim().length > 0);
    if (usable.length === 0) {
      callback([]);
      return;
    }

    const batches: CardSeed[][] = [];
    for (let i = 0; i < usable.length; i += this.batchSize) {
      batches.push(usable.slice(i, i + this.batchSize));
    }

    const results: GeneratedQuestion[] = [];
    let remaining = batches.length;

    const onBatchDone = (batchResults: GeneratedQuestion[]) => {
      for (const r of batchResults) results.push(r);
      remaining -= 1;
      if (remaining === 0) {
        this.logger.info("Generated " + results.length + " question(s) from " + usable.length + " card(s)");
        callback(results);
      }
    };

    for (const batch of batches) this.generateBatch(batch, onBatchDone);
  }

  // --- internal --------------------------------------------------------------

  private generateBatch(cards: CardSeed[], done: (records: GeneratedQuestion[]) => void): void {
    const prompt = this.buildPrompt(cards);

    OpenAI.chatCompletions({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
      ],
      max_tokens: 1400,
      // A little heat for playful, varied wording; the prompt enforces accuracy.
      temperature: 0.9,
      top_p: 0.95,
    })
      .then((response) => {
        if (response.choices && response.choices.length > 0) {
          const raw = response.choices[0].message.content ?? "";
          const parsed = this.parseQuestions(raw, cards.length);
          done(parsed);
        } else {
          done([]);
        }
      })
      .catch((error) => {
        this.logger.error("OpenAI request failed: " + error);
        done([]);
      });
  }

  private buildPrompt(cards: CardSeed[]): string {
    const cardBlocks = cards.map((c, i) => {
      const topics = (c.topics ?? []).join(", ");
      const loc = (c.location ?? "").trim();
      const meta = [topics ? `topics: ${topics}` : "", loc ? `location: ${loc}` : ""]
        .filter((s) => s.length > 0)
        .join(" | ");
      return `Card ${i + 1}${meta ? ` (${meta})` : ""}:\n${(c.text ?? "").trim()}`;
    });

    return [
      `You write fun trivia questions for a fast-paced two-player AR battle game.`,
      `You are given ${cards.length} card(s), each holding a real, specific fact.`,
      `For EACH card, write ONE multiple-choice question, in the SAME order as the cards.`,
      ``,
      `Each question MUST:`,
      `- Be answerable directly from that card's fact — test the specific, surprising detail in it (a name, number, place, or cause), not generic background.`,
      `- Be fun and punchy: a playful, conversational tone, one sentence, no preamble like "Did you know".`,
      `- Have exactly 4 short answer options. Exactly ONE is correct; the other 3 are plausible but clearly wrong to someone who knows the fact.`,
      `- Place the correct option at a VARIED position across questions (don't always make it option 1). Set "answer" to the 1-based index (1-4) of the correct option.`,
      `- Be factually accurate. Never invent details beyond the card; if the card is thin, ask about the single concrete detail it does give.`,
      ``,
      `Also write a "roast": one short, witty line (UNDER 12 words) to tease a player who just got THIS question wrong, in the voice of a sassy quiz-show host.`,
      `- It MUST riff on the specific subject or the correct answer — a pun or playful jab tied to this fact, so it could only fit THIS question.`,
      `- Do NOT simply restate or reveal the correct answer, and do NOT be generic ("wrong again", "better luck next time").`,
      `- Keep it good-natured — tease the guess, never the person; no insults, no profanity.`,
      `- Example (for a fact about verdigris greening copper): "Green with envy at everyone who got that one?"`,
      ``,
      `Also write a "praise": one short, witty line (UNDER 12 words) to celebrate a player who gets THIS question RIGHT, in the same sassy quiz-host voice.`,
      `- It MUST riff on the specific subject or fact — a clever, playful nod that could only fit THIS question, not a generic "nice job" or "correct".`,
      `- Warm and impressed, with a wink; never sarcastic to the point of insult. Do NOT just repeat the answer.`,
      `- Example (for the verdigris fact): "Correct — you've got a real eye for green."`,
      ``,
      `Output ONLY a JSON array (no markdown, no code fences, no commentary). One object per card, in order:`,
      `[{"question":"...","options":["A","B","C","D"],"answer":1,"roast":"...","praise":"..."}]`,
      `"options" must have exactly 4 strings. "answer" must be an integer 1-4.`,
      ``,
      `The cards:`,
      ``,
      cardBlocks.join("\n\n"),
    ].join("\n");
  }

  /**
   * Parses the model's reply into GeneratedQuestion[]. Tolerates code fences and
   * leading/trailing prose by extracting the outermost JSON array. Drops any
   * malformed entry rather than failing the whole batch.
   */
  private parseQuestions(raw: string, expected: number): GeneratedQuestion[] {
    const jsonText = this.extractJsonArray(raw);
    if (!jsonText) {
      this.logger.error("No JSON array found in response");
      return [];
    }

    let arr: any;
    try {
      arr = JSON.parse(jsonText);
    } catch (e) {
      this.logger.error("JSON parse failed: " + e);
      return [];
    }
    if (!Array.isArray(arr)) return [];

    const out: GeneratedQuestion[] = [];
    for (const item of arr) {
      const q = this.coerceQuestion(item);
      if (q) out.push(q);
    }
    if (out.length < expected) {
      this.logger.info("Parsed " + out.length + "/" + expected + " question(s) for batch");
    }
    return out;
  }

  /** Returns the substring from the first '[' to the matching last ']'. */
  private extractJsonArray(raw: string): string | null {
    const text = raw ?? "";
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    return text.slice(start, end + 1);
  }

  /** Validates one parsed object and maps it to a GeneratedQuestion, or null. */
  private coerceQuestion(item: any): GeneratedQuestion | null {
    if (!item || typeof item !== "object") return null;
    const question = this.cleanText(item.question);
    const options = Array.isArray(item.options) ? item.options.map((o: any) => this.cleanText(o)) : [];
    if (question.length === 0) return null;
    if (options.length < 4) return null;
    if (options.slice(0, 4).some((o) => o.length === 0)) return null;

    let answer = Math.floor(Number(item.answer));
    if (!(answer >= 1 && answer <= 4)) answer = 1;

    return {
      question,
      option1: options[0],
      option2: options[1],
      option3: options[2],
      option4: options[3],
      optionCount: 4,
      answer,
      roast: this.cleanText(item.roast),
      praise: this.cleanText(item.praise),
    };
  }

  /** Strips HTML-ish tags (the caption renderer can crash on them) and trims. */
  private cleanText(value: any): string {
    return String(value ?? "").replace(/<[^>]*>/g, "").trim();
  }
}
