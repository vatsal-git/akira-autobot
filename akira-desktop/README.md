# Akira Desktop Widget

A lightweight, always-on-top AI assistant widget powered by OpenRouter.

## Features

- **Always-on-top floating widget** - Bottom-right corner by default, click to switch corners
- **Transparent, modern UI** - Clean design with smooth animations
- **Full AI capabilities** - Chat, desktop control, file management, web search, memory
- **Global shortcut** - `Ctrl+Shift+A` to show/hide
- **System tray integration** - Right-click for quick actions
- **Secure API key storage** - Uses OS keychain

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (latest stable)
- Windows 10/11 (for desktop control features)

## Development

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run tauri dev
```

### Build for production

```bash
npm run tauri build
```

The installer will be created in `src-tauri/target/release/bundle/`.

## First Run Setup

1. Launch the app
2. Enter your OpenRouter API key (get one at [openrouter.ai/keys](https://openrouter.ai/keys))
3. Select your preferred AI model
4. Start chatting!

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Show/Hide widget |
| `Enter` | Send message |
| `Shift+Enter` | New line in input |

## Tools

The widget has access to these tools:

- **Desktop Control** - Mouse, keyboard, screen capture
- **File Management** - Read, write, list files
- **Web Search** - Search the web
- **Memory** - Store and recall information

## Configuration

Settings are stored in:
- **Windows**: `%APPDATA%/akira-desktop/settings.json`
- **API Key**: Stored securely in Windows Credential Manager

## Tech Stack

- **Frontend**: React 18, Framer Motion, React Markdown
- **Backend**: Rust, Tauri 2
- **AI**: OpenRouter API

## License

MIT
