export const config = {
  domainSource: "https://ddc4400c-55fe-493b-a7ac-281776399414.weweb-preview.io", // Your WeWeb app preview link
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
