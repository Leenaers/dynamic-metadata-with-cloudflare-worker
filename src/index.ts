var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// config.js
var config = {
  domainSource: "https://ddc4400c-55fe-493b-a7ac-281776399414.weweb-preview.io",
  // Your WeWeb app preview link
  patterns: [
    {
      pattern: "/locatie/[^/]+",
      metaDataEndpoint: "https://api.kiddie.nl/api:nof6BxVO/facility/seo/{id}/"
    },
    {
      pattern: "/regio/[^/]+",
      metaDataEndpoint: "https://api.kiddie.nl/api:nof6BxVO/region/seo/{id}/"
    },
    {
      pattern: "/blog/[^/]+",
      metaDataEndpoint: "https://api.kiddie.nl/api:nof6BxVO/blog/seo/{id}/"
    }
    // Add more patterns and their metadata endpoints as needed
  ]
};

// src/index.ts
var PrerenderMonitoring = class {
  constructor(env) {
    this.startTime = Date.now();
    this.events = [];
    this.env = env;
  }
  logEvent(type, data) {
    this.events.push({
      timestamp: Date.now(),
      type,
      duration: Date.now() - this.startTime,
      ...data
    });
  }
  async send() {
    try {
      const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const logKey = `logs/${date}.json`;
      let existingLogs = [];
      try {
        const existing = await this.env.R2.get(logKey);
        if (existing) {
          existingLogs = JSON.parse(await existing.text());
        }
      } catch (error) {
        console.error("Error reading existing logs:", error);
      }
      const updatedLogs = [...existingLogs, ...this.events];
      await this.env.R2.put(logKey, JSON.stringify(updatedLogs), {
        httpMetadata: {
          contentType: "application/json"
        }
      });
      const summary = {
        total_events: updatedLogs.length,
        successful_renders: updatedLogs.filter((e) => e.type === "success").length,
        failed_renders: updatedLogs.filter((e) => e.type === "error").length,
        skipped_renders: updatedLogs.filter((e) => e.type === "skip").length,
        last_updated: (/* @__PURE__ */ new Date()).toISOString()
      };
      await this.env.R2.put("logs/summary.json", JSON.stringify(summary), {
        httpMetadata: {
          contentType: "application/json"
        }
      });
    } catch (error) {
      console.error("Logging error:", error);
    }
  }
};
__name(PrerenderMonitoring, "PrerenderMonitoring");
var BOT_AGENTS = [
  "googlebot",
  "yahoo! slurp",
  "bingbot",
  "yandex",
  "baiduspider",
  "facebookexternalhit",
  "twitterbot",
  "rogerbot",
  "linkedinbot",
  "embedly",
  "quora link preview",
  "showyoubot",
  "outbrain",
  "pinterest/0.",
  "developers.google.com/+/web/snippet",
  "slackbot",
  "vkshare",
  "w3c_validator",
  "redditbot",
  "applebot",
  "whatsapp",
  "flipboard",
  "tumblr",
  "bitlybot",
  "skypeuripreview",
  "nuzzel",
  "discordbot",
  "google page speed",
  "qwantify",
  "pinterestbot",
  "bitrix link preview",
  "xing-contenttabreceiver",
  "chrome-lighthouse",
  "telegrambot",
  "integration-test", // Integration testing
  "google-inspectiontool"
];
var src_default = {
  async fetch(request, env, ctx) {
    const monitoring = new PrerenderMonitoring(env);
    const domainSource = config.domainSource;
    const patterns = config.patterns;
    console.log("Worker started");
    const url = new URL(request.url);
    const referer = request.headers.get("Referer");
    const userAgent = request.headers.get("User-Agent")?.toLowerCase() || "";
    console.log("User Agent:", userAgent);

    // Check if the request is from a bot
    const isBot = BOT_AGENTS.some((bot) => userAgent.includes(bot));
    console.log("Is Bot:", isBot);

    // If it's a bot and not a static asset, handle the request
    if (isBot && !url.pathname.match(/\.(js|css|xml|json|png|jpg|gif|pdf)$/i)) {
      try {
        // Log the bot detection event
        monitoring.logEvent("bot_detected", { url: url.href, userAgent });

        // Check for cached content
        const urlHash = btoa(url.href);
        const stored = await env.R2.get(urlHash);
        if (stored) {
          monitoring.logEvent("cache_hit", { url: url.href });
          return new Response(await stored.text(), {
            headers: { "Content-Type": "text/html" }
          });
        }

        // If not cached, queue for prerendering
        monitoring.logEvent("cache_miss", { url: url.href });
        await env.PRERENDER_QUEUE.send({
          url: url.href,
          timestamp: Date.now()
        });
        console.log("URL queued for prerendering:", url.href);
      } catch (error) {
        console.error("Error handling bot request:", error);
        monitoring.logEvent("error", { url: url.href, error: error.message });
      } finally {
        await monitoring.send();
      }
    } else {
      // Handle non-bot requests or static assets
      console.log("Fetching original content for:", url.pathname);
      const sourceUrl = new URL(`${domainSource}${url.pathname}`);
      const sourceRequest = new Request(sourceUrl, request);
      const sourceResponse = await fetch(sourceRequest);
      const modifiedHeaders = new Headers(sourceResponse.headers);
      modifiedHeaders.delete("X-Robots-Tag");
      return new Response(sourceResponse.body, {
        status: sourceResponse.status,
        headers: modifiedHeaders
      });
    }
  }
};
var CustomHeaderHandler = class {
  constructor(metadata) {
    this.metadata = metadata;
  }
  element(element) {
    if (element.tagName == "title") {
      console.log("Replacing title tag content");
      element.setInnerContent(this.metadata.title);
    }
    if (element.tagName == "meta") {
      const name = element.getAttribute("name");
      switch (name) {
        case "title":
          element.setAttribute("content", this.metadata.title);
          break;
        case "description":
          element.setAttribute("content", this.metadata.description);
          break;
        case "image":
          element.setAttribute("content", this.metadata.image);
          break;
        case "keywords":
          element.setAttribute("content", this.metadata.keywords);
          break;
        case "twitter:title":
          element.setAttribute("content", this.metadata.title);
          break;
        case "twitter:description":
          element.setAttribute("content", this.metadata.description);
          break;
      }
      const itemprop = element.getAttribute("itemprop");
      switch (itemprop) {
        case "name":
          element.setAttribute("content", this.metadata.title);
          break;
        case "description":
          element.setAttribute("content", this.metadata.description);
          break;
        case "image":
          element.setAttribute("content", this.metadata.image);
          break;
      }
      const type = element.getAttribute("property");
      switch (type) {
        case "og:title":
          console.log("Replacing og:title");
          element.setAttribute("content", this.metadata.title);
          break;
        case "og:description":
          console.log("Replacing og:description");
          element.setAttribute("content", this.metadata.description);
          break;
        case "og:image":
          console.log("Replacing og:image");
          element.setAttribute("content", this.metadata.image);
          break;
      }
      const robots = element.getAttribute("name");
      if (robots === "robots") {
        console.log("Updating robots meta tag to index, follow");
        element.setAttribute("content", "index, follow");
      }
    }
  }
};
__name(CustomHeaderHandler, "CustomHeaderHandler");
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
