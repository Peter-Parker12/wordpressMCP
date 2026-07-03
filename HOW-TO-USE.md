# How to Use — WordPress MCP Server

Hướng dẫn đầy đủ cách cài đặt, cấu hình và ra lệnh cho Claude để tạo bài viết WordPress tối ưu SEO/AEO.

---

## Mục lục

1. [Yêu cầu hệ thống](#1-yêu-cầu-hệ-thống)
2. [Cài đặt và cấu hình](#2-cài-đặt-và-cấu-hình)
3. [Kết nối với Claude](#3-kết-nối-với-claude)
4. [Danh sách Tools](#4-danh-sách-tools)
5. [Hướng dẫn ra lệnh cho Claude](#5-hướng-dẫn-ra-lệnh-cho-claude)
   - [Tool cơ bản](#51-tools-cơ-bản)
   - [Tool SEO/AEO đầy đủ](#52-tool-seoacquisition-đầy-đủ)
   - [Tool kết hợp Canva](#53-tool-kết-hợp-canva)
6. [Ví dụ lệnh thực tế](#6-ví-dụ-lệnh-thực-tế)
   - [Bài viết SEO ngành F&B](#bài-viết-seo-ngành-fb)
   - [Bài viết Tech / Marketing](#bài-viết-tech--marketing)
   - [Bài viết dùng ảnh Canva](#bài-viết-dùng-ảnh-canva)
7. [Giải thích các tính năng SEO/AEO](#7-giải-thích-các-tính-năng-seoacquisition)
8. [Cấu trúc nội dung bài viết tốt](#8-cấu-trúc-nội-dung-bài-viết-tốt)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Yêu cầu hệ thống

| Thành phần | Yêu cầu |
|---|---|
| Node.js | v18 trở lên |
| WordPress | v5.9+ với REST API bật |
| WordPress Plugin | Yoast SEO **hoặc** RankMath (khuyến nghị) |
| Claude | Claude.ai với MCP Connector |
| Canva (tuỳ chọn) | Canva Connector trong Claude |
| Gemini API Key | Để gen ảnh AI (Imagen 3) |

---

## 2. Cài đặt và cấu hình

### Bước 1 — Clone và cài dependencies

```bash
git clone <repo-url>
cd wordpressMCP
npm install
```

### Bước 2 — Tạo file `.env`

```bash
cp .env.example .env
```

Điền đầy đủ vào `.env`:

```env
# WordPress
WP_URL=https://your-site.com
WP_USERNAME=your_wp_username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx

# MCP Auth (tự đặt bất kỳ giá trị mạnh nào)
CLAUDE_CLIENT_ID=my-wordpress-mcp
CLAUDE_CLIENT_SECRET=super-secret-value-here

# Google Gemini (để gen ảnh AI)
GEMINI_API_KEY=AIzaSy...

# Thông tin website (cho Article schema)
SITE_NAME=Tên Website Của Bạn

# Port (mặc định 9809)
PORT=9809
```

> **Lấy WordPress App Password:**
> WordPress Admin → Users → Profile → cuộn xuống "Application Passwords" → nhập tên → Generate.

### Bước 3 — Chạy server

**Cách A — Local:**
```bash
npm start
```

**Cách B — Docker:**
```bash
docker compose up --build
```

Server sẽ chạy tại `http://localhost:9809` (hoặc port bạn đặt).

> Nếu dùng với Claude trên internet, bạn cần expose server qua tunnel (ngrok, Cloudflare Tunnel, hoặc VPS).

---

## 3. Kết nối với Claude

### Thêm MCP Connector trong Claude.ai

1. Vào **Claude.ai** → Settings → **Integrations** (hoặc MCP Connectors)
2. Chọn **Add Custom MCP Server**
3. Điền:
   - **Server URL**: `https://your-server-url` (hoặc `http://localhost:9809` nếu dùng local tunnel)
   - **Client ID**: giá trị `CLAUDE_CLIENT_ID` trong `.env`
   - **Client Secret**: giá trị `CLAUDE_CLIENT_SECRET` trong `.env`
4. Claude sẽ tự discovery và hiển thị danh sách tools

### Thêm Canva Connector (tuỳ chọn — cho tích hợp ảnh Canva)

1. Vào Claude.ai → Settings → Integrations
2. Tìm **Canva** → Connect
3. Đăng nhập tài khoản Canva của bạn
4. Sau khi kết nối, Claude có thể dùng cả 2 connector cùng lúc

---

## 4. Danh sách Tools

| Tool | Mô tả | Dùng khi nào |
|---|---|---|
| `get_posts` | Lấy danh sách bài viết | Kiểm tra bài đã có |
| `get_post` | Lấy nội dung 1 bài theo ID | Review bài cũ |
| `create_post` | Tạo bài đơn giản | Post nhanh, không cần SEO |
| `upload_image` | Upload ảnh lên Media Library | Chuẩn bị ảnh thủ công |
| `create_post_with_image` | Tạo bài + upload ảnh featured | Post có ảnh sẵn |
| `generate_image` | Gen ảnh AI (Pollinations) | Tạo ảnh riêng lẻ |
| `generate_image_for_post` | Gen ảnh AI + tạo bài | Post đơn giản có ảnh AI |
| `create_post_with_ai_images` | Gen 3 ảnh AI cho 3 section H2 | Post có ảnh đẹp, không cần SEO |
| `create_seo_post` | Tạo bài với full SEO/AEO | Bài viết cần rank Google |
| `create_seo_post_with_ai_images` | SEO/AEO + gen ảnh AI tự động | **Khuyên dùng nhất** |
| `create_seo_post_with_canva` | SEO/AEO + ảnh Canva (featured + sections) + ảnh AI fill | Bài branded, chuyên nghiệp |
| `get_related_posts_for_linking` | Tìm bài cũ để làm internal links | **Chạy trước** khi tạo bài SEO |

---

## 5. Hướng dẫn ra lệnh cho Claude

### 5.1 Tools cơ bản

#### Tạo bài đơn giản
```
Tạo một bài WordPress với:
- Tool: create_post
- title: "Tiêu đề bài viết"
- content: "<p>Nội dung HTML...</p>"
- status: "draft"
```

#### Lấy danh sách bài viết
```
Dùng tool get_posts để lấy 5 bài viết mới nhất, status: any
```

---

### 5.2 Tool SEO/AEO đầy đủ

Đây là tool quan trọng nhất. Sử dụng `create_seo_post_with_ai_images` để tạo bài viết được tự động bổ sung:

- ✅ **Table of Contents** từ các H2 heading
- ✅ **FAQ Schema** (JSON-LD) cho People Also Ask
- ✅ **Article Schema** (JSON-LD BlogPosting) cho Google Rich Results
- ✅ **Reading time badge** — "⏱️ Thời gian đọc: X phút"
- ✅ **Transition words** — "Bên cạnh đó, Đặc biệt, Không chỉ vậy..."
- ✅ **Keyword injection** vào đầu bài
- ✅ **LSI keyword bolding** — secondary keywords được in đậm lần đầu
- ✅ **Internal links** — tự inject link vào text + block "Related Articles" cuối bài
- ✅ **Yoast / RankMath meta** — tự set focus keyword và meta description
- ✅ **AI images** — 3 ảnh cho 3 section, mỗi ảnh có style khác nhau (Editorial / Cinematic / Infographic)

#### Cấu trúc lệnh chuẩn

```
Tạo bài WordPress tối ưu SEO bằng tool create_seo_post_with_ai_images:

title: "[TIÊU ĐỀ — nên chứa focus keyword]"

content: "[NỘI DUNG HTML với cấu trúc sau]"

focus_keyword: "[TỪ KHÓA CHÍNH]"
secondary_keywords: ["từ khóa 2", "từ khóa 3", "từ khóa 4"]
meta_description: "[150-160 ký tự, chứa focus keyword]"
seo_title: "[Tiêu đề SEO tùy chỉnh — tuỳ chọn]"
author_name: "[Tên tác giả]"
status: "draft"
aspect_ratio: "16:9"
categories: [ID]
tags: [ID]
enable_toc: true

faq_items: [
  {"question": "Câu hỏi 1?", "answer": "Trả lời đầy đủ 1-2 câu."},
  {"question": "Câu hỏi 2?", "answer": "Trả lời đầy đủ 1-2 câu."},
  {"question": "Câu hỏi 3?", "answer": "Trả lời đầy đủ 1-2 câu."}
]

internal_links: [
  {"url": "https://site.com/bai-viet-lien-quan-1", "anchorText": "Tên bài viết 1", "keyword": "cụm từ trong nội dung"},
  {"url": "https://site.com/bai-viet-lien-quan-2", "anchorText": "Tên bài viết 2", "keyword": "cụm từ khác trong nội dung"}
]
```

> **Mẹo nhanh — Internal Links:** Dùng `get_related_posts_for_linking` trước để tìm bài liên quan, rồi copy kết quả vào `internal_links`.

---

### 5.3 Internal Linking (tăng SEO score)

Internal links inject link thật vào paragraph text + tạo block "📖 Bài viết liên quan" cuối bài. Có 3 internal links → SEO score tăng +5 bonus points.

**Workflow 2 bước khuyến nghị:**

```
Bước 1 — Tìm bài liên quan:
Dùng tool get_related_posts_for_linking:
- search: "[từ khóa liên quan đến chủ đề bài mới]"
- category_id: [ID danh mục]
- per_page: 5

→ Tool trả về mảng internal_links[] sẵn sàng dùng.

Bước 2 — Tạo bài với internal links:
Copy kết quả internal_links từ bước 1,
chỉnh keyword cho khớp với cụm từ trong nội dung bài mới,
rồi truyền vào create_seo_post_with_ai_images.
```

**Ví dụ:**
```
Bước 1: get_related_posts_for_linking
  search: "SEO"
  per_page: 3

→ Trả về:
[
  {url: "https://site.com/seo-onpage", anchorText: "SEO Onpage 2025"},
  {url: "https://site.com/keyword-research", anchorText: "Keyword Research"},
  {url: "https://site.com/backlink", anchorText: "Xây dựng Backlink"}
]

Bước 2: create_seo_post_with_ai_images
  ...
  internal_links: [
    {url: "https://site.com/seo-onpage", anchorText: "SEO Onpage 2025", keyword: "kỹ thuật on-page"},
    {url: "https://site.com/keyword-research", anchorText: "Keyword Research", keyword: "nghiên cứu từ khóa"},
    {url: "https://site.com/backlink", anchorText: "Xây dựng Backlink", keyword: "xây dựng backlink"}
  ]
```

> **Lưu ý `keyword` field:** Đây là cụm từ xuất hiện trong nội dung bài mới — tool sẽ tìm và hyperlink đúng chỗ đó. Khác với `anchorText` là text hiển thị của link.

---

### 5.4 Tool kết hợp Canva (toàn bộ ảnh từ Canva)

Giờ `create_seo_post_with_canva` hỗ trợ đầy đủ ảnh Canva cho **tất cả section**, không chỉ banner đầu.

```
Bước 1 — Tạo tất cả ảnh trong Canva connector:

"Dùng Canva connector tạo 4 ảnh cho bài về [CHỦ ĐỀ]:
- Ảnh 1 (featured banner): 1200x628px, full-width hero image
- Ảnh 2 (section 1): 1200x675px, về [NỘI DUNG H2-1]
- Ảnh 3 (section 2): 1200x675px, về [NỘI DUNG H2-2]
- Ảnh 4 (section 3): 1200x675px, về [NỘI DUNG H2-3]
Phong cách nhất quán: [MÀU THƯƠNG HIỆU], [FONT], [STYLE].
Export public URL cho từng ảnh."

Bước 2 — Truyền tất cả URLs vào tool:

create_seo_post_with_canva:
  canva_featured_url: "[URL ảnh 1 — banner]"
  canva_section_urls: [
    "[URL ảnh 2 — section 1]",
    "[URL ảnh 3 — section 2]",
    "[URL ảnh 4 — section 3]"
  ]
  generate_section_images: false   ← tắt AI vì đã có đủ ảnh Canva
  title: "..."
  internal_links: [...]             ← thêm internal links để tăng SEO
  ...
```

**Hybrid (Canva banner + AI fill):**
```
canva_featured_url: "[URL banner Canva]"
canva_section_urls: ["[URL section 1 Canva]"]   ← chỉ có 1 ảnh Canva
generate_section_images: true                    ← AI tự fill section 2 & 3
```

---

## 6. Ví dụ lệnh thực tế

### Bài viết SEO ngành F&B

```
Tạo bài WordPress tối ưu SEO bằng tool create_seo_post_with_ai_images.

Viết đầy đủ nội dung bài viết trước rồi gọi tool với các thông tin sau:

title: "Cà Phê Rang Xay: Bí Quyết Chọn Hạt Ngon Và Pha Đúng Chuẩn Barista"
focus_keyword: "cà phê rang xay"
secondary_keywords: ["hạt cà phê arabica", "cold brew", "rang cà phê", "espresso"]
meta_description: "Khám phá bí quyết chọn cà phê rang xay ngon nhất, cách pha chuẩn barista và những lỗi phổ biến cần tránh. Hướng dẫn chi tiết cho người yêu cà phê."
author_name: "Barista Team"
status: "draft"
aspect_ratio: "16:9"
enable_toc: true

faq_items:
- "Cà phê rang xay để được bao lâu?" → "Tươi nhất trong 2-4 tuần sau rang. Bảo quản hộp kín, tránh ánh sáng."
- "Arabica và Robusta khác nhau như thế nào?" → "Arabica chua nhẹ, thơm phức, ít caffeine. Robusta đắng đậm, nhiều caffeine, crema dày."
- "Xay cà phê bằng máy nào tốt?" → "Máy burr (cối đĩa) cho hạt đều hơn máy blade. Timemore C2 hoặc Baratza Encore là lựa chọn tốt cho người mới."

Nội dung gồm 3 H2 section:
1. Cách chọn hạt cà phê rang xay chất lượng (250+ từ)
2. Kỹ thuật rang và bảo quản cà phê đúng cách (250+ từ)
3. Công thức pha cà phê rang xay chuẩn barista (250+ từ)

Giọng văn: thân thiện, chuyên nghiệp nhưng dễ hiểu, có câu hỏi tu từ.
Mở đầu bằng 1 đoạn hook 80-100 từ có chứa từ khóa "cà phê rang xay".
```

---

### Bài viết Tech / Marketing

```
Tạo bài WordPress tối ưu SEO bằng tool create_seo_post_with_ai_images.

title: "Hướng Dẫn SEO Onpage 2025: 10 Kỹ Thuật Tăng Traffic Nhanh"
focus_keyword: "SEO onpage"
secondary_keywords: ["tối ưu title tag", "meta description", "internal link", "core web vitals", "E-E-A-T"]
meta_description: "Hướng dẫn SEO onpage đầy đủ 2025 với 10 kỹ thuật được kiểm chứng: tối ưu title, heading, nội dung chất lượng và Core Web Vitals để tăng thứ hạng Google nhanh."
seo_title: "SEO Onpage 2025: 10 Kỹ Thuật Tăng Traffic | [Tên Site]"
author_name: "SEO Team"
status: "draft"
aspect_ratio: "16:9"
enable_toc: true

faq_items:
- "SEO onpage là gì?" → "Tập hợp kỹ thuật tối ưu các yếu tố bên trong trang web (title, heading, nội dung, tốc độ) để tăng thứ hạng trên công cụ tìm kiếm."
- "SEO onpage mất bao lâu có kết quả?" → "Thường 4-12 tuần tùy domain authority và độ cạnh tranh từ khóa."
- "Yếu tố onpage nào quan trọng nhất 2025?" → "Title tag có từ khóa, nội dung E-E-A-T trên 1000 từ, Core Web Vitals đạt chuẩn, và internal linking hợp lý."

Nội dung 3 H2 section (mỗi section 300+ từ):
1. Tối ưu Title Tag, H1 và Meta Description đúng cách
2. Viết nội dung chuẩn E-E-A-T và tối ưu keyword density
3. Core Web Vitals và kỹ thuật technical onpage nâng cao
```

---

### Bài viết dùng ảnh Canva

```
Bước 1: Dùng Canva connector tạo banner blog 1200x628px cho bài về
"Xu hướng thiết kế nội thất 2025", phong cách minimalist Scandinavian,
màu trắng kem và gỗ tự nhiên. Export public URL.

Bước 2: Dùng tool create_seo_post_with_canva:

canva_featured_url: [URL từ bước 1]
canva_filename: "noi-that-2025-banner.png"
generate_section_images: true
aspect_ratio: "16:9"

title: "Xu Hướng Thiết Kế Nội Thất 2025: Những Phong Cách Đang Làm Mưa Làm Gió"
focus_keyword: "xu hướng nội thất 2025"
secondary_keywords: ["nội thất Scandinavian", "minimalist", "biophilic design", "trang trí nhà"]
meta_description: "Khám phá 5 xu hướng thiết kế nội thất 2025 hot nhất: Scandinavian minimalist, Japandi, Biophilic, Curved furniture và màu sắc earthy. Ý tưởng trang trí nhà đẹp cho năm mới."
author_name: "Interior Design Team"
status: "draft"

faq_items:
- "Xu hướng nội thất nào phổ biến nhất 2025?" → "Japandi (kết hợp Japanese + Scandinavian) và Biophilic design (gần gũi thiên nhiên) đang dẫn đầu xu hướng 2025."
- "Màu sắc nội thất hot 2025 là gì?" → "Earthy tones (nâu đất, xanh rêu, be cát), Terracotta và Warm White được dự đoán thống trị bảng màu nội thất 2025."
- "Biophilic design là gì?" → "Phong cách thiết kế tích hợp thiên nhiên vào không gian sống — cây xanh, ánh sáng tự nhiên, vật liệu tự nhiên (gỗ, đá, mây tre) — giúp giảm stress và tăng productivity."

Nội dung 3 H2 section (250+ từ mỗi section):
1. Phong cách Japandi và Scandinavian Minimalist — Đơn giản mà đẳng cấp
2. Biophilic Design — Đưa thiên nhiên vào ngôi nhà của bạn  
3. Màu sắc và vật liệu nội thất xu hướng 2025
```

---

## 7. Giải thích các tính năng SEO/AEO

### Table of Contents (TOC)
Tự động tạo từ tất cả heading H2 và H3 trong bài. Mỗi heading được gán `id` anchor để TOC có thể link trực tiếp. Giúp Google hiểu cấu trúc bài và hiển thị jump links trong SERP.

```
enable_toc: true   ← mặc định bật
enable_toc: false  ← tắt nếu bài ngắn < 3 section
```

### FAQ Schema (AEO — Answer Engine Optimization)
`faq_items` được render thành:
- HTML block hiển thị trên trang
- JSON-LD `FAQPage` schema — giúp Google chọn bài vào **People Also Ask** boxes

> Đây là yếu tố quan trọng nhất cho AEO. Luôn cung cấp ít nhất 3 câu hỏi thực tế người dùng hay search.

### Article JSON-LD Schema (E-E-A-T)
Tự động tạo `BlogPosting` schema với:
- `headline`, `description`, `author`, `publisher`, `datePublished`
- `image` — URL ảnh featured (Canva hoặc AI generated)
- `url` — URL thật của post sau khi tạo xong (được inject sau)

### AI Image Generation
Mỗi H2 section được gen 1 ảnh với creative brief đầy đủ:

| Section | Style preset | Phù hợp |
|---|---|---|
| Section 1 | Editorial Photography | Hook, giới thiệu |
| Section 2 | Cinematic Illustration | Nội dung chính |
| Section 3 | Modern Infographic | Data, kết luận |

Topic detection tự động điều chỉnh scene: Tech, F&B, Health, Finance, Travel, Education, Marketing...

### Internal Links (Bài viết liên quan)
`internal_links` được xử lý 2 cách:
1. **Inject vào text** — tìm `keyword` trong paragraph, wrap bằng `<a href="url">anchorText</a>`
2. **Related Articles block** — append block "📖 Bài viết liên quan" trước phần FAQ

Tác động SEO score:
- Không có internal links → **-10 điểm** + warning
- Có 1-2 internal links → **+0** (đủ điểm, hết warning)
- Có 3+ internal links → **+5 điểm bonus**

```
internal_links: [{url, anchorText, keyword?}]
```
| Field | Mô tả |
|---|---|
| `url` | URL của bài viết đích |
| `anchorText` | Text hiển thị của link (tên bài viết) |
| `keyword` | Cụm từ trong content cần hyperlink (mặc định = anchorText) |

### SEO Score (0–100)

| Tiêu chí | Điểm |
|---|---|
| Base score | 100 |
| Mỗi warning (keyword thiếu, meta ngắn...) | -10 |
| Không có `focus_keyword` | -20 |
| Không có `faq_items` | -10 |
| Không có TOC | -5 |
| Không có `internal_links` | -10 |
| Có 3+ `internal_links` | **+5 bonus** |

**Mục tiêu: ≥ 85 điểm** trước khi publish. Xem chi tiết trong `seo_warnings` của response.

---

## 8. Cấu trúc nội dung bài viết tốt

Để đạt SEO score cao nhất, yêu cầu Claude viết nội dung theo cấu trúc sau:

```html
<!-- Đoạn mở đầu: 80-120 từ, chứa focus keyword -->
<p>
  [Hook câu hỏi hoặc statement mạnh].
  [Focus keyword] là [định nghĩa ngắn].
  [Lý do bài viết này có ích cho người đọc].
</p>

<!-- Section 1 -->
<h2>[H2 chứa focus keyword hoặc LSI keyword]</h2>
<p>Nội dung 250-300 từ...</p>
<p>...</p>

<!-- Section 2 -->
<h2>[H2 — aspect/benefit tiếp theo]</h2>
<p>Nội dung 250-300 từ...</p>

<!-- Section 3 -->
<h2>[H2 — practical tips / how-to / conclusion]</h2>
<p>Nội dung 250-300 từ...</p>

<!-- Kết bài: CTA rõ ràng -->
<p>
  [Tóm tắt giá trị bài viết].
  [CTA: chia sẻ, comment, liên hệ, hoặc đọc thêm bài liên quan].
</p>
```

**Checklist nội dung:**
- [ ] Focus keyword xuất hiện trong đoạn đầu tiên
- [ ] Ít nhất 1 H2 chứa focus keyword hoặc biến thể
- [ ] Mỗi H2 section ≥ 200 từ
- [ ] Tổng bài ≥ 800 từ (lý tưởng 1200-2000 từ)
- [ ] Có câu hỏi tu từ để tăng tính engaging
- [ ] Dùng "bạn" thay vì "người dùng" (giọng 2nd person)
- [ ] Kết bài có CTA cụ thể

---

## 9. Troubleshooting

### Server không khởi động
```
ERROR: Missing required env vars
```
→ Kiểm tra `.env` có đủ `WP_URL`, `WP_USERNAME`, `WP_APP_PASSWORD`, `CLAUDE_CLIENT_ID`, `CLAUDE_CLIENT_SECRET`.

### Ảnh không gen được
```
WARNING: GEMINI_API_KEY not set
```
→ Thêm `GEMINI_API_KEY=AIzaSy...` vào `.env`. Lấy key tại [Google AI Studio](https://aistudio.google.com/).

### SEO meta không được set (Yoast/RankMath)
→ Plugin SEO cần bật tính năng REST API. Trong Yoast: SEO → General → Features → REST API → bật.
→ Nếu vẫn không được, WordPress App Password cần quyền `edit_posts`.

### Canva URL không upload được
→ Canva export URL cần là **direct image URL** (kết thúc `.png` hoặc `.jpg`), không phải link share page.
→ Dùng Canva connector option "Export as PNG" → "Copy direct link".

### Claude không thấy tools
→ Kiểm tra server đang chạy và accessible từ internet (không phải localhost thuần).
→ Thử `GET https://your-server/.well-known/oauth-authorization-server` — phải trả về JSON.

### SEO score thấp
Xem `seo_warnings` trong response để biết cụ thể cần fix gì:
- `"Focus keyword not found in title"` → Thêm keyword vào title
- `"Focus keyword not found in first paragraph"` → Mở đầu bài phải nhắc đến keyword
- `"Meta description too short"` → Meta description ít nhất 120 ký tự
- `"Keyword density too low"` → Keyword xuất hiện quá ít trong bài (< 0.5%)
