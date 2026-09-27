const express = require('express');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { createWordPressClient } = require('./src/wordpress');
const { generateImage } = require('./src/imageGen');
const { extractImagePrompts, insertImagesIntoContent } = require('./src/promptExtractor');
const { enrichPost, injectPostUrl, injectInternalLinks } = require('./src/seoEnhancer');

dotenv.config();

const PORT = process.env.PORT || 9809;
const WP_URL = process.env.WP_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
  console.error('ERROR: Missing required env vars. Set WP_URL, WP_USERNAME, and WP_APP_PASSWORD in .env');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY not set — generate_image tools will not work');
}
if (!process.env.SITE_NAME) {
  console.warn('WARNING: SITE_NAME not set — Article schema publisher name will be blank. Set SITE_NAME in .env');
}
if (!MCP_BEARER_TOKEN) {
  console.error('ERROR: MCP_BEARER_TOKEN not set. Generate one with `openssl rand -hex 32`, set it in .env, and add it as the "Authorization" request header (value: `Bearer <token>`) in Claude connector settings.');
  process.exit(1);
}

const wp = createWordPressClient({ url: WP_URL, username: WP_USERNAME, password: WP_APP_PASSWORD });
const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: false }));

// CORS — required for Claude's browser UI widget
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Constant-time comparison so token checks don't leak timing info
function isValidToken(tokenStr) {
  const expected = Buffer.from(MCP_BEARER_TOKEN);
  const actual = Buffer.from(tokenStr);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// ─── MCP Tools ────────────────────────────────────────────────────────────────

const MCP_TOOLS = [
  {
    name: 'get_posts',
    description: 'Get a list of WordPress posts. Returns ID, title, status, date, and excerpt.',
    inputSchema: {
      type: 'object',
      properties: {
        per_page: { type: 'integer', description: 'Posts to return (default 10, max 100)', default: 10 },
        page: { type: 'integer', description: 'Page number for pagination', default: 1 },
        status: { type: 'string', enum: ['publish', 'draft', 'pending', 'private', 'any'], description: 'Filter by status', default: 'any' },
        search: { type: 'string', description: 'Search keyword' },
      },
    },
  },
  {
    name: 'get_post',
    description: 'Get the full content of a single WordPress post by its ID.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', description: 'The post ID' },
      },
    },
  },
  {
    name: 'get_categories',
    description: 'Get WordPress categories (id, name, slug, post count). Use this to look up a category ID by name before calling update_post.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search categories by name' },
        per_page: { type: 'integer', description: 'Categories to return (default 100)', default: 100 },
      },
    },
  },
  {
    name: 'update_post',
    description: "Update an existing WordPress post. Only the fields you provide are changed. IMPORTANT: categories and tags REPLACE the post's current set entirely (WordPress does not merge) — include every category/tag ID you want the post to end up with, e.g. pass [1, <demo_id>] to add the \"demo\" category while keeping Uncategorized, or [<demo_id>] alone to move it fully into demo.",
    inputSchema: {
      type: 'object',
      required: ['post_id'],
      properties: {
        post_id: { type: 'integer', description: 'The ID of the post to update' },
        title: { type: 'string', description: 'New post title' },
        content: { type: 'string', description: 'New post body content (HTML supported)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'New post status' },
        excerpt: { type: 'string', description: 'New excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: "Category IDs. Replaces the post's current categories entirely." },
        tags: { type: 'array', items: { type: 'integer' }, description: "Tag IDs. Replaces the post's current tags entirely." },
      },
    },
  },
  {
    name: 'create_post',
    description: 'Create a new WordPress post.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post body content (HTML supported)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
      },
    },
  },
  {
    name: 'upload_image',
    description: 'Upload an image to WordPress media library. Provide image_url OR image_base64.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'Public URL of the image to fetch and upload' },
        image_base64: { type: 'string', description: 'Base64-encoded image data' },
        filename: { type: 'string', description: 'Filename (e.g. photo.jpg)' },
        mime_type: { type: 'string', description: 'MIME type (e.g. image/jpeg, image/png)' },
      },
    },
  },
  {
    name: 'create_post_with_image',
    description: 'Upload a featured image and create a WordPress post with it in one step.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post body content (HTML supported)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
        image_url: { type: 'string', description: 'Public URL of the featured image' },
        image_base64: { type: 'string', description: 'Base64-encoded featured image data' },
        filename: { type: 'string', description: 'Image filename' },
        mime_type: { type: 'string', description: 'Image MIME type' },
      },
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image using Pollinations.ai (Flux model, free, no login needed) from a text prompt and upload it to the WordPress media library.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Text prompt describing the image to generate' },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Image aspect ratio (default: 16:9)', default: '1:1' },
        filename: { type: 'string', description: 'Filename to use when saving to WordPress (default: generated-image.png)' },
      },
    },
  },
  {
    name: 'generate_image_for_post',
    description: 'Generate an image with Google Imagen 3, upload it to WordPress media, and create a new post with it as the featured image — all in one step.',
    inputSchema: {
      type: 'object',
      required: ['prompt', 'title', 'content'],
      properties: {
        prompt: { type: 'string', description: 'Text prompt describing the featured image to generate' },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Image aspect ratio (default: 16:9)', default: '1:1' },
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post body content (HTML supported)' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
      },
    },
  },
  {
    name: 'create_post_with_ai_images',
    description: 'Automatically analyze post content, generate 3 matching section images using AI (one per H2 section), embed them into the content, and publish the post. The first image becomes the featured image.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'Post title' },
        content: { type: 'string', description: 'Post body HTML with H2 section headings. Images will be generated and inserted after each H2.' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Image aspect ratio for all generated images (default: 16:9)', default: '1:1' },
      },
    },
  },
  {
    name: 'create_seo_post',
    description: 'Create a WordPress post fully optimized for SEO and AEO (Answer Engine Optimization). Automatically injects: Table of Contents, FAQ schema for People Also Ask, Article JSON-LD schema, human-centric writing signals (transition words, conversational hooks), keyword density check, reading time badge, and Yoast/RankMath meta fields. Best used when you want the post to rank well on Google and appear in AI-generated answers.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'Post title — should include the focus keyword' },
        content: { type: 'string', description: 'Post body HTML. Use H2 headings for sections. The tool will automatically add TOC, schema markup, and human signals.' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt (used as meta description if meta_description not provided)' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
        focus_keyword: { type: 'string', description: 'Primary SEO keyword to rank for. Will be checked in title, first paragraph, H2s, and meta description.' },
        secondary_keywords: { type: 'array', items: { type: 'string' }, description: 'LSI / related keywords for topic coverage' },
        meta_description: { type: 'string', description: 'SEO meta description (150-160 chars ideal). Set via Yoast/RankMath if plugin installed.' },
        seo_title: { type: 'string', description: 'Custom SEO title tag (overrides post title in SERPs)' },
        faq_items: {
          type: 'array',
          description: 'FAQ items for People Also Ask (AEO). Each item adds a question+answer block with FAQ schema.',
          items: {
            type: 'object',
            required: ['question', 'answer'],
            properties: {
              question: { type: 'string', description: 'The question' },
              answer: { type: 'string', description: 'The answer (HTML allowed)' },
            },
          },
        },
        author_name: { type: 'string', description: 'Author name for E-E-A-T signals in Article schema' },
        enable_toc: { type: 'boolean', description: 'Add Table of Contents (default: true)', default: true },
        image_url: { type: 'string', description: 'Featured image URL (direct upload)' },
        image_base64: { type: 'string', description: 'Featured image base64' },
        canva_image_url: { type: 'string', description: 'Public export URL of a Canva design to use as featured image. Obtain this from the Canva connector export tool, then pass it here.' },
        filename: { type: 'string', description: 'Image filename' },
        mime_type: { type: 'string', description: 'Image MIME type' },
        internal_links: {
          type: 'array',
          description: 'Internal links to inject into the post body and append as a Related Articles block. Each entry links a keyword phrase in the content to another post URL. Boosts SEO score by up to +15 points. Use get_related_posts_for_linking first to discover linkable posts.',
          items: {
            type: 'object',
            required: ['url', 'anchorText'],
            properties: {
              url: { type: 'string', description: 'Destination post URL' },
              anchorText: { type: 'string', description: 'Visible link text (should match or relate to a phrase in the content)' },
              keyword: { type: 'string', description: 'Exact phrase in the content to hyperlink (defaults to anchorText if omitted)' },
            },
          },
        },
      },
    },
  },
  {
    name: 'create_seo_post_with_ai_images',
    description: 'The most complete post creation tool: combines full SEO/AEO optimization (TOC, FAQ schema, Article schema, human writing signals, keyword checks) WITH automatic AI image generation per H2 section. Ideal for creating publication-ready, search-optimized blog posts in one step.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', description: 'Post title — should include the focus keyword' },
        content: { type: 'string', description: 'Post body HTML with H2 section headings.' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Image aspect ratio (default: 16:9)', default: '16:9' },
        focus_keyword: { type: 'string', description: 'Primary SEO keyword' },
        secondary_keywords: { type: 'array', items: { type: 'string' }, description: 'LSI / related keywords' },
        meta_description: { type: 'string', description: 'SEO meta description (150-160 chars ideal)' },
        seo_title: { type: 'string', description: 'Custom SEO title tag' },
        faq_items: {
          type: 'array',
          description: 'FAQ items for People Also Ask AEO schema',
          items: {
            type: 'object',
            required: ['question', 'answer'],
            properties: {
              question: { type: 'string' },
              answer: { type: 'string' },
            },
          },
        },
        author_name: { type: 'string', description: 'Author name for E-E-A-T signals' },
        enable_toc: { type: 'boolean', description: 'Add Table of Contents (default: true)', default: true },
        canva_image_url: { type: 'string', description: 'Public export URL of a Canva design to use as the featured image instead of generating one. The AI-generated images will still be used for inline H2 sections.' },
        internal_links: {
          type: 'array',
          description: 'Internal links to inject into the post body + Related Articles block. Use get_related_posts_for_linking to find candidates.',
          items: {
            type: 'object',
            required: ['url', 'anchorText'],
            properties: {
              url: { type: 'string' },
              anchorText: { type: 'string' },
              keyword: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'create_seo_post_with_canva',
    description: 'Create a fully SEO/AEO-optimized WordPress post using a Canva-designed featured image combined with AI-generated inline section images. Use this tool when you want professional branded visuals (from Canva) as the hero/featured image while still auto-generating contextual images per H2 section. Workflow: (1) Use the Canva connector to create and export a design, (2) pass the exported public URL as canva_featured_url here, (3) this tool uploads it to WordPress media, generates AI images for each section, enriches content with full SEO/AEO signals, and publishes.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content', 'canva_featured_url'],
      properties: {
        title: { type: 'string', description: 'Post title — should include the focus keyword' },
        content: { type: 'string', description: 'Post body HTML with H2 section headings.' },
        canva_featured_url: { type: 'string', description: 'Public export URL of the Canva design to use as featured image. Must be a direct image URL (PNG or JPG) obtainable from the Canva connector export.' },
        canva_filename: { type: 'string', description: 'Filename for the Canva image when saved to WordPress (e.g. featured-banner.png). Default: canva-featured.png' },
        canva_section_urls: {
          type: 'array',
          description: 'Optional: array of Canva export URLs to use as inline section images (one per H2, in order). If provided, these replace AI-generated section images. Use the Canva connector to design and export one image per section, then list the URLs here.',
          items: { type: 'string', description: 'Direct export URL of a Canva design for this section' },
        },
        generate_section_images: { type: 'boolean', description: 'Generate AI images for H2 sections not covered by canva_section_urls (default: true). Set false to skip all AI section images.', default: true },
        aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Aspect ratio for AI-generated section images (default: 16:9)', default: '16:9' },
        status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'], description: 'Post status (default: draft)', default: 'draft' },
        excerpt: { type: 'string', description: 'Short excerpt' },
        categories: { type: 'array', items: { type: 'integer' }, description: 'Category IDs' },
        tags: { type: 'array', items: { type: 'integer' }, description: 'Tag IDs' },
        focus_keyword: { type: 'string', description: 'Primary SEO keyword' },
        secondary_keywords: { type: 'array', items: { type: 'string' }, description: 'LSI / related keywords' },
        meta_description: { type: 'string', description: 'SEO meta description (150-160 chars ideal)' },
        seo_title: { type: 'string', description: 'Custom SEO title tag' },
        faq_items: {
          type: 'array',
          description: 'FAQ items for People Also Ask AEO schema',
          items: {
            type: 'object',
            required: ['question', 'answer'],
            properties: {
              question: { type: 'string' },
              answer: { type: 'string' },
            },
          },
        },
        author_name: { type: 'string', description: 'Author name for E-E-A-T signals' },
        enable_toc: { type: 'boolean', description: 'Add Table of Contents (default: true)', default: true },
        internal_links: {
          type: 'array',
          description: 'Internal links to inject into post body + Related Articles block. Use get_related_posts_for_linking to find candidates.',
          items: {
            type: 'object',
            required: ['url', 'anchorText'],
            properties: {
              url: { type: 'string' },
              anchorText: { type: 'string' },
              keyword: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'get_related_posts_for_linking',
    description: 'Fetch existing published WordPress posts that are suitable for internal linking. Returns a ready-to-use internal_links array you can pass directly to any create_seo_post* tool. Run this BEFORE creating a post to discover linkable posts in the same category or by keyword, then pass the result as internal_links.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Keyword to filter posts by (e.g. the focus keyword of the new post, or related terms)' },
        category_id: { type: 'integer', description: 'Filter by category ID to find topically related posts' },
        per_page: { type: 'integer', description: 'Number of posts to return (default: 5, max: 10)', default: 5 },
      },
    },
  },
];

// ─── Tool Runner ──────────────────────────────────────────────────────────────

async function runTool(name, args) {
  switch (name) {
    case 'get_posts': {
      const posts = await wp.getPosts({
        per_page: args.per_page || 10,
        page: args.page || 1,
        status: args.status || 'any',
        search: args.search,
      });
      return posts.map(p => ({
        id: p.id,
        title: p.title?.rendered,
        status: p.status,
        date: p.date,
        link: p.link,
        excerpt: p.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim(),
      }));
    }

    case 'get_related_posts_for_linking': {
      // Fetch published posts filtered by keyword/category for internal linking
      const query = {
        per_page: Math.min(args.per_page || 5, 10),
        status: 'publish',
      };
      if (args.search) query.search = args.search;
      if (args.category_id) query.categories = [args.category_id];
      const posts = await wp.getPosts(query);
      // Return in ready-to-use internal_links format
      const internal_links = posts.map(p => ({
        url: p.link,
        anchorText: p.title?.rendered?.replace(/<[^>]+>/g, '').trim() || '',
        keyword: p.title?.rendered?.replace(/<[^>]+>/g, '').trim() || '',
        post_id: p.id,
        excerpt: p.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim(),
      }));
      return {
        internal_links,
        usage: 'Pass the internal_links array (or a subset) directly to create_seo_post_with_ai_images, create_seo_post, or create_seo_post_with_canva. You can edit anchorText and keyword to match phrases that appear naturally in your new post content.',
        count: internal_links.length,
      };
    }

    case 'get_post': {
      const p = await wp.getPost(args.id);
      return {
        id: p.id,
        title: p.title?.rendered,
        content: p.content?.rendered,
        status: p.status,
        date: p.date,
        link: p.link,
        categories: p.categories,
        tags: p.tags,
        featured_media: p.featured_media,
      };
    }

    case 'get_categories': {
      const categories = await wp.getCategories({
        per_page: args.per_page || 100,
        search: args.search,
      });
      return categories.map(c => ({ id: c.id, name: c.name, slug: c.slug, count: c.count }));
    }

    case 'update_post': {
      const { post_id, ...updates } = args;
      const p = await wp.updatePost(post_id, updates);
      return { id: p.id, link: p.link, status: p.status, categories: p.categories, tags: p.tags };
    }

    case 'create_post': {
      const p = await wp.createPost(args);
      return { id: p.id, link: p.link, status: p.status };
    }

    case 'upload_image': {
      const media = await wp.uploadMedia({
        imageUrl: args.image_url,
        imageBase64: args.image_base64,
        fileName: args.filename,
        mimeType: args.mime_type,
      });
      return { id: media.id, url: media.source_url, filename: media.slug };
    }

    case 'create_post_with_image': {
      const media = await wp.uploadMedia({
        imageUrl: args.image_url,
        imageBase64: args.image_base64,
        fileName: args.filename,
        mimeType: args.mime_type,
      });
      const p = await wp.createPost({
        title: args.title,
        content: args.content,
        status: args.status || 'draft',
        excerpt: args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: media.id,
      });
      return { post_id: p.id, post_link: p.link, status: p.status, media_id: media.id, media_url: media.source_url };
    }

    case 'generate_image': {
      const [generated] = await generateImage({
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio || '16:9',
      });
      const filename = args.filename || 'generated-image.png';
      const media = await wp.uploadMedia({
        imageBase64: generated.base64,
        fileName: filename,
        mimeType: generated.mimeType,
      });
      return { media_id: media.id, media_url: media.source_url, filename: media.slug };
    }

    case 'generate_image_for_post': {
      const [generated] = await generateImage({
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio || '16:9',
      });
      const media = await wp.uploadMedia({
        imageBase64: generated.base64,
        fileName: 'generated-image.png',
        mimeType: generated.mimeType,
      });
      const p = await wp.createPost({
        title: args.title,
        content: args.content,
        status: args.status || 'draft',
        excerpt: args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: media.id,
      });
      return { post_id: p.id, post_link: p.link, status: p.status, media_id: media.id, media_url: media.source_url };
    }

    case 'create_post_with_ai_images': {
      // 1. Extract 3 section-matched prompts from content
      const prompts = extractImagePrompts(args.content, args.title);
      console.log(`  Extracted ${prompts.length} image prompts from content`);

      // 2. Generate & upload all 3 images sequentially (Pollinations rate limit)
      const aspectRatio = args.aspect_ratio || '16:9';
      const uploadedImages = [];
      for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        console.log(`  Generating image ${i + 1}/${prompts.length}: ${prompt.slice(0, 80)}...`);
        const [img] = await generateImage({ prompt, aspectRatio });
        const media = await wp.uploadMedia({
          imageBase64: img.base64,
          fileName: `section-image-${i + 1}.jpg`,
          mimeType: img.mimeType,
        });
        uploadedImages.push({ url: media.source_url, mediaId: media.id });
      }

      // 3. Embed images into content after each H2 section
      const enrichedContent = insertImagesIntoContent(args.content, uploadedImages);

      // 4. Create post with first image as featured media
      const p = await wp.createPost({
        title: args.title,
        content: enrichedContent,
        status: args.status || 'draft',
        excerpt: args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: uploadedImages[0].mediaId,
      });

      return {
        post_id: p.id,
        post_link: p.link,
        status: p.status,
        images_generated: uploadedImages.length,
        images: uploadedImages,
        prompts_used: prompts,
      };
    }

    case 'create_seo_post': {
      // 1. Upload featured image — priority: canva_image_url > image_url > image_base64
      let featuredMediaId;
      let featuredImageUrl;
      const featuredSrc = args.canva_image_url || args.image_url;
      if (featuredSrc || args.image_base64) {
        const media = await wp.uploadMedia({
          imageUrl: featuredSrc,
          imageBase64: args.image_base64,
          fileName: args.filename || (args.canva_image_url ? 'canva-featured.png' : undefined),
          mimeType: args.mime_type,
        });
        featuredMediaId = media.id;
        featuredImageUrl = media.source_url;
        if (args.canva_image_url) console.log(`  Canva featured image uploaded: ${featuredImageUrl}`);
      }

      // 2. Enrich content with SEO/AEO signals
      const seoResult = enrichPost({
        title: args.title,
        content: args.content,
        focusKeyword: args.focus_keyword,
        secondaryKeywords: args.secondary_keywords,
        metaDescription: args.meta_description || args.excerpt || '',
        faqItems: args.faq_items || [],
        enableToc: args.enable_toc !== false,
        authorName: args.author_name || '',
        imageUrl: featuredImageUrl || '',
        siteUrl: process.env.WP_URL || '',
        siteName: process.env.SITE_NAME || '',
        internalLinks: args.internal_links || [],
      });

      console.log(`  SEO score: ${seoResult.seoScore}/100, warnings: ${seoResult.seoWarnings.length}`);

      // 3. Create WordPress post (draft first so we get the real URL)
      const p = await wp.createPost({
        title: args.title,
        content: seoResult.content,
        status: args.status || 'draft',
        excerpt: seoResult.metaDescription || args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: featuredMediaId,
      });

      // 4. Inject real post URL into Article JSON-LD schema, then update the post
      const finalContent = injectPostUrl(seoResult.content, p.link);
      if (finalContent !== seoResult.content) {
        await wp.updatePost(p.id, { content: finalContent });
      }

      // 5. Update SEO plugin meta fields (best-effort)
      await wp.updatePostSeoMeta(p.id, {
        focusKeyword: args.focus_keyword,
        metaDescription: seoResult.metaDescription,
        seoTitle: args.seo_title,
      });

      return {
        post_id: p.id,
        post_link: p.link,
        status: p.status,
        seo_score: seoResult.seoScore,
        reading_time_minutes: seoResult.readingTime,
        keyword_density_pct: seoResult.keywordDensityPct,
        seo_warnings: seoResult.seoWarnings,
        faq_items_added: (args.faq_items || []).length,
        toc_enabled: args.enable_toc !== false,
        internal_links_injected: seoResult.internalLinksInjected,
      };
    }

    case 'create_seo_post_with_ai_images': {
      // 1. If canva_image_url provided, upload it as featured image first (Phase 4 hybrid)
      let canvaFeaturedMediaId;
      let canvaFeaturedUrl;
      if (args.canva_image_url) {
        console.log(`  Uploading Canva featured image: ${args.canva_image_url.slice(0, 80)}...`);
        const canvaMedia = await wp.uploadMedia({
          imageUrl: args.canva_image_url,
          fileName: 'canva-featured.png',
        });
        canvaFeaturedMediaId = canvaMedia.id;
        canvaFeaturedUrl = canvaMedia.source_url;
        console.log(`  Canva featured image uploaded: ${canvaFeaturedUrl}`);
      }

      // 2. Extract image prompts from raw content (for inline section images)
      const rawPrompts = extractImagePrompts(args.content, args.title);
      console.log(`  Extracted ${rawPrompts.length} image prompts for SEO post`);

      // 3. Generate & upload AI section images
      const aspectRatio = args.aspect_ratio || '16:9';
      const uploadedImages = [];
      for (let i = 0; i < rawPrompts.length; i++) {
        console.log(`  Generating image ${i + 1}/${rawPrompts.length}: ${rawPrompts[i].slice(0, 80)}...`);
        const [img] = await generateImage({ prompt: rawPrompts[i], aspectRatio });
        const media = await wp.uploadMedia({
          imageBase64: img.base64,
          fileName: `seo-image-${i + 1}.jpg`,
          mimeType: img.mimeType,
        });
        uploadedImages.push({ url: media.source_url, mediaId: media.id });
      }

      // 4. Embed inline images into content
      const contentWithImages = insertImagesIntoContent(args.content, uploadedImages);

      // 5. Enrich with SEO/AEO signals
      // Featured image for schema: prefer Canva > first AI image
      const schemaImageUrl = canvaFeaturedUrl || uploadedImages[0]?.url || '';
      const seoResult = enrichPost({
        title: args.title,
        content: contentWithImages,
        focusKeyword: args.focus_keyword,
        secondaryKeywords: args.secondary_keywords,
        metaDescription: args.meta_description || args.excerpt || '',
        faqItems: args.faq_items || [],
        enableToc: args.enable_toc !== false,
        authorName: args.author_name || '',
        imageUrl: schemaImageUrl,
        siteUrl: process.env.WP_URL || '',
        siteName: process.env.SITE_NAME || '',
        internalLinks: args.internal_links || [],
      });

      console.log(`  SEO score: ${seoResult.seoScore}/100`);

      // 6. Create post — featured media: Canva image if available, else first AI image
      const featuredMediaId = canvaFeaturedMediaId || uploadedImages[0]?.mediaId;
      const p = await wp.createPost({
        title: args.title,
        content: seoResult.content,
        status: args.status || 'draft',
        excerpt: seoResult.metaDescription || args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: featuredMediaId,
      });

      // 7. Inject real post URL into Article JSON-LD, then update post
      const finalContent = injectPostUrl(seoResult.content, p.link);
      if (finalContent !== seoResult.content) {
        await wp.updatePost(p.id, { content: finalContent });
      }

      // 8. Update SEO plugin meta (best-effort)
      await wp.updatePostSeoMeta(p.id, {
        focusKeyword: args.focus_keyword,
        metaDescription: seoResult.metaDescription,
        seoTitle: args.seo_title,
      });

      return {
        post_id: p.id,
        post_link: p.link,
        status: p.status,
        featured_image_source: canvaFeaturedMediaId ? 'canva' : 'ai_generated',
        canva_featured_url: canvaFeaturedUrl || null,
        ai_section_images: uploadedImages.length,
        seo_score: seoResult.seoScore,
        reading_time_minutes: seoResult.readingTime,
        keyword_density_pct: seoResult.keywordDensityPct,
        seo_warnings: seoResult.seoWarnings,
        faq_items_added: (args.faq_items || []).length,
        toc_enabled: args.enable_toc !== false,
        internal_links_injected: seoResult.internalLinksInjected,
      };
    }

    case 'create_seo_post_with_canva': {
      // 1. Upload Canva featured image (required)
      console.log(`  Uploading Canva featured image: ${args.canva_featured_url.slice(0, 80)}...`);
      const canvaMedia = await wp.uploadMedia({
        imageUrl: args.canva_featured_url,
        fileName: args.canva_filename || 'canva-featured.png',
      });
      const canvaMediaId = canvaMedia.id;
      const canvaMediaUrl = canvaMedia.source_url;
      console.log(`  Canva featured image uploaded: ${canvaMediaUrl}`);

      // 2. Handle section images: Canva section URLs take priority over AI generation
      const canvaSectionUrls = args.canva_section_urls || [];
      const generateSections = args.generate_section_images !== false;
      let contentToEnrich = args.content;

      if (canvaSectionUrls.length > 0 || generateSections) {
        const sectionImages = [];

        // Upload Canva section images first (in order, matching H2 sections)
        for (let i = 0; i < canvaSectionUrls.length; i++) {
          console.log(`  Uploading Canva section image ${i + 1}/${canvaSectionUrls.length}...`);
          const media = await wp.uploadMedia({
            imageUrl: canvaSectionUrls[i],
            fileName: `canva-section-${i + 1}.png`,
          });
          sectionImages.push({ url: media.source_url, mediaId: media.id });
          console.log(`  Canva section ${i + 1} uploaded: ${media.source_url}`);
        }

        // If fewer Canva images than H2 sections, fill remaining with AI-generated images
        if (generateSections && sectionImages.length < 3) {
          const sectionPrompts = extractImagePrompts(args.content, args.title);
          const remaining = sectionPrompts.slice(sectionImages.length);
          console.log(`  Generating ${remaining.length} AI images for remaining sections...`);
          const aspectRatio = args.aspect_ratio || '16:9';
          for (let i = 0; i < remaining.length; i++) {
            const idx = sectionImages.length + i;
            console.log(`  AI section image ${idx + 1}: ${remaining[i].slice(0, 80)}...`);
            const [img] = await generateImage({ prompt: remaining[i], aspectRatio });
            const media = await wp.uploadMedia({
              imageBase64: img.base64,
              fileName: `section-image-${idx + 1}.jpg`,
              mimeType: img.mimeType,
            });
            sectionImages.push({ url: media.source_url, mediaId: media.id });
          }
        }

        if (sectionImages.length > 0) {
          contentToEnrich = insertImagesIntoContent(args.content, sectionImages);
          console.log(`  Embedded ${sectionImages.length} section images (${canvaSectionUrls.length} Canva + ${sectionImages.length - canvaSectionUrls.length} AI)`);
        }
      }

      // 3. Enrich with SEO/AEO signals (Canva image URL used in Article schema)
      const seoResult = enrichPost({
        title: args.title,
        content: contentToEnrich,
        focusKeyword: args.focus_keyword,
        secondaryKeywords: args.secondary_keywords,
        metaDescription: args.meta_description || args.excerpt || '',
        faqItems: args.faq_items || [],
        enableToc: args.enable_toc !== false,
        authorName: args.author_name || '',
        imageUrl: canvaMediaUrl,
        siteUrl: process.env.WP_URL || '',
        siteName: process.env.SITE_NAME || '',
        internalLinks: args.internal_links || [],
      });

      console.log(`  SEO score: ${seoResult.seoScore}/100`);

      // 4. Create post with Canva image as featured
      const p = await wp.createPost({
        title: args.title,
        content: seoResult.content,
        status: args.status || 'draft',
        excerpt: seoResult.metaDescription || args.excerpt,
        categories: args.categories,
        tags: args.tags,
        featured_media: canvaMediaId,
      });

      // 5. Inject real post URL into Article JSON-LD
      const finalContent = injectPostUrl(seoResult.content, p.link);
      if (finalContent !== seoResult.content) {
        await wp.updatePost(p.id, { content: finalContent });
      }

      // 6. Update SEO plugin meta (best-effort)
      await wp.updatePostSeoMeta(p.id, {
        focusKeyword: args.focus_keyword,
        metaDescription: seoResult.metaDescription,
        seoTitle: args.seo_title,
      });

      return {
        post_id: p.id,
        post_link: p.link,
        status: p.status,
        featured_image_source: 'canva',
        canva_featured_url: canvaMediaUrl,
        canva_media_id: canvaMediaId,
        canva_section_images: (args.canva_section_urls || []).length,
        section_images_generated: generateSections,
        internal_links_injected: seoResult.internalLinksInjected,
        seo_score: seoResult.seoScore,
        reading_time_minutes: seoResult.readingTime,
        keyword_density_pct: seoResult.keywordDensityPct,
        seo_warnings: seoResult.seoWarnings,
        faq_items_added: (args.faq_items || []).length,
        toc_enabled: args.enable_toc !== false,
      };
    }

    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}

// ─── MCP Endpoint ─────────────────────────────────────────────────────────────

app.post('/', async (req, res) => {
  // Verify the static Bearer token configured in Claude's connector "Request headers"
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ') || !isValidToken(authHeader.slice(7))) {
    res.set('WWW-Authenticate', 'Bearer realm="WordPress MCP"');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { method, id, params } = req.body;

  // JSON-RPC notifications have no id — must not send a response body
  if (id === undefined || id === null) {
    console.log(`  Notification: ${method}`);
    return res.status(204).end();
  }

  console.log(`  RPC: ${method} (id=${id})`);

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'WordPress MCP', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    });
  }

  if (method === 'tools/list') {
    return res.json({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    console.log(`  Tool: ${toolName}`, toolArgs);
    try {
      const result = await runTool(toolName, toolArgs);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      console.error(`  Tool error [${toolName}]:`, err.message);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
      });
    }
  }

  return res.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', wordpress: WP_URL });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WordPress MCP listening on port ${PORT}`);
  console.log(`WordPress: ${WP_URL}`);
});
