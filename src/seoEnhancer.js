/**
 * seoEnhancer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * SEO + AEO content enrichment engine.
 *
 * Responsibilities:
 *  - Inject focus keyword naturally into intro paragraph
 *  - Build auto Table of Contents with anchor IDs
 *  - Build FAQ section with JSON-LD schema (AEO / People Also Ask)
 *  - Build Article JSON-LD schema (E-E-A-T signals)
 *  - Humanize content: transition words, "you" perspective, varied rhythm
 *  - Validate meta description length
 *  - Estimate reading time
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const TRANSITION_WORDS = [
  'Thêm vào đó,', 'Bên cạnh đó,', 'Đặc biệt,', 'Quan trọng hơn,',
  'Thực tế là,', 'Cụ thể hơn,', 'Không chỉ vậy,', 'Điều thú vị là,',
  'Ngoài ra,', 'Hơn nữa,', 'Ví dụ,', 'Chính vì thế,',
  'Tóm lại,', 'Nhìn chung,', 'Đáng chú ý,',
];

const HUMAN_HOOKS = [
  'Bạn có bao giờ tự hỏi', 'Hãy cùng khám phá', 'Bạn sẽ bất ngờ khi biết',
  'Trước khi bắt đầu, hãy lưu ý', 'Đây là điều mà hầu hết mọi người bỏ qua',
  'Dưới đây là những gì bạn cần biết',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stripTags = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Slugify Vietnamese text for anchor IDs (simple, URL-safe).
 */
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

/**
 * Count approximate words in HTML string.
 */
function wordCount(html) {
  return stripTags(html).split(/\s+/).filter(Boolean).length;
}

/**
 * Estimate reading time in minutes (avg 200 words/min for Vietnamese).
 */
function estimateReadingTime(html) {
  const words = wordCount(html);
  return Math.max(1, Math.round(words / 200));
}

/**
 * Calculate keyword density as percentage.
 */
function keywordDensity(html, keyword) {
  if (!keyword) return 0;
  const text = stripTags(html).toLowerCase();
  const kw = keyword.toLowerCase();
  const words = text.split(/\s+/).length;
  const count = (text.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  return words > 0 ? parseFloat(((count / words) * 100).toFixed(2)) : 0;
}

// ─── Table of Contents ────────────────────────────────────────────────────────

/**
 * Adds anchor IDs to all H2/H3 headings and returns:
 *  - modifiedContent: HTML with id attributes added to headings
 *  - tocHtml: ready-to-insert TOC block HTML
 *  - headings: [{level, text, id}]
 */
function buildTableOfContents(content) {
  const headings = [];
  let index = 0;

  // Add id attributes to each H2/H3 and collect them
  const modifiedContent = content.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/h[23]>/gi, (match, tag, attrs, inner) => {
    const text = stripTags(inner).trim();
    const id = `${slugify(text)}-${index++}`;
    headings.push({ level: parseInt(tag[1]), text, id });
    // Only add id if not already present
    if (/\bid\s*=/.test(attrs)) return match;
    return `<${tag} id="${id}"${attrs}>${inner}</${tag}>`;
  });

  if (headings.length < 2) {
    return { modifiedContent: content, tocHtml: '', headings };
  }

  const items = headings.map(({ level, text, id }) => {
    const indent = level === 3 ? '  ' : '';
    return `${indent}<li><a href="#${id}">${text}</a></li>`;
  }).join('\n');

  const tocHtml = `
<div class="wp-block-group seo-toc" style="background:#f8f9fa;border-left:4px solid #0073aa;padding:16px 20px;margin:24px 0;border-radius:4px">
<p><strong>📋 Mục lục bài viết</strong></p>
<ol>
${items}
</ol>
</div>`;

  return { modifiedContent, tocHtml, headings };
}

// ─── FAQ Section ──────────────────────────────────────────────────────────────

/**
 * Build FAQ HTML block + embedded JSON-LD schema for AEO (People Also Ask).
 *
 * @param {Array<{question: string, answer: string}>} faqItems
 * @returns {string} HTML with embedded schema
 */
