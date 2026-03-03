const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function normalizeUrl(input) {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).toString();
  } catch {
    try {
      return new URL(`https://${raw}`).toString();
    } catch {
      return null;
    }
  }
}

function extractEmailsFromText(text) {
  const matches = text.match(EMAIL_REGEX) || [];
  return matches.map((email) => email.toLowerCase());
}

function getUnique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractContactLinks(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = [...doc.querySelectorAll('a[href]')];

  const links = anchors
    .map((anchor) => {
      try {
        return new URL(anchor.getAttribute('href'), baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((href) => href && href.toLowerCase().includes('contact'));

  return getUnique(links);
}

async function fetchPage(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    credentials: 'omit'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function processWebsite(url) {
  const html = await fetchPage(url);
  const mainEmails = extractEmailsFromText(html);
  const contactLinks = extractContactLinks(html, url);

  const contactEmailPromises = contactLinks.map(async (contactUrl) => {
    try {
      const contactHtml = await fetchPage(contactUrl);
      return extractEmailsFromText(contactHtml);
    } catch {
      return [];
    }
  });

  const contactEmailsNested = await Promise.all(contactEmailPromises);
  const allEmails = getUnique([...mainEmails, ...contactEmailsNested.flat()]);

  return {
    url,
    domain: new URL(url).hostname,
    emails: allEmails,
    contactLinks,
    totalEmails: allEmails.length
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'PROCESS_URLS') {
    return false;
  }

  const urls = getUnique((message.urls || []).map(normalizeUrl));

  (async () => {
    const results = [];

    for (const url of urls) {
      try {
        const result = await processWebsite(url);
        results.push(result);
      } catch (error) {
        results.push({
          url,
          domain: (() => {
            try {
              return new URL(url).hostname;
            } catch {
              return url;
            }
          })(),
          emails: [],
          contactLinks: [],
          totalEmails: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    sendResponse({ ok: true, results });
  })();

  return true;
});
