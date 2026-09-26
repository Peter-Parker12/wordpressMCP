# WordPress MCP Server

A Node.js MCP server that exposes WordPress operations as tools for Claude.

## What this does

- Lists and searches WordPress posts
- Reads the full content of a single post
- Creates new WordPress posts
- Uploads images to the WordPress media library
- Creates a post with a featured image in one step

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

The server speaks MCP over JSON-RPC at a single endpoint: `POST /`. It exposes these tools:

- `get_posts` — list/search posts (`per_page`, `page`, `status`, `search`)
- `get_post` — full content of one post by `id`
- `create_post` — create a post (`title`, `content`, `status`, `excerpt`, `categories`, `tags`)
- `upload_image` — upload an image to the media library (`image_url` or `image_base64`, `filename`, `mime_type`)
- `create_post_with_image` — upload a featured image and create the post in one call

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