function buildFAQSection(faqItems) {
  if (!faqItems || faqItems.length === 0) return '';

  const faqSchemaItems = faqItems.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: stripTags(answer),
    },
  }));

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqSchemaItems,
  };

  const faqHtmlItems = faqItems.map(({ question, answer }) => `
<div class="wp-block-group seo-faq-item" style="border-bottom:1px solid #e0e0e0;padding:12px 0">
  <h3 style="font-size:1rem;margin-bottom:6px;color:#1a1a1a">${question}</h3>
  <div style="color:#444;line-height:1.7">${answer}</div>
</div>`).join('\n');

  return `
<div class="wp-block-group seo-faq" style="margin:32px 0">
<h2 id="cau-hoi-thuong-gap">❓ Câu hỏi thường gặp</h2>
${faqHtmlItems}
</div>
<script type="application/ld+json">
${JSON.stringify(schema, null, 2)}
</script>`;
}

// ─── Article JSON-LD Schema ───────────────────────────────────────────────────

/**
 * Build BlogPosting / Article JSON-LD schema for Google Rich Results (E-E-A-T).
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.metaDescription
 * @param {string} opts.postUrl
 * @param {string} opts.authorName
 * @param {string} opts.imageUrl
 * @param {string} opts.datePublished  ISO date string
 * @param {string} opts.siteUrl
 * @param {string} opts.siteName
 * @returns {string} <script> tag with JSON-LD
 */
function buildArticleSchema({ title, metaDescription, postUrl, authorName, imageUrl, datePublished, siteUrl, siteName }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: metaDescription || '',
    url: postUrl || '',
    datePublished: datePublished || new Date().toISOString(),
    dateModified: new Date().toISOString(),
    author: {
      '@type': 'Person',
      name: authorName || 'Editorial Team',
    },
    publisher: {
      '@type': 'Organization',
      name: siteName || '',
      logo: {
        '@type': 'ImageObject',
        url: siteUrl ? `${siteUrl}/wp-content/uploads/logo.png` : '',
      },
    },
    image: imageUrl ? {
      '@type': 'ImageObject',
      url: imageUrl,
    } : undefined,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': postUrl || '',
    },
  };

  // Remove undefined fields
  const clean = JSON.parse(JSON.stringify(schema));

  return `<script type="application/ld+json">\n${JSON.stringify(clean, null, 2)}\n</script>`;
}

// ─── Human-centric Content Signals ───────────────────────────────────────────

/**
 * Inject human-centric signals into content:
 *  - Add transition words before some paragraphs
 *  - Ensure "bạn" (you) appears in first H2 section
 *  - Add a hook question in intro if missing
 *  - Ensure keyword appears in first paragraph
 *
 * @param {string} content
 * @param {string} focusKeyword
 * @returns {string}
 */
function humanizeContent(content, focusKeyword) {
  let result = content;

  // 1. Ensure focus keyword appears in first <p> (gently inject if missing)
  if (focusKeyword) {
    const kw = focusKeyword.toLowerCase();
    const firstPMatch = result.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (firstPMatch && !firstPMatch[1].toLowerCase().includes(kw)) {
      const hook = HUMAN_HOOKS[Math.floor(Math.random() * HUMAN_HOOKS.length)];
      const injection = ` ${hook} về <strong>${focusKeyword}</strong>?`;
      result = result.replace(firstPMatch[0], firstPMatch[0].replace('</p>', `${injection}</p>`));
    }
  }

  // 2. Sprinkle transition words before some mid-content paragraphs (every 3rd-4th <p>)
  let pCount = 0;
  result = result.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, inner) => {
    pCount++;
    // Skip very short paragraphs, first and last paragraph
    if (pCount <= 2 || inner.length < 80) return match;
    if (pCount % 4 === 0) {
      const tw = TRANSITION_WORDS[pCount % TRANSITION_WORDS.length];
      // Only add if paragraph doesn't already start with a transition
      const textStart = stripTags(inner).trim().slice(0, 20).toLowerCase();
      const alreadyHas = TRANSITION_WORDS.some(t => textStart.startsWith(t.toLowerCase().replace(',', '')));
      if (!alreadyHas) {
        return `<p${attrs}>${tw} ${inner}</p>`;
      }
    }
    return match;
  });

  return result;
}

// ─── Meta Description Validator ───────────────────────────────────────────────

