
// Monitoring class
class PrerenderMonitoring {
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
      const date = new Date().toISOString().split('T')[0];
      const logKey = logs/${date}.json;

      let existingLogs = [];
      try {
        const existing = await this.env.R2.get(logKey);
        if (existing) {
          existingLogs = JSON.parse(await existing.text());
        }
      } catch (error) {
        console.error('Error reading existing logs:', error);
      }

      const updatedLogs = [...existingLogs, ...this.events];

      await this.env.R2.put(logKey, JSON.stringify(updatedLogs), {
        httpMetadata: {
          contentType: 'application/json'
        }
      });

      const summary = {
        total_events: updatedLogs.length,
        successful_renders: updatedLogs.filter(e => e.type === 'success').length,
        failed_renders: updatedLogs.filter(e => e.type === 'error').length,
        skipped_renders: updatedLogs.filter(e => e.type === 'skip').length,
        last_updated: new Date().toISOString()
      };

      await this.env.R2.put('logs/summary.json', JSON.stringify(summary), {
        httpMetadata: {
          contentType: 'application/json'
        }
      });
    } catch (error) {
      console.error('Logging error:', error);
    }
  }
}

// Bot detection constants
const BOT_AGENTS = [
  'bot',
  'crawler',
  'spider',
  'googlebot',
  'chrome-lighthouse',
  'headlesschrome',
  'slurp',
  'bingbot',
  'whatsapp',
  'facebook',
  'twitter',
  'linkedin'
];

