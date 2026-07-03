/**
 * Extracts up to 3 image prompts from HTML post content.
 *
 * Strategy:
 *  1. Find all H2 sections in the content.
 *  2. For each section, grab the heading text + first ~200 chars of plain text.
 *  3. Build a rich, structured creative brief prompt for Flux/Pollinations.
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
    const body = truncate(stripTags(match[2]), 200);
    sections.push({ heading, body, index: sections.length });
  }

  // Fall back to H3 if not enough H2s
  if (sections.length < 3) {
    const h3Pattern = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|<h2|$)/gi;
    while ((match = h3Pattern.exec(content)) !== null && sections.length < 3) {
      const heading = stripTags(match[1]);
      const body = truncate(stripTags(match[2]), 200);
      sections.push({ heading, body, index: sections.length });
    }
  }

  // Fall back to first 3 paragraphs if still not enough
  if (sections.length < 3) {
    const pPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((match = pPattern.exec(content)) !== null && sections.length < 3) {
      const body = truncate(stripTags(match[1]), 200);
      if (body.length > 30) sections.push({ heading: postTitle, body, index: sections.length });
    }
  }

  // Build rich structured prompts from each section
  const prompts = sections.slice(0, 3).map(({ heading, body, index }) => {
    return buildImagePrompt({ heading, body, postTitle, sectionIndex: index });
  });

  // If we still have fewer than 3, fill with title-based prompts
  while (prompts.length < 3) {
    prompts.push(buildImagePrompt({ heading: postTitle, body: '', postTitle, sectionIndex: prompts.length }));
  }

  return prompts;
}

// ─── Visual Style Presets ─────────────────────────────────────────────────────

/**
 * Style presets — each defines a cohesive visual language.
 * Rotated by section index for variety while maintaining post-level coherence.
 */
const STYLE_PRESETS = [
  {
    label: 'Editorial Photography',
    medium: 'professional editorial photography',
    lighting: 'soft diffused natural light with subtle rim lighting',
    colorPalette: 'clean neutrals with one vibrant accent color, muted tones, high contrast',
    atmosphere: 'polished, trustworthy, and authoritative — evoking a premium magazine spread',
    technicalSpec: 'shot on Sony A7R V, 85mm f/1.4 lens, shallow depth of field, ultra-sharp foreground subject, 8K resolution',
    negative: 'no text overlays, no watermarks, no blurry backgrounds, no oversaturated colors',
  },
  {
    label: 'Cinematic Illustration',
    medium: 'cinematic digital illustration, concept art style',
    lighting: 'dramatic side lighting with deep shadows and bright highlights, volumetric light rays',
    colorPalette: 'rich jewel tones — deep teals, burnt oranges, and golden ambers with dark vignette edges',
    atmosphere: 'epic, immersive, and story-driven — evoking a high-budget film still or graphic novel panel',
    technicalSpec: 'wide-angle composition, rule of thirds, detailed background storytelling, 4K render, cinematic aspect ratio',
    negative: 'no cartoonish look, no flat colors, no amateur lighting',
  },
  {
    label: 'Modern Infographic Visual',
    medium: 'clean modern flat design with subtle 3D depth, data visualization aesthetic',
    lighting: 'bright studio lighting, minimal shadows, white or light grey background',
    colorPalette: 'professional palette of midnight blue, crisp white, and electric accent (teal or coral), high readability',
    atmosphere: 'clear, informative, and confidence-inspiring — evoking a premium SaaS dashboard or business report',
    technicalSpec: 'isometric or flat icon style, generous negative space, grid-based layout, 1080x1080 optimized',
    negative: 'no clutter, no busy patterns, no low-contrast text, no stock photo clichés',
  },
];

// ─── Topic-to-Visual Mapping ──────────────────────────────────────────────────

/**
 * Infer a visual subject and scene from section heading + body text.
 * Returns an object describing what should be in the foreground, midground, background.
 */