/**
 * Validate and trim meta description to ideal 150-160 char range.
 * @param {string} text
 * @returns {{ value: string, warning: string|null }}
 */
function validateMetaDescription(text) {
  if (!text) return { value: '', warning: 'Meta description is missing' };
  if (text.length < 120) return { value: text, warning: `Meta description too short (${text.length} chars, ideal: 150-160)` };
  if (text.length > 160) {
    const trimmed = text.slice(0, 157) + '...';
    return { value: trimmed, warning: `Meta description trimmed from ${text.length} to 160 chars` };
  }
  return { value: text, warning: null };
}

// ─── Reading Level Wrapper ────────────────────────────────────────────────────

/**
 * Add a reading time badge to the post intro area.
 * @param {string} content
 * @param {number} minutes
 * @returns {string}
 */
function addReadingTimeBadge(content, minutes) {
  const badge = `<p style="color:#666;font-size:0.875rem;margin-bottom:8px">⏱️ <em>Thời gian đọc: khoảng ${minutes} phút</em></p>`;
  // Insert after first <p> tag or at beginning
  const firstP = content.indexOf('<p');
  if (firstP === -1) return badge + content;
  return content.slice(0, firstP) + badge + content.slice(firstP);
}

// ─── Keyword Placement Audit ──────────────────────────────────────────────────

/**
 * Check that keyword appears in:
 *  - Title
 *  - First paragraph
 *  - At least one H2
 *  - Meta description
 * Returns a list of warnings.
 */
function auditKeywordPlacement(content, title, metaDescription, focusKeyword) {
  if (!focusKeyword) return [];
  const kw = focusKeyword.toLowerCase();
  const warnings = [];

  if (!title.toLowerCase().includes(kw)) {
    warnings.push(`Focus keyword "${focusKeyword}" not found in title`);
  }

  const firstPMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (firstPMatch && !firstPMatch[1].toLowerCase().includes(kw)) {
    warnings.push(`Focus keyword not found in first paragraph`);
  }

  const hasH2Keyword = /<h2[^>]*>([\s\S]*?)<\/h2>/gi.test(content) &&
    [...content.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].some(m => stripTags(m[1]).toLowerCase().includes(kw));
  if (!hasH2Keyword) {
    warnings.push(`Focus keyword not found in any H2 heading`);
  }

  if (metaDescription && !metaDescription.toLowerCase().includes(kw)) {
    warnings.push(`Focus keyword not found in meta description`);
  }

  return warnings;
}

// ─── Secondary Keywords ──────────────────────────────────────────────────────

/**
 * Bold secondary keywords (LSI terms) when they appear naturally in paragraph text.
 * Only bolds the first occurrence of each keyword to avoid over-tagging.
 * Skips content already inside HTML tags.
 *
 * @param {string} content
 * @param {string[]} keywords
 * @returns {string}
 */
function highlightSecondaryKeywords(content, keywords) {
  if (!keywords || keywords.length === 0) return content;

  let result = content;
  for (const kw of keywords) {
    if (!kw || kw.length < 3) continue;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match keyword only in text nodes (not inside tag attributes)
    // Strategy: replace first occurrence that is NOT inside an HTML tag
    const pattern = new RegExp(`(?<!<[^>]*)\\b(${escaped})\\b(?![^<]*>)`, 'i');
    result = result.replace(pattern, '<strong>$1</strong>');
  }
  return result;
}

// ─── Post URL Placeholder ─────────────────────────────────────────────────────

/** Sentinel used to mark where the real post URL should be injected after creation. */
const POST_URL_PLACEHOLDER = '__POST_URL_PLACEHOLDER__';

/**
 * Replace the URL placeholder in JSON-LD schema with the real post URL.
 * Called after the WordPress post is created and the URL is known.
 *
 * @param {string} content  Enriched HTML content
 * @param {string} postUrl  Real post URL from WordPress response
 * @returns {string}
 */
function injectPostUrl(content, postUrl) {
  if (!postUrl || !content.includes(POST_URL_PLACEHOLDER)) return content;
  return content.split(POST_URL_PLACEHOLDER).join(postUrl);
}

// ─── Main Enrichment Function ─────────────────────────────────────────────────

