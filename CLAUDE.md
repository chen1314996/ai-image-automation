# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **AI Image Generation Automation Platform** that automates the workflow of:
1. Reading reference images from a local folder
2. Uploading to Doubao (豆包) to generate 5 sets of prompt words
3. Extracting the prompts and feeding them to Legil platform
4. Generating and saving images from Legil
5. **Phase 9:** Full workflow automation - loop through all reference images
6. **Phase 10:** Prompt management panel - store, view, copy, and selectively send prompts to Legil

**Tech Stack:** Node.js + Express + Playwright + HTML Frontend with SSE (Server-Sent Events) for real-time logging

## Running the Project

```bash
# Install dependencies
npm install

# Start the server (runs on port 3055)
npm start
# or
node server.js

# Access the web interface
open http://localhost:3055
```

## Architecture

### Core Files

| File | Purpose |
|------|---------|
| `server.js` | Express server with API routes and SSE endpoint for logs |
| `playwright-controller.js` | Browser automation controller using persistent context for login state |
| `doubao-automation.js` | Doubao platform automation (upload image, get prompts, extract 5 prompts) |
| `legil-automation.js` | Legil platform automation (input prompt, generate & save images) |
| `workflow-controller.js` | **Phase 9:** Full workflow orchestration - loops through all reference images |
| `logger.js` | Real-time logging system using Server-Sent Events |
| `public/index.html` | Frontend UI with real-time log display and prompt management panel |

### Key Design Patterns

**Browser State Management:**
- Uses `launchPersistentContext()` to maintain login sessions across restarts
- User data stored in `./browser_data` folder
- Pages tracked by name ('doubao', 'legil') in `BrowserController.pages`
- Login state persisted in `storage_state.json`

**Real-time Logging:**
- SSE endpoint at `/api/logs`
- Logger maintains array of client response objects
- Logs pushed from server to all connected clients

**Automation Flow:**
1. `POST /api/doubao/full-automation` → Uploads image to Doubao, extracts 5 prompts
2. `POST /api/legil/batch-generate` → Takes prompts array, generates images sequentially with 5-second delays
3. `POST /api/workflow/start` → **Phase 9:** Full workflow - loops through all reference images in folder

**Prompt Extraction Strategy:**
The `extractPrompts()` method in `doubao-automation.js` uses 5 fallback strategies:
1. "提示词 X：" format (most common)
2. "第 X 组" format
3. "X. 标题" or "X 标题" format
4. Code blocks (```plaintext ... ```)
5. Intelligent paragraph segmentation (fallback)

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/count-images` | POST | Count images in a folder |
| `/api/open-website` | POST | Open single website |
| `/api/open-both-websites` | POST | Open Doubao + Legil simultaneously |
| `/api/close-browser` | POST | Close browser |
| `/api/browser-status` | GET | Check browser state |
| `/api/doubao/full-automation` | POST | Upload image, get response, extract prompts |
| `/api/doubao/extracted-prompts` | GET | Get cached extracted prompts (from doubao-automation) |
| `/api/legil/generate` | POST | Generate single image from prompt |
| `/api/legil/batch-generate` | POST | Batch generate images from prompts array |
| `/api/workflow/start` | POST | Start full workflow (process all reference images) |
| `/api/workflow/status` | GET | Get workflow status |
| `/api/workflow/stop` | POST | Stop workflow |
| `/api/workflow/extracted-prompts` | GET | **Phase 10:** Get prompts from workflow-controller cache |
| `/api/logs` | GET | SSE endpoint for real-time logs |

### Default Configuration

```javascript
// Default folders (Windows paths)
Reference images: D:\工作\自动化工作流1\输入
Output images:    D:\工作\自动化工作流1\输出

// Default URLs
Doubao: https://www.doubao.com/chat/
Legil:  https://lumos.diandian.info/legil/image-ai/image-to-image
```

## Working with Playwright Automation

### Common Selectors Used

**Doubao:**
- File input: `input[type="file"]`
- Chat input: `div[contenteditable="true"]`, `textarea`, `[class*="editor"]`
- Messages: `[data-role="assistant"]`, `[class*="bot-message"]`
- New chat button: `button:has-text("新对话")`, `[class*="new-chat"]`

**Legil:**
- Prompt input: `textarea[placeholder*="提示"]`, `div[contenteditable="true"]`, `textarea`
- Generate button: `button:has-text("生成")`, `button:has-text("创建")`
- Generation indicator: `text=生成中`, `svg[class*="animate-spin"]`
- Timestamp: `text=/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/`
- Image: `img[src*="legil"]`

### Timing Considerations

- Doubao response generation: 60-180 seconds (randomized to avoid detection)
- Legil image generation: 3-5 minutes (300 seconds max wait)
- Delay between batch generations: 5 seconds
- Delay between reference images: 30 seconds (cooldown to avoid rate limiting)

### Image Saving Strategy (Legil)

1. First try: Screenshot the image element
2. Fallback: Download via fetch (handles relative URLs like `/legil/_next/image...`)
3. Saves to output folder with timestamp: `legil_generated_YYYYMMDD_HHmmss_index.png`

## Workflow Automation (Phase 9)

The workflow controller (`workflow-controller.js`) implements the complete automation pipeline:

```
For each reference image in input folder:
  1. Upload to Doubao → Get 5 prompts
  2. Close Doubao chat (isolated per image)
  3. For each of 5 prompts:
     - Send to Legil
     - Generate and save image
     - Wait 5 seconds
  4. Start new Doubao chat (if not last image)
  5. Wait 30 seconds cooldown
```

## Prompt Management Panel (Phase 10)

The frontend includes a prompt management section for viewing and managing extracted prompts:

- **Fetch Prompts:** Retrieves prompts from workflow or doubao cache
- **Copy Individual/All:** Copy prompts to clipboard
- **Send to Legil:** Send individual or all prompts to Legil for generation

## Troubleshooting

**Browser won't open (lock file error):**
```bash
# Kill all Node processes first
taskkill /F /IM node.exe

# Delete the lock file
rm ./browser_data/SingletonLock
```

**Port already in use:**
- Server runs on port 3055 (see `server.js` line 37)
- Change `const PORT = 3055` to use a different port

**Login not persisting:**
- Ensure `browser_data` folder exists and is writable
- Check that `launchPersistentContext` is being used (not `launch`)
- Verify `storage_state.json` is being created on first login

**Prompt extraction fails:**
- Check the log output to see which extraction strategy was attempted
- The response may be in a new format not covered by the 5 strategies
- Check `doubao-automation.js` `extractPrompts()` method to add new patterns

## Development Notes

- No build step required - direct Node.js execution
- No test framework configured
- Frontend is vanilla HTML/JS served from `public/` folder
- Windows-style paths used throughout (project developed on Windows)
- Real-time logs use Server-Sent Events (SSE) not WebSockets
- All automation modules export singleton instances
