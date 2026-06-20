# WordPress MCP Server

A local Node.js server that exposes WordPress REST API operations for Claude or other MCP-enabled tools.

## What this does

- Creates new WordPress blog posts
- Updates existing posts
- Uploads images to WordPress media
- Attaches an uploaded image as a post's featured media

## Setup

1. Install dependencies locally if you want to run outside Docker:

```bash
npm install
```

2. Copy the example environment file and configure your WordPress credentials:

```bash
cp .env.example .env
```

3. Fill in `.env`:
- `WP_URL`: your self-hosted WordPress base URL, e.g. `https://example.com`
- `WP_USERNAME`: WordPress username
- `WP_APP_PASSWORD`: WordPress application password
- `PORT`: local port for the MCP server (default `9808`)

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
docker run --env-file .env -p 9808:9808 wordpress-mcp
```

## API Endpoints

- `POST /create-post`
- `POST /update-post`
- `POST /upload-image`
- `POST /create-post-with-image`
- `POST /set-featured-image`
- `GET /health`

## Example requests

Create a new post:

```bash
curl http://localhost:4000/create-post \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello from Claude","content":"This is a generated blog post.","status":"draft"}'
```

Upload an image:

```bash
curl http://localhost:4000/upload-image \
  -H "Content-Type: application/json" \
  -d '{"imageUrl":"https://example.com/image.jpg","fileName":"image.jpg"}'
```

Create a post with featured media:

```bash
curl http://localhost:4000/create-post-with-image \
  -H "Content-Type: application/json" \
  -d '{"title":"Post with image","content":"Blog content","imageUrl":"https://example.com/image.jpg","fileName":"image.jpg"}'
```

## Claude / MCP integration

This project includes a manifest at `mcp-manifest.json` describing the available operations.

The server also exposes the manifest directly at `http://localhost:9808/manifest` (or your public tunnel host).

### Test on Claude

1. Start the server locally or in Docker:

```bash
docker compose up -d --build
```

2. Confirm the manifest is available:

```bash
curl http://127.0.0.1:9809/manifest
```

3. In Claude custom connector / integration settings, use:
- `http://localhost:9809` if Claude runs on the same machine
- or your tunnel hostname if using Cloudflare, e.g. `https://mcp.yourdomain.com`

4. Configure the connector to use the server endpoints:
- `GET /health`
- `GET /manifest`
- `POST /create-post`
- `POST /update-post`
- `POST /upload-image`
- `POST /set-featured-image`
- `POST /create-post-with-image`

5. Run a quick test request in Claude against `/health` or `/manifest`.

### Example validation URL

If your connector settings accept a manifest URL, use:

```bash
http://localhost:9809/manifest
```

or:

```bash
https://mcp.yourdomain.com/manifest
```

> Note: Keep your `.env` private. The server must authenticate to WordPress using an Application Password and the correct site URL.
