/**
 * Extracts up to 3 image prompts from HTML post content.
 *
 * Strategy:
 *  1. Find all H2 sections in the content.
 *  2. For each section, grab the heading text + first ~150 chars of plain text.
 *  3. Build a descriptive image prompt suitable for Pollinations/Flux.
 *
 * Falls back gracefully: if fewer than 3 H2s exist, uses H3s, then paragraphs.
 */
function extractImagePrompts(content, postTitle = '') {
  const stripTags = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const truncate = (str, len) => str.length > len ? str.slice(0, len).trimEnd() + '...' : str;

  const sections = [];

  // Match H2 blocks: capture heading text + everything until next H2 or end
  const h2Pattern = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|$)/gi;
  let match;
  while ((match = h2Pattern.exec(content)) !== null) {
    const heading = stripTags(match[1]);
    const body = truncate(stripTags(match[2]), 150);
    sections.push({ heading, body });
  }

  // Fall back to H3 if not enough H2s
  if (sections.length < 3) {
    const h3Pattern = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|<h2|$)/gi;
    while ((match = h3Pattern.exec(content)) !== null && sections.length < 3) {
      const heading = stripTags(match[1]);
      const body = truncate(stripTags(match[2]), 150);
      sections.push({ heading, body });
    }
  }

  // Fall back to first 3 paragraphs if still not enough
  if (sections.length < 3) {
    const pPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((match = pPattern.exec(content)) !== null && sections.length < 3) {
      const body = truncate(stripTags(match[1]), 200);
      if (body.length > 30) sections.push({ heading: postTitle, body });
    }
  }

  // Build Pollinations-friendly prompts from each section
  const prompts = sections.slice(0, 3).map(({ heading, body }) => {
    const context = body.length > 20 ? `${heading}: ${body}` : heading;
    return buildImagePrompt(context, postTitle);
  });

  // If we still have fewer than 3, fill with title-based prompt
  while (prompts.length < 3) {
    prompts.push(buildImagePrompt(postTitle, postTitle));
  }

  return prompts;
}

/**
 * Converts section text into a high-quality image generation prompt.
 * Adds photographic/illustration style suffix for better Flux output.
 */
function buildImagePrompt(sectionText, postTitle) {
  const styles = [
    'professional photography, high quality, 4k',
    'digital illustration, vibrant colors, high detail',
    'cinematic shot, dramatic lighting, high resolution',
  ];
  // Rotate style based on content hash for variety
  const styleIndex = Math.abs(sectionText.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % styles.length;
  const style = styles[styleIndex];

  const cleanText = sectionText.replace(/[^\w\s,.:'-]/g, '').trim().slice(0, 200);
  return `${cleanText}, ${style}`;
}

/**
 * Inserts generated image HTML into content after each H2 section.
 * Returns new content string with <figure> blocks embedded.
 *
 * @param {string} content  - Original HTML content
 * @param {{ url: string, mediaId: number }[]} images - Up to 3 images
 * @returns {string} - HTML with images inserted
 */
function insertImagesIntoContent(content, images) {
  let insertCount = 0;

  // Insert after each </h2> closing tag (up to 3 times)
  const result = content.replace(/<\/h2>/gi, (match) => {
    if (insertCount >= images.length) return match;
    const img = images[insertCount++];
    return `</h2>\n<figure class="wp-block-image size-large"><img src="${img.url}" alt="" class="wp-image-${img.mediaId}"/></figure>`;
  });

  // If no H2s were found, append images at the end
  if (insertCount === 0) {
    const figures = images.map(img =>
      `<figure class="wp-block-image size-large"><img src="${img.url}" alt="" class="wp-image-${img.mediaId}"/></figure>`
    ).join('\n');
    return result + '\n' + figures;
  }

  return result;
}

module.exports = { extractImagePrompts, insertImagesIntoContent };
