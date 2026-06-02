/**
 * Specs Inc. 2026
 * Chat GPT component for the Crop Spectacles lens.
 */
import { Logger } from "Utilities.lspkg/Scripts/Utils/Logger";
import {OpenAI} from "RemoteServiceGateway.lspkg/HostedExternal/OpenAI"

@component
export class ChatGPT extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">ChatGPT – sends captured image to OpenAI for identification</span><br/><span style="color: #94A3B8; font-size: 11px;">Encodes a texture as base64 and queries GPT-4o with vision capabilities to identify the cropped object.</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false;

  @input
  @hint("Enable lifecycle logging (onAwake, onStart, onUpdate, onDestroy)")
  enableLoggingLifecycle: boolean = false;

  private logger: Logger;

  private ImageQuality = CompressionQuality.HighQuality
  private ImageEncoding = EncodingType.Jpg

  onAwake() {
    this.logger = new Logger("ChatGPT", this.enableLogging || this.enableLoggingLifecycle, true);
    if (this.enableLoggingLifecycle) this.logger.debug("LIFECYCLE: onAwake()");
  }

  makeImageRequest(imageTex: Texture, callback) {
    this.logger.info("Making image request...")
    Base64.encodeTextureAsync(
      imageTex,
      (base64String) => {
        this.logger.info("Image encode Success!")
        const textQuery = this.buildPrompt()
        this.sendGPTChat(textQuery, base64String, callback)
      },
      () => {
        this.logger.error("Image encoding failed!")
      },
      this.ImageQuality,
      this.ImageEncoding
    )
  }

  async sendGPTChat(request: string, image64: string, callback: (response: string) => void) {
    OpenAI.chatCompletions({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {type: "text", text: request},
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,` + image64
              }
            }
          ]
        }
      ],
      max_tokens: 80
    })
      .then((response) => {
        if (response.choices && response.choices.length > 0) {
          const safeText = this.sanitize(response.choices[0].message.content)
          this.logger.info("Response from OpenAI: " + safeText)
          callback(safeText)
        }
      })
      .catch((error) => {
        this.logger.error("Error in OpenAI request: " + error)
      })
  }

  /**
   * Builds the prompt for the vision model, seeding it with the user's selected
   * interests (read from the session-scoped InterestStore on `global`) so the
   * model returns a factoid connected to those interests.
   */
  private buildPrompt(): string {
    const store = (global as any).cropInterestStore
    const interests: string[] =
      store && typeof store.getInterests === "function" ? store.getInterests() : []

    const interestLine =
      interests.length > 0
        ? `The user is interested in: ${interests.join(", ")}.`
        : `The user enjoys surprising, little-known facts.`
    const pickLine =
      interests.length > 0
        ? `Pick the ONE interest from that list that yields the most surprising connection.`
        : `Choose any angle that yields the most surprising connection.`

    return [
      `First, silently identify the main subject in the image.`,
      interestLine,
      pickLine,
      `Then write a single piece of unexpected, true, little-known trivia that connects the subject to that interest.`,
      ``,
      `Rules:`,
      `- Output ONLY the trivia text. No title, no preamble, no quotation marks, no emoji, no markdown.`,
      `- Around 30 words; never exceed 40 words. One or two sentences.`,
      `- Be specific and factually accurate. Do not invent facts; if unsure, choose a fact you are confident about.`,
      ``,
      `Example of the desired tone and format (do not reuse this content):`,
      `The Vatican used plaster fig leaves to cover the genitals of male statues during a 19th-century modesty campaign.`
    ].join("\n")
  }

  /**
   * Strips tag-like sequences and caps length before the text reaches the
   * caption renderer, which can crash on unclosed HTML-style tags.
   */
  private sanitize(text: string): string {
    return (text ?? "").replace(/<[^>]*>/g, "").slice(0, 400)
  }
}