export default {
  async fetch(request, env, ctx) {
    const monitoring = new PrerenderMonitoring(env);

    // Extracting configuration values
    const domainSource = config.domainSource;
    const patterns = config.patterns;

    console.log("Worker started");

    // Parse the request URL
    const url = new URL(request.url);
    const referer = request.headers.get('Referer');

    // Bot detection
    const userAgent = request.headers.get('user-agent')?.toLowerCase() || '';
    const isBot = BOT_AGENTS.some(bot => userAgent.includes(bot));

        console.log('User Agent:', userAgent);
        console.log('Is Bot:', isBot);

    // Handle bot requests
    // Handle bot requests
if (isBot && !url.pathname.match(/\.(js|css|xml|json|png|jpg|gif|pdf)$/i)) {
    console.log('Bot detected, trying to serve prerendered content');
    try {
        const urlHash = btoa(url.href);
        console.log('Looking for content with hash:', urlHash);

        const stored = await env.R2.get(urlHash);

        if (stored) {
            const content = await stored.text();
            console.log('Found prerendered content:', {
                url: url.href,
                contentLength: content.length,
                firstChars: content.substring(0, 200), // Log first 200 chars
                hasHTML: content.includes('<!DOCTYPE html>'),
                hasBody: content.includes('<body'),
                timestamp: stored.httpMetadata.lastModified
            });

            monitoring.logEvent('cache_hit', { url: url.href });
            return new Response(content, {
                headers: { 
                    'Content-Type': 'text/html',
                    'X-Served-By': 'prerender-cache',  // Add this to identify prerendered responses
                    'X-Prerender-Info': 'cached'
                }
            });
        }

        console.log('No prerendered content found for hash:', urlHash);
        monitoring.logEvent('cache_miss', { url: url.href });

        // Queue for prerendering if not already queued
        try {
            await env.PRERENDER_QUEUE.send({
                url: url.href,
                timestamp: Date.now()
            });
            console.log('URL queued for prerendering:', url.href);
        } catch (error) {
            console.error('Failed to queue URL:', error);
        }
    } catch (error) {
        console.error('Error handling bot request:', error);
        monitoring.logEvent('error', { url: url.href, error: error.message });
    } finally {
        await monitoring.send();
    }
}

    // Function to check if the URL is one of the static pages we want to index
    function isStaticIndexPage(pathname) {
      const cleanPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

      if (cleanPath === '' || cleanPath === '/') {
        return true;
      }

      const indexPaths = [
        '/blogs',              
        '/regio-overzicht'     
      ];

      return indexPaths.includes(cleanPath);
    }

    // Function to get the pattern configuration that matches the URL
    function getPatternConfig(url) {
      for (const patternConfig of patterns) {
        const regex = new RegExp(patternConfig.pattern);
        let pathname = url + (url.endsWith('/') ? '' : '/');
        if (regex.test(pathname)) {
          return patternConfig;
        }
      }
      return null;
    }

    // Function to check if the URL matches the page data pattern
    function isPageData(url) {
      const pattern = /\/public\/data\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json/;
      return pattern.test(url);
    }

    async function requestMetadata(url, metaDataEndpoint) {
      const trimmedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
      const parts = trimmedUrl.split('/');
      const id = parts[parts.length - 1];
      const placeholderPattern = /{([^}]+)}/;
      const metaDataEndpointWithId = metaDataEndpoint.replace(placeholderPattern, id);
      const metaDataResponse = await fetch(metaDataEndpointWithId);
      const metadata = await metaDataResponse.json();
      return metadata;
    }

    // Handle static index pages
    if (isStaticIndexPage(url.pathname)) {
      console.log("Static index page detected:", url.pathname);

      let source = await fetch(${domainSource}${url.pathname});

      const sourceHeaders = new Headers(source.headers);
      sourceHeaders.delete('X-Robots-Tag');
      source = new Response(source.body, {
        status: source.status,
        headers: sourceHeaders
      });

      return new HTMLRewriter()
        .on('meta', {
          element(element) {
            const robots = element.getAttribute("name");
            if (robots === "robots") {
              console.log('Updating robots meta tag to index, follow for static page');
              element.setAttribute("content", "index, follow");
            }
          }
        })
        .transform(source);
    }

    // Handle dynamic page requests
    const patternConfig = getPatternConfig(url.pathname);
    if (patternConfig) {
      console.log("Dynamic page detected:", url.pathname);

      let source = await fetch(${domainSource}${url.pathname});

      const sourceHeaders = new Headers(source.headers);
      sourceHeaders.delete('X-Robots-Tag');
      source = new Response(source.body, {
        status: source.status,
        headers: sourceHeaders
      });

      const metadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint);
      console.log("Metadata fetched:", metadata);

      const customHeaderHandler = new CustomHeaderHandler(metadata);

      return new HTMLRewriter()
        .on('*', customHeaderHandler)
        .transform(source);

    // Handle page data requests for the WeWeb app
    } else if (isPageData(url.pathname)) {
      console.log("Page data detected:", url.pathname);
      console.log("Referer:", referer);

      const sourceResponse = await fetch(${domainSource}${url.pathname});
      let sourceData = await sourceResponse.json();

      let pathname = referer;
      pathname = pathname ? pathname + (pathname.endsWith('/') ? '' : '/') : null;
      if (pathname !== null) {
        const patternConfigForPageData = getPatternConfig(pathname);
        if (patternConfigForPageData) {
          const metadata = await requestMetadata(pathname, patternConfigForPageData.metaDataEndpoint);
          console.log("Metadata fetched:", metadata);

          sourceData.page = sourceData.page || {};
          sourceData.page.title = sourceData.page.title || {};
          sourceData.page.meta = sourceData.page.meta || {};
          sourceData.page.meta.desc = sourceData.page.meta.desc || {};
          sourceData.page.meta.keywords = sourceData.page.meta.keywords || {};
          sourceData.page.socialTitle = sourceData.page.socialTitle || {};
          sourceData.page.socialDesc = sourceData.page.socialDesc || {};

          if (metadata.title) {
            sourceData.page.title.en = metadata.title;
            sourceData.page.socialTitle.en = metadata.title;
          }
          if (metadata.description) {
            sourceData.page.meta.desc.en = metadata.description;
            sourceData.page.socialDesc.en = metadata.description;
          }
          if (metadata.image) {
            sourceData.page.metaImage = metadata.image;
          }
          if (metadata.keywords) {
            sourceData.page.meta.keywords.en = metadata.keywords;
          }

          console.log("returning file: ", JSON.stringify(sourceData));
          return new Response(JSON.stringify(sourceData), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // If the URL does not match any patterns, fetch and return the original content
    console.log("Fetching original content for:", url.pathname);
    const sourceUrl = new URL(${domainSource}${url.pathname});
    const sourceRequest = new Request(sourceUrl, request);
    const sourceResponse = await fetch(sourceRequest);

    const modifiedHeaders = new Headers(sourceResponse.headers);
    modifiedHeaders.delete('X-Robots-Tag');

    return new Response(sourceResponse.body, {
      status: sourceResponse.status,
      headers: modifiedHeaders,
    });
  }
};

// CustomHeaderHandler class
class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = metadata;
  }

  element(element) {
    if (element.tagName == "title") {
      console.log('Replacing title tag content');
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
          console.log('Replacing og:title');
          element.setAttribute("content", this.metadata.title);
          break;
        case "og:description":
          console.log('Replacing og:description');
          element.setAttribute("content", this.metadata.description);
          break;
        case "og:image":
          console.log('Replacing og:image');
          element.setAttribute("content", this.metadata.image);
          break;
      }

      const robots = element.getAttribute("name");
      if (robots === "robots") {
        console.log('Updating robots meta tag to index, follow');
        element.setAttribute("content", "index, follow");
      }
    }
  }
}