function inferVisualScene(heading, body, postTitle) {
  const combined = `${postTitle} ${heading} ${body}`.toLowerCase();

  // Technology / Software / AI
  if (/\b(ai|machine learning|code|software|app|tech|digital|cyber|data|algorithm|cloud|api)\b/.test(combined)) {
    return {
      subject: 'a sleek futuristic workspace with glowing holographic data visualizations and circuit board patterns',
      foreground: 'sharp focus on a modern laptop or device with vibrant UI glow',
      background: 'dark atmospheric tech environment with particle effects and blue-purple neon light trails',
      mood: 'innovative, cutting-edge, and intellectually stimulating',
    };
  }

  // Health / Wellness / Medical
  if (/\b(health|sức khỏe|wellness|medical|fitness|diet|nutrition|body|mind|yoga|mental)\b/.test(combined)) {
    return {
      subject: 'a vibrant wellness scene with natural elements — fresh herbs, clean water, and natural light',
      foreground: 'crisp close-up of fresh organic ingredients or a person in peaceful motion',
      background: 'soft bokeh of a lush green natural environment or a bright airy wellness studio',
      mood: 'calming, trustworthy, and life-affirming',
    };
  }

  // Finance / Business / Investment
  if (/\b(finance|tài chính|invest|kinh doanh|business|money|market|stock|economy|revenue|profit)\b/.test(combined)) {
    return {
      subject: 'a confident professional environment — premium office interior with financial data dashboards',
      foreground: 'sharp focus on ascending growth charts or a decisive handshake',
      background: 'modern glass office skyline at golden hour, suggesting ambition and success',
      mood: 'authoritative, aspirational, and growth-oriented',
    };
  }

  // Food / Beverage / Restaurant
  if (/\b(food|thức ăn|ăn|drink|coffee|cafe|restaurant|recipe|cuisine|dish|meal|beverage)\b/.test(combined)) {
    return {
      subject: 'a beautifully plated dish or premium beverage as the central hero, styled for maximum appetite appeal',
      foreground: 'tight overhead or 45-degree shot of the food with perfect garnish and steam detail',
      background: 'rustic wooden table with soft natural side light and subtle complementary props (herbs, linen)',
      mood: 'warm, indulgent, and deeply appetizing',
    };
  }

  // Travel / Lifestyle
  if (/\b(travel|du lịch|lifestyle|journey|adventure|destination|explore|nature|outdoor)\b/.test(combined)) {
    return {
      subject: 'a breathtaking travel scene — golden hour landscape or vibrant local culture moment',
      foreground: 'a lone traveler or iconic landmark creating a sense of scale and aspiration',
      background: 'sweeping panoramic vista with dynamic sky and rich environmental detail',
      mood: 'adventurous, freeing, and deeply inspiring',
    };
  }

  // Education / Learning
  if (/\b(learn|học|education|study|course|skill|knowledge|training|guide|tutorial)\b/.test(combined)) {
    return {
      subject: 'a focused and energizing learning environment — clean desk setup with open books and digital tools',
      foreground: 'sharp focus on hands engaged in active note-taking or a highlighted key concept',
      background: 'warm natural light library or modern co-working space with soft bokeh',
      mood: 'inspiring, focused, and achievement-oriented',
    };
  }

  // Marketing / SEO / Content
  if (/\b(seo|marketing|content|brand|social media|campaign|keyword|rank|traffic|conversion)\b/.test(combined)) {
    return {
      subject: 'a dynamic digital marketing workspace showing growth metrics, keyword strategies, and content creation',
      foreground: 'glowing analytics dashboard with upward trending graphs and keyword clusters',
      background: 'clean modern office with multiple screens displaying content calendars and campaign results',
      mood: 'data-driven, strategic, and results-focused',
    };
  }

  // Default: generic editorial
  return {
    subject: `a compelling visual representation of "${heading}" — conceptual and thought-provoking`,
    foreground: 'a crisp, well-lit primary subject that immediately communicates the core concept',
    background: 'a clean complementary environment with subtle contextual storytelling details',
    mood: 'professional, engaging, and informative',
  };
}

// ─── Core Prompt Builder ──────────────────────────────────────────────────────

/**
 * Builds a rich, structured creative brief prompt for Flux/Pollinations AI image generation.
 *
 * Follows the professional creative brief methodology:
 *   Role → Task → Visual Hierarchy → Background → Color Palette → Style → Atmosphere → Technical Specs → Negative Prompt
 *
 * @param {object} opts
 * @param {string} opts.heading       Section heading text
 * @param {string} opts.body          Section body text (first ~200 chars)
 * @param {string} opts.postTitle     Overall post title
 * @param {number} opts.sectionIndex  0-based section index (drives style rotation)
 * @returns {string}  Final prompt string
 */
function buildImagePrompt({ heading, body, postTitle, sectionIndex = 0 }) {
  const preset = STYLE_PRESETS[sectionIndex % STYLE_PRESETS.length];
  const scene = inferVisualScene(heading, body, postTitle);

  // Clean and truncate text for use in prompt
  const cleanHeading = heading.replace(/[<>]/g, '').trim().slice(0, 120);
  const cleanBody = body.replace(/[<>]/g, '').trim().slice(0, 150);
  const cleanTitle = postTitle.replace(/[<>]/g, '').trim().slice(0, 100);

  const contextLine = cleanBody.length > 20
    ? `The section covers: "${cleanHeading}" — ${cleanBody}`
    : `The topic is: "${cleanHeading}" from the article "${cleanTitle}"`;

  const prompt = [
    // Role
    `[Expert Creative Director & Visual Storyteller]`,

    // Task
    `Create a single, highly detailed, publication-quality image for a blog post section.`,
    contextLine,

    // Visual Hierarchy
    `SUBJECT: ${scene.subject}.`,
    `FOREGROUND: ${scene.foreground}.`,
    `BACKGROUND: ${scene.background}.`,

    // Style & Medium
    `STYLE: ${preset.medium}.`,
    `LIGHTING: ${preset.lighting}.`,

    // Color & Atmosphere
    `COLOR PALETTE: ${preset.colorPalette}.`,
    `ATMOSPHERE: ${scene.mood}. ${preset.atmosphere}.`,

    // Technical Specs
    `TECHNICAL: ${preset.technicalSpec}.`,

    // Negative Prompt
    `AVOID: ${preset.negative}, no AI-looking artifacts, no generic stock photo feel.`,
  ].join(' ');

  return prompt;
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