/**
 * Master function: takes raw post data, returns enriched version.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.content         Raw HTML content
 * @param {string} [opts.focusKeyword]
 * @param {string[]} [opts.secondaryKeywords]
 * @param {string} [opts.metaDescription]
 * @param {Array<{question:string,answer:string}>} [opts.faqItems]
 * @param {boolean} [opts.enableToc]    default true
 * @param {string} [opts.authorName]
 * @param {string} [opts.imageUrl]
 * @param {string} [opts.siteUrl]
 * @param {string} [opts.siteName]
 *
 * @returns {{
 *   content: string,
 *   metaDescription: string,
 *   readingTime: number,
 *   keywordDensityPct: number,
 *   seoWarnings: string[],
 *   seoScore: number
 * }}
 */
function enrichPost(opts) {
  const {
    title = '',
    content: rawContent = '',
    focusKeyword = '',
    secondaryKeywords = [],
    metaDescription: rawMeta = '',
    faqItems = [],
    enableToc = true,
    authorName = '',
    imageUrl = '',
    siteUrl = '',
    siteName = '',
  } = opts;

  let content = rawContent;
  const seoWarnings = [];

  // 1. Humanize content
  content = humanizeContent(content, focusKeyword);

  // 2. Bold secondary/LSI keywords (first occurrence of each)
  if (secondaryKeywords.length > 0) {
    content = highlightSecondaryKeywords(content, secondaryKeywords);
  }

  // 3. Table of Contents
  let tocHtml = '';
  if (enableToc) {
    const tocResult = buildTableOfContents(content);
    content = tocResult.modifiedContent;
    tocHtml = tocResult.tocHtml;
  }

  // 4. Insert TOC after first closing </p> tag
  if (tocHtml) {
    const insertPos = content.indexOf('</p>');
    if (insertPos !== -1) {
      content = content.slice(0, insertPos + 4) + '\n' + tocHtml + content.slice(insertPos + 4);
    } else {
      content = tocHtml + '\n' + content;
    }
  }

  // 5. Add reading time badge
  const readingTime = estimateReadingTime(content);
  content = addReadingTimeBadge(content, readingTime);

  // 6. Append FAQ section
  if (faqItems.length > 0) {
    content += '\n' + buildFAQSection(faqItems);
  }

  // 7. Append Article JSON-LD schema at end.
  //    Use POST_URL_PLACEHOLDER — will be replaced with real URL after WP post creation.
  const articleSchema = buildArticleSchema({
    title,
    metaDescription: rawMeta,
    postUrl: POST_URL_PLACEHOLDER,
    authorName,
    imageUrl,
    siteUrl,
    siteName,
    datePublished: new Date().toISOString(),
  });
  content += '\n' + articleSchema;

  // 7. Validate meta description
  const { value: metaDescription, warning: metaWarning } = validateMetaDescription(rawMeta);
  if (metaWarning) seoWarnings.push(metaWarning);

  // 8. Audit keyword placement
  const kwWarnings = auditKeywordPlacement(content, title, metaDescription, focusKeyword);
  seoWarnings.push(...kwWarnings);

  // 9. Keyword density
  const kwDensity = keywordDensity(content, focusKeyword);
  if (focusKeyword) {
    if (kwDensity < 0.5) seoWarnings.push(`Keyword density too low: ${kwDensity}% (ideal: 0.5–2.5%)`);
    if (kwDensity > 3) seoWarnings.push(`Keyword density too high: ${kwDensity}% (risk of over-optimization)`);
  }

  // 10. Calculate simple SEO score (0-100)
  let seoScore = 100;
  seoScore -= seoWarnings.length * 10;
  if (!focusKeyword) seoScore -= 20;
  if (!faqItems.length) seoScore -= 10;
  if (!enableToc) seoScore -= 5;
  seoScore = Math.max(0, Math.min(100, seoScore));

  return {
    content,
    metaDescription,
    readingTime,
    keywordDensityPct: kwDensity,
    seoWarnings,
    seoScore,
  };
}

module.exports = {
  enrichPost,
  injectPostUrl,
  buildTableOfContents,
  buildFAQSection,
  buildArticleSchema,
  humanizeContent,
  highlightSecondaryKeywords,
  validateMetaDescription,
  estimateReadingTime,
  keywordDensity,
  auditKeywordPlacement,
};
