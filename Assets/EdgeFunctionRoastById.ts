import {SnapCloudRequirements} from "./Examples/SnapCloudRequirements"

@component
export class EdgeFunctionRoastById extends BaseScriptComponent {
  private internetModule: InternetModule = require("LensStudio:InternetModule")

  @input
  @hint("Reference to SnapCloudRequirements for centralized Supabase configuration")
  public snapCloudRequirements: SnapCloudRequirements

  @input
  @hint("Edge Function name (set this to: get-roast-by-id)")
  public functionName: string = "[your-function-name]"

  @input
  @hint("Enable debug logging")
  public enableDebugLogs: boolean = true

  // Callback wired by MultiplayerTriviaManager to display roast on screen
  public onRoastReceived: ((roastText: string) => void) | null = null

  // Tracks the current question id set by the trivia manager
  public id: number = 1

  onAwake() {
    this.log("EdgeFunctionRoastById initializing...")
    this.initializeService()
  }

  private initializeService() {
    if (!this.snapCloudRequirements || !this.snapCloudRequirements.isConfigured()) {
      this.log("SnapCloudRequirements not configured")
      return
    }
    if (!this.functionName || this.functionName === "[your-function-name]") {
      this.log("Function name not configured")
      return
    }
    this.log(`Initialized — endpoint: ${this.snapCloudRequirements.getFunctionsApiUrl()}${this.functionName}`)
  }

  // Cache of fetched roast text, keyed `${id}:${label}`. Lets a wrong answer
  // speak instantly from a prefetch instead of waiting on a network round-trip.
  // (Supabase stays the source of truth, so roasts remain live-editable.)
  private cache: { [key: string]: string } = {}

  private cacheKey(idValue: number, roastLabel: string): string {
    return `${idValue}:${roastLabel}`
  }

  /** Cached roast text for an id+label, or null if it hasn't been fetched yet. */
  public getCachedRoast(idValue: number, roastLabel: string): string | null {
    const v = this.cache[this.cacheKey(idValue, roastLabel)]
    return typeof v === "string" && v.length > 0 ? v : null
  }

  /**
   * Fetch BOTH roasts for a question ahead of time and cache them. Call this when
   * the question LOADS (off the critical path) so the host can react with zero
   * network latency the instant someone answers wrong.
   */
  public prefetchForId(idValue: number) {
    this.requestRoast("roast1", idValue, null)
    this.requestRoast("roast2", idValue, null)
  }

  // Performs the HTTP fetch for one label, caches the result, and — if `deliver`
  // is provided — hands the text back. A null `deliver` is a silent prefetch.
  private requestRoast(
    roastLabel: string,
    idValue: number,
    deliver: ((text: string) => void) | null
  ) {
    try {
      if (!this.snapCloudRequirements || !this.snapCloudRequirements.isConfigured()) {
        this.log("SnapCloudRequirements not configured")
        return
      }
      if (!this.functionName || this.functionName === "[your-function-name]") {
        this.log("Function name not configured")
        return
      }

      const endpointUrl =
        `${this.snapCloudRequirements.getFunctionsApiUrl()}${this.functionName}?id=${idValue}`

      this.log(`Calling ${roastLabel} for id:${idValue}`)

      const request = RemoteServiceHttpRequest.create()
      request.url = endpointUrl
      request.headers = this.snapCloudRequirements.getSupabaseHeaders()
      request.method = RemoteServiceHttpRequest.HttpRequestMethod.Post
      request.body = JSON.stringify({ id: idValue })

      this.internetModule.performHttpRequest(request, (response) => {
        this.log(`${roastLabel} → status ${response.statusCode}`)

        if (!response.body) {
          this.log(`${roastLabel} → empty body`)
          return
        }

        let parsed: any = null
        try { parsed = JSON.parse(response.body) } catch (e) {
          this.log(`${roastLabel} → not JSON`)
          return
        }

        if (parsed?.error) {
          this.log(`${roastLabel} → error: ${parsed.error}`)
          return
        }

        const data = parsed?.data
        if (!data) {
          this.log(`${roastLabel} → missing "data"`)
          return
        }

        const textValue = data?.[roastLabel]
        if (typeof textValue === "string" && textValue.length > 0) {
          this.log(`${roastLabel} → ${textValue}`)
          this.cache[this.cacheKey(idValue, roastLabel)] = textValue
          if (deliver) deliver(textValue)
        } else {
          this.log(`${roastLabel} → field not found. Keys: ${Object.keys(data).join(", ")}`)
        }
      })
    } catch (error) {
      this.log(`Error (${roastLabel}): ${error}`)
    }
  }

  // Reactive fetches (used as a fallback if the prefetch hasn't landed). They
  // cache too, and deliver via the onRoastReceived callback as before.
  public fetchRoast1() {
    this.requestRoast("roast1", this.id, (t) => { if (this.onRoastReceived) this.onRoastReceived(t) })
  }

  public fetchRoast2() {
    this.requestRoast("roast2", this.id, (t) => { if (this.onRoastReceived) this.onRoastReceived(t) })
  }

  public callFunctionWithId(idValue: number) {
    this.id = idValue
  }

  private log(message: string) {
    if (this.enableDebugLogs) print(`[EdgeFunctionRoastById] ${message}`)
  }
}