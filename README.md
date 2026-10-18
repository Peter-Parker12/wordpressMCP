# WordPress MCP Server

A Node.js MCP server that exposes WordPress operations as tools for Claude.

## What this does

- Full CRUD for WordPress posts, categories, and tags
- Uploads images to the WordPress media library, with optional AI image generation
- SEO/AEO-optimized post creation (schema markup, FAQ blocks, internal linking, keyword checks)

## Setup

1. Install dependencies locally if you want to run outside Docker:

```bash
npm install
```

2. Copy the example environment file and configure your credentials:

```bash
cp .env.example .env
```

3. Fill in `.env`:
- `WP_URL`: your self-hosted WordPress base URL, e.g. `https://example.com`
- `WP_USERNAME`: WordPress username
- `WP_APP_PASSWORD`: WordPress application password
- `MCP_BEARER_TOKEN`: a random secret (`openssl rand -hex 32`) that Claude must present to use this server
- `PORT`: local port for the MCP server (default `9809`)

4. Start the server locally:

```bash
npm start
```

### Using Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```

This uses the `.env` file to provide credentials into the container.

If you want to run only the Docker image:

```bash
docker build -t wordpress-mcp .
docker run --env-file .env -p 9809:9809 wordpress-mcp
```

## Tools

The server speaks MCP over JSON-RPC at a single endpoint: `POST /`.

### Posts (CRUD)

- `get_posts` — list/search posts (`per_page`, `page`, `status`, `search`)
- `get_post` — full content of one post by `id`
- `create_post` — create a post (`title`, `content`, `status`, `excerpt`, `categories`, `tags`, `featured_media`)
- `update_post` — edit an existing post by `post_id`; only the fields you pass are changed. `categories`/`tags` **replace** the post's current set (not additive). Set `status: "draft"` or `"private"` to unpublish.
- `delete_post` — delete a post by `post_id`; moves to Trash by default, pass `force: true` to permanently delete

### Categories (CRUD)

- `get_categories` — list categories (`id`, `name`, `slug`, `count`), optionally filtered by `search`
- `get_category` — details of one category by `category_id`
- `create_category` — create a category (`name`, `description`, `slug`, `parent`)
- `update_category` — edit a category by `category_id`
- `delete_category` — permanently delete a category by `category_id` (categories don't support Trash)

### Tags (CRUD)

- `get_tags` — list tags (`id`, `name`, `slug`, `count`), optionally filtered by `search`
- `get_tag` — details of one tag by `tag_id`
- `create_tag` — create a tag (`name`, `description`, `slug`)
- `update_tag` — edit a tag by `tag_id`
- `delete_tag` — permanently delete a tag by `tag_id` (tags don't support Trash)

### Media & specialized post creation

- `upload_image` — upload an image to the media library (`image_url` or `image_base64`, `filename`, `mime_type`)
- `create_post_with_image` — upload a featured image and create the post in one call
- `generate_image` / `generate_image_for_post` — AI image generation (Pollinations.ai / Google Imagen 3) uploaded straight to the media library, optionally bundled into a new post
- `create_post_with_ai_images` — auto-generates and embeds one AI image per H2 section
- `create_seo_post` / `create_seo_post_with_ai_images` / `create_seo_post_with_canva` — SEO/AEO-optimized post creation (TOC, FAQ schema, Article schema, keyword checks) with different image sourcing strategies
- `get_related_posts_for_linking` — find existing posts suitable for internal linking, for use with the `create_seo_post*` tools

Health check: `GET /health`

## Claude / MCP integration

### Connecting from Claude

1. Start the server locally or in Docker:

```bash
docker compose up -d --build
```

2. Confirm it's up:

```bash
curl http://127.0.0.1:9809/health
```

3. In Claude, add a **Custom Connector** with:
- URL: `http://localhost:9809` if Claude runs on the same machine, or your tunnel hostname (e.g. `https://mcp.yourdomain.com`)
- Authentication: **No sign-in**
- Under **Request headers**, add:
  - Header name: `Authorization`
  - Value: `Bearer <your MCP_BEARER_TOKEN>` (the same value set in `.env`)

The server checks this header on every request — no OAuth flow, no per-user sign-in.

> Note: Keep your `.env` private. `MCP_BEARER_TOKEN` grants full access to your WordPress site through this server, and `WP_APP_PASSWORD` authenticates to WordPress itself.

### Example requests

List posts:

```bash
curl http://localhost:9809/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your MCP_BEARER_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_posts","arguments":{"per_page":5}}}'
```

Create a new post:

```bash
curl http://localhost:9809/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your MCP_BEARER_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_post","arguments":{"title":"Hello from Claude","content":"This is a generated blog post.","status":"draft"}}}'
```

Upload an image and create a post with it:

```bash
curl http://localhost:9809/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your MCP_BEARER_TOKEN>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_post_with_image","arguments":{"title":"Post with image","content":"Blog content","image_url":"https://example.com/image.jpg","filename":"image.jpg"}}}'
```
